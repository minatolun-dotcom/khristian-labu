// Revision helpers for the review queue.
//
// A proposal is a patch, but it always carries the complete proposed song (or
// chord chart). To judge it the admin needs the other side: the song as it is
// published right now. The published layer is the ordered list of
// `published_edits` rows, so replaying the rows that touch one song yields that
// song's published state without storing a second copy anywhere.
//
// The same replay gives a *revision fingerprint* (`baseRev`). It is written to a
// proposal when it is submitted and recomputed when it is approved: if the two
// differ, the song changed while the proposal waited and approving it would
// overwrite that change, so the approval is refused instead of merged.

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Which song (or, for structure edits, which group/book) a payload belongs to.
// Mirrors the payload shapes validated by index.mjs.
export function payloadTarget(kind, payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (kind === 'chord') return typeof payload.id === 'string' ? payload.id : '';
  if (kind === 'song') return typeof payload.id === 'string' ? payload.id : '';
  if (kind === 'struct') {
    if (typeof payload.from === 'string' && payload.from) return payload.from;
    return typeof payload.id === 'string' ? payload.id : '';
  }
  return '';
}

// Rows may predate the `target` column, so callers pass every candidate row and
// this filters on the payload it can see.
function rowsFor(rows, kind, id) {
  return (rows || []).filter(row => row && row.kind === kind && row.payload && row.payload.id === id);
}

export function publishedSongFrom(rows, id) {
  let song = null;
  let cat = null;
  let deleted = false;
  for (const row of rowsFor(rows, 'song', id)) {
    const payload = row.payload;
    if (payload.op === 'delete') {
      song = null;
      cat = null;
      deleted = true;
      continue;
    }
    song = payload.song || null;
    cat = typeof payload.cat === 'string' ? payload.cat : null;
    deleted = false;
  }
  return { song, cat, deleted };
}

export function publishedChartFrom(rows, id) {
  let chart = null;
  for (const row of rowsFor(rows, 'chord', id)) {
    if (row.payload.chart && typeof row.payload.chart === 'object') chart = row.payload.chart;
  }
  return chart;
}

// Fingerprint of what the reviewer's "original" side would show. Empty string
// means nothing for this song has been published yet (the payload sits on the
// bundled corpus), which is itself a valid revision.
export async function baseRev(kind, payload, rows) {
  const id = payloadTarget(kind, payload);
  if (!id) return '';
  if (kind === 'chord') {
    const chart = publishedChartFrom(rows, id);
    return chart ? 'chart:' + await sha256Text(canonical(chart)) : '';
  }
  if (kind === 'song') {
    const { song, cat, deleted } = publishedSongFrom(rows, id);
    if (!song) return deleted ? 'deleted' : '';
    return 'song:' + await sha256Text(canonical({ cat, song }));
  }
  // Structure edits are applied per group/book and are reviewed as a summary;
  // there is no per-song revision to compare.
  return '';
}

// Proposals written before fingerprints existed cannot be compared, but the
// published layer still records when each revision landed. If nothing for this
// song was published after the submission, approving it cannot overwrite a
// later change, so the legacy row can be approved safely.
export function changedSince(rows, id, at) {
  const since = Number(at) || 0;
  return (rows || []).some(row => {
    if (!row || !row.payload) return false;
    if (id && row.payload.id !== id) return false;
    return Number(row.published_at) > since;
  });
}

// Which of the given proposals would overwrite something that moved on.
// `rowsForTarget` is called with the song id and returns that song's published
// edit rows. A proposal submitted before fingerprints existed (base_rev is null)
// cannot be checked and is left for the caller to treat as unverified.
export async function staleProposals(proposals, rowsForTarget) {
  const stale = [];
  for (const proposal of proposals || []) {
    if (!proposal || proposal.base_rev == null) continue;
    const id = payloadTarget(proposal.kind, proposal.payload);
    const rows = id && typeof rowsForTarget === 'function' ? await rowsForTarget(id) : [];
    const current = await baseRev(proposal.kind, proposal.payload, rows);
    if (current !== proposal.base_rev) {
      stale.push({ id: Number(proposal.id), expected: proposal.base_rev, current });
    }
  }
  return stale;
}
