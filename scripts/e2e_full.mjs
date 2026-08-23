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
const TEST_GOOGLE_ID = process.env.TEST_GOOGLE_ID || '';
const MIME = { '.html': 'text/html', '.json': 'application/json', '.gzip': 'application/gzip', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  if (p.endsWith('index.html') && TEST_GOOGLE_ID) {
    res.end(fs.readFileSync(file, 'utf8').replace("const GOOGLE_CLIENT_ID = '';", "const GOOGLE_CLIENT_ID = '" + TEST_GOOGLE_ID + "';"));
    return;
  }
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const URL = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${(!cond && extra) ? ' — ' + extra : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const allErrors = [];
let currentSection = '';

async function newPage(vp = { width: 1280, height: 800 }, extra = {}) {
  const page = await browser.newPage({ viewport: vp, acceptDownloads: true, ...extra });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    // ignore network status failures (e.g. the GitHub update-check API rate-limiting
    // the shared sandbox IP) and app-level caught-error logs (e.g. a test stub making
    // the OTA download fail on purpose) — the app handles those; real JS errors still fail.
    if (/Failed to load resource: the server responded with a status of (403|404|429|5\d\d)/.test(m.text())) return;
    if (/^\[(OTA update|Khristian Labu)\]/.test(m.text())) return;
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
async function openSettings(page) {
  await page.locator('#menuBtn').click();
  await page.waitForSelector('#sidebarModal.open');
  await page.locator('#sidebarModal').locator('text=Settings').click();
  await page.waitForSelector('#settingsModal.open');
}

// ═══════════════ 1. LOAD + HOME + NAV ═══════════════
await section('load & home', async () => {
  const page = await newPage();
  await waitLoaded(page);
  ok('corpus loads (5,719)', (await page.textContent('#statSongs')).includes('5,7'));
  ok('6 group cards', (await page.locator('#groupGrid .cat-card').count()) === 6);
  ok('fav/recents row renders', await page.locator('#favRecentRow').count() === 1);
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
  ok('reader controls visible', await page.locator('#readerFontCtrl').isVisible());
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
  ok('list renders its rows once (' + rows + ' rows, ' + addsAfterFirst + ' adds)', addsAfterFirst === rows);
  ok('back/forward nav does NOT rebuild the list rows', addsAfter === addsAfterFirst, addsAfterFirst + ' → ' + addsAfter);
  ok('restored list still opens its songs', rowsAfter === rows, 'rows ' + rows + ' → ' + rowsAfter);
  await page.close();
});

// ═══════════════ 2. READER FEATURES (scroll memory, verse jump, WhatsApp FAB) ═══════════════
await section('reader features', async () => {
  const page = await newPage();
  await waitLoaded(page);
  // open the longest song in the corpus (15 verses) via search from home (unscoped)
  await page.locator('#searchInput').fill('pakai vannoi');
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
  // scroll memory: let the verse-jump smooth scroll settle first (Chromium won't
  // cancel it mid-flight, which would corrupt the position we save), then scroll.
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.getElementById('songScroll').scrollTop = 403; });
  await page.waitForTimeout(200);
  await page.goBack();
  await page.waitForSelector('#searchResults .song-item');
  await page.locator('#searchResults .song-item').nth(idx).click();
  await page.waitForSelector('#songDetail .verse');
  const restored = await page.evaluate(() => document.getElementById('songScroll').scrollTop);
  ok('reader scroll restored', Math.abs(restored - 403) < 20, 'got ' + restored);
  // WhatsApp FAB + menu (check the .wa-fab button — the wrapper div has zero size)
  ok('wa fab visible in detail', await page.locator('#waFabWrap .wa-fab').isVisible());
  await page.locator('#waFabWrap .wa-fab').click();
  await page.waitForSelector('#waMenu.open');
  ok('wa menu opens with 2 options', (await page.locator('#waMenu button').count()) === 2);
  ok('text share option present', (await page.locator('#waMenu').textContent()).includes('Share as text'));
  ok('image share option present', (await page.locator('#waMenu').textContent()).includes('Share as image'));
  // click image share → preview modal should open (html2canvas takes time)
  await page.locator('#waMenu button').nth(1).click();
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
  // close menu, go back to search view → FAB hidden
  await page.keyboard.press('Escape').catch(() => {});
  await page.goBack();
  await page.waitForSelector('#searchResults .song-item');
  ok('wa fab hidden in search view', !(await page.locator('#waFabWrap .wa-fab').isVisible()));
  // reader bottom bar: visible on a long song, lyrics stop above it, hides when nothing scrolls
  await page.locator('#searchInput').fill('pakai vannoi');
  await page.waitForTimeout(600);
  const idx2 = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#searchResults .song-item')];
    return items.findIndex(it => /PAKAI/.test(it.querySelector('.si-title')?.textContent || ''));
  });
  await page.locator('#searchResults .song-item').nth(Math.max(idx2, 0)).click();
  await page.waitForSelector('#songDetail .verse');
  await page.waitForTimeout(300);
  ok('reader bar visible on long song', await page.locator('#readerControlsHost .reader-controls').isVisible());
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
    };
  });
  ok('lyrics clip above the separate footer (container bottom ' + footerLayout + ')', footerLayout.clipOK && footerLayout.footerBelow, JSON.stringify(footerLayout));
  ok('song actions moved into the footer', footerLayout.actionsInFooter && !footerLayout.actionsInSong);
  // max font + max line-height at the end of container scroll: last line clears the footer
  await page.evaluate(() => { setReaderFont(28); setReaderLH(2.4); });
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
    setReaderFont(17); setReaderLH(1.6); // back to defaults before the fit test
    document.getElementById('songDetail').innerHTML =
      '<div class="song-detail-header"><h1>Short</h1></div><div class="verse" id="sv0"><p>' + Array(15).fill('One line of lyrics.').join('<br>') + '</p></div>';
    scheduleReaderControlsCheck();
  });
  await page.waitForTimeout(300);
  ok('reader bar stays visible on a one-screen song', await page.locator('#readerControlsHost .reader-controls').isVisible());
  // BUG 2: no dead zone — the lyrics end naturally; the footer sits right below them
  const shortGap = await page.evaluate(() => {
    const sc = document.getElementById('songScroll');
    const footer = document.getElementById('readerControlsHost').getBoundingClientRect();
    const verses = document.querySelectorAll('#songDetail .verse');
    const last = verses[verses.length - 1].getBoundingClientRect();
    return Math.round(footer.top - last.bottom);
  });
  ok('no dead zone between lyrics and footer on one-screen song (gap=' + shortGap + 'px)', shortGap < 160, 'gap=' + shortGap);
  ok('container scroll locked when lyrics fit on one screen', await page.evaluate(() => document.getElementById('songScroll').classList.contains('scroll-locked')));
  await page.evaluate(() => { const sc = document.getElementById('songScroll'); sc.scrollTop = 500; });
  await page.waitForTimeout(200);
  ok('cannot scroll container while locked', (await page.evaluate(() => document.getElementById('songScroll').scrollTop)) === 0);
  // increasing size/spacing so the lyrics no longer fit → scroll works again
  await page.evaluate(() => { setReaderFont(28); setReaderLH(2.4); });
  await page.waitForTimeout(400);
  ok('font increase unlocks scroll when lyrics overflow', await page.evaluate(() => !document.getElementById('songScroll').classList.contains('scroll-locked')));
  await page.evaluate(() => { document.getElementById('songScroll').scrollTop = 200; });
  await page.waitForTimeout(200);
  ok('scrolling works again after unlock', (await page.evaluate(() => document.getElementById('songScroll').scrollTop)) > 0);
  await page.close();
});

