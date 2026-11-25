import { env } from 'cloudflare:workers';
import { getMigrations } from 'better-auth/db/migration';
import { auth } from './auth.mjs';
import { baseRev, canonical, payloadTarget, sha256Text, staleProposals } from './revisions.mjs';

const KINDS = new Set(['song', 'struct', 'chord']);
const OWNER_EMAIL = 'minatolun@gmail.com';
// Username-only admins still need an address row for Better Auth. This private
// domain is never shown or accepted as a login address.
const USERNAME_EMAIL_DOMAIN = 'admins.labu.local';
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LOGIN_ATTEMPTS_PER_MINUTE = 10;
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
  headers.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
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

// Published-layer replay, revision fingerprints and staleness live in
// revisions.mjs so they can be unit tested without D1.
async function publishedRowsFor(target) {
  if (!target) return [];
  // Rows written before the `target` column existed carry NULL and may belong to
  // any song, so they are replayed too and filtered by the caller.
  const rows = await env.DB.prepare(`
    SELECT seq, kind, payload, target
    FROM published_edits
    WHERE target = ? OR target IS NULL
    ORDER BY seq ASC
  `).bind(target).all();
  return (rows.results || []).map(row => ({
    seq: Number(row.seq),
    kind: row.kind,
    payload: JSON.parse(row.payload),
  }));
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
  if (!user) return false;
  // ADMIN_EMAILS bootstraps the first account; additional admins are stored with
  // role='admin' in D1 so they do not need a Worker redeploy.
  return user.role === 'admin' || adminEmails().has(String(user.email || '').toLowerCase());
}

function isOwner(user) {
  return !!user && String(user.email || '').toLowerCase() === OWNER_EMAIL;
}

function parseUsername(value) {
  const username = String(value || '').trim();
  if (!username) return '';
  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(400, 'username must be 3-32 characters using letters, numbers, dot, dash or underscore');
  }
  return username;
}

function usernameEmail(username) {
  return username.toLowerCase() + '@' + USERNAME_EMAIL_DOMAIN;
}

function isPrivateEmail(email) {
  return String(email || '').toLowerCase().endsWith('@' + USERNAME_EMAIL_DOMAIN);
}

// The UI shows @username when an admin has one, otherwise the real email.
function displayLogin(user) {
  const username = String(user?.username || '').trim();
  if (username) return '@' + username;
  const email = String(user?.email || '');
  return isPrivateEmail(email) ? '@' + email.split('@')[0] : email;
}

