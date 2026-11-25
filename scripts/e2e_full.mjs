// Khristian Labu — full E2E verification suite (Playwright + headless Chromium).
// Run:  npx playwright install chromium   (once)
//       node scripts/e2e_full.mjs
// Serves the project root over localhost (secure context, so the SW works) and
// drives the real UI. Prints PASS/FAIL per check plus any console/page errors.
import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/');
const { chromium } = require('playwright');
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = process.cwd();
const TEST_GOOGLE_ID = process.env.TEST_GOOGLE_ID || 'e2e-client.apps.googleusercontent.com';
const MIME = { '.html': 'text/html', '.json': 'application/json', '.gzip': 'application/gzip', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  if (p.endsWith('app.js') && TEST_GOOGLE_ID) {
    res.end(fs.readFileSync(file, 'utf8').replace("const GOOGLE_CLIENT_ID = '';", "const GOOGLE_CLIENT_ID = '" + TEST_GOOGLE_ID + "';"));
    return;
  }
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${(!cond && extra) ? ' — ' + extra : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const allErrors = [];
let currentSection = '';

async function newPage(vp = { width: 1280, height: 800 }, extra = {}) {
  const page = await browser.newPage({ viewport: vp, acceptDownloads: true, ...extra });
  // The shipped config points at the live Supabase project; every edit here would
  // otherwise submit a real proposal. An empty override turns cloud sync off.
  await page.addInitScript(() => { window.LABU_CLOUD_API = ''; });
  // HD solfa comes from R2. Abort it by default so the suite never depends on the
  // network; the HD section installs its own mock route when it needs one.
  await page.route('https://dl.labu.lengkhawm.online/**', route => route.abort());
  page.on('console', m => {
    if (m.type() !== 'error') return;
    // The HD solfa host is aborted/mocked by this suite on purpose.
    if (/dl\.labu\.lengkhawm\.online/.test((m.location() || {}).url || '')) return;
    // ignore network status failures (e.g. the GitHub update-check API rate-limiting
    // the shared sandbox IP) and app-level caught-error logs (e.g. a test stub making
    // the OTA download fail on purpose) — the app handles those; real JS errors still fail.
    if (/Failed to load resource: the server responded with a status of (403|404|429|5\d\d)/.test(m.text())) return;
    if (/^\[Khristian Labu\]/.test(m.text())) return;
    allErrors.push('[' + page.url() + '] console: ' + m.text().slice(0, 200));
  });
  page.on('pageerror', e => allErrors.push('[' + currentSection + '] pageerror: ' + e.message.slice(0, 200) + ' | ' + (e.stack || '').split('\n').slice(1, 3).join(' ~ ')));
  return page;
}
async function waitLoaded(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('statSongs')?.textContent.includes('5,7'), null, { timeout: 30000 });
}
async function section(name, fn) {
  currentSection = name;
  try { await fn(); } catch (e) { results.push(`FAIL  ${name} (crashed: ${e.message})`); }
}
async function openReaderMenu(page) {
  await page.locator('#waFabWrap .wa-fab').click();
  await page.waitForSelector('#waMenu.open');
}
async function openSettings(page) {
  await page.locator('#menuBtn').click();
  await page.waitForSelector('#sidebarModal.open');
  await page.locator('#sidebarModal').locator('text=Settings').click();
  await page.waitForSelector('#settingsView.active');
}

// ═══════════════ 1. LOAD + HOME + NAV ═══════════════
await section('load & home', async () => {
  const page = await newPage();
  await waitLoaded(page);
  ok('corpus loads (5,719)', (await page.textContent('#statSongs')).includes('5,7'));
  ok('6 group cards', (await page.locator('#groupGrid .cat-card').count()) === 6);
  ok('home drops fav/recents shortcuts', (await page.locator('#favRecentRow').count()) === 0);
  ok('stats books = 17 (books, not collections)', (await page.textContent('#statBooks')).trim() === '17');
  // group → category → list → detail
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  ok('group opens category grid', (await page.locator('#categoryGrid .cat-card').count()) > 0);
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
  const listCount = await page.locator('#songGrid .song-item').count();
  ok('song list renders (' + listCount + ' items)', listCount > 0);
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songDetail .verse');
  ok('detail renders', (await page.locator('#songDetail .verse').count()) > 0);
  ok('reader controls visible', await page.locator('#readerControlsHost .solfa-switch').isVisible());
  // ponytail: the reader footer must be pinned to the BOTTOM of the viewport even
  // for short songs (the lyrics scroll area grows to fill leftover space, so the
  // footer never floats up right after the last lyric line).
  const footerPos = await page.evaluate(() => {
    const f = document.getElementById('readerControlsHost').getBoundingClientRect();
    const sc = document.getElementById('songScroll');
    return { footerBottom: Math.round(f.bottom), viewportH: innerHeight, scrollH: Math.round(sc.getBoundingClientRect().height), contentH: sc.scrollHeight };
  });
  ok('reader footer pinned to viewport bottom (short or long song)', Math.abs(footerPos.footerBottom - footerPos.viewportH) <= 2, JSON.stringify(footerPos));
  ok('lyrics scroll area fills space above footer', footerPos.scrollH > 0 && footerPos.scrollH <= footerPos.viewportH, JSON.stringify(footerPos));
  const title = (await page.locator('#songDetail .song-header-center h1').textContent()).trim();
  ok('tab title syncs to song', (await page.title()).includes(title));
  await page.close();
});

// ═══════════════ 1z. HD SOLFA UPGRADE (R2) ═══════════════
await section('hd solfa upgrade', async () => {
  const HD_BASE = 'https://dl.labu.lengkhawm.online/solfa-hd/v5/';
  // Serve Tune 2's bytes for Tune 1's request: the real 480 DPI crops are not
  // exact 2x of the bundled ones, so a different aspect ratio is the honest case.
  const hdBytes = fs.readFileSync('assets/solfa/BL_1-t2.avif');
  const openFirstSolfa = async page => {
    await waitLoaded(page);
    return page.evaluate(async () => {
      const song = SONGS.BL.songs.find(s => s.id === 'BL_1');
      currentList = SONGS.BL.songs;
      currentCat = 'BL';
      openSong(song);
      setReaderMode('solfa');
      await new Promise(r => {
        const tick = () => { const i = document.getElementById('solfaSheetImg'); if (i && i.complete && i.naturalWidth > 0) r(); else setTimeout(tick, 25); };
        tick();
      });
      const img = document.getElementById('solfaSheetImg');
      return { src: img.getAttribute('src'), local: img.dataset.sheetSrc, h: img.getBoundingClientRect().height, nw: img.naturalWidth, nh: img.naturalHeight };
    });
  };

  // R2 unreachable: the bundled sheet must stay exactly as it is.
  const offline = await newPage();
  const off = await openFirstSolfa(offline);
  await offline.waitForTimeout(1500);
  const offAfter = await offline.evaluate(() => {
    const img = document.getElementById('solfaSheetImg');
    return { src: img.getAttribute('src'), ready: solfaHdReady('assets/solfa/BL_1-t1.avif') };
  });
  ok('R2 failure leaves the bundled sheet in place',
    off.src === 'assets/solfa/BL_1-t1.avif' && offAfter.src === 'assets/solfa/BL_1-t1.avif' && offAfter.ready === false,
    JSON.stringify({ off, offAfter }));
  await offline.close();

  // R2 reachable: HD decodes off-DOM first, then swaps without moving the layout.
  const page = await newPage();
  await page.unroute('https://dl.labu.lengkhawm.online/**');
  let hdHits = 0;
  await page.route('https://dl.labu.lengkhawm.online/**', async route => {
    hdHits++;
    await new Promise(r => setTimeout(r, 700));
    await route.fulfill({ status: 200, contentType: 'image/avif', body: hdBytes });
  });
  const first = await openFirstSolfa(page);
  ok('bundled sheet paints first while HD loads', first.src === 'assets/solfa/BL_1-t1.avif', JSON.stringify(first));
  await page.waitForFunction(() => {
    const i = document.getElementById('solfaSheetImg');
    return i && i.getAttribute('src').indexOf('/solfa-hd/') > -1 && i.complete && i.naturalWidth > 0;
  }, null, { timeout: 8000 });
  const hd = await page.evaluate(() => {
    const img = document.getElementById('solfaSheetImg');
    return {
      src: img.getAttribute('src'), local: img.dataset.sheetSrc,
      ratio: img.style.aspectRatio,
      box: Math.round(img.getBoundingClientRect().height)
    };
  });
  ok('HD sheet replaces the bundled one', hd.src === HD_BASE + 'BL_1-t1.avif' && hdHits > 0, JSON.stringify({ hd, hdHits }));
  ok('the local sheet stays the identity of the image', hd.local === 'assets/solfa/BL_1-t1.avif');
  ok('swap pins the aspect ratio and keeps the layout still',
    hd.ratio === first.nw + ' / ' + first.nh && Math.abs(hd.box - Math.round(first.h)) <= 1,
    JSON.stringify({ first, hd }));

  // Download: HD when R2 answers, bundled file when it does not.
  const hdDownload = await page.evaluate(async () => {
    const seen = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { seen.push({ href: this.href, name: this.download }); };
    try { await downloadSolfa(); } finally { HTMLAnchorElement.prototype.click = orig; }
    return seen;
  });
  ok('download takes the HD sheet from R2',
    hdDownload.length === 1 && hdDownload[0].name === 'BL_1-t1.avif' && hdDownload[0].href.startsWith('blob:'),
    JSON.stringify(hdDownload));
  // Capacitor has no DownloadListener, so the native shell saves via MediaStore.
  const hdNative = await page.evaluate(async () => {
    const calls = [];
    window.KhristianDownload = { save: (name, b64, mime) => { calls.push({ name, mime, bytes: atob(b64).length }); return 'ok'; } };
    try { await downloadSolfa(); } finally { delete window.KhristianDownload; }
    return calls;
  });
  ok('native shell saves the HD sheet through the MediaStore bridge',
    hdNative.length === 1 && hdNative[0].name === 'BL_1-t1.avif' && hdNative[0].mime === 'image/avif'
      && hdNative[0].bytes === hdBytes.length,
    JSON.stringify(hdNative));
  await page.unroute('https://dl.labu.lengkhawm.online/**');
  await page.route('https://dl.labu.lengkhawm.online/**', route => route.abort());
  const localDownload = await page.evaluate(async () => {
    const seen = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { seen.push({ href: this.href, name: this.download }); };
    try { await downloadSolfa(); } finally { HTMLAnchorElement.prototype.click = orig; }
    return seen;
  });
  ok('download falls back to the bundled sheet when R2 fails',
    localDownload.length === 1 && localDownload[0].name === 'BL_1-t1.avif' && localDownload[0].href.endsWith('assets/solfa/BL_1-t1.avif'),
    JSON.stringify(localDownload));
  const localNative = await page.evaluate(async () => {
    const calls = [];
    window.KhristianDownload = { save: (name, b64, mime) => { calls.push({ name, mime, bytes: atob(b64).length }); return 'ok'; } };
    try { await downloadSolfa(); } finally { delete window.KhristianDownload; }
    return calls;
  });
  ok('native shell falls back to the bundled sheet when R2 fails',
    localNative.length === 1 && localNative[0].name === 'BL_1-t1.avif'
      && localNative[0].bytes === fs.statSync('assets/solfa/BL_1-t1.avif').size,
    JSON.stringify(localNative));
  await page.close();
});

// ═══════════════ 1a. SOLFA TUNE TABS ═══════════════
await section('solfa tune tabs', async () => {
  const page = await newPage();
  await waitLoaded(page);
  await page.waitForFunction(() => Object.keys(CHORD_CHARTS).filter(k => k.endsWith('__t2')).length === 8);
  const seeded = await page.evaluate(() => {
    const keys = { BL_1: 'B', BL_21: 'G', BL_22: 'F', BL_35: 'F', BL_105: 'B', BL_127: 'G', BL_131: 'A', BL_239: 'F' };
    return Object.keys(keys).map(id => {
      const c = CHORD_CHARTS[id + '__t2'];
      if (!c) return { id: id, ok: false };
      const lastLine = c.verseLines[c.verseLines.length - 1];
      const last = lastLine[lastLine.length - 1];
      return { id: id, ok: true, key: c.key, want: keys[id], chords: c.chords, last: (last[last.length - 1] || {}).ch, verses: c.verses };
    });
  });
  ok('all eight Tune 2 charts are seeded in their printed keys with a tonic cadence',
    seeded.every(s => s.ok && s.key === s.want && s.last === s.want && s.verses > 0 && s.chords.length >= 3),
    JSON.stringify(seeded.filter(s => !s.ok || s.key !== s.want || s.last !== s.want)));
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').filter({ hasText: 'Biakna Late' }).first().click();
  await page.waitForSelector('#songGrid .song-item');
  await page.locator('#songGrid .song-item').filter({ hasText: 'Jesu Minlian' }).first().click();
  await page.waitForSelector('#songDetail .verse');
  await page.evaluate(() => setReaderMode('solfa'));
  await page.waitForSelector('.solfa-tunes');
  await page.waitForFunction(() => { const i = document.getElementById('solfaSheetImg'); return i && i.complete && i.naturalWidth > 0; });
  const tabs = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.solfa-tunes button')];
    const img = document.getElementById('solfaSheetImg');
    return { labels: b.map(x => x.textContent.trim()), active: b.findIndex(x => x.classList.contains('active')), src: img.getAttribute('src'), w: img.naturalWidth };
  });
  ok('two-tune hymn shows Tune 1 / Tune 2 tabs',
    tabs.labels.join('|') === 'Tune 1|Tune 2' && tabs.active === 0 && tabs.src.endsWith('BL_1-t1.avif') && tabs.w > 0,
    JSON.stringify(tabs));
  await page.locator('.solfa-tunes button').nth(1).click();
  await page.waitForFunction(() => { const i = document.getElementById('solfaSheetImg'); return i && i.getAttribute('src').endsWith('BL_1-t2.avif') && i.complete && i.naturalWidth > 0; });
  const t2 = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.solfa-tunes button')];
    const img = document.getElementById('solfaSheetImg');
    return { active: b.findIndex(x => x.classList.contains('active')), w: img.naturalWidth, h: img.naturalHeight };
  });
  ok('Tune 2 tab swaps in the second sheet', t2.active === 1 && t2.w > 0 && t2.h > 0, JSON.stringify(t2));
  await sleep(500);
  const tuneBand = await page.evaluate(() => {
    const root = document.querySelector('.solfa-tunes');
    const pill = root.querySelector('.tune-pill');
    const active = root.querySelector('button.active');
    const pr = pill.getBoundingClientRect(), ar = active.getBoundingClientRect();
    const cs = getComputedStyle(pill);
    return { has: !!pill, dx: Math.round(Math.abs(pr.left - ar.left)), dw: Math.round(Math.abs(pr.width - ar.width)), dur: cs.transitionDuration, prop: cs.transitionProperty };
  });
  ok('tune switch slides its selection band like the reader switch',
    tuneBand.has && tuneBand.dx <= 1 && tuneBand.dw <= 1 && tuneBand.dur !== '0s' && /transform/.test(tuneBand.prop), JSON.stringify(tuneBand));
  await page.evaluate(() => { setReaderMode('lyrics'); setReaderMode('solfa'); });
  const kept = await page.evaluate(() => ({
    src: document.getElementById('solfaSheetImg').getAttribute('src'),
    active: [...document.querySelectorAll('.solfa-tunes button')].findIndex(b => b.classList.contains('active'))
  }));
  ok('chosen tune survives a view switch', kept.src.endsWith('BL_1-t2.avif') && kept.active === 1, JSON.stringify(kept));
  const files = await page.evaluate(async () => Promise.all(['assets/solfa/BL_1-t1.avif', 'assets/solfa/BL_1-t2.avif']
    .map(async p => (await fetch(p, { method: 'HEAD' })).status)));
  ok('both tune sheet files are served', files.every(s => s === 200), JSON.stringify(files));
  const headerGap = await page.evaluate(() => {
    const h = document.querySelector('.song-detail-header').getBoundingClientRect();
    const t = document.querySelector('.solfa-tunes').getBoundingClientRect();
    return Math.round(t.top - h.bottom);
  });
  ok('solfa header rule has breathing room below it', headerGap >= 12, 'gap ' + headerGap);

  // Chords get the same tune switch, with an independent chart per tune.
  await page.evaluate(() => setReaderMode('chords'));
  await page.waitForSelector('.chord-sheet');
  const chordsT2 = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.solfa-tunes button')];
    return {
      labels: b.map(x => x.textContent.trim()), active: b.findIndex(x => x.classList.contains('active')),
      key: (document.querySelector('.chord-key-value') || {}).textContent || '',
      pills: [...document.querySelectorAll('.chord-summary .chord-pill')].map(x => x.textContent.trim())
    };
  });
  ok('chords tab shows Tune 1 / Tune 2 and its seeded Tune 2 chart',
    chordsT2.labels.join('|') === 'Tune 1|Tune 2' && chordsT2.active === 1
      && chordsT2.key.trim() === 'B' && chordsT2.pills.includes('F#') && !chordsT2.pills.includes('G'), JSON.stringify(chordsT2));
  await page.locator('.solfa-tunes button').first().click();
  await page.waitForSelector('.chord-sheet');
  await sleep(500);
  const chordBand = await page.evaluate(() => {
    const root = document.querySelector('.solfa-tunes');
    const pill = root.querySelector('.tune-pill');
    const active = root.querySelector('button.active');
    const pr = pill.getBoundingClientRect(), ar = active.getBoundingClientRect();
    return { dx: Math.round(Math.abs(pr.left - ar.left)), dw: Math.round(Math.abs(pr.width - ar.width)), dur: getComputedStyle(pill).transitionDuration };
  });
  ok('chords tune switch keeps the sliding band after re-render',
    chordBand.dx <= 1 && chordBand.dw <= 1 && chordBand.dur !== '0s', JSON.stringify(chordBand));
  const tune1Key = (await page.locator('.chord-key-value').textContent()).trim();
  ok('Tune 1 still shows the first chord chart', tune1Key === 'G', tune1Key);
  await page.locator('.solfa-tunes button').nth(1).click();
  await page.waitForSelector('.chord-sheet');
  await page.evaluate(() => openChordEditor());
  await page.waitForSelector('#chordModal.open');
  const t2EditorKey = await page.inputValue('#chordEditKey');
  ok('Tune 2 chord editor defaults to its printed key (B)', t2EditorKey === 'B', t2EditorKey);
  await page.evaluate(() => {
    CE.blocks[0].lines[0].chords = [{ pos: 0, ch: 'B' }];
    saveChordEditor();
  });
  await page.waitForTimeout(350);
  const chartSep = await page.evaluate(() => ({
    t1: (chordChartFor(currentList[currentSongIdx], 0).chords || []).slice(),
    t2: ((CHORD_CHARTS['BL_1__t2'] || {}).chords || []).slice(),
    stored: Object.keys(JSON.parse(localStorage.getItem('labu_chord_charts_v1') || '{}')),
    shownKey: (document.querySelector('.chord-key-value') || {}).textContent || ''
  }));
  ok('second tune saves a separate chord chart',
    chartSep.t2.includes('B') && chartSep.t1.includes('G') && !chartSep.t1.includes('B')
      && chartSep.stored.includes('BL_1__t2') && chartSep.shownKey.trim() === 'B', JSON.stringify(chartSep));
  await page.close();
});