// ═══════════════ 3. SEARCH (filters, sort, normalization, history) ═══════════════
await section('search', async () => {
  const page = await newPage();
  await waitLoaded(page);
  const inp = page.locator('#searchInput');
  // scope: start from home so search covers everything
  await inp.fill('toupa');
  await page.waitForTimeout(900);
  const n1 = await page.locator('#searchResults .song-item').count();
  ok('search "toupa" returns results (' + n1 + ')', n1 > 0);
  // title filter narrows
  await page.locator('.si-chip[onclick*="title"]').click();
  await page.waitForTimeout(400);
  const nTitle = await page.locator('#searchResults .song-item').count();
  ok('Title filter narrows results', nTitle <= n1, nTitle + ' vs ' + n1);
  // number filter (search a number so the filter has something to match)
  await page.locator('.si-chip[onclick*="number"]').click();
  await inp.fill('1');
  await page.waitForTimeout(700);
  ok('Number filter works', (await page.locator('#searchResults .song-item').count()) > 0);
  // reset to All for the remaining checks
  await page.locator('.si-chip[onclick*="all"]').first().click();
  await page.waitForTimeout(400);
  // sort
  await page.selectOption('.si-sort', 'alpha');
  await page.waitForTimeout(400);
  const firstTitle = (await page.locator('#searchResults .song-item .si-title').first().textContent()).trim();
  await page.selectOption('.si-sort', 'relevance');
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
  const header = await page.locator('#searchResults .song-list-header').textContent().catch(() => '');
  const rerun = await page.locator('#searchResults .song-item').count();
  ok('clicking recent search re-runs it (' + rerun + ' results)', rerun > 0, 'chip=' + JSON.stringify(chips[0]) + ' header=' + header.trim().slice(0, 80));
  // clear history
  await inp.fill('');
  await page.waitForTimeout(500);
  await page.locator('.si-clear-hist').click();
  ok('clear history works', (await page.locator('.si-rec').count()) === 0);
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
  // toggle favorite
  await page.locator('.song-action-btn[title="Favorite"]').click();
  await page.waitForTimeout(300);
  const favSvg = await page.locator('.song-action-btn[title="Favorite"]').innerHTML();
  ok('fav toggled (icon filled)', favSvg.includes('fill="var(--red)"'), favSvg.slice(0, 80));
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
  await page.locator('.song-action-btn[title="Favorite"]').click();
  await page.waitForTimeout(300);
  await page.goBack();
  await page.waitForFunction(() => document.getElementById('listHeader')?.textContent.includes('Favorites'), null, { timeout: 5000 });
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
  await page.locator('.song-action-btn[title="Add to playlist"]').click();
  await page.waitForSelector('#playlistModal.open');
  await page.fill('#newPlaylistInput', 'E2E List');
  await page.locator('#playlistModal').locator('button:has-text("Create")').click();
  await page.waitForTimeout(300);
  await page.locator('#playlistModalBody').getByText('E2E List').waitFor();
  await page.locator('#playlistModal').locator('button:has-text("Done")').click();
  // open Custom Lists from sidebar
  await page.locator('#menuBtn').click();
  await page.waitForSelector('#sidebarModal.open');
  await page.locator('#sidebarModal').locator('text=Custom Lists').click();
  await page.waitForSelector('#songGrid .song-item');
  ok('custom lists shows the playlist', (await page.textContent('#songGrid')).includes('E2E List'));
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songGrid .song-item');
  ok('playlist opens with 1 song', (await page.textContent('#songGrid')).includes(songTitle));
  // playlist-scoped search: while the playlist is open, results stay inside it
  await page.fill('#searchInput', songTitle.slice(0, 6));
  await page.waitForTimeout(900);
  const scopeHeader = await page.textContent('#searchResults .song-list-header').catch(() => '');
  const scopeCount = await page.locator('#searchResults .song-item').count();
  ok('search scoped to open playlist', scopeHeader.includes('in E2E List') && scopeCount >= 1 && scopeCount <= 1, (scopeHeader || '').trim().slice(0, 110) + ' | results=' + scopeCount);
  // back to the playlist, then rename
  await page.fill('#searchInput', '');
  await page.waitForTimeout(400);
  await page.goBack();
  await page.waitForSelector('#songGrid .song-item');
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
  await page.locator('#settingsModal').locator('text=Manage Songs').click();
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
  await page.waitForTimeout(500);
  ok('song added toast', (await page.locator('.toast').allInnerTexts()).some(t => t.includes('Song added')));
  // search it in admin
  await page.fill('#adminSearchInput', 'E2E TEST SONG');
  await page.waitForTimeout(400);
  ok('admin search finds added song', (await page.locator('#adminSongList .admin-song-row').count()) === 1);
  // find & replace
  await page.locator('#adminView').locator('button[title="Find & Replace"]').click();
  await page.waitForSelector('#findReplace.show');
  await page.fill('#findInput', 'E2EMARKER');
  await page.fill('#replaceInput', 'E2EREPLACED');
  await page.waitForTimeout(500);
  ok('find & replace preview counts matches', (await page.textContent('#frStats')).includes('match'));
  await page.locator('#findReplace').locator('button:has-text("Replace All")').click();
  await page.waitForTimeout(400);
  ok('replace executed', (await page.locator('.toast').allInnerTexts()).some(t => t.includes('Replaced')));
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
  await page.locator('#settingsModal').locator('text=Manage Songs').click();
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
  // settings has the three font options
  await openSettings(page);
  ok('settings has font options', await page.locator('#fontDefault').isVisible() && await page.locator('#fontOutfit').isVisible() && await page.locator('#fontSerif').isVisible());
  // clicking Serif applies it to the open song's verses
  await page.locator('#fontSerif').click();
  await page.waitForTimeout(300);
  const serif = await family();
  ok('serif font applies to song text', serif.includes('Georgia'), serif);
  ok('serif choice persists in localStorage', (await page.evaluate(() => localStorage.getItem('labu-reader-family'))) === 'serif');
  ok('serif button highlighted as active', (await page.evaluate(() => document.getElementById('fontSerif').style.background)) === 'var(--accent)');
  // switching back to Default restores Inter
  await page.locator('#fontDefault').click();
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
  ok('dark theme → dark status bar, light icons', lastBg && lastBg[1].color === '#0f0f13' && lastStyle && lastStyle[1].style === 'LIGHT', JSON.stringify({ lastBg, lastStyle }));
  await page.locator('#themeLight').click();
  await page.waitForTimeout(300);
  const afterLight = await page.evaluate(() => window.__sbCalls);
  const lb = [...afterLight].reverse().find(c => c[0] === 'bg');
  const ls = [...afterLight].reverse().find(c => c[0] === 'style');
  ok('light theme → light status bar, dark icons', lb && lb[1].color === '#f8f9fc' && ls && ls[1].style === 'DARK', JSON.stringify({ lb, ls }));
  await page.close();
});