function publicAdmin(user, viewerId) {
  const email = isPrivateEmail(user?.email) ? '' : String(user?.email || '');
  return {
    id: user?.id || '',
    name: user?.name || '',
    role: user?.role || 'user',
    username: user?.username || '',
    email: email,
    login: displayLogin(user),
    isOwner: isOwner(user),
    isSelf: !!viewerId && user?.id === viewerId,
  };
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

async function consumeRateLimit(key, max = PROPOSALS_PER_MINUTE, message = 'too many submissions; try again in a minute') {
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
  if (!row || Number(row.count) > max) {
    throw new HttpError(429, message);
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
  const hash = await sha256Text(kind + '\n' + canonical(payload));

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
  const target = payloadTarget(kind, payload);
  // Fingerprint the published revision this proposal was written against. An
  // approval recomputes it, so an outdated proposal is refused instead of
  // silently overwriting whatever landed in the meantime.
  const revision = await baseRev(kind, payload, await publishedRowsFor(target));

  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO proposals
      (kind, payload, payload_hash, summary, status, base_version, submitter_user_id, submitter_name, created_at, target, base_rev)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `).bind(kind, text, hash, summary, baseVersion, submitter?.id || null, name, createdAt, target, revision).run();

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

const PROPOSAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'all']);

// Shaped for the review UI: the raw patch plus who/when/which revision.
function adminProposal(row) {
  if (!row) return null;
  let payload = null;
  try { payload = JSON.parse(row.payload); } catch { payload = null; }
  return {
    id: Number(row.id),
    kind: row.kind,
    status: row.status,
    payload,
    summary: row.summary || '',
    submitter_name: row.submitter_name || '',
    created_at: Number(row.created_at),
    reviewed_at: row.reviewed_at == null ? null : Number(row.reviewed_at),
    reviewed_by_name: row.reviewed_by_name || '',
    note: row.note || '',
    base_rev: row.base_rev == null ? null : String(row.base_rev),
    base_version: Number(row.base_version) || 0,
    target: row.target || (payload ? payloadTarget(row.kind, payload) : ''),
  };
}

// GET /api/admin/proposals?status=pending&song=<id>&limit=100
// Defaults to the pending queue, which is what older clients expect (an array).
async function handleAdminProposals(request) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || 'pending');
  if (!PROPOSAL_STATUSES.has(status)) throw new HttpError(400, 'status must be pending, approved, rejected or all');
  const song = url.searchParams.get('song');
  if (song != null && !isSafeId(song)) throw new HttpError(400, 'song must be a safe ID');
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
  const order = status === 'pending' ? 'created_at ASC' : 'created_at DESC';

  const clauses = [];
  const binds = [];
  if (status !== 'all') { clauses.push('status = ?'); binds.push(status); }
  if (song) { clauses.push('target = ?'); binds.push(song); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = await env.DB.prepare(`
    SELECT id, kind, payload, summary, submitter_name, created_at, status,
           reviewed_at, reviewed_by_name, note, base_rev, base_version, target
    FROM proposals
    ${where}
    ORDER BY ${order}
    LIMIT ?
  `).bind(...binds, limit).all();
  return json((rows.results || []).map(adminProposal));
}

// Queue counters for the dashboard, in one grouped query.
async function handleAdminProposalCounts(request) {
  await requireAdmin(request);
  const rows = await env.DB.prepare(
    'SELECT status, COUNT(*) AS n FROM proposals GROUP BY status',
  ).all();
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of rows.results || []) {
    if (row.status in counts) counts[row.status] = Number(row.n) || 0;
  }
  return json(counts);
}

async function handleAdminProposal(request, id) {
  await requireAdmin(request);
  const row = await env.DB.prepare(`
    SELECT id, kind, payload, summary, submitter_name, created_at, status,
           reviewed_at, reviewed_by_name, note, base_rev, base_version, target
    FROM proposals WHERE id = ?
  `).bind(Number(id)).first();
  if (!row) throw new HttpError(404, 'proposal not found');
  return json(adminProposal(row));
}

// GET /api/admin/song-revisions?id=<songId>
// Everything moderation knows about one song: the published layer that produced
// what readers see now, and every reviewed proposal (approved or rejected) with
// its reviewer and rejection reason. Admin-only: this is internal history.
async function handleAdminSongRevisions(request) {
  await requireAdmin(request);
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!isSafeId(id)) throw new HttpError(400, 'id must be a safe song ID');
  const rows = await env.DB.prepare(`
    SELECT seq, kind, payload, proposal_id, published_at, target
    FROM published_edits
    WHERE target = ? OR target IS NULL
    ORDER BY seq ASC
  `).bind(id).all();
  const published = (rows.results || [])
    .map(row => ({
      seq: Number(row.seq),
      kind: row.kind,
      payload: JSON.parse(row.payload),
      proposal_id: row.proposal_id == null ? null : Number(row.proposal_id),
      published_at: Number(row.published_at),
    }))
    .filter(row => row.payload && row.payload.id === id);
  const reviewed = await env.DB.prepare(`
    SELECT id, kind, status, summary, submitter_name, created_at, reviewed_at,
           reviewed_by_name, note, base_rev, base_version
    FROM proposals
    WHERE target = ? AND status IN ('approved', 'rejected')
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(id).all();
  return json({ id, published, reviewed: (reviewed.results || []).map(row => ({
    id: Number(row.id),
    kind: row.kind,
    status: row.status,
    summary: row.summary || '',
    submitter_name: row.submitter_name || '',
    created_at: Number(row.created_at),
    reviewed_at: row.reviewed_at == null ? null : Number(row.reviewed_at),
    reviewed_by_name: row.reviewed_by_name || '',
    note: row.note || '',
    base_rev: row.base_rev == null ? null : String(row.base_rev),
  })) });
}

async function handleAdminMe(request) {
  const session = await requireAdmin(request);
  const user = session.user;
  // Read the row so username (not part of Better Auth's session payload) and the
  // primary-admin flag travel with the session.
  const row = await env.DB.prepare(
    'SELECT id, name, email, role, username FROM user WHERE id = ?',
  ).bind(user.id).first();
  const admin = publicAdmin(row || user, user.id);
  return json({
    user: admin,
    isAdmin: true,
    canCreateAdmin: admin.isOwner,
  });
}

// Sign in with an email address or a username. The client posts one field so a
// username-only admin never has to know the private address behind the account.
async function handleSignIn(request) {
  await consumeRateLimit('login:' + clientIp(request), LOGIN_ATTEMPTS_PER_MINUTE,
    'too many sign-in attempts; try again in a minute');
  const body = await readJson(request);
  const login = String(body.login || body.email || '').trim();
  const password = String(body.password || '');
  if (!login || !password) throw new HttpError(400, 'email or username and password are required');

  let email = login.toLowerCase();
  if (!login.includes('@')) {
    const row = await env.DB.prepare(
      'SELECT email FROM user WHERE lower(username) = ? OR lower(email) = ? LIMIT 1',
    ).bind(login.toLowerCase(), usernameEmail(login)).first();
    email = row ? String(row.email) : usernameEmail(login);
  }

  // Hand the resolved address to Better Auth so it owns password checks, the
  // HttpOnly cookie and its own rate limiter. Unknown accounts fail the same way
  // as a wrong password, so this endpoint cannot be used to enumerate admins.
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  const target = new URL(request.url);
  target.pathname = '/api/auth/sign-in/email';
  target.search = '';
  return auth.handler(new Request(target.toString(), {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ email: email, password: password }),
  }));
}

