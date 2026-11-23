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
const firstPayload = { id: `api_test_${unique}`, cat: 'B&P', op: 'update', song: { id: `api_test_${unique}`, title: 'API Test Hymn' } };

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
const bearer = signIn.headers.get('set-auth-token');
check('admin email/password sign-in succeeds', signIn.status === 200 && !!bearer, String(signIn.status));
check('bearer token header is exposed to CORS clients', signIn.headers.get('access-control-expose-headers')?.includes('set-auth-token') === true);
if (!bearer) process.exit(1);

const authHeaders = { Authorization: `Bearer ${bearer}` };
const me = await req('/api/admin/me', { headers: authHeaders });
check('admin session is authorized', me.status === 200 && me.body?.isAdmin === true, JSON.stringify(me.body));

const queue = await req('/api/admin/proposals', { headers: authHeaders });
check('admin can read the pending queue', queue.status === 200 && queue.body?.some(row => row.id === proposalId), JSON.stringify(queue.body).slice(0, 200));

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

const rejectPayload = { id: `api_reject_${unique}`, cat: 'B&P', op: 'update', song: { id: `api_reject_${unique}`, title: 'Rejected Test Hymn' } };
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
const rateHeaders = isLocal ? { 'cf-connecting-ip': '203.0.113.250' } : {};
const rateIds = [];
for (let i = 0; i < 21; i++) {
  const response = await req('/api/proposals', {
    method: 'POST',
    headers: rateHeaders,
    body: JSON.stringify({
      kind: 'song',
      payload: { id: `rate_${unique}_${i}`, cat: 'B&P', op: 'update', song: { id: `rate_${unique}_${i}`, title: 'Rate Test' } },
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

console.log(failed ? `\n${failed} API TEST(S) FAILED` : '\nAPI TESTS PASSED');
process.exit(failed ? 1 : 0);
