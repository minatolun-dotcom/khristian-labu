// Unit tests for the review layer's revision replay and fingerprints.
// Plain node (no D1, no browser): these are the rules that decide whether an
// approval may overwrite a song, so they are tested without any UI around them.
// Run: node scripts/test_revision_logic.mjs
import assert from 'node:assert/strict';
import {
  baseRev,
  canonical,
  payloadTarget,
  publishedChartFrom,
  publishedSongFrom,
  sha256Text,
  staleProposals,
} from '../workers/api/src/revisions.mjs';

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('use checkAsync for async tests');
    passed++;
    console.log('PASS  ' + name);
  } catch (error) {
    failures.push(name + ' — ' + error.message);
    console.log('FAIL  ' + name + ' — ' + error.message);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS  ' + name);
  } catch (error) {
    failures.push(name + ' — ' + error.message);
    console.log('FAIL  ' + name + ' — ' + error.message);
  }
}

const song = (id, title, lines) => ({
  id, title, author: 'A', number: '1', key: 'G',
  verses: [{ type: 'v', lines: lines || ['first line'] }],
});
const songRow = (seq, id, cat, value) => ({
  seq, kind: 'song', payload: { id, cat, op: 'update', song: value },
});
const chartRow = (seq, id, chart) => ({ seq, kind: 'chord', payload: { id, chart } });
const chart = (key, chords) => ({ key, verses: 1, chords, lines: [[{ at: 0, ch: chords[0] }]] });

check('canonical is independent of key order', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 4, c: 3 }] }), canonical({ a: [2, { c: 3, d: 4 }], b: 1 }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});

check('payloadTarget reads the song id for every kind', () => {
  assert.equal(payloadTarget('song', { id: 'S1', cat: 'B&P' }), 'S1');
  assert.equal(payloadTarget('chord', { id: 'S1', chart: {} }), 'S1');
  assert.equal(payloadTarget('struct', { id: 'B&P', op: 'renameBook' }), 'B&P');
  assert.equal(payloadTarget('song', null), '');
});

check('a song with no published rows replays to nothing', () => {
  const state = publishedSongFrom([], 'S1');
  assert.deepEqual(state, { song: null, cat: null, deleted: false });
});

check('replay keeps the latest published version of one song', () => {
  const rows = [
    songRow(1, 'S1', 'B&P', song('S1', 'First')),
    songRow(2, 'OTHER', 'B&P', song('OTHER', 'Unrelated')),
    songRow(3, 'S1', 'B&P', song('S1', 'Second')),
  ];
  const state = publishedSongFrom(rows, 'S1');
  assert.equal(state.song.title, 'Second');
  assert.equal(state.cat, 'B&P');
});

check('replay tracks a published delete and a later re-add', () => {
  const rows = [
    songRow(1, 'S1', 'B&P', song('S1', 'Alive')),
    { seq: 2, kind: 'song', payload: { id: 'S1', cat: 'B&P', op: 'delete', song: { id: 'S1' } } },
  ];
  assert.equal(publishedSongFrom(rows, 'S1').deleted, true);
  rows.push(songRow(3, 'S1', 'B&P', song('S1', 'Back')));
  const state = publishedSongFrom(rows, 'S1');
  assert.equal(state.deleted, false);
  assert.equal(state.song.title, 'Back');
});

check('chart replay keeps the newest chart for one song', () => {
  const rows = [chartRow(1, 'S1', chart('G', ['G'])), chartRow(2, 'S1', chart('D', ['D']))];
  assert.equal(publishedChartFrom(rows, 'S1').key, 'D');
  assert.equal(publishedChartFrom(rows, 'S2'), null);
});

await checkAsync('a song fingerprint is stable for the same revision and changes when it moves', async () => {
  const proposal = { kind: 'song', payload: { id: 'S1', cat: 'B&P', op: 'update', song: song('S1', 'A') } };
  const atSubmit = await baseRev('song', proposal.payload, []);
  const same = await baseRev('song', proposal.payload, [songRow(9, 'OTHER', 'B&P', song('OTHER', 'X'))]);
  assert.equal(atSubmit, '');
  assert.equal(same, '');
  const afterEdit = await baseRev('song', proposal.payload, [songRow(1, 'S1', 'B&P', song('S1', 'A'))]);
  assert.notEqual(afterEdit, atSubmit);
  const reordered = await baseRev('song', proposal.payload, [
    { seq: 1, kind: 'song', payload: { song: song('S1', 'A'), op: 'update', cat: 'B&P', id: 'S1' } },
  ]);
  assert.equal(reordered, afterEdit, 'key order must not change the fingerprint');
});

await checkAsync('a chord fingerprint follows the published chart', async () => {
  const payload = { id: 'S1', chart: chart('G', ['G', 'C']) };
  assert.equal(await baseRev('chord', payload, []), '');
  const a = await baseRev('chord', payload, [chartRow(1, 'S1', chart('G', ['G', 'C']))]);
  const b = await baseRev('chord', payload, [chartRow(1, 'S1', chart('G', ['G', 'D']))]);
  assert.match(a, /^chart:[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

await checkAsync('staleProposals flags only proposals whose revision moved', async () => {
  const fresh = { id: 1, kind: 'song', payload: { id: 'S1', cat: 'B&P', op: 'update', song: song('S1', 'A') } };
  fresh.base_rev = await baseRev('song', fresh.payload, [songRow(1, 'S1', 'B&P', song('S1', 'A'))]);
  const outdated = { id: 2, kind: 'song', payload: { id: 'S2', cat: 'B&P', op: 'update', song: song('S2', 'B') } };
  outdated.base_rev = await baseRev('song', outdated.payload, []);
  const legacy = { id: 3, kind: 'song', payload: { id: 'S3', cat: 'B&P', op: 'update', song: song('S3', 'C') }, base_rev: null };

  const rows = async id => (id === 'S1'
    ? [songRow(1, 'S1', 'B&P', song('S1', 'A'))]
    : [songRow(2, 'S2', 'B&P', song('S2', 'Changed by someone else'))]);
  const stale = await staleProposals([fresh, outdated, legacy], rows);
  assert.equal(stale.length, 1, JSON.stringify(stale));
  assert.equal(stale[0].id, 2);
  assert.equal(stale[0].expected, '');
  assert.match(stale[0].current, /^song:/);
});

await checkAsync('a proposal submitted against an empty layer goes stale once anything publishes', async () => {
  const proposal = { id: 4, kind: 'chord', payload: { id: 'S9', chart: chart('C', ['C']) }, base_rev: '' };
  const stale = await staleProposals([proposal], async () => [chartRow(5, 'S9', chart('C', ['C', 'F']))]);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].id, 4);
});

await checkAsync('fingerprints do not leak the payload', async () => {
  const id = await sha256Text('hello');
  assert.match(id, /^[0-9a-f]{64}$/);
  const rev = await baseRev('song', { id: 'S1', cat: 'B&P', op: 'update', song: song('S1', 'Secret title') }, []);
  assert.equal(rev, '');
});

console.log(`\n${passed}/${passed + failures.length} PASS`);
if (failures.length) {
  console.log('FAILURES:\n' + failures.map(f => '  ' + f).join('\n'));
  process.exit(1);
}
