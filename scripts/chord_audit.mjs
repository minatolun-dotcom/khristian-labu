#!/usr/bin/env node
// Read-only chord audit for the BL songbook.
// It does NOT change chords.json. It scores every chart on what the corpus can
// prove: printed-key agreement, cadence, event density, verse coverage,
// duplicate moves, and whether hymns sharing one printed tune use the same
// harmonic pattern. Melody-note coverage is intentionally not guessed: the
// PDF's solfa glyph layer is lossy, so that needs a reliable transcription
// source before it can be scored.
//
// Usage: node scripts/chord_audit.mjs [--json /tmp/labu-chord-audit.json] [--top 30]
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const songs = JSON.parse(fs.readFileSync(path.join(ROOT, 'songs.json'), 'utf8'));
const charts = JSON.parse(fs.readFileSync(path.join(ROOT, 'chords.json'), 'utf8'));
const TOP = Number((process.argv.find(a => a.startsWith('--top=')) || '').split('=')[1] || 30);
const JSON_OUT = (process.argv.find(a => a.startsWith('--json=')) || '').split('=')[1] || '';

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const rootOf = ch => (String(ch || '').match(/^([A-G](?:#|b)?)/) || [])[1];
const keyNames = raw => String(raw || '').replace(/^(key\s*|doh\s+is\s*)/i, '').split(/\s+or\s+/i)
  .map(s => s.replace(/\s*flat\b/i, 'b').replace(/\s*sharp\b/i, '#'))
  .map(s => (s.match(/^([A-G](?:#|b)?)/i) || [])[1])
  .filter(Boolean)
  .map(s => s[0].toUpperCase() + s.slice(1));
const keyPc = n => (n && PC[n] != null ? PC[n] : null);
const dia = key => new Set(MAJOR.map(o => (keyPc(key) + o) % 12));
const normCh = ch => String(ch || '').replace(/^([A-G](?:#|b)?).*$/, '$1');

const bySolfa = {};
for (const s of songs.BL.songs) if (s.solfa) (bySolfa[s.solfa] = bySolfa[s.solfa] || []).push(s);

function pattern(c) {
  const ck = keyNames(c.key)[0];
  if (!ck || !c.verseLines) return null;
  return c.verseLines.map(v => v.map(line => line.map(e => {
    const r = rootOf(e.ch);
    return r && PC[r] != null ? (PC[r] - keyPc(ck) + 12) % 12 : '?';
  }).join('.')).join('/')).join('|');
}

// Only compare charts with the same printed line structure. A shared tune set
// in a different metre/refrain layout is a different arrangement, not a defect.
const structure = c => (c.verseLines || []).map(v => (v || []).length).join(',');
const sharedFlag = new Set();
let sharedGroups = 0;
for (const arr of Object.values(bySolfa)) {
  if (arr.length < 2) continue;
  const withCharts = arr.map(s => ({ s, c: charts[s.id] })).filter(x => x.c);
  const byStructure = {};
  for (const x of withCharts) (byStructure[structure(x.c)] = byStructure[structure(x.c)] || []).push(x);
  for (const group of Object.values(byStructure)) {
    if (group.length < 2) continue;
    sharedGroups++;
    const base = pattern(group[0].c);
    if (!base) continue;
    for (const x of group.slice(1)) if (pattern(x.c) !== base) sharedFlag.add(x.s.id);
  }
}

const rows = [];
for (const s of songs.BL.songs) {
  const c = charts[s.id];
  const printed = keyNames(s.key);
  const reasons = [];
  let score = 0;
  if (!c) {
    rows.push({ id: s.id, title: s.title, score: s.solfa ? 60 : 20, reasons: [s.solfa ? 'solfa sheet but no published chart' : 'no solfa and no chart'] });
    continue;
  }
  const ck = keyNames(c.key)[0];
  if (printed.length && ck && !printed.includes(ck)) { score += 40; reasons.push('chart key ' + ck + ' vs printed ' + printed.join(' or ')); }
  const lines = (c.verseLines || []).flat();
  const events = lines.flat().filter(e => e && e.ch);
  const density = lines.length ? events.length / lines.length : 0;
  if (events.length && density < 1.3) { score += 12; reasons.push('thin (' + density.toFixed(2) + ' changes/line)'); }
  const roots = new Set(events.map(e => normCh(e.ch)).filter(Boolean));
  if (roots.size <= 2 && events.length) { score += 18; reasons.push('only ' + roots.size + ' distinct chords'); }
  let dups = 0;
  for (const line of lines) for (let i = 1; i < line.length; i++) if (line[i].ch === line[i - 1].ch) dups++;
  if (dups) { score += Math.min(15, dups * 3); reasons.push(dups + ' repeated consecutive chord(s)'); }
  let cadFails = 0;
  for (const v of c.verseLines || []) {
    const last = v.filter(l => l.length).pop();
    if (!last) continue;
    const r = rootOf(last[last.length - 1].ch);
    if (r && PC[r] != null && PC[r] !== keyPc(ck)) cadFails++;
  }
  if (cadFails) { score += cadFails * 8; reasons.push(cadFails + ' verse(s) not ending on the chart tonic'); }
  const songDia = printed.length ? new Set(printed.flatMap(k => [...dia(k)])) : null;
  const outside = songDia ? events.filter(e => { const r = rootOf(e.ch); return r && PC[r] != null && !songDia.has(PC[r]); }).length : 0;
  if (outside) { score += Math.min(25, Math.round(25 * outside / Math.max(events.length, 1))); reasons.push(outside + ' event(s) outside the printed key'); }
  if (Array.isArray(c.verses)) {
    const want = s.verses.filter(v => (v.type || 'v') !== 'p').length;
    if (c.verses !== want) { score += 10; reasons.push('chart covers ' + c.verses + '/' + want + ' verses'); }
  }
  if (sharedFlag.has(s.id)) { score += 18; reasons.push('differs from another hymn sharing this printed tune'); }
  rows.push({ id: s.id, title: s.title, score, reasons, density, chords: [...roots] });
}

rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
const flagged = rows.filter(r => r.score > 0);
const summary = {
  songs: songs.BL.songs.length,
  charts: Object.keys(charts).filter(k => !k.endsWith('__t2')).length,
  twoTuneCharts: Object.keys(charts).filter(k => k.endsWith('__t2')).length,
  flagged: flagged.length,
  missingCharts: rows.filter(r => r.reasons.some(x => /no (published )?chart/.test(x))).length,
  keyMismatches: rows.filter(r => r.reasons.some(x => /chart key/.test(x))).length,
  sparse: rows.filter(r => r.reasons.some(x => /distinct chords/.test(x))).length,
  thin: rows.filter(r => r.reasons.some(x => /thin /.test(x))).length,
  repeated: rows.filter(r => r.reasons.some(x => /repeated consecutive/.test(x))).length,
  cadence: rows.filter(r => r.reasons.some(x => /not ending/.test(x))).length,
  outsideKey: rows.filter(r => r.reasons.some(x => /outside the printed key/.test(x))).length,
  sharedMismatch: rows.filter(r => r.reasons.some(x => /sharing this printed tune/.test(x))).length,
  sharedGroups
};
console.log('CHORD AUDIT (read-only)');
console.log(JSON.stringify(summary, null, 2));
console.log('\nWorst ' + TOP + ' by structural confidence:');
for (const r of flagged.slice(0, TOP)) console.log('  ' + r.id.padEnd(9) + ' score ' + String(r.score).padStart(3) + '  ' + r.reasons.join(' · '));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, rows }, null, 1));