// ═══════════════ 1b. VIEW HIDING (detail view must not render below home) ═══════════════
await section('view hiding', async () => {
  const page = await newPage({ width: 390, height: 844 });
  await waitLoaded(page);
  // BUG: #detailView used to force display:flex unconditionally (ID specificity beat
  // .view{display:none}), so the lyric view was ALWAYS rendered — an empty block below
  // the home page, and the song lyrics stayed visible there after visiting a song.
  const home = await page.evaluate(() => {
    const dv = document.getElementById('detailView');
    const cs = getComputedStyle(dv);
    return {
      display: cs.display,
      docHeight: document.documentElement.scrollHeight,
      vh: window.innerHeight,
    };
  });
  ok('detail view hidden on home page', home.display === 'none', 'display=' + home.display);
  ok('no empty space below home content', home.docHeight <= home.vh + 250, 'docHeight=' + home.docHeight + ' vh=' + home.vh);
  // open a song → detail active (flex), then back → hidden again, lyrics not visible
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songDetail .verse');
  ok('detail view flex when active', (await page.evaluate(() => getComputedStyle(document.getElementById('detailView')).display)) === 'flex');
  await page.goBack(); await page.waitForSelector('#songGrid .song-item');
  await page.goBack(); await page.waitForSelector('#categoryGrid .cat-card');
  await page.goBack(); await page.waitForSelector('#groupGrid .cat-card');
  const back = await page.evaluate(() => {
    const dv = document.getElementById('detailView');
    return { display: getComputedStyle(dv).display, rect: dv.getBoundingClientRect().height };
  });
  ok('detail view hidden again after back to home', back.display === 'none' && back.rect === 0, JSON.stringify(back));
  await page.close();
});

// ═══════════════ 1c. LIST DOM PERSISTENCE (back/forward must not rebuild rows) ═══════════════
await section('list dom persistence', async () => {
  const page = await newPage({ width: 390, height: 844 });
  await waitLoaded(page);
  // count #songGrid childList mutations (row additions) across navigation
  await page.evaluate(() => {
    window.__rowAdds = 0;
    new MutationObserver(muts => {
      for (const m of muts) if (m.type === 'childList' && m.addedNodes.length && m.target.id === 'songGrid') window.__rowAdds++;
    }).observe(document.getElementById('songGrid'), { childList: true });
  });
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
  const rows = await page.evaluate(() => document.querySelectorAll('#songGrid .song-item').length);
  const addsAfterFirst = await page.evaluate(() => window.__rowAdds);
  // open song → back → forward → back: the list rows must NOT be rebuilt
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songDetail .verse');
  await page.goBack();
  await page.waitForSelector('#songGrid .song-item');
  await page.goForward();
  await page.waitForSelector('#songDetail .verse');
  await page.goBack();
  await page.waitForSelector('#songGrid .song-item');
  await page.goBack();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.goForward();
  await page.waitForSelector('#songGrid .song-item');
  const addsAfter = await page.evaluate(() => window.__rowAdds);
  const rowsAfter = await page.evaluate(() => document.querySelectorAll('#songGrid .song-item').length);
  ok('list renders its rows (' + rows + ' rows, ' + addsAfterFirst + ' mutation)', rows > 0 && addsAfterFirst >= 1);
  ok('back/forward nav does NOT rebuild the list rows', addsAfter === addsAfterFirst, addsAfterFirst + ' → ' + addsAfter);
  ok('restored list still opens its songs', rowsAfter === rows, 'rows ' + rows + ' → ' + rowsAfter);
  await page.close();
});

// ═══════════════ 2. READER FEATURES (scroll memory, verse jump, WhatsApp FAB) ═══════════════
await section('reader features', async () => {
  const page = await newPage();
  await waitLoaded(page);
  // open the longest song in the corpus (15 verses) via search from home (unscoped)
  await page.locator('#searchOpenBtn').click();
  await page.waitForSelector('#searchModal.open');
  await page.locator('#searchModalInput').fill('pakai vannoi');
  await page.waitForTimeout(900);
  // the phrase also matches a shorter song's lyrics — click the title match (15 verses)
  const idx = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#searchResults .song-item')];
    return items.findIndex(it => /PAKAI/.test(it.querySelector('.si-title')?.textContent || ''));
  });
  ok('found the 15-verse song in results', idx >= 0, 'idx=' + idx);
  await page.locator('#searchResults .song-item').nth(Math.max(idx, 0)).click();
  await page.waitForSelector('#songDetail .verse');
  const vjCount = await page.locator('.verse-jump .vj').count();
  ok('verse jump strip (' + vjCount + ' chips)', vjCount >= 12, 'long song should show numbered jump chips');
  // tap the last jump chip → scrolls the lyrics CONTAINER down
  const before = await page.evaluate(() => document.getElementById('songScroll').scrollTop);
  await page.locator('.verse-jump .vj').last().click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => document.getElementById('songScroll').scrollTop);
  ok('verse jump scrolls down', after > before, before + ' → ' + after);
  // Opening a song always starts at the top; a previous reading position is not resumed.
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.getElementById('songScroll').scrollTop = 403; });
  await page.waitForTimeout(200);
  await page.goBack();
  await page.waitForSelector('#homeView.active');
  await page.locator('#searchOpenBtn').click();
  await page.waitForSelector('#searchModal.open');
  await page.waitForSelector('#searchResults .song-item');
  await page.locator('#searchResults .song-item').nth(idx).click();
  await page.waitForSelector('#songDetail .verse');
  await page.waitForTimeout(200);
  const reopenedAt = await page.evaluate(() => document.getElementById('songScroll').scrollTop);
  ok('reader opens at the top instead of restoring old scroll', reopenedAt < 2, 'got ' + reopenedAt);
  // WhatsApp FAB + menu (check the .wa-fab button — the wrapper div has zero size)
  ok('wa fab visible in detail', await page.locator('#waFabWrap .wa-fab').isVisible());
  ok('floating menu button has no shadow',
    await page.locator('#waFabWrap .wa-fab').evaluate(el => getComputedStyle(el).boxShadow === 'none'));
  await page.locator('#waFabWrap .wa-fab').click();
  await page.waitForSelector('#waMenu.open');
  const menuTxt = await page.locator('#waMenu').textContent();
  ok('action menu opens with share + song actions', (await page.locator('#waMenu .fab-item').count()) >= 5, String(await page.locator('#waMenu .fab-item').count()));
  ok('text share option present', menuTxt.includes('Share as text'));
  ok('image share option present', menuTxt.includes('Share as image'));
  ok('song actions are in the menu', menuTxt.includes('Edit song') && menuTxt.includes('Add to playlist') && menuTxt.includes('favourites'));
  // click image share → preview modal should open (html2canvas takes time)
  await page.locator('#waMenu [data-action="image"]').click();
  await page.waitForSelector('#imagePreviewModal.open', { timeout: 25000 }).catch(() => {});
  const previewOpen = await page.locator('#imagePreviewModal.open').count() > 0;
  ok('image preview modal opens on share-as-image', previewOpen);
  if (previewOpen) {
    ok('preview has image', (await page.locator('#imgPreviewPic').getAttribute('src'))?.length > 10);
    ok('preview has share button', await page.locator('#imgPreviewShareBtn').isVisible());
    // close the preview
    await page.locator('#imagePreviewModal .modal-close').click();
    await page.waitForTimeout(300);
  } else {
    // force-close any lingering modal/menu so subsequent tests aren't blocked
    await page.evaluate(() => { document.getElementById('imagePreviewModal')?.classList.remove('open'); document.getElementById('waMenu')?.classList.remove('open'); });
  }
  // close menu, go back home → search modal covers the chrome and hides the FAB
  await page.keyboard.press('Escape').catch(() => {});
  await page.goBack();
  await page.waitForSelector('#homeView.active');
  await page.locator('#searchOpenBtn').click();
  await page.waitForSelector('#searchModal.open');
  await page.waitForSelector('#searchResults .song-item');
  ok('wa fab hidden while search modal is open', !(await page.locator('#waFabWrap .wa-fab').isVisible()));
  // reader bottom bar: visible on a long song, lyrics stop above it, hides when nothing scrolls
  await page.locator('#searchModalInput').fill('pakai vannoi');
  await page.waitForTimeout(600);
  const idx2 = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#searchResults .song-item')];
    return items.findIndex(it => /PAKAI/.test(it.querySelector('.si-title')?.textContent || ''));
  });
  await page.locator('#searchResults .song-item').nth(Math.max(idx2, 0)).click();
  await page.waitForSelector('#songDetail .verse');
  await page.waitForTimeout(300);
  ok('reader bar visible on long song', await page.locator('#readerControlsHost .solfa-switch').isVisible());
  // BUG 1: the footer is a SEPARATE element — the lyrics scroll container clips at its
  // top edge, so lyrics can never render behind the footer at ANY scroll position.
  const footerLayout = await page.evaluate(() => {
    const sc = document.getElementById('songScroll');
    const footer = document.getElementById('readerControlsHost');
    const srect = sc.getBoundingClientRect();
    const frect = footer.getBoundingClientRect();
    return {
      clipOK: Math.round(srect.bottom) <= Math.round(frect.top) + 1,
      footerBelow: frect.top >= srect.bottom - 1,
      footerBottom: Math.round(frect.bottom),
      vh: window.innerHeight,
      actionsInFooter: !!footer.querySelector('.reader-actions'),
      actionsInSong: !!document.getElementById('songDetail').querySelector('.song-actions-row'),
      menuActions: document.querySelectorAll('#waMenu .fab-item').length,
    };
  });
  ok('lyrics clip above the separate footer (container bottom ' + footerLayout + ')', footerLayout.clipOK && footerLayout.footerBelow, JSON.stringify(footerLayout));
  ok('song actions live in the floating menu', !footerLayout.actionsInFooter && !footerLayout.actionsInSong && footerLayout.menuActions >= 5);
  // max font + max line-height at the end of container scroll: last line clears the footer
  await page.evaluate(() => { setReaderFont(28); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const sc = document.getElementById('songScroll'); sc.scrollTop = sc.scrollHeight; });
  await page.waitForTimeout(400);
  const clearance = await page.evaluate(() => {
    const footer = document.getElementById('readerControlsHost').getBoundingClientRect();
    const verses = document.querySelectorAll('#songDetail .verse');
    const last = verses[verses.length - 1].getBoundingClientRect();
    return Math.round(footer.top - last.bottom);
  });
  ok('last lyric line clears the footer at max scroll (' + clearance + 'px)', clearance > 10, 'clearance=' + clearance);
  // when lyrics fit on one screen the footer STAYS but the CONTAINER scroll is LOCKED;
  // growing the font past the fold unlocks it again
  await page.evaluate(() => {
    setReaderFont(17); // back to defaults before the fit test
    document.getElementById('songDetail').innerHTML =
      '<div class="song-detail-header"><h1>Short</h1></div><div class="verse" id="sv0"><p>' + Array(21).fill('One line of lyrics.').join('<br>') + '</p></div>';
    scheduleReaderControlsCheck();
  });
  await page.waitForTimeout(300);
  ok('reader bar stays visible on a one-screen song', await page.locator('#readerControlsHost .solfa-switch').isVisible());
  // BUG 2: no dead zone — the lyrics end naturally; the footer sits right below them
  const shortGap = await page.evaluate(() => {
    const sc = document.getElementById('songScroll');
    const footer = document.getElementById('readerControlsHost').getBoundingClientRect();
    const verses = document.querySelectorAll('#songDetail .verse');
    const last = verses[verses.length - 1].getBoundingClientRect();
    return Math.round(footer.top - last.bottom);
  });
  // the footer no longer holds the action row, so the leftover slack grows a little
  ok('no dead zone between lyrics and footer on one-screen song (gap=' + shortGap + 'px)', shortGap < 180, 'gap=' + shortGap);
  ok('container scroll locked when lyrics fit on one screen', await page.evaluate(() => document.getElementById('songScroll').classList.contains('scroll-locked')));
  await page.evaluate(() => { const sc = document.getElementById('songScroll'); sc.scrollTop = 500; });
  await page.waitForTimeout(200);
  ok('cannot scroll container while locked', (await page.evaluate(() => document.getElementById('songScroll').scrollTop)) === 0);
  // increasing size/spacing so the lyrics no longer fit → scroll works again
  await page.evaluate(() => { setReaderFont(28); });
  await page.waitForTimeout(400);
  ok('font increase unlocks scroll when lyrics overflow', await page.evaluate(() => !document.getElementById('songScroll').classList.contains('scroll-locked')));
  await page.evaluate(() => { document.getElementById('songScroll').scrollTop = 200; });
  await page.waitForTimeout(200);
  ok('scrolling works again after unlock', (await page.evaluate(() => document.getElementById('songScroll').scrollTop)) > 0);
  await page.close();
});

