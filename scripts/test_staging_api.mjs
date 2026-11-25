#!/usr/bin/env node
// Contract test for the Cloudflare staging API. Run against local Wrangler:
//   npm run api:dev
//   npm run test:api
// Or against staging:
//   LABU_API_URL=https://api-staging.labu.lengkhawm.online npm run test:api
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const urlArg = process.argv.indexOf('--url');
const BASE = (urlArg >= 0 ? process.argv[urlArg + 1] : process.env.LABU_API_URL || 'http://127.0.0.1:8791').replace(/\/+$/, '');

function devVars() {
  const file = path.join(ROOT, 'workers/api/.dev.vars');
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const vars = devVars();
const email = process.env.LABU_TEST_EMAIL || vars.STAGING_ADMIN_EMAIL;
const password = process.env.LABU_TEST_PASSWORD || vars.STAGING_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Set LABU_TEST_EMAIL and LABU_TEST_PASSWORD, or create workers/api/.dev.vars');

let failed = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : ' — ' + detail}`);
  if (!condition) failed++;
}

async function req(pathname, options = {}) {
  const response = await fetch(BASE + pathname, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, headers: response.headers, body };
}

const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const firstPayload = { id: `api_test_${unique}`, cat: 'B&P', op: 'update', song: { id: `api_test_${unique}`, title: 'API Test Hymn', verses: [] } };

const health = await req('/api/health');
check('health endpoint responds', health.status === 200 && health.body?.ok === true, JSON.stringify(health.body));

const initial = await req('/api/state');
check('state endpoint returns a version', initial.status === 200 && Number.isInteger(initial.body?.version), JSON.stringify(initial.body));

const edits = await req('/api/published-edits');
check('published overlay is an array', edits.status === 200 && Array.isArray(edits.body));
check('published overlay preserves imported seq/kind/payload', edits.body?.length > 0 && Number.isInteger(edits.body[0].seq) && typeof edits.body[0].payload === 'object');
const since = edits.body?.length ? edits.body[edits.body.length - 1].seq : 0;
const sinceCheck = await req(`/api/published-edits?since=${since}`);
check('overlay supports a seq cursor', sinceCheck.status === 200 && Array.isArray(sinceCheck.body) && sinceCheck.body.length === 0);

const preflight = await fetch(BASE + '/api/proposals', {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://labu.lengkhawm.online',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  },
});
check('CORS preflight allows the Pages origin', preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === 'https://labu.lengkhawm.online');

const noAuth = await req('/api/admin/me');
check('admin route rejects anonymous requests', noAuth.status === 401, String(noAuth.status));

// Review data is moderation data: every new read route must reject anonymous
// callers before it touches the database.
const anonymousReviewRoutes = await Promise.all([
  req('/api/admin/proposals/counts'),
  req('/api/admin/proposals/1'),
  req('/api/admin/song-revisions?id=anything'),
]);
check('anonymous callers cannot read review details, counts or history',
  anonymousReviewRoutes.every(response => response.status === 401),
  anonymousReviewRoutes.map(response => response.status).join(','));

const publicSignup = await req('/api/auth/sign-up/email', {
  method: 'POST',
  body: JSON.stringify({ email: `test-${unique}@example.com`, password: 'not-allowed-password', name: 'Test' }),
});
check('public sign-up is closed', publicSignup.status === 403, String(publicSignup.status));

const badSetup = await req('/api/setup/migrate', {
  method: 'POST',
  headers: { 'x-setup-token': 'wrong-token' },
  body: '{}',
});
check('setup endpoint rejects a bad token', badSetup.status === 404, String(badSetup.status));

const unsafeProposal = await req('/api/proposals', {
  method: 'POST',
  body: JSON.stringify({
    kind: 'song',
    payload: {
      id: `api_bad_${unique}`,
      cat: 'B&P',
      op: 'update',
      song: { id: `api_bad_${unique}' onmouseover='alert(1)`, title: 'Unsafe', verses: [] },
    },
    summary: 'unsafe ID must be rejected',
    name: 'contract-test',
  }),
});
check('unsafe proposal ID is rejected', unsafeProposal.status === 400, JSON.stringify(unsafeProposal.body));

const proposal = await req('/api/proposals', {
  method: 'POST',
  body: JSON.stringify({ kind: 'song', payload: firstPayload, summary: 'Staging API contract test', name: 'contract-test' }),
});
check('anonymous proposal is accepted', proposal.status === 201 && Number.isInteger(proposal.body?.id), JSON.stringify(proposal.body));
const proposalId = proposal.body?.id;

const duplicate = await req('/api/proposals', {
  method: 'POST',
  body: JSON.stringify({ kind: 'song', payload: firstPayload, summary: 'duplicate', name: 'contract-test' }),
});
check('identical pending proposal is deduplicated', duplicate.status === 200 && duplicate.body?.id === proposalId && duplicate.body?.duplicate === true, JSON.stringify(duplicate.body));

const signIn = await req('/api/auth/sign-in/email', {
  method: 'POST',
  headers: { Origin: 'https://labu.lengkhawm.online' },
  body: JSON.stringify({ email, password }),
});
check('admin email/password sign-in succeeds', signIn.status === 200, String(signIn.status));
check('sign-in does not expose a bearer token', !signIn.headers.get('set-auth-token'));

const setCookies = signIn.headers.getSetCookie ? signIn.headers.getSetCookie() : [signIn.headers.get('set-cookie')].filter(Boolean);
const sessionCookie = setCookies.find(cookie => /session/i.test(cookie));
check('sign-in sets an HttpOnly secure session cookie',
  !!sessionCookie && /HttpOnly/i.test(sessionCookie) && /Secure/i.test(sessionCookie) && /SameSite=None/i.test(sessionCookie),
  sessionCookie || 'no session cookie');
const cookieHeader = setCookies.map(cookie => cookie.split(';')[0]).join('; ');
if (!cookieHeader) process.exit(1);

const authHeaders = { Cookie: cookieHeader };
const me = await req('/api/admin/me', { headers: authHeaders });
check('admin session cookie is authorized', me.status === 200 && me.body?.isAdmin === true, JSON.stringify(me.body));

const queue = await req('/api/admin/proposals', { headers: authHeaders });
check('admin can read the pending queue', queue.status === 200 && queue.body?.some(row => row.id === proposalId), JSON.stringify(queue.body).slice(0, 200));

const detail = await req(`/api/admin/proposals/${proposalId}`, { headers: authHeaders });
check('proposal detail returns the patch and its revision fingerprint',
  detail.status === 200 && detail.body?.payload?.id === firstPayload.id
  && detail.body?.target === firstPayload.id && 'base_rev' in (detail.body || {}),
  JSON.stringify(detail.body).slice(0, 200));

const counts = await req('/api/admin/proposals/counts', { headers: authHeaders });
check('queue counters report each status',
  counts.status === 200 && Number.isInteger(counts.body?.pending) && Number.isInteger(counts.body?.approved)
  && Number.isInteger(counts.body?.rejected), JSON.stringify(counts.body));

const filtered = await req('/api/admin/proposals?status=rejected', { headers: authHeaders });
check('queue can be filtered by status', filtered.status === 200 && Array.isArray(filtered.body)
  && filtered.body.every(row => row.status === 'rejected'), JSON.stringify(filtered.body).slice(0, 160));

// Stale submissions: a song edited after the submission must not be overwritten.
const staleId = `api_stale_${unique}`;
const stalePayload = { id: staleId, cat: 'B&P', op: 'update', song: { id: staleId, title: 'Stale Base', verses: [{ type: 'v', lines: ['original line'] }] } };
const staleProposal = await req('/api/proposals', {
  method: 'POST',
  body: JSON.stringify({ kind: 'song', payload: stalePayload, summary: 'stale candidate', name: 'contract-test' }),
});
check('proposal for the staleness test is queued', staleProposal.status === 201, JSON.stringify(staleProposal.body));
const directEdit = await req('/api/admin/publish', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({
    kind: 'song',
    payload: { ...stalePayload, song: { ...stalePayload.song, title: 'Stale Base edited later' } },
  }),
});
check('admin direct edit publishes for the staleness test', directEdit.status === 200, JSON.stringify(directEdit.body));
const staleApprove = await req('/api/admin/approve', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ ids: [staleProposal.body.id] }),
});
check('approving a stale submission is refused', staleApprove.status === 409, JSON.stringify(staleApprove.body));
const staleQueue = await req(`/api/admin/proposals/${staleProposal.body.id}`, { headers: authHeaders });
check('a refused stale submission stays pending', staleQueue.status === 200 && staleQueue.body?.status === 'pending',
  JSON.stringify(staleQueue.body?.status));

const staleReject = await req('/api/admin/reject', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ ids: [staleProposal.body.id], note: 'superseded by a later edit' }),
});
check('a stale submission can still be rejected', staleReject.status === 200 && staleReject.body?.rejected === 1,
  JSON.stringify(staleReject.body));
const staleHistory = await req(`/api/admin/song-revisions?id=${staleId}`, { headers: authHeaders });
check('song history carries published revisions and the rejection reason',
  staleHistory.status === 200
  && staleHistory.body?.published?.some(row => row.payload?.song?.title === 'Stale Base edited later')
  && staleHistory.body?.reviewed?.some(row => row.status === 'rejected' && /superseded/.test(row.note || '')),
  JSON.stringify(staleHistory.body).slice(0, 240));

const beforeApprove = (await req('/api/state')).body.version;
const approve = await req('/api/admin/approve', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ ids: [proposalId] }),
});
check('admin can approve a proposal', approve.status === 200 && approve.body?.approved === 1, JSON.stringify(approve.body));
check('approval advances the publish version', approve.body?.version === beforeApprove + 1, `${beforeApprove} -> ${approve.body?.version}`);
const secondApprove = await req('/api/admin/approve', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ ids: [proposalId] }),
});
check('already-approved proposal cannot be approved twice', secondApprove.status === 409, String(secondApprove.status));

const afterApprove = await req('/api/published-edits');
const publishedRow = afterApprove.body?.find(row => row.payload?.id === firstPayload.id);
check('approved payload is present in the public overlay', !!publishedRow, JSON.stringify(afterApprove.body?.slice(-2)));

const rejectPayload = { id: `api_reject_${unique}`, cat: 'B&P', op: 'update', song: { id: `api_reject_${unique}`, title: 'Rejected Test Hymn', verses: [] } };
const rejectProposal = await req('/api/proposals', {
  method: 'POST',
  body: JSON.stringify({ kind: 'song', payload: rejectPayload, summary: 'reject me', name: 'contract-test' }),
});
const beforeRejectVersion = (await req('/api/state')).body.version;
const reject = await req('/api/admin/reject', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ ids: [rejectProposal.body.id], note: 'contract test' }),
});
check('admin can reject a proposal', reject.status === 200 && reject.body?.rejected === 1, JSON.stringify(reject.body));
const afterRejectVersion = (await req('/api/state')).body.version;
check('rejection does not publish or bump the version', afterRejectVersion === beforeRejectVersion, `${beforeRejectVersion} -> ${afterRejectVersion}`);

// Rate-limit the test client last, after the functional checks. Cloudflare
// overwrites cf-connecting-ip at the edge (and blocks spoofing), so only the
// local Wrangler server can use a dedicated test IP.
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
// Local D1 keeps rate_limits between runs; a fresh test IP keeps this probe isolated
// from an earlier invocation in the same minute.
const rateIp = '203.0.113.' + (1 + Math.floor(Math.random() * 250));
const rateHeaders = isLocal ? { 'cf-connecting-ip': rateIp } : {};
const rateIds = [];
for (let i = 0; i < 21; i++) {
  const response = await req('/api/proposals', {
    method: 'POST',
    headers: rateHeaders,
    body: JSON.stringify({
      kind: 'song',
      payload: { id: `rate_${unique}_${i}`, cat: 'B&P', op: 'update', song: { id: `rate_${unique}_${i}`, title: 'Rate Test', verses: [] } },
      summary: 'rate limit test',
    }),
  });
  if (response.status === 201) rateIds.push(response.body.id);
  if (i === 20) check('proposal rate limit returns 429', response.status === 429, String(response.status));
}
if (rateIds.length) {
  const cleanup = await req('/api/admin/reject', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ ids: rateIds, note: 'rate limit cleanup' }),
  });
  check('rate-limit test proposals can be cleaned up', cleanup.status === 200, JSON.stringify(cleanup.body));
}

const corsResponse = await fetch(BASE + '/api/state', { headers: { Origin: 'https://labu.lengkhawm.online' } });
check('actual API responses carry the CORS origin', corsResponse.headers.get('access-control-allow-origin') === 'https://labu.lengkhawm.online');
check('actual API responses disable caching', corsResponse.headers.get('cache-control') === 'no-store');

const signOut = await req('/api/auth/sign-out', {
  method: 'POST',
  headers: { ...authHeaders, Origin: 'https://labu.lengkhawm.online' },
  body: '{}',
});
check('admin sign-out succeeds', signOut.status === 200, JSON.stringify(signOut.body));
const afterSignOut = await req('/api/admin/me', { headers: authHeaders });
check('old session cookie is rejected after sign-out', afterSignOut.status === 401, String(afterSignOut.status));

console.log(failed ? `\n${failed} API TEST(S) FAILED` : '\nAPI TESTS PASSED');
process.exit(failed ? 1 : 0);
