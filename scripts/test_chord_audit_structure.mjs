#!/usr/bin/env node
// Regression test for the shared-tune comparison in chord_audit.mjs.
// Two hymns may share a printed tune but use different lyric structures; those
// must not be compared. Charts with the same structure and different harmony
// must still be flagged.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.join(root, 'scripts', 'chord_audit.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'labu-audit-test-'));

const songs = {
  BL: {
    songs: [
      { id: 'T1', title: 'Different structure A', solfa: 'shared.avif', key: 'C', verses: [{ type: 'v', lines: ['a'] }] },
      { id: 'T2', title: 'Different structure B', solfa: 'shared.avif', key: 'C', verses: [{ type: 'v', lines: ['a', 'b'] }] },
      { id: 'T3', title: 'Same structure A', solfa: 'paired.avif', key: 'C', verses: [{ type: 'v', lines: ['a'] }] },
      { id: 'T4', title: 'Same structure B', solfa: 'paired.avif', key: 'C', verses: [{ type: 'v', lines: ['a'] }] },
    ],
  },
};

const e = (ch) => [{ at: 0, ch }];
const charts = {
  T1: { key: 'C', verseLines: [[e('C')]] },
  T2: { key: 'C', verseLines: [[e('C'), e('G')]] },
  T3: { key: 'C', verseLines: [[e('C')]] },
  T4: { key: 'C', verseLines: [[e('G')]] },
};

try {
  fs.writeFileSync(path.join(tmp, 'songs.json'), JSON.stringify(songs));
  fs.writeFileSync(path.join(tmp, 'chords.json'), JSON.stringify(charts));
  const out = path.join(tmp, 'audit.json');
  execFileSync(process.execPath, [audit, `--json=${out}`], { cwd: tmp, stdio: 'pipe' });
  const { summary, rows } = JSON.parse(fs.readFileSync(out, 'utf8'));
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  const sharedReason = (id) => (byId[id].reasons || []).some((r) => r.includes('sharing this printed tune'));

  assert.equal(summary.sharedMismatch, 1, 'one genuine shared-structure mismatch');
  assert.equal(summary.sharedGroups, 1, 'only the same-structure group is compared');
  assert.equal(sharedReason('T2'), false, 'a different lyric structure must not be flagged');
  assert.equal(sharedReason('T4'), true, 'same structure with different harmony must be flagged');
  console.log('PASS  chord audit shared-tune structure regression');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