// ═══════════════ 3. SEARCH (modal, songbook filter, sort, normalization, history) ═══════════════
await section('search', async () => {
  const page = await newPage();
  await waitLoaded(page);
  // scope: start from home so search covers everything
  await page.locator('#searchOpenBtn').click();
  await page.waitForSelector('#searchModal.open');
  ok('desktop search opens a modal', await page.locator('#searchModal .search-modal').isVisible());
  await page.locator('#searchBookFilterWrap').click();
  await page.waitForSelector('#searchBookMenu:not([hidden])');
  const bookOpts = await page.locator('#searchBookMenu .search-menu-item').count();
  ok('songbook filter lists enabled books (' + bookOpts + ')', bookOpts > 5);
  ok('songbook filter is a themed menu, not a native select', (await page.locator('#searchBookMenu select').count()) === 0);
  await page.locator('#searchBookFilterWrap').click();
  ok('old field-filter chips are gone', (await page.locator('.si-chip').count()) === 0);
  const inp = page.locator('#searchModalInput');
  await inp.fill('toupa');
  await page.waitForTimeout(900);
  const n1 = await page.locator('#searchResults .song-item').count();
  ok('search "toupa" returns results (' + n1 + ')', n1 > 0);
  // one songbook filter narrows the same query
  const scopeKey = await page.evaluate(() => {
    const q = normText('toupa');
    return enabledBookKeys().find(k => SONGS[k] && SONGS[k].songs &&
      SONGS[k].songs.some(song => matchSong(song, k, SONGS[k].info.name, q)));
  });
  await page.locator('#searchBookFilterWrap').click();
  await page.locator('#searchBookMenu [data-book="' + scopeKey + '"]').click();
  await page.waitForTimeout(500);
  const nScoped = await page.locator('#searchResults .song-item').count();
  const outOfBook = await page.evaluate(key => {
    const name = SONGS[key].info.name;
    return [...document.querySelectorAll('#searchResults .song-item')].filter(it =>
      ![...it.querySelectorAll('.si-badge')].some(b => b.textContent === name)).length;
  }, scopeKey);
  ok('songbook filter narrows results (' + nScoped + ' in ' + scopeKey + ')', nScoped > 0 && nScoped <= n1 && outOfBook === 0, 'outside=' + outOfBook);
  await page.locator('#searchBookFilterWrap').click();
  await page.locator('#searchBookMenu [data-book="all"]').click();
  await page.waitForTimeout(400);
  // sort
  await page.locator('#searchSortBtn').click();
  await page.locator('#searchSortMenu [data-sort="alpha"]').click();
  await page.waitForTimeout(400);
  const firstTitle = (await page.locator('#searchResults .song-item .si-title').first().textContent()).trim();
  await page.locator('#searchSortBtn').click();
  await page.locator('#searchSortMenu [data-sort="relevance"]').click();
  await page.waitForTimeout(400);
  ok('sort works', (await page.locator('#searchResults .song-item').count()) > 0, 'first after A-Z: ' + firstTitle);
  // normalization (apostrophe/diacritics)
  await inp.fill('khovel haksa nang din');
  await page.waitForTimeout(900);
  const r = await page.locator('#searchResults .song-item .si-title').first().textContent().catch(() => '');
  ok('normalized search finds apostrophe title', !!r && r.includes("Di'n"), String(r));
  // recent history: clear input → chips; click re-runs
  await inp.fill('');
  await page.waitForTimeout(500);
  const chips = await page.locator('.si-rec').allTextContents();
  ok('empty query shows recent searches (' + chips.length + ' chips)', chips.length > 0, chips.join(' | '));
  await page.locator('.si-rec').first().click();
  await page.waitForTimeout(700);
  const rerun = await page.locator('#searchResults .song-item').count();
  ok('clicking recent search re-runs it (' + rerun + ' results)', rerun > 0, 'chip=' + JSON.stringify(chips[0]));
  // clear history
  await inp.fill('');
  await page.waitForTimeout(500);
  await page.locator('.si-clear-hist').click();
  ok('clear history works', (await page.locator('.si-rec').count()) === 0);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#searchModal:not(.open)', { state: 'attached' });
  ok('Escape closes the search modal', !(await page.locator('#searchModal').evaluate(el => el.classList.contains('open'))));

  // inside a songbook the filter is a fixed scope pill, not a picker
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
  const bookKey = await page.evaluate(() => currentCat);
  const bookLabel = await page.evaluate(key => SONGS[key].info.name, bookKey);
  await page.locator('#searchOpenBtn').click();
  await page.waitForSelector('#searchModal.open');
  ok('in-book search hides the songbook picker', !(await page.locator('#searchBookFilterWrap').isVisible()));
  const pillText = (await page.locator('#searchScopePill').textContent() || '').trim();
  ok('in-book search shows a scoped book pill', pillText === bookLabel, pillText + ' vs ' + bookLabel);
  await inp.fill('a');
  await page.waitForTimeout(800);
  const insideCount = await page.locator('#searchResults .song-item').count();
  const outsideScoped = await page.evaluate(key => {
    const name = SONGS[key].info.name;
    return [...document.querySelectorAll('#searchResults .song-item')].filter(it =>
      ![...it.querySelectorAll('.si-badge')].some(b => b.textContent === name)).length;
  }, bookKey);
  ok('in-book search only returns that book (' + insideCount + ' results)', insideCount > 0 && outsideScoped === 0, 'outside=' + outsideScoped);
  // opening a result closes the popup and keeps the reader scoped to the book
  await page.locator('#searchResults .song-item').first().click();
  await page.waitForSelector('#songDetail .verse');
  ok('result click closes search modal', !(await page.locator('#searchModal').evaluate(el => el.classList.contains('open'))));
  await page.locator('#searchOpenBtn').click();
  await page.waitForSelector('#searchModal.open');
  const detailPill = (await page.locator('#searchScopePill').textContent() || '').trim();
  ok('search from a scoped reader stays in that book', detailPill === bookLabel && !(await page.locator('#searchBookFilterWrap').isVisible()), detailPill);
  await page.locator('#searchModal .search-modal-cancel').click();
  await page.waitForSelector('#searchModal:not(.open)', { state: 'attached' });
  ok('Cancel closes the search modal', !(await page.locator('#searchModal').evaluate(el => el.classList.contains('open'))));
  await page.close();
});

// ═══════════════ 4. FAVORITES + RECENTS ═══════════════
await section('favorites & recents', async () => {
  const page = await newPage();
  await waitLoaded(page);
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songDetail .verse');
  const favTitle = (await page.locator('#songDetail .song-header-center h1').textContent()).trim();
  // toggle favorite (floating action menu)
  await openReaderMenu(page);
  await page.locator('#waMenu [data-action="fav"]').click();
  await page.waitForTimeout(300);
  const favSvg = await page.locator('#waMenu [data-action="fav"]').innerHTML();
  ok('fav toggled (icon filled)', favSvg.includes('fill="var(--warm)"'), favSvg.slice(0, 80));
  // favorites view
  await page.goBack(); await page.waitForSelector('#songGrid .song-item');
  await page.goBack(); await page.waitForSelector('#categoryGrid .cat-card');
  await page.goBack(); await page.waitForSelector('#groupGrid .cat-card');
  await page.evaluate(() => openFavs());
  await page.waitForSelector('#songGrid .song-item');
  ok('favorites view lists the song', (await page.textContent('#songGrid')).includes(favTitle));
  // unfavorite → favorites list (cache invalidated by design) becomes empty
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songDetail .verse');
  await openReaderMenu(page);
  await page.locator('#waMenu [data-action="fav"]').click();
  await page.waitForTimeout(300);
  await page.goBack();
  await page.waitForFunction(() => document.getElementById('listHeader')?.textContent.includes('Favourites'), null, { timeout: 5000 });
  await page.waitForTimeout(300);
  ok('unfavorited → empty favorites', (await page.locator('#songGrid .song-item').count()) === 0);
  // recents view shows the viewed song
  await page.evaluate(() => openRecents());
  await page.waitForSelector('#songGrid .song-item');
  ok('recents lists viewed song', (await page.textContent('#songGrid')).includes(favTitle));
  await page.close();
});

// ═══════════════ 5. PLAYLISTS ═══════════════
await section('playlists', async () => {
  const page = await newPage();
  await waitLoaded(page);
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songDetail .verse');
  const songTitle = (await page.locator('#songDetail .song-header-center h1').textContent()).trim();
  // add to a new playlist via the chooser (Create also adds the current song)
  await openReaderMenu(page);
  await page.locator('#waMenu [data-action="playlist"]').click();
  await page.waitForSelector('#playlistModal.open');
  await page.fill('#newPlaylistInput', 'E2E List');
  await page.locator('#playlistModal').locator('button:has-text("Create")').click();
  await page.waitForTimeout(300);
  await page.locator('#playlistModalBody').getByText('E2E List').waitFor();
  await page.locator('#playlistModal').locator('button:has-text("Done")').click();
  // open the Playlist page from the sidebar
  await page.locator('#menuBtn').click();
  await page.waitForSelector('#sidebarModal.open');
  await page.locator('#sidebarModal .sidebar-item:has-text("Playlist")').click();
  await page.waitForSelector('#songGrid .song-item');
  ok('playlist page shows the playlist', (await page.textContent('#songGrid')).includes('E2E List'));
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songGrid .song-item');
  ok('playlist opens with 1 song', (await page.textContent('#songGrid')).includes(songTitle));
  // search is global now: the playlist song is found from anywhere, with no scope pill
  await page.locator('#searchOpenBtn').click();
  await page.waitForSelector('#searchModal.open');
  await page.fill('#searchModalInput', songTitle.slice(0, 6));
  await page.waitForTimeout(900);
  const globalCount = await page.locator('#searchResults .song-item').count();
  const allScope = (await page.locator('#searchBookFilterLabel').textContent() || '').trim();
  ok('search runs across all songbooks from a playlist', globalCount >= 1 && allScope === 'All songbooks' && !(await page.locator('#searchScopePill').isVisible()), 'scope=' + allScope + ' results=' + globalCount);
  // close the popup, then return to the playlist itself and rename
  await page.locator('#searchModal .search-modal-cancel').click();
  await page.waitForSelector('#searchModal:not(.open)', { state: 'attached' });
  await page.evaluate(() => openPlaylist(currentPlaylistId));
  await page.waitForSelector('#listHeader a:has-text("Rename")');
  // rename via prompt
  page.once('dialog', d => d.accept('E2E Renamed'));
  await page.locator('#listHeader').locator('a:has-text("Rename")').click();
  await page.waitForTimeout(400);
  ok('rename handled', (await page.textContent('#listHeader')).includes('E2E Renamed'));
  // delete playlist
  await page.locator('#listHeader').locator('a:has-text("Delete")').click();
  await page.waitForSelector('#confirmModal.open');
  await page.locator('#confirmBtn').click();
  await page.waitForTimeout(400);
  ok('playlist deleted', (await page.locator('#songGrid .song-item').count()) === 0);
  await page.close();
});

