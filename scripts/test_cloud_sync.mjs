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
  // HD solfa lives on R2; keep this suite off the network.
  await page.route('https://dl.labu.lengkhawm.online/**', route => route.abort());
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  let version = 1;
  const published = [PUBLISHED];
  const proposals = [{ ...PROPOSAL }];
  const submitted = [];
  const calls = [];
  const authCalls = [];
  const passwordChanges = [];
  const newAdmins = [];
  const adminPasswordSets = [];
  const adminDeletes = [];
  let adminDirectory = [
    { id: 'u1', name: 'Owner', login: 'minatolun@gmail.com', email: 'minatolun@gmail.com', username: '', isOwner: true, isSelf: false },
    { id: 'u2', name: 'Second Admin', login: '@secondadmin', email: '', username: 'secondadmin', isOwner: false, isSelf: false },
    { id: 'u3', name: 'Old Admin', login: 'old@example.com', email: 'old@example.com', username: '', isOwner: false, isSelf: false },
  ];
  let sessionEmail = 'minatolun@gmail.com';

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

    if (path === '/api/login') {
      // Mirrors the Worker: a username resolves to the account behind it.
      const login = String(body().login || '').toLowerCase();
      await new Promise(r => setTimeout(r, 120));
      if (login === 'secondadmin' || login === '@secondadmin') sessionEmail = 'second@example.com';
      else if (login === 'minatolun@gmail.com') sessionEmail = login;
      else return json({ error: 'Invalid email or password' }, 401);
      return json({ user: { id: 'u1', email: sessionEmail, login: login } }, 200, {
        'set-cookie': 'better-auth.session_token=admin-token; Path=/; HttpOnly; Secure; SameSite=None',
      });
    }
    if (path === '/api/auth/sign-out') {
      await new Promise(r => setTimeout(r, 120));
      return json({ success: true }, 200, {
        'set-cookie': 'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None',
      });
    }
    if (path === '/api/auth/change-password') {
      passwordChanges.push(body());
      return json({ status: true });
    }
    if (path === '/api/admin/users' && req.method() === 'GET') {
      if (sessionEmail !== 'minatolun@gmail.com') return json({ error: 'only the main admin can manage admins' }, 403);
      return json({ admins: adminDirectory.map(a => ({ ...a, isSelf: a.login === sessionEmail })) });
    }
    if (path.startsWith('/api/admin/users/') && req.method() === 'DELETE') {
      if (sessionEmail !== 'minatolun@gmail.com') return json({ error: 'only the main admin can manage admins' }, 403);
      const id = path.split('/').pop();
      adminDeletes.push(id);
      adminDirectory = adminDirectory.filter(a => a.id !== id);
      return json({ removed: true, id });
    }
    if (/\/api\/admin\/users\/[^/]+\/password$/.test(path)) {
      if (sessionEmail !== 'minatolun@gmail.com') return json({ error: 'only the main admin can manage admins' }, 403);
      adminPasswordSets.push({ id: path.split('/').at(-2), password: body().newPassword });
      return json({ updated: true });
    }
    if (path === '/api/admin/users') {
      if (sessionEmail !== 'minatolun@gmail.com') return json({ error: 'only the main admin can manage admins' }, 403);
      newAdmins.push(body());
      return json({ created: true, id: 'u4', login: body().username ? '@' + body().username : body().email }, 201);
    }
    if (path === '/api/admin/me') return isAdmin
      ? json({
        isAdmin: true,
        canCreateAdmin: sessionEmail === 'minatolun@gmail.com',
        user: {
          id: 'u1',
          email: sessionEmail === 'minatolun@gmail.com' ? sessionEmail : '',
          login: sessionEmail === 'minatolun@gmail.com' ? sessionEmail : '@secondadmin',
          isOwner: sessionEmail === 'minatolun@gmail.com',
          canCreateAdmin: sessionEmail === 'minatolun@gmail.com',
        },
      })
      : json({ error: 'authentication required' }, 401);
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
      hqSafe: solfaHdUrl('javascript:alert(1)') === '' && solfaHdUrl('https://evil.test/x.avif') === ''
        && solfaHdUrl('assets/solfa/BL_1.avif') === SOLFA_HD_BASE + 'BL_1.avif',
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
  check('HD solfa URLs are built only from bundled sheets', guard.hqSafe);
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

  // 3. Admin signs in on the Admin account page, changes password, adds an admin, approves.
  await page.evaluate(() => localStorage.setItem('labu_cloud_session', JSON.stringify({ access_token: 'old-token' })));
  await page.evaluate(() => openAdmin());
  const manageState = await page.evaluate(() => ({
    panel: !!document.querySelector('#adminView #cloudPanel'),
    sync: [...document.querySelectorAll('#adminView button')].some(b => /Sync now/.test(b.textContent)),
  }));
  check('Manage Songs no longer contains the song sync panel', !manageState.panel && !manageState.sync, JSON.stringify(manageState));

  await page.evaluate(() => openAdminAccount());
  await page.waitForFunction(() =>
    document.getElementById('adminAccountBody')?.textContent.includes('Admin sign in'), null, { timeout: 10000 });
  await page.fill('#adminAccountLogin', 'minatolun@gmail.com');
  await page.fill('#adminAccountPass', 'secret');
  await page.click('#adminAccountSignInBtn');
  check('sign-in button shows a spinner while the session starts',
    await page.waitForFunction(() => {
      const btn = document.getElementById('adminAccountSignInBtn');
      return !!btn && btn.classList.contains('is-busy') && !!btn.querySelector('.btn-spinner');
    }, null, { timeout: 2000 }).then(() => true).catch(() => false));
  await page.waitForFunction(() => {
    const el = document.getElementById('cloudPanel');
    return el && el.textContent.includes('Review queue');
  }, null, { timeout: 10000 });
  check('admin account page signs in and owns the review queue', true);
  check('pending proposal is listed on the admin page', (await page.textContent('#cloudPanel')).includes('Pending Hymn'));
  check('admin page no longer links back to Manage Songs',
    !(await page.textContent('#adminAccountBody')).includes('Manage Songs'));
  const syncCard = page.locator('#cloudPanel');
  check('song sync hides the account email', !(await syncCard.textContent()).includes('minatolun@gmail.com'));
  check('song sync has no sign-out button',
    (await page.locator('#cloudPanel [data-action="cloudSignOut"]').count()) === 0);
  check('song sync shows Sync now and History',
    JSON.stringify(await page.locator('#cloudPanel .cloud-bar button').allTextContents()) === JSON.stringify(['Sync now', 'History']));
  check('owner sees the Add another admin control',
    await page.locator('#adminAccountBody [data-action="openAdminAddAdminModal"]').isVisible());
  const cardGap = await page.evaluate(() => {
    const cards = document.querySelectorAll('#adminAccountBody .glass-card');
    if (cards.length < 2) return -1;
    return Math.round(cards[1].getBoundingClientRect().top - cards[0].getBoundingClientRect().bottom);
  });
  check('admin cards have space between them', cardGap >= 12, String(cardGap));
  check('cloud session is not persisted in localStorage',
    await page.evaluate(() => localStorage.getItem('labu_cloud_session') === null));

  await page.click('[data-action="openAdminPasswordModal"]');
  await page.waitForSelector('#adminPasswordModal.open');
  await page.fill('#adminCurrentPass', 'old-secret-123');
  await page.fill('#adminNewPass', 'new-secret-456');
  await page.fill('#adminConfirmPass', 'new-secret-456');
  await page.click('#adminChangeBtn');
  await page.waitForFunction(() =>
    document.getElementById('adminAccountMsg')?.textContent.includes('Password updated'), null, { timeout: 10000 });
  check('admin can change its own password in a popup',
    passwordChanges.length === 1 && passwordChanges[0].currentPassword === 'old-secret-123'
      && passwordChanges[0].newPassword === 'new-secret-456');
  check('password popup closes after updating', !(await page.locator('#adminPasswordModal').evaluate(el => el.classList.contains('open'))));

  await page.click('[data-action="openAdminAddAdminModal"]');
  await page.waitForSelector('#adminAddAdminModal.open');
  await page.fill('#adminAddName', 'Second Admin');
  await page.fill('#adminAddUsername', 'secondadmin');
  await page.fill('#adminAddPass', 'another-secret-789');
  await page.fill('#adminAddConfirm', 'another-secret-789');
  await page.click('#adminCreateAdminBtn');
  await page.waitForFunction(() =>
    document.getElementById('adminAccountMsg')?.textContent.includes('secondadmin'), null, { timeout: 10000 });
  check('owner can create an admin from a username alone',
    newAdmins.length === 1 && newAdmins[0].username === 'secondadmin'
      && newAdmins[0].email === '' && newAdmins[0].name === 'Second Admin', JSON.stringify(newAdmins));
  check('add admin popup closes after creating', !(await page.locator('#adminAddAdminModal').evaluate(el => el.classList.contains('open'))));

  // Owner can see every admin, reset a password and remove an account.
  check('owner sees the Manage admins control',
    await page.locator('#adminAccountBody [data-action="openAdminManageModal"]').isVisible());
  await page.click('[data-action="openAdminManageModal"]');
  await page.waitForSelector('#adminManageModal.open');
  await page.waitForFunction(() =>
    document.querySelectorAll('#adminManageList .admin-row').length === 3, null, { timeout: 10000 });
  check('manage admins lists the owner, the new admin and the old admin',
    (await page.textContent('#adminManageList')).includes('@secondadmin'));
  const ownerRowButtons = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#adminManageList .admin-row')]
      .find(r => r.textContent.includes('Minatolun') || r.textContent.includes('minatolun@gmail.com'));
    return row ? row.querySelectorAll('[data-action="adminDeleteUser"]').length : -1;
  });
  check('the main admin cannot delete itself from the list', ownerRowButtons === 0, String(ownerRowButtons));

  await page.locator('#adminManageList [data-action="adminOpenSetPass"][data-user-id="u3"]').click();
  await page.waitForSelector('#adminSetPassModal.open');
  await page.fill('#adminSetPassNew', 'third-secret-456');
  await page.fill('#adminSetPassConfirm', 'third-secret-456');
  await page.click('#adminSetPassBtn');
  await page.waitForFunction(() =>
    document.getElementById('adminAccountMsg')?.textContent.includes('old@example.com'), null, { timeout: 10000 });
  check('main admin can set another admin password',
    adminPasswordSets.length === 1 && adminPasswordSets[0].id === 'u3'
      && adminPasswordSets[0].password === 'third-secret-456', JSON.stringify(adminPasswordSets));
  check('set password popup closes after saving',
    !(await page.locator('#adminSetPassModal').evaluate(el => el.classList.contains('open'))));

  await page.locator('#adminManageList [data-action="adminDeleteUser"][data-user-id="u3"]').click();
  await page.waitForSelector('#confirmModal.open');
  await page.click('#confirmBtn');
  await page.waitForFunction(() =>
    document.querySelectorAll('#adminManageList .admin-row').length === 2, null, { timeout: 10000 });
  check('main admin can delete another admin', adminDeletes.length === 1 && adminDeletes[0] === 'u3', JSON.stringify(adminDeletes));
  await page.locator('#adminManageModal [data-action="closeModal"]').last().click();
  await page.waitForFunction(() => !document.getElementById('adminManageModal').classList.contains('open'));

  await page.locator('.cloud-item .btn-primary').first().click();
  await page.waitForFunction(() =>
    SONGS['B&P'].songs.some(s => s.id === 'cloud_admin_approved'), null, { timeout: 10000 });
  check('approving publishes the edit and syncs this device', true);
  check('admin approve endpoint was called', calls.filter(c => c === 'POST /api/admin/approve').length === 1);
  const queueEmptied = await page.waitForFunction(() =>
    document.getElementById('cloudPanel').textContent.includes('Nothing waiting'), null, { timeout: 10000 })
    .then(() => true).catch(() => false);
  check('queue empties after approval', queueEmptied);

  await page.locator('#cloudPanel [data-action="openSyncHistory"]').click();
  await page.waitForSelector('#syncHistoryModal.open');
  check('history popup lists the approved change',
    (await page.textContent('#syncHistoryList')).includes('Pending Hymn'));
  check('history popup has no footer button',
    (await page.locator('#syncHistoryModal .modal-footer').count()) === 0);
  await page.locator('#syncHistoryModal [data-action="closeModal"]').last().click();

  await page.locator('#adminAccountBody [data-action="adminAccountSignOut"]').click();
  check('sign-out shows a spinner while it revokes the session',
    await page.waitForFunction(() => {
      const btn = document.querySelector('#adminAccountBody [data-action="adminAccountSignOut"]');
      return !!btn && btn.classList.contains('is-busy') && !!btn.querySelector('.btn-spinner');
    }, null, { timeout: 2000 }).then(() => true).catch(() => false));
  await page.waitForFunction(() =>
    document.getElementById('adminAccountBody')?.textContent.includes('Admin sign in'), null, { timeout: 10000 });
  check('sign-out sends the session cookie to the API', authCalls.some(call => call.startsWith('/api/auth/sign-out:') && call.includes('better-auth.session_token=admin-token')), authCalls.slice(-4).join(' | '));

  await page.fill('#adminAccountLogin', 'secondadmin');
  await page.fill('#adminAccountPass', 'another-secret-789');
  await page.click('#adminAccountSignInBtn');
  await page.waitForFunction(() => {
    const el = document.getElementById('cloudPanel');
    return el && el.textContent.includes('Review queue');
  }, null, { timeout: 10000 });
  check('an admin can sign in with a username instead of an email',
    (await page.textContent('#adminAccountBody')).includes('@secondadmin'));
  check('other admins cannot see the Add another admin control',
    (await page.locator('#adminAccountBody [data-action="openAdminAddAdminModal"]').count()) === 0);
  check('other admins cannot see the Manage admins control',
    (await page.locator('#adminAccountBody [data-action="openAdminManageModal"]').count()) === 0);

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
