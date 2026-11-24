// Verifies the approved-change sync loop against a mocked Worker API:
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
  created_at: Date.now(), summary: 'Edit “Pending Hymn”',
  payload: { id: 'cloud_admin_approved', cat: 'B&P', op: 'update', song: song('cloud_admin_approved', 'Pending Hymn') },
};

const browser = await chromium.launch();
let failed = false;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : ' — ' + detail}`);
  if (!condition) failed = true;
};

const indexSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const headersSource = fs.readFileSync(path.join(ROOT, 'pages', '_headers'), 'utf8');
const scriptSrc = (headersSource.match(/script-src[^;]*/) || [''])[0];
check('HTML has no inline event handlers', !/\son(?:click|input|change|keydown|keyup|submit)\s*=/i.test(indexSource));
check('HTML has no inline style attributes or style blocks', !/\sstyle=/.test(indexSource) && !/<style[\s>]/i.test(indexSource));
check('app script has no inline style attributes', !/\sstyle=/.test(appSource));
check('app shell loads an external script and stylesheet', /<script src="app\.js"><\/script>/.test(indexSource) && /<link rel="stylesheet" href="styles\.css">/.test(indexSource));
check('Pages CSP disallows inline scripts', !scriptSrc.includes("'unsafe-inline'") && headersSource.includes("script-src-attr 'none'"), scriptSrc);
check('Pages CSP disallows inline styles', !/style-src\s+[^;]*'unsafe-inline'/.test(headersSource) && headersSource.includes("style-src-attr 'none'"), headersSource);

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  let version = 1;
  const published = [PUBLISHED];
  const proposals = [{ ...PROPOSAL }];
  const submitted = [];
  const calls = [];
  const authCalls = [];

  await page.route('https://mock.labu.api/**', async route => {
    const req = route.request();
    const url = new globalThis.URL(req.url());
    const path = url.pathname;
    const cookie = req.headers()['cookie'] || '';
    const isAdmin = /(?:^|;\s*)better-auth\.session_token=admin-token(?:;|$)/.test(cookie);
    calls.push(req.method() + ' ' + path);
    authCalls.push(path + ':' + cookie);
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
    const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; } };

    if (path === '/api/auth/sign-in/email') {
      return json({ user: { id: 'u1', email: 'admin@example.com' } }, 200, {
        'set-cookie': 'better-auth.session_token=admin-token; Path=/; HttpOnly; Secure; SameSite=None',
      });
    }
    if (path === '/api/auth/sign-out') return json({ success: true }, 200, {
      'set-cookie': 'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None',
    });
    if (path === '/api/admin/me') return isAdmin ? json({ isAdmin: true, user: { id: 'u1', email: 'admin@example.com' } }) : json({ error: 'authentication required' }, 401);
    if (path === '/api/state') return json({ version });
    if (path === '/api/published-edits') return json(published);
    if (path === '/api/admin/proposals') return isAdmin ? json(proposals.filter(p => p.status === 'pending')) : json({ error: 'admin access required' }, 403);
    if (path === '/api/proposals') {
      const b = body();
      submitted.push(b);
      return json({ id: 1, duplicate: false }, 201);
    }
    if (path === '/api/admin/publish') {
      const b = body();
      published.push({ seq: published.length + 1, kind: b.kind, payload: b.payload });
      version += 1;
      return json({ version });
    }
    if (path === '/api/admin/approve') {
      body().ids.forEach(id => {
        const p = proposals.find(x => x.id === id);
        if (p && p.status === 'pending') {
          p.status = 'approved';
          published.push({ seq: published.length + 1, kind: p.kind, payload: p.payload });
        }
      });
      version += 1;
      return json({ version, approved: body().ids.length });
    }
    if (path === '/api/admin/reject') {
      body().ids.forEach(id => {
        const p = proposals.find(x => x.id === id);
        if (p) p.status = 'rejected';
      });
      return json({ rejected: body().ids.length });
    }
    return json({ error: 'not found' }, 404);
  });

  await page.addInitScript(() => {
    window.LABU_CLOUD_API = 'https://mock.labu.api';
  });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof songsReady !== 'undefined' && songsReady === true, null, { timeout: 30000 });

  // 1. Published layer applied over the base corpus.
  const hasPublished = await page.evaluate(() =>
    SONGS['B&P'].songs.some(s => s.id === 'cloud_base_approved'));
  check('approved edit from the cloud layer appears in the corpus', hasPublished);

  const guard = await page.evaluate(() => {
    const song = SONGS['B&P'].songs[0];
    const unsafeId = song.id + "' onmouseover='alert(1)";
    const rejected = !isSafeEdit({ id: song.id, cat: 'B&P', op: 'update', song: { ...song, id: unsafeId } });
    const menu = document.createElement('div');
    menu.innerHTML = readerMenuHTML({ ...song, id: unsafeId });
    const menuSafe = !menu.querySelector('[onclick], [onerror]') && !menu.innerHTML.includes('onmouseover');
    const key = document.createElement('div');
    key.innerHTML = keyMetaHTML('C" onmouseover="alert(1)');
    const unsafeSheet = { id: 'unsafe_sheet', solfa: 'javascript:alert(1)' };
    return {
      rejected,
      menuSafe,
      keySafe: !key.querySelector('[onmouseover]'),
      solfaSafe: !hasSolfa(unsafeSheet) && solfaSheets(unsafeSheet).length === 0
        && hasSolfa({ id: 'safe_sheet', solfa: 'assets/solfa/BL_1-t1.avif' }),
    };
  });
  check('unsafe cloud/backup song ID is rejected', guard.rejected);
  check('reader menu no longer builds inline song handlers', guard.menuSafe);
  check('key metadata escapes injected attributes', guard.keySafe);
  check('solfa paths are limited to local sheet assets', guard.solfaSafe);
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
  check('proposal carries the edit payload', submitted[0] && submitted[0].payload && submitted[0].payload.id === 'local_pending_hymn');
  // Submission is silent by design: the device already shows its own change, so the
  // user must not be told their edit went to an admin for review.
  const reviewToasts = await page.evaluate(() =>
    [...document.querySelectorAll('.toast')].map(t => t.textContent).filter(t => /review|submit/i.test(t)));
  check('no review toast is shown to the submitting device', reviewToasts.length === 0, reviewToasts.join(' | '));

  // 3. Admin signs in, sees the queue, approves.
  await page.evaluate(() => localStorage.setItem('labu_cloud_session', JSON.stringify({ access_token: 'old-token' })));
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
  check('cloud session is not persisted in localStorage',
    await page.evaluate(() => localStorage.getItem('labu_cloud_session') === null));

  await page.locator('.cloud-item .btn-primary').first().click();
  await page.waitForFunction(() =>
    SONGS['B&P'].songs.some(s => s.id === 'cloud_admin_approved'), null, { timeout: 10000 });
  check('approving publishes the edit and syncs this device', true);
  check('admin approve endpoint was called', calls.filter(c => c === 'POST /api/admin/approve').length === 1);
  const queueEmptied = await page.waitForFunction(() =>
    document.getElementById('cloudPanel').textContent.includes('Nothing waiting'), null, { timeout: 10000 })
    .then(() => true).catch(() => false);
  check('queue empties after approval', queueEmptied);

  await page.locator('#cloudPanel button', { hasText: 'Sign out' }).click();
  await page.waitForFunction(() =>
    document.getElementById('cloudPanel')?.textContent.includes('Admin sign in'), null, { timeout: 10000 });
  check('sign-out sends the session cookie to the API', authCalls.some(call => call.startsWith('/api/auth/sign-out:') && call.includes('better-auth.session_token=admin-token')), authCalls.slice(-4).join(' | '));

  const legacyGoogle = await page.evaluate(async () => {
    localStorage.setItem('labu_google_token', JSON.stringify('legacy-google-token'));
    const originalFetch = window.fetch;
    const urls = [];
    window.fetch = async url => { urls.push(String(url)); return { ok: true, text: async () => '' }; };
    try { await googleSignOut(); } finally { window.fetch = originalFetch; }
    return {
      cleared: !localStorage.getItem('labu_google_token'),
      revoked: urls.some(url => url.includes('legacy-google-token')),
    };
  });
  check('sign-out clears legacy Google token', legacyGoogle.cleared && legacyGoogle.revoked, JSON.stringify(legacyGoogle));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await new Promise(r => setTimeout(r, 300));
} finally {
  await browser.close();
  server.close();
}

console.log(failed ? '\nCLOUD SYNC TESTS FAILED' : '\nCLOUD SYNC TESTS PASSED');
process.exit(failed ? 1 : 0);