// ═══════════════ 6. ADMIN CRUD ═══════════════
await section('admin CRUD', async () => {
  const page = await newPage();
  await waitLoaded(page);
  await openSettings(page);
  await page.locator('#settingsView').locator('text=Manage Songs').click();
  await page.waitForSelector('#adminView.active');
  await page.waitForFunction(() => document.querySelectorAll('#adminSongList .admin-song-row').length >= 200, null, { timeout: 15000 });
  // add song
  await page.locator('#adminAddBtn').click();
  await page.locator('#adminAddMenu').getByText('Add Song', { exact: true }).click();
  await page.waitForSelector('#songModal.open');
  await page.fill('#formNum', '9999');
  await page.fill('#formTitle', 'E2E TEST SONG');
  await page.fill('#formAuthor', 'E2E Author');
  await page.fill('#formVerses', 'V: E2EMARKER first line\nE2EMARKER second line');
  await page.locator('#songModal').locator('button:has-text("Save Song")').click();
  await page.waitForFunction(() => !document.getElementById('songModal').classList.contains('open'));
  ok('song added without a toast', (await page.locator('.toast').count()) === 0);
  // search it in admin
  await page.fill('#adminSearchInput', 'E2E TEST SONG');
  await page.waitForTimeout(400);
  ok('admin search finds added song', (await page.locator('#adminSongList .admin-song-row').count()) === 1);
  // find & replace
  await page.locator('#adminView').locator('button[title="Find & Replace"]').click();
  await page.waitForSelector('#findReplaceModal.open');
  await page.fill('#findInput', 'E2EMARKER');
  await page.fill('#replaceInput', 'E2EREPLACED');
  // The modal's delayed autofocus must not pull the caret out of Replace while
  // it is being typed into; when it did, the text landed in Find instead, the
  // preview dropped to 0 matches and Replace All became a silent no-op.
  ok('replace text stays in the replace field',
    (await page.inputValue('#findInput')) === 'E2EMARKER' && (await page.inputValue('#replaceInput')) === 'E2EREPLACED',
    'find=' + (await page.inputValue('#findInput')) + ' replace=' + (await page.inputValue('#replaceInput')));
  await page.waitForTimeout(500);
  ok('find & replace preview counts matches', (await page.textContent('#frStats')).includes('match'));
  const previewText = await page.textContent('#frResults');
  ok('preview shows the replacement result',
    previewText.includes('E2EREPLACED') && previewText.includes('E2EMARKER') &&
    (await page.locator('#frResults .match-after').count()) >= 2, JSON.stringify(previewText.slice(0, 80)));
  await page.locator('#findReplaceModal').locator('button:has-text("Replace All")').click();
  // Closing the modal is the app's completion signal; the success toast is
  // ephemeral and can disappear before Playwright starts polling.
  const replaceResult = await page.waitForFunction(() => {
    const modal = document.getElementById('findReplaceModal');
    if (!modal.classList.contains('open')) return { ok: true };
    const err = [...document.querySelectorAll('.toast')]
      .map(t => t.textContent)
      .find(t => /Could not save replacement|No matches to replace/.test(t));
    return err ? { ok: false, error: err } : false;
  }, null, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => ({ ok: false, error: 'timed out waiting for the replace modal' }));
  ok('replace executed', replaceResult.ok, JSON.stringify(replaceResult));
  if (!replaceResult.ok) throw new Error(replaceResult.error);
  // edit song title
  await page.locator('#adminSongList .admin-song-row button[title="Edit"]').click();
  await page.waitForSelector('#songModal.open');
  await page.fill('#formTitle', 'E2E TEST SONG EDITED');
  await page.locator('#songModal').locator('button:has-text("Save Song")').click();
  await page.waitForTimeout(400);
  ok('edit saved', (await page.locator('#adminSongList .song-title').first().textContent()).includes('EDITED'));
  // verify replacement landed in the lyrics (via the edit form's verse textarea)
  await page.locator('#adminSongList .admin-song-row button[title="Edit"]').first().click();
  await page.waitForSelector('#songModal.open');
  const verses = await page.inputValue('#formVerses');
  ok('find & replace applied to lyrics', verses.includes('E2EREPLACED') && !verses.includes('E2EMARKER'), verses.slice(0, 60));
  await page.locator('#songModal').locator('button:has-text("Cancel")').click().catch(() => {});
  await page.waitForSelector('#songModal.open', { state: 'detached' }).catch(() => {});
  // Replace must work even when no preview was ever rendered: the button reads
  // the fields, so writing them without an input event leaves it fully armed.
  await page.locator('#adminView').locator('button[title="Find & Replace"]').click();
  await page.waitForSelector('#findReplaceModal.open');
  await page.evaluate(() => {
    document.getElementById('findInput').value = 'E2EREPLACED';
    document.getElementById('replaceInput').value = 'E2ESTALE';
    frMatches = [];
  });
  ok('no preview was rendered', (await page.evaluate(() => frMatches.length)) === 0,
    'stats=' + JSON.stringify(await page.textContent('#frStats')));
  await page.locator('#findReplaceModal').locator('button:has-text("Replace All")').click();
  const staleClosed = await page.waitForFunction(
    () => !document.getElementById('findReplaceModal').classList.contains('open'),
    null, { timeout: 5000 }).then(() => true).catch(() => false);
  ok('replace works without a rendered preview', staleClosed,
    'stats=' + JSON.stringify(await page.textContent('#frStats')));
  await page.locator('#adminSongList .admin-song-row button[title="Edit"]').first().click();
  await page.waitForSelector('#songModal.open');
  const staleVerses = await page.inputValue('#formVerses');
  ok('stale-preview replace reached the lyrics',
    staleVerses.includes('E2ESTALE') && !staleVerses.includes('E2EREPLACED'), staleVerses.slice(0, 60));
  await page.locator('#songModal').locator('button:has-text("Cancel")').click().catch(() => {});
  await page.waitForSelector('#songModal.open', { state: 'detached' }).catch(() => {});
  // Undo puts the pre-replace text back, and says what it undid.
  ok('undo offered after a bulk replace',
    !(await page.evaluate(() => document.getElementById('adminUndoBar').hidden)) &&
    (await page.textContent('#adminUndoText')).includes('Replaced 2 matches'),
    JSON.stringify(await page.textContent('#adminUndoText')));
  await page.locator('#adminUndoBar').locator('button:has-text("Undo")').click();
  const undone = await page.waitForFunction(
    () => document.getElementById('adminUndoBar').hidden, null, { timeout: 5000 }).then(() => true).catch(() => false);
  ok('undo hides its own offer', undone);
  await page.locator('#adminSongList .admin-song-row button[title="Edit"]').first().click();
  await page.waitForSelector('#songModal.open');
  const undoneVerses = await page.inputValue('#formVerses');
  ok('undo restored the pre-replace lyrics',
    undoneVerses.includes('E2EREPLACED') && !undoneVerses.includes('E2ESTALE'), undoneVerses.slice(0, 60));
  await page.locator('#songModal').locator('button:has-text("Cancel")').click().catch(() => {});
  await page.waitForSelector('#songModal.open', { state: 'detached' }).catch(() => {});
  // delete it
  await page.locator('#adminSongList .admin-song-row button.del').click();
  await page.waitForSelector('#confirmModal.open');
  await page.locator('#confirmBtn').click();
  await page.waitForTimeout(400);
  ok('song deleted', (await page.locator('#adminSongList .admin-song-row').count()) === 0);
  await page.close();
});

// ═══════════════ 7. EXPORTS (downloads) ═══════════════
await section('exports', async () => {
  const page = await newPage();
  await waitLoaded(page);
  await openSettings(page);
  await page.locator('#settingsView').locator('text=Manage Songs').click();
  await page.waitForSelector('#adminView.active');
  await page.waitForFunction(() => document.querySelectorAll('#adminSongList .admin-song-row').length >= 200, null, { timeout: 15000 });
  // single song → txt
  await page.locator('#adminSongList .admin-song-row button[title="Export"]').first().click();
  await page.waitForSelector('#exportModal.open');
  await page.selectOption('#exportFormat', 'txt');
  const [dlTxt] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.locator('#exportModal').locator('button:has-text("Download")').click()]);
  const dl = dlTxt && typeof dlTxt.suggestedFilename === 'function' ? dlTxt : null;
  ok('single-song txt download (' + (dl ? dl.suggestedFilename() : 'none') + ')', !!dl && dl.suggestedFilename().endsWith('.txt'));
  await page.waitForSelector('#exportModal.open', { state: 'detached' }).catch(() => {});
  // all songs → json
  await page.locator('#adminView').locator('button[title="Export"]').first().click();
  await page.waitForSelector('#exportModal.open');
  const [dlJson] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.locator('#exportModal').locator('button:has-text("Download")').click()]);
  const dj = dlJson && typeof dlJson.suggestedFilename === 'function' ? dlJson : null;
  ok('all-songs json download (' + (dj ? dj.suggestedFilename() : 'none') + ')', !!dj && dj.suggestedFilename().startsWith('khristian-labu-all'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#exportModal.open', { state: 'detached' }).catch(() => {});
  ok('Escape closes export modal', await page.locator('#exportModal.open').count() === 0);
  // playlist scope appears in the picker
  await page.locator('#adminView').locator('button[title="Export"]').first().click();
  await page.waitForSelector('#exportModal.open');
  await page.selectOption('#exportScope', 'playlist');
  ok('playlist scope + picker', await page.locator('#exportPlaylistRow').isVisible());
  await page.keyboard.press('Escape');
  await page.close();
});

// ═══════════════ 8. THEME ═══════════════
await section('theme', async () => {
  const page = await newPage();
  await waitLoaded(page);
  await openSettings(page);
  await page.locator('#themeLight').click();
  await page.waitForTimeout(300);
  const light = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  ok('light theme applied', light.startsWith('#') || light.includes('255'), light);
  await page.locator('#themeDark').click();
  await page.waitForTimeout(300);
  const dark = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  ok('dark theme applied', dark !== light, dark + ' vs ' + light);
  ok('theme persists in localStorage', (await page.evaluate(() => localStorage.getItem('labu-theme'))) === 'dark');
  await page.close();
});

// ═══════════════ 8c. READER FONT FAMILY (Settings) ═══════════════
await section('reader font family', async () => {
  const page = await newPage();
  await waitLoaded(page);
  // open a song so a .verse p exists to measure the applied font
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songDetail .verse p');
  const family = () => page.evaluate(() => getComputedStyle(document.querySelector('#songDetail .verse p')).fontFamily);
  const baseFamily = await family();
  ok('song text uses the default (Inter) font', baseFamily.includes('Inter'), baseFamily);
  // settings has a font dropdown with a deep set of lyric fonts
  await openSettings(page);
  ok('settings has a font dropdown', await page.locator('#fontSelectBtn').isVisible());
  await page.locator('#fontSelectBtn').click();
  ok('font dropdown opens a glass menu', await page.locator('#fontSelectMenu').isVisible());
  ok('font dropdown offers lyric fonts', (await page.locator('#fontSelectMenu .font-dd-opt').count()) >= 12);
  // choosing a serif applies it to the open song's verses
  await page.locator('#fontSelectMenu .font-dd-opt[data-value="librebaskerville"]').click();
  await page.waitForTimeout(300);
  const serif = await family();
  ok('serif font applies to song text', serif.includes('Libre Baskerville'), serif);
  ok('serif choice persists in localStorage', (await page.evaluate(() => localStorage.getItem('labu-reader-family'))) === 'librebaskerville');
  ok('font dropdown reflects the active choice', (await page.locator('#fontSelectLabel').innerText()) === 'Libre Baskerville');
  // switching back to Default restores Inter
  await page.locator('#fontSelectBtn').click();
  await page.locator('#fontSelectMenu .font-dd-opt[data-value="default"]').click();
  await page.waitForTimeout(300);
  const def = await family();
  ok('default font restores Inter', def.includes('Inter'), def);
  ok('default choice persists in localStorage', (await page.evaluate(() => localStorage.getItem('labu-reader-family'))) === 'default');
  await page.close();
});

