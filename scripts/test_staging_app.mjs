// End-to-end staging browser test: submit an anonymous local edit, sign in as
// the allowlisted admin, approve it, and verify the corpus updates.
//
// This writes one published edit to staging and bumps its version. Clean up
// afterwards with scripts/cleanup_staging_test.sql if re-running from baseline.
// Run: LABU_API_URL=https://api-staging.labu.lengkhawm.online node scripts/test_staging_app.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const API = (process.env.LABU_API_URL || 'https://api-staging.labu.lengkhawm.online').replace(/\/+$/, '');
const devVars = Object.fromEntries(
  fs.existsSync('workers/api/.dev.vars')
    ? fs.readFileSync('workers/api/.dev.vars', 'utf8').split(/\r?\n/).map(line => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
    : [],
);
const email = process.env.LABU_TEST_EMAIL || devVars.STAGING_ADMIN_EMAIL;
const password = process.env.LABU_TEST_PASSWORD || devVars.STAGING_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Set LABU_TEST_EMAIL/LABU_TEST_PASSWORD or create workers/api/.dev.vars');

const MIME = { '.html': 'text/html', '.json': 'application/json', '.gzip': 'application/gzip', '.png': 'image/png', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.avif': 'image/avif' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(8791, '127.0.0.1', resolve));

let failed = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : ' — ' + detail}`);
  if (!condition) failed++;
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(api => { window.LABU_CLOUD_API = api; }, API);
  await page.goto('http://localhost:8791/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof songsReady !== 'undefined' && songsReady === true, null, { timeout: 30000 });

  const initial = await page.evaluate(() => fetch(CLOUD_API + '/api/state').then(r => r.json()));
  check('app reads the staging Worker', Number.isInteger(initial.version), JSON.stringify(initial));
  check('staging baseline is version 772', initial.version === 772, String(initial.version));
  check('app loaded the published overlay', await page.evaluate(() => PUB.edits.length === 772));

  const unique = 'staging_app_' + Date.now().toString(36);
  await page.evaluate(async id => {
    const song = {
      id, title: 'Staging App Loop', author: 'Contract test', number: '999', key: 'C',
      verses: [{ type: 'v', lines: ['a staging loop line'] }],
    };
    SONGS['B&P'].songs.push(song);
    await recordEdit('B&P', song, 'update');
  }, unique);
  await page.waitForTimeout(2000);

  await page.evaluate(() => openAdminAccount());
  await page.waitForFunction(() =>
    document.getElementById('adminAccountBody')?.textContent.includes('Admin sign in'), null, { timeout: 10000 });
  await page.fill('#adminAccountLogin', email);
  await page.fill('#adminAccountPass', password);
  await page.click('#adminAccountSignInBtn');
  await page.waitForFunction(() => {
    const el = document.getElementById('cloudPanel');
    return el && el.textContent.includes('Review queue');
  }, null, { timeout: 10000 });
  check('admin signs in through the app', true);
  check('anonymous proposal reached the staging queue', (await page.textContent('#cloudPanel')).includes('Staging App Loop'));

  await page.locator('.cloud-item .btn-primary').first().click();
  await page.waitForFunction(id => PUB.edits.some(e => e.payload && e.payload.id === id), unique, { timeout: 15000 });
  check('approval appears in the published overlay', true);
  const after = await page.evaluate(() => fetch(CLOUD_API + '/api/state').then(r => r.json()));
  check('approval advanced the staging version', after.version === 773, JSON.stringify(after));
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`TEST_SONG_ID=${unique}`);
} finally {
  await browser.close();
  server.close();
}

console.log(failed ? `\n${failed} STAGING APP TEST(S) FAILED` : '\nSTAGING APP TEST PASSED');
process.exit(failed ? 1 : 0);
