// Khristian Labu — visual audit capture (Playwright + headless Chromium).
// Serves the project root over localhost, waits for the corpus to finish booting,
// then captures the real screens at desktop, tablet and phone widths.
// Run: node scripts/visual_audit.mjs   → shots/audit/*.png
import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/');
const { chromium } = require('playwright');
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'shots', 'audit');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.json': 'application/json', '.gzip': 'application/gzip', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();
const errors = [];

async function newPage(vp, scale = 1) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: scale });
  // Keep captures deterministic and offline: the HD sheet is an online upgrade.
  await page.route('https://dl.labu.lengkhawm.online/**', route => route.abort());
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)));
  return page;
}
async function boot(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (document.getElementById('statSongs')?.textContent || '').includes('5,7'), null, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('bootLoader'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
}
async function shot(page, name, full = false) {
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
  console.log('  ' + name);
}
async function openList(page) {
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
}
async function openSong(page) {
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songDetail .verse');
  await page.waitForTimeout(350);
}

console.log('desktop 1440x900');
{
  const p = await newPage({ width: 1440, height: 900 });
  await boot(p);
  await shot(p, 'desktop-home', true);
  await p.locator('#groupGrid .cat-card').first().click();
  await p.waitForSelector('#categoryGrid .cat-card');
  await shot(p, 'desktop-group');
  await p.locator('#categoryGrid .cat-card').first().click();
  await p.waitForSelector('#songGrid .song-item');
  await shot(p, 'desktop-list');
  await openSong(p);
  await shot(p, 'desktop-reader');
  const tabs = p.locator('#readerControlsHost .solfa-switch button');
  if (await tabs.count() >= 3) {
    await tabs.nth(1).click(); await p.waitForTimeout(600);
    await shot(p, 'desktop-solfa');
    await tabs.nth(2).click(); await p.waitForTimeout(600);
    await shot(p, 'desktop-chords');
  }
  await p.evaluate(() => goHome());
  await p.waitForTimeout(400);
  await p.evaluate(() => setTheme('light'));
  await p.waitForTimeout(500);
  await shot(p, 'desktop-home-light', true);
  await p.locator('#menuBtn').click();
  await p.waitForSelector('#sidebarModal.open');
  await shot(p, 'desktop-menu');
  await p.locator('#sidebarModal').locator('text=Settings').click();
  await p.waitForSelector('#settingsView.active');
  await p.waitForTimeout(400);
  await shot(p, 'desktop-settings', true);
  await p.evaluate(() => { setTheme('dark'); goHome(); });
  await p.waitForTimeout(400);
  await p.locator('#searchOpenBtn').click();
  await p.waitForSelector('#searchModal.open');
  await p.locator('#searchModalInput').fill('Jesu');
  await p.waitForTimeout(1400);
  await shot(p, 'desktop-search');
  await p.locator('#searchBookFilterWrap').click();
  await p.waitForSelector('#searchBookMenu:not([hidden])');
  await shot(p, 'desktop-search-filter');
  console.log('  errors so far: ' + errors.length);
  await p.close();
}

console.log('phone 390x844');
{
  const p = await newPage({ width: 390, height: 844 }, 2);
  await boot(p);
  await shot(p, 'mobile-home');
  await openList(p);
  await shot(p, 'mobile-list');
  await openSong(p);
  await shot(p, 'mobile-reader');
  const tabs = p.locator('#readerControlsHost .solfa-switch button');
  if (await tabs.count() >= 2) {
    await tabs.nth(1).click(); await p.waitForTimeout(600);
    await shot(p, 'mobile-solfa');
  }
  await p.locator('#waFab').click();
  await p.waitForTimeout(500);
  await shot(p, 'mobile-reader-fab');
  await p.evaluate(() => { closeWaMenu(); tabGo('settings'); });
  await p.waitForSelector('#settingsView.active');
  await p.waitForTimeout(400);
  await shot(p, 'mobile-settings', true);
  await p.evaluate(() => tabGo('search'));
  await p.waitForSelector('#searchModal.open');
  await p.waitForTimeout(300);
  await p.locator('#searchModalInput').fill('Jesu');
  await p.waitForTimeout(1400);
  await shot(p, 'mobile-search');
  await p.locator('#searchBookFilterWrap').click();
  await p.waitForSelector('#searchBookMenu:not([hidden])');
  await shot(p, 'mobile-search-filter');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await p.waitForSelector('#searchModal:not(.open)', { state: 'attached' });
  await p.evaluate(() => { setTheme('light'); tabGo('home'); });
  await p.waitForTimeout(600);
  await shot(p, 'mobile-home-light');
  await p.close();
}

console.log('tablet 768x1024');
{
  const p = await newPage({ width: 768, height: 1024 });
  await boot(p);
  await shot(p, 'tablet-home');
  await openList(p);
  await shot(p, 'tablet-list');
  await openSong(p);
  await shot(p, 'tablet-reader');
  await p.close();
}

console.log('dark theme (the designed default)');
{
  const p = await newPage({ width: 1440, height: 900 });
  await boot(p);
  await p.evaluate(() => setTheme('dark'));
  await p.waitForTimeout(600);
  await shot(p, 'dk-desktop-home');
  await openList(p);
  await shot(p, 'dk-desktop-list');
  await openSong(p);
  await shot(p, 'dk-desktop-reader');
  await p.evaluate(() => openSettings());
  await p.waitForSelector('#settingsView.active');
  await p.waitForTimeout(400);
  await shot(p, 'dk-desktop-settings');
  await p.close();
  const m = await newPage({ width: 390, height: 844 }, 2);
  await boot(m);
  await m.evaluate(() => setTheme('dark'));
  await m.waitForTimeout(600);
  await shot(m, 'dk-mobile-home');
  await openList(m);
  await shot(m, 'dk-mobile-list');
  await openSong(m);
  await shot(m, 'dk-mobile-reader');
  await m.evaluate(() => tabGo('settings'));
  await m.waitForTimeout(400);
  await shot(m, 'dk-mobile-settings');
  await m.close();
}

await browser.close();
server.close();
console.log('errors: ' + errors.length);
errors.slice(0, 10).forEach(e => console.log('  ! ' + e));