// ═══════════════ 8b. STATUS BAR (APK) ═══════════════
await section('status bar', async () => {
  const page = await newPage();
  await page.addInitScript(() => {
    window.__sbCalls = [];
    window.Capacitor = {
      Plugins: {
        StatusBar: {
          setOverlaysWebView: async o => window.__sbCalls.push(['overlay', o]),
          setBackgroundColor: async o => window.__sbCalls.push(['bg', o]),
          setStyle: async o => window.__sbCalls.push(['style', o]),
          // mimics an Android 15/16 device: native height known, but no safe-area
          // CSS insets injected (the broken edge-to-edge case)
          getInfo: async () => ({ height: 24, overlays: false, visible: true, style: 'LIGHT', color: '#0f0f13' }),
        },
      },
    };
  });
  await waitLoaded(page);
  const onLoad = await page.evaluate(() => window.__sbCalls);
  ok('status bar overlay disabled on launch (app below the bar)', onLoad.some(c => c[0] === 'overlay' && c[1].overlay === false), JSON.stringify(onLoad));
  ok('status bar color + icon style set on launch', onLoad.some(c => c[0] === 'style') && onLoad.some(c => c[0] === 'bg'), JSON.stringify(onLoad));
  // no safe-area CSS insets available (env/injected var both 0) → the native height
  // fallback keeps the app below the status bar
  await page.waitForTimeout(800);
  const sbFallback = await page.evaluate(() => ({
    varSet: getComputedStyle(document.documentElement).getPropertyValue('--sat-fallback').trim(),
    navPad: getComputedStyle(document.querySelector('nav')).paddingTop,
  }));
  ok('status bar height fallback applied (nav padded below bar)', sbFallback.varSet === '24px' && sbFallback.navPad === '24px', JSON.stringify(sbFallback));
  // theme switch re-applies the status bar to match
  await openSettings(page);
  await page.locator('#themeDark').click();
  await page.waitForTimeout(300);
  const afterDark = await page.evaluate(() => window.__sbCalls);
  const lastBg = [...afterDark].reverse().find(c => c[0] === 'bg');
  const lastStyle = [...afterDark].reverse().find(c => c[0] === 'style');
  ok('dark theme → dark status bar, light icons', lastBg && lastBg[1].color === '#090A10' && lastStyle && lastStyle[1].style === 'LIGHT', JSON.stringify({ lastBg, lastStyle }));
  await page.locator('#themeLight').click();
  await page.waitForTimeout(300);
  const afterLight = await page.evaluate(() => window.__sbCalls);
  const lb = [...afterLight].reverse().find(c => c[0] === 'bg');
  const ls = [...afterLight].reverse().find(c => c[0] === 'style');
  ok('light theme → light status bar, dark icons', lb && lb[1].color === '#F2F5FB' && ls && ls[1].style === 'DARK', JSON.stringify({ lb, ls }));
  await page.close();
});

// ═══════════════ 9. SETTINGS + GOOGLE SECTION ═══════════════
await section('settings & google', async () => {
  const page = await newPage();
  await waitLoaded(page);
  await openSettings(page);
  const ver = (await page.textContent('#appVersion')).trim();
  ok('version shown in settings (' + ver + ')', ver.length > 0);
  ok('backup/restore + google buttons present', (await page.locator('#settingsView').getByText('Backup data').count()) > 0 && (await page.locator('#settingsView').getByText('Restore from backup').count()) > 0);
  const g = await page.evaluate(() => ({
    section: !!document.getElementById('googleSection'),
    signedOut: getComputedStyle(document.getElementById('googleSignedOut')).display !== 'none',
    signedIn: getComputedStyle(document.getElementById('googleSignedIn')).display !== 'none',
    name: document.getElementById('googleName').textContent,
  }));
  ok('google section visible', g.section);
  ok('sign-in button when signed out', g.signedOut && !g.signedIn);
  // simulate signed-in state via localStorage + re-render
  await page.evaluate(() => {
    localStorage.setItem('labu_google', JSON.stringify({ email: 'e2e@test.dev', name: 'E2E Tester', picture: '' }));
    renderGoogleSection();
  });
  const g2 = await page.evaluate(() => ({
    signedOut: getComputedStyle(document.getElementById('googleSignedOut')).display !== 'none',
    signedIn: getComputedStyle(document.getElementById('googleSignedIn')).display !== 'none',
    name: document.getElementById('googleName').textContent,
    email: document.getElementById('googleEmail').textContent,
  }));
  ok('account row when signed in', !g2.signedOut && g2.signedIn && g2.name === 'E2E Tester' && g2.email === 'e2e@test.dev');
  ok('backup/restore google buttons', (await page.locator('#googleSection').getByText('Back up', { exact: true }).count()) > 0 && (await page.locator('#googleSection').getByText('Restore', { exact: true }).count()) > 0);
  // payload builder includes all data
  const payload = await page.evaluate(async () => {
    favorites.push('PAYLOAD_TEST_ID');
    const p = await buildBackupPayload();
    favorites.pop();
    return { hasFavs: !!p.favorites, hasRecents: Array.isArray(p.recents), hasPlaylists: Array.isArray(p.playlists), hasEdits: 'edits' in p, hasSettings: 'theme' in p, version: p.version };
  });
  ok('payload builder ok', payload.hasFavs && payload.hasRecents && payload.hasPlaylists && payload.hasEdits && payload.hasSettings, JSON.stringify(payload));
  await page.evaluate(() => { localStorage.removeItem('labu_google'); renderGoogleSection(); });
  await page.close();
});

// ═══════════════ 9a. HOME ACTIONS (website only: APK + GitHub) ═══════════════
await section('home actions', async () => {
  const APK = 'https://github.com/minatolun-dotcom/khristian-labu/releases/latest/download/khristian-labu.apk';
  const REPO_URL = 'https://github.com/minatolun-dotcom/khristian-labu';
  const check = async (vp, label) => {
    const page = await newPage(vp);
    await waitLoaded(page);
    const a = await page.evaluate(() => {
      const wrap = document.getElementById('homeActions');
      const apk = document.getElementById('homeApkBtn');
      const repo = document.getElementById('homeRepoBtn');
      const grid = document.getElementById('groupGrid');
      const stats = document.querySelector('#homeView .hero .stats');
      const box = wrap && wrap.getBoundingClientRect();
      const svg = apk && apk.querySelector('svg');
      const gb = grid && grid.getBoundingClientRect();
      return {
        display: wrap ? getComputedStyle(wrap).display : 'missing',
        visible: !!box && box.width > 0 && box.height > 0 && box.top < innerHeight,
        apkHref: apk && apk.getAttribute('href'),
        repoHref: repo && repo.getAttribute('href'),
        icon: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
        belowGrid: !!box && !!gb && box.top >= gb.bottom - 1,
        gap: box && gb ? Math.round(box.top - gb.bottom) : null,
        statsVisible: !!stats && stats.getBoundingClientRect().height > 0,
      };
    });
    ok(label + ': APK + GitHub buttons show on the home page', a.visible && a.display !== 'none', JSON.stringify(a));
    ok(label + ': buttons link to the APK asset and the repo', a.apkHref === APK && a.repoHref === REPO_URL, JSON.stringify(a));
    ok(label + ': android + github icons render', a.icon >= 14, String(a.icon));
    ok(label + ': buttons sit below the songbook list', a.belowGrid, JSON.stringify(a));
    ok(label + ': buttons hug the songbook list', a.gap !== null && a.gap <= 40, String(a.gap));
    if (label === 'desktop') ok('desktop: counters are removed', !a.statsVisible, JSON.stringify(a));
    await page.close();
  };
  await check({ width: 1280, height: 800 }, 'desktop');
  await check({ width: 390, height: 844 }, 'mobile');
  // A tall phone leaves free space that the old grid auto-margin used to absorb.
  await check({ width: 390, height: 1200 }, 'tall mobile');

  // the markup itself ships hidden, so a JS failure inside the APK cannot show it
  const nojs = await browser.newPage({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  await nojs.goto(URL, { waitUntil: 'domcontentloaded' });
  const markupHidden = await nojs.evaluate(() => {
    const w = document.getElementById('homeActions');
    return !!w && w.hasAttribute('hidden') && getComputedStyle(w).display === 'none';
  });
  ok('home actions are hidden in the raw markup (website reveals them)', markupHidden);
  await nojs.close();

  // inside the APK the row is removed: the app must not offer to download itself
  const native = await newPage();
  await native.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, Plugins: {} };
  });
  await waitLoaded(native);
  const gone = await native.evaluate(() => ({ native: window.Capacitor.isNativePlatform(), wrap: !!document.getElementById('homeActions') }));
  ok('APK home hides the download/GitHub buttons', gone.native === true && gone.wrap === false, JSON.stringify(gone));
  await native.close();
});

// ═══════════════ 9b. UPDATE CHECK (native dialog → resumable download) ═══════════════
await section('update check', async () => {
  // The website is always the newest build; it must not offer a manual check or
  // open an update dialog at startup.
  const web = await newPage();
  await web.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes('version.json')) return { ok: true, json: async () => ({ version: '9.9.9' }) };
      if (String(url).includes('latest.json')) return { ok: true, json: async () => ({ version: '9.9.9' }) };
      return realFetch(url, opts);
    };
  });
  await waitLoaded(web);
  await web.waitForTimeout(700);
  const webState = await web.evaluate(() => ({
    row: !!document.getElementById('checkUpdateRow'),
    rowDisplay: document.getElementById('checkUpdateRow') ? getComputedStyle(document.getElementById('checkUpdateRow')).display : 'missing',
    overlay: !document.getElementById('updateOverlay').hidden,
    fab: !document.getElementById('updateFab').hidden,
  }));
  ok('website hides Check for update', webState.row && webState.rowDisplay === 'none', JSON.stringify(webState));
  ok('website does not run a startup update check', !webState.overlay && !webState.fab, JSON.stringify(webState));
  await web.close();

  // Native startup: latest.json is newer than version.json, so the max wins.
  const native = await newPage();
  await native.addInitScript(() => {
    window.__starts = [];
    window.__settingsOpened = 0;
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, Plugins: {} };
    window.KhristianUpdate = {
      isInstallAllowed: () => true,
      openInstallSettings: () => { window.__settingsOpened++; },
      start: (url, sha256, size, version) => { window.__starts.push({ url, sha256, size, version }); },
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes('version.json')) return { ok: true, json: async () => ({ version: '1.5.64' }) };
      if (String(url).includes('latest.json')) return { ok: true, json: async () => ({
        version: '9.9.9',
        url: 'https://dl.labu.lengkhawm.online/apk/9999/khristian-labu.apk',
        sha256: 'a'.repeat(64),
        size: 123456,
      }) };
      return realFetch(url, opts);
    };
  });
  await waitLoaded(native);
  await native.waitForSelector('#updateOverlay:not([hidden])', { timeout: 15000 });
  await native.waitForFunction(() => window.__starts.length === 1, null, { timeout: 5000 });
  ok('native startup picks the newer latest.json version', (await native.textContent('#updVer')) === '9.9.9');
  ok('native settings exposes Check for update', await native.evaluate(() => getComputedStyle(document.getElementById('checkUpdateRow')).display !== 'none'));
  const started = await native.evaluate(() => window.__starts[0]);
  ok('native update uses the verified APK metadata', started.url.includes('/apk/9999/') && started.sha256 === 'a'.repeat(64) && started.size === '123456' && started.version === '9.9.9', JSON.stringify(started));
  const box = await native.locator('#updateBanner').boundingBox();
  const vp = native.viewportSize();
  ok('update dialog is centered on screen', !!box && Math.abs((box.y + box.height / 2) - vp.height / 2) < 40 && box.x >= 0 && box.x + box.width <= vp.width, JSON.stringify({ box, vp }));
  await native.evaluate(() => window.__labuUpdateProgress('downloading', 42, 'Downloading update…'));
  const dl = await native.evaluate(() => ({
    visible: !document.getElementById('updProgress').hidden,
    fill: document.getElementById('updProgressFill').style.width,
    note: document.getElementById('updProgressNote').textContent,
    buttonHidden: document.getElementById('updBtn').hidden,
  }));
  ok('native download shows progress and hides the action', dl.visible && dl.fill === '42%' && dl.note.includes('42') && dl.buttonHidden, JSON.stringify(dl));
  await native.mouse.click(5, 5);
  const minimized = await native.evaluate(() => ({
    overlay: document.getElementById('updateOverlay').hidden,
    fab: !document.getElementById('updateFab').hidden,
    label: document.getElementById('updateFabText').textContent,
  }));
  ok('clicking outside minimizes but keeps downloading', minimized.overlay && minimized.fab && /42%/.test(minimized.label), JSON.stringify(minimized));
  await native.evaluate(() => window.__labuUpdateProgress('downloading', 67, 'Downloading update…'));
  ok('floating download pill tracks progress', /67%/.test(await native.textContent('#updateFabText')));
  await native.locator('#updateFab').click();
  const restored = await native.evaluate(() => ({
    overlay: document.getElementById('updateOverlay').hidden,
    fab: document.getElementById('updateFab').hidden,
    fill: document.getElementById('updProgressFill').style.width,
  }));
  ok('floating pill restores the dialog', !restored.overlay && restored.fab && restored.fill === '67%', JSON.stringify(restored));
  await native.evaluate(() => window.__labuUpdateProgress('permission', 0, 'Allow installs'));
  const permission = await native.evaluate(() => ({ label: document.getElementById('updBtn').textContent, visible: !document.getElementById('updBtn').hidden }));
  ok('unknown-sources state offers Settings', permission.label === 'Open settings' && permission.visible, JSON.stringify(permission));
  await native.locator('#updBtn').click();
  ok('unknown-sources Settings button calls the bridge', (await native.evaluate(() => window.__settingsOpened)) === 1);
  await native.evaluate(() => window.__labuUpdateProgress('error', 0, 'Checksum failed'));
  const retry = await native.evaluate(() => ({ label: document.getElementById('updBtn').textContent, note: document.getElementById('updProgressNote').textContent }));
  ok('native update errors show Retry', retry.label === 'Retry' && retry.note.includes('Checksum'), JSON.stringify(retry));
  ok('update flow creates no toasts', (await native.locator('.toast').count()) === 0);
  await native.close();

  // Regression: 1.5.75 shipped a stale bundled APP_VERSION (1.5.74) with a 1.5.75
  // package, so it downloaded and "installed" itself on every launch. The installed
  // package version from Capacitor App decides; the bundled constant does not.
  const installed = await newPage();
  await installed.addInitScript(() => {
    window.__starts = [];
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false,
      Plugins: { App: { addListener: () => {}, getInfo: async () => ({ version: '9.9.9', build: '9999' }) } },
    };
    window.KhristianUpdate = {
      isInstallAllowed: () => true, openInstallSettings: () => {},
      start: (url, sha256, size, version) => { window.__starts.push({ version }); },
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes('version.json')) return { ok: true, json: async () => ({ version: '9.9.9' }) };
      if (String(url).includes('latest.json')) return { ok: true, json: async () => ({ version: '9.9.9' }) };
      return realFetch(url, opts);
    };
  });
  await waitLoaded(installed);
  await installed.waitForTimeout(900);
  const installedState = await installed.evaluate(() => ({
    overlay: document.getElementById('updateOverlay').hidden,
    starts: window.__starts.length,
    shown: document.getElementById('appVersion').textContent,
  }));
  ok('an already-installed release never offers itself', installedState.overlay && installedState.starts === 0, JSON.stringify(installedState));
  ok('settings shows the installed package version', installedState.shown === '9.9.9', JSON.stringify(installedState));
  await installed.close();

  // Already current: inline Settings status, no dialog, no redirect, no toast.
  const current = await newPage();
  await current.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, Plugins: {} };
    window.KhristianUpdate = { isInstallAllowed: () => true, openInstallSettings: () => {}, start: () => {} };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes('version.json')) return { ok: true, json: async () => ({ version: '0.0.1' }) };
      if (String(url).includes('latest.json')) return { ok: true, json: async () => ({ version: '0.0.1' }) };
      return realFetch(url, opts);
    };
  });
  await waitLoaded(current);
  await current.evaluate(() => openSettings());
  await current.waitForSelector('#settingsView.active');
  await current.locator('#checkUpdateRow').click();
  await current.waitForFunction(() => !document.getElementById('updateStatus').hidden);
  ok('up-to-date check shows inline status', (await current.textContent('#updateStatus')).includes('latest version'));
  ok('up-to-date check leaves the dialog hidden', await current.locator('#updateOverlay').isHidden());
  ok('up-to-date check creates no toast', (await current.locator('.toast').count()) === 0);
  const checkBusy = await current.evaluate(() => {
    setCheckUpdateBusy(true);
    const row = document.getElementById('checkUpdateRow');
    return {
      disabled: row.disabled,
      busy: row.getAttribute('aria-busy'),
      label: row.querySelector('.sr-label').textContent,
      spinner: !!row.querySelector('.row-spinner'),
    };
  });
  ok('check for update shows a spinner while checking',
    checkBusy.disabled && checkBusy.busy === 'true' && checkBusy.label === 'Checking…' && checkBusy.spinner,
    JSON.stringify(checkBusy));
  const checkIdle = await current.evaluate(() => {
    setCheckUpdateBusy(false);
    const row = document.getElementById('checkUpdateRow');
    return {
      disabled: row.disabled,
      label: row.querySelector('.sr-label').textContent,
      spinner: !!row.querySelector('.row-spinner'),
    };
  });
  ok('check for update restores its label and row',
    !checkIdle.disabled && checkIdle.label === 'Check for update' && !checkIdle.spinner,
    JSON.stringify(checkIdle));
  await current.close();

  // Manual check must also notice a newer latest.json when version.json is stale.
  const manual = await newPage();
  await manual.addInitScript(() => {
    window.__latestVersion = '0.0.1';
    window.__starts = [];
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, Plugins: {} };
    window.KhristianUpdate = {
      isInstallAllowed: () => true,
      openInstallSettings: () => {},
      start: (url, sha256, size, version) => { window.__starts.push({ url, sha256, size, version }); },
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes('version.json')) return { ok: true, json: async () => ({ version: '1.5.64' }) };
      if (String(url).includes('latest.json')) return { ok: true, json: async () => ({
        version: window.__latestVersion,
        url: 'https://dl.labu.lengkhawm.online/apk/9998/khristian-labu.apk',
        sha256: 'b'.repeat(64),
        size: 123456,
      }) };
      return realFetch(url, opts);
    };
  });
  await waitLoaded(manual);
  await manual.evaluate(() => { window.__latestVersion = '9.9.9'; openSettings(); });
  await manual.waitForSelector('#settingsView.active');
  await manual.waitForTimeout(500);
  await manual.locator('#checkUpdateRow').click({ force: true });
  await manual.waitForFunction(() => window.__starts.length === 1, null, { timeout: 5000 });
  ok('manual check does not report latest when latest.json is newer', (await manual.textContent('#updVer')) === '9.9.9' && (await manual.evaluate(() => window.__latestVersion)) === '9.9.9');
  await manual.close();
});

