// Cross-device regression for approved chord charts.
//   1. a normal device submits base + Tune 2 chord edits
//   2. an admin approves both
//   3. the admin device and a fresh device resolve and render the submitted charts
//      even though the song already has bundled charts in CHORD_CHARTS
// Run: node scripts/test_chord_sync.mjs
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

const state = { version: 0, published: [], proposals: [], nextId: 1 };
let sessionEmail = '';
const browser = await chromium.launch();
let failed = false;
const pageErrors = [];
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : ' — ' + detail}`);
  if (!condition) failed = true;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function mockApi(route) {
  const req = route.request();
  const pathname = new globalThis.URL(req.url()).pathname;
  const cookie = req.headers()['cookie'] || '';
  const isAdmin = /(?:^|;\s*)better-auth\.session_token=admin-token(?:;|$)/.test(cookie);
  const json = (body, status = 200, headers = {}) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(body), headers,
  });
  const body = () => {
    try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; }
  };

  if (pathname === '/api/login') {
    sessionEmail = String(body().login || '').toLowerCase();
    return json({ user: { id: 'admin-1', email: sessionEmail } }, 200, {
      'set-cookie': 'better-auth.session_token=admin-token; Path=/; HttpOnly; Secure; SameSite=None',
    });
  }
  if (pathname === '/api/auth/sign-out') {
    return json({ success: true }, 200, {
      'set-cookie': 'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None',
    });
  }
  if (pathname === '/api/admin/me') {
    return isAdmin
      ? json({ isAdmin: true, canCreateAdmin: true, user: { id: 'admin-1', email: sessionEmail } })
      : json({ error: 'authentication required' }, 401);
  }
  if (pathname === '/api/state') return json({ version: state.version, updated_at: Date.now() });
  if (pathname === '/api/published-edits') {
    return json(state.published.slice().sort((a, b) => a.seq - b.seq));
  }
  if (pathname === '/api/admin/proposals') {
    return isAdmin
      ? json(state.proposals.filter(p => p.status === 'pending'))
      : json({ error: 'admin access required' }, 403);
  }
  if (pathname === '/api/proposals') {
    const b = body();
    const p = {
      id: state.nextId++,
      kind: b.kind,
      payload: b.payload,
      summary: b.summary || '',
      submitter_name: b.name || 'test user',
      created_at: Date.now(),
      status: 'pending',
    };
    state.proposals.push(p);
    return json({ id: p.id, duplicate: false }, 201);
  }
  if (pathname === '/api/admin/approve') {
    if (!isAdmin) return json({ error: 'admin access required' }, 403);
    const ids = (body().ids || []).map(Number);
    const approved = [];
    for (const id of ids) {
      const p = state.proposals.find(x => x.id === id && x.status === 'pending');
      if (!p) return json({ error: 'proposal missing' }, 409);
      p.status = 'approved';
      state.published.push({
        seq: state.published.length + 1,
        kind: p.kind,
        payload: p.payload,
        published_at: Date.now(),
      });
      approved.push(p);
    }
    state.version += 1;
    return json({ version: state.version, approved: approved.length });
  }
  if (pathname === '/api/admin/reject') {
    if (!isAdmin) return json({ error: 'admin access required' }, 403);
    for (const id of (body().ids || []).map(Number)) {
      const p = state.proposals.find(x => x.id === id);
      if (p) p.status = 'rejected';
    }
    return json({ rejected: (body().ids || []).length });
  }
  if (pathname === '/api/admin/publish') {
    if (!isAdmin) return json({ error: 'admin access required' }, 403);
    const b = body();
    state.published.push({
      seq: state.published.length + 1,
      kind: b.kind,
      payload: b.payload,
      published_at: Date.now(),
    });
    state.version += 1;
    return json({ version: state.version });
  }
  return json({ error: 'not found' }, 404);
}

async function boot() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('https://mock.labu.api/**', mockApi);
  // HD solfa lives on R2; the reader upgrade is covered by e2e_full.
  await page.route('https://dl.labu.lengkhawm.online/**', r => r.abort());
  await page.addInitScript(() => { window.LABU_CLOUD_API = 'https://mock.labu.api'; });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof songsReady !== 'undefined' && songsReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => CHORD_CHARTS.BL_1 && CHORD_CHARTS.BL_1__t2, null, { timeout: 15000 });
  return { context, page };
}

async function openChordReader(page) {
  await page.evaluate(() => {
    const song = SONGS.BL.songs.find(s => s.id === 'BL_1');
    currentCat = 'BL';
    currentList = SONGS.BL.songs;
    currentListKind = 'cat';
    openSong(song);
    setReaderMode('chords');
  });
  await page.waitForSelector('.chord-sheet');
  await page.waitForTimeout(250);
  return page.evaluate(() => ({
    key: (document.querySelector('.chord-key-value') || {}).textContent || '',
    pills: [...document.querySelectorAll('.chord-summary .chord-pill')].map(x => x.textContent.trim()),
    chords: [...document.querySelectorAll('.chord-sheet .chord-read')].map(x => x.textContent.trim()),
    lines: document.querySelectorAll('.chord-sheet .chord-line-pos').length,
    chars: document.querySelectorAll('.chord-sheet .ce-ch').length,
    songVerses: (currentList[currentSongIdx]?.verses || []).length,
    chartVerses: (chordChartFor(currentList[currentSongIdx]) || {}).verses,
    firstLine: ((chordChartFor(currentList[currentSongIdx]) || {}).verseLines?.[0]?.[0]) || null,
    sample: (document.querySelector('.chord-sheet') || {}).innerHTML?.slice(0, 600) || '',
  }));
}

try {
  const user = await boot();
  const baseline = await user.page.evaluate(() => ({
    base: CHORD_CHARTS.BL_1.key,
    tune2: CHORD_CHARTS.BL_1__t2.key,
  }));
  check('the test song starts with bundled base and Tune 2 charts',
    baseline.base === 'G' && baseline.tune2 === 'B', JSON.stringify(baseline));

  const submitted = await user.page.evaluate(async () => {
    const song = SONGS.BL.songs.find(s => s.id === 'BL_1');
    // Match the editor's saved shape: character positions, not fractional `at`
    // anchors inherited from an old bundled chart.
    const makeChart = key => {
      const verseLines = song.verses.map(v => v.lines.map(line => [{ pos: 0, ch: key }]));
      return {
        key,
        lines: verseLines[0],
        verseLines,
        verses: verseLines.length,
        chords: [key],
        free: true,
      };
    };
    const base = makeChart('A');
    const tune2 = makeChart('C');

    CHORD_CHARTS.BL_1 = base;
    USER_CHORD_IDS.add('BL_1');
    CHORD_CHARTS.BL_1__t2 = tune2;
    USER_CHORD_IDS.add('BL_1__t2');
    saveUserChordCharts();

    const baseResult = await submitChange('chord', { id: 'BL_1', chart: base, title: song.title, tune: 1 });
    const tune2Result = await submitChange('chord', { id: 'BL_1__t2', chart: tune2, title: song.title, tune: 2 });
    return {
      baseResult,
      tune2Result,
      localBase: chordChartFor(song, 0).key,
      localTune2: chordChartFor(song, 1).key,
    };
  });
  for (let i = 0; i < 50 && state.proposals.length < 2; i++) await sleep(100);

  check('both chord edits are submitted for review',
    submitted.baseResult === 'review' && submitted.tune2Result === 'review' && state.proposals.length === 2,
    JSON.stringify({ submitted, proposals: state.proposals.length }));
  check('the submitting device keeps its own base and Tune 2 charts',
    submitted.localBase === 'A' && submitted.localTune2 === 'C', JSON.stringify(submitted));
  check('the proposals carry the exact charts the user saved',
    state.proposals[0].payload.chart.key === 'A'
      && state.proposals[0].payload.chart.verseLines[0][0][0].ch === 'A'
      && state.proposals[1].payload.chart.key === 'C'
      && state.proposals[1].payload.chart.verseLines[0][0][0].ch === 'C',
    JSON.stringify(state.proposals.map(p => ({ id: p.payload.id, key: p.payload.chart.key }))));

  const admin = await boot();
  await admin.page.evaluate(() => openAdminAccount());
  await admin.page.waitForFunction(() =>
    document.getElementById('adminAccountBody')?.textContent.includes('Admin sign in'), null, { timeout: 10000 });
  await admin.page.fill('#adminAccountLogin', 'admin@example.com');
  await admin.page.fill('#adminAccountPass', 'test-password');
  await admin.page.click('#adminAccountSignInBtn');
  await admin.page.waitForFunction(() =>
    document.getElementById('cloudPanel')?.textContent.includes('Review queue'), null, { timeout: 10000 });
  const queueText = await admin.page.textContent('#cloudPanel');
  check('the admin sees both chord proposals',
    queueText.includes('Chord chart') && (await admin.page.locator('#cloudPanel [data-action="cloudApprove"]').count()) === 2,
    queueText.slice(0, 180));

  await admin.page.locator('#cloudPanel [data-action="cloudApproveAll"]').click();
  await admin.page.waitForFunction(() =>
    document.getElementById('cloudPanel')?.textContent.includes('Nothing waiting'), null, { timeout: 10000 });
  check('approval publishes both chord edits',
    state.published.length === 2 && state.version === 1, JSON.stringify({ published: state.published.length, version: state.version }));
  check('the published base chart is exactly the submitted chart',
    state.published[0].payload.id === 'BL_1'
      && state.published[0].payload.chart.key === 'A'
      && state.published[0].payload.chart.verseLines[0][0][0].ch === 'A',
    JSON.stringify(state.published[0] && state.published[0].payload));
  check('the published Tune 2 chart is exactly the submitted chart',
    state.published[1].payload.id === 'BL_1__t2'
      && state.published[1].payload.chart.key === 'C'
      && state.published[1].payload.chart.verseLines[0][0][0].ch === 'C',
    JSON.stringify(state.published[1] && state.published[1].payload));

  await admin.page.waitForFunction(() =>
    PUB_CHORDS.BL_1 && PUB_CHORDS.BL_1__t2, null, { timeout: 10000 });
  const adminResolved = await admin.page.evaluate(() => {
    const song = SONGS.BL.songs.find(s => s.id === 'BL_1');
    return {
      base: chordChartFor(song, 0).key,
      tune2: chordChartFor(song, 1).key,
      hasLocal: USER_CHORD_IDS.has('BL_1') || USER_CHORD_IDS.has('BL_1__t2'),
    };
  });
  check('the admin device resolves the approved charts over bundled charts',
    adminResolved.base === 'A' && adminResolved.tune2 === 'C' && !adminResolved.hasLocal,
    JSON.stringify(adminResolved));
  const adminShown = await openChordReader(admin.page);
  check('the admin reader shows the approved base chart',
    adminShown.key === 'A' && adminShown.pills.includes('A')
      && adminShown.chords.includes('A'), JSON.stringify(adminShown));
  await admin.page.evaluate(() => setChordTune(1));
  await admin.page.waitForTimeout(300);
  const adminTune2Key = (await admin.page.textContent('.chord-key-value') || '').trim();
  check('the admin reader shows the approved Tune 2 chart', adminTune2Key === 'C', adminTune2Key);

  const fresh = await boot();
  await fresh.page.waitForFunction(() =>
    PUB_CHORDS.BL_1 && PUB_CHORDS.BL_1__t2, null, { timeout: 15000 });
  const freshResolved = await fresh.page.evaluate(() => {
    const song = SONGS.BL.songs.find(s => s.id === 'BL_1');
    return {
      base: chordChartFor(song, 0).key,
      tune2: chordChartFor(song, 1).key,
      hasLocal: USER_CHORD_IDS.has('BL_1') || USER_CHORD_IDS.has('BL_1__t2'),
    };
  });
  check('a fresh device receives both approved charts',
    freshResolved.base === 'A' && freshResolved.tune2 === 'C' && !freshResolved.hasLocal,
    JSON.stringify(freshResolved));
  const freshShown = await openChordReader(fresh.page);
  check('the fresh-device reader renders the approved base chord',
    freshShown.key === 'A' && freshShown.pills.includes('A')
      && freshShown.chords.includes('A'), JSON.stringify(freshShown));

  // A chart approved from an old first-verse-only device must not erase the
  // bundled charts for verses 2+ (the BL_1 regression).
  state.published.push({
    seq: 3,
    kind: 'chord',
    published_at: Date.now(),
    payload: {
      id: 'BL_1',
      title: 'Jesu Min Lian Phat Chiat Ni E',
      chart: {
        key: 'A', verses: 6, free: true, chords: ['A'],
        lines: [[{ pos: 0, ch: 'A' }]],
        verseLines: [[[{ pos: 0, ch: 'A' }]], [], [], [], [], []],
      },
    },
  });
  state.version += 1;
  const partial = await boot();
  await partial.page.waitForFunction(() =>
    PUB_CHORDS.BL_1 && PUB_CHORDS.BL_1.verseLines?.[1]?.length === 0, null, { timeout: 15000 });
  const partialCoverage = await partial.page.evaluate(() => {
    const song = SONGS.BL.songs.find(s => s.id === 'BL_1');
    const chart = chordChartFor(song, 0);
    return {
      key: chart.key,
      counts: chart.verseLines.map(lines => lines.reduce((n, specs) => n + specs.length, 0)),
    };
  });
  check('a partial published chart keeps the bundled chords for verses 2+',
    partialCoverage.key === 'A' && partialCoverage.counts[0] === 1 && partialCoverage.counts.slice(1).every(n => n > 0),
    JSON.stringify(partialCoverage));
  await partial.context.close();

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('no failed checks', !failed);
  await user.context.close();
  await admin.context.close();
  await fresh.context.close();
} catch (e) {
  console.error('FAIL  chord sync test crashed: ' + e.message);
  failed = true;
} finally {
  await browser.close();
  server.close();
}

console.log(failed ? '\nCHORD SYNC TESTS FAILED' : '\nCHORD SYNC TESTS PASSED');
process.exit(failed ? 1 : 0);
