import { env } from 'cloudflare:workers';
import { getMigrations } from 'better-auth/db/migration';
import { auth } from './auth.mjs';

const KINDS = new Set(['song', 'struct', 'chord']);
const MAX_PAYLOAD_BYTES = 200_000;
const MAX_JSON_BYTES = 250_000;
const MAX_PENDING = 1_000;
const MAX_BATCH_IDS = 100;
const PROPOSALS_PER_MINUTE = 20;
const SAFE_ID = /^[A-Za-z0-9&_.-]{1,160}$/;
const SOLFA_SRC = /^assets\/solfa\/[A-Za-z0-9._-]+\.(?:avif|png|jpe?g|webp)$/;
const STRUCT_OPS = new Set(['addGroup', 'addBook', 'renameGroup', 'renameBook', 'deleteBook', 'deleteGroup']);
const SONG_OPS = new Set(['update', 'delete']);
const VERSE_TYPES = new Set(['v', 'c', 'b', 'p', 'pc']);
let lastRateCleanup = 0;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function allowedOrigins() {
  return new Set(
    String(env.CORS_ORIGINS || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const headers = new Headers();
  if (origin && allowedOrigins().has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(request)) headers.set(key, value);
  if (!headers.has('Cache-Control') && request.url.includes('/api/')) {
    headers.set('Cache-Control', 'no-store');
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

function preflight(request) {
  const headers = corsHeaders(request);
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Setup-Token');
  headers.set('Access-Control-Max-Age', '600');
  return new Response(null, { status: 204, headers });
}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) {
    throw new HttpError(413, 'request body is too large');
  }

  let raw = '';
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BYTES) {
        try { await reader.cancel(); } catch {}
        throw new HttpError(413, 'request body is too large');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  }

  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value)
    && value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, field + ' must be an object');
  }
  return value;
}

function requireId(value, field) {
  if (!isSafeId(value)) throw new HttpError(400, field + ' must be a safe ID');
  return value;
}

function validateSong(song, op) {
  requireObject(song, 'payload.song');
  requireId(song.id, 'payload.song.id');
  if (op === 'delete') return;

  if (typeof song.title !== 'string' || !song.title.trim() || song.title.length > 500) {
    throw new HttpError(400, 'payload.song.title must be a non-empty string');
  }
  for (const field of ['author', 'number', 'key', 'solfa', 'solfa2']) {
    if (song[field] != null && typeof song[field] !== 'string'
      && !(field === 'number' && typeof song[field] === 'number')) {
      throw new HttpError(400, 'payload.song.' + field + ' must be a string');
    }
  }
  for (const field of ['solfa', 'solfa2']) {
    if (song[field] && !SOLFA_SRC.test(song[field])) {
      throw new HttpError(400, 'payload.song.' + field + ' must be a local solfa asset');
    }
  }
  if (!Array.isArray(song.verses) || song.verses.length > 200) {
    throw new HttpError(400, 'payload.song.verses must be an array');
  }
  for (const verse of song.verses) {
    requireObject(verse, 'payload.song.verses[]');
    if (verse.type != null && !VERSE_TYPES.has(verse.type)) {
      throw new HttpError(400, 'payload.song.verses[].type is not supported');
    }
    if (!Array.isArray(verse.lines) || verse.lines.length > 100
      || !verse.lines.every(line => typeof line === 'string' && line.length <= 5000)) {
      throw new HttpError(400, 'payload.song.verses[].lines must be an array of strings');
    }
  }
}

function validateEditPayload(kind, payload) {
  requireObject(payload, 'payload');
  if (kind === 'chord') {
    requireId(payload.id, 'payload.id');
    requireObject(payload.chart, 'payload.chart');
    return payload;
  }

  const op = payload.op;
  requireId(payload.id, 'payload.id');
  if (payload.from != null) requireId(payload.from, 'payload.from');

  if (kind === 'struct') {
    if (payload.cat !== null || !STRUCT_OPS.has(op)) {
      throw new HttpError(400, 'payload must be a supported structural edit');
    }
    requireObject(payload.song, 'payload.song');
    if (op === 'addGroup') {
      requireId(payload.song.id, 'payload.song.id');
      if (!Array.isArray(payload.song.books) || !payload.song.books.every(isSafeId)) {
        throw new HttpError(400, 'payload.song.books must contain safe IDs');
      }
      if (payload.song.bookDefs != null) {
        if (!Array.isArray(payload.song.bookDefs)
          || !payload.song.bookDefs.every(book => book && isSafeId(book.code))) {
          throw new HttpError(400, 'payload.song.bookDefs must contain safe codes');
        }
      }
    } else if (op === 'addBook') {
      requireId(payload.song.code, 'payload.song.code');
      requireId(payload.song.group, 'payload.song.group');
    }
    return payload;
  }

  if (!isSafeId(payload.cat) || !SONG_OPS.has(op)) {
    throw new HttpError(400, 'payload must be a supported song edit');
  }
  validateSong(payload.song, op);
  if (payload.song.id !== payload.id) {
    throw new HttpError(400, 'payload.song.id must match payload.id');
  }
  return payload;
}