// ═══════════════ 10. HISTORY API ═══════════════
await section('history api', async () => {
  const page = await newPage();
  await waitLoaded(page);
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songDetail .verse');
  await page.goBack(); await page.waitForSelector('#songGrid .song-item');
  ok('back from detail → list', true);
  await page.goBack(); await page.waitForSelector('#categoryGrid .cat-card');
  ok('back from list → category', true);
  await page.goBack(); await page.waitForSelector('#groupGrid .cat-card');
  ok('back from category → home', true);
  await page.goForward(); await page.waitForSelector('#categoryGrid .cat-card');
  ok('forward → category again', true);
  await page.close();
});

// ═══════════════ 11. MOBILE (touch swipe + layout) ═══════════════
await section('mobile', async () => {
  const page = await newPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  await waitLoaded(page);
  // bottom tab bar replaces the hamburger on phones
  ok('mobile tab bar visible with 5 tabs', (await page.locator('#tabBar .tab').count()) === 5 && await page.locator('#tabBar').isVisible());
  ok('mobile tab bar active = home', (await page.locator('#tabBar .tab.active').getAttribute('data-tab')) === 'home');
  ok('mobile header hides hamburger + search toggle', await page.locator('#menuBtn').isHidden() && await page.locator('#searchToggle').isHidden());
  // search tab opens the shared search modal
  await page.locator('#tabBar .tab[data-tab="search"]').click();
  await page.waitForSelector('#searchModal.open');
  await page.waitForTimeout(300);
  ok('search tab opens the search modal', await page.locator('#searchModalInput').isVisible());
  ok('search modal covers the phone screen', await page.evaluate(() => {
    const r = document.querySelector('#searchModal .search-modal').getBoundingClientRect();
    return r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1;
  }));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#searchModal:not(.open)', { state: 'attached' });
  await page.locator('#tabBar .tab[data-tab="fav"]').click();
  await page.waitForTimeout(700);
  ok('favourites tab opens favourites list', (await page.textContent('#listHeader h2')).trim() === 'Favourites');
  await page.locator('#tabBar .tab[data-tab="settings"]').click();
  await page.waitForTimeout(600);
  ok('settings tab opens the settings page', await page.locator('#settingsView.active').count() === 1);
  ok('settings tab is active on its page', (await page.locator('#tabBar .tab.active').getAttribute('data-tab')) === 'settings');
  await page.locator('#tabBar .tab[data-tab="home"]').click();
  await page.waitForTimeout(600);
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
  const first = (await page.locator('#songGrid .song-item .song-title').first().textContent()).trim();
  const second = (await page.locator('#songGrid .song-item .song-title').nth(1).textContent()).trim();
  // open the SECOND song, then swipe right → previous (first) song
  await page.locator('#songGrid .song-item').nth(1).click();
  await page.waitForSelector('#songDetail .verse');
  await page.evaluate(() => {
    const el = document.getElementById('songDetail');
    const mk = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    const fire = (type, opts) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, ...opts }));
    fire('touchstart', { touches: [mk(120, 400)], targetTouches: [mk(120, 400)], changedTouches: [mk(120, 400)] });
    fire('touchmove', { touches: [mk(250, 400)], targetTouches: [mk(250, 400)], changedTouches: [mk(250, 400)] });
    fire('touchend', { touches: [], targetTouches: [], changedTouches: [mk(300, 400)] });
  });
  await page.waitForTimeout(700);
  const afterSwipe = (await page.locator('#songDetail .song-header-center h1').textContent()).trim();
  ok('swipe right goes to previous song (' + afterSwipe + ')', afterSwipe === first, 'expected ' + first + ' got ' + afterSwipe + ' (2nd=' + second + ')');
  // layout: footer + FAB within viewport, FAB above the footer
  const footer = await page.locator('#readerControlsHost').boundingBox();
  const fab = await page.locator('#waFabWrap .wa-fab').boundingBox();
  ok('footer within viewport', !!footer && footer.y + footer.height <= 846, JSON.stringify(footer));
  ok('mobile fab above footer', !!fab && !!footer && fab.y + fab.height < footer.y, JSON.stringify({ fab, footer }));
  await page.close();
});

