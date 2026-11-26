// Cloud sync: the Worker API, the approved layer, this device's outbox and the
// sync loop. Split out of app.js (9k lines) so the reader, search and chord code
// and the cloud code can be read separately. app.js loads after this file and both
// share the page's globals; nothing here runs at load time.

// ─── CLOUD SYNC (Cloudflare Worker + D1) — approved changes reach every device ───
// The API URL is baked in for production. `window.LABU_CLOUD_API` wins so a fork
// or test harness can point at staging, and an empty value disables cloud sync
// exactly as before: edits stay on this device and nothing is submitted.
const CLOUD_API = String(
  (typeof window !== 'undefined' && window.LABU_CLOUD_API !== undefined)
    ? window.LABU_CLOUD_API
    : 'https://api.labu.lengkhawm.online'
).replace(/\/+$/, '');
const CLOUD_ON = !!CLOUD_API;
const CLOUD_POLL_MS = 5 * 60 * 1000;

// ─── CLOUD REVIEW / PUBLISH (Supabase) ───
// The published corpus stays songs.json; Supabase stores only the *diff* layer.
// Load order is: base corpus → approved edits (published_edits) → this device's
// own edits. An admin's approval appends to that layer and bumps publish_state, so
// the next device to check gets it without a rebuild or a redeploy.
let PUB = { version: -1, edits: [] };
let PUB_CHORDS = {};
let cloudAdmin = false;
let cloudPending = [];
let _cloudSyncing = false;
// Cloud auth is cookie-only: the Worker sets an HttpOnly session cookie, so no
// token is ever available to page script or localStorage.
let _cloudSession = null;
let _cloudCookieChecked = false;

