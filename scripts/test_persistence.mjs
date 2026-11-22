// Focused regression test for the data-preservation paths that the full E2E
// suite only exercised indirectly: IndexedDB edit persistence, move replay, and
// chord-chart backup/restore.
// Run: node scripts/test_persistence.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html', '.json': 'application/json', '.gzip': 'application/gzip',
  '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
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
const URL = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
let failed = false;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : ' — ' + detail}`);
  if (!condition) failed = true;
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // Keep test edits local: the shipped config points at the live Supabase project.
  await page.addInitScript(() => { window.LABU_SUPABASE = {}; });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('statSongs')?.textContent.includes('5,7'), null, { timeout: 30000 });

  const setup = await page.evaluate(async () => {
    const src = CAT_ORDER[0];
    const dst = CAT_ORDER[1];
    const original = SONGS[src].songs[0];
    const id = original.id;
    const edited = { ...original, title: original.title + ' [persistence test]' };
    SONGS[src].songs.splice(SONGS[src].songs.findIndex(s => s.id === id), 1);
    SONGS[dst].songs.push(edited);
    await saveSongs();
    await recordEdit(dst, edited, 'update', src);

    const chart = {
      key: 'C',
      lines: [[{ at: 0, ch: 'C' }]],
      verseLines: [[[{ at: 0, ch: 'C' }]]],
      verses: 1,
      chords: ['C'],
      free: true,
    };
    CHORD_CHARTS[id] = chart;
    USER_CHORD_IDS.add(id);
    const chordSaved = saveUserChordCharts();
    const backup = await buildBackupPayload();
    return {
      id, src, dst, chordSaved,
      hasEdit: (await idbGetAll('edits')).some(e => e.id === id),
      hasChart: !!(backup.chordCharts && backup.chordCharts[id]),
      backup,
    };
  });

  check('recordEdit writes the edit to IndexedDB', setup.hasEdit);
  check('saveUserChordCharts reports success', setup.chordSaved);
  check('backup payload includes the user chord chart', setup.hasChart);

  // Re-fetch the base corpus (simulates an app/corpus refresh) while keeping edits.
  await page.evaluate(async () => {
    const db = await _idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('statSongs')?.textContent.includes('5,7'), null, { timeout: 30000 });

  const afterRefresh = await page.evaluate(({ id, src, dst }) => ({
    src: SONGS[src].songs.filter(s => s.id === id).length,
    dst: SONGS[dst].songs.filter(s => s.id === id).length,
    title: (SONGS[dst].songs.find(s => s.id === id) || {}).title || '',
  }), setup);
  check('moved song is gone from the source book', afterRefresh.src === 0, JSON.stringify(afterRefresh));
  check('moved song is present once in the destination book', afterRefresh.dst === 1, JSON.stringify(afterRefresh));
  check('edit survives the base-corpus refresh', afterRefresh.title.includes('[persistence test]'), afterRefresh.title);

  // Restore the captured backup and verify both the edit and chord chart come back.
  await page.evaluate(backup => { applyBackup(backup); }, setup.backup);
  await page.waitForTimeout(1600);
  await page.waitForFunction(() => document.getElementById('statSongs')?.textContent.includes('5,7'), null, { timeout: 30000 });
  const afterRestore = await page.evaluate(({ id, src, dst }) => ({
    src: SONGS[src].songs.filter(s => s.id === id).length,
    dst: SONGS[dst].songs.filter(s => s.id === id).length,
    chart: !!CHORD_CHARTS[id],
  }), setup);
  check('restore keeps the moved song out of the source book', afterRestore.src === 0, JSON.stringify(afterRestore));
  check('restore keeps the moved song in the destination book', afterRestore.dst === 1, JSON.stringify(afterRestore));
  check('restore brings back the user chord chart', afterRestore.chart, JSON.stringify(afterRestore));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
} catch (e) {
  console.error('FAIL  persistence test crashed: ' + e.message);
  failed = true;
} finally {
  await browser.close();
  server.close();
}

if (failed) process.exit(1);
console.log('\nPERSISTENCE + RESTORE OK');