// ═══════════════ 9c. CHORD STUDIO (direct-manipulation editor) ═══════════════
await section('chord studio', async () => {
  const page = await newPage();
  await waitLoaded(page);
  const openSong = async (title) => {
    await page.locator('#groupGrid .cat-card').first().click();
    await page.waitForSelector('#categoryGrid .cat-card');
    await page.locator('#categoryGrid .cat-card').filter({ hasText: 'Biakna Late' }).first().click();
    await page.waitForSelector('#songGrid .song-item');
    await page.locator('#songGrid .song-item').filter({ hasText: title }).first().click();
    await page.waitForSelector('#songDetail .verse');
    await page.evaluate(() => setReaderMode('chords'));
    await page.waitForSelector('.chord-sheet');
  };
  await openSong('Jesu Minlian');
  await page.locator('.chord-tool-edit').click();
  await page.waitForSelector('#chordModal.open #ceCanvas .ce-line');
  await sleep(250);
  const l0 = '.ce-line[data-b="0"][data-l="0"]';

  ok('chord editor is a lyric canvas, not text boxes',
    (await page.locator('#chordEditorRows, #chordModal input.chord-editor-input').count()) === 0 &&
    (await page.locator('#ceCanvas .ce-ch').count()) > 20);
  const coverage = await page.evaluate(() => ({
    verses: CE.blocks.length,
    counts: CE.blocks.map(b => b.lines.reduce((n, line) => n + line.chords.length, 0)),
  }));
  ok('bundled BL_1 chart loads chords on all six verses',
    coverage.verses === 6 && coverage.counts.every(n => n > 0), JSON.stringify(coverage));
  const state0 = await page.evaluate(() => ({ key: CE.key, chords: CE.blocks[0].lines[0].chords.slice() }));
  ok('existing chart opens on character positions', state0.key === 'G' && state0.chords.length === 3 && state0.chords.every(c => Number.isInteger(c.pos)), JSON.stringify(state0));
  const aligned = await page.evaluate(() => {
    const line = document.querySelector('.ce-line[data-b="0"][data-l="0"]');
    return [...line.querySelectorAll('.ce-chord')].map(el => {
      const ch = line.querySelector('.ce-ch[data-i="' + el.dataset.pos + '"]');
      return +(el.getBoundingClientRect().left - ch.getBoundingClientRect().left).toFixed(1);
    });
  });
  ok('chords sit exactly above their character', aligned.length === 3 && aligned.every(d => Math.abs(d) <= 1), JSON.stringify(aligned));

  // add at a character
  await page.locator(l0 + ' .ce-ch[data-i="5"]').click();
  await page.waitForSelector('#ceWheel:not([hidden])');
  const family = await page.$$eval('#ceWheelStage .ce-wheel-chip', els => els.map(e => e.dataset.chord));
  ok('key wheel suggests the G family', JSON.stringify(family) === JSON.stringify(['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim']), JSON.stringify(family));
  const minorFamily = await page.evaluate(() => ceDiatonic('Am'));
  ok('minor keys get their own chord family', JSON.stringify(minorFamily) === JSON.stringify(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']), JSON.stringify(minorFamily));

  // Dismissals: the picker must close from its x, from a tap outside, and from
  // Escape — and dismissing must never chart a chord underneath.
  await page.locator('#ceWheel .ce-wheel-close').click();
  await sleep(120);
  ok('the picker closes from its x button', await page.evaluate(() => document.getElementById('ceWheel').hidden && CE.wheel === null));
  const chordsBeforeDismiss = await page.evaluate(() => CE.blocks[0].lines[0].chords.length);
  await page.locator(l0 + ' .ce-ch[data-i="8"]').click();
  await page.waitForSelector('#ceWheel:not([hidden])');
  const headerBox = await page.locator('#chordModal .modal-header').boundingBox();
  await page.mouse.click(headerBox.x + 12, headerBox.y + headerBox.height / 2);
  await sleep(150);
  ok('tapping outside the picker dismisses it', await page.evaluate(() => document.getElementById('ceWheel').hidden && CE.wheel === null));
  ok('dismissing the picker leaves the chart untouched',
    (await page.evaluate(() => CE.blocks[0].lines[0].chords.length)) === chordsBeforeDismiss);
  await page.locator(l0 + ' .ce-ch[data-i="8"]').click();
  await page.waitForSelector('#ceWheel:not([hidden])');
  await page.keyboard.press('Escape');
  await sleep(120);
  ok('Escape closes the picker but keeps the studio open',
    await page.evaluate(() => document.getElementById('ceWheel').hidden && document.getElementById('chordModal').classList.contains('open')));
  await page.locator(l0 + ' .ce-ch[data-i="5"]').click();
  await page.waitForSelector('#ceWheel:not([hidden])');
  await page.locator('#ceWheelStage .ce-wheel-chip[data-chord="C"]').click();
  await sleep(150);
  ok('tap a lyric + pick a chord inserts it at that character', await page.evaluate(() => CE.blocks[0].lines[0].chords.some(c => c.pos === 5 && c.ch === 'C')));
  ok('editor marks the chart dirty', await page.evaluate(() => CE.dirty === true));

  // adjacent chords must sit beside each other, never stacked or overlapping
  await page.locator(l0 + ' .ce-ch[data-i="6"]').click();
  await page.waitForSelector('#ceWheel:not([hidden])');
  await page.locator('#ceWheelStage .ce-wheel-chip[data-chord="D"]').click();
  await sleep(200);
  const neighbour = await page.evaluate(() => {
    const line = document.querySelector('.ce-line[data-b="0"][data-l="0"]');
    const chips = [...line.querySelectorAll('.ce-chord')].map(el => {
      const r = el.getBoundingClientRect();
      return { pos: el.dataset.pos, l: r.left, r: r.right, t: Math.round(r.top), b: r.bottom };
    });
    const hits = [];
    for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
      const a = chips[i], b = chips[j];
      if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) hits.push(a.pos + '/' + b.pos);
    }
    return { hits: hits, rows: new Set(chips.map(c => c.t)).size };
  });
  ok('adjacent chords sit side by side without overlapping', neighbour.hits.length === 0 && neighbour.rows === 1, JSON.stringify(neighbour));
  await page.locator(l0 + ' .ce-chord[data-pos="6"]').click();
  await page.waitForSelector('#ceWheel:not([hidden])');
  await page.locator('#ceWheelRemove').click();
  await sleep(260);

  // replace
  await page.locator(l0 + ' .ce-chord[data-pos="5"]').click();
  await page.waitForSelector('#ceWheel:not([hidden])');
  ok('tapping a chord opens the wheel in replace mode', (await page.textContent('#ceWheelTitle')).startsWith('Replace C'));
  await page.locator('#ceWheelStage .ce-wheel-chip[data-chord="Am"]').click();
  await sleep(150);
  ok('picking another chord replaces it without duplicating', await page.evaluate(() => {
    const chords = CE.blocks[0].lines[0].chords.filter(c => c.pos === 5);
    return chords.length === 1 && chords[0].ch === 'Am';
  }));

  // drag
  await page.evaluate(() => {
    window.__haptics = [];
    _hapticsOn = true;
    _lastHapticAt = 0;
    try {
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: ms => { window.__haptics.push(ms); return true; },
      });
    } catch (e) {}
  });
  const box = await page.locator(l0 + ' .ce-chord[data-pos="5"]').boundingBox();
  const target = await page.locator(l0 + ' .ce-ch[data-i="12"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 2, box.y + box.height / 2, { steps: 8 });
  const dragging = await page.evaluate(() => ({
    cls: !!document.querySelector('.ce-line[data-b="0"][data-l="0"] .ce-chord.dragging'),
    guide: !!document.querySelector('#ceCanvas .ce-guide'),
    drop: !!document.querySelector('#ceCanvas .ce-drop'),
    haptics: (window.__haptics || []).length,
  }));
  ok('dragging shows a guide and highlights the character underneath', dragging.cls && dragging.guide && dragging.drop, JSON.stringify(dragging));
  ok('dragging across characters gives haptic feedback', dragging.haptics > 0, JSON.stringify(dragging));
  await page.mouse.up();
  await sleep(150);
  ok('released chord snaps to the nearest character', await page.evaluate(() => CE.blocks[0].lines[0].chords.some(c => c.pos === 12 && c.ch === 'Am')));

  // swipe up to delete
  const box2 = await page.locator(l0 + ' .ce-chord[data-pos="12"]').boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2, box2.y - 90, { steps: 10 });
  ok('swiping a chord up arms deletion', (await page.locator('.ce-chord.will-delete').count()) === 1);
  await page.mouse.up();
  await sleep(320);
  ok('swipe up removes the chord', await page.evaluate(() => !CE.blocks[0].lines[0].chords.some(c => c.pos === 12)));

  // undo / redo
  await page.keyboard.press('Control+z');
  await sleep(150);
  ok('undo restores a deleted chord', await page.evaluate(() => CE.blocks[0].lines[0].chords.some(c => c.pos === 12)));
  await page.keyboard.press('Control+Shift+z');
  await sleep(150);
  ok('redo re-applies the deletion', await page.evaluate(() => !CE.blocks[0].lines[0].chords.some(c => c.pos === 12)));

  // keyboard: nudge + delete
  await page.locator(l0 + ' .ce-chord[data-pos="0"]').click();
  await page.waitForSelector('#ceWheel:not([hidden])');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight');
  await sleep(150);
  ok('arrow keys nudge the selected chord one character', await page.evaluate(() => CE.blocks[0].lines[0].chords.some(c => c.pos === 1)));
  await page.keyboard.press('Backspace');
  await sleep(280);
  ok('Delete/Backspace removes the selected chord', await page.evaluate(() => !CE.blocks[0].lines[0].chords.some(c => c.pos === 1)));

  // extended wheel + custom
  await page.locator(l0 + ' .ce-ch[data-i="22"]').click();
  await page.waitForSelector('#ceWheel:not([hidden])');
  await page.locator('#ceWheelHub').click();
  await sleep(250);
  const ext = await page.$$eval('#ceWheelStage .ce-wheel-chip', els => els.map(e => e.dataset.chord));
  ok('More opens the extended chord wheel', ['Gmaj7', 'Gm7', 'G7', 'Gsus2', 'Gsus4', 'Gdim', 'Gaug', 'G/B'].every(c => ext.includes(c)) && await page.locator('#ceWheelRootRow').isVisible(), ext.join(','));
  await page.locator('#ceWheelCustom').fill('F#m7/C#');
  await page.locator('#ceWheelCustomForm button').click();
  await sleep(200);
  ok('custom chord names are accepted', await page.evaluate(() => CE.blocks[0].lines[0].chords.some(c => c.ch === 'F#m7/C#')));
  await page.locator(l0 + ' .ce-ch[data-i="24"]').click();
  await page.waitForSelector('#ceWheel:not([hidden])');
  await page.locator('#ceWheelCustom').fill('H7');
  await page.locator('#ceWheelCustomForm button').click();
  await sleep(150);
  ok('an invalid custom chord is rejected', (await page.locator('#ceWheel').isVisible()) && await page.evaluate(() => !CE.blocks[0].lines[0].chords.some(c => c.pos === 24)));
  await page.keyboard.press('Escape');

  // key change
  const beforePositions = await page.evaluate(() => CE.blocks[0].lines[0].chords.map(c => c.pos));
  await page.locator('#chordEditKey').fill('A');
  await page.locator('#chordEditKey').dispatchEvent('change');
  await sleep(250);
  const keyState = await page.evaluate(() => ({
    key: CE.key,
    chords: CE.blocks[0].lines[0].chords.map(c => c.ch),
    positions: CE.blocks[0].lines[0].chords.map(c => c.pos)
  }));
  ok('key change transposes the chord names', keyState.key === 'A' && keyState.chords.includes('A') && keyState.chords.includes('E') && keyState.chords.includes('G#m7/D#'), JSON.stringify(keyState.chords));
  ok('key change preserves character positions', JSON.stringify(keyState.positions) === JSON.stringify(beforePositions), JSON.stringify(keyState.positions));

  // save + reader + reopen
  await page.locator('#ceSaveBtn').click();
  await sleep(600);
  ok('save closes the studio', !(await page.evaluate(() => document.getElementById('chordModal').classList.contains('open'))));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('labu_chord_charts_v1') || '{}').BL_1);
  ok('saved chart stores character positions', !!saved && saved.verseLines[0][0].every(s => Number.isInteger(s.pos) && typeof s.at === 'number'), JSON.stringify(saved && saved.verseLines[0][0]).slice(0, 160));
  const readAlign = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.chord-line-pos').forEach(lineEl => {
      lineEl.querySelectorAll('.chord-read').forEach(el => {
        const ch = lineEl.querySelector('.ce-ch[data-i="' + el.dataset.pos + '"]');
        if (ch) out.push(+(el.getBoundingClientRect().left - ch.getBoundingClientRect().left).toFixed(1));
      });
    });
    return out;
  });
  ok('reader places every chord above its character (0px drift)', readAlign.length > 0 && readAlign.every(d => Math.abs(d) <= 1), JSON.stringify(readAlign));
  ok('reader shows the saved chart', (await page.locator('.chord-sheet .chord-read').count()) > 0);

  // guitar chord popup
  await page.locator('.chord-summary .chord-pill').first().click();
  await page.waitForSelector('#chordPop:not([hidden])');
  const popInfo = await page.evaluate(() => {
    const pop = document.getElementById('chordPop');
    const r = pop.getBoundingClientRect();
    const pill = document.querySelector('.chord-summary .chord-pill').getBoundingClientRect();
    return {
      name: document.getElementById('chordPopName').textContent,
      pill: document.querySelector('.chord-summary .chord-pill').textContent,
      dots: document.querySelectorAll('#chordPopDiagram .gcd-dot, #chordPopDiagram .gcd-barre').length,
      strings: document.querySelectorAll('#chordPopDiagram .gcd-string').length,
      anim: pop.classList.contains('in'),
      origin: getComputedStyle(pop).transformOrigin,
      dx: Math.abs((pill.left + pill.width / 2) - (r.left + r.width / 2)),
      half: r.width / 2
    };
  });
  ok('chord pill opens a guitar shape popup that zooms from the pill',
    popInfo.name === popInfo.pill.trim() && popInfo.dots > 0 && popInfo.strings === 6 && popInfo.anim && popInfo.dx < popInfo.half,
    JSON.stringify(popInfo));
  const shapeAudit = await page.evaluate(() => {
    const roots = ['C', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const quals = ['', 'm', '7', 'maj7', 'm7', '6', 'm6', '9', 'sus2', 'sus4', 'dim', 'dim7', 'aug'];
    const names = ['G/B', 'Am/G', 'D/F#'];
    roots.forEach(r => quals.forEach(q => names.push(r + q)));
    return names.map(name => {
      const p = guitarParseChord(name);
      const tones = new Set(guitarIntervals(p.quality).map(i => (p.rootPc + i) % 12));
      const sh = guitarShapeFor(name);
      if (!sh) return { name: name, ok: false, why: 'no shape' };
      const pcs = sh.sounding.map(s => (GUITAR_STRING_PC[s] + sh.frets[s]) % 12);
      const target = p.bassPc == null ? p.rootPc : p.bassPc;
      const allIn = pcs.every((pc, i) => tones.has(pc) || (i === 0 && pc === target));
      return { name: name, ok: allIn && pcs[0] === target && sh.span <= 4 && sh.sounding.length >= 4 };
    });
  });
  ok('every chord gets a valid guitar voicing (chord tones + correct bass)',
    shapeAudit.every(s => s.ok), JSON.stringify(shapeAudit.filter(s => !s.ok)).slice(0, 220));
  await page.locator('#chordPopPlay').click();
  await sleep(220);
  const guitar = await page.evaluate(() => ({
    last: typeof _guitarLast !== 'undefined' ? _guitarLast : null,
    voices: typeof _guitarVoices !== 'undefined' ? _guitarVoices.length : 0,
    playing: document.getElementById('chordPopPlay').classList.contains('playing')
  }));
  ok('speaker button strums the chord in a guitar voice', !!guitar.last && guitar.last.midi.length >= 4 && guitar.voices >= 4, JSON.stringify({ notes: guitar.last && guitar.last.midi.length, voices: guitar.voices, playing: guitar.playing }));
  await page.locator('#chordPopBackdrop').click({ position: { x: 5, y: 5 } });
  await sleep(150);
  ok('chord popup closes from the backdrop', await page.evaluate(() => document.getElementById('chordPop').hidden));
  await page.locator('.chord-tool-edit').click();
  await page.waitForSelector('#chordModal.open #ceCanvas .ce-line');
  await sleep(200);
  ok('reopening restores the edited positions', await page.evaluate(() => CE.blocks[0].lines[0].chords.some(c => c.ch === 'G#m7/D#')));

  // Clearing a line must drop its chord lane; then a single tap in that empty
  // lane above the lyric has to chart the nearest syllable and lift the chip
  // back above the text instead of sitting on it.
  const laneBackup = await page.evaluate(() => CE.blocks[0].lines[1].chords.slice());
  await page.evaluate(() => {
    CE.blocks[0].lines[1].chords = [];
    ceLayoutLine(document.querySelector('.ce-line[data-b="0"][data-l="1"]'));
  });
  const laneSel = '.ce-line[data-b="0"][data-l="1"]';
  ok('a line without chords releases the reserved lane',
    !(await page.locator(laneSel).evaluate(el => el.classList.contains('has-chords'))));
  const laneBox = await page.locator(laneSel + ' .ce-word').first().boundingBox();
  await page.mouse.click(laneBox.x + 4, laneBox.y + 4);
  await page.waitForSelector('#ceWheel:not([hidden])');
  await page.locator('#ceWheelStage .ce-wheel-chip[data-chord="D"]').click();
  await sleep(200);
  const lanePlaced = await page.evaluate(sel => {
    const line = document.querySelector(sel);
    const chip = line.querySelector('.ce-chord');
    const text = line.querySelector('.ce-txt');
    return {
      has: line.classList.contains('has-chords'),
      chords: CE.blocks[0].lines[1].chords.length,
      chipBottom: chip.getBoundingClientRect().bottom,
      textTop: text.getBoundingClientRect().top
    };
  }, laneSel);
  ok('one tap in the empty chord lane charts the nearest syllable', lanePlaced.chords === 1, JSON.stringify(lanePlaced));
  ok('a newly charted line lifts the chord above the lyric',
    lanePlaced.has && lanePlaced.chipBottom <= lanePlaced.textTop + 0.5, JSON.stringify(lanePlaced));
  // Put the line back so closing the studio doesn't raise the discard prompt.
  await page.evaluate(chords => {
    CE.blocks[0].lines[1].chords = chords;
    ceLayoutLine(document.querySelector('.ce-line[data-b="0"][data-l="1"]'));
    ceMarkDirty();
  }, laneBackup);
  await page.locator('#chordModal .modal-close').click();

  // published fractional charts still work
  await page.goBack();
  await page.waitForSelector('#songGrid .song-item');
  await page.locator('#songGrid .song-item').filter({ hasText: 'Hon Halhsak Nawn In' }).first().click();
  await page.waitForSelector('#songDetail .verse');
  await page.evaluate(() => setReaderMode('chords'));
  await page.waitForSelector('.chord-sheet');
  ok('published fractional charts still render', (await page.locator('.chord-sheet [data-chord]').count()) > 0);
  await page.locator('.chord-tool-edit').click();
  await page.waitForSelector('#chordModal.open #ceCanvas .ce-line');
  await sleep(200);
  ok('fractional charts convert to character positions in the editor', await page.evaluate(() => CE.blocks.every(b => b.lines.every(l => l.chords.every(c => Number.isInteger(c.pos))))));
  await page.locator('#chordModal .modal-close').click();
  await page.close();

  // phone: compact wheel, grid fallback, wrapped lines
  const mp = await newPage({ width: 390, height: 844 }, { hasTouch: true });
  await waitLoaded(mp);
  await mp.evaluate(() => {
    // setReaderFont applies an inline custom property, so an injected stylesheet loses
    document.documentElement.style.setProperty('--reader-font', '40px');
    document.documentElement.style.setProperty('--reader-lh', '1.7');
  });
  await mp.locator('#groupGrid .cat-card').first().click();
  await mp.waitForSelector('#categoryGrid .cat-card');
  await mp.locator('#categoryGrid .cat-card').filter({ hasText: 'Biakna Late' }).first().click();
  await mp.waitForSelector('#songGrid .song-item');
  await mp.locator('#songGrid .song-item').filter({ hasText: 'Jesu Minlian' }).first().click();
  await mp.waitForSelector('#songDetail .verse');
  await mp.evaluate(() => setReaderMode('chords'));
  await mp.waitForSelector('.chord-sheet');
  await mp.locator('.chord-tool-edit').click();
  await mp.waitForSelector('#chordModal.open #ceCanvas .ce-line');
  // One touch tap on a lyric must open the picker (no long press), and the
  // picker must dismiss from its x or from a tap outside it.
  const tapGlyph = await mp.locator('.ce-line[data-b="0"][data-l="0"] .ce-ch[data-i="3"]').boundingBox();
  await mp.touchscreen.tap(tapGlyph.x + tapGlyph.width / 2, tapGlyph.y + tapGlyph.height / 2);
  await mp.waitForSelector('#ceWheel:not([hidden])', { timeout: 3000 });
  ok('one touch tap on a lyric opens the chord picker', true);
  await mp.locator('#ceWheel .ce-wheel-close').tap();
  await sleep(150);
  ok('a touch tap on the picker x closes it', await mp.evaluate(() => document.getElementById('ceWheel').hidden));
  await mp.touchscreen.tap(tapGlyph.x + tapGlyph.width / 2, tapGlyph.y + tapGlyph.height / 2);
  await mp.waitForSelector('#ceWheel:not([hidden])');
  const mpHead = await mp.locator('#chordModal .modal-header').boundingBox();
  await mp.touchscreen.tap(mpHead.x + 8, mpHead.y + mpHead.height / 2);
  await sleep(150);
  ok('a touch tap outside the picker dismisses it', await mp.evaluate(() => document.getElementById('ceWheel').hidden));
  await mp.locator('.ce-line[data-b="0"][data-l="0"] .ce-ch[data-i="12"]').click();
  await mp.waitForSelector('#ceWheel:not([hidden])');
  const wheelBox = await mp.locator('#ceWheel').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth };
  });
  ok('mobile wheel stays inside the viewport', wheelBox.left >= 0 && wheelBox.right <= wheelBox.vw, JSON.stringify(wheelBox));
  await mp.locator('#ceWheelHub').click();
  await sleep(250);
  ok('mobile extended wheel uses a compact chip grid',
    (await mp.locator('#ceWheelStage').evaluate(el => el.classList.contains('grid'))) &&
    (await mp.locator('#ceWheelStage .ce-wheel-chip').count()) === 14);
  const hubBox = await mp.locator('#ceWheelHub').evaluate(el => ({ position: getComputedStyle(el).position, height: Math.round(el.getBoundingClientRect().height) }));
  ok('mobile Back control sits in the grid, not over a chip', hubBox.position === 'static', JSON.stringify(hubBox));
  await mp.keyboard.press('Escape');
  const wrap = await mp.evaluate(() => {
    const lines = [...document.querySelectorAll('#ceCanvas .ce-line')];
    const line = lines.find(l => new Set([...l.querySelectorAll('.ce-word')].map(w => Math.round(w.getBoundingClientRect().top))).size > 1) || lines[0];
    const rows = new Set([...line.querySelectorAll('.ce-word')].map(w => Math.round(w.getBoundingClientRect().top))).size;
    const dx = [...line.querySelectorAll('.ce-chord')].map(el => {
      const ch = line.querySelector('.ce-ch[data-i="' + el.dataset.pos + '"]');
      return ch ? +(el.getBoundingClientRect().left - ch.getBoundingClientRect().left).toFixed(1) : null;
    });
    return { rows, dx };
  });
  ok('wrapped lyric lines keep every chord on or after its character', wrap.rows > 1 && wrap.dx.length > 0 && wrap.dx.every(d => d !== null && d >= -1), JSON.stringify(wrap));
  await mp.locator('#ceSaveBtn').click();
  await sleep(600);
  const readWrap = await mp.evaluate(() => {
    const out = [];
    document.querySelectorAll('.chord-line-pos').forEach(lineEl => {
      lineEl.querySelectorAll('.chord-read').forEach(el => {
        const ch = lineEl.querySelector('.ce-ch[data-i="' + el.dataset.pos + '"]');
        if (ch) out.push(+(el.getBoundingClientRect().left - ch.getBoundingClientRect().left).toFixed(1));
      });
    });
    return out;
  });
  ok('reader keeps wrapped-line chords on their characters', readWrap.length > 0 && readWrap.every(d => Math.abs(d) <= 1), JSON.stringify(readWrap));
  await mp.locator('.chord-summary .chord-pill').first().click();
  await mp.waitForSelector('#chordPop:not([hidden])');
  const popBox = await mp.locator('#chordPop').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight };
  });
  ok('mobile chord popup stays inside the viewport',
    popBox.left >= 0 && popBox.right <= popBox.vw && popBox.top >= 0 && popBox.bottom <= popBox.vh, JSON.stringify(popBox));
  await mp.close();
});

