// Pixel-level regression test for the shared-lyrics image (WhatsApp share).
//
// Runs the REAL captureFullSong() in headless Chromium and asserts the output PNG
// is clean: outside glyph ink, every pixel must sit within EPS of the theme
// background. Guards two historical defects:
//   1. translucent layer bleed-through (verses forced transparent + z-index:-1)
//   2. entrance animations (.fade-in) snapshotting mid-fade → hazy text when
//      sharing right after opening a song
//
// Run: node scripts/test_share_image.mjs   (needs: npx playwright install chromium)
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
const URL = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();

async function openSong(page) {
  await page.waitForSelector('#groupGrid .cat-card');
  await page.locator('#groupGrid .cat-card').first().click();
  await page.waitForSelector('#categoryGrid .cat-card');
  await page.locator('#categoryGrid .cat-card').first().click();
  await page.waitForSelector('#songGrid .song-item');
  await page.locator('#songGrid .song-item').first().click();
  await page.waitForSelector('#songDetail .verse');
}

async function captureAndScan(page, theme, label, settleMs) {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#groupGrid .cat-card');
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate(t => { localStorage.setItem('labu-theme', t); applyTheme(); }, theme);
  await openSong(page);
  if (settleMs) await new Promise(r => setTimeout(r, settleMs));
  const b64 = await page.evaluate(async () => {
    const blob = await captureFullSong();
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  });
  const buf = Buffer.from(b64.split(',')[1], 'base64');
  fs.writeFileSync(`/tmp/share-${label}.png`, buf);

  // decode in-browser (no PNG dep), scan raw RGBA for veil pixels: drifted from bg,
  // not bright glyph ink, and not within 3px of ink (excludes antialias edges).
  const veil = await page.evaluate(({ dataUrl, exp }) => new Promise(async (resolve) => {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const w = c.width, h = c.height, bpp = 4;
    const at = (x, y) => { const o = (y * w + x) * bpp; return [d[o], d[o + 1], d[o + 2]]; };
    const bright = (p) => Math.abs(p[0] - exp[0]) + Math.abs(p[1] - exp[1]) + Math.abs(p[2] - exp[2]) > 330;
    const bad = [];
    for (let y = 1; y < h - 1; y += 4)
      for (let x = 1; x < w - 1; x += 4) {
        const p = at(x, y);
        const drift = Math.max(Math.abs(p[0] - exp[0]), Math.abs(p[1] - exp[1]), Math.abs(p[2] - exp[2]));
        if (drift <= 6 || bright(p)) continue;
        let nearInk = false;
        for (let dy = -3; dy <= 3 && !nearInk; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const q = at(Math.min(w - 1, Math.max(0, x + dx)), Math.min(h - 1, Math.max(0, y + dy)));
            if (bright(q)) { nearInk = true; break; }
          }
        if (!nearInk) bad.push({ x, y, p });
      }
    resolve(bad);
  }), { dataUrl: 'data:image/png;base64,' + buf.toString('base64'), exp: theme === 'light' ? [248, 249, 252] : [15, 15, 19] });

  // dump 3 magnified crops (8x) around the first flagged pixels for visual diff
  for (let i = 0; i < Math.min(3, veil.length); i++) {
    const { x, y } = veil[i];
    const crop = await page.evaluate(({ dataUrl, x, y }) => new Promise(async (resolve) => {
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const R = 24;
      const sx = Math.max(0, x - R), sy = Math.max(0, y - R);
      const sw = Math.min(bmp.width - sx, R * 2), sh = Math.min(bmp.height - sy, R * 2);
      const c = document.createElement('canvas'); c.width = sw * 8; c.height = sh * 8;
      const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw * 8, sh * 8);
      resolve(c.toDataURL('image/png'));
    }), { dataUrl: 'data:image/png;base64,' + buf.toString('base64'), x, y });
    fs.writeFileSync(`/tmp/veil-${label}-${i}.png`, Buffer.from(crop.split(',')[1], 'base64'));
  }
  // cluster flagged pixels; only a LARGE connected region is a real veil.
  // Intentional translucent badges (song-number, verse-type pills) form small
  // ~70x20px clusters; the historical nav-band defect formed a ~780x130px one.
  const boxes = [];
  for (const { x, y } of veil) {
    let hit = boxes.find(b => x >= b.x0 - 40 && x <= b.x1 + 40 && y >= b.y0 - 40 && y <= b.y1 + 40);
    if (!hit) { hit = { x0: x, y0: y, x1: x, y1: y, n: 0 }; boxes.push(hit); }
    hit.x0 = Math.min(hit.x0, x); hit.y0 = Math.min(hit.y0, y);
    hit.x1 = Math.max(hit.x1, x); hit.y1 = Math.max(hit.y1, y); hit.n++;
  }
  const biggest = boxes.reduce((m, b) => Math.max(m, b.n), 0);
  const biggestBox = boxes.find(b => b.n === biggest);
  console.log(`${label.padEnd(22)} veil px: ${veil.length} in ${boxes.length} cluster(s); biggest n=${biggest}` +
    (biggestBox ? ` @(${biggestBox.x0},${biggestBox.y0})-(${biggestBox.x1},${biggestBox.y1})` : ''));
  return biggest;
}

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(URL, { waitUntil: 'load' });

// A real veil (nav band) clusters >2000 samples at 4px grid (~780x130px).
// Intentional badge pills cluster ~230. Anything between = suspicious.
const VEIL_CLUSTER_LIMIT = 800;
let fails = 0;
fails += (await captureAndScan(page, 'dark', 'dark-settled', 700)) > VEIL_CLUSTER_LIMIT ? 1 : 0;
fails += (await captureAndScan(page, 'light', 'light-settled', 700)) > VEIL_CLUSTER_LIMIT ? 1 : 0;
// worst case: share immediately after opening a song (animations would be mid-fade)
fails += (await captureAndScan(page, 'dark', 'dark-immediate', 0)) > VEIL_CLUSTER_LIMIT ? 1 : 0;

await browser.close(); server.close();
if (fails) { console.error(`\nFAIL: ${fails} capture(s) had a large-area veil`); process.exit(1); }
console.log('\nSHARE IMAGE CLEAN (both themes + immediate share)');