// ═══════════════ 9. SETTINGS + GOOGLE SECTION ═══════════════
await section('settings & google', async () => {
  const page = await newPage();
  await waitLoaded(page);
  await openSettings(page);
  const ver = (await page.textContent('#appVersion')).trim();
  ok('version shown in settings (' + ver + ')', ver.length > 0);
  ok('backup/restore + google buttons present', (await page.locator('#settingsModal').getByText('Backup data').count()) > 0 && (await page.locator('#settingsModal').getByText('Restore from backup').count()) > 0);
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
  ok('backup/restore google buttons', (await page.locator('#googleSection').getByText('Backup to Google').count()) > 0 && (await page.locator('#googleSection').getByText('Restore from Google').count()) > 0);
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

// ═══════════════ 9b. IN-APP OTA UPDATE (APK) ═══════════════
await section('ota update', async () => {
  const page = await newPage();
  // simulate the APK: inject the CapacitorUpdater plugin + a fake newer release
  await page.addInitScript(() => {
    window.__otaCalls = [];
    window.__apiCalls = 0;
    window.Capacitor = {
      Plugins: {
        CapacitorUpdater: {
          notifyAppReady: async () => { window.__otaCalls.push('notifyAppReady'); },
          addListener: async (name, fn) => { window.__downloadHandler = fn; return { remove: async () => { window.__downloadHandler = null; } }; },
          download: async o => {
            window.__otaCalls.push(['download', o]);
            const h = window.__downloadHandler;
            if (h) h({ percent: 25, bundle: { id: 'x' } });
            await new Promise(r => setTimeout(r, 150));
            if (h) h({ percent: 80, bundle: { id: 'x' } });
            await new Promise(r => setTimeout(r, 150));
            if (h) h({ percent: 100, bundle: { id: 'x' } });
            return { id: 'bundle-9.9.9', version: o.version };
          },
          set: async v => { window.__otaCalls.push(['set', v]); },
        },
      },
    };
      const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      // static update source (version.json on raw + Pages) is checked first now; it
      // carries the release's sessionKey/checksum (mirrored post-release by CI) so the
      // app never needs the CORS-blocked release CDN for the session data.
      if (String(url).includes('version.json')) {
        window.__apiCalls++;
        return { ok: true, json: async () => ({ version: '9.9.9', apkUrl: 'https://github.com/x/releases/download/v9.9.9/khristian-labu.apk', sessionKey: 'sk-static', checksum: 'cs-static', otaVersion: '9.9.9' }) };
      }
      if (String(url).includes('api.github.com/repos/')) {
        window.__apiCalls++;
        return { ok: true, json: async () => ({ tag_name: 'v9.9.9', assets: [
          { name: 'khristian-labu.apk' },
          { name: 'ota-session.json', browser_download_url: 'https://github.com/x/releases/download/v9.9.9/ota-session.json' },
        ] }) };
      }
      if (String(url).includes('ota-session.json')) {
        return { ok: true, json: async () => ({ version: '9.9.9', sessionKey: 'sk-test', checksum: 'cs-test' }) };
      }
      return realFetch(url, opts);
    };
    // the APK's native HTTP plugin — only a FALLBACK now: the session comes from the
    // CORS-open static version.json, so CapacitorHttp should NOT be needed. Track calls
    // to prove the primary path avoids it entirely (the release CDN is CORS-blocked).
    window.Capacitor.Plugins.CapacitorHttp = {
      request: async o => { window.__httpCalls = (window.__httpCalls || 0) + 1; return { status: 200, data: { version: '9.9.9', sessionKey: 'sk-http', checksum: 'cs-http' } }; },
    };
  });
  await waitLoaded(page);
  // notifyAppReady must fire early on boot or the plugin rolls the update back
  ok('notifyAppReady called on boot (no rollback)', await page.evaluate(() => window.__otaCalls.includes('notifyAppReady')));
  // on launch, the update check routes to OTA and asks before downloading
  await page.waitForSelector('#confirmModal.open', { timeout: 15000 });
  const msg = await page.textContent('#confirmMsg');
  ok('ota prompt asks to update to newer version', msg.includes('9.9.9'), msg.slice(0, 90));
  ok('no download before user confirms', (await page.evaluate(() => window.__otaCalls.filter(c => c[0] === 'download').length)) === 0);
  // confirm → downloads the bundle then applies (set reloads the app)
  await page.locator('#confirmBtn').click();
  await page.waitForFunction(() => document.getElementById('otaProgress')?.classList.contains('show'), null, { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('otaProgressPct')?.textContent.includes('80%'), null, { timeout: 5000 });
  ok('ota progress card shows live percent', true);
  await page.waitForFunction(() => window.__otaCalls.some(c => c[0] === 'set'), null, { timeout: 10000 });
  const dl = await page.evaluate(() => window.__otaCalls.find(c => c[0] === 'download'));
  ok('download called with the release zip url', !!dl && dl[1].url.endsWith('/releases/download/v9.9.9/www-latest.zip') && dl[1].version === '9.9.9', JSON.stringify(dl && dl[1]));
  // the session data comes from the CORS-open static version.json (mirrored by CI) —
  // NOT the release CDN, which sends no CORS headers and would die in the webview
  // (the "shows the old way" bug). CapacitorHttp is only a fallback now.
  ok('session comes from static version.json (CORS-open), no CDN fetch', (await page.evaluate(() => window.__httpCalls || 0)) === 0, 'httpCalls=' + (await page.evaluate(() => window.__httpCalls || 0)));
  ok('signed release passes sessionKey/checksum to download', !!dl && dl[1].sessionKey === 'sk-static' && dl[1].checksum === 'cs-static', JSON.stringify(dl && dl[1]));
  ok('set applied after download', true);
  await page.waitForFunction(() => !document.getElementById('otaProgress')?.classList.contains('show'), null, { timeout: 5000 });
  ok('ota progress card hides after update', true);
  // daily throttle: a second background check makes no API call
  const callsBefore = await page.evaluate(() => window.__apiCalls);
  await page.evaluate(() => checkOtaUpdate(false));
  await page.waitForTimeout(400);
  ok('background check throttled to once/day', (await page.evaluate(() => window.__apiCalls)) === callsBefore);
  // forced check (Settings button) bypasses the throttle
  await page.evaluate(() => checkOtaUpdate(true));
  await page.waitForTimeout(600);
  ok('forced check bypasses throttle', (await page.evaluate(() => window.__apiCalls)) > callsBefore);
  await page.close();

  // unsigned release (no ota-session.json asset) → download omits session data
  const page2 = await newPage();
  await page2.addInitScript(() => {
    window.__otaCalls = [];
    window.Capacitor = {
      Plugins: {
        CapacitorUpdater: {
          notifyAppReady: async () => {},
          addListener: async () => ({ remove: async () => {} }),
          download: async o => { window.__otaCalls.push(['download', o]); return { id: 'b', version: o.version }; },
          set: async () => { window.__otaCalls.push(['set']); },
        },
      },
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      // static source unavailable (e.g. offline) → the API fallback must serve
      if (String(url).includes('version.json')) {
        return { ok: false, status: 503 };
      }
      if (String(url).includes('api.github.com/repos/')) {
        return { ok: true, json: async () => ({ tag_name: 'v8.8.8', assets: [{ name: 'khristian-labu.apk' }] }) };
      }
      return realFetch(url, opts);
    };
  });
  await waitLoaded(page2);
  // the boot-time update check may already have opened the prompt — close it so we
  // can open Settings, then trigger the prompt again from inside Settings
  await page2.evaluate(() => { const c = document.getElementById('confirmModal'); if (c) c.classList.remove('open'); });
  // trigger the update prompt from INSIDE the Settings modal → confirm must be on top
  await openSettings(page2);
  await page2.locator('#settingsModal').locator('text=Check for update').click();
  await page2.waitForSelector('#confirmModal.open', { timeout: 10000 });
  const stack = await page2.evaluate(() => {
    const c = getComputedStyle(document.getElementById('confirmModal'));
    const s = getComputedStyle(document.getElementById('settingsModal'));
    return { confirmZ: parseInt(c.zIndex), settingsZ: parseInt(s.zIndex), confirmOpen: document.getElementById('confirmModal').classList.contains('open'), settingsOpen: document.getElementById('settingsModal').classList.contains('open') };
  });
  ok('ota confirm popup shows above the settings popup', stack.confirmOpen && stack.settingsOpen && stack.confirmZ > stack.settingsZ, JSON.stringify(stack));
  await page2.locator('#confirmBtn').click();
  await page2.waitForFunction(() => window.__otaCalls.some(c => c[0] === 'set'), null, { timeout: 10000 });
  const dl2 = await page2.evaluate(() => window.__otaCalls.find(c => c[0] === 'download'));
  ok('unsigned release downloads with no session data', !!dl2 && !('sessionKey' in dl2[1]) && !('checksum' in dl2[1]), JSON.stringify(dl2 && dl2[1]));
  await page2.close();

  // OTA fails (e.g. APK built before signing, no public key) → APK download banner
  const page3 = await newPage();
  await page3.addInitScript(() => {
    window.Capacitor = { Plugins: { CapacitorUpdater: {
      notifyAppReady: async () => {},
      addListener: async () => ({ remove: async () => {} }),
      download: async () => { throw new Error('cannot decrypt signed bundle'); },
      set: async () => {},
    } } };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes('version.json')) {
        return { ok: true, json: async () => ({ version: '7.7.7', apkUrl: 'https://github.com/x/releases/download/v7.7.7/khristian-labu.apk' }) };
      }
      if (String(url).includes('api.github.com/repos/')) {
        return { ok: true, json: async () => ({ tag_name: 'v7.7.7', assets: [
          { name: 'khristian-labu.apk', browser_download_url: 'https://github.com/x/releases/download/v7.7.7/khristian-labu.apk' },
          { name: 'ota-session.json', browser_download_url: 'https://github.com/x/releases/download/v7.7.7/ota-session.json' },
        ] }) };
      }
      if (String(url).includes('ota-session.json')) {
        return { ok: true, json: async () => ({ version: '7.7.7', sessionKey: 'sk', checksum: 'cs' }) };
      }
      return realFetch(url, opts);
    };
  });
  await waitLoaded(page3);
  await page3.evaluate(() => { localStorage.removeItem('labu_ota_last_check'); checkOtaUpdate(true); });
  await page3.waitForSelector('#confirmModal.open', { timeout: 10000 });
  await page3.locator('#confirmBtn').click();
  await page3.waitForSelector('#updateBanner:not([hidden])', { timeout: 10000 });
  ok('failed OTA falls back to APK download banner', (await page3.locator('#updVer').textContent()) === '7.7.7' && (await page3.locator('#updBtn').getAttribute('href')).includes('v7.7.7/khristian-labu.apk'));
  await page3.close();

  // signed release whose session data is unreachable → no doomed download attempt;
  // straight to the APK banner instead
  const page4 = await newPage();
  await page4.addInitScript(() => {
    window.__otaCalls = [];
    window.Capacitor = { Plugins: { CapacitorUpdater: {
      notifyAppReady: async () => {},
      addListener: async () => ({ remove: async () => {} }),
      download: async o => { window.__otaCalls.push(['download', o]); return { id: 'b', version: o.version }; },
      set: async () => {},
    } } };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes('version.json')) {
        return { ok: true, json: async () => ({ version: '6.6.6', apkUrl: 'https://github.com/x/releases/download/v6.6.6/khristian-labu.apk' }) };
      }
      if (String(url).includes('api.github.com/repos/')) {
        return { ok: true, json: async () => ({ tag_name: 'v6.6.6', assets: [
          { name: 'khristian-labu.apk', browser_download_url: 'https://github.com/x/releases/download/v6.6.6/khristian-labu.apk' },
          { name: 'ota-session.json', browser_download_url: 'https://github.com/x/releases/download/v6.6.6/ota-session.json' },
        ] }) };
      }
      if (String(url).includes('ota-session.json')) throw new Error('offline');
      return realFetch(url, opts);
    };
  });
  await waitLoaded(page4);
  await page4.evaluate(() => { localStorage.removeItem('labu_ota_last_check'); checkOtaUpdate(true); });
  await page4.waitForSelector('#confirmModal.open', { timeout: 10000 });
  await page4.locator('#confirmBtn').click();
  await page4.waitForSelector('#updateBanner:not([hidden])', { timeout: 10000 });
  const dl4 = await page4.evaluate(() => window.__otaCalls.filter(c => c[0] === 'download').length);
  ok('signed release with unreachable session data skips download, shows APK banner', dl4 === 0 && (await page4.locator('#updBtn').getAttribute('href')).includes('v6.6.6/khristian-labu.apk'), 'downloads=' + dl4);
  await page4.close();

  // OTA step diagnostics: the banner shows exactly which step ran/failed, so a
  // device-side failure is visible instead of console-only
  const page5 = await newPage();
  await page5.addInitScript(() => {
    window.Capacitor = { Plugins: { CapacitorUpdater: {
      notifyAppReady: async () => {},
      addListener: async () => ({ remove: async () => {} }),
      download: async () => { throw new Error('cannot decrypt signed bundle'); },
      set: async () => {},
    } } };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes('version.json')) {
        return { ok: true, json: async () => ({ version: '5.5.5', apkUrl: 'https://github.com/x/releases/download/v5.5.5/khristian-labu.apk', sessionKey: 'sk5', checksum: 'cs5', otaVersion: '5.5.5' }) };
      }
      return realFetch(url, opts);
    };
  });
  await waitLoaded(page5);
  await page5.evaluate(() => { localStorage.removeItem('labu_ota_last_check'); checkOtaUpdate(true); });
  await page5.waitForSelector('#confirmModal.open', { timeout: 10000 });
  await page5.locator('#confirmBtn').click();
  await page5.waitForSelector('#updateBanner:not([hidden])', { timeout: 10000 });
  const diag5 = await page5.evaluate(() => ({
    stepShown: getComputedStyle(document.getElementById('otaStepDetail')).display !== 'none',
    stepText: document.getElementById('otaStepDetail').textContent,
    errShown: getComputedStyle(document.getElementById('otaErrorDetail')).display !== 'none',
    errText: document.getElementById('otaErrorDetail').textContent,
  }));
  ok('OTA diagnostics: step trace visible on failure', diag5.stepShown && diag5.stepText.includes('5.5.5'), diag5.stepText);
  ok('OTA diagnostics: real error text visible on failure', diag5.errShown && diag5.errText.includes('OTA error'), diag5.errText);
  // dismiss clears the diagnostics
  await page5.evaluate(() => dismissUpdate());
  const diag5b = await page5.evaluate(() => ({
    step: getComputedStyle(document.getElementById('otaStepDetail')).display,
    err: getComputedStyle(document.getElementById('otaErrorDetail')).display,
    bannerHidden: document.getElementById('updateBanner').hidden,
  }));
  ok('dismiss hides banner and clears diagnostics', diag5b.bannerHidden && diag5b.step === 'none' && diag5b.err === 'none');
  await page5.close();

  // banner Download button: inside the APK it must hand the URL to the native
  // AppLauncher (system browser) instead of the WebView; on web it stays a plain link
  const page6 = await newPage();
  await page6.addInitScript(() => {
    window.__launch = null;
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { AppLauncher: { openUrl: async o => { window.__launch = o.url; } } },
    };
  });
  await waitLoaded(page6);
  await page6.evaluate(() => showUpdateBanner('4.4.4', 'https://github.com/x/releases/download/v4.4.4/khristian-labu.apk'));
  const ret = await page6.evaluate(() => {
    const a = document.getElementById('updBtn');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    const cancelled = !a.dispatchEvent(ev);
    return { cancelled, launched: window.__launch, href: a.getAttribute('href') };
  });
  ok('APK: banner Download button opens via native AppLauncher', ret.launched && ret.launched.includes('v4.4.4/khristian-labu.apk') && ret.cancelled, JSON.stringify(ret));
  await page6.close();

  // Settings: shows the latest offered version next to the installed one
  const page7 = await newPage();
  await waitLoaded(page7);
  await openSettings(page7);
  const ver7 = await page7.evaluate(() => ({
    label: document.getElementById('appVersion').parentElement.textContent.trim(),
    latestHidden: getComputedStyle(document.getElementById('latestVersion')).display === 'none',
  }));
  ok('Settings labels installed version, no latest shown before check', ver7.label.includes('App version') && ver7.latestHidden, ver7.label);
  await page7.evaluate(() => showUpdateBanner('3.3.3', 'https://github.com/x/releases/download/v3.3.3/khristian-labu.apk'));
  const ver7b = await page7.evaluate(() => ({
    latestShown: getComputedStyle(document.getElementById('latestVersion')).display !== 'none',
    latestText: document.getElementById('latestVersionVal').textContent,
  }));
  ok('Settings shows latest version when an update is available', ver7b.latestShown && ver7b.latestText === '3.3.3', JSON.stringify(ver7b));
  await page7.close();
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
  const dataLen = await page.evaluate(async () => {
    const keys = await caches.keys();
    for (const k of keys) {
      const c = await caches.open(k);
      const gz = await c.match(location.origin + '/songs.json.gzip');
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
  await new Promise(r => failServer.listen(0, r));
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
