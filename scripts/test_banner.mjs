// Layout regression test for the update dialog: it must stay centered, fit the
// viewport, and minimize to the floating progress pill when the backdrop is clicked.
// Run: node scripts/test_banner.mjs   (needs: npx playwright install chromium)
import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.json': 'application/json', '.gzip': 'application/gzip', '.png': 'image/png', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'load' });
await page.waitForSelector('#groupGrid .cat-card');

const r = await page.evaluate(() => {
  showUpdateBanner('1.5.23');
  const b = document.getElementById('updateBanner').getBoundingClientRect();
  const o = document.getElementById('updateOverlay');
  const fab = document.getElementById('updateFab');
  return {
    vw: innerWidth, vh: innerHeight,
    banner: { w: b.width, h: b.height, top: b.top, center: b.top + b.height / 2 },
    overlayHidden: o.hidden,
    fabHidden: fab.hidden,
  };
});

let fails = 0;
if (r.banner.w > r.vw - 16) { console.error(`FAIL: dialog wider than viewport (${r.banner.w} > ${r.vw - 16})`); fails++; }
if (r.banner.h > 340) { console.error(`FAIL: dialog is too tall (${r.banner.h}px)`); fails++; }
if (Math.abs(r.banner.center - r.vh / 2) > 40) { console.error(`FAIL: dialog is not centered (${Math.round(r.banner.center)} vs ${r.vh / 2})`); fails++; }
if (r.overlayHidden) { console.error('FAIL: overlay did not open'); fails++; }
if (!r.fabHidden) { console.error('FAIL: floating pill visible while dialog is open'); fails++; }

const minimized = await page.evaluate(() => {
  minimizeUpdate();
  return {
    overlayHidden: document.getElementById('updateOverlay').hidden,
    fabHidden: document.getElementById('updateFab').hidden,
    label: document.getElementById('updateFabText').textContent,
  };
});
if (!minimized.overlayHidden) { console.error('FAIL: minimize did not hide the dialog'); fails++; }
if (minimized.fabHidden) { console.error('FAIL: minimize did not show the floating pill'); fails++; }
if (!/1\.5\.23/.test(minimized.label)) { console.error(`FAIL: floating pill label is "${minimized.label}"`); fails++; }

console.log(`dialog ${Math.round(r.banner.w)}x${Math.round(r.banner.h)} centered | minimized pill: ${minimized.label}`);
await browser.close(); server.close();
if (fails) process.exit(1);
console.log('UPDATE DIALOG LAYOUT OK');