async function listAdmins(viewerId) {
  const owners = [...adminEmails()];
  const sql = "SELECT id, name, email, role, username FROM user WHERE role = 'admin'"
    + (owners.length ? ` OR lower(email) IN (${owners.map(() => '?').join(',')})` : '')
    + ' ORDER BY createdAt ASC';
  const rows = await env.DB.prepare(sql).bind(...owners).all();
  return (rows.results || []).map(row => publicAdmin(row, viewerId));
}

async function requireOwner(request) {
  const session = await requireAdmin(request);
  if (!isOwner(session.user)) throw new HttpError(403, 'only the main admin can manage admins');
  return session;
}

async function handleAdminUsers(request) {
  const session = await requireOwner(request);
  return json({ admins: await listAdmins(session.user.id) });
}

async function adminTarget(request, userId) {
  const session = await requireOwner(request);
  const id = String(userId || '');
  if (!USER_ID_PATTERN.test(id)) throw new HttpError(400, 'invalid admin id');
  const target = await env.DB.prepare(
    'SELECT id, name, email, role, username FROM user WHERE id = ?',
  ).bind(id).first();
  if (!target) throw new HttpError(404, 'admin not found');
  return { session, target };
}

async function handleRemoveAdmin(request, userId) {
  const { session, target } = await adminTarget(request, userId);
  if (target.id === session.user.id) throw new HttpError(400, 'you cannot remove your own account');
  if (isOwner(target)) throw new HttpError(400, 'the main admin cannot be removed');
  await auth.api.removeUser({ body: { userId: target.id }, headers: request.headers });
  return json({ removed: true, id: target.id, login: displayLogin(target) });
}