function assertKind(kind) {
  if (!KINDS.has(kind)) throw new HttpError(400, 'kind must be song, struct, or chord');
  return kind;
}

function payloadText(payload) {
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'payload must be an object');
  let text;
  try {
    text = JSON.stringify(payload);
  } catch {
    throw new HttpError(400, 'payload must be JSON-serializable');
  }
  if (!text || new TextEncoder().encode(text).length >= MAX_PAYLOAD_BYTES) {
    throw new HttpError(413, 'payload must be smaller than 200 KB');
  }
  return text;
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function truncate(value, max) {
  return String(value ?? '').slice(0, max);
}

function nowMs() {
  return Date.now();
}

function adminEmails() {
  return new Set(
    String(env.ADMIN_EMAILS || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isAdmin(user) {
  return !!user && adminEmails().has(String(user.email || '').toLowerCase());
}

async function optionalSession(request) {
  try {
    return await auth.api.getSession({ headers: request.headers });
  } catch {
    return null;
  }
}

async function requireAdmin(request) {
  const session = await optionalSession(request);
  if (!session?.user) throw new HttpError(401, 'authentication required');
  if (!isAdmin(session.user)) throw new HttpError(403, 'admin access required');
  return session;
}

async function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)),
  ]);
  const left = new Uint8Array(ha);
  const right = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function requireSetupToken(request) {
  const token = request.headers.get('x-setup-token');
  if (!env.SETUP_TOKEN || !(await safeEqual(token, env.SETUP_TOKEN))) {
    throw new HttpError(404, 'not found');
  }
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

async function consumeRateLimit(key) {
  const now = nowMs();
  const windowStart = Math.floor(now / 60_000) * 60_000;
  if (now - lastRateCleanup > 60 * 60 * 1000) {
    lastRateCleanup = now;
    await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?')
      .bind(now - 24 * 60 * 60 * 1000).run();
  }
  const row = await env.DB.prepare(`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING count
  `).bind(key, windowStart).first();
  if (!row || Number(row.count) > PROPOSALS_PER_MINUTE) {
    throw new HttpError(429, 'too many submissions; try again in a minute');
  }
}

async function getState() {
  const row = await env.DB.prepare(
    'SELECT version, updated_at FROM publish_state WHERE id = 1',
  ).first();
  return { version: Number(row?.version) || 0, updated_at: Number(row?.updated_at) || 0 };
}

async function handleState() {
  return json(await getState());
}

async function handlePublishedEdits(request) {
  const since = Number(new URL(request.url).searchParams.get('since') || 0);
  const rows = await env.DB.prepare(`
    SELECT seq, kind, payload, published_at
    FROM published_edits
    WHERE seq > ?
    ORDER BY seq ASC
  `).bind(Number.isFinite(since) && since > 0 ? since : 0).all();
  const edits = (rows.results || []).map(row => ({
    seq: Number(row.seq),
    kind: row.kind,
    payload: JSON.parse(row.payload),
    published_at: Number(row.published_at),
  }));
  return json(edits);
}

async function handleProposal(request) {
  await consumeRateLimit(`proposal:${clientIp(request)}`);
  const body = await readJson(request);
  const kind = assertKind(body.kind);
  const payload = validateEditPayload(kind, body.payload);
  const text = payloadText(payload);
  const hash = await sha256(kind + '\n' + canonical(payload));

  const existing = await env.DB.prepare(`
    SELECT id FROM proposals
    WHERE status = 'pending' AND kind = ? AND payload_hash = ?
    LIMIT 1
  `).bind(kind, hash).first();
  if (existing) return json({ id: Number(existing.id), duplicate: true });

  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'",
  ).first();
  if (Number(pending?.n) >= MAX_PENDING) {
    throw new HttpError(429, 'review queue is full; try again later');
  }

  const session = await optionalSession(request);
  const submitter = session?.user || null;
  const summary = truncate(body.summary, 300);
  const name = truncate(submitter?.name || submitter?.email || body.name, 120);
  const baseVersion = Number.isInteger(Number(body.baseVersion)) ? Number(body.baseVersion) : 0;
  const createdAt = nowMs();

  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO proposals
      (kind, payload, payload_hash, summary, status, base_version, submitter_user_id, submitter_name, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).bind(kind, text, hash, summary, baseVersion, submitter?.id || null, name, createdAt).run();

  if (Number(result.meta?.changes) === 1) {
    return json({ id: Number(result.meta.last_row_id), duplicate: false }, 201);
  }

  const raced = await env.DB.prepare(`
    SELECT id FROM proposals
    WHERE status = 'pending' AND kind = ? AND payload_hash = ?
    LIMIT 1
  `).bind(kind, hash).first();
  if (!raced) throw new HttpError(409, 'proposal could not be queued');
  return json({ id: Number(raced.id), duplicate: true });
}

