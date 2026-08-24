// Layout regression test for the update banner: with OTA diagnostics visible, the
// banner must stay a compact top strip — no giant rectangle, no vertical text
// (the diagnostic rows used to be squeezed into ~1-character flex columns).
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
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'load' });
await page.waitForSelector('#groupGrid .cat-card');

const r = await page.evaluate(() => {
  showUpdateBanner('1.5.23', 'https://x/khristian-labu.apk');
  const step = document.getElementById('otaStepDetail');
  const err = document.getElementById('otaErrorDetail');
  step.style.display = 'block';
  err.style.display = 'block';
  step.textContent = 'Step: failed installing 1.5.23: Download called without url (very long diagnostic line to force wrapping behaviour check 1234567890)';
  err.textContent = 'OTA error: Bundle checksum is not encrypted. Upload bundle with --key flag when encryption is configured.';
  const b = document.getElementById('updateBanner');
  const br = b.getBoundingClientRect();
  const er = err.getBoundingClientRect();
  return {
    vw: innerWidth,
    banner: { w: br.width, h: br.height },
    errW: er.width,
    errLines: Math.round(er.height / (parseFloat(getComputedStyle(err).fontSize) * 1.2)),
  };
});

let fails = 0;
if (r.banner.w > r.vw - 16) { console.error(`FAIL: banner wider than viewport (${r.banner.w} > ${r.vw - 16})`); fails++; }
if (r.banner.h > 220) { console.error(`FAIL: banner is a giant rectangle (height ${r.banner.h}px)`); fails++; }
if (r.errW < 120) { console.error(`FAIL: error text column collapsed to ${r.errW}px (vertical text)`); fails++; }
if (r.errLines > 8) { console.error(`FAIL: error text wraps into ${r.errLines} lines`); fails++; }
console.log(`banner ${r.banner.w}x${r.banner.h} | error col ${Math.round(r.errW)}px, ~${r.errLines} line(s)`);

await browser.close(); server.close();
if (fails) process.exit(1);
console.log('BANNER LAYOUT OK');