async function handleSetAdminPassword(request, userId) {
  const { session, target } = await adminTarget(request, userId);
  if (target.id === session.user.id) {
    throw new HttpError(400, 'use change password for your own account');
  }
  const body = await readJson(request);
  const newPassword = String(body.newPassword || body.password || '');
  if (newPassword.length < 12 || newPassword.length > 128) {
    throw new HttpError(400, 'password must be 12-128 characters');
  }
  await auth.api.setUserPassword({
    body: { userId: target.id, newPassword: newPassword },
    headers: request.headers,
  });
  // Anyone holding the old password loses their session with it.
  await env.DB.prepare('DELETE FROM session WHERE userId = ?').bind(target.id).run();
  return json({ updated: true, id: target.id, login: displayLogin(target) });
}

async function handleCreateAdmin(request) {
  await requireOwner(request);
  const body = await readJson(request);
  const username = parseUsername(body.username);
  const emailInput = String(body.email || '').trim().toLowerCase();
  if (emailInput && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput) || emailInput.length > 254)) {
    throw new HttpError(400, 'a valid email is required');
  }
  if (!username && !emailInput) throw new HttpError(400, 'a username or email is required');
  const password = String(body.password || '');
  if (password.length < 12 || password.length > 128) {
    throw new HttpError(400, 'password must be 12-128 characters');
  }
  const email = emailInput || usernameEmail(username);
  const name = truncate(body.name || username || email.split('@')[0] || 'Admin', 120) || 'Admin';

  const existing = await env.DB.prepare(
    "SELECT id FROM user WHERE lower(email) = ? OR (? <> '' AND lower(username) = ?) LIMIT 1",
  ).bind(email, username, username.toLowerCase()).first();
  if (existing) {
    throw new HttpError(409, username ? 'that username or email is already taken' : 'an account with that email already exists');
  }

  await auth.api.signUpEmail({ body: { email, password, name } });
  const user = await env.DB.prepare(
    'SELECT id FROM user WHERE lower(email) = ? LIMIT 1',
  ).bind(email).first();
  if (!user) throw new HttpError(500, 'admin user could not be created');

  await env.DB.prepare(
    "UPDATE user SET role = 'admin', emailVerified = 1, username = ?, updatedAt = ? WHERE id = ?",
  ).bind(username || null, nowMs(), user.id).run();

  return json({ created: true, id: user.id, login: username ? '@' + username : email }, 201);
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
      INSERT INTO published_edits (kind, payload, published_at, target)
      VALUES (?, ?, ?, ?)
    `).bind(kind, text, at, payloadTarget(kind, payload)),
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

// Approval applies exactly the payload the admin reviewed. Before writing it,
// the revision fingerprint recorded at submission is recomputed from the
// published layer: if the song moved on in the meantime the approval is refused
// (409 with the stale ids) instead of overwriting that change.
async function handleApprove(request) {
  const session = await requireAdmin(request);
  const body = await readJson(request);
  const ids = parseIds(body.ids);
  const placeholders = ids.map(() => '?').join(',');

  const rows = await env.DB.prepare(`
    SELECT id, kind, payload, base_rev FROM proposals
    WHERE id IN (${placeholders}) AND status = 'pending'
    ORDER BY id ASC
  `).bind(...ids).all();
  const pending = (rows.results || []).map(row => ({
    id: Number(row.id),
    kind: row.kind,
    payloadText: row.payload,
    base_rev: row.base_rev == null ? null : String(row.base_rev),
    payload: null,
  }));
  if (pending.length !== ids.length) {
    throw new HttpError(409, 'one or more proposals are missing or already reviewed');
  }
  for (const row of pending) {
    try {
      row.payload = JSON.parse(row.payloadText);
      validateEditPayload(row.kind, row.payload);
    } catch (error) {
      if (error instanceof HttpError) throw new HttpError(400, 'proposal ' + row.id + ' has an invalid payload');
      throw error;
    }
  }

  const current = await getState();
  if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) {
    throw new HttpError(409, `version conflict: expected ${body.expectedVersion}, current ${current.version}`);
  }

  const cache = new Map();
  const rowsFor = async id => {
    if (!cache.has(id)) cache.set(id, await publishedRowsFor(id));
    return cache.get(id);
  };
  const stale = await staleProposals(pending, rowsFor);
  if (stale.length) {
    throw new HttpError(409, 'the song changed after this was submitted; sync and review it again');
  }

  const reviewer = truncate(session.user.name || session.user.email || '', 120);
  const at = nowMs();
  const statements = pending.map(row => env.DB.prepare(`
    INSERT INTO published_edits (kind, payload, proposal_id, published_at, target)
    VALUES (?, ?, ?, ?, ?)
  `).bind(row.kind, row.payloadText, row.id, at, payloadTarget(row.kind, row.payload)));
  statements.push(env.DB.prepare(`
    UPDATE proposals
    SET status = 'approved', reviewed_at = ?, reviewed_by = ?, reviewed_by_name = ?
    WHERE id IN (${placeholders}) AND status = 'pending'
  `).bind(at, session.user.id, reviewer, ...ids));
  // The version guard is the write lock: if another approval landed between the
  // stale check above and this batch, this UPDATE matches nothing and the whole
  // batch is discarded, so two admins can never both approve over each other.
  statements.push(env.DB.prepare(`
    UPDATE publish_state
    SET version = version + 1, updated_at = ?
    WHERE id = 1 AND version = ?
    RETURNING version
  `).bind(at, current.version));

  const results = await env.DB.batch(statements);
  const decided = Number(results.at(-2)?.meta?.changes) || 0;
  if (decided !== ids.length) {
    throw new HttpError(409, 'one or more proposals were reviewed by someone else; refresh the queue');
  }
  const version = Number(results.at(-1)?.results?.[0]?.version);
  if (!version) {
    throw new HttpError(409, 'the published layer changed while approving; refresh and try again');
  }
  return json({ version, approved: pending.length });
}

async function handleReject(request) {
  const session = await requireAdmin(request);
  const body = await readJson(request);
  const ids = parseIds(body.ids);
  const note = truncate(body.note, 300);
  const placeholders = ids.map(() => '?').join(',');
  const reviewer = truncate(session.user.name || session.user.email || '', 120);
  const result = await env.DB.prepare(`
    UPDATE proposals
    SET status = 'rejected', note = ?, reviewed_at = ?, reviewed_by = ?, reviewed_by_name = ?
    WHERE id IN (${placeholders}) AND status = 'pending'
  `).bind(note, nowMs(), session.user.id, reviewer, ...ids).run();
  const rejected = Number(result.meta?.changes) || 0;
  if (rejected !== ids.length) {
    throw new HttpError(409, 'one or more proposals were already reviewed; refresh the queue');
  }
  return json({ rejected });
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

  if (path === '/api/login' && request.method === 'POST') return handleSignIn(request);

  if (path === '/api/admin/me' && request.method === 'GET') return handleAdminMe(request);
  if (path === '/api/admin/users' && request.method === 'GET') return handleAdminUsers(request);
  if (path === '/api/admin/users' && request.method === 'POST') return handleCreateAdmin(request);
  const adminUser = path.match(/^\/api\/admin\/users\/([^/]+)(\/password)?$/);
  if (adminUser && !adminUser[2] && request.method === 'DELETE') return handleRemoveAdmin(request, adminUser[1]);
  if (adminUser && adminUser[2] && request.method === 'POST') return handleSetAdminPassword(request, adminUser[1]);
  if (path === '/api/admin/proposals' && request.method === 'GET') return handleAdminProposals(request);
  if (path === '/api/admin/proposals/counts' && request.method === 'GET') return handleAdminProposalCounts(request);
  const adminProposalPath = path.match(/^\/api\/admin\/proposals\/(\d+)$/);
  if (adminProposalPath && request.method === 'GET') return handleAdminProposal(request, adminProposalPath[1]);
  if (path === '/api/admin/song-revisions' && request.method === 'GET') return handleAdminSongRevisions(request);
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