async function handleAdminProposals(request) {
  await requireAdmin(request);
  const rows = await env.DB.prepare(`
    SELECT id, kind, payload, summary, submitter_name, created_at, status
    FROM proposals
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 100
  `).all();
  return json((rows.results || []).map(row => ({
    id: Number(row.id),
    kind: row.kind,
    payload: JSON.parse(row.payload),
    summary: row.summary || '',
    submitter_name: row.submitter_name || '',
    created_at: Number(row.created_at),
    status: row.status,
  })));
}

async function handleAdminMe(request) {
  const session = await requireAdmin(request);
  const user = session.user;
  return json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role || 'user',
    },
    isAdmin: true,
  });
}

async function handlePublish(request) {
  const session = await requireAdmin(request);
  const body = await readJson(request);
  const kind = assertKind(body.kind);
  const payload = validateEditPayload(kind, body.payload);
  const text = payloadText(payload);

  const current = await getState();
  if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) {
    throw new HttpError(409, `version conflict: expected ${body.expectedVersion}, current ${current.version}`);
  }

  const at = nowMs();
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO published_edits (kind, payload, published_at)
      VALUES (?, ?, ?)
    `).bind(kind, text, at),
    env.DB.prepare(`
      UPDATE publish_state
      SET version = version + 1, updated_at = ?
      WHERE id = 1
      RETURNING version
    `).bind(at),
  ]);
  const version = Number(results.at(-1)?.results?.[0]?.version);
  if (!version) throw new HttpError(500, 'publish did not advance the version');
  return json({ version, published_by: session.user.email });
}

function parseIds(value) {
  if (!Array.isArray(value)) throw new HttpError(400, 'ids must be an array');
  const ids = [...new Set(value.map(Number).filter(Number.isInteger))];
  if (!ids.length || ids.length > MAX_BATCH_IDS) {
    throw new HttpError(400, `ids must contain 1-${MAX_BATCH_IDS} integers`);
  }
  return ids;
}

async function handleApprove(request) {
  const session = await requireAdmin(request);
  const body = await readJson(request);
  const ids = parseIds(body.ids);
  const placeholders = ids.map(() => '?').join(',');

  const rows = await env.DB.prepare(`
    SELECT id, kind, payload FROM proposals
    WHERE id IN (${placeholders}) AND status = 'pending'
    ORDER BY id ASC
  `).bind(...ids).all();
  const pending = rows.results || [];
  if (pending.length !== ids.length) {
    throw new HttpError(409, 'one or more proposals are missing or already reviewed');
  }
  for (const row of pending) {
    try {
      validateEditPayload(row.kind, JSON.parse(row.payload));
    } catch (error) {
      if (error instanceof HttpError) throw new HttpError(400, 'proposal ' + row.id + ' has an invalid payload');
      throw error;
    }
  }

  const current = await getState();
  if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) {
    throw new HttpError(409, `version conflict: expected ${body.expectedVersion}, current ${current.version}`);
  }

  const at = nowMs();
  const statements = pending.map(row => env.DB.prepare(`
    INSERT INTO published_edits (kind, payload, proposal_id, published_at)
    VALUES (?, ?, ?, ?)
  `).bind(row.kind, row.payload, row.id, at));
  statements.push(env.DB.prepare(`
    UPDATE proposals
    SET status = 'approved', reviewed_at = ?, reviewed_by = ?
    WHERE id IN (${placeholders}) AND status = 'pending'
  `).bind(at, session.user.id, ...ids));
  statements.push(env.DB.prepare(`
    UPDATE publish_state
    SET version = version + 1, updated_at = ?
    WHERE id = 1
    RETURNING version
  `).bind(at));

  const results = await env.DB.batch(statements);
  const version = Number(results.at(-1)?.results?.[0]?.version);
  if (!version) throw new HttpError(500, 'approval did not advance the version');
  return json({ version, approved: pending.length });
}

async function handleReject(request) {
  const session = await requireAdmin(request);
  const body = await readJson(request);
  const ids = parseIds(body.ids);
  const placeholders = ids.map(() => '?').join(',');
  const result = await env.DB.prepare(`
    UPDATE proposals
    SET status = 'rejected', note = ?, reviewed_at = ?, reviewed_by = ?
    WHERE id IN (${placeholders}) AND status = 'pending'
  `).bind(truncate(body.note, 300), nowMs(), session.user.id, ...ids).run();
  return json({ rejected: Number(result.meta?.changes) || 0 });
}

async function handleSetupMigrate(request) {
  await requireSetupToken(request);
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (toBeCreated.length || toBeAdded.length) await runMigrations();
  return json({
    created: toBeCreated.map(table => table.table),
    added: toBeAdded.map(table => table.table),
  });
}

async function handleSetupAdmin(request) {
  await requireSetupToken(request);
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  if (!adminEmails().has(email)) throw new HttpError(403, 'email is not in ADMIN_EMAILS');
  const password = String(body.password || '');
  if (password.length < 12 || password.length > 128) {
    throw new HttpError(400, 'password must be 12-128 characters');
  }
  const name = truncate(body.name || 'Admin', 120) || 'Admin';

  const existing = await env.DB.prepare(
    'SELECT id FROM user WHERE lower(email) = ? LIMIT 1',
  ).bind(email).first();

  let created = false;
  if (!existing) {
    await auth.api.signUpEmail({ body: { email, password, name } });
    created = true;
  }

  const user = await env.DB.prepare(
    'SELECT id FROM user WHERE lower(email) = ? LIMIT 1',
  ).bind(email).first();
  if (!user) throw new HttpError(500, 'admin user could not be provisioned');

  await env.DB.prepare(
    "UPDATE user SET role = 'admin', emailVerified = 1, updatedAt = ? WHERE id = ?",
  ).bind(nowMs(), user.id).run();

  return json({ created, email, id: user.id });
}

async function route(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') return preflight(request);

  if (path === '/api/health') {
    return json({ ok: true, service: 'labu-api', environment: env.ENVIRONMENT || 'unknown' });
  }

  if (path.startsWith('/api/auth/')) {
    // Public registration is intentionally closed. The setup endpoint provisions
    // the allowlisted admin through Better Auth's server API.
    if (path.startsWith('/api/auth/sign-up')) {
      return json({ error: 'public sign-up is disabled' }, 403);
    }
    return auth.handler(request);
  }

  if (path === '/api/state' && request.method === 'GET') return handleState();
  if (path === '/api/published-edits' && request.method === 'GET') return handlePublishedEdits(request);
  if (path === '/api/proposals' && request.method === 'POST') return handleProposal(request);

  if (path === '/api/admin/me' && request.method === 'GET') return handleAdminMe(request);
  if (path === '/api/admin/proposals' && request.method === 'GET') return handleAdminProposals(request);
  if (path === '/api/admin/publish' && request.method === 'POST') return handlePublish(request);
  if (path === '/api/admin/approve' && request.method === 'POST') return handleApprove(request);
  if (path === '/api/admin/reject' && request.method === 'POST') return handleReject(request);

  if (path === '/api/setup/migrate' && request.method === 'POST') return handleSetupMigrate(request);
  if (path === '/api/setup/admin' && request.method === 'POST') return handleSetupAdmin(request);

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request) {
    try {
      return withCors(await route(request), request);
    } catch (error) {
      if (error instanceof HttpError) return withCors(json({ error: error.message }, error.status), request);
      console.error('labu-api error', request.method, new URL(request.url).pathname, error);
      return withCors(json({ error: 'internal server error' }, 500), request);
    }
  },
};
