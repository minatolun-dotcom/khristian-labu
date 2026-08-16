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
    // the shared sandbox IP) — the app catches those; real JS errors still fail.
    if (/Failed to load resource: the server responded with a status of (403|404|429|5\d\d)/.test(m.text())) return;
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
  ok('stats books = 6', (await page.textContent('#statBooks')).trim() === '6');
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
  const title = (await page.locator('#songDetail .song-header-center h1').textContent()).trim();
  ok('tab title syncs to song', (await page.title()).includes(title));
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
  // tap the last jump chip → scrolls down
  const before = await page.evaluate(() => window.scrollY);
  await page.locator('.verse-jump .vj').last().click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.scrollY);
  ok('verse jump scrolls down', after > before, before + ' → ' + after);
  // scroll memory: let the verse-jump smooth scroll settle first (Chromium won't
  // cancel it mid-flight, which would corrupt the position we save), then scroll.
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 403));
  await page.waitForTimeout(200);
  await page.goBack();
  await page.waitForSelector('#searchResults .song-item');
  await page.locator('#searchResults .song-item').nth(idx).click();
  await page.waitForSelector('#songDetail .verse');
  const restored = await page.evaluate(() => window.scrollY);
  ok('reader scroll restored', Math.abs(restored - 403) < 20, 'got ' + restored);
  // WhatsApp FAB + menu (check the .wa-fab button — the wrapper div has zero size)
  ok('wa fab visible in detail', await page.locator('#waFabWrap .wa-fab').isVisible());
  await page.locator('#waFabWrap .wa-fab').click();
  await page.waitForSelector('#waMenu.open');
  ok('wa menu opens with 2 options', (await page.locator('#waMenu button').count()) === 2);
  ok('text share option present', (await page.locator('#waMenu').textContent()).includes('Share as text'));
  ok('image share option present', (await page.locator('#waMenu').textContent()).includes('Share as image'));
  // close menu, go back to search view → FAB hidden
  await page.keyboard.press('Escape').catch(() => {});
  await page.goBack();
  await page.waitForSelector('#searchResults .song-item');
  ok('wa fab hidden in search view', !(await page.locator('#waFabWrap .wa-fab').isVisible()));
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
      if (String(url).includes('api.github.com/repos/')) {
        window.__apiCalls++;
        return { ok: true, json: async () => ({ tag_name: 'v9.9.9', assets: [{ name: 'khristian-labu.apk' }] }) };
      }
      return realFetch(url, opts);
    };
  });
  await waitLoaded(page);
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
  // layout: reader bar + FAB within viewport
  const bar = await page.locator('#readerFontCtrl').boundingBox();
  const fab = await page.locator('#waFabWrap .wa-fab').boundingBox();
  ok('mobile bar within viewport', !!bar && bar.y + bar.height <= 844, JSON.stringify(bar));
  ok('mobile fab above bar', !!fab && !!bar && fab.y + fab.height < bar.y, JSON.stringify({ fab, bar }));
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
  const failServer = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (p.endsWith('songs.json') || p.endsWith('songs.json.gzip') || p.endsWith('groups.json')) { res.writeHead(503); res.end('down'); return; }
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