function cloudSession() {
  return _cloudSession && _cloudSession.api === CLOUD_API ? _cloudSession : null;
}
function cloudSaveSession(s) {
  _cloudSession = s ? { ...s, api: CLOUD_API } : null;
  // Remove tokens left by older builds that persisted the session in localStorage.
  try { localStorage.removeItem('labu_cloud_session'); } catch (e) {}
}
async function cloudReq(path, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  const hasBody = Object.prototype.hasOwnProperty.call(opts, 'body');
  if (hasBody) headers['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 8000);
  try {
    const r = await fetch(CLOUD_API + path, {
      method: opts.method || (hasBody ? 'POST' : 'GET'),
      headers,
      credentials: 'include',
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: ctl.signal,
    });
    const text = await r.text();
    if (r.status === 401) { cloudAdmin = false; cloudSaveSession(null); }
    if (!r.ok) throw new Error('cloud ' + r.status + ' ' + text.slice(0, 160));
    return text ? JSON.parse(text) : null;
  } finally { clearTimeout(timer); }
}

// Pull the approved layer (cached in IndexedDB so an offline start still has it).
// It outgrew localStorage — ~1.4 MB today — and, because writes there fail with
// QuotaExceededError past ~5 MB, it used to starve the keys that hold favorites,
// recents and playlists.
const PUB_CACHE_KEY = 'published';
async function cloudReadLayerCache() {
  try {
    const hit = await idbGet('cache', PUB_CACHE_KEY);
    if (hit && Array.isArray(hit.edits)) return hit;
  } catch (e) {}
  // One-time carry-over from the old localStorage copy, then free that space.
  try {
    const legacy = JSON.parse(localStorage.getItem('labu_pub_cache') || 'null');
    if (legacy && Array.isArray(legacy.edits)) {
      localStorage.removeItem('labu_pub_cache');
      return legacy;
    }
  } catch (e) {}
  return null;
}
async function cloudLoadLayer(force) {
  if (!CLOUD_ON) return;
  const cached = await cloudReadLayerCache();
  if (cached) { PUB = cached; PUB_CHORDS = {}; }
  let version;
  try {
    const st = await cloudReq('/api/state', { timeout: 5000 });
    version = st ? Number(st.version) || 0 : 0;
  } catch (e) { return; }
  if (!force && PUB.version === version) return;
  try {
    const since = force ? 0 : (PUB.edits || []).reduce((max, row) => Math.max(max, Number(row && row.seq) || 0), 0);
    // The layer is served in pages now, so fetch until a short one comes back.
    const LAYER_PAGE = 500;
    const fetched = [];
    let cursor = since;
    for (let guard = 0; guard < 200; guard++) {
      const page = await cloudReq('/api/published-edits?since=' + cursor + '&limit=' + LAYER_PAGE);
      const rows = Array.isArray(page) ? page : [];
      fetched.push(...rows);
      if (rows.length < LAYER_PAGE) break;
      const next = Number(rows[rows.length - 1].seq);
      if (!Number.isFinite(next) || next <= cursor) break;
      cursor = next;
    }
    const incoming = fetched.filter(x => x && x.payload);
    const merged = since > 0 ? (PUB.edits || []).concat(incoming) : incoming;
    const seen = new Set();
    const edits = merged.filter(row => {
      const seq = Number(row && row.seq);
      if (!Number.isFinite(seq) || seq <= 0 || seen.has(seq)) return false;
      seen.add(seq);
      return true;
    }).sort((a, b) => Number(a.seq) - Number(b.seq));
    PUB = { version: version, edits: edits };
    PUB_CHORDS = {};
    try { await idbPut('cache', PUB, PUB_CACHE_KEY); } catch (e) {}
  } catch (e) { /* keep the cached layer */ }
}
function applyPublished() {
  PUB_CHORDS = {};
  (PUB.edits || []).forEach(row => {
    if (!row || !row.payload) return;
    if (row.kind === 'chord') {
      if (isSafeBackupId(row.payload.id) && row.payload.chart && typeof row.payload.chart === 'object' && !Array.isArray(row.payload.chart)) {
        PUB_CHORDS[row.payload.id] = row.payload.chart;
      }
    } else if (row.payload.cat !== undefined) {
      applyEdit(row.payload);
    }
  });
}

// ── submissions ──
function cloudBookName(code) {
  if (!code) return '';
  if (SONGS[code]) return (SONGS[code].info && SONGS[code].info.name) || code;
  return BOOK_META_NAME[code] || code;
}
function cloudDescribe(kind, payload) {
  payload = payload || {};
  if (kind === 'chord') return 'Chord chart · ' + (payload.title || payload.id || 'song');
  const op = payload.op;
  if (op === 'delete') return 'Delete “' + ((payload.song && payload.song.title) || payload.id) + '”';
  if (op === 'addGroup') return 'New main songbook “' + ((payload.song && payload.song.name) || '') + '”';
  if (op === 'addBook') return 'New songbook “' + ((payload.song && payload.song.name) || '') + '”';
  if (op === 'renameGroup') return 'Rename main songbook → “' + ((payload.song && payload.song.name) || '') + '”';
  if (op === 'renameBook') return 'Rename songbook → “' + ((payload.song && payload.song.name) || '') + '”';
  if (op === 'deleteBook') return 'Delete songbook “' + cloudBookName(payload.id) + '”';
  if (op === 'deleteGroup') return 'Delete main songbook “' + (payload.id || '') + '”';
  const title = (payload.song && payload.song.title) || payload.id || 'song';
  const cat = payload.cat || payload.from;
  return 'Edit “' + title + '”' + (cat ? ' · ' + cloudBookName(cat) : '');
}
function cloudOutbox() {
  try {
    const q = JSON.parse(localStorage.getItem('labu_cloud_outbox') || '[]');
    return Array.isArray(q) ? q : [];
  } catch (e) { return []; }
}
function cloudSetOutbox(q) {
  // Keep every queued edit. Trimming to the last 100 (as this did) silently lost
  // the start of a long offline session. If the quota is ever hit, shed the
  // oldest half instead of dropping the whole queue.
  for (const batch of [q, q.slice(Math.floor(q.length / 2))]) {
    try { localStorage.setItem('labu_cloud_outbox', JSON.stringify(batch)); return; } catch (e) {}
  }
}
async function cloudRestoreSession() {
  if (!CLOUD_ON) return false;
  if (cloudSession()) return true;
  if (_cloudCookieChecked) return false;
  _cloudCookieChecked = true;
  try {
    const me = await cloudReq('/api/admin/me');
    if (me && me.user && me.isAdmin) {
      cloudSaveSession({ email: me.user.email || me.user.login || '', user: me.user });
      cloudAdmin = true;
      return true;
    }
  } catch (e) {}
  return false;
}
async function cloudCheckAdmin() {
  if (!CLOUD_ON) return false;
  if (!cloudSession() && !(await cloudRestoreSession())) { cloudAdmin = false; return false; }
  if (cloudAdmin) return true;
  try {
    const me = await cloudReq('/api/admin/me');
    cloudAdmin = !!(me && me.isAdmin);
    if (cloudAdmin && me.user) {
      const current = cloudSession() || {};
      cloudSaveSession({
        ...current,
        email: me.user.email || me.user.login || current.email || '',
        login: me.user.login || '',
        user: me.user,
      });
    }
  } catch (e) { cloudAdmin = false; }
  return cloudAdmin;
}
async function cloudPublishNow(kind, payload) {
  await cloudReq('/api/admin/publish', { body: { kind: kind, payload: payload } });
  try { await idbDel('cache', PUB_CACHE_KEY); } catch (e) {}
  PUB.version = -1; // force the next check to re-read the layer
}
async function cloudSendProposal(item) {
  const s = cloudSession();
  await cloudReq('/api/proposals', { body: {
    kind: item.kind,
    payload: item.payload,
    summary: item.summary || cloudDescribe(item.kind, item.payload),
    name: s ? (s.login || s.email || '') : '',
    baseVersion: DATA_VERSION,
  } });
}
// Fire-and-forget: the local save has already happened, so a slow/absent network
// never blocks editing. Failures wait in an outbox and retry when back online.
async function submitChange(kind, payload) {
  if (!CLOUD_ON) return 'off';
  let snapshot;
  try { snapshot = JSON.parse(JSON.stringify(payload)); } catch (e) { snapshot = payload; }
  const item = { kind: kind, payload: snapshot, summary: cloudDescribe(kind, snapshot), at: Date.now() };
  try {
    if (await cloudCheckAdmin()) {
      await cloudPublishNow(kind, snapshot);
      return 'published';
    }
    await cloudSendProposal(item);
    // Quiet by design: a normal user's change is only staged for review, so say
    // nothing. The local save already happened and that is all they need to see.
    return 'review';
  } catch (e) {
    cloudSetOutbox(cloudOutbox().concat([item]));
    // Also silent: the outbox flushes on its own once the network returns.
    return 'queued';
  }
}
async function cloudFlushOutbox() {
  if (!CLOUD_ON) return;
  let q = cloudOutbox();
  if (!q.length) return;
  const isAdmin = await cloudCheckAdmin();
  for (const item of q.slice()) {
    try {
      if (isAdmin) await cloudPublishNow(item.kind, item.payload);
      else await cloudSendProposal(item);
      q = q.filter(x => x !== item);
      cloudSetOutbox(q);
    } catch (e) { break; }
  }
}

// ── background check ──
async function cloudCheckForUpdates(force, btn) {
  if (!CLOUD_ON || _cloudSyncing) return false;
  _cloudSyncing = true;
  setCloudButtonBusy(btn, true, 'Syncing…');
  let ok = false;
  let current = false;
  try {
    let st;
    try { st = await cloudReq('/api/state'); }
    catch (e) { return false; }
    const version = st ? Number(st.version) || 0 : 0;
    if (!force && version === PUB.version) {
      current = true;
      // Nothing new to pull, but the queue may still have moved: refresh its rows.
      if (document.getElementById('cloudPanel')) await cloudQueueLoad();
      return false;
    }
    await cloudLoadLayer(force);
    if (!songsReady) return false;
    ok = await cloudApplyLayerToCorpus();
    if (document.getElementById('cloudPanel')) await cloudQueueLoad();
    return ok;
  } finally {
    _cloudSyncing = false;
    // The panel repaints during a sync, so answer on whichever button is on screen.
    const live = document.querySelector('#cloudPanel [data-action="cloudCheckForUpdates"]') || btn;
    if (ok) flashCloudButton(live, 'Synced');
    else if (current) flashCloudButton(live, 'Up to date');
    else setCloudButtonBusy(live, false);
  }
}
// Rebuild the in-memory corpus from the pristine IndexedDB base copy, then replay
// the approved layer + this device's edits. IDB returns a structured clone, so the
// base is never the already-mutated object.
async function cloudApplyLayerToCorpus() {
  let cache = null;
  try { cache = await idbGet('cache', corpusCacheKey()); } catch (e) {}
  if (!cache || !cache.data || !Object.keys(cache.data).length) return false;
  SONGS = cache.data;
  applyPublished();
  try { (await idbGetAll('edits')).forEach(applyEdit); } catch (e) {}
  GROUPS = SONGS.groups || [];
  reindexBooks();
  buildSearchIndex();
  updateStats();
  if (currentView === 'admin') renderAdminPanel();
  else if (currentView === 'settings') renderSongbookPrefs();
  renderGroups();
  renderFavRecents();
  return true;
}
function cloudStart() {
  if (!CLOUD_ON) return;
  const tick = () => { if (!document.hidden) { cloudFlushOutbox(); cloudCheckForUpdates(); } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('online', tick);
  setInterval(tick, CLOUD_POLL_MS);
  setTimeout(tick, 4000);
}
