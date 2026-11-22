// Verifies the approved-change sync loop against a mocked Supabase project:
//   1. an approved edit in the published layer appears on a device that has none
//   2. a normal device's local edit is submitted as a pending proposal
//   3. an admin can sign in, see the queue, approve it, and the device re-syncs
// Run: node scripts/test_cloud_sync.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html', '.json': 'application/json', '.gzip': 'application/gzip',
  '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
  '.avif': 'image/avif',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE_URL = `http://localhost:${server.address().port}/`;

const song = (id, title) => ({
  id, title, author: 'Test', number: '999', key: 'G',
  verses: [{ type: 'v', lines: ['A line of the approved hymn'] }],
});
const PUBLISHED = {
  seq: 1, kind: 'song',
  payload: { id: 'cloud_base_approved', cat: 'B&P', op: 'update', song: song('cloud_base_approved', 'Cloud Approved Hymn') },
};
const PROPOSAL = {
  id: 7, kind: 'song', status: 'pending', submitter_name: 'tester',
  created_at: new Date().toISOString(), summary: 'Edit “Pending Hymn”',
  payload: { id: 'cloud_admin_approved', cat: 'B&P', op: 'update', song: song('cloud_admin_approved', 'Pending Hymn') },
};

const browser = await chromium.launch();
let failed = false;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : ' — ' + detail}`);
  if (!condition) failed = true;
};

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  let version = 1;
  const published = [PUBLISHED];
  const proposals = [{ ...PROPOSAL }];
  const submitted = [];
  const calls = [];

  await page.route('https://mock.supabase.co/**', async route => {
    const req = route.request();
    const url = new globalThis.URL(req.url());
    const path = url.pathname;
    const isAdmin = (req.headers()['authorization'] || '') === 'Bearer admin-token';
    calls.push(req.method() + ' ' + path);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; } };

    if (path === '/rest/v1/publish_state') return json([{ version }]);
    if (path === '/rest/v1/published_edits') return json(published);
    if (path === '/rest/v1/rpc/am_i_admin') return json(isAdmin);
    if (path === '/auth/v1/token') {
      return json({ access_token: 'admin-token', refresh_token: 'refresh', expires_in: 3600, user: { id: 'u1', email: 'admin@example.com' } });
    }
    if (path === '/rest/v1/proposals') {
      return json(isAdmin ? proposals.filter(p => p.status === 'pending') : []);
    }
    if (path === '/rest/v1/rpc/submit_proposal') { submitted.push(body()); return json(1); }
    if (path === '/rest/v1/rpc/publish_edit') {
      const b = body();
      published.push({ seq: published.length + 1, kind: b.p_kind, payload: b.p_payload });
      version += 1;
      return json(version);
    }
    if (path === '/rest/v1/rpc/approve_proposals') {
      body().p_ids.forEach(id => {
        const p = proposals.find(x => x.id === id);
        if (p && p.status === 'pending') {
          p.status = 'approved';
          published.push({ seq: published.length + 1, kind: p.kind, payload: p.payload });
        }
      });
      version += 1;
      return json(version);
    }
    if (path === '/rest/v1/rpc/reject_proposals') return json(1);
    return json({}, 404);
  });

  await page.addInitScript(() => {
    window.LABU_SUPABASE = { url: 'https://mock.supabase.co', anonKey: 'anon-key' };
  });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof songsReady !== 'undefined' && songsReady === true, null, { timeout: 30000 });

  // 1. Published layer applied over the base corpus.
  const hasPublished = await page.evaluate(() =>
    SONGS['B&P'].songs.some(s => s.id === 'cloud_base_approved'));
  check('approved edit from the cloud layer appears in the corpus', hasPublished);
  check('published layer version was cached', await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('labu_pub_cache') || 'null');
    return !!c && c.version === 1 && c.edits.length === 1;
  }));

  // 2. A normal device's edit becomes a pending proposal.
  await page.evaluate(async () => {
    const song = {
      id: 'local_pending_hymn', title: 'Local Pending Hymn', author: '', number: '998',
      key: 'C', verses: [{ type: 'v', lines: ['local line'] }],
    };
    SONGS['B&P'].songs.push(song);
    await recordEdit('B&P', song, 'update');
  });
  for (let i = 0; i < 60 && submitted.length === 0; i++) await page.waitForTimeout(100);
  check('local edit is submitted as a proposal', submitted.length === 1, 'submissions=' + submitted.length);
  check('proposal carries the edit payload', submitted[0] && submitted[0].p_payload && submitted[0].p_payload.id === 'local_pending_hymn');
  // Submission is silent by design: the device already shows its own change, so the
  // user must not be told their edit went to an admin for review.
  const reviewToasts = await page.evaluate(() =>
    [...document.querySelectorAll('.toast')].map(t => t.textContent).filter(t => /review|submit/i.test(t)));
  check('no review toast is shown to the submitting device', reviewToasts.length === 0, reviewToasts.join(' | '));

  // 3. Admin signs in, sees the queue, approves.
  await page.evaluate(() => openAdmin());
  await page.waitForFunction(() => {
    const el = document.getElementById('cloudPanel');
    return el && !el.hidden && el.textContent.includes('Admin sign in');
  }, null, { timeout: 10000 });
  check('manage songs shows the admin sign-in row', true);

  await page.locator('#cloudPanel button', { hasText: 'Admin sign in' }).click();
  await page.fill('#cloudEmail', 'admin@example.com');
  await page.fill('#cloudPass', 'secret');
  await page.click('#cloudSignInBtn');
  await page.waitForFunction(() => {
    const el = document.getElementById('cloudPanel');
    return el && el.textContent.includes('Review queue');
  }, null, { timeout: 10000 });
  check('signed-in admin sees the review queue', true);
  check('pending proposal is listed', (await page.textContent('#cloudPanel')).includes('Pending Hymn'));

  await page.locator('.cloud-item .btn-primary').first().click();
  await page.waitForFunction(() =>
    SONGS['B&P'].songs.some(s => s.id === 'cloud_admin_approved'), null, { timeout: 10000 });
  check('approving publishes the edit and syncs this device', true);
  check('approve RPC was called', calls.filter(c => c.includes('approve_proposals')).length === 1);
  const queueEmptied = await page.waitForFunction(() =>
    document.getElementById('cloudPanel').textContent.includes('Nothing waiting'), null, { timeout: 10000 })
    .then(() => true).catch(() => false);
  check('queue empties after approval', queueEmptied);
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await new Promise(r => setTimeout(r, 300));
} finally {
  await browser.close();
  server.close();
}

console.log(failed ? '\nCLOUD SYNC TESTS FAILED' : '\nCLOUD SYNC TESTS PASSED');
process.exit(failed ? 1 : 0);