// ═══════════════ 11b. READER PINCH PERSISTS ═══════════════
await section('reader pinch font', async () => {
  const mp = await newPage({ width: 390, height: 844 }, { hasTouch: true });
  await waitLoaded(mp);
  await mp.evaluate(() => localStorage.removeItem('labu-reader-font'));
  await mp.reload({ waitUntil: 'domcontentloaded' });
  await mp.waitForFunction(() => document.getElementById('statSongs')?.textContent.includes('5,7'), null, { timeout: 30000 });
  await mp.locator('#groupGrid .cat-card').first().click();
  await mp.waitForSelector('#categoryGrid .cat-card');
  await mp.locator('#categoryGrid .cat-card').filter({ hasText: 'Biakna Late' }).first().click();
  await mp.waitForSelector('#songGrid .song-item');
  await mp.locator('#songGrid .song-item').filter({ hasText: 'Jesu Minlian' }).first().click();
  await mp.waitForSelector('#songDetail .verse');
  const before = await mp.evaluate(() => readerFont);
  // Synthetic two-finger spread: 80px -> 160px, i.e. double the lyric size.
  const pinched = await mp.evaluate(() => {
    const el = document.getElementById('songScroll');
    const target = el.querySelector('.verse') || el;
    const t = (id, x, y) => new Touch({ identifier: id, target, clientX: x, clientY: y });
    const y = Math.round(target.getBoundingClientRect().top + 8);
    const fire = (type, touches) => target.dispatchEvent(new TouchEvent(type, {
      touches, targetTouches: touches, changedTouches: touches, bubbles: true, cancelable: true }));
    fire('touchstart', [t(1, 100, y), t(2, 180, y)]);
    fire('touchmove', [t(1, 60, y), t(2, 220, y)]);
    fire('touchend', []);
    return {
      font: readerFont, zoom: readerZoomFont, stored: localStorage.getItem('labu-reader-font'),
      slider: document.getElementById('readerSizeRange').value,
      label: document.getElementById('readerSizeValue').textContent,
      inline: document.getElementById('songDetail').style.getPropertyValue('--reader-font').trim()
    };
  });
  ok('pinch enlarges the lyrics', pinched.zoom > before, before + ' -> ' + pinched.zoom);
  ok('pinch writes its size into the Settings font size',
    pinched.font === pinched.zoom && pinched.stored === String(pinched.zoom) &&
    pinched.slider === String(pinched.zoom) && pinched.label === pinched.zoom + 'px',
    JSON.stringify({ r: pinched.font, s: pinched.stored, slider: pinched.slider, label: pinched.label }));
  // Changing songs must keep the pinched size instead of snapping back.
  await mp.goBack();
  await mp.waitForSelector('#songGrid .song-item');
  await mp.locator('#songGrid .song-item').last().click();
  await mp.waitForSelector('#songDetail .verse');
  const next = await mp.evaluate(() => ({
    font: readerFont,
    inline: document.getElementById('songDetail').style.getPropertyValue('--reader-font').trim()
  }));
  ok('the next song keeps the pinched size',
    next.font === pinched.zoom && next.inline === pinched.zoom + 'px', JSON.stringify(next));
  await mp.close();
});

// ═══════════════ 12. PWA: SW + OFFLINE ═══════════════
await section('pwa offline', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await waitLoaded(page);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 });
  const cacheInfo = await page.evaluate(async () => {
    const keys = await caches.keys();
    let shell = [];
    for (const k of keys) {
      const c = await caches.open(k);
      shell = shell.concat((await c.keys()).map(r => new URL(r.url).pathname).filter(p => p.endsWith('.html') || p.endsWith('html2canvas.min.js')));
    }
    return { keys, shell };
  });
  ok('SW cache ' + cacheInfo.keys.join(',') + ' precaches shell+html2canvas', cacheInfo.shell.some(p => p.endsWith('index.html')) && cacheInfo.shell.some(p => p.endsWith('html2canvas.min.js')));
  // corpus is runtime-cached on the first SW-controlled fetch — reload once so the
  // fetch goes through the SW (the first load races SW activation), then check.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('statSongs')?.textContent.includes('5,7'), null, { timeout: 30000 });
  // cache.put runs after the fetch resolves, so poll instead of racing it. This
  // waits on the app's own warm-up (which now waits for SW control); nothing here
  // fetches the corpus, so a regression on either side still fails.
  const corpusCached = await page.waitForFunction(async () => {
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      const hit = (await c.keys()).find(r => new URL(r.url).pathname.endsWith('/songs.json.gzip'));
      if (hit && await c.match(hit)) return true;
    }
    return false;
  }, null, { timeout: 20000 }).then(() => true).catch(() => false);
  if (!corpusCached) {
    const dump = await page.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) {
        const c = await caches.open(k);
        out.push(k + ': ' + (await c.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search).filter(p => p.endsWith('.json') || p.endsWith('.gzip')).join(' '));
      }
      return out.join(' | ');
    });
    console.log('  corpus cache dump —', dump);
  }
  const dataLen = await page.evaluate(async () => {
    const keys = await caches.keys();
    for (const k of keys) {
      const c = await caches.open(k);
      // the corpus is cached under its versioned URL (songs.json.gzip?v=N)
      const hit = (await c.keys()).find(r => new URL(r.url).pathname.endsWith('/songs.json.gzip'));
      const gz = hit ? await c.match(hit) : null;
      if (gz) return (await gz.clone().text()).length;
    }
    return null;
  });
  ok('song corpus cached by SW', dataLen > 100000, String(dataLen));
  // offline reload still boots from IndexedDB
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForFunction(() => document.getElementById('statSongs')?.textContent.includes('5,7'), null, { timeout: 20000 }).catch(() => {});
  const offlineCount = await page.evaluate(() => document.getElementById('statSongs')?.textContent);
  ok('offline reload still loads corpus (' + offlineCount + ')', !!offlineCount && offlineCount.includes('5,7'));
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card', { timeout: 8000 });
  ok('offline browsing works (group → categories)', true);
  await ctx.setOffline(false);
  await ctx.close();
});

// ═══════════════ 13. DATA FETCH FAILURE ═══════════════
await section('data failure', async () => {
  let corpusFails = 0;
  const failServer = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (p.endsWith('songs.json') || p.endsWith('songs.json.gzip') || p.endsWith('groups.json')) {
      corpusFails++;
      if (corpusFails <= 3) { res.writeHead(503); res.end('down'); return; } // fail the whole first attempt (meta + gzip + json), recover for the retry
    }
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => failServer.listen(0, '127.0.0.1', r));
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await page.goto(`http://localhost:${failServer.address().port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('statSongs')?.textContent === '!', null, { timeout: 20000 }).catch(() => {});
  const s = await page.textContent('#statSongs');
  const desc = await page.textContent('#heroDesc');
  ok('data fetch failure surfaces friendly error', desc.includes('Failed to load'), desc.slice(0, 90));
  ok('error state marks stats', s === '!', s);
  const retryVisible = await page.locator('#retryDataBtn').isVisible().catch(() => false);
  ok('retry button appears on load failure', retryVisible);
  // retry after the server recovers → corpus loads in place
  await page.locator('#retryDataBtn').click();
  await page.waitForFunction(() => document.getElementById('statSongs')?.textContent.includes('5,7'), null, { timeout: 30000 });
  ok('retry loads the corpus in place', (await page.textContent('#statSongs')).includes('5,7'));
  await page.close();
  failServer.close();
});

await browser.close();
server.close();

const fails = results.filter(r => r.startsWith('FAIL'));
console.log(results.join('\n'));
console.log(`\n===== ${results.length - fails.length}/${results.length} PASS =====`);
if (fails.length) console.log(fails.join('\n'));
if (allErrors.length) {
  console.log('\n===== CONSOLE/PAGE ERRORS =====');
  console.log(allErrors.join('\n'));
} else {
  console.log('No console/page errors.');
}
process.exit(fails.length || allErrors.length ? 1 : 0);
