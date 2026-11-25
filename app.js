// ─── DATA ───
const DATA_VERSION = 39; // ponytail: bump when the corpus changes so cached gzip/IndexedDB reload
let CORPUS_HASH = '';
function dataQuery() {
  const parts = [];
  if (DATA_VERSION) parts.push('v=' + DATA_VERSION);
  if (CORPUS_HASH) parts.push('h=' + encodeURIComponent(CORPUS_HASH));
  return parts.length ? '?' + parts.join('&') : '';
}
const APP_VERSION = '1.5.83'; // ponytail: bump on release so the update checker can compare
const REPO = 'minatolun-dotcom/khristian-labu'; // ponytail: single source for update-check URLs
const LATEST_JSON = 'https://dl.labu.lengkhawm.online/latest.json';
let latestUpdate = null;
let updateState = 'idle';
let updatePercent = -1;
let updateMessage = '';
let updateMinimized = false;
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
// ─── GOOGLE DRIVE SYNC (manual cloud backup/restore into the user's own Drive) ───
// ponytail: paste your Google Cloud 'Web application' OAuth client ID here. It is a
// public identifier (safe to commit). Leave '' to hide the Google section entirely.
const GOOGLE_CLIENT_ID = '';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_BACKUP_FILE = 'khristian-labu-backup.json';
let DEFAULT_SONGS = null;
let SONGS = {};
let GROUPS = [];
let BOOK_GROUP = {};
// ponytail: users can turn off whole collections. The books stay in the corpus so
// saved favourites, playlists and historical links keep working; Home and search skip them.
function readJSON(key, fallback, valid) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw);
    if (valid && !valid(value)) return fallback;
    return value;
  } catch (e) { return fallback; }
}
let disabledGroups = readJSON('labu_disabled_groups', [], Array.isArray).filter(id => typeof id === 'string');
function saveDisabledGroups() { localStorage.setItem('labu_disabled_groups', JSON.stringify(disabledGroups)); }
function isGroupDisabled(id) { return disabledGroups.indexOf(id) !== -1; }
function enabledGroups() { return GROUPS.filter(g => !isGroupDisabled(g.id)); }
function enabledBookKeys() { return enabledGroups().flatMap(g => g.books || []); }
// ponytail: tiny groups.json lets the home grid paint before the full corpus is parsed.
let songsReady = false, songsDone = null;
const BOOK_META = {}, BOOK_META_NAME = {};
let currentHomeGrid = 'groupGrid';
// ponytail: track what's actually in the DOM so back/forward can just re-show it
// instead of rebuilding (which replays the fade-in and looks like a refresh).
let _rv = { grid: 'group', group: null, cat: null, listKind: 'home', pid: null };
// Pre-rendered category cards, keyed by group id; built under the startup cover.
let _catNodes = {}, _catGroup = null;
// which view the reader was opened from — the preview layer for edge-swipe back
let _detailOriginView = 'homeView';
// which view a song list was opened from (for its own edge-swipe-back preview)
let _listOriginView = 'homeView';
function showHomeRoot() {
  currentHomeGrid = 'groupGrid';
  document.getElementById('categoryGrid').classList.add('is-hidden');
  document.getElementById('groupGrid').style.display = '';
  const home = document.getElementById('homeView');
  home.classList.add('home-root');
  home.classList.remove('category-mode');
  setHomeHead(null);
  showView('home');
}
function enterCategoryGrid() {
  currentHomeGrid = 'categoryGrid';
  const home = document.getElementById('homeView');
  home.classList.remove('home-root');
  home.classList.add('category-mode');
  document.getElementById('groupGrid').style.display = 'none';
  document.getElementById('categoryGrid').classList.remove('is-hidden');
  setHomeHead(currentGroup);
  showView('home');
}
// ponytail: admin gating removed — all users can add/edit/delete songs
let adminCat = 'B&P';
let favorites = readJSON('labu_favs', [], Array.isArray).filter(id => typeof id === 'string');
let recents = readJSON('labu_recents', [], Array.isArray).filter(id => typeof id === 'string');
// ponytail: full open history with timestamps ({id, t}), newest first, one entry per
// song holding its LAST opened time. Seeded from the old recents list on first run.
let openHistory = readJSON('labu_open_history', null, Array.isArray);
if (!Array.isArray(openHistory)) openHistory = recents.map(id => ({ id, t: null }));
else openHistory = openHistory.filter(x => x && typeof x.id === 'string').map(x => ({ id: x.id, t: Number(x.t) || null }));
function saveOpenHistory() { localStorage.setItem('labu_open_history', JSON.stringify(openHistory)); }
let playlists = readJSON('labu_playlists', [], Array.isArray).filter(p => p && typeof p.id === 'string' && Array.isArray(p.songs));
let currentPlaylistId = null;
let listSortMode = 'num';
let _wakeLockObj = null, _wakeOn = localStorage.getItem('labu_wake') === '1';
let _hapticsOn = localStorage.getItem('labu_haptics') !== '0';
let _lastHapticAt = 0;
function haptic(ms = 8) {
  if (!_hapticsOn || typeof navigator.vibrate !== 'function') return;
  const now = performance.now();
  if (now - _lastHapticAt < 45) return;
  _lastHapticAt = now;
  try { navigator.vibrate(Math.max(1, Math.min(30, ms))); } catch (_) {}
}
function savePlaylists() { localStorage.setItem('labu_playlists', JSON.stringify(playlists)); }
function _genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

const SVG = {
  heart:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  heartFill:'<svg viewBox="0 0 24 24" fill="var(--warm)" stroke="var(--warm)" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  clock:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  list:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  gear:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  search:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  music:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  book:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  trash:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  edit:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  warn:     '<svg viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  close:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check:    '<svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  mic:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
  cross:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"/><line x1="6" y1="8" x2="18" y2="8"/></svg>',
  verse:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>',
  moon:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  phone:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
  pen:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  doc:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  home:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  play:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  folder:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  num:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
};

// ─── INIT ───
// ponytail: register the service worker at script top (not after init()'s async
// chain) — waiting for 'load' inside init() races the load event on fast/offline
// connections, which could silently skip registration and break offline support.
if ('serviceWorker' in navigator && !window.Capacitor) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

async function hideBootLoader() {
  const el = document.getElementById('bootLoader');
  document.body.classList.remove('boot-loading');

  // Android holds its native splash until this call. Remove the web cover while
  // it is still hidden, let the finished home paint, then let Android run its
  // own icon exit animation straight into the app — no white or blank frame.
  const nativeSplash = window.KhristianSplash;
  if (nativeSplash && typeof nativeSplash.ready === 'function') {
    // Remove the web cover, force a freshly composited home frame, then let the
    // native splash go. Android's splash owns the surface until this moment, so
    // leaving the cover underneath only delays the WebView by a few frames.
    if (el) el.remove();
    await afterPaint();
    try { nativeSplash.ready(); } catch (e) {}
    return;
  }

  if (!el) return;
  el.setAttribute('aria-hidden', 'true');
  // Let the already-painted home screen sit still for one frame before the
  // cover starts compositing away. This avoids a dropped first animation frame.
  requestAnimationFrame(() => el.classList.add('done'));
  setTimeout(() => el.remove(), 840);
}
function afterPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
async function init() {
  const bootStart = performance.now();
  syncSafeAreaBottom(); // native --safe-area-inset-bottom may land after first paint; re-sync on load
  window.addEventListener('load', syncSafeAreaBottom);
  const ld = document.getElementById('heroDesc');
  if (ld) ld.textContent = 'Loading songs…';
  await loadMeta();
  renderGroups();
  applyTheme();
  renderAccentSwatches();
  renderFontMenu();
  setReaderFamily(readerFamily); // apply the saved song-text font choice (Settings)
  applyReaderFontToReader(readerFont, false);
  updateReaderSizeUI();
  // ponytail: admin login removed — all users can manage songs
  renderSidebarGroups();
  const av = document.getElementById('appVersion'); if (av) av.textContent = APP_VERSION;
  runningVersion().then(v => { if (av && v !== APP_VERSION) av.textContent = v; });
  const chordLoad = loadChordCharts();
  songsDone = loadSongs().catch(e => console.error('[Khristian Labu]', e));
  if (_wakeOn) requestWakeLock();
  // seed the History API so the browser Back/Forward buttons traverse in-app views
  history.replaceState(buildState(), '');
  window.addEventListener('popstate', e => applyState(e.state));
  initHomeActions();
  // approved-change sync: pull the layer, retry queued submissions, poll on focus
  cloudStart();
  // ponytail: Android hardware Back has no default handler -> app closes. Mirror web behavior:
  // single press closes overlay/search or goes back one in-app view; double press at root exits.
  const Cap = window.Capacitor;
  if (Cap && Cap.Plugins && Cap.Plugins.App) {
    Cap.Plugins.App.addListener('backButton', onHardwareBack);
  }
  // Cover the half-rendered first paint until the full corpus is parsed, indexed,
  // and the home grid has been rendered from it.
  await songsDone;
  await chordLoad;
  // The native splash uses the same mark at the same size. Do not begin the
  // handoff until the web copy has decoded, or the logo can visibly pop in.
  const bootLogo = document.querySelector('.boot-logo');
  if (bootLogo && bootLogo.decode) { try { await bootLogo.decode(); } catch (e) {} }
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
  await afterPaint();
  // A short, intentional brand hold is better than rushing an almost-finished
  // screen into view. It also guarantees the cover cannot flash on a warm start.
  const minVisible = 620 - (performance.now() - bootStart);
  if (minVisible > 0) await new Promise(r => setTimeout(r, minVisible));
  await hideBootLoader();
  // Check after the boot cover is gone so the centered update dialog is never hidden behind it.
  checkForUpdate();
  const idlePrewarm = () => { try { prewarmViews(); } catch (e) { console.error('[Khristian Labu] prewarm failed:', e); } };
  if ('requestIdleCallback' in window) requestIdleCallback(idlePrewarm, { timeout: 3000 });
  else setTimeout(idlePrewarm, 900);
}

// ─── UPDATE CHECKER (version.json + latest.json → native resumable install) ───
// The highest published version wins; latest.json supplies the verified APK URL.
// Native builds download in-app. The browser fallback remains for old APKs.
function compareVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1; if (x < y) return -1;
  }
  return 0;
}
// ponytail: link the release ASSET, not the HTML release page — the browser then
// downloads the APK and Android prompts to install it in one step.
function apkDownloadUrl() { return (latestUpdate && latestUpdate.url) || 'https://github.com/' + REPO + '/releases/latest/download/khristian-labu.apk'; }
function isNativeApp() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
function isNativeUpdater() { return isNativeApp() && !!window.KhristianUpdate && typeof window.KhristianUpdate.start === 'function'; }
// ponytail: the installed package is authoritative. A stale bundled APP_VERSION once
// made 1.5.75 offer itself forever, so the checker asks Android for the real version.
async function runningVersion() {
  try {
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && typeof App.getInfo === 'function') {
      const info = await App.getInfo();
      const v = String((info && info.version) || '').replace(/^v/, '');
      if (/^\d+\.\d+/.test(v)) return v;
    }
  } catch (e) { /* fall through to the bundled constant */ }
  return APP_VERSION;
}
async function fetchLatestJsonMeta() {
  try {
    const res = await fetch(LATEST_JSON + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    const version = String(j.version || '').replace(/^v/, '');
    const url = String(j.url || '');
    const sha256 = String(j.sha256 || '').toLowerCase();
    if (!version || !/^https:\/\//.test(url) || !/^[0-9a-f]{64}$/.test(sha256)) return null;
    return { version, url, sha256, size: Number(j.size) || 0 };
  } catch (e) { return null; }
}
async function fetchLatestMeta(version) {
  const meta = await fetchLatestJsonMeta();
  if (!meta) return null;
  return !version || meta.version === version ? meta : null;
}
function openApkDownload() {
  const url = apkDownloadUrl();
  const launcher = isNativeApp() && window.Capacitor.Plugins && window.Capacitor.Plugins.AppLauncher;
  if (launcher) { launcher.openUrl({ url }).catch(() => window.open(url, '_system')); return; }
  window.open(url, isNativeApp() ? '_system' : '_blank');
}
function githubRepoUrl() { return 'https://github.com/' + REPO; }
// ponytail: install + source links live on the website home page only — inside the
// APK the app has no reason to download itself, and the repo link is for visitors.
function initHomeActions() {
  const wrap = document.getElementById('homeActions');
  if (!wrap) return;
  if (isNativeApp()) {
    wrap.remove();
    document.documentElement.classList.add('native-app');
    document.body.classList.add('native-app');
    return;
  }
  const apk = document.getElementById('homeApkBtn'); if (apk) apk.href = apkDownloadUrl();
  const repo = document.getElementById('homeRepoBtn'); if (repo) repo.href = githubRepoUrl();
  wrap.hidden = false; // markup ships hidden; the website is the only place that shows it
}
function setUpdateStatus(text) {
  const el = document.getElementById('updateStatus');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}
function updateFabVisual() {
  const fab = document.getElementById('updateFab');
  const label = document.getElementById('updateFabText');
  if (!fab || !label) return;
  const version = document.getElementById('updVer').textContent || '';
  let text = 'Update';
  if (updateState === 'preparing') text = 'Preparing…';
  else if (updateState === 'downloading') text = updatePercent >= 0 ? 'Downloading ' + updatePercent + '%' : 'Downloading…';
  else if (updateState === 'permission') text = 'Allow installs';
  else if (updateState === 'installing' || updateState === 'ready') text = 'Installing…';
  else if (updateState === 'error') text = 'Retry update';
  else if (version) text = 'Update ' + version;
  label.textContent = text;
  fab.classList.toggle('error', updateState === 'error');
  fab.setAttribute('aria-label', 'Show update: ' + text);
}
function openUpdatePopup() {
  const overlay = document.getElementById('updateOverlay');
  if (overlay) overlay.hidden = false;
  const fab = document.getElementById('updateFab');
  if (fab) fab.hidden = true;
  updateMinimized = false;
}
function minimizeUpdate() {
  if (updateState === 'idle') return;
  const overlay = document.getElementById('updateOverlay');
  if (overlay) overlay.hidden = true;
  updateMinimized = true;
  const fab = document.getElementById('updateFab');
  if (fab) fab.hidden = false;
  updateFabVisual();
}
function restoreUpdate() {
  const fab = document.getElementById('updateFab');
  if (fab) fab.hidden = true;
  const overlay = document.getElementById('updateOverlay');
  if (overlay) overlay.hidden = false;
  updateMinimized = false;
}
function setUpdButton(label, handler) {
  const btn = document.getElementById('updBtn');
  if (!btn) return;
  btn.textContent = label;
  btn.hidden = false;
  btn.href = apkDownloadUrl();
  btn.onclick = handler ? (e) => { e.preventDefault(); handler(); } : null;
}
function renderUpdateState() {
  const overlay = document.getElementById('updateOverlay');
  const progress = document.getElementById('updProgress');
  const fill = document.getElementById('updProgressFill');
  const note = document.getElementById('updProgressNote');
  const hint = document.getElementById('updHint');
  const btn = document.getElementById('updBtn');
  if (!overlay || !progress || !fill || !note || !hint || !btn) return;
  overlay.hidden = updateMinimized;
  const fab = document.getElementById('updateFab');
  if (fab) fab.hidden = !updateMinimized;
  if (updateState === 'available') {
    progress.hidden = true;
    fill.style.width = '0%';
    note.textContent = '';
    btn.hidden = false;
    btn.textContent = 'Update now';
    hint.textContent = 'Tap outside to minimize this prompt.';
  } else if (updateState === 'preparing' || updateState === 'downloading') {
    progress.hidden = false;
    const base = updateMessage || (updateState === 'preparing' ? 'Preparing update…' : 'Downloading update…');
    fill.style.width = updatePercent >= 0 ? Math.max(1, Math.min(99, updatePercent)) + '%' : '8%';
    note.textContent = updatePercent >= 0 && !/%/.test(base) ? base + ' ' + updatePercent + '%' : base;
    btn.hidden = true;
    hint.textContent = 'Tap outside to keep downloading in the background.';
  } else if (updateState === 'permission') {
    progress.hidden = true;
    note.textContent = '';
    btn.hidden = false;
    setUpdButton('Open settings', () => window.KhristianUpdate.openInstallSettings());
    hint.textContent = 'Allow installs from Khristian Labu, then return here.';
  } else if (updateState === 'installing' || updateState === 'ready') {
    progress.hidden = false;
    fill.style.width = '100%';
    note.textContent = updateMessage || 'Opening the Android installer…';
    btn.hidden = true;
    hint.textContent = 'Android will ask you to confirm the install.';
  } else if (updateState === 'installed') {
    progress.hidden = false;
    fill.style.width = '100%';
    note.textContent = updateMessage || 'Update installed.';
    btn.hidden = true;
    hint.textContent = '';
  } else if (updateState === 'error') {
    progress.hidden = false;
    fill.style.width = '0%';
    note.textContent = updateMessage || 'Update failed.';
    btn.hidden = false;
    setUpdButton('Retry', () => startInAppUpdate({ version: (latestUpdate && latestUpdate.version) || document.getElementById('updVer').textContent, meta: latestUpdate }));
    hint.textContent = 'Your partial download is kept, so Retry can resume it.';
  }
  updateFabVisual();
}
function setUpdateProgress(state, percent, message) {
  updateState = state || 'idle';
  updatePercent = Number.isFinite(percent) ? percent : -1;
  updateMessage = message || '';
  renderUpdateState();
}
async function startInAppUpdate(info) {
  if (!isNativeUpdater()) { openApkDownload(); return; }
  info = info || {};
  const version = String(info.version || document.getElementById('updVer').textContent || '');
  updateState = 'preparing';
  updatePercent = -1;
  updateMessage = '';
  openUpdatePopup();
  renderUpdateState();
  const meta = (info.meta && info.meta.version === version ? info.meta : null)
    || (latestUpdate && latestUpdate.version === version ? latestUpdate : null)
    || await fetchLatestMeta(version);
  if (!meta) {
    setUpdateProgress('error', -1, 'Update details are unavailable. Try again.');
    return;
  }
  latestUpdate = meta;
  try {
    window.KhristianUpdate.start(meta.url, meta.sha256, String(meta.size || ''), meta.version);
  } catch (e) {
    setUpdateProgress('error', -1, 'Could not start the update. Try again.');
  }
}
window.__labuUpdateProgress = function(state, percent, message) {
  setUpdateProgress(String(state || ''), Number(percent), String(message || ''));
};
function showUpdateBanner(latest, meta) {
  latestUpdate = meta && meta.version === latest ? meta : null;
  updateState = 'available';
  updatePercent = -1;
  updateMessage = '';
  updateMinimized = false;
  setUpdateStatus('');
  document.getElementById('updVer').textContent = latest;
  document.getElementById('updProgress').hidden = true;
  document.getElementById('updProgressFill').style.width = '0%';
  document.getElementById('updProgressNote').textContent = '';
  setUpdButton('Update now', () => startInAppUpdate({ version: latest, meta: latestUpdate }));
  openUpdatePopup();
  renderUpdateState();
  const lv = document.getElementById('latestVersion');
  if (lv) { document.getElementById('latestVersionVal').textContent = latest; lv.classList.remove('is-hidden'); }
}
// ponytail: version.json can lag the R2 metadata right after a publish, so use the
// highest version from both sources. latest.json also carries URL/size/SHA-256.
async function fetchUpdateInfo() {
  let best = null;
  const consider = (version, meta) => {
    version = String(version || '').replace(/^v/, '');
    if (!version) return;
    if (!best || compareVer(version, best.version) > 0) {
      best = { version, meta: meta && meta.version === version ? meta : null };
    }
  };
  const latest = await fetchLatestJsonMeta();
  if (latest) consider(latest.version, latest);
  const hosts = [
    'https://raw.githubusercontent.com/' + REPO + '/main/version.json',
    'https://labu.lengkhawm.online/version.json',
  ];
  for (const u of hosts) {
    try {
      const res = await fetch(u, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
      if (!res.ok) continue;
      const j = await res.json();
      consider(j.version, null);
    } catch (e) { /* try next host */ }
  }
  if (!best) {
    try {
      const res = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest',
        { headers: { 'Accept': 'application/vnd.github+json' } });
      if (res.ok) {
        const d = await res.json();
        consider(d.tag_name, null);
      }
    } catch (e) { /* no release fallback */ }
  }
  return best;
}
function setCheckUpdateBusy(busy) {
  const row = document.getElementById('checkUpdateRow');
  if (!row) return;
  const label = row.querySelector('.sr-label');
  const chev = row.querySelector('.sr-chev');
  if (!label) return;
  if (!row.dataset.idleLabel) row.dataset.idleLabel = label.textContent;
  row.disabled = busy;
  row.classList.toggle('is-checking', busy);
  if (busy) row.setAttribute('aria-busy', 'true'); else row.removeAttribute('aria-busy');
  label.textContent = busy ? 'Checking…' : row.dataset.idleLabel;
  if (chev) chev.classList.toggle('is-hidden', busy);
  let spinner = row.querySelector('.row-spinner');
  if (busy && !spinner) {
    spinner = document.createElement('span');
    spinner.className = 'btn-spinner row-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    row.append(spinner);
  } else if (!busy && spinner) {
    spinner.remove();
  }
}
async function manualCheckUpdate() {
  if (!isNativeUpdater()) return;
  setCheckUpdateBusy(true);
  setUpdateStatus('Checking for updates…');
  try {
    const info = await fetchUpdateInfo();
    if (!info) { setUpdateStatus('Could not check for updates. Try again.'); return; }
    const current = await runningVersion();
    if (compareVer(info.version, current) > 0) {
      showUpdateBanner(info.version, info.meta);
      startInAppUpdate(info);
    } else {
      setUpdateStatus('You are on the latest version (' + current + ').');
    }
  } finally {
    setCheckUpdateBusy(false);
  }
}
// ponytail: native-only startup check. The website always serves the newest build.
async function checkForUpdate() {
  if (!isNativeUpdater()) return;
  const info = await fetchUpdateInfo();
  if (!info) return;
  // Compare against Android's view of the installed package, never the bundled string.
  if (compareVer(info.version, await runningVersion()) <= 0) return;
  showUpdateBanner(info.version, info.meta);
  startInAppUpdate(info);
}

// ─── INDEXEDDB (replaces the localStorage full-corpus store, which has a ~5MB quota) ───
function _idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('labu', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      if (!db.objectStoreNames.contains('edits')) db.createObjectStore('edits', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
let _db;
function _idbh() { return _db ? Promise.resolve(_db) : _idbOpen().then(d => { _db = d; return d; }); }
function _store(name, mode) { return _idbh().then(d => d.transaction(name, mode).objectStore(name)); }
function idbGet(store, key) {
  return _store(store, 'readonly').then(s => new Promise((res, rej) => {
    const r = s.get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
function idbPut(store, val, key) {
  return _store(store, 'readwrite').then(s => new Promise((res, rej) => {
    // Key-path stores (edits) reject an explicit key; keyless stores (cache) need one.
    const r = s.keyPath ? s.put(val) : s.put(val, key);
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  }));
}
function corpusCacheKey() { return 'songs:' + DATA_VERSION + ':' + CORPUS_HASH; }
function idbGetAll(store) {
  return _store(store, 'readonly').then(s => new Promise((res, rej) => {
    const r = s.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  }));
}
// ponytail: localStorage's 5MB ceiling would break at this corpus size; IndexedDB has no practical cap.

function applyEdit(e) {
  // Never replay malformed or attacker-controlled edits from the cloud or a backup.
  if (!isSafeEdit(e)) return;
  // Structural edits (user-made songbooks/books) are stored with cat === null.
  if (e.cat === null) { applyStruct(e); return; }
  // ponytail: an edit invalidates every cached list snapshot (rows + nodes) so the
  // next visit re-renders fresh instead of showing stale cached DOM.
  _listCache = {}; _listNodes = {}; _renderedListKey = null;
  _catNodes = {}; _catGroup = null;
  const arr = SONGS[e.cat] && SONGS[e.cat].songs;
  if (!arr) return;
  if (e.op === 'delete') {
    const di = arr.findIndex(s => s.id === e.id);
    if (di >= 0) arr.splice(di, 1);
    return;
  }
  // A moved song must disappear from its old book when this edit is replayed over
  // a freshly fetched base corpus; otherwise it appears in both books.
  if (e.from && e.from !== e.cat) {
    const from = SONGS[e.from] && SONGS[e.from].songs;
    if (Array.isArray(from)) {
      const fi = from.findIndex(s => s.id === e.id);
      if (fi >= 0) from.splice(fi, 1);
    }
  }
  const i = arr.findIndex(s => s.id === e.id);
  if (i >= 0) {
    // The bundled corpus carries the title printed on the solfa sheet, which beats
    // any older title stored in a published edit (those were lyric incipits), so
    // the corpus title always wins while every other edited field is replayed.
    arr[i] = { ...e.song, title: arr[i].title || e.song.title };
  } else arr.push(e.song);
}
// Rebuild CAT_ORDER / BOOK_GROUP from the (possibly user-extended) groups.
function reindexBooks() {
  CAT_ORDER = GROUPS.flatMap(g => g.books);
  BOOK_GROUP = {};
  GROUPS.forEach(g => g.books.forEach(b => BOOK_GROUP[b] = g.id));
}
// Apply a structural edit (create/rename/delete songbooks and books).
function applyStruct(e) {
  const g = SONGS.groups || (SONGS.groups = []);
  if (e.op === 'addGroup') {
    const grp = e.song;
    if (!g.find(x => x.id === grp.id)) g.push({ id: grp.id, name: grp.name, desc: grp.desc || '', icon: grp.icon || '', books: grp.books.slice() });
    (grp.bookDefs || []).forEach(b => { if (!SONGS[b.code]) SONGS[b.code] = { info: { name: b.name, description: b.desc || '', icon: b.icon || '' }, songs: [] }; });
  } else if (e.op === 'addBook') {
    const b = e.song;
    if (!SONGS[b.code]) SONGS[b.code] = { info: { name: b.name, description: b.desc || '', icon: b.icon || '' }, songs: [] };
    const grp = (SONGS.groups || []).find(x => x.id === b.group);
    if (grp && !grp.books.includes(b.code)) grp.books.push(b.code);
  } else if (e.op === 'renameGroup') {
    const grp = (SONGS.groups || []).find(x => x.id === e.id);
    if (grp) { grp.name = e.song.name; grp.desc = e.song.desc || ''; grp.icon = e.song.icon || ''; }
  } else if (e.op === 'renameBook') {
    if (SONGS[e.id]) { SONGS[e.id].info.name = e.song.name; SONGS[e.id].info.description = e.song.desc || ''; SONGS[e.id].info.icon = e.song.icon || ''; }
  } else if (e.op === 'deleteBook') {
    const code = e.id;
    delete SONGS[code];
    (SONGS.groups || []).forEach(g => { const i = g.books.indexOf(code); if (i >= 0) g.books.splice(i, 1); });
    purgeEdits(code);
  } else if (e.op === 'deleteGroup') {
    const grp = (SONGS.groups || []).find(x => x.id === e.id);
    if (grp) { grp.books.slice().forEach(c => { delete SONGS[c]; purgeEdits(c); }); SONGS.groups = SONGS.groups.filter(x => x.id !== e.id); }
  }
}
// Drop song-level edits belonging to a deleted book (they'd be orphaned on replay).
function purgeEdits(cat) {
  _idbh().then(db => {
    const tx = db.transaction('edits', 'readwrite');
    const st = tx.objectStore('edits');
    st.openCursor().onsuccess = ev => { const cur = ev.target.result; if (cur) { if (cur.value.cat === cat) cur.delete(); cur.continue(); } };
  }).catch(() => {});
}
// Record a user edit separately so it survives an app update (the base corpus is replaced on version bump).
function recordEdit(cat, song, op, from) {
  const edit = { id: song.id, cat: cat, op: op, song: song };
  if (from && from !== cat) edit.from = from;
  submitChange('song', edit);
  return idbPut('edits', edit);
}
// Record a structural edit (songbook/book create/rename/delete) the same way.
function recordStruct(id, op, payload) {
  const edit = { id: id, cat: null, op: op, song: payload };
  submitChange('struct', edit);
  return idbPut('edits', edit);
}

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

// Pull the approved layer (cached in localStorage so an offline start still has it).
async function cloudLoadLayer(force) {
  if (!CLOUD_ON) return;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('labu_pub_cache') || 'null'); } catch (e) {}
  if (cached && Array.isArray(cached.edits)) { PUB = cached; PUB_CHORDS = {}; }
  let version;
  try {
    const st = await cloudReq('/api/state', { timeout: 5000 });
    version = st ? Number(st.version) || 0 : 0;
  } catch (e) { return; }
  if (!force && PUB.version === version) return;
  try {
    const since = force ? 0 : (PUB.edits || []).reduce((max, row) => Math.max(max, Number(row && row.seq) || 0), 0);
    const rows = await cloudReq('/api/published-edits' + (since > 0 ? '?since=' + since : ''));
    const incoming = (rows || []).filter(x => x && x.payload);
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
    try { localStorage.setItem('labu_pub_cache', JSON.stringify(PUB)); } catch (e) {}
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
  try { localStorage.setItem('labu_cloud_outbox', JSON.stringify(q.slice(-100))); } catch (e) {}
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
  try { localStorage.removeItem('labu_pub_cache'); } catch (e) {}
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
  try {
    let st;
    try { st = await cloudReq('/api/state'); }
    catch (e) { return false; }
    const version = st ? Number(st.version) || 0 : 0;
    if (!force && version === PUB.version) return false;
    await cloudLoadLayer(force);
    if (!songsReady) return false;
    ok = await cloudApplyLayerToCorpus();
    return ok;
  } finally {
    _cloudSyncing = false;
    if (btn) {
      if (ok) flashCloudButton(btn, 'Synced');
      else setCloudButtonBusy(btn, false);
    }
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

// ─── REVIEW / SYNC UI (Admin account) ───
function cloudAgo(value) {
  const t = typeof value === 'number' ? value : Date.parse(value || '');
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.round(h / 24) + ' d ago';
}
async function renderCloudPanel() {
  const box = document.getElementById('cloudPanel');
  if (!box) return;
  if (!CLOUD_ON) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  let s = cloudSession();
  if (!s && !(await cloudRestoreSession())) {
    box.innerHTML = '<div class="cloud-bar"><span class="cloud-state">Cloud review · admin sign-in required</span><button class="btn btn-ghost" data-action="openAdminAccount">Admin account</button></div>';
    return;
  }
  s = cloudSession();
  if (!(await cloudCheckAdmin())) {
    box.innerHTML = '<div class="cloud-bar"><span class="cloud-state">This signed-in account is not an admin.</span><button class="btn btn-ghost" data-action="openAdminAccount">Admin account</button></div>';
    return;
  }
  try {
    cloudPending = (await cloudReq('/api/admin/proposals')) || [];
  } catch (e) {
    box.innerHTML = '<div class="cloud-bar"><span class="cloud-state">Review queue unavailable — check your connection.</span><button class="btn btn-ghost" data-action="renderCloudPanel">Retry</button></div>';
    return;
  }
  const n = cloudPending.length;
  let html = '<div class="cloud-bar"><span class="cloud-state">Review queue' + (n ? '<span class="cloud-count">' + n + '</span>' : '') + '</span>'
    + '<button class="btn btn-primary" data-action="cloudCheckForUpdates">Sync now</button>'
    + '<button class="btn btn-ghost" data-action="openSyncHistory">History</button></div>';
  if (!n) {
    html += '<div class="cloud-empty">Nothing waiting. Approved changes are already live on every device.</div>';
  } else {
    if (n > 1) {
      html += '<div class="cloud-list-head"><span>' + n + ' changes waiting for review</span>'
        + '<button class="cloud-link" type="button" data-action="cloudApproveAll">Approve all</button></div>';
    }
    html += '<div class="cloud-list">';
    cloudPending.forEach(p => {
      const summary = p.summary || cloudDescribe(p.kind, p.payload);
      html += '<div class="cloud-item"><div class="cloud-item-main"><div class="cloud-summary">' + esc(summary) + '</div>'
        + '<div class="cloud-meta">' + esc(p.submitter_name || 'anonymous') + ' · ' + cloudAgo(p.created_at) + '</div></div>'
        + '<button class="btn btn-primary" data-action="cloudApprove" data-proposal-id="' + p.id + '">Approve</button>'
        + '<button class="btn btn-ghost" data-action="cloudReject" data-proposal-id="' + p.id + '">Reject</button></div>';
    });
    html += '</div>';
  }
  box.innerHTML = html;
}
function cloudErrorText(error) {
  const raw = error && error.message ? error.message : 'Request failed';
  const brace = raw.indexOf('{');
  if (brace !== -1) {
    try {
      const data = JSON.parse(raw.slice(brace));
      if (data && (data.message || data.error)) return data.message || data.error;
    } catch (e) {}
  }
  return raw.replace(/^cloud \d+\s*/, '') || 'Request failed';
}
async function cloudSignInWith(login, pass, err, btn, passInput, onSuccess) {
  if (err) err.textContent = '';
  if (!login || !pass) {
    if (err) err.textContent = 'Email or username and password are required';
    return false;
  }
  // The request takes a moment; the spinner is the only thing proving the tap
  // registered, so it goes up before the network call.
  setCloudButtonBusy(btn, true, 'Signing in…');
  try {
    const d = await cloudReq('/api/login', {
      body: { login: login, password: pass },
    });
    if (!d || !d.user) throw new Error('Sign in failed');
    // The Worker sets an HttpOnly cookie. Keep only display data in memory.
    cloudSaveSession({ email: (d.user && (d.user.email || d.user.login)) || login, user: d.user || null });
    _cloudCookieChecked = true;
    cloudAdmin = false;
    if (!(await cloudCheckAdmin())) {
      cloudSaveSession(null);
      throw new Error('This account is not an admin.');
    }
    if (passInput) passInput.value = '';
    await cloudLoadLayer(true);
    if (onSuccess) await onSuccess();
    return true;
  } catch (e) {
    if (err) err.textContent = cloudErrorText(e);
    return false;
  } finally { if (btn && btn.isConnected) setCloudButtonBusy(btn, false); }
}
async function cloudSignOut() {
  try {
    // Revoke the HttpOnly cookie even if the local panel was already cleared.
    await cloudReq('/api/auth/sign-out', { body: {} });
  } catch (e) {}
  cloudSaveSession(null);
  _cloudCookieChecked = true;
  cloudAdmin = false;
  cloudPending = [];
  if (currentView === 'adminAccount') await renderAdminAccount();
  else renderCloudPanel();
}
function setCloudButtonBusy(btn, busy, label) {
  if (!btn) return;
  const idle = btn.dataset.idleLabel || btn.textContent.trim();
  btn.dataset.idleLabel = idle;
  clearTimeout(btn._cloudFeedbackTimer);
  if (!busy) {
    btn.disabled = false;
    btn.classList.remove('is-busy', 'is-done');
    btn.removeAttribute('aria-busy');
    btn.textContent = idle;
    return;
  }
  btn.disabled = true;
  btn.classList.remove('is-done');
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  btn.replaceChildren();
  const spinner = document.createElement('span');
  spinner.className = 'btn-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = label || idle;
  btn.append(spinner, text);
}
function flashCloudButton(btn, label) {
  if (!btn) return;
  const idle = btn.dataset.idleLabel || btn.textContent.trim();
  btn.dataset.idleLabel = idle;
  clearTimeout(btn._cloudFeedbackTimer);
  btn.disabled = false;
  btn.classList.remove('is-busy');
  btn.classList.add('is-done');
  btn.removeAttribute('aria-busy');
  btn.replaceChildren();
  const check = document.createElement('span');
  check.className = 'btn-check';
  check.setAttribute('aria-hidden', 'true');
  check.textContent = '✓';
  const text = document.createElement('span');
  text.textContent = label;
  btn.append(check, text);
  btn._cloudFeedbackTimer = setTimeout(() => {
    if (!btn.isConnected) return;
    btn.classList.remove('is-done');
    btn.textContent = idle;
  }, 1200);
}
async function cloudAfterReview(msg) {
  await cloudLoadLayer(true);
  await cloudApplyLayerToCorpus();
  renderCloudPanel();
}
async function cloudApprove(id, btn) {
  setCloudButtonBusy(btn, true, 'Approving…');
  try { await cloudReq('/api/admin/approve', { body: { ids: [id] } }); }
  catch (e) { setCloudButtonBusy(btn, false); return; }
  cloudPending = cloudPending.filter(p => p.id !== id);
  await cloudAfterReview('Approved — syncing to all devices');
}
async function cloudApproveAll(btn) {
  const ids = cloudPending.map(p => p.id);
  if (!ids.length) return;
  setCloudButtonBusy(btn, true, 'Approving…');
  try { await cloudReq('/api/admin/approve', { body: { ids: ids } }); }
  catch (e) { setCloudButtonBusy(btn, false); return; }
  cloudPending = [];
  await cloudAfterReview('Approved ' + ids.length + ' — syncing to all devices');
}
async function cloudReject(id, btn) {
  setCloudButtonBusy(btn, true, 'Rejecting…');
  try { await cloudReq('/api/admin/reject', { body: { ids: [id] } }); }
  catch (e) { setCloudButtonBusy(btn, false); return; }
  cloudPending = cloudPending.filter(p => p.id !== id);
  renderCloudPanel();
}

// ponytail: fetch the gzipped corpus (small + fast on slow mobile links).
// Devices with a warm IndexedDB cache (DATA_VERSION-keyed) never fetch. A 404
// (corpus absent from the bundle) falls back to the CORS-open Pages copy; a 5xx
// is a real outage → surface the error + Retry, never silently re-download.
// Plain songs.json stays last (5MB) for WebViews without DecompressionStream.
async function fetchSongsJSON() {
  const qs = dataQuery();
  const PAGES = 'https://labu.lengkhawm.online/';
  if (typeof DecompressionStream !== 'undefined') {
    for (const u of ['songs.json.gzip' + qs, PAGES + 'songs.json.gzip' + qs]) {
      try {
        const res = await fetch(u);
        if (res.ok) {
          const ds = new DecompressionStream('gzip');
          const buf = await new Response(res.body.pipeThrough(ds)).text();
          return JSON.parse(buf);
        }
        if (res.status !== 404) break; // 5xx: real outage, don't rescue from Pages
      } catch (e) { /* next source */ }
    }
  }
  const res = await fetch('songs.json' + qs);
  if (res.ok) return await res.json();
  if (res.status === 404) {
    const pages = await fetch(PAGES + 'songs.json' + qs);
    if (pages.ok) return await pages.json();
  }
  throw new Error('HTTP ' + res.status + ' loading songs.json');
}

async function loadSongs() {
  try {
    // Fetch the approved overlay alongside the base corpus so the extra round trip
    // doesn't add to startup time.
    const layerReady = cloudLoadLayer().catch(() => {});
    const cacheKey = corpusCacheKey();
    let cache = null;
    try { cache = await idbGet('cache', cacheKey); } catch (e) {}
    if (cache && cache.version === DATA_VERSION && cache.hash === CORPUS_HASH && cache.data && Object.keys(cache.data).length) {
      SONGS = cache.data;
    } else {
      SONGS = await fetchSongsJSON();
      idbPut('cache', { version: DATA_VERSION, hash: CORPUS_HASH, data: SONGS }, cacheKey).catch(() => {});
      // ponytail: this fetch only happens when IndexedDB is empty (first visit per
      // DATA_VERSION), which races SW activation — so the SW never gets a chance to
      // runtime-cache the corpus. Warm it once the SW takes control (unconditional:
      // control may land mid-load) so future visits (fresh IDB, private mode) stay
      // instant + offline via the SW cache too.
      if (navigator.serviceWorker) {
        // Warm the SW corpus cache — but only from a page the worker actually
        // controls. `ready` means a worker is active, not that it has claimed
        // this page yet, and a fetch from an uncontrolled page never reaches the
        // worker, so a cold install used to leave the corpus out of the cache.
        const warmCorpusCache = () => fetch('songs.json.gzip' + dataQuery()).catch(() => {});
        navigator.serviceWorker.ready.then(() => {
          if (navigator.serviceWorker.controller) { warmCorpusCache(); return; }
          navigator.serviceWorker.addEventListener('controllerchange', warmCorpusCache, { once: true });
        }).catch(() => {});
      }
    }
    // Replay the approved layer, then this device's own edits, BEFORE deriving
    // indexes, so created songbooks/books exist when CAT_ORDER/BOOK_GROUP are built.
    // Never let a slow/absent cloud hold up the books: the cached layer is already
    // in memory, and a full check re-applies once the network answers.
    const layerNow = await Promise.race([
      layerReady.then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 2000)),
    ]);
    applyPublished();
    if (!layerNow) layerReady.then(() => { if (CLOUD_ON && songsReady) cloudCheckForUpdates(true); });
    try { (await idbGetAll('edits')).forEach(applyEdit); } catch (e) {}
    GROUPS = SONGS.groups || [];
    reindexBooks();
    buildSearchIndex();
    updateStats();
    if (currentView === 'settings') renderSongbookPrefs();
    songsReady = true;
    renderGroups();
    renderFavRecents();
  } catch (err) {
    showLoadError(err);
    throw err;
  }
}

// ponytail: paint home from a tiny groups.json so the full corpus parse doesn't block the grid.
async function loadMeta() {
  try {
    const res = await fetch('groups.json' + dataQuery());
    if (!res.ok) return;
    const m = await res.json();
    CORPUS_HASH = typeof m.dataHash === 'string' ? m.dataHash : '';
    GROUPS = (m.groups || []).slice();
    (m.groups || []).forEach(g => (g.books || []).forEach(b => { BOOK_META[b.code] = b.count || 0; BOOK_META_NAME[b.code] = b.name || b.code; }));
  } catch (e) { /* full load below surfaces errors */ }
}
function bookCount(code) { return (SONGS[code] && SONGS[code].songs) ? SONGS[code].songs.length : (BOOK_META[code] || 0); }
function bookName(code) { return (SONGS[code] && SONGS[code].info && SONGS[code].info.name) ? SONGS[code].info.name : (BOOK_META_NAME[code] || code); }
async function ensureSongs() { if (songsReady) return; if (songsDone) { try { await songsDone; } catch (e) {} } }

function showLoadError(err) {
  console.error('[Khristian Labu] failed to load songs:', err);
  const isFile = location.protocol === 'file:';
  const msg = isFile
    ? 'Cannot load songs.json from a file:// page. Serve the folder over http first — run:  python -m http.server  then open  http://localhost:8000'
    : ('Failed to load songs: ' + (err && err.message ? err.message : err));
  const d = document.getElementById('heroDesc');
  if (d) d.textContent = msg;
  const s = document.getElementById('statSongs');
  if (s) s.textContent = '!';
  const b = document.getElementById('retryDataBtn');
  if (b) b.classList.remove('is-hidden'); // offer a one-tap retry instead of a manual reload
  const hv = document.getElementById('homeView');
  if (hv) hv.classList.add('home-error');
}
// ponytail: retry the corpus load in place — loadSongs() reassigns SONGS and only
// marks songsReady after the whole chain succeeds, so re-running it is safe even
// if the first attempt failed partway through.
async function retryLoad() {
  const b = document.getElementById('retryDataBtn'); if (b) b.classList.add('is-hidden');
  const d = document.getElementById('heroDesc'); if (d) d.textContent = 'Loading songs…';
  const s = document.getElementById('statSongs'); if (s) s.textContent = '…';
  songsReady = false;
  songsDone = loadSongs().catch(e => console.error('[Khristian Labu] retry failed:', e));
  await songsDone;
  if (songsReady) { try { await prewarmViews(); } catch (e) { console.error('[Khristian Labu] prewarm failed:', e); } }
}

function saveSongs() {
  return idbPut('cache', { version: DATA_VERSION, hash: CORPUS_HASH, data: SONGS }, corpusCacheKey());
}

function updateStats() {
  const hv = document.getElementById('homeView');
  if (hv) hv.classList.remove('home-error');
  // Count only the collections the reader kept on. The admin export still means
  // every song, so it keeps the full-corpus count.
  const groups = enabledGroups();
  let total = 0;
  groups.forEach(g => (g.books || []).forEach(k => total += (SONGS[k]?.songs?.length || 0)));
  const s = total.toLocaleString();
  document.getElementById('statSongs').textContent = s;
  // ponytail: GROUPS are collections (6); the "Songbooks" stat counts the actual
  // books inside them (17) so the hero isn't misleading.
  const books = groups.reduce((n, g) => n + ((g.books && g.books.length) || 0), 0);
  document.getElementById('statBooks').textContent = books;
  document.getElementById('heroDesc').textContent = s + ' hymns and songs of faith';
  setHomeHead(currentHomeGrid === 'categoryGrid' ? currentGroup : null);
  const hbm = document.getElementById('homeBrandMeta');
  if (hbm) hbm.textContent = books + ' songbooks \u00b7 ' + s + ' hymns';
  const opt = document.getElementById('exportAllOption');
  if (opt) {
    const allTotal = CAT_ORDER.reduce((n, k) => n + (SONGS[k]?.songs?.length || 0), 0);
    opt.textContent = 'All Songs (' + allTotal.toLocaleString() + ')';
  }
}

// ─── SEARCH ───
function toggleSearch() {
  openSearchModal();
}
function clearSearchInput() {
  const input = document.getElementById('searchModalInput');
  if (!input) return;
  input.value = '';
  const clear = document.getElementById('searchModalClear');
  if (clear) clear.classList.remove('show');
  onSearch('');
  input.focus();
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('confirmModal')?.classList.contains('open')) return;
  if (document.getElementById('chordModal')?.classList.contains('open')) { requestCloseChordEditor(); return; }
  const bookMenu = document.getElementById('searchBookMenu');
  const sortMenu = document.getElementById('searchSortMenu');
  if ((bookMenu && !bookMenu.hidden) || (sortMenu && !sortMenu.hidden)) { closeSearchMenus(); return; }
  if (document.getElementById('searchModal')?.classList.contains('open')) { closeSearchModal(); return; }
});

// ─── NAVIGATION ───
let currentView = 'home', currentCat = null, currentList = [], currentSongIdx = -1;
let currentGroup = null, currentListKind = 'home', _restoring = false;
// ponytail: remember per-list scroll so back-navigation lands where the user was.
let _scrollPos = {};
// ponytail: remember per-song reader scroll so swiping back to a hymn keeps your place.
let _songScroll = {};
// ponytail: cache rendered list DOM so back-nav shows it instantly (no rebuild/re-fade).
let _listCache = {};
// ponytail: the Settings font size is permanent, and a pinch on the lyrics updates
// it (see attachReaderPinch), so the size you zoom to is the size every song keeps.
// readerZoomFont is the live value while a pinch is in flight.
// parseFloat, not parseInt: the size slider stores tenths (17.4), and truncating
// on load would make the reader jump back to a whole pixel.
let readerFont = clampReaderFont(parseFloat(localStorage.getItem('labu-reader-font') || '17'));
let readerZoomFont = readerFont;
let readerLH = 1.2; // always the minimum line height
let _readerZoomSongId = null;
// ponytail: the reader font family is a Settings choice (Default/Inter, Outfit,
// Serif) applied to the lyric text via --reader-family. Persisted in localStorage
// and included in backups, so it survives reinstall/restore.
let readerFamily = localStorage.getItem('labu-reader-family') || 'default';
// ponytail: songs with a tonic-solfa sheet get a Lyrics/Solfa switch in the reader footer.
let readerMode = 'lyrics';
let _viewPillFrom = null; // view-pill index before a mode switch, so the band can slide
let _tunePillFrom = null; // same idea for a tune switch rebuilt by a chords re-render
// ponytail: chord charts are stored separately from the corpus while the feature is
// being proven on one song. Chords are anchored by a fraction of the lyric line, so
// the same pattern follows the tune across verses even when the words wrap differently.
const CHORD_CHARTS = {
  BL_1: {
    key: 'G',
    verses: 6,
    chords: ['G', 'D', 'Em', 'C'],
    lines: [
      [{ at: 0, ch: 'G' }, { at: 0.5, ch: 'D' }, { at: 0.75, ch: 'G' }],
      [{ at: 0, ch: 'G' }, { at: 0.75, ch: 'D' }],
      [{ at: 0, ch: 'Em' }, { at: 0.25, ch: 'D' }, { at: 0.5, ch: 'G' }],
      [{ at: 0, ch: 'G' }, { at: 0.25, ch: 'C' }, { at: 0.5, ch: 'G' }]
    ]
  }
};
// Local chord charts are per-device, like the user's song edits. They survive
// corpus updates because they are keyed by song id, not stored in songs.json.
const USER_CHORD_IDS = new Set();
// The shipped chords.json charts, kept separately from CHORD_CHARTS because a
// local chart replaces the shipped one in CHORD_CHARTS. A stale local chart
// borrows missing verses from here instead of hiding them.
const BUNDLED_CHORD_CHARTS = {};
(function loadUserChordCharts() {
  try {
    const saved = JSON.parse(localStorage.getItem('labu_chord_charts_v1') || '{}');
    Object.keys(saved).forEach(id => {
      const c = saved[id];
      if (c && Array.isArray(c.lines)) { CHORD_CHARTS[id] = c; USER_CHORD_IDS.add(id); }
    });
  } catch (e) {}
})();
function saveUserChordCharts() {
  try {
    const saved = {};
    USER_CHORD_IDS.forEach(id => { if (CHORD_CHARTS[id]) saved[id] = CHORD_CHARTS[id]; });
    localStorage.setItem('labu_chord_charts_v1', JSON.stringify(saved));
    return true;
  } catch (e) { return false; }
}
// A chart edited on this device wins; otherwise an approved cloud chart must
// override the bundled chords.json copy. CHORD_CHARTS contains both local and
// bundled charts, so checking only USER_CHORD_IDS before falling back to PUB is
// what keeps an approved edit from being shadowed by the shipped chart.
// Tune 2 charts live under "<song id>__t2" so both tunes keep independent edits.
function chordChartFor(song, tuneIdx) {
  if (!song) return null;
  const key = chordChartKey(song, tuneIdx == null ? chordTuneIndex(song) : tuneIdx);
  const bundled = BUNDLED_CHORD_CHARTS[key] || null;
  const local = USER_CHORD_IDS.has(key) ? CHORD_CHARTS[key] : null;
  if (local) {
    // A chart saved in this editor records every verse, so an empty verse there
    // is a real choice and is left alone. Charts saved before that marker
    // existed may only cover verse 1, so fill their missing verses from the
    // published chart first, then the shipped one. This keeps a stale device
    // copy from hiding verses 2+ the way a partial published chart used to.
    if (local.allVerses) return local;
    const filled = PUB_CHORDS[key] ? mergeChartVerseLines(local, PUB_CHORDS[key]) : local;
    return bundled ? mergeChartVerseLines(filled, bundled) : filled;
  }
  const shipped = CHORD_CHARTS[key];
  if (PUB_CHORDS[key]) return mergeChartVerseLines(PUB_CHORDS[key], shipped);
  return shipped || null;
}
function chartVerseChordCount(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((n, specs) => {
    if (Array.isArray(specs)) return n + specs.filter(s => s && s.ch).length;
    return n + (specs && specs.ch ? 1 : 0);
  }, 0);
}
// A borrowed verse can come from a chart written in another key, so its chord
// names are shifted into the key of the chart that keeps it.
function transposeChartSpecs(lines, semis, preferFlat) {
  if (!semis) return lines;
  return (lines || []).map(line => {
    if (Array.isArray(line)) return line.map(spec => (spec && spec.ch)
      ? Object.assign({}, spec, { ch: transposeChordName(spec.ch, semis, preferFlat) }) : spec);
    if (line && line.ch) return Object.assign({}, line, { ch: transposeChordName(line.ch, semis, preferFlat) });
    return line;
  });
}
// A published chart can come from a device that only had verse 1 charted (the
// legacy seed), which would erase verses 2+ for everyone once it is approved.
// Keep the published verse where it has chords and borrow the bundled verse
// lines for the verses it left empty.
function mergeChartVerseLines(primary, fallback) {
  const published = Array.isArray(primary.verseLines) ? primary.verseLines : [];
  const bundled = fallback && Array.isArray(fallback.verseLines) ? fallback.verseLines : [];
  const total = Math.max(published.length, bundled.length);
  if (!total) return primary;
  const toPc = chordRootPc(normalizeSongKey(primary.key));
  const fromPc = chordRootPc(normalizeSongKey(fallback && fallback.key));
  const semis = (toPc != null && fromPc != null) ? ((toPc - fromPc) % 12 + 12) % 12 : 0;
  const preferFlat = toPc != null && keyPrefersFlat(toPc);
  const verseLines = [];
  for (let vi = 0; vi < total; vi++) {
    const pub = published[vi];
    const base = bundled[vi];
    if (chartVerseChordCount(pub)) verseLines.push(pub);
    else if (chartVerseChordCount(base)) verseLines.push(transposeChartSpecs(base, semis, preferFlat));
    else verseLines.push(pub || []);
  }
  return Object.assign({}, primary, {
    verseLines: verseLines,
    verses: Math.max(Number(primary.verses) || 0, verseLines.length)
  });
}
async function loadChordCharts() {
  try {
    const res = await fetch('chords.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    // Bundled charts replace the small legacy seed, but a chart saved on this
    // device still wins. This keeps BL_1's full six-verse chart from being
    // blocked by the old first-verse-only seed.
    Object.keys(data).forEach(id => {
      if (!data[id]) return;
      BUNDLED_CHORD_CHARTS[id] = data[id];
      if (!USER_CHORD_IDS.has(id)) CHORD_CHARTS[id] = data[id];
    });
  } catch (e) { /* chord charts are optional offline data */ }
}
// Solfa sheets are local assets, never arbitrary URLs from a cloud/backup row.
const SOLFA_SRC = /^assets\/solfa\/[A-Za-z0-9._-]+\.(?:avif|png|jpe?g|webp)$/;
function safeSolfaSrc(src) {
  return typeof src === 'string' && SOLFA_SRC.test(src) ? src : '';
}
function hasSolfa(song) { return !!(song && safeSolfaSrc(song.solfa)); }
// ponytail: several printed songs reuse another song's solfa sheet ("kaih kikhat").
// Surface those links in the reader so the user knows the tune is shared.
function songsSharingSolfa(song) {
  const src = safeSolfaSrc(song && song.solfa);
  if (!src) return [];
  const out = [];
  Object.keys(SONGS).forEach(book => (SONGS[book].songs || []).forEach(s => {
    if (s.id !== song.id && safeSolfaSrc(s.solfa) === src) out.push(s);
  }));
  return out;
}
// ponytail: hymns with two printed tunes store the second sheet in `solfa2`;
// the reader shows a Tune 1 / Tune 2 switch instead of one long stacked image.
function solfaSheets(song) {
  const first = safeSolfaSrc(song && song.solfa);
  if (!first) return [];
  const out = [{ label: 'Tune 1', src: first }];
  const second = safeSolfaSrc(song.solfa2);
  if (second) out.push({ label: 'Tune 2', src: second });
  return out;
}
// One pick per song, shared by the Solfa and Chords views, so switching tunes
// carries across and each tune keeps its own sheet and chord chart.
const _tunePick = {};
function solfaTuneIndex(song) {
  const n = _tunePick[song.id] || 0;
  return n < solfaSheets(song).length ? n : 0;
}
function chordTuneIndex(song) { return song && safeSolfaSrc(song.solfa2) ? solfaTuneIndex(song) : 0; }
function chordChartKey(song, tuneIdx) { return song.id + (tuneIdx ? '__t2' : ''); }
function currentSolfaSheet(song) {
  return solfaSheets(song)[solfaTuneIndex(song)] || null;
}
// ─── HD solfa sheets (R2) ───
// The bundled AVIFs are 240 DPI so the app stays small. Every sheet also exists
// at 480 DPI in R2; the reader upgrades to it quietly and swaps only once the
// sharper image is decoded, so offline/slow loads simply keep the bundled sheet
// on screen — no blank frame, no layout shift, nothing to notice.
// v3: every sheet is now a full A4-proportioned page (whole printed page when a
// page holds one tune), and these objects are cached immutably for a year, so a
// new crop needs a new path to reach devices.
const SOLFA_HD_BASE = 'https://dl.labu.lengkhawm.online/solfa-hd/v5/';
const _solfaHd = { ready: Object.create(null), loading: Object.create(null), missing: Object.create(null) };

function solfaHdUrl(src) {
  const local = safeSolfaSrc(src);
  if (!local) return '';
  return SOLFA_HD_BASE + local.slice(local.lastIndexOf('/') + 1);
}
function solfaHdReady(src) { return !!_solfaHd.ready[src]; }
function solfaDisplaySrc(src) { return solfaHdReady(src) ? solfaHdUrl(src) : safeSolfaSrc(src); }
// Only spend data on HD where it is cheap: skip Save-Data and 2G, where the
// bundled 240 DPI sheet is already the better trade.
function solfaHdAllowed() {
  if (typeof navigator === 'undefined' || navigator.onLine === false) return false;
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return true;
  return !c.saveData && c.effectiveType !== 'slow-2g' && c.effectiveType !== '2g';
}
function loadSolfaHd(src) {
  if (!solfaHdAllowed() || _solfaHd.missing[src] || !solfaHdUrl(src)) return Promise.resolve(null);
  if (_solfaHd.loading[src]) return _solfaHd.loading[src];
  const p = new Promise(resolve => {
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => {
      const settle = ok => { delete _solfaHd.loading[src]; if (ok) _solfaHd.ready[src] = true; resolve(ok ? probe : null); };
      // decode() resolves when the bitmap is ready to paint, so the swap is instant.
      if (probe.decode) probe.decode().then(() => settle(true), () => settle(false));
      else settle(true);
    };
    // A network blip is not a missing sheet: drop the in-flight marker so the next
    // open can retry. Only a real 404 is remembered (see fetchSolfaHdBlob).
    probe.onerror = () => { delete _solfaHd.loading[src]; resolve(null); };
    probe.src = solfaHdUrl(src);
  });
  _solfaHd.loading[src] = p;
  return p;
}
// Swap only while this sheet is still the one on screen, and pin the old aspect
// ratio first so a 1px difference in the sharper crop cannot reflow the reader.
function applySolfaHd(src) {
  const url = solfaHdUrl(src);
  if (!url) return;
  const zoom = document.querySelector('#solfaZoom .solfa-zoom-stage img');
  [document.getElementById('solfaSheetImg'), zoom].forEach(img => {
    if (!img || img.dataset.sheetSrc !== src || img.getAttribute('src') === url) return;
    if (img.complete && img.naturalWidth > 0) {
      // The 480 DPI crop is not a guaranteed exact 2x of the bundled one, so pin
      // the ratio already on screen: a sharper sheet must never reflow the page.
      if (img === zoom) {
        img.setAttribute('width', img.naturalWidth);
        img.setAttribute('height', img.naturalHeight);
      } else {
        img.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
      }
    }
    img.src = url;
  });
}
function upgradeSolfaSheet(src) {
  if (!src) return;
  if (solfaHdReady(src)) { applySolfaHd(src); return; }
  loadSolfaHd(src).then(img => { if (img) applySolfaHd(src); });
}
// Fetch the sheet the reader shows (or is about to show) once the UI settles.
function warmSolfaHd(song) {
  if (!song || !hasSolfa(song)) return;
  const sheet = currentSolfaSheet(song);
  if (!sheet) return;
  const src = sheet.src;
  const run = () => upgradeSolfaSheet(src);
  if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 2500 });
  else setTimeout(run, 400);
}
// Place the band under the active label; measured in px so labels of different
// lengths stay aligned. Re-rendered switches start at the previous tune and slide.
function syncTuneSwitch(root, animate) {
  if (!root) return;
  const buttons = root.querySelectorAll('button');
  if (!buttons.length) return;
  const tuneIdx = root.style.getPropertyValue('--tune-idx') || root.dataset.tuneIdx;
  const idx = Math.max(0, Math.min(Number(tuneIdx) || 0, buttons.length - 1));
  const pill = root.querySelector('.tune-pill');
  const b = buttons[idx];
  if (!pill || !b) return;
  const rr = root.getBoundingClientRect(), br = b.getBoundingClientRect();
  if (!animate) pill.style.transition = 'none';
  pill.style.width = br.width + 'px';
  pill.style.transform = 'translateX(' + Math.max(0, br.left - rr.left - root.clientLeft) + 'px)';
  if (!animate) { void pill.offsetWidth; pill.style.transition = ''; }
}
function tuneTabsForSong(song, idx, fn) {
  const sheets = solfaSheets(song);
  if (sheets.length < 2) return '';
  const from = _tunePillFrom == null ? idx : _tunePillFrom;
  return '<div class="solfa-tunes" role="tablist" aria-label="Tune" data-tune-idx="' + from + '">'
    + '<span class="tune-pill" aria-hidden="true"></span>'
    + sheets.map((t, i) => '<button type="button" role="tab" class="solfa-tune' + (i === idx ? ' active' : '') + '" aria-selected="' + (i === idx) + '" data-action="' + fn + '" data-tune-index="' + i + '">' + esc(t.label) + '</button>').join('') + '</div>';
}
function setSolfaTune(i) {
  const song = currentList[currentSongIdx];
  if (!song) return;
  const sheets = solfaSheets(song);
  if (!sheets[i]) return;
  haptic(8);
  _tunePick[song.id] = i;
  chordTranspose = 0;
  closeChordPop();
  const img = document.getElementById('solfaSheetImg');
  if (img) { img.dataset.sheetSrc = sheets[i].src; img.src = solfaDisplaySrc(sheets[i].src); }
  upgradeSolfaSheet(sheets[i].src);
  document.querySelectorAll('.solfa-tunes button').forEach((b, j) => {
    b.classList.toggle('active', j === i);
    b.setAttribute('aria-selected', j === i ? 'true' : 'false');
  });
  const root = document.querySelector('.solfa-tunes');
  if (root) {
    root.style.setProperty('--tune-idx', String(i));
    requestAnimationFrame(() => syncTuneSwitch(root, true));
  }
  pulseReaderContent();
}
function setChordTune(i) {
  const song = currentList[currentSongIdx];
  if (!song || !safeSolfaSrc(song.solfa2) || !solfaSheets(song)[i]) return;
  haptic(8);
  const sw = document.querySelector('.solfa-tunes');
  _tunePillFrom = sw ? (Number(sw.style.getPropertyValue('--tune-idx')) || Number(sw.dataset.tuneIdx) || 0) : null;
  _tunePick[song.id] = i;
  chordTranspose = 0;
  closeChordPop();
  _songScroll[song.id] = 0;
  renderSongDetail(song, undefined, true);
}
let chordTranspose = 0;
const CHORD_ROOT_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHORD_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHORD_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
function chordRootPc(name) {
  const m = String(name || '').trim().match(/^([A-G])([#b]?)/);
  if (!m) return null;
  return (CHORD_ROOT_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}
function normalizeSongKey(name) {
  return String(name || '').replace(/^key\s*/i, '').replace(/^doh\s+is\s*/i, '').trim();
}
function keyPrefersFlat(pc) {
  return [1, 3, 5, 6, 8, 10].includes(pc);
}
function transposeNoteName(letter, accidental, semis, preferFlat) {
  const pc = (CHORD_ROOT_PC[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + semis + 144) % 12;
  return (preferFlat ? CHORD_FLAT : CHORD_SHARP)[pc];
}
function transposeChordName(name, semis, preferFlat) {
  const m = String(name || '').trim().match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return name;
  let out = transposeNoteName(m[1], m[2], semis, preferFlat) + m[3];
  out = out.replace(/\/\s*([A-G])([#b]?)/g, (all, letter, accidental) => '/' + transposeNoteName(letter, accidental, semis, preferFlat));
  return out;
}
function chartTransposePrefersFlat(chart) {
  const base = chordRootPc(normalizeSongKey(chart.key));
  if (base == null) return false;
  return keyPrefersFlat((base + chordTranspose + 144) % 12);
}
function chartKeyLabel(chart) {
  const base = normalizeSongKey(chart.key) || 'C';
  if (!chordTranspose) return base;
  const pc = (chordRootPc(base) + chordTranspose + 144) % 12;
  return (keyPrefersFlat(pc) ? CHORD_FLAT : CHORD_SHARP)[pc];
}
function chordLabel(chart, name) {
  return chordTranspose === 0 ? name : transposeChordName(name, chordTranspose, chartTransposePrefersFlat(chart));
}
const READER_FAMILIES = {
  default: "inherit",
  outfit: "'Outfit','Noto Sans Myanmar',-apple-system,sans-serif",
  serif: "Georgia,'Noto Sans Myanmar',serif",
  literata: "'Literata','Noto Sans Myanmar',Georgia,serif",
  lora: "'Lora','Noto Sans Myanmar',Georgia,serif",
  merriweather: "'Merriweather','Noto Sans Myanmar',Georgia,serif",
  sourceserif: "'Source Serif 4','Noto Sans Myanmar',Georgia,serif",
  crimson: "'Crimson Pro','Noto Sans Myanmar',Georgia,serif",
  ebgaramond: "'EB Garamond','Noto Sans Myanmar',Georgia,serif",
  librebaskerville: "'Libre Baskerville','Noto Sans Myanmar',Georgia,serif",
  newsreader: "'Newsreader','Noto Sans Myanmar',Georgia,serif",
  spectral: "'Spectral','Noto Sans Myanmar',Georgia,serif",
  alegreya: "'Alegreya','Noto Sans Myanmar',Georgia,serif",
};
function setReaderFamily(v){
  if (!(v in READER_FAMILIES)) v = 'default';
  readerFamily = v;
  localStorage.setItem('labu-reader-family', v);
  document.documentElement.style.setProperty('--reader-family', READER_FAMILIES[v]);
  updateFontButtons(v);
}
const FONT_GROUPS = [
  { name:'Sans serif', keys:['default','outfit'] },
  { name:'Serif for lyrics', keys:['serif','literata','lora','merriweather','sourceserif','crimson','ebgaramond','librebaskerville','newsreader','spectral','alegreya'] },
];
const FONT_LABELS = {
  default:'Default · Inter', outfit:'Outfit', serif:'System Serif',
  literata:'Literata', lora:'Lora', merriweather:'Merriweather', sourceserif:'Source Serif 4',
  crimson:'Crimson Pro', ebgaramond:'EB Garamond', librebaskerville:'Libre Baskerville',
  newsreader:'Newsreader', spectral:'Spectral', alegreya:'Alegreya',
};
const FD_CHECK = '<svg class="fd-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
function renderFontMenu(){
  const menu = document.getElementById('fontSelectMenu');
  if (!menu) return;
  document.body.appendChild(menu);
  menu.innerHTML = FONT_GROUPS.map(g =>
    '<div class="font-dd-group">' + g.name + '</div>' +
    g.keys.map(k =>
      '<button type="button" class="font-dd-opt" role="option" aria-selected="false" data-value="' + k + '" data-font="' + k + '" data-action="chooseFont">' +
      '<span>' + FONT_LABELS[k] + '</span>' + FD_CHECK + '</button>'
    ).join('')
  ).join('');
  menu.querySelectorAll('.font-dd-opt').forEach(btn => {
    btn.style.fontFamily = READER_FAMILIES[btn.dataset.font] || '';
  });
  updateFontButtons(readerFamily);
}
function updateFontButtons(active){
  const key = (active in READER_FAMILIES) ? active : 'default';
  const label = document.getElementById('fontSelectLabel');
  if (label) label.textContent = FONT_LABELS[key];
  const menu = document.getElementById('fontSelectMenu');
  if (menu) menu.querySelectorAll('.font-dd-opt').forEach(btn => {
    const on = btn.dataset.value === key;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}
function closeFontMenu(){
  const dd = document.getElementById('fontDropdown');
  const btn = document.getElementById('fontSelectBtn');
  const menu = document.getElementById('fontSelectMenu');
  if (dd) dd.classList.remove('open');
  if (menu) menu.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
function positionFontMenu(){
  const btn = document.getElementById('fontSelectBtn');
  const menu = document.getElementById('fontSelectMenu');
  if (!btn || !menu) return;
  const rect = btn.getBoundingClientRect();
  const margin = 10;
  const width = Math.min(rect.width, window.innerWidth - margin * 2);
  const maxH = Math.min(318, window.innerHeight * 0.52);
  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  const openUp = spaceBelow < maxH && spaceAbove > spaceBelow;
  menu.style.width = width + 'px';
  menu.style.left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)) + 'px';
  if (openUp) {
    menu.style.top = 'auto';
    menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  } else {
    menu.style.top = (rect.bottom + 8) + 'px';
    menu.style.bottom = 'auto';
  }
}
function toggleFontMenu(){
  const dd = document.getElementById('fontDropdown');
  const btn = document.getElementById('fontSelectBtn');
  const menu = document.getElementById('fontSelectMenu');
  if (!dd || !btn || !menu) return;
  if (dd.classList.contains('open')) { closeFontMenu(); return; }
  positionFontMenu();
  dd.classList.add('open');
  menu.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  const current = menu.querySelector('.font-dd-opt.active');
  if (current) current.focus({ preventScroll: true });
}
window.addEventListener('scroll', () => {
  const dd = document.getElementById('fontDropdown');
  if (dd && dd.classList.contains('open')) positionFontMenu();
}, { passive: true });
window.addEventListener('resize', () => {
  const dd = document.getElementById('fontDropdown');
  if (dd && dd.classList.contains('open')) positionFontMenu();
});
function chooseFont(v){
  setReaderFamily(v);
  closeFontMenu();
}
document.addEventListener('click', e => {
  if (!e.target.closest('#fontDropdown') && !e.target.closest('#fontSelectMenu')) closeFontMenu();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const dd = document.getElementById('fontDropdown');
  if (dd && dd.classList.contains('open')) {
    closeFontMenu();
    const btn = document.getElementById('fontSelectBtn');
    if (btn) btn.focus({ preventScroll: true });
  }
});
function clampReaderFont(v) {
  const n = Number(v);
  // Tenths, so the slider moves continuously instead of snapping in 1px jumps.
  return Math.min(30, Math.max(14, Math.round((Number.isFinite(n) ? n : 17) * 10) / 10));
}
function applyReaderFontToReader(size, check) {
  readerZoomFont = clampReaderFont(size);
  const px = readerZoomFont + 'px';
  document.documentElement.style.setProperty('--reader-font', px);
  const d = document.getElementById('songDetail');
  if (d) d.style.setProperty('--reader-font', px);
  if (check !== false) scheduleReaderControlsCheck();
}
function updateReaderSizeUI() {
  const val = document.getElementById('readerSizeValue');
  if (val) {
    // 17 stays "17px"; a dragged value shows one decimal ("17.4px").
    const shown = Math.round(readerFont * 10) / 10;
    val.textContent = (Number.isInteger(shown) ? shown : shown.toFixed(1)) + 'px';
  }
  const range = document.getElementById('readerSizeRange');
  if (range) {
    if (range.value !== String(readerFont)) range.value = readerFont;
    range.style.setProperty('--p', (((readerFont - 14) / 16) * 100) + '%');
  }
  // The sample is set in the real reading size, so the slider previews itself.
  const preview = document.getElementById('readerSizePreview');
  if (preview) preview.style.fontSize = readerFont + 'px';
}
function setReaderFont(v) {
  readerFont = clampReaderFont(v);
  localStorage.setItem('labu-reader-font', String(readerFont));
  applyReaderFontToReader(readerFont);
  updateReaderSizeUI();
}

// ponytail: the reader bar (font-size + line-spacing sliders) is always visible on
// every song. But when the lyrics fit on one screen there is nothing to scroll, so
// the page scroll is LOCKED — increasing the font size or line spacing past the fold
// unlocks it again. Re-checked on resize/orientation change and whenever the font
// size or line height changes.
function scheduleReaderControlsCheck() {
  requestAnimationFrame(() => requestAnimationFrame(updateReaderControls));
}
function updateReaderControls() {
  const sc = document.getElementById('songScroll');
  if (!sc) return;
  // When the lyrics fit inside the scroll container there is nothing to scroll —
  // lock the CONTAINER (not the document) so gestures can't bounce it.
  const fits = sc.scrollHeight <= sc.clientHeight + 1;
  const lock = currentView === 'detail' && fits;
  sc.classList.toggle('scroll-locked', lock);
  if (lock && sc.scrollTop > 0) sc.scrollTop = 0; // show the full song from the top
}

// ponytail: bottom safe-area for the reader pill, FAB and WA menu. The native
// Capacitor WebView injects the REAL inset as `--safe-area-inset-bottom` (CSS px)
// regardless of WebView version — unlike env(safe-area-inset-bottom), which can be
// missing or wrong. Use it capped at 34px so a bogus large value can never float the
// pill half-way up the screen.
function syncSafeAreaBottom() {
  let px = 0;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom').trim();
    const n = parseInt(v, 10);
    if (n > 0) px = Math.min(n, 34);
  } catch (_) {}
  document.documentElement.style.setProperty('--sab', px + 'px');
  // ponytail: expose the reader footer's real height so the WhatsApp FAB/menu always
  // float ABOVE it (footer height varies: sliders + actions, safe-area, font scaling).
  syncFooterHeight();
}
function syncFooterHeight() {
  const host = document.getElementById('readerControlsHost');
  if (!host) return;
  const h = host.offsetHeight || 0;
  document.documentElement.style.setProperty('--footer-h', h + 'px');
}
// Orientation/size changes (rotation, fold, split-screen) can make a song fit or
// stop fitting — re-evaluate the scroll lock while the reader is open. Also re-sync
// the bottom safe-area (the native WebView sets --safe-area-inset-bottom after load).
// The header gains depth once the page scrolls under it (premium, cheap).
(function(){
  const navEl = document.querySelector('nav');
  if (!navEl) return;
  const onScroll = () => navEl.classList.toggle('scrolled', window.scrollY > 6);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
window.addEventListener('resize', () => { syncSafeAreaBottom(); syncFooterHeight(); if (currentView === 'detail') scheduleReaderControlsCheck(); });
window.addEventListener('orientationchange', () => { syncSafeAreaBottom(); syncFooterHeight(); if (currentView === 'detail') scheduleReaderControlsCheck(); });

// Entrance animations are one-shot. The class is dropped once it has played so a
// cached view (display:none -> block) never replays its fade and looks re-rendered.
document.addEventListener('animationend', e => {
  const t = e.target;
  if (e.animationName === 'fadeIn' && t && t.classList && t.classList.contains('fade-in')) t.classList.remove('fade-in');
});

// ponytail: how deep a view sits on the path (home → list → reader). The page
// transition rides this: going deeper enters from the right, coming back enters
// from the left, so movement reads as travel rather than as a fresh paint.
const _VIEW_DEPTH = { home: 0, list: 1, settings: 1, admin: 1, login: 1, adminAccount: 2, detail: 2 };
function showView(v) {
  if (v === 'list' && currentView !== 'list' && currentView !== 'detail') _listOriginView = currentView + 'View';
  const _fromDepth = _VIEW_DEPTH[currentView], _toDepth = _VIEW_DEPTH[v];
  document.documentElement.style.setProperty('--puan-dir',
    (_fromDepth == null || _toDepth == null || _toDepth >= _fromDepth) ? '1' : '-1');
  currentView = v;
  // ponytail: drives bottom-tab visibility (hidden in the reader) from CSS.
  document.body.dataset.view = v;
  ['homeView','listView','detailView','adminView','settingsView','adminAccountView'].forEach(id => {
    document.getElementById(id).classList.toggle('active', id === v + 'View');
  });
  document.getElementById('backBtn').classList.toggle('show', !['home','admin','settings'].includes(v));
  const hideSearch = v === 'admin' || v === 'login' || v === 'adminAccount';
  const searchBox = document.getElementById('searchBox');
  if (hideSearch) { searchBox.style.display = 'none'; } else { searchBox.removeAttribute('style'); }
  document.getElementById('searchToggle').style.display = hideSearch ? 'none' : '';
  // ponytail: reader controls belong only to the detail view. Toggle the footer host.
  document.getElementById('readerControlsHost').style.display = (v === 'detail' ? '' : 'none');
  // ponytail: never leave the scroll lock on outside the song reader.
  if (v !== 'detail') {
    document.documentElement.classList.remove('scroll-locked');
    const sc = document.getElementById('songScroll');
    if (sc) sc.classList.remove('scroll-locked');
    _readerZoomSongId = null;
    readerZoomFont = readerFont;
  }
  // ponytail: WhatsApp share FAB belongs to the detail view only.
  const wf = document.getElementById('waFabWrap');
  if (wf) { wf.classList.toggle('is-hidden', v !== 'detail'); if (v !== 'detail') closeWaMenu(); }
  // ponytail: adminBtn removed — accessible via sidebar Settings
  // ponytail: keep the tab title in sync with the current view.
  if (v !== 'detail') document.title = 'Khristian Labu - Gospel Songbook';
  syncTabBar();
  scheduleListFastScroll();
}

// ─── BOTTOM TAB BAR (phone navigation) ───
// Active tab mirrors where you are: home also covers songbook/category lists, and
// settings stays lit while its sheet is open.
function currentTab() {
  if (currentView === 'settings' || currentView === 'admin' || currentView === 'adminAccount') return 'settings';
  if (currentView === 'search') return 'search';
  if (currentView === 'list' && currentListKind === 'fav') return 'fav';
  if (currentView === 'list' && currentListKind === 'history') return 'history';
  if (currentView === 'list' && (currentListKind === 'playlists' || currentListKind === 'playlist')) return 'settings';
  return 'home';
}
function syncTabBar() {
  const tab = currentTab();
  let idx = 0;
  document.querySelectorAll('#tabBar .tab').forEach((btn, i) => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('active', on);
    if (on) { idx = i; btn.setAttribute('aria-current', 'page'); }
    else btn.removeAttribute('aria-current');
  });
  // the sliding glass pill is positioned by CSS from this index
  const bar = document.getElementById('tabBar');
  if (bar) bar.style.setProperty('--tab-idx', idx);
}
function tabGo(id) {
  haptic(8);
  if (id === 'home') {
    // Already at the root grid: just scroll up. Inside a group's category grid we
    // are still on the home view, but Home must take us back out one level.
    if (currentView === 'home' && currentHomeGrid === 'groupGrid') window.scrollTo({ top: 0, behavior: 'smooth' });
    else goHome();
  } else if (id === 'fav') {
    if (currentView === 'list' && currentListKind === 'fav') window.scrollTo({ top: 0, behavior: 'smooth' });
    else openFavs();
  } else if (id === 'search') {
    openSearchModal();
  } else if (id === 'history') {
    if (currentView === 'list' && currentListKind === 'history') window.scrollTo({ top: 0, behavior: 'smooth' });
    else openHistoryPage();
  } else if (id === 'settings') {
    if (currentView === 'settings') window.scrollTo({ top: 0, behavior: 'smooth' });
    else openSettings();
  }
  syncTabBar();
}
// ponytail: wire the SPA into the History API so the browser Back/Forward buttons
// traverse in-app views instead of closing the tab. List views are rebuilt on restore;
// only the detail view snapshots currentList (for prev/next + breadcrumb).
function buildState() {
  const song = (currentView === 'detail' && currentList[currentSongIdx]) ? currentList[currentSongIdx] : null;
  return {
    view: currentView,
    homeGrid: currentHomeGrid,
    group: currentGroup,
    cat: currentCat,
    listKind: currentListKind,
    songId: song ? song.id : null,
    pid: currentPlaylistId,
    list: song ? currentList.slice() : null
  };
}
function navPush() {
  if (_restoring) return;
  history.pushState(buildState(), '');
}
function applyState(s) {
  if (!s || !s.view) s = { view: 'home', homeGrid: 'groupGrid' };
  _restoring = true;
  saveReaderScroll();
  currentHomeGrid = s.homeGrid || 'groupGrid';
  currentCat = s.cat || null;
  currentGroup = s.group || null;
  currentListKind = s.listKind || 'home';
  currentPlaylistId = s.pid || null;
  switch (s.view) {
    case 'home':
      if (s.homeGrid === 'categoryGrid' && s.group) {
        if (_rv.grid === 'category' && _rv.group === s.group && document.getElementById('categoryGrid').children.length) enterCategoryGrid();
        else { showView('home'); openGroup(s.group); }
      } else {
        if (_rv.grid === 'group') showView('home');
        else if (document.getElementById('groupGrid').children.length) showHomeRoot();
        else { showView('home'); renderGroups(); }
      }
      break;
    case 'list': {
      const lkey = (s.listKind === 'cat') ? s.cat : (s.listKind === 'playlist' ? 'playlist:' + s.pid : s.listKind);
      // ponytail: re-show cached list DOM instead of rebuilding (instant, no re-fade).
      if (restoreList(lkey)) break;
      if (s.listKind === 'cat' && s.cat) openCategory(s.cat);
      else if (s.listKind === 'fav') openFavs();
      else if (s.listKind === 'recent') openRecents();
      else if (s.listKind === 'history') openHistoryPage(false);
      else if (s.listKind === 'playlists') openPlaylists();
      else if (s.listKind === 'playlist' && s.pid) openPlaylist(s.pid);
      else { showView('home'); renderGroups(); }
      break;
    }
    case 'detail': {
      const list = s.list || [];
      const song = list.find(x => x.id === s.songId);
      if (song) {
        currentList = list.slice();
        currentCat = s.cat;
        currentSongIdx = currentList.indexOf(song);
        showView('detail');
        window.scrollTo(0, 0);
        renderSongDetail(song);
      } else { showView('home'); renderGroups(); }
      break;
    }
    case 'admin': openAdmin(); break;
    case 'adminAccount': openAdminAccount(false); break;
    case 'settings': openSettings(); break;
    default: { showView('home'); renderGroups(); }
  }
  _restoring = false;
}

// ponytail: the mobile back button in the reader returns to wherever the song was
// opened from (list/search/history); falls back to home when there is no entry.
function navBack() {
  if (history.state && history.state.view === currentView) history.back();
  else goHome();
}
function goHome() {
  currentCat = null; currentGroup = null; currentListKind = 'home'; currentList = [];

  if (_rv.grid === 'group') showView('home');
  else if (document.getElementById('groupGrid').children.length) showHomeRoot();
  else { showView('home'); renderGroups(); }
  _rv = { grid: 'group', group: null, cat: null, listKind: 'home', pid: null };
  navPush();
}

// ─── FAVORITES & RECENTS ───
function toggleFav(songId) {
  const idx = favorites.indexOf(songId);
  if (idx === -1) favorites.push(songId); else favorites.splice(idx, 1);
  haptic(12);
  localStorage.setItem('labu_favs', JSON.stringify(favorites));
  delete _listCache['fav']; delete _listNodes['fav'];
  renderCategories();
  renderFavRecents();
}

function isFav(songId) { return favorites.indexOf(songId) !== -1; }

function getFavSongs() {
  const result = [];
  CAT_ORDER.forEach(key => {
    SONGS[key].songs.forEach(s => { if (isFav(s.id)) result.push({...s, cat: key, catName: SONGS[key].info.name}); });
  });
  return result;
}

async function openFavs() {
  await ensureSongs();
  const songs = getFavSongs();
  currentCat = null; currentList = songs; currentListKind = 'fav';
  _rv.listKind = 'fav'; _rv.cat = null; _rv.pid = null;
  if (restoreList('fav')) {  navPush(); return; }
  showView('list');
  document.getElementById('listHeader').innerHTML = '<h2>Favourites</h2><p>'+songs.length+' saved song'+(songs.length!==1?'s':'')+'</p>';
  renderSongList(songs);
  if (!songs.length) {
    document.getElementById('songGrid').innerHTML = '<div class="no-results"><div class="icon">'+SVG.heart+'</div><p>No favourites yet.<br>Tap the heart on any song to save it here.</p></div>';
  }
  _renderedListKey = 'fav';
  restoreScroll('fav');
  saveListCache('fav');

  _rv.listKind = 'fav'; _rv.cat = null; _rv.pid = null;
  navPush();
}

function renderFavRecents() {
  // ponytail: favourites and history are bottom tabs now — the home shortcuts (and
  // their mobile accordion) were redundant, so the row is never built. Any row left
  // over from an older session is removed.
  ['favRecentRow','frToggle'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
}

function addRecent(songId) {
  const idx = recents.indexOf(songId);
  if (idx !== -1) recents.splice(idx, 1);
  recents.unshift(songId);
  if (recents.length > 20) recents.length = 20;
  localStorage.setItem('labu_recents', JSON.stringify(recents));
}

function recordOpen(songId) {
  // history content changes with every opened song → drop its cached list
  delete _listCache['history']; delete _listNodes['history'];
  const i = openHistory.findIndex(x => x.id === songId);
  if (i !== -1) openHistory.splice(i, 1);
  openHistory.unshift({ id: songId, t: Date.now() });
  saveOpenHistory();
}

function clearRecents() {
  recents = [];
  localStorage.setItem('labu_recents', JSON.stringify(recents));
  if (currentHomeGrid === 'categoryGrid') renderCategories();
  else renderGroups();
  renderFavRecents();
}

// ─── CATEGORIES ───
let CAT_ORDER = ['B&P','BL','PN','SM'];
const CAT_SVG = {
  'B&P': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2c0 3.5-4 5.2-4 9a4 4 0 0 0 8 0c0-1.4-.6-2.6-1.4-3.5"/><path d="M12.6 9.5v4.2"/><circle cx="10.9" cy="14.5" r="1.5"/></svg>',
  'BL':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 17V5l10-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/><path d="M9 8l10-2"/></svg>',
  'PN':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/><path d="M12 7.4v6M9.4 10h5.2"/></svg>',
  'SM':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 21h16"/><path d="M6.5 21v-8h11v8"/><path d="M9 13V9h6v4"/><path d="M12 2c0 2-2 2.5-2 4.5a2 2 0 0 0 4 0C14 4.5 12 4 12 2z"/></svg>',
  'HB':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 8.5A6 6 0 0 0 6 8.5c0 6-2.8 7.5-2.8 7.5h17.6S18 14.5 18 8.5"/><path d="M9.8 20a2.6 2.6 0 0 0 4.4 0"/><path d="M12 2.5V1.5"/></svg>',
  'LD':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 2.5l1.7 4 4 1.7-4 1.7L11 14l-1.7-4.1-4-1.7 4-1.7z"/><path d="M18.5 13.5v5"/><circle cx="16.7" cy="18.5" r="1.5"/></svg>',
  'LC':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10.5a7 7 0 0 0 14 0"/><path d="M12 17.5V21M8.5 21h7"/></svg>',
  'ZG':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M12 6.2v7M8.8 9.4h6.4"/></svg>',
  'ZT':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 4.2A2.2 2.2 0 0 1 7.2 2H19v20H7.2A2.2 2.2 0 0 1 5 19.8z"/><path d="M8.8 2v20"/><path d="M13.7 7.5v7M10.2 11h7"/></svg>',
  'ZW':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 3v10M3.5 6.5h7"/><path d="M16 8v8l4-1V7"/><circle cx="14.5" cy="16" r="1.7"/></svg>',
  'ZP':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><ellipse cx="12" cy="8" rx="8" ry="3"/><path d="M4 8v6c0 1.7 3.6 3 8 3s8-1.3 8-3V8"/><path d="M8 2l4.5 4.5M16 2l-4.5 4.5"/></svg>',
  'LT':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.8 4.5c-2.6 0-5 1.2-6.6 3.2-.8 1-1.3 2.1-1.5 3.3-2.3.4-4.3 1.6-5.7 3.4-.7.9-1.2 1.9-1.5 2.9 2 .1 3.8-.4 5.3-1.4-.1 2.3 1.3 4.2 3.5 5 2.8.9 5.7-.7 6.5-3.6 1-3.4 0-7.2-2-9.9-.4-.5-.8-1-1.2-1.4z"/><path d="M20.8 4.5l2.2-1.1-1 2.3"/><path d="M6.2 3v5"/><circle cx="4.6" cy="8" r="1.4"/></svg>',
  'EH1': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9.5" cy="15" r="5"/><circle cx="9.5" cy="15" r="1.8"/><path d="M13 11.5L19 5.5"/><path d="M17 3.5l3.5 3.5"/><path d="M7 18.5h5"/></svg>',
  'EH2': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2.8" y="5" width="18.4" height="14" rx="2.6"/><path d="M8 5v8.2M12 5v8.2M16 5v8.2"/><path d="M5.3 13.2h1.4M9.3 13.2h1.4M13.3 13.2h1.4M17.3 13.2h1.4"/></svg>',
  'GK':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 4v13M7 9h10"/><path d="M4 2.5l1.8 1.8M20 2.5l-1.8 1.8M2 8l2.2-.6M22 8l-2.2-.6"/><path d="M8 21h8"/></svg>',
  'GL':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 8v13"/><circle cx="12" cy="5.5" r="2.2"/><path d="M8 9h8"/><path d="M5 14H2c0 4 4 7 10 7s10-3 10-7h-3"/></svg>',
  'MZ':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 20l6.2-9 3.8 4.8 3.4-4.4L22 20z"/><path d="M17 3.5v6"/><circle cx="15.3" cy="9.7" r="1.6"/></svg>'
};
const CAT_COLORS = {
  'B&P': { dark: '#FF7A1A', light: '#C25A00' },
  'BL': { dark: '#FF9A4D', light: '#B45309' },
  'PN': { dark: '#274B9F', light: '#1E3C8C' },
  'SM': { dark: '#A9B7CC', light: '#4A5A73' },
  'HB': { dark: '#FF8F3D', light: '#D95F00' },
  'LD': { dark: '#3B63C4', light: '#1D4ED8' },
  'LC': { dark: '#FFB27A', light: '#9A3412' },
  'ZG': { dark: '#7D9BD8', light: '#3B5FA8' },
  'ZT': { dark: '#FFA65C', light: '#B45309' },
  'ZW': { dark: '#3B63C4', light: '#1E3C8C' },
  'ZP': { dark: '#FF7A1A', light: '#C25A00' },
  'LT':  { dark: '#3157B8', light: '#1D4ED8' },
  'EH1': { dark: '#5F82CC', light: '#3B5FA8' },
  'EH2': { dark: '#FF9A4D', light: '#B45309' },
  'GK':  { dark: '#FF6A2A', light: '#C2410C' },
  'GL':  { dark: '#7D9BD8', light: '#1E3C8C' },
  'MZ':  { dark: '#3B63C4', light: '#3B5FA8' }
};
const GROUP_SVGS = {
  kl:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 6.2C10.1 4.6 7.3 4 4 4v13.6c3.3 0 6.1.6 8 2.2 1.9-1.6 4.7-2.2 8-2.2V4c-3.3 0-6.1.6-8 2.2z"/><path d="M12 6.2v13.6"/><path d="M7.7 8.2v4.2M5.9 10h3.6"/></svg>',
  kbc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 21h18"/><path d="M5 21V11l7-4.2 7 4.2v10"/><path d="M12 2.5v4M10.2 4.5h3.6"/><path d="M9.8 21v-5.2a2.2 2.2 0 0 1 4.4 0V21"/></svg>',
  zomi:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="7" width="3" height="13" rx="1.5"/><rect x="8" y="4" width="3" height="16" rx="1.5"/><rect x="12" y="6" width="3" height="14" rx="1.5"/><rect x="16" y="9" width="3" height="11" rx="1.5"/></svg>',
  la:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 6.2C10.1 4.6 7.3 4 4 4v13.6c3.3 0 6.1.6 8 2.2 1.9-1.6 4.7-2.2 8-2.2V4c-3.3 0-6.1.6-8 2.2z"/><path d="M12 6.2v13.6"/><path d="M8.5 8.7v5"/><circle cx="7" cy="14" r="1.4"/></svg>',
  geh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 18h18l-1.5-9-4.2 4L12 5 8.7 13l-4.2-4z"/><path d="M5 21h14"/></svg>',
  mz:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 20l6.2-9 3.8 4.8 3.4-4.4L22 20z"/><path d="M12 2.5v6M9.6 5h4.8"/></svg>'
};
const GROUP_COLORS = {
  kl:  { dark: '#FF7A1A', light: '#C25A00' },
  kbc: { dark: '#274B9F', light: '#1E3C8C' },
  zomi:{ dark: '#5F82CC', light: '#3B5FA8' },
  la:  { dark: '#FF9A4D', light: '#B45309' },
  geh: { dark: '#3B63C4', light: '#1D4ED8' },
  mz:  { dark: '#A9B7CC', light: '#4A5A73' }
};
let _groupsSig = null;
function _groupsSignature() {
  const theme = document.documentElement.getAttribute('data-theme') || '';
  return disabledGroups.join(',') + '|' + theme + '|' + GROUPS.map(g => g.id + ':' + (g.name||'') + ':' + g.books.map(b => b + '=' + bookCount(b)).join('+')).join('|');
}
function setHomeHead(groupId) {
  const title = document.getElementById('homeHeadTitle');
  const meta = document.getElementById('homeHeadMeta');
  const desc = document.getElementById('homeHeadDesc');
  const g = groupId ? GROUPS.find(x => x.id === groupId) : null;
  if (title) title.textContent = g ? g.name : 'Songbooks';
  if (desc) desc.textContent = g && g.desc ? g.desc.trim() : '';
  if (!meta) return;
  if (g) {
    const books = g.books.length;
    const songs = g.books.reduce((n, b) => n + bookCount(b), 0);
    meta.textContent = books + ' songbook' + (books === 1 ? '' : 's') + ' \u00b7 ' + songs.toLocaleString() + ' hymns';
  } else {
    const groups = enabledGroups();
    const books = groups.reduce((n, x) => n + ((x.books && x.books.length) || 0), 0);
    const songs = groups.reduce((n, x) => n + x.books.reduce((m, b) => m + bookCount(b), 0), 0);
    meta.textContent = books + ' songbooks \u00b7 ' + songs.toLocaleString() + ' hymns';
  }
}
function renderGroups() {
  currentHomeGrid = 'groupGrid';
  const grid = document.getElementById('groupGrid');
  document.getElementById('categoryGrid').classList.add('is-hidden');
  grid.style.display = '';
  const home = document.getElementById('homeView');
  home.classList.add('home-root');
  home.classList.remove('category-mode');
  setHomeHead(null);
  // ponytail: the cards are already in the DOM — only rebuild when the songbooks,
  // their counts or the theme changed. This is what stops the home grid from
  // re-rendering (and re-fading) on every back/forward or tab switch.
  const sig = _groupsSignature();
  if (grid.children.length && sig === _groupsSig) {
    _rv = { grid: 'group', group: null, cat: null, listKind: 'home', pid: null };
    return;
  }
  _groupsSig = sig;
  _catNodes = {}; _catGroup = null;
  const cg = document.getElementById('categoryGrid'); if (cg) cg.replaceChildren();
  grid.innerHTML = '';
  const groups = enabledGroups();
  if (!groups.length) {
    grid.innerHTML = '<div class="no-results"><div class="icon">'+SVG.book+'</div><p>All songbooks are turned off.<br><button class="group-back-btn" type="button" data-action="openSettings">Choose songbooks</button></p></div>';
    _rv = { grid: 'group', group: null, cat: null, listKind: 'home', pid: null };
    return;
  }
  groups.forEach((g, i) => {
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.onclick = () => openGroup(g.id);
    const total = g.books.reduce((n, b) => n + bookCount(b), 0);
    const icon = GROUP_SVGS[g.id] || SVG.book;
    card.innerHTML = '<div class="cat-icon"><div class="cat-icon-svg">'+icon+'</div></div><div class="cat-text"><div class="cat-name">'+esc(g.name)+'</div><div class="cat-desc">'+esc(g.desc||'')+'</div></div><div class="cat-count">'+total.toLocaleString()+' songs</div>';
    grid.appendChild(card);
  });
  _rv = { grid: 'group', group: null, cat: null, listKind: 'home', pid: null };
}

function openGroup(id) {
  const g = GROUPS.find(x => x.id === id);
  if (!g) return;
  // A disabled collection can still be reached from old history entries — send it home.
  if (isGroupDisabled(g.id)) { currentGroup = null; currentListKind = 'home'; _groupsSig = null; renderGroups(); showHomeRoot(); return; }
  if (g.books.length === 1) { currentGroup = g.id; openCategory(g.books[0]); return; }
  showView('home');
  currentHomeGrid = 'categoryGrid';
  currentGroup = g.id; currentListKind = 'group';
  const home = document.getElementById('homeView');
  home.classList.remove('home-root');
  home.classList.add('category-mode');
  document.getElementById('groupGrid').style.display = 'none';
  const grid = document.getElementById('categoryGrid');
  grid.classList.remove('is-hidden');
  setHomeHead(g.id);
  restoreCategoryGrid(g.id, g.books);
  _rv = { grid: 'category', group: g.id, cat: null, listKind: 'group', pid: null };
  navPush();
}

const SB_FALLBACK_COLORS = [
  {light:'#C25A00',dark:'#FF7A1A'},
  {light:'#1E3C8C',dark:'#274B9F'},
  {light:'#B45309',dark:'#FF9A4D'},
  {light:'#3B5FA8',dark:'#5F82CC'},
  {light:'#4A5A73',dark:'#A9B7CC'},
  {light:'#1D4ED8',dark:'#3B63C4'},
];
function hashStr(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}
function catColorOf(key,isLight){
  const c = CAT_COLORS[key];
  if(c) return c;
  return SB_FALLBACK_COLORS[hashStr(key)%SB_FALLBACK_COLORS.length];
}
const DEFAULT_CAT_SVG='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>';
function catSvgOf(key){return CAT_SVG[key]||DEFAULT_CAT_SVG;}

function categoryGridFragment(books) {
  const frag = document.createDocumentFragment();
  books.forEach(key => {
    const cat = SONGS[key] || null;
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.onclick = () => openCategory(key);
    card.innerHTML = '<div class="cat-icon"><div class="cat-icon-svg">'+catSvgOf(key)+'</div></div><div class="cat-text"><div class="cat-name">'+esc(bookName(key))+'</div><div class="cat-desc">'+esc(cat&&cat.info&&cat.info.description||'')+'</div></div><div class="cat-count"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> '+bookCount(key).toLocaleString()+' songs</div></div>';
    frag.appendChild(card);
  });
  return frag;
}
function stashCategoryGrid() {
  const grid = document.getElementById('categoryGrid');
  if (!_catGroup || !grid || !grid.children.length) return;
  const frag = document.createDocumentFragment();
  while (grid.firstChild) frag.appendChild(grid.firstChild);
  _catNodes[_catGroup] = frag;
  _catGroup = null;
}
function restoreCategoryGrid(groupId, books) {
  const grid = document.getElementById('categoryGrid');
  if (_catGroup === groupId && grid.children.length) return;
  stashCategoryGrid();
  const nodes = _catNodes[groupId];
  if (nodes && nodes.childNodes.length) grid.replaceChildren(nodes);
  else grid.replaceChildren(categoryGridFragment(books));
  _catGroup = groupId;
}
function prewarmCategoryGrids() {
  _catNodes = {};
  GROUPS.forEach(g => { _catNodes[g.id] = categoryGridFragment(g.books); });
}
let _catsSig = null;
function renderCategories(books) {
  if (!books) books = CAT_ORDER;
  const grid = document.getElementById('categoryGrid');
  const isLightNow = document.documentElement.getAttribute('data-theme') === 'light';
  const sig = (isLightNow ? 'l' : 'd') + '|' + books.map(k => k + ':' + bookName(k) + ':' + bookCount(k) + ':' + ((SONGS[k] && SONGS[k].info && SONGS[k].info.description) || '')).join('|');
  if (grid.children.length && sig === _catsSig) return;
  _catsSig = sig;
  _catNodes = {}; _catGroup = null;
  grid.innerHTML = '';
  books.forEach((key, i) => {
    const cat = SONGS[key] || null;
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.onclick = () => openCategory(key);
    card.innerHTML = '<div class="cat-icon"><div class="cat-icon-svg">'+catSvgOf(key)+'</div></div><div class="cat-text"><div class="cat-name">'+esc(bookName(key))+'</div><div class="cat-desc">'+esc(cat&&cat.info&&cat.info.description||'')+'</div></div><div class="cat-count"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> '+bookCount(key).toLocaleString()+' songs</div>';
    grid.appendChild(card);
  });
}

function listHeaderHTML(key) {
  const sortSvg = listSortMode === 'num'
    ? '<svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>'
    : '<svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>';
  return '<div class="list-head-row"><div class="list-head-title"><span class="list-head-icon">'+catSvgOf(key)+'</span><h2>'+esc(SONGS[key].info.name)+'</h2></div><button data-action="toggleSort" class="list-action-btn">'+sortSvg+' Sort: '+(listSortMode==='num'?'Number':'Name')+'</button></div><p class="list-head-desc">'+esc(SONGS[key].info.description||'')+' · '+SONGS[key].songs.length+' songs</p>';
}

async function openCategory(key, force) {
  await ensureSongs();
  currentCat = key; currentList = SONGS[key].songs; currentListKind = 'cat';
  _rv.cat = key; _rv.listKind = 'cat'; _rv.pid = null;
  // ponytail: already-rendered list → re-show the existing nodes (no rebuild, no
  // re-fade). Sorting is the only thing that forces a fresh render.
  if (!force && restoreList(key)) {  navPush(); return; }
  if (force) { delete _listCache[key]; delete _listNodes[key]; }
  showView('list');
  document.getElementById('listHeader').innerHTML = listHeaderHTML(key);
  renderSongList(currentList);
  _renderedListKey = key;
  restoreScroll(key);
  saveListCache(key);

  _rv.cat = key; _rv.listKind = 'cat'; _rv.pid = null;
  navPush();
}

function toggleSort() {
  listSortMode = listSortMode === 'num' ? 'name' : 'num';
  haptic(8);
  openCategory(currentCat, true);
}

function songListFragment(songs, bookName) {
  const frag = document.createDocumentFragment();
  const sorted = [...songs];
  if (listSortMode === 'name') sorted.sort((a, b) => (a.title || '').replace(/^[\s\d.)\-]+/, '').localeCompare((b.title || '').replace(/^[\s\d.)\-]+/, ''), undefined, {sensitivity:'base'}));
  sorted.forEach((song, i) => {
    const item = document.createElement('div');
    item.className = 'song-item';
    item.dataset.sid = song.id;
    item.onclick = () => openSong(song);
    const meta = [bookName, song.author, song.key ? 'Key: ' + song.key : ''].filter(Boolean).join(' · ');
    const numDisplay = song.number || (i+1);
    item.innerHTML = '<div class="song-num">'+esc(String(numDisplay))+'</div><div class="song-info"><div class="song-title">'+esc(song.title)+'</div><div class="song-meta">'+esc(meta)+'</div></div>';
    frag.appendChild(item);
  });
  return frag;
}
function renderSongList(songs) {
  const grid = document.getElementById('songGrid');
  _stashCurrentList(); // keep the outgoing list's rows so back-nav re-attaches them
  grid.innerHTML = '';
  if (!songs.length) { grid.innerHTML = '<div class="no-results"><div class="icon">'+SVG.search+'</div><p>No songs found</p></div>'; scheduleListFastScroll(); return; }
  const bookName = currentCat ? SONGS[currentCat].info.name : '';
  grid.replaceChildren(songListFragment(songs, bookName));
  scheduleListFastScroll();
}

// A long-list fast scroller: dragging the rail scrolls the document, while the
// bubble reads the song nearest the top of the viewport. Number sort -> song no.;
// Name sort -> title initial.
var _lfsSchedule = null;
function scheduleListFastScroll() { if (_lfsSchedule) _lfsSchedule(); }
(function attachListFastScroll() {
  const root = document.getElementById('listFastScroll');
  if (!root) return;
  const rail = root.querySelector('.lfs-rail');
  const thumb = root.querySelector('.lfs-thumb');
  const bubble = root.querySelector('.lfs-bubble');
  let active = false, dragging = false, hideTimer = 0, raf = 0, lastLabel = '';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const rows = () => [...document.querySelectorAll('#songGrid .song-item')];
  const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);
  function labelForRow(row) {
    if (!row) return '';
    if (listSortMode === 'name') {
      const title = (row.querySelector('.song-title')?.textContent || '').trim();
      const m = title.match(/[A-Za-z0-9]/);
      return m ? m[0].toUpperCase() : (title.charAt(0) || '?');
    }
    return (row.querySelector('.song-num')?.textContent || '').trim() || '?';
  }
  function rowAtY(centerY) {
    const list = rows();
    if (!list.length) return null;
    let best = null, bestDist = Infinity;
    for (const row of list) {
      const r = row.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const dist = Math.abs((r.top + r.bottom) / 2 - centerY);
      if (dist < bestDist) { best = row; bestDist = dist; }
    }
    return best || list[list.length - 1];
  }
  function layout() {
    const max = maxScroll();
    const list = rows();
    const show = currentView === 'list' && max > 240 && list.length >= 15;
    root.classList.toggle('on', show);
    if (!show) { active = false; dragging = false; root.classList.remove('active', 'dragging'); return; }
    const track = rail.getBoundingClientRect();
    const thumbH = thumb.offsetHeight || 52;
    const travel = Math.max(1, track.height - thumbH);
    const p = clamp(scrollY / max, 0, 1);
    const y = p * travel;
    thumb.style.transform = 'translateY(' + y + 'px)';
    if (!active) return;
    const bh = bubble.offsetHeight || 56;
    const rootRect = root.getBoundingClientRect();
    // Keep the bubble clear of the thumb instead of sitting level with it.
    const by = track.top - rootRect.top + y + thumbH / 2 - bh / 2 - 40;
    const bubbleTop = clamp(by, 4, root.offsetHeight - bh - 4);
    bubble.style.top = bubbleTop + 'px';
    const row = rowAtY(rootRect.top + bubbleTop + bh / 2);
    const label = labelForRow(row);
    bubble.textContent = label;
    if (dragging && label && label !== lastLabel) {
      lastLabel = label;
      haptic(5);
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
    }
  }
  function schedule() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { raf = 0; layout(); });
  }
  function scrollToPointer(clientY) {
    const max = maxScroll();
    if (!max) return;
    const track = rail.getBoundingClientRect();
    const thumbH = thumb.offsetHeight || 52;
    const p = clamp((clientY - track.top - thumbH / 2) / Math.max(1, track.height - thumbH), 0, 1);
    active = true;
    root.classList.add('active');
    window.scrollTo(0, p * max);
    layout();
  }
  root.addEventListener('pointerdown', e => {
    if (currentView !== 'list' || !root.classList.contains('on')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    lastLabel = '';
    root.classList.add('dragging');
    haptic(8);
    try { root.setPointerCapture(e.pointerId); } catch (_) {}
    scrollToPointer(e.clientY);
  });
  root.addEventListener('pointermove', e => {
    if (!dragging) return;
    e.preventDefault();
    scrollToPointer(e.clientY);
  });
  function end(e) {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('dragging');
    try { root.releasePointerCapture(e.pointerId); } catch (_) {}
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { active = false; root.classList.remove('active'); }, 650);
  }
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('scroll', () => { if (currentView === 'list') schedule(); }, { passive: true });
  window.addEventListener('resize', schedule);
  _lfsSchedule = schedule;
  schedule();
})();
// Build every songbook's rows while the startup cover is still up. Opening a
// songbook then just reattaches already-built live nodes — no first-view render.
async function prewarmSongLists() {
  const keys = Object.keys(SONGS).filter(k => SONGS[k] && Array.isArray(SONGS[k].songs) && SONGS[k].info);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i], book = SONGS[key];
    _listNodes[key] = songListFragment(book.songs, book.info.name);
    _listCache[key] = { header: listHeaderHTML(key), grid: '' };
    if (i % 3 === 2) await new Promise(r => requestAnimationFrame(r));
  }
  _LIST_NODE_CACHE_MAX = Math.max(_LIST_NODE_CACHE_MAX, keys.length + 4);
}
async function prewarmViews() {
  prewarmCategoryGrids();
  await prewarmSongLists();
}

// ponytail: delegate song-item clicks so cached/restored lists (whose innerHTML
// round-trip drops the onclick closure) stay clickable.
document.getElementById('songGrid').addEventListener('click', e => {
  const item = e.target.closest('.song-item');
  if (!item || !item.dataset.sid) return;
  const song = currentList.find(s => s.id === item.dataset.sid);
  if (song) openSong(song);
});

// ponytail: Android-style predictive swipe — the current card follows the finger and
// the neighbor is revealed behind it; commits past a threshold, else snaps back.
(function attachSongSwipe() {
  const el = document.getElementById('songDetail');
  const ghost = document.getElementById('songDetailGhost');
  const view = document.getElementById('detailView');
  if (!el || !ghost || !view) return;
  let x0 = 0, y0 = 0, locked = false, dir = null, target = null, W = 0, lastX = 0, lastT = 0, ignoring = false;
  let backMode = false; // ponytail: left-edge inward drag = back to list (not a song swipe)
  let underEl = null;   // the page being revealed behind the reader
  const EDGE = 24; // px reserved at each screen edge
  function showBackPreview() {
    if (underEl) return;
    underEl = document.getElementById(_detailOriginView) || document.getElementById('homeView');
    if (!underEl) return;
    underEl.classList.add('edge-under');
    document.body.classList.add('edge-back');
  }
  function hideBackPreview() {
    document.body.classList.remove('edge-back');
    document.body.style.removeProperty('--edge-p');
    if (underEl) underEl.classList.remove('edge-under');
    underEl = null;
  }
  function reset() {
    el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; el.style.boxShadow = '';
    view.style.transition = ''; view.style.transform = '';
    ghost.style.transition = ''; ghost.style.transform = ''; ghost.style.opacity = '0';
    ghost.innerHTML = ''; // hidden absolute preview must not extend the scroller
    view.classList.remove('swiping');
    hideBackPreview();
    locked = false; dir = null; target = null; backMode = false;
  }
  el.addEventListener('touchstart', e => {
    if (currentView !== 'detail') return;
    // ponytail: don't hijack swipes that start on the reader sliders / their controls.
    if (e.target.closest('.reader-controls')) { ignoring = true; return; }
    const sx = e.targetTouches[0].clientX;
    // ponytail: right edge stays for the OS back gesture.
    if (sx > window.innerWidth - EDGE) { ignoring = true; return; }
    // ponytail: left edge inward = back to the song list.
    if (sx < EDGE) { ignoring = false; backMode = true; }
    else { backMode = false; }
    ignoring = false;
    const t = e.changedTouches[0];
    x0 = t.clientX; y0 = t.clientY; locked = false; dir = null; target = null;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (currentView !== 'detail' || ignoring) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (backMode) {
      if (dx < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return; // need a clear rightward drag
      e.preventDefault();
      lastX = t.clientX; lastT = Date.now();
      showBackPreview();
      // ponytail: Android predictive-back — the reader follows the finger and the
      // page underneath is revealed (scaling up as the gesture progresses).
      const Wv = window.innerWidth || 1;
      document.body.style.setProperty('--edge-p', String(Math.min(1, dx / Wv)));
      // the WHOLE reader view slides (card + glass controls), revealing the page below
      view.style.transition = 'none';
      view.style.transform = 'translateX(' + dx + 'px)';
      return;
    }
    if (!locked) {
      // engage only on a clear horizontal intent; otherwise let the page scroll.
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      const idx = currentSongIdx;
      if (dx < 0 && currentList[idx + 1]) { dir = 'next'; target = currentList[idx + 1]; }
      else if (dx > 0 && currentList[idx - 1]) { dir = 'prev'; target = currentList[idx - 1]; }
      else return; // no neighbor that way — ignore
      W = el.clientWidth || window.innerWidth;
      ghost.innerHTML = songDetailHTML(target);
      ghost.style.opacity = '1';
      view.classList.add('swiping');
      const scEl = document.getElementById('songScroll');
      if (scEl) scEl.scrollTop = 0; // align front with ghost at the top during the gesture
      locked = true;
    }
    e.preventDefault(); // horizontal drag owns this gesture
    const tx = dx;
    lastX = t.clientX; lastT = Date.now(); // ponytail: track velocity for fling-to-commit
    // ponytail: subtle scale-down with drag distance for a depth/lift feel.
    const scale = 1 - Math.min(Math.abs(dx) / W, 0.5) * 0.12;
    el.style.transition = 'none';
    el.style.transform = 'translateX(' + tx + 'px) scale(' + scale + ')';
    // neighbor sits behind, offset by one card width on the revealed side.
    ghost.style.transition = 'none';
    ghost.style.transform = 'translateX(' + (dir === 'next' ? tx + W : tx - W) + 'px)';
  }, { passive: false });
  function finish() {
    if (backMode) {
      const dx = lastX - x0;
      const dt = Date.now() - lastT;
      // a pause before release must not count as a fling
      const v = (dt > 0 && Date.now() - lastT < 90) ? dx / dt : 0;
      const commit = dx > (window.innerWidth || 1) * 0.32 || (dx > 24 && v > 0.45);
      view.style.transition = 'transform 0.26s cubic-bezier(0.22,0.61,0.36,1)';
      if (commit) {
        view.style.transform = 'translateX(100%)';
        document.body.style.setProperty('--edge-p', '1');
        // let the exit finish, then commit the navigation; reset cleans the layers
        setTimeout(() => { history.back(); setTimeout(reset, 60); }, 250);
      } else {
        view.style.transform = 'translateX(0)';
        document.body.style.setProperty('--edge-p', '0');
        setTimeout(reset, 270);
      }
      backMode = false;
      return;
    }
    if (!locked) return;
    const dx = lastX - x0;
    const dt = Date.now() - lastT;
    const v = dt > 0 ? dx / dt : 0; // px per ms
    // ponytail: commit if dragged past ~28%, or flung (fast flick) even from mid-screen.
    const commit = Math.abs(dx) > W * 0.28 || Math.abs(v) > 0.4;
    el.style.transition = 'transform 0.25s cubic-bezier(0.22,0.61,0.36,1)';
    ghost.style.transition = 'transform 0.25s cubic-bezier(0.22,0.61,0.36,1)';
    if (commit && target) {
      ghost.style.opacity = '0'; // hide revealed neighbor before the front snaps in
      openSong(target, dir);
      reset();
    } else {
      el.style.transform = 'translateX(0) scale(1)';
      ghost.style.transform = 'translateX(' + (dir === 'next' ? W : -W) + 'px)';
      // after the snap-back, reset every drag layer (and clear the hidden preview)
      setTimeout(reset, 260);
    }
    locked = false; dir = null; target = null;
  }
  el.addEventListener('touchend', e => {
    if (ignoring) { ignoring = false; return; }
    if (locked || backMode) { lastX = e.changedTouches[0].clientX; finish(); }
  }, { passive: true });
  // ponytail: browser may cancel the gesture (scroll interrupt, context switch) — always snap back.
  el.addEventListener('touchcancel', () => { ignoring = false; if (locked || backMode) finish(); }, { passive: true });
})();

// ponytail: the same Android predictive-back gesture on song lists — the list
// slides right and reveals the page it was opened from (songbook grid, home,
// settings...). There is no top back button on phones any more.
(function attachListEdgeBack() {
  const el = document.getElementById('listView');
  if (!el) return;
  let x0 = 0, y0 = 0, armed = false, dragging = false, lastX = 0, lastT = 0, under = null;
  function preview() {
    if (under) return;
    under = document.getElementById(_listOriginView) || document.getElementById('homeView');
    if (!under) return;
    under.classList.add('edge-under');
    document.body.classList.add('edge-back');
  }
  function cleanup() {
    document.body.classList.remove('edge-back');
    document.body.style.removeProperty('--edge-p');
    if (under) under.classList.remove('edge-under');
    under = null;
    el.style.transition = ''; el.style.transform = '';
  }
  el.addEventListener('touchstart', e => {
    if (currentView !== 'list' || !window.matchMedia('(max-width: 768px)').matches) return;
    const sx = e.targetTouches[0].clientX;
    if (sx > 24) return; // left-edge gesture only
    if (e.target.closest('button, a, input, select, textarea')) return;
    x0 = sx; y0 = e.changedTouches[0].clientY;
    armed = true; dragging = false;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!armed) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (!dragging) {
      if (dx < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      dragging = true;
      preview();
    }
    e.preventDefault();
    lastX = t.clientX; lastT = Date.now();
    document.body.style.setProperty('--edge-p', String(Math.min(1, dx / (window.innerWidth || 1))));
    el.style.transition = 'none';
    el.style.transform = 'translateX(' + dx + 'px)';
  }, { passive: false });
  function finish() {
    if (!dragging) { armed = false; return; }
    const dx = lastX - x0, dt = Date.now() - lastT;
    const v = (dt > 0 && Date.now() - lastT < 90) ? dx / dt : 0;
    const commit = dx > (window.innerWidth || 1) * 0.32 || (dx > 24 && v > 0.45);
    el.style.transition = 'transform 0.26s cubic-bezier(0.22,0.61,0.36,1)';
    document.body.style.setProperty('--edge-p', commit ? '1' : '0');
    if (commit) {
      el.style.transform = 'translateX(100%)';
      setTimeout(() => { navBack(); setTimeout(cleanup, 60); }, 250);
    } else {
      el.style.transform = 'translateX(0)';
      setTimeout(cleanup, 270);
    }
    armed = false; dragging = false;
  }
  el.addEventListener('touchend', e => {
    if (!armed) return;
    if (dragging) lastX = e.changedTouches[0].clientX;
    finish();
  }, { passive: true });
  el.addEventListener('touchcancel', () => { if (armed) finish(); }, { passive: true });
})();

// Two-finger pinch changes the lyric size. The size is committed when the pinch
// ends, so it becomes the Settings size (slider + localStorage) and the next song
// opens at it instead of snapping back to the previous setting.
(function attachReaderPinch() {
  const el = document.getElementById('songScroll');
  if (!el) return;
  let pinch = null, suppress = false;
  const touchDist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  function start(e) {
    if (currentView !== 'detail' || readerMode !== 'lyrics' || e.touches.length !== 2) return;
    e.preventDefault(); e.stopPropagation();
    const a = e.touches[0], b = e.touches[1];
    const centerY = (a.clientY + b.clientY) / 2;
    const rect = el.getBoundingClientRect();
    const anchor = centerY - rect.top;
    pinch = {
      dist: Math.max(1, touchDist(a, b)),
      font: readerZoomFont,
      height: el.scrollHeight,
      anchor: anchor,
      content: el.scrollTop + anchor
    };
    suppress = true;
    el.classList.add('pinching');
  }
  function move(e) {
    if (suppress && !pinch) { e.stopPropagation(); return; }
    if (!pinch || e.touches.length < 2) return;
    e.preventDefault(); e.stopPropagation();
    const a = e.touches[0], b = e.touches[1];
    const next = clampReaderFont(pinch.font * (touchDist(a, b) / pinch.dist));
    applyReaderFontToReader(next, false);
    const after = el.scrollHeight;
    if (pinch.height > 0) el.scrollTop = Math.max(0, pinch.content * (after / pinch.height) - pinch.anchor);
  }
  function end(e) {
    if (suppress) e.stopPropagation();
    if (e.touches.length < 2) {
      // Commit the pinched size as the Settings size, so it survives a song change
      // (setReaderFont applies it, writes localStorage and moves the slider).
      if (pinch && readerZoomFont !== readerFont) setReaderFont(readerZoomFont);
      if (pinch) scheduleReaderControlsCheck();
      pinch = null;
      el.classList.remove('pinching');
    }
    if (e.touches.length === 0) suppress = false;
  }
  el.addEventListener('touchstart', start, { capture: true, passive: false });
  el.addEventListener('touchmove', move, { capture: true, passive: false });
  el.addEventListener('touchend', end, { capture: true, passive: false });
  el.addEventListener('touchcancel', end, { capture: true, passive: false });
})();

function openSong(song, dir) {
  saveReaderScroll();
  const ghost = document.getElementById('songDetailGhost');
  if (ghost) ghost.innerHTML = ''; // never let a stale swipe preview add scroll height
  // ponytail: every song opens on the lyrics; solfa and chords are opt-in per song.
  readerMode = 'lyrics';
  _viewPillFrom = null;
  chordTranspose = 0;
  // ponytail: capture scroll only when leaving a list view (not prev/next in detail).
  if (currentView !== 'detail') {
    const key = currentCat || currentListKind || 'home';
    _scrollPos[key] = window.scrollY;
  }
  const enteredFromList = currentView !== 'detail';
  if (enteredFromList) _detailOriginView = currentView + 'View';
  currentSongIdx = currentList.findIndex(s => s.id === song.id);
  _songScroll[song.id] = 0; // opening a reader always starts at the top
  showView('detail');
  // ponytail: the detail view is a fixed-height flex column below the nav — reset the
  // DOCUMENT scroll so it isn't carried over from the list; lyrics scroll inside
  // #songScroll instead.
  window.scrollTo(0, 0);
  renderSongDetail(song, dir);
  warmSolfaHd(song);
  addRecent(song.id);
  recordOpen(song.id);
  // ponytail: only push history when entering detail from a list/search, NOT when
  // swiping/arrow-navigating between songs — so one back returns to the list, not song-by-song.
  if (enteredFromList) navPush();
}

// ponytail: stash the reader's scroll for the song currently on screen (used when
// swiping/arrowing away, or when back-nav leaves detail). Prunes after 300 songs.
function saveReaderScroll() {
  if (currentView !== 'detail') return;
  const s = currentList[currentSongIdx];
  if (!s) return;
  const sc = document.getElementById('songScroll');
  _songScroll[s.id] = sc ? sc.scrollTop : 0;
  const ks = Object.keys(_songScroll);
  if (ks.length > 300) ks.slice(0, 100).forEach(k => delete _songScroll[k]);
}
// ponytail: after a list is re-rendered, jump back to the saved scroll position.
function restoreScroll(key) {
  const y = _scrollPos[key];
  if (y == null) return;
  delete _scrollPos[key];
  requestAnimationFrame(() => window.scrollTo(0, y));
}

// ponytail: which list's rows are currently rendered in #songGrid. Leaving the list
// view does NOT clear the grid (the view container is just display:none), so when
// back/forward nav returns to the SAME list we can show it without touching the DOM.
let _renderedListKey = null;
// ponytail: per-key cache of the list's rendered DOM. We keep BOTH the header/grid
// HTML strings (fallback) and the actual detached row nodes (so re-showing any
// previously-viewed list re-attaches existing nodes — no HTML re-parse, no re-fade).
let _listNodes = {};
let _LIST_NODE_CACHE_MAX = 6; // grows once every songbook has been prewarmed
function _stashCurrentList() {
  const grid = document.getElementById('songGrid');
  const key = _renderedListKey;
  // Never replace a good cached fragment with an empty one. A blank grid just means
  // the current list was already restored/stashed; it is not a list to preserve.
  if (!key || !_listCache[key] || !grid || !grid.firstChild) return;
  const frag = document.createDocumentFragment();
  while (grid.firstChild) frag.appendChild(grid.firstChild);
  _listNodes[key] = frag;
  const ks = Object.keys(_listNodes);
  if (ks.length > _LIST_NODE_CACHE_MAX) ks.slice(0, ks.length - _LIST_NODE_CACHE_MAX).forEach(k => delete _listNodes[k]);
}
// ponytail: cache the rendered list so back-nav re-shows it without a rebuild/re-fade.
function saveListCache(key) {
  const grid = document.getElementById('songGrid');
  const header = document.getElementById('listHeader');
  if (grid && header) _listCache[key] = { header: header.innerHTML, grid: grid.innerHTML };
}
// ponytail: rebuild currentList for a restored list key so tapping a row opens the
// right song (the cached DOM rows carry dataset.sid; the click handler resolves it
// against currentList, which the history state does not carry for list views).
function _listFor(key) {
  if (currentListKind === 'cat' && key && SONGS[key]) return SONGS[key].songs;
  if (currentListKind === 'fav') return getFavSongs();
  if (currentListKind === 'history') return historySongs();
  if (currentListKind === 'recent') {
    const out = [];
    recents.forEach(id => CAT_ORDER.forEach(k => {
      const s = SONGS[k].songs.find(x => x.id === id);
      if (s) out.push({ ...s, cat: k, catName: SONGS[k].info.name });
    }));
    return out;
  }
  if (currentListKind === 'playlist' && currentPlaylistId) {
    const pl = playlists.find(p => p.id === currentPlaylistId);
    const out = [];
    if (pl) pl.songs.forEach(id => CAT_ORDER.forEach(k => {
      const s = SONGS[k].songs.find(x => x.id === id);
      if (s) out.push({ ...s, cat: k, catName: SONGS[k].info.name });
    }));
    return out;
  }
  return null;
}
function restoreList(key) {
  const grid = document.getElementById('songGrid');
  // ponytail: the rows for this exact list are still in #songGrid (nothing cleared
  // them when we left) — just re-show the view, no DOM churn, no re-fade.
  if (_renderedListKey === key && _listCache[key] && grid && grid.children.length) {
    const songs = _listFor(key); if (songs) currentList = songs;
    showView('list');
    restoreScroll(key);
    return true;
  }
  // ponytail: a different list, but we've rendered it before — re-attach its cached
  // rows as live nodes (fast; skips HTML parsing entirely).
  const nodes = _listNodes[key];
  if (nodes && grid && nodes.childNodes.length) {
    // Keep the outgoing songbook's rows before swapping in this one. replaceChildren()
    // destroys the old nodes, which previously left that songbook blank when reopened.
    _stashCurrentList();
    document.getElementById('listHeader').innerHTML = _listCache[key].header;
    grid.replaceChildren(nodes);
    _renderedListKey = key;
    const songs = _listFor(key); if (songs) currentList = songs;
    showView('list');
    restoreScroll(key);
    return true;
  }
  const c = _listCache[key];
  // An empty cached grid is not a usable list. Let the caller rebuild it from the
  // song data instead of showing a header with no songs underneath.
  if (!c || !c.grid) return false;
  _stashCurrentList();
  showView('list');
  document.getElementById('listHeader').innerHTML = c.header;
  grid.innerHTML = c.grid;
  // drop the fade-in class so the restored list doesn't re-animate.
  grid.querySelectorAll('.fade-in').forEach(e => e.classList.remove('fade-in'));
  _renderedListKey = key;
  const songs = _listFor(key); if (songs) currentList = songs;
  restoreScroll(key);
  return true;
}

/* ── CHORD STUDIO state ─────────────────────────────────────────────
   Chords live on lyric lines as character indexes ({pos}); the legacy
   fraction ({at}) is written alongside them so old and new charts both
   render. Lyrics are never modified by the editor. */
const CE = {
  song: null, songId: null, key: 'C', blocks: [],
  undo: [], redo: [], base: '', dirty: false,
  selected: null, wheel: null, drag: false, press: null, resizeTimer: null
};
const CE_VERSE_LABELS = { v: 'Verse', c: 'Chorus', b: 'Bridge', pc: 'Pre-Chorus' };
const CE_QUALITIES = ['', 'm', '7', 'maj7', 'm7', '6', 'm6', '9', 'sus2', 'sus4', 'dim', 'aug', '/3', '/5'];
function requestCloseChordEditor() {
  const modal = document.getElementById('chordModal');
  if (!modal || !modal.classList.contains('open')) return;
  ceCloseWheel();
  if (CE.dirty) {
    confirmDangerous('Discard unsaved chord changes?', 'Discard', () => {
      ceCloseWheel();
      closeModal('chordModal');
      CE.dirty = false;
    });
    return;
  }
  closeModal('chordModal');
}
document.getElementById('chordModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) requestCloseChordEditor();
});
const CHORD_LINE_TOKEN_RE = /[A-G](?:#|b)?(?:maj|min|dim|aug|sus|add|m|°|ø)?\d*(?:\/[A-G](?:#|b)?)?/g;
function transposeChordLineText(text, semis, preferFlat) {
  return String(text || '').replace(CHORD_LINE_TOKEN_RE, token => transposeChordName(token, semis, preferFlat));
}
let _ceKeyTimer = null;
function ceKeyTyping() {
  clearTimeout(_ceKeyTimer);
  _ceKeyTimer = setTimeout(() => ceSetKey(document.getElementById('chordEditKey').value, { silent: true }), 420);
}
function ceFlushKeyTyping() {
  clearTimeout(_ceKeyTimer);
  ceSetKey(document.getElementById('chordEditKey').value, { silent: true });
}
const chordKeyField = document.getElementById('chordEditKey');
if (chordKeyField) {
  chordKeyField.addEventListener('input', ceKeyTyping);
  chordKeyField.addEventListener('change', ceFlushKeyTyping);
}
function setChordLabelText(el, text) {
  if (!el || el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('chord-fade');
  void el.offsetWidth; // restart the animation when transposing repeatedly
  el.classList.add('chord-fade');
  clearTimeout(el._chordFadeTimer);
  el._chordFadeTimer = setTimeout(() => el.classList.remove('chord-fade'), 240);
}
function applyChordTransposeToDOM() {
  const song = currentList[currentSongIdx];
  const chart = chordChartFor(song);
  if (!chart) return;
  document.querySelectorAll('.chord-sheet [data-chord]').forEach(el => {
    setChordLabelText(el, chordLabel(chart, el.dataset.chord));
  });
  const key = chartKeyLabel(chart);
  document.querySelectorAll('.chord-key-value, .chord-tool-key').forEach(el => setChordLabelText(el, key));
  closeChordPop();
  document.querySelectorAll('.chord-summary .chord-pill').forEach(el => {
    const label = chordLabel(chart, el.dataset.chord);
    el.setAttribute('aria-label', 'Guitar chord ' + label);
    el.title = 'Guitar chord ' + label;
  });
  const reset = document.querySelector('.chord-tool-reset');
  if (reset) reset.disabled = !chordTranspose;
}
function transposeChordView(delta) {
  chordTranspose = ((chordTranspose + delta) % 12 + 12) % 12;
  applyChordTransposeToDOM();
}
function resetChordTranspose() {
  if (!chordTranspose) return;
  chordTranspose = 0;
  applyChordTransposeToDOM();
}
function chordVerseBlocks(song) {
  const isRef = v => (v.type||'v') === 'p' && v.lines.some(l => /\bdoh\s+is\b/i.test(l));
  const out = [];
  (song.verses||[]).forEach(v => { if (!isRef(v)) out.push(v); });
  return out;
}
function chordLineText(line, specs, chart) {
  const lyric = String(line||'');
  const chars = Array(lyric.length).fill(' ');
  const anchors = [];
  if (chart && chart.free) {
    (specs||[]).forEach(spec => anchors.push({ at: spec.at, ch: spec.ch }));
  } else {
    const words = lyric.trim().split(/\s+/).filter(Boolean);
    const labels = chordAnchorMap(words, specs||[]);
    labels.forEach((ch, idx) => {
      let pos = 0, seen = -1, m;
      const re = /\S+/g;
      while ((m = re.exec(lyric))) { seen++; if (seen === idx) { pos = m.index; break; } }
      anchors.push({ at: lyric.length > 1 ? pos / (lyric.length - 1) : 0, ch });
    });
  }
  anchors.forEach(spec => {
    const ch = String((spec && spec.ch) || '');
    if (!ch) return;
    const span = Math.max(0, lyric.length - 1);
    let pos = Math.round(Math.max(0, Math.min(1, Number(spec.at) || 0)) * span);
    while (pos < chars.length && chars[pos] !== ' ') pos++;
    if (pos + ch.length > chars.length) pos = Math.max(0, Math.min(chars.length - ch.length, pos));
    for (let i = 0; i < ch.length && pos + i < chars.length; i++) chars[pos+i] = ch[i];
  });
  return chars.join('').replace(/\s+$/, '');
}
/* ── lyric canvas ─────────────────────────────────────────────────── */
function ceNoteIn(pc, preferFlat) {
  const p = ((pc % 12) + 12) % 12;
  return (preferFlat ? CHORD_FLAT : CHORD_SHARP)[p];
}
function ceKeyPrefersFlat(key) {
  const pc = chordRootPc(normalizeSongKey(key));
  return pc == null ? false : keyPrefersFlat(pc);
}
function ceNote(pc) { return ceNoteIn(pc, ceKeyPrefersFlat(CE.key)); }
function ceIsMinorKey(key) {
  const k = normalizeSongKey(key).toLowerCase();
  return /(m|min|minor)$/.test(k) && !/maj/.test(k);
}
function ceDiatonic(key) {
  const pc = chordRootPc(normalizeSongKey(key));
  if (pc == null) return ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'];
  const minor = ceIsMinorKey(key);
  const steps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const quals = minor ? ['m', 'dim', '', 'm', 'm', '', ''] : ['', 'm', 'm', '', '', 'm', 'dim'];
  const preferFlat = ceKeyPrefersFlat(key);
  return steps.map((step, i) => ceNoteIn(pc + step, preferFlat) + quals[i]);
}
function ceExtended(rootPc) {
  const preferFlat = ceKeyPrefersFlat(CE.key);
  const n = pc => ceNoteIn(pc, preferFlat);
  return CE_QUALITIES.map(q => {
    if (q === '') return n(rootPc);
    if (q === '/3') return n(rootPc) + '/' + n(rootPc + 4);
    if (q === '/5') return n(rootPc) + '/' + n(rootPc + 7);
    return n(rootPc) + q;
  });
}
function ceChartSpecs(chart, vi, li) {
  const vl = chart && chart.verseLines && chart.verseLines[vi];
  if (vl && vl[li] !== undefined) return vl[li] || [];
  if (vi === 0 && chart && chart.lines && chart.lines[li]) return chart.lines[li];
  return [];
}
function ceSpecPos(spec, len) {
  if (!len) return 0;
  const raw = Number.isInteger(spec.pos) ? spec.pos : Math.round((Number(spec.at) || 0) * (len - 1));
  return Math.max(0, Math.min(len - 1, raw));
}
function ceSnapshot() { return JSON.stringify({ key: CE.key, blocks: CE.blocks }); }
function ceLineEl(b, l) { return document.querySelector('.ce-line[data-b="' + b + '"][data-l="' + l + '"]'); }
function ceChordAt(b, l, pos) {
  return document.querySelector('.ce-chord[data-b="' + b + '"][data-l="' + l + '"][data-pos="' + pos + '"]');
}
function ceWordsHTML(lyric) {
  const s = String(lyric || '');
  let out = '', i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      let j = i; while (j < s.length && /\s/.test(s[j])) j++;
      out += '<span class="ce-ch ce-space" data-i="' + i + '">' + esc(s.slice(i, j)) + '</span>';
      i = j;
    } else {
      let j = i; while (j < s.length && !/\s/.test(s[j])) j++;
      out += '<span class="ce-word"><span class="ce-txt">';
      for (let k = i; k < j; k++) out += '<span class="ce-ch" data-i="' + k + '">' + esc(s[k]) + '</span>';
      out += '</span></span>';
      i = j;
    }
  }
  return out || '<span class="ce-empty">No lyric on this line</span>';
}
function ceRender() {
  const canvas = document.getElementById('ceCanvas');
  if (!canvas) return;
  const counts = {};
  let html = '';
  CE.blocks.forEach((block, b) => {
    const type = block.type || 'v';
    counts[type] = (counts[type] || 0) + 1;
    const label = (CE_VERSE_LABELS[type] || 'Verse') + (counts[type] > 1 ? ' ' + counts[type] : '');
    html += '<section class="ce-verse"><div class="ce-verse-label">' + esc(label) + '</div>';
    block.lines.forEach((line, l) => {
      html += '<div class="ce-line' + (line.chords.length ? ' has-chords' : '') + '" data-b="' + b + '" data-l="' + l + '" role="group" aria-label="' + escAttr(label + ' line ' + (l + 1)) + '">'
        + '<div class="ce-words">' + ceWordsHTML(line.lyric) + '</div></div>';
    });
    html += '</section>';
  });
  canvas.innerHTML = html || '<p class="ce-empty">This song has no lyric lines to chart.</p>';
  ceLayoutAll();
}
function ceLayoutAll() {
  document.querySelectorAll('#ceCanvas .ce-line').forEach(ceLayoutLine);
}
function ceChordButton(b, l, spec) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ce-chord';
  btn.dataset.b = String(b);
  btn.dataset.l = String(l);
  btn.dataset.pos = String(spec.pos);
  btn.dataset.chord = spec.ch;
  btn.textContent = spec.ch;
  btn.title = spec.ch + ' — drag to move, swipe up to remove';
  btn.setAttribute('aria-label', spec.ch + ' above character ' + (spec.pos + 1) + '. Drag to move, swipe up to remove, Delete key to remove.');
  return btn;
}
function ceLayoutLine(lineEl) {
  if (!lineEl || CE.drag) return;
  const b = Number(lineEl.dataset.b), l = Number(lineEl.dataset.l);
  const block = CE.blocks[b];
  const line = block && block.lines[l];
  if (!line) return;
  // The chord lane is padding on the words, so it has to be switched on as soon
  // as a line gains its first chord (otherwise the chip lands on the lyric) and
  // released again when the last chord leaves.
  lineEl.classList.toggle('has-chords', line.chords.length > 0);
  lineEl.querySelectorAll('.ce-chord,.ce-guide').forEach(el => el.remove());
  if (!line.chords.length || !line.lyric.length) return;
  const placed = [];
  const lineRect = lineEl.getBoundingClientRect();
  line.chords.slice().sort((x, y) => x.pos - y.pos).forEach(spec => {
    const chEl = lineEl.querySelector('.ce-ch[data-i="' + spec.pos + '"]');
    if (!chEl) return;
    const word = ceWordFor(chEl);
    if (!word) return;
    const btn = ceChordButton(b, l, spec);
    word.appendChild(btn);
    const wr = word.getBoundingClientRect(), cr = chEl.getBoundingClientRect();
    const left = cr.left - wr.left;
    btn.style.left = left + 'px';
    const r = btn.getBoundingClientRect();
    placed.push({ btn: btn, wordOffset: wr.left - lineRect.left, left: left, width: r.width });
  });
  // Chords stay on one row and are nudged right until they sit side by side. That
  // guarantees no chip can cover another (or a gesture aimed at the one beneath),
  // without stealing vertical space from the lyric.
  placed.sort((a, b) => (a.wordOffset + a.left) - (b.wordOffset + b.left));
  let cursor = -Infinity;
  placed.forEach(p => {
    const want = Math.max(p.wordOffset + p.left, cursor + 3);
    p.btn.style.left = (want - p.wordOffset) + 'px';
    p.btn.style.top = '0px';
    cursor = want + p.width;
  });
}
function ceWordFor(chEl) {
  const own = chEl.closest('.ce-word');
  if (own) return own;
  // a space: hang the chord off the next word so wrapped lines stay aligned
  for (let n = chEl.nextElementSibling; n; n = n.nextElementSibling) {
    const w = n.classList.contains('ce-word') ? n : n.querySelector('.ce-word');
    if (w) return w;
  }
  for (let n = chEl.previousElementSibling; n; n = n.previousElementSibling) {
    const w = n.classList.contains('ce-word') ? n : n.querySelector('.ce-word');
    if (w) return w;
  }
  return null;
}
/* ── history + chrome ─────────────────────────────────────────────── */
function ceHistoryPush() {
  const snap = ceSnapshot();
  if (CE.undo[CE.undo.length - 1] !== snap) CE.undo.push(snap);
  if (CE.undo.length > 60) CE.undo.shift();
  CE.redo.length = 0;
}
function ceUndo() {
  if (!CE.undo.length) return;
  CE.redo.push(ceSnapshot());
  ceApplySnapshot(CE.undo.pop());
  ceFlashStatus('Undo');
}
function ceRedo() {
  if (!CE.redo.length) return;
  CE.undo.push(ceSnapshot());
  ceApplySnapshot(CE.redo.pop());
  ceFlashStatus('Redo');
}
function ceApplySnapshot(snap) {
  const state = JSON.parse(snap);
  CE.key = state.key;
  CE.blocks = state.blocks;
  CE.selected = null;
  const field = document.getElementById('chordEditKey');
  if (field) field.value = CE.key;
  ceCloseWheel();
  ceRender();
  CE.dirty = ceSnapshot() !== CE.base;
  ceUpdateChrome();
}
function ceMarkDirty() { CE.dirty = ceSnapshot() !== CE.base; ceUpdateChrome(); }
function ceUpdateChrome() {
  const undo = document.getElementById('ceUndo'), redo = document.getElementById('ceRedo');
  if (undo) undo.disabled = !CE.undo.length;
  if (redo) redo.disabled = !CE.redo.length;
  const count = CE.blocks.reduce((n, b) => n + b.lines.reduce((m, line) => m + line.chords.length, 0), 0);
  const chip = document.getElementById('ceCount');
  if (chip) chip.textContent = count + (count === 1 ? ' chord' : ' chords');
  const status = document.getElementById('ceStatus');
  if (status && !status.dataset.flash) status.textContent = CE.dirty ? 'Unsaved changes' : '';
}
function ceFlashStatus(msg, bad) {
  const status = document.getElementById('ceStatus');
  if (!status) return;
  status.textContent = msg;
  status.classList.toggle('bad', !!bad);
  status.dataset.flash = '1';
  clearTimeout(status._flash);
  status._flash = setTimeout(() => {
    delete status.dataset.flash;
    status.classList.remove('bad');
    ceUpdateChrome();
  }, 2200);
}
/* ── key + transposition ──────────────────────────────────────────── */
function ceSetKey(raw, opts) {
  const key = normalizeSongKey(raw);
  const pc = chordRootPc(key);
  if (pc == null) {
    if (!(opts && opts.silent)) ceFlashStatus('Enter a key such as G or Bb', true);
    return false;
  }
  const prevPc = chordRootPc(normalizeSongKey(CE.key));
  const semis = prevPc == null ? 0 : (((pc - prevPc) % 12) + 12) % 12;
  if (semis) {
    ceHistoryPush();
    const preferFlat = /b/.test(key) ? true : /#/.test(key) ? false : keyPrefersFlat(pc);
    CE.blocks.forEach(block => block.lines.forEach(line => line.chords.forEach(c => {
      c.ch = transposeChordName(c.ch, semis, preferFlat);
    })));
  }
  CE.key = key;
  const field = document.getElementById('chordEditKey');
  if (field && field.value !== key && !(opts && opts.silent)) field.value = key;
  CE.selected = null;
  ceCloseWheel();
  ceRender();
  ceMarkDirty();
  if (!(opts && opts.silent)) ceFlashStatus('Key ' + key);
  return true;
}
function ceNudgeKey(dir) {
  const pc = chordRootPc(normalizeSongKey(CE.key));
  if (pc == null) return;
  const next = ceNote(pc + dir);
  const field = document.getElementById('chordEditKey');
  if (field) field.value = next;
  ceSetKey(next);
}
/* ── chord wheel ──────────────────────────────────────────────────── */
function ceWheelOpen(opts) {
  const block = CE.blocks[opts.b];
  const line = block && block.lines[opts.l];
  if (!line) return;
  const keyPc = chordRootPc(normalizeSongKey(CE.key));
  const current = opts.existing >= 0 ? line.chords[opts.existing] : null;
  const rootPc = current ? (chordRootPc(current.ch) ?? (keyPc ?? 0)) : (keyPc ?? 0);
  CE.wheel = {
    b: opts.b, l: opts.l, pos: opts.pos, existing: opts.existing,
    rootPc, expanded: false,
    anchor: opts.anchor || { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    current: current ? current.ch : null
  };
  const wheel = document.getElementById('ceWheel');
  document.getElementById('ceWheelBackdrop').hidden = false;
  wheel.hidden = false;
  document.getElementById('ceWheelRemove').hidden = opts.existing < 0;
  const custom = document.getElementById('ceWheelCustom');
  custom.value = '';
  custom.classList.remove('bad');
  ceWheelRender();
  ceWheelPlace();
  wheel.classList.remove('in');
  void wheel.offsetWidth;
  wheel.classList.add('in');
}
function ceWheelRender() {
  const w = CE.wheel;
  if (!w) return;
  const compact = window.matchMedia('(max-width:640px)').matches;
  const primary = ceDiatonic(CE.key);
  const extended = ceExtended(w.rootPc);
  const outerRadius = w.expanded ? (compact ? 112 : 140) : (compact ? 84 : 98);
  const stage = document.getElementById('ceWheelStage');
  const size = outerRadius * 2 + (compact ? 62 : 76);
  stage.style.setProperty('--stage', size + 'px');
  stage.classList.toggle('grid', compact && w.expanded);
  const layers = [];
  if (w.expanded && !(compact)) {
    layers.push({ names: primary, radius: compact ? 60 : 72, cls: 'inner' });
    layers.push({ names: extended, radius: outerRadius, cls: 'outer' });
  } else if (w.expanded) {
    layers.push({ names: extended, radius: outerRadius, cls: 'outer' });
  } else {
    layers.push({ names: primary, radius: outerRadius, cls: '' });
  }
  let html = '';
  layers.forEach(layer => {
    layer.names.forEach((name, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / layer.names.length;
      const x = Math.round(Math.cos(angle) * layer.radius);
      const y = Math.round(Math.sin(angle) * layer.radius);
      const current = w.current === name ? ' is-current' : '';
      html += '<button type="button" class="ce-wheel-chip ' + layer.cls + current + '" data-chord="' + escAttr(name) + '" data-x="' + x + '" data-y="' + y + '" data-i="' + i + '">' + esc(name) + '</button>';
    });
  });
  html += '<button type="button" class="ce-wheel-hub' + (w.expanded ? ' is-back' : '') + '" id="ceWheelHub" aria-label="' + (w.expanded ? 'Back to key chords' : 'Show extended chords') + '">' + (w.expanded ? 'Back' : 'More') + '</button>';
  stage.innerHTML = html;
  stage.querySelectorAll('.ce-wheel-chip').forEach(chip => {
    chip.style.setProperty('--x', chip.dataset.x + 'px');
    chip.style.setProperty('--y', chip.dataset.y + 'px');
    chip.style.setProperty('--i', chip.dataset.i);
  });
  document.getElementById('ceWheelTitle').textContent = w.existing >= 0 ? 'Replace ' + w.current : 'Add a chord';
  const rootRow = document.getElementById('ceWheelRootRow');
  rootRow.hidden = !w.expanded;
  const rootSel = document.getElementById('ceWheelRoot');
  if (rootSel.options.length !== 12) {
    rootSel.innerHTML = '';
    for (let pc = 0; pc < 12; pc++) {
      const opt = document.createElement('option');
      opt.value = String(pc);
      rootSel.appendChild(opt);
    }
  }
  const preferFlat = ceKeyPrefersFlat(CE.key);
  for (let pc = 0; pc < 12; pc++) {
    if (rootSel.options[pc]) rootSel.options[pc].textContent = ceNoteIn(pc, preferFlat);
  }
  rootSel.value = String(w.rootPc);
  document.getElementById('ceWheelFamily').textContent = w.expanded
    ? ''
    : (ceIsMinorKey(CE.key) ? 'Minor key family' : 'Key family');
}
function ceWheelPlace() {
  const wheel = document.getElementById('ceWheel');
  if (!wheel || wheel.hidden) return;
  const compact = window.matchMedia('(max-width:640px)').matches;
  wheel.classList.toggle('compact', compact);
  if (compact) { wheel.style.left = ''; wheel.style.top = ''; return; }
  const rect = wheel.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const anchor = CE.wheel && CE.wheel.anchor ? CE.wheel.anchor : { x: vw / 2, y: vh / 2 };
  let left = anchor.x - rect.width / 2;
  left = Math.max(10, Math.min(vw - rect.width - 10, left));
  let top = anchor.y - rect.height - 12;
  if (top < 10) top = Math.min(vh - rect.height - 10, anchor.y + 34);
  if (top < 10) top = 10;
  wheel.style.left = left + 'px';
  wheel.style.top = top + 'px';
}
function ceWheelToggleExpanded(force) {
  if (!CE.wheel) return;
  CE.wheel.expanded = typeof force === 'boolean' ? force : !CE.wheel.expanded;
  ceWheelRender();
  ceWheelPlace();
}
function ceWheelPick(name) {
  const w = CE.wheel;
  if (!w) return;
  const block = CE.blocks[w.b];
  const line = block && block.lines[w.l];
  if (!line) return;
  name = String(name || '').trim();
  if (!name || chordRootPc(name) == null) { ceFlashStatus('Unknown chord: ' + name, true); return; }
  ceHistoryPush();
  let idx = w.existing;
  if (idx < 0) {
    const dup = line.chords.findIndex(c => c.pos === w.pos);
    if (dup >= 0) idx = dup;
  }
  const replacing = idx >= 0 && !!line.chords[idx];
  if (replacing) line.chords[idx].ch = name;
  else {
    line.chords.push({ pos: w.pos, ch: name });
    line.chords.sort((a, b) => a.pos - b.pos);
  }
  const b = w.b, l = w.l, pos = w.pos;
  ceMarkDirty();
  ceCloseWheel();
  ceLayoutLine(ceLineEl(b, l));
  ceSelect(b, l, pos);
  ceFlashStatus((replacing ? 'Replaced with ' : 'Added ') + name);
}
function ceWheelDelete() {
  const w = CE.wheel;
  if (!w || w.existing < 0) return;
  const b = w.b, l = w.l, idx = w.existing;
  ceDeleteChord(b, l, idx);
}
function ceWheelCustomSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('ceWheelCustom');
  if (!input) return;
  const raw = String(input.value || '').trim().replace(/\s+/g, '');
  if (!raw || chordRootPc(raw) == null) {
    input.classList.add('bad');
    ceFlashStatus('That is not a chord name', true);
    setTimeout(() => input.classList.remove('bad'), 700);
    return;
  }
  ceWheelPick(raw);
}
function ceCloseWheel() {
  CE.wheel = null;
  const wheel = document.getElementById('ceWheel');
  const backdrop = document.getElementById('ceWheelBackdrop');
  if (wheel) { wheel.hidden = true; wheel.classList.remove('in', 'compact'); }
  if (backdrop) backdrop.hidden = true;
  document.querySelectorAll('.ce-chord.active').forEach(el => el.classList.remove('active'));
}
/* ── selection, delete, move ──────────────────────────────────────── */
function ceSelect(b, l, pos) {
  document.querySelectorAll('.ce-chord.sel').forEach(el => el.classList.remove('sel'));
  if (b == null) { CE.selected = null; return; }
  CE.selected = { b, l, pos };
  const el = ceChordAt(b, l, pos);
  if (el) el.classList.add('sel');
}
function ceDeleteChord(b, l, idx) {
  const block = CE.blocks[b];
  const line = block && block.lines[l];
  if (!line || !line.chords[idx]) return;
  const spec = line.chords[idx];
  const el = ceChordAt(b, l, spec.pos);
  ceHistoryPush();
  line.chords.splice(idx, 1);
  if (CE.selected && CE.selected.b === b && CE.selected.l === l && CE.selected.pos === spec.pos) CE.selected = null;
  ceMarkDirty();
  ceCloseWheel();
  if (el) {
    el.classList.add('is-out');
    setTimeout(() => { el.remove(); ceLayoutLine(ceLineEl(b, l)); }, 190);
  } else {
    ceLayoutLine(ceLineEl(b, l));
  }
  ceFlashStatus('Removed ' + spec.ch);
}
function ceShiftSelected(delta) {
  const sel = CE.selected;
  if (!sel) return;
  const block = CE.blocks[sel.b];
  const line = block && block.lines[sel.l];
  if (!line) return;
  const idx = line.chords.findIndex(c => c.pos === sel.pos);
  if (idx < 0) return;
  const next = Math.max(0, Math.min(line.lyric.length - 1, line.chords[idx].pos + delta));
  if (next === line.chords[idx].pos) return;
  if (line.chords.some((c, i) => i !== idx && c.pos === next)) return;
  ceHistoryPush();
  line.chords[idx].pos = next;
  line.chords.sort((a, b) => a.pos - b.pos);
  ceMarkDirty();
  ceLayoutLine(ceLineEl(sel.b, sel.l));
  ceSelect(sel.b, sel.l, next);
}
/* ── pointer: tap to add/replace, drag to move, swipe up to delete ── */
function ceRectAnchor(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top };
}
function ceNearestChar(lineEl, x, y) {
  let best = null, score = Infinity;
  lineEl.querySelectorAll('.ce-ch[data-i]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const s = Math.abs(r.left + r.width / 2 - x) + Math.abs(r.top + r.height / 2 - y) * 0.8;
    if (s < score) { score = s; best = el; }
  });
  return best;
}
function  cePointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const chordEl = e.target.closest('.ce-chord');
  const lineEl = e.target.closest('.ce-line');
  if (!lineEl) { ceCloseWheel(); return; }
  const b = Number(lineEl.dataset.b), l = Number(lineEl.dataset.l);
  const block = CE.blocks[b];
  const line = block && block.lines[l];
  if (!line) return;
  // Only chord chips need pointer tracking (drag to move, swipe up to delete).
  // Taps are handled from the click event so a quick tap never gets swallowed
  // when the browser reads a finger's tiny drift as the start of a scroll.
  if (!chordEl) return;
  const pos = Number(chordEl.dataset.pos);
  const idx = line.chords.findIndex(c => c.pos === pos);
  if (idx < 0) return;
  CE.press = { pointerId: e.pointerId, chordEl, lineEl, b, l, pos, idx, x0: e.clientX, y0: e.clientY, started: false };
}
function cePointerMove(e) {
  const p = CE.press;
  if (!p || e.pointerId !== p.pointerId) return;
  const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
  if (!p.started) {
    if (!p.chordEl) return; // taps on lyrics leave scrolling to the page
    if (Math.hypot(dx, dy) < 6) return;
    const block = CE.blocks[p.b];
    const line = block && block.lines[p.l];
    if (!line || !line.chords[p.idx]) return;
    CE.drag = true;
    CE.suppressTapUntil = Date.now() + 400;
    p.started = true;
    p.originLeft = parseFloat(p.chordEl.style.left) || p.chordEl.offsetLeft;
    p.chordEl.classList.add('dragging');
    p.guide = document.createElement('span');
    p.guide.className = 'ce-guide';
    p.guide.hidden = true;
    p.lineEl.appendChild(p.guide);
    p.hint = document.getElementById('ceDragHint');
    if (p.hint) { p.hint.hidden = false; p.hint.textContent = 'Release to place chord'; p.hint.classList.remove('danger'); }
    ceCloseWheel();
    ceSelect(p.b, p.l, line.chords[p.idx].pos);
  }
  e.preventDefault();
  p.chordEl.style.left = (p.originLeft + dx) + 'px';
  p.chordEl.style.transform = dy < 0 ? 'translateY(' + dy + 'px)' : 'none';
  const remove = dy < -52;
  p.deleteReady = remove;
  p.chordEl.classList.toggle('will-delete', remove);
  if (p.hint) {
    p.hint.textContent = remove ? 'Release to remove chord' : 'Release to place chord';
    p.hint.classList.toggle('danger', remove);
  }
  const rect = p.chordEl.getBoundingClientRect();
  const target = ceNearestChar(p.lineEl, rect.left + rect.width / 2, e.clientY);
  const changedChar = target && target !== p.target;
  if (p.target && p.target !== target) p.target.classList.remove('ce-drop');
  p.target = target;
  if (target) {
    if (changedChar && !remove) haptic(5);
    target.classList.add('ce-drop');
    const lr = p.lineEl.getBoundingClientRect(), tr = target.getBoundingClientRect();
    p.guide.hidden = false;
    p.guide.style.left = (tr.left - lr.left + tr.width / 2 - 1) + 'px';
    p.guide.style.top = (tr.top - lr.top) + 'px';
    p.guide.style.height = tr.height + 'px';
  } else if (p.guide) {
    p.guide.hidden = true;
  }
}
function cePointerUp(e) {
  const p = CE.press;
  if (!p || e.pointerId !== p.pointerId) return;
  CE.press = null;
  // A tap that never became a drag is opened from its click event instead.
  if (!p.started) return;
  // The click that follows this release must not re-open the wheel.
  CE.suppressTapUntil = Date.now() + 400;
  if (p.guide) p.guide.remove();
  if (p.hint) p.hint.hidden = true;
  if (p.target) p.target.classList.remove('ce-drop');
  p.chordEl.classList.remove('dragging', 'will-delete');
  p.chordEl.style.transform = '';
  CE.drag = false;
  if (p.deleteReady) { ceDeleteChord(p.b, p.l, p.idx); return; }
  const block = CE.blocks[p.b];
  const line = block && block.lines[p.l];
  const spec = line && line.chords[p.idx];
  if (p.target && spec) {
    const pos = Number(p.target.dataset.i);
    if (pos !== spec.pos) {
      ceHistoryPush();
      spec.pos = pos;
      line.chords.sort((a, b) => a.pos - b.pos);
      ceMarkDirty();
      ceSelect(p.b, p.l, pos);
      ceLayoutLine(p.lineEl);
      ceFlashStatus('Moved to character ' + (pos + 1));
      return;
    }
  }
  ceLayoutLine(p.lineEl);
}
// One tap anywhere inside a lyric line — a letter, the space between words or
// the empty chord lane above a word — opens the wheel for the nearest syllable.
// Chips open it in replace mode. Using click (not pointerup) means a tap lands
// even if the finger drifts a pixel or two; scrolling still wins because a
// scroll gesture produces no click.
function ceTapClick(e) {
  if (CE.suppressTapUntil && Date.now() < CE.suppressTapUntil) return;
  const lineEl = e.target.closest('#ceCanvas .ce-line');
  if (!lineEl) return;
  const b = Number(lineEl.dataset.b), l = Number(lineEl.dataset.l);
  const block = CE.blocks[b];
  const line = block && block.lines[l];
  if (!line) return;
  const chordEl = e.target.closest('.ce-chord');
  if (chordEl) {
    const idx = line.chords.findIndex(c => c.pos === Number(chordEl.dataset.pos));
    const spec = idx >= 0 ? line.chords[idx] : null;
    if (!spec) return;
    ceSelect(b, l, spec.pos);
    ceWheelOpen({ b, l, pos: spec.pos, existing: idx, anchor: ceRectAnchor(chordEl) });
    return;
  }
  const chEl = ceNearestChar(lineEl, e.clientX, e.clientY);
  if (!chEl || chEl.dataset.i == null) return;
  const pos = Number(chEl.dataset.i);
  const existing = line.chords.findIndex(c => c.pos === pos);
  if (existing >= 0) ceSelect(b, l, pos); else ceSelect(null);
  ceWheelOpen({ b, l, pos, existing, anchor: ceRectAnchor(chEl) });
}
function cePointerCancel() {
  const p = CE.press;
  if (!p) return;
  CE.press = null;
  CE.drag = false;
  if (p.chordEl) { p.chordEl.classList.remove('dragging', 'will-delete'); p.chordEl.style.transform = ''; }
  if (p.guide) p.guide.remove();
  if (p.hint) p.hint.hidden = true;
  if (p.target) p.target.classList.remove('ce-drop');
  ceLayoutLine(p.lineEl);
}
function ceKeyDown(e) {
  const modal = document.getElementById('chordModal');
  if (!modal || !modal.classList.contains('open')) return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (e.key === 'Escape') {
    // Capture phase + immediate stop: otherwise the app-wide "Escape closes any
    // modal" handler also fires and closes the studio while the wheel is open.
    if (CE.wheel) { e.preventDefault(); e.stopImmediatePropagation(); ceCloseWheel(); }
    else if (CE.selected) { e.preventDefault(); e.stopImmediatePropagation(); ceSelect(null); }
    else if (!typing) { e.preventDefault(); e.stopImmediatePropagation(); requestCloseChordEditor(); }
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) ceRedo(); else ceUndo(); return; }
  if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); ceRedo(); return; }
  if (typing) return;
  if ((e.key === 'Backspace' || e.key === 'Delete') && CE.selected) {
    const sel = CE.selected;
    const block = CE.blocks[sel.b];
    const line = block && block.lines[sel.l];
    if (!line) return;
    const idx = line.chords.findIndex(c => c.pos === sel.pos);
    if (idx >= 0) { e.preventDefault(); ceDeleteChord(sel.b, sel.l, idx); }
    return;
  }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && CE.selected) {
    e.preventDefault();
    ceShiftSelected(e.key === 'ArrowRight' ? 1 : -1);
  }
}
/* ── wiring ───────────────────────────────────────────────────────── */
(function ceWire() {
  const canvas = document.getElementById('ceCanvas');
  if (canvas) {
    canvas.addEventListener('pointerdown', cePointerDown);
    canvas.addEventListener('click', ceTapClick);
    // Track moves/releases on the window: a drag leaves the canvas (and the chord
    // node may be re-laid-out), where pointer capture is brittle and can drop the
    // release entirely.
    window.addEventListener('pointermove', cePointerMove, { passive: false });
    window.addEventListener('pointerup', cePointerUp);
    window.addEventListener('pointercancel', cePointerCancel);
  }
  // Tapping anywhere outside the picker dismisses it (backdrop taps included),
  // and the capture phase stops that tap from charting a chord underneath.
  document.addEventListener('click', e => {
    if (!CE.wheel) return;
    if (e.target.closest('#ceWheel')) return;
    e.preventDefault();
    e.stopPropagation();
    ceCloseWheel();
  }, true);
  const stage = document.getElementById('ceWheelStage');
  if (stage) {
    stage.addEventListener('click', e => {
      const hub = e.target.closest('.ce-wheel-hub');
      if (hub) { ceWheelToggleExpanded(); return; }
      const chip = e.target.closest('.ce-wheel-chip');
      if (chip && chip.dataset.chord) ceWheelPick(chip.dataset.chord);
    });
  }
  const rootSel = document.getElementById('ceWheelRoot');
  if (rootSel) rootSel.addEventListener('change', () => {
    if (!CE.wheel) return;
    CE.wheel.rootPc = Number(rootSel.value) || 0;
    ceWheelRender();
    ceWheelPlace();
  });
  const customForm = document.getElementById('ceWheelCustomForm');
  if (customForm) customForm.addEventListener('submit', ceWheelCustomSubmit);
  document.addEventListener('keydown', ceKeyDown, true);
  window.addEventListener('resize', () => {
    const modal = document.getElementById('chordModal');
    if (!modal || !modal.classList.contains('open')) return;
    clearTimeout(CE.resizeTimer);
    CE.resizeTimer = setTimeout(() => {
      ceLayoutAll();
      if (CE.wheel) { ceWheelRender(); ceWheelPlace(); }
    }, 120);
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      const modal = document.getElementById('chordModal');
      if (modal && modal.classList.contains('open')) ceLayoutAll();
    });
  }
})();
function parseChordPlacement(chordLine, lyricLine) {
  const lyric = String(lyricLine||'');
  const span = Math.max(0, lyric.length - 1);
  const specs = [];
  const re = /[A-G](?:#|b)?(?:maj|min|dim|aug|sus|add|m|°|ø)?\d*(?:\/[A-G](?:#|b)?)?/g;
  let m;
  while ((m = re.exec(String(chordLine||'')))) {
    const ch = m[0];
    if (chordRootPc(ch) == null) continue;
    specs.push({ at: span ? Math.min(1, Math.max(0, m.index / span)) : 0, ch });
  }
  return specs;
}
function openChordEditor() {
  const song = currentList && currentList[currentSongIdx];
  if (!song) return;
  const tune = chordTuneIndex(song);
  const chart = chordChartFor(song, tune);
  CE.song = song;
  CE.songId = chordChartKey(song, tune);
  CE.tune = tune;
  CE.key = (chart && normalizeSongKey(chart.key)) || (tune && normalizeSongKey(song.solfa2Key)) || normalizeSongKey(song.key) || 'C';
  const blocks = chordVerseBlocks(song);
  CE.blocks = blocks.map((verse, vi) => ({
    type: verse.type || 'v',
    lines: (verse.lines || []).map((lineText, li) => {
      const lyric = String(lineText || '');
      const chords = [];
      (chart ? ceChartSpecs(chart, vi, li) : []).forEach(spec => {
        if (!spec || !spec.ch || chordRootPc(spec.ch) == null) return;
        const pos = ceSpecPos(spec, lyric.length);
        if (chords.some(c => c.pos === pos)) return;
        chords.push({ pos: pos, ch: String(spec.ch).trim() });
      });
      chords.sort((a, b) => a.pos - b.pos);
      return { lyric: lyric, chords: chords };
    })
  }));
  CE.undo = [];
  CE.redo = [];
  CE.selected = null;
  CE.drag = false;
  CE.press = null;
  CE.base = ceSnapshot();
  CE.dirty = false;
  const field = document.getElementById('chordEditKey');
  if (field) field.value = CE.key;
  document.getElementById('chordModalTitle').textContent = (chart ? 'Edit Chords' : 'Add Chords') + (tune ? ' — Tune 2' : '');
  const saved = document.getElementById('ceSaved');
  if (saved) saved.hidden = true;
  const status = document.getElementById('ceStatus');
  if (status) { status.textContent = ''; delete status.dataset.flash; status.classList.remove('bad'); }
  ceCloseWheel();
  // open first: chord chips are placed from measured glyph offsets, and a hidden
  // modal reports every rect as 0 (which would stack all chords at the left edge)
  openModal('chordModal');
  ceRender();
  ceUpdateChrome();
  const canvas = document.getElementById('ceCanvas');
  if (canvas) canvas.scrollTop = 0;
}
function saveChordEditor() {
  const song = CE.song;
  if (!song) return;
  const field = document.getElementById('chordEditKey');
  const key = normalizeSongKey(field ? field.value : CE.key) || CE.key;
  if (chordRootPc(key) == null) { ceFlashStatus('Key must be a note such as G or Bb', true); return; }
  if (key !== CE.key && !ceSetKey(key, { silent: true })) {
    ceFlashStatus('Key must be a note such as G or Bb', true);
    return;
  }
  const verseLines = CE.blocks.map(block => block.lines.map(line => {
    const len = line.lyric.length;
    return line.chords.slice().sort((a, b) => a.pos - b.pos).map(c => ({
      pos: c.pos,
      ch: c.ch,
      at: len > 1 ? Number((c.pos / (len - 1)).toFixed(4)) : 0
    }));
  }));
  const chords = [];
  verseLines.forEach(lines => lines.forEach(specs => specs.forEach(s => {
    if (s.ch && !chords.includes(s.ch)) chords.push(s.ch);
  })));
  if (!chords.length) { ceFlashStatus('Add at least one chord before saving', true); return; }
  // Copy first: the existing entry may be the shared bundled chart, and saving
  // here must not rewrite the fallback other charts borrow from.
  const chart = Object.assign({}, CHORD_CHARTS[CE.songId] || { verses: verseLines.length });
  chart.key = key;
  chart.lines = verseLines[0] || [];
  chart.verseLines = verseLines;
  chart.verses = verseLines.length;
  // Marks a chart that covers every verse, so an emptied verse below is read as
  // deliberate and is never re-filled from the shipped chart.
  chart.allVerses = true;
  chart.chords = chords;
  chart.free = true;
  CHORD_CHARTS[CE.songId] = chart;
  USER_CHORD_IDS.add(CE.songId);
  if (!saveUserChordCharts()) { ceFlashStatus('Could not save chords: device storage is full', true); return; }
  submitChange('chord', { id: CE.songId, chart: chart, title: song.title, tune: (CE.tune || 0) + 1 });
  CE.base = ceSnapshot();
  CE.dirty = false;
  ceUpdateChrome();
  const saved = document.getElementById('ceSaved');
  if (saved) saved.hidden = false;
  chordTranspose = 0;
  ceCloseWheel();
  closeModal('chordModal');
  readerMode = 'chords';
  _songScroll[song.id] = 0;
  renderSongDetail(song);
}

function chordAnchorMap(words, specs) {
  const used = new Set(), labels = new Map();
  (specs||[]).forEach(spec => {
    if (!words.length) return;
    let idx = Math.max(0, Math.min(words.length-1, Math.round(spec.at * (words.length-1))));
    if (used.has(idx)) {
      let free = -1;
      for (let d = 1; d < words.length && free < 0; d++) {
        for (const cand of [idx-d, idx+d]) {
          if (cand >= 0 && cand < words.length && !used.has(cand)) { free = cand; break; }
        }
      }
      if (free >= 0) idx = free;
    }
    used.add(idx);
    labels.set(idx, spec.ch);
  });
  return labels;
}
function chordLineHTML(line, specs, chart, vi, li) {
  const lyric = String(line||'');
  // Character-anchored charts ({pos}) render as a word/character canvas so the
  // chord labels can be placed from the measured glyph itself.
  const posSpecs = (specs || []).filter(s => s && s.ch && Number.isInteger(s.pos) && chordRootPc(s.ch) != null);
  if (posSpecs.length) {
    return '<div class="chord-line chord-line-free chord-line-pos" data-v="' + (vi || 0) + '" data-l="' + (li || 0) + '"><div class="ce-words">' + ceWordsHTML(lyric) + '</div></div>';
  }
  if (!(chart && chart.free)) {
    const words = lyric.trim().split(/\s+/).filter(Boolean);
    const labels = chordAnchorMap(words, specs||[]);
    return '<div class="chord-line chord-line-worded">' + words.map((word, i) =>
      '<span class="chord-word"><span class="chord-name"'+(labels.has(i) ? ' data-chord="'+escAttr(labels.get(i))+'"' : '')+'>'+(labels.has(i) ? esc(chordLabel(chart, labels.get(i))) : '')+'</span><span class="chord-text">'+esc(word)+'</span></span>'
    ).join('') + '</div>';
  }
  const labels = (specs||[]).slice().sort((a,b) => (a.at||0)-(b.at||0)).map(spec => {
    const at = Math.max(0, Math.min(1, Number(spec.at) || 0));
    const pct = at * 100;
    const shift = pct < 8 ? 0 : pct > 92 ? 100 : 50;
    return '<span class="chord-name chord-float" data-chord="'+escAttr(spec.ch)+'" data-left="'+pct.toFixed(3)+'" data-shift="'+shift+'">'+esc(chordLabel(chart, spec.ch))+'</span>';
  }).join('');
  return '<div class="chord-line chord-line-free"><div class="chord-float-row">'+labels+'</div><div class="chord-text-line">'+esc(lyric)+'</div></div>';
}

// The summary is derived from the chart itself, not only the cached chord list:
// older/local edits can leave chart.chords stale (even [null]), and the visible
// chord set must still match what is on the lines.
function chartChordNames(chart) {
  if (!chart) return [];
  const names = [];
  const add = name => {
    name = String(name || '').trim();
    if (name && chordRootPc(name) != null && !names.includes(name)) names.push(name);
  };
  (chart.chords || []).forEach(add);
  const addSpecs = specs => (specs || []).forEach(s => add(s && s.ch));
  (chart.verseLines || []).forEach(lines => (lines || []).forEach(addSpecs));
  addSpecs(chart.lines);
  return names;
}

function chordSheetHTML(song, chart) {
  const vt = {v:'Verse',c:'Chorus',b:'Bridge',p:'Reference',pc:'Pre-Chorus'};
  const isRef = v => (v.type||'v') === 'p' && v.lines.some(l => /\bdoh\s+is\b/i.test(l));
  const verses = (song.verses||[]).filter(v => !isRef(v));
  const counts = {v:0,c:0,b:0,p:0,pc:0};
  let html = '<div class="chord-sheet fade-in"><div class="chord-summary"><span class="chord-summary-label">Key <span class="chord-key-value">'+esc(chartKeyLabel(chart))+'</span></span>'
    + chartChordNames(chart).map(c => {
      const label = chordLabel(chart, c);
      return '<button type="button" class="chord-pill" data-chord="'+escAttr(c)+'" data-action="openChordShape" aria-label="Guitar chord '+escAttr(label)+'" title="Guitar chord '+escAttr(label)+'">'+esc(label)+'</button>';
    }).join('')
    + '</div>'
    + '<div class="chord-tools"><span class="chord-tools-label">Transpose</span>'
    + '<button type="button" class="chord-tool-btn" data-action="transposeChordView" data-step="-1" aria-label="Transpose down one semitone" title="Transpose down">−</button>'
    + '<strong class="chord-tool-key">'+esc(chartKeyLabel(chart))+'</strong>'
    + '<button type="button" class="chord-tool-btn" data-action="transposeChordView" data-step="1" aria-label="Transpose up one semitone" title="Transpose up">+</button>'
    + '<button type="button" class="chord-tool-reset" data-action="resetChordTranspose"'+(chordTranspose?'':' disabled')+'>Reset</button>'
    + '<button type="button" class="chord-tool-edit" data-action="openChordEditor" aria-label="Edit chords" title="Edit chords">'+SVG.pen+'</button>'
    + '</div>';
  let shown = 0;
  verses.forEach((v, vi) => {
    if (shown >= chart.verses) return;
    const cls = Object.prototype.hasOwnProperty.call(vt, v.type) ? v.type : 'v';
    counts[cls] = (counts[cls]||0) + 1;
    const label = vt[cls]||'Verse';
    const total = verses.filter(x => (x.type||'v') === cls).length;
    const numStr = total > 1 ? ' ' + counts[cls] : '';
    const verseLines = (chart.verseLines && chart.verseLines[vi]) || chart.lines || [];
    html += '<div class="verse chord-verse '+cls+'" id="sv'+shown+'"><div class="verse-type '+cls+'">'+label+numStr+'</div>';
    (v.lines||[]).forEach((line, li) => {
      const specs = verseLines[li] !== undefined ? verseLines[li] : (chart.lines && chart.lines[li]);
      html += chordLineHTML(line, specs, chart, vi, li);
    });
    html += '</div>';
    shown++;
  });
  if (verses.length > shown) {
    html += '<div class="chord-note">Chords are charted for the first tune (verses 1–'+shown+'). Verses '+(shown+1)+'–'+verses.length+' use a second tune in the printed songbook.</div>';
  }
  return html + '</div>';
}

function chordEmptyHTML(tuneIdx) {
  const plus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const title = tuneIdx === 1 ? 'No chords for Tune 2 yet' : 'No chords yet';
  return '<div class="chord-empty fade-in">'
    + '<h2>'+title+'</h2>'
    + '<p>Add a chord chart to this song and it will appear above every lyric line.</p>'
    + '<ul class="chord-empty-list">'
    + '<li>Every chord sits over the word it lands on</li>'
    + '<li>Transpose without rewriting a line</li>'
    + '<li>The key chip plays the tonic so you can find the pitch</li>'
    + '</ul>'
    + '<button type="button" class="chord-add-btn" data-action="openChordEditor"><span class="chord-add-icon">'+plus+'</span><span>Add Chords</span></button>'
    + '</div>';
}

function songDetailParts(song) {
  const vt = {v:'Verse',c:'Chorus',b:'Bridge',p:'Reference',pc:'Pre-Chorus'};
  const vc = {v:0,c:0,b:0,p:0};
  // ponytail: a 'p' reference verse containing "Doh is" (often prefixed with
  // "Reference:") is the song's key/metre, shown under the title — skip rendering it.
  const isDohRef = v => (v.type||'v') === 'p' && v.lines.some(l => /\bdoh\s+is\b/i.test(l));
  let vh = '', vi = 0;
  (song.verses||[]).forEach(v => {
    if (isDohRef(v)) return;
    const cls = Object.prototype.hasOwnProperty.call(vt, v.type) ? v.type : 'v';
    vc[cls] = (vc[cls]||0) + 1;
    const label = vt[cls]||'Verse';
    const count = vc[cls];
    const total = (song.verses||[]).filter(x => (x.type||'v') === cls).length;
    const numStr = total > 1 ? ' ' + count : '';
    vh += '<div class="verse '+cls+' fade-in" id="sv'+(vi++)+'"><div class="verse-type '+cls+'">'+label+numStr+'</div><p>'+esc(v.lines.join('\n'))+'</p></div>';
  });
  // ponytail: long songs get a tap-to-jump verse strip under the header.
  let jump = '';
  if (vi > 8) {
    jump = '<div class="verse-jump" aria-label="Jump to verse">';
    for (let i = 0; i < vi; i++) jump += '<button type="button" class="vj" data-action="scrollToVerse" data-index="'+i+'">'+(i+1)+'</button>';
    jump += '</div>';
  }
  const meta = [];
  if (song.author) meta.push('<span>'+esc(song.author)+'</span>');
  let dohKey = song.key || '';
  // ponytail: a 'p' reference verse containing "Doh is" is the song's key/metre.
  const dohVerse = (song.verses||[]).find(v => (v.type||'v') === 'p' && v.lines.some(l => /\bdoh\s+is\b/i.test(l)));
  if (dohVerse) {
    const line = dohVerse.lines.find(l => /\bdoh\s+is\b/i.test(l));
    dohKey = line.replace(/^reference:\s*/i, '').trim();
  }
  if (dohKey) meta.push(keyMetaHTML(dohKey));
  const sharedSolfa = songsSharingSolfa(song);
  if (sharedSolfa.length) {
    const nums = sharedSolfa.slice(0, 4).map(s => s.number ? 'No. ' + s.number : s.title).join(', ');
    meta.push('<span class="same-tune">Same tune as '+esc(nums)+'</span>');
  }
  const bookKey = songBookKey(song) || currentCat;
  const bookLabel = song.catName || (bookKey ? bookName(bookKey) : '');
  const numBadge = song.number ? '<div class="song-number">'+esc(bookLabel ? bookLabel + ' - ' + song.number : 'No. ' + song.number)+'</div>' : '';
  const prev = currentList[currentSongIdx-1], next = currentList[currentSongIdx+1];
  const prevSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>';
  const nextSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
  const header = '<div class="song-detail-header fade-in'+(readerMode === 'chords' ? ' chord-header' : '')+(readerMode === 'solfa' ? ' solfa-header' : '')+'" data-song-id="'+escAttr(song.id)+'"><button class="song-nav-btn" '+(prev?'data-action="openSongNav" data-dir="prev"':'disabled')+'>'+prevSvg+'</button><div class="song-header-center">'+numBadge+'<h1>'+esc(song.title)+'</h1><div class="song-detail-meta">'+meta.join(' · ')+'</div></div><button class="song-nav-btn" '+(next?'data-action="openSongNav" data-dir="next"':'disabled')+'>'+nextSvg+'</button></div>';
  // ponytail: solfa mode replaces the lyric body with the engraved crop (header stays).
  if (readerMode === 'solfa' && hasSolfa(song)) {
    const same = songsSharingSolfa(song);
    const notes = [];
    if (song.solfaNote) notes.push(song.solfaNote);
    if (same.length) notes.push('Same tune as ' + same.map(s => s.number ? 'No. ' + s.number : s.title).join(', ') + '.');
    const note = notes.length ? '<div class="solfa-note">'+notes.map(esc).join('<br>')+'</div>' : '';
    const sheets = solfaSheets(song);
    const tuneIdx = solfaTuneIndex(song);
    const sv = sheets[tuneIdx].src;
    const sheet = '<div class="solfa-sheet fade-in"><img id="solfaSheetImg" src="'+escAttr(solfaDisplaySrc(sv))+'" data-sheet-src="'+escAttr(sv)+'" alt="Tonic solfa — '+escAttr(sheets[tuneIdx].label)+'" loading="eager" decoding="async" data-action="openSolfaZoom"></div>';
    return { header, body: '<div class="song-body">' + note + tuneTabsForSong(song, tuneIdx, 'setSolfaTune') + '<div class="view-content">' + sheet + '</div></div>' };
  }
  const chartTune = chordTuneIndex(song);
  const chart = chordChartFor(song, chartTune);
  if (readerMode === 'chords') {
    return { header, body: '<div class="song-body">' + tuneTabsForSong(song, chartTune, 'setChordTune') + '<div class="view-content">' + (chart ? chordSheetHTML(song, chart) : chordEmptyHTML(chartTune)) + '</div></div>' };
  }
  return { header, body: '<div class="song-body"><div class="view-content">' + jump + vh + '</div></div>' };
}
function songDetailHTML(song) {
  const parts = songDetailParts(song);
  return parts.header + parts.body;
}
// Animate only the swapped body; the title/header stays mounted.
function pulseReaderContent() {
  const content = document.querySelector('#songDetail .song-body > .view-content');
  if (!content) return;
  content.classList.remove('swap-in');
  void content.offsetWidth;
  content.classList.add('swap-in');
}

// ponytail: the song actions (edit / playlist / fav / share) live in the reader
// FOOTER, next to the sliders — never over the lyrics. Rebuilt per song so the
// fav icon reflects the current state.
// ponytail: all per-song actions live in the floating glass menu now (the reader
// footer keeps only the reading controls), so the lyrics get the whole width.
function readerMenuHTML(song) {
  if (!song) return '';
  const c = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+d+'</svg>';
  const editSvg = c('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>');
  const plusSvg = c('<path d="M12 5v14"/><path d="M5 12h14"/>');
  const heartOutline = c('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>');
  const heartFilled = '<svg viewBox="0 0 24 24" fill="var(--warm)" stroke="var(--warm)" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  const waSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
  const fav = isFav(song.id);
  const rows = [];
  const row = (action, icon, label) =>
    '<button type="button" class="fab-item" data-action="'+action+'" role="menuitem">'
    + '<span class="fi-label">'+label+'</span><span class="fi-ic">'+icon+'</span></button>';
  rows.push(row('edit', editSvg, 'Edit song'));
  rows.push(row('chords', c('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'), chordChartFor(song) ? 'Edit chords' : 'Add chords'));
  rows.push(row('playlist', plusSvg, 'Add to playlist'));
  rows.push(row('fav', fav ? heartFilled : heartOutline, fav ? 'Remove from favourites' : 'Add to favourites'));
  if (hasSolfa(song)) rows.push(row('solfa', c('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'), 'Share tonic solfa'));
  if (hasSolfa(song)) rows.push(row('solfadl', c('<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>'), 'Download tonic solfa'));
  rows.push(row('image', c('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'), 'Share as image'));
  rows.push(row('text', waSvg, 'Share as text'));
  // stagger from the item nearest the FAB upwards
  return rows.map((h, i) => h.replace('class="fab-item"', 'class="fab-item" data-i="'+(rows.length - 1 - i)+'"')).join('');
}
function renderReaderMenu(song) {
  const m = document.getElementById('waMenu');
  if (!m) return;
  const s = song || currentList[currentSongIdx];
  m.innerHTML = s ? readerMenuHTML(s) : '';
  if (!s) return;
  m.querySelectorAll('.fab-item').forEach(btn => btn.style.setProperty('--i', btn.dataset.i));
  m.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeWaMenu();
      switch (btn.dataset.action) {
        case 'edit': openEditModal(s.id); break;
        case 'chords': openChordEditor(); break;
        case 'playlist': _playlistModalSongId = s.id; openPlaylistChooser(s.id); break;
        case 'fav': toggleFav(s.id); renderReaderMenu(); break;
        case 'solfa': shareSolfaImage(); break;
        case 'solfadl': downloadSolfa(); break;
        case 'image': shareSongImage(); break;
        case 'text': shareWhatsAppText(); break;
      }
    });
  });
}

function scrollToVerse(i) {
  const el = document.getElementById('sv'+i);
  if (!el) return;
  const sc = document.getElementById('songScroll');
  if (!sc) return;
  // Scroll within the lyrics container only (never the document).
  const y = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 76;
  sc.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

// ─── KEY TONE ───
// ponytail: the key line is a button that plays the tonic chord of the key shown on
// screen. Pitch is equal-tempered from A4 = 440 Hz, so the reference is exact, and
// the key is re-read from the visible label on every click — editing a song's key
// changes the sound with it. The voice is synthesized piano (additive partials with
// string inharmonicity + a hammer transient), so it works offline with no audio files.
const _KEY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
function keyMetaHTML(key) {
  if (!parseKeyTone(key)) return '<span>Key: '+esc(key)+'</span>';
  return '<button type="button" class="key-play" data-key="'+escAttr(key)+'" data-action="playKeyTone" aria-label="Play the key '+escAttr(key)+'" title="Play the key">'
    + _KEY_ICON + 'Key: ' + esc(key) + '</button>';
}
const _KEY_PC = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
function parseKeyTone(text) {
  const s = String(text || '')
    .replace(/^\s*key\s*:?\s*/i, '')
    .replace(/^\s*doh\s+is\s*/i, '')
    .trim();
  const m = s.match(/^([A-Ga-g])\s*(#|b|flat|sharp)?/);
  if (!m) return null;
  let pc = _KEY_PC[m[1].toUpperCase()];
  const acc = (m[2] || '').toLowerCase();
  if (acc === '#' || acc === 'sharp') pc += 1;
  else if (acc === 'b' || acc === 'flat') pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  return { pc, minor: /\bminor\b/i.test(s) };
}
let _keyCtx = null, _keyIn = null, _keyNoiseBuf = null, _keyVoices = [];
function _keyAudio() {
  if (_keyCtx) { if (_keyCtx.state === 'suspended') _keyCtx.resume(); return _keyCtx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const bus = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 24; comp.ratio.value = 4;
  comp.attack.value = 0.004; comp.release.value = 0.25;
  // A hint of room: short low-passed feedback delay, wet signal kept low.
  const dly = ctx.createDelay(0.5); dly.delayTime.value = 0.085;
  const fb = ctx.createGain(); fb.gain.value = 0.22;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
  const wet = ctx.createGain(); wet.gain.value = 0.16;
  bus.connect(comp); comp.connect(ctx.destination);
  bus.connect(dly); dly.connect(lp); lp.connect(fb); fb.connect(dly); lp.connect(wet); wet.connect(comp);
  _keyCtx = ctx; _keyIn = bus;
  return ctx;
}
const _KEY_HARMONICS = [[1,1],[2,0.46],[3,0.24],[4,0.14],[5,0.085],[6,0.05],[7,0.03],[8,0.018]];
function _pianoNote(ctx, t0, midi, dur, vel) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t0);
  // Soft fade in (no click), a long body, then a smooth fade out to silence at `dur`.
  amp.gain.linearRampToValueAtTime(vel, t0 + 0.05);
  amp.gain.linearRampToValueAtTime(vel * 0.55, t0 + dur * 0.7);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  amp.connect(_keyIn);
  // Stretched-string inharmonicity keeps the upper partials from sounding like an organ.
  const B = 0.0004;
  _KEY_HARMONICS.forEach(([n, a], i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * n * Math.sqrt(1 + B * n * n), t0);
    if (i === 0) osc.detune.setValueAtTime(-1.5, t0); // gentle unison beating
    const g = ctx.createGain();
    const pd = dur / (1 + 0.22 * (n - 1));
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(a, t0 + 0.004);
    // Ease each partial down towards a low plateau (time constant scaled by pitch)
    // instead of an exponential dive — the master envelope closes the note at ~2s.
    g.gain.setTargetAtTime(a * 0.28, t0 + 0.05, pd * 0.6);
    osc.connect(g); g.connect(amp);
    osc.start(t0); osc.stop(t0 + pd + 0.03);
    _keyVoices.push(osc);
  });
  // Hammer transient: a very short filtered noise burst at the attack.
  if (!_keyNoiseBuf) {
    const len = Math.floor(ctx.sampleRate * 0.09);
    _keyNoiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = _keyNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
  const ns = ctx.createBufferSource(); ns.buffer = _keyNoiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = Math.min(5200, f * 3.2); bp.Q.value = 1.1;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.35, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
  ns.connect(bp); bp.connect(ng); ng.connect(amp);
  ns.start(t0); ns.stop(t0 + 0.09);
  _keyVoices.push(ns);
}
function playKeyTone(btn) {
  // Read the on-screen label, not a cached value, so the sound always matches
  // whatever key is currently displayed (including after an edit).
  const label = ((btn && btn.textContent) || (btn && btn.getAttribute('data-key')) || '').trim();
  const tone = parseKeyTone(label);
  if (!tone) {  return; }
  const ctx = _keyAudio();
  if (!ctx) {  return; }
  _keyVoices.forEach(v => { try { v.stop(); } catch (e) {} });
  _keyVoices = [];
  const root = 12 * 5 + tone.pc; // octave 4 (C4 = MIDI 60)
  const notes = [root, root + (tone.minor ? 3 : 4), root + 7, root + 12];
  const t0 = ctx.currentTime + 0.03;
  notes.forEach((midi, i) => _pianoNote(ctx, t0 + i * 0.03, midi, 2.2, i === 0 ? 0.2 : 0.15));
  if (btn) {
    btn.classList.add('playing');
    clearTimeout(btn._keyPulse);
    btn._keyPulse = setTimeout(() => btn.classList.remove('playing'), 1800);
  }
}

function chordSoundNotes(name) {
  const m = String(name || '').trim().match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return null;
  const rootPc = (CHORD_ROOT_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  let rest = m[3] || '';
  let bassPc = null;
  const slash = rest.match(/\/\s*([A-G])([#b]?)/);
  if (slash) {
    bassPc = (CHORD_ROOT_PC[slash[1]] + (slash[2] === '#' ? 1 : slash[2] === 'b' ? -1 : 0) + 12) % 12;
    rest = rest.slice(0, slash.index);
  }
  const q = rest.toLowerCase();
  let intervals;
  if (/dim|°|o/.test(q)) intervals = [0, 3, 6];
  else if (/aug|\+/.test(q)) intervals = [0, 4, 8];
  else if (/sus2/.test(q)) intervals = [0, 2, 7];
  else if (/sus/.test(q)) intervals = [0, 5, 7];
  else if (/^(m(?!aj)|min)/.test(q)) intervals = [0, 3, 7];
  else intervals = [0, 4, 7];
  if (/maj7|maj9|m7|min7|(^|[^a-z])7/.test(q)) intervals.push(/maj7|maj9/.test(q) ? 11 : 10);
  if (/6/.test(q) && !/7/.test(q)) intervals.push(9);
  const root = 60 + rootPc;
  const notes = intervals.map(i => root + i);
  if (bassPc != null) notes.unshift(48 + bassPc);
  return notes;
}
function playChordTone(btn) {
  const song = currentList[currentSongIdx];
  const chart = chordChartFor(song);
  const base = btn && btn.getAttribute('data-chord');
  const name = chart && base ? chordLabel(chart, base) : String((btn && btn.textContent) || base || '').trim();
  const notes = chordSoundNotes(name);
  if (!notes) {  return; }
  const ctx = _keyAudio();
  if (!ctx) {  return; }
  _keyVoices.forEach(v => { try { v.stop(); } catch (e) {} });
  _keyVoices = [];
  const t0 = ctx.currentTime + 0.025;
  notes.forEach((midi, i) => _pianoNote(ctx, t0 + i * 0.045, midi, 1.9, i === 0 ? 0.18 : 0.12));
  if (btn) {
    btn.classList.add('playing');
    clearTimeout(btn._chordPulse);
    btn._chordPulse = setTimeout(() => btn.classList.remove('playing'), 900);
  }
}

function positionChordReadLine(lineEl) {
  const song = currentList && currentList[currentSongIdx];
  const chart = song ? chordChartFor(song) : null;
  if (!chart) return;
  const vi = Number(lineEl.dataset.v) || 0;
  const li = Number(lineEl.dataset.l) || 0;
  lineEl.querySelectorAll('.chord-read').forEach(el => el.remove());
  (ceChartSpecs(chart, vi, li) || []).forEach(spec => {
    if (!spec || !spec.ch || !Number.isInteger(spec.pos)) return;
    const chEl = lineEl.querySelector('.ce-ch[data-i="' + spec.pos + '"]');
    if (!chEl) return;
    const word = ceWordFor(chEl);
    if (!word) return;
    const el = document.createElement('span');
    el.className = 'chord-name chord-read';
    el.dataset.chord = spec.ch;
    el.dataset.pos = String(spec.pos);
    el.textContent = chordLabel(chart, spec.ch);
    word.appendChild(el);
    const wr = word.getBoundingClientRect(), cr = chEl.getBoundingClientRect();
    el.style.left = (cr.left - wr.left) + 'px';
  });
}
let _chordPosObserver = null;
function layoutChordSheetPositions(root) {
  const host = root || document.getElementById('songDetail');
  if (!host) return;
  host.querySelectorAll('.chord-float[data-left]').forEach(el => {
    el.style.left = el.dataset.left + '%';
    el.style.transform = 'translateX(-' + el.dataset.shift + '%)';
  });
  const lines = host.querySelectorAll('.chord-line-pos');
  lines.forEach(positionChordReadLine);
  if (window.ResizeObserver) {
    if (_chordPosObserver) _chordPosObserver.disconnect();
    _chordPosObserver = new ResizeObserver(() => {
      if (_chordPosObserver._busy) return;
      _chordPosObserver._busy = true;
      requestAnimationFrame(() => {
        _chordPosObserver._busy = false;
        host.querySelectorAll('.chord-line-pos').forEach(positionChordReadLine);
      });
    });
    lines.forEach(el => _chordPosObserver.observe(el));
  }
}
/* ── guitar chord shapes + popup ──────────────────────────────────
   Shapes are searched, not hand-listed: for any chord name we look for voicings
   whose notes all belong to the chord, with the right bass note, then pick the
   lowest comfortable position. Every chord in a chart therefore gets a diagram. */
const GUITAR_STRING_PC = [4, 9, 2, 7, 11, 4];   // E A D G B E
const GUITAR_STRING_MIDI = [40, 45, 50, 55, 59, 64];
const GUITAR_INTERVALS = {
  '': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'maj7': [0, 4, 7, 11],
  'm7': [0, 3, 7, 10], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9], '9': [0, 4, 7, 10, 14],
  'maj9': [0, 4, 7, 11, 14], 'm9': [0, 3, 7, 10, 14], 'add9': [0, 4, 7, 14],
  'sus2': [0, 2, 7], 'sus4': [0, 5, 7], 'sus': [0, 5, 7], '7sus4': [0, 5, 7, 10],
  'dim': [0, 3, 6], 'dim7': [0, 3, 6, 9], 'm7b5': [0, 3, 6, 10],
  'aug': [0, 4, 8], '5': [0, 7]
};
const _guitarShapeCache = new Map();
let _guitarVoices = [];
let _guitarLast = null;
let _chordPop = null;
function guitarIntervals(quality) {
  const q = String(quality || '')
    .toLowerCase().replace(/\s+/g, '')
    .replace(/^major/, '').replace(/^minor/, 'm').replace(/^min/, 'm').replace(/^maj/, 'maj')
    .replace(/^°/, 'dim').replace(/^\+/, 'aug').replace(/^ø/, 'm7b5');
  return GUITAR_INTERVALS[q] || GUITAR_INTERVALS[''];
}
function guitarParseChord(name) {
  const m = String(name || '').trim().match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return null;
  const rootPc = chordRootPc(m[1].toUpperCase() + m[2]);
  if (rootPc == null) return null;
  let rest = m[3] || '';
  let bassPc = null;
  const slash = rest.match(/\/\s*([A-Ga-g])([#b]?)/);
  if (slash) { bassPc = chordRootPc(slash[1].toUpperCase() + slash[2]); rest = rest.slice(0, slash.index); }
  return { rootPc: rootPc, bassPc: bassPc, quality: rest };
}
function guitarShapeFor(name) {
  const key = String(name || '').trim();
  if (_guitarShapeCache.has(key)) return _guitarShapeCache.get(key);
  const parsed = guitarParseChord(key);
  const shape = parsed ? guitarSearch(parsed.rootPc, guitarIntervals(parsed.quality), parsed.bassPc) : null;
  _guitarShapeCache.set(key, shape);
  return shape;
}
function guitarSearch(rootPc, intervals, bassPc) {
  const tones = [...new Set(intervals.map(i => (rootPc + i) % 12))];
  const toneSet = new Set(tones);
  const targetBass = bassPc == null ? rootPc : bassPc;
  const third = tones.includes((rootPc + 4) % 12) ? (rootPc + 4) % 12 : (rootPc + 3) % 12;
  const seventh = [10, 11, 9, 5, 2].map(s => (rootPc + s) % 12).find(pc => toneSet.has(pc) && pc !== third);
  const core = new Set([rootPc]);
  if (toneSet.has(third)) core.add(third);
  if (seventh != null) core.add(seventh);
  const requiredSets = [new Set(tones), core];
  for (const minStrings of [4, 3]) {
    for (const required of requiredSets) {
      let best = null;
      for (let base = 0; base <= 11; base++) {
        const opts = [];
        for (let s = 0; s < 6; s++) {
          const list = [-1];
          for (let f = base; f <= base + 4 && f <= 15; f++) {
            if (f === 0 && base > 0) continue;
            const pc = (GUITAR_STRING_PC[s] + f) % 12;
            // the bass string may carry a slash bass that is not a chord tone
            if (toneSet.has(pc) || pc === targetBass) list.push(f);
          }
          opts.push(list);
        }
        const frets = new Array(6).fill(-1);
        const walk = s => {
          if (s === 6) { consider(base, frets); return; }
          const list = opts[s];
          for (let i = 0; i < list.length; i++) { frets[s] = list[i]; walk(s + 1); }
        };
        walk(0);
      }
      if (best) return best;
      function consider(base, frets) {
        const sounding = [];
        let muted = 0;
        for (let s = 0; s < 6; s++) { if (frets[s] < 0) muted++; else sounding.push(s); }
        if (sounding.length < minStrings) return;
        const first = sounding[0];
        if (((GUITAR_STRING_PC[first] + frets[first]) % 12) !== targetBass) return;
        const pcs = new Set();
        let minF = Infinity, maxF = 0, openCount = 0;
        for (const s of sounding) {
          const f = frets[s];
          const pc = (GUITAR_STRING_PC[s] + f) % 12;
          if (!toneSet.has(pc) && !(s === first && pc === targetBass)) return;
          pcs.add(pc);
          if (f === 0) openCount++;
          else { if (f < minF) minF = f; if (f > maxF) maxF = f; }
        }
        for (const pc of required) if (!pcs.has(pc)) return;
        if (maxF && maxF - minF > 4) return;
        const score = base * 4 + muted * 3 - sounding.length * 2 - openCount * 2 + (first > 1 ? 1 : 0);
        if (!best || score < best.score) {
          best = {
            frets: frets.slice(), base: base, score: score,
            sounding: sounding,
            midi: sounding.map(s => GUITAR_STRING_MIDI[s] + frets[s]),
            span: maxF ? maxF - minF : 0
          };
        }
      }
    }
  }
  return null;
}
function guitarBarres(shape) {
  const byFret = new Map();
  shape.frets.forEach((f, s) => {
    if (f <= 0) return;
    if (!byFret.has(f)) byFret.set(f, []);
    byFret.get(f).push(s);
  });
  const out = [];
  byFret.forEach((strings, fret) => {
    strings.sort((a, b) => a - b);
    let start = strings[0], prev = strings[0];
    for (let i = 1; i <= strings.length; i++) {
      const cur = strings[i];
      if (cur === prev + 1) { prev = cur; continue; }
      if (prev > start) out.push({ fret: fret, from: start, to: prev });
      start = prev = cur;
    }
  });
  return out;
}
function guitarDiagramHTML(shape, name) {
  if (!shape) return '<div class="chord-pop-empty">No standard guitar shape for this chord.</div>';
  const W = 208, H = 196, L = 34, R = W - 22, T = 30, B = H - 22;
  const dx = (R - L) / 5, dy = (B - T) / 5;
  const px = s => L + s * dx;
  const py = f => T + (f - shape.base + 0.5) * dy;
  const barres = guitarBarres(shape);
  const inBarre = (s, f) => barres.some(b => b.fret === f && s >= b.from && s <= b.to);
  const round = n => (Math.round(n * 10) / 10);
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + escAttr(name + ' guitar chord diagram') + '">';
  if (shape.base === 0) {
    svg += '<rect class="gcd-nut" x="' + (L - 2) + '" y="' + (T - 4) + '" width="' + (R - L + 4) + '" height="6" rx="3"/>';
  } else {
    svg += '<text class="gcd-fretnum" x="' + (L - 12) + '" y="' + round(T + dy / 2 + 4) + '" text-anchor="end">' + (shape.base + 1) + '</text>';
  }
  for (let s = 0; s < 6; s++) svg += '<line class="gcd-string" x1="' + round(px(s)) + '" y1="' + T + '" x2="' + round(px(s)) + '" y2="' + B + '"/>';
  for (let f = 0; f <= 5; f++) svg += '<line class="gcd-fret" x1="' + L + '" y1="' + round(T + f * dy) + '" x2="' + R + '" y2="' + round(T + f * dy) + '"/>';
  barres.forEach(b => {
    const yy = py(b.fret);
    svg += '<rect class="gcd-barre" x="' + round(px(b.from) - 8) + '" y="' + round(yy - 7) + '" width="' + round(px(b.to) - px(b.from) + 16) + '" height="14" rx="7"/>';
  });
  shape.frets.forEach((f, s) => {
    const xx = px(s);
    if (f < 0) { svg += '<text class="gcd-mark" x="' + round(xx) + '" y="' + (T - 12) + '" text-anchor="middle">\u00d7</text>'; return; }
    if (f === 0) { svg += '<circle class="gcd-open" cx="' + round(xx) + '" cy="' + (T - 15) + '" r="5"/>'; return; }
    if (inBarre(s, f)) return;
    svg += '<circle class="gcd-dot" cx="' + round(xx) + '" cy="' + round(py(f)) + '" r="8"/>';
  });
  return svg + '</svg>';
}
function _guitarPluck(ctx, t0, midi, dur, vel) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const n = Math.max(2, Math.round(sr / f));
  const ring = new Float32Array(n);
  for (let i = 0; i < n; i++) ring[i] = Math.random() * 2 - 1;
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx];
    const nxt = ring[(idx + 1) % n];
    data[i] = cur;
    ring[idx] = 0.996 * 0.5 * (cur + nxt);
    idx = (idx + 1) % n;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = Math.min(6200, f * 10);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(lp); lp.connect(g); g.connect(_keyIn);
  src.start(t0); src.stop(t0 + dur);
  _guitarVoices.push(src);
}
function playGuitarNotes(notes, label) {
  const ctx = _keyAudio();
  if (!ctx) return false;
  _keyVoices.forEach(v => { try { v.stop(); } catch (e) {} });
  _keyVoices = [];
  _guitarVoices.forEach(v => { try { v.stop(); } catch (e) {} });
  _guitarVoices = [];
  const t0 = ctx.currentTime + 0.03;
  notes.forEach((midi, i) => _guitarPluck(ctx, t0 + i * 0.03, midi, 2.6, i === 0 ? 0.22 : 0.16));
  _guitarLast = { name: label, midi: notes.slice(), at: Date.now() };
  return true;
}
function positionChordPop(btn) {
  const pop = document.getElementById('chordPop');
  if (!pop || pop.hidden) return;
  if (window.matchMedia('(max-width:640px)').matches) { pop.style.left = ''; pop.style.top = ''; pop.style.transformOrigin = '50% 100%'; return; }
  const r = btn.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = r.left + r.width / 2 - pr.width / 2;
  left = Math.max(10, Math.min(vw - pr.width - 10, left));
  let top = r.bottom + 10;
  if (top + pr.height > vh - 10) top = Math.max(10, r.top - pr.height - 10);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  // start the zoom at the pill that was clicked
  pop.style.transformOrigin = (r.left + r.width / 2 - left) + 'px ' + (r.top + r.height / 2 - top) + 'px';
}
function openChordShape(btn) {
  if (!btn) return;
  const pop = document.getElementById('chordPop');
  if (_chordPop && _chordPop.btn === btn && pop && !pop.hidden) { closeChordPop(); return; }
  const name = String(btn.textContent || '').trim() || btn.dataset.chord || '';
  const shape = guitarShapeFor(name);
  _chordPop = { name: name, shape: shape, btn: btn };
  document.getElementById('chordPopName').textContent = name;
  document.getElementById('chordPopDiagram').innerHTML = guitarDiagramHTML(shape, name);
  document.getElementById('chordPopBackdrop').hidden = false;
  pop.hidden = false;
  pop.classList.remove('in');
  positionChordPop(btn);
  void pop.offsetWidth;
  pop.classList.add('in');
  const play = document.getElementById('chordPopPlay');
  if (play) { play.disabled = !shape; play.classList.remove('playing'); }
}
function closeChordPop() {
  _chordPop = null;
  const pop = document.getElementById('chordPop');
  if (pop) { pop.hidden = true; pop.classList.remove('in'); }
  const back = document.getElementById('chordPopBackdrop');
  if (back) back.hidden = true;
}
function playChordPop() {
  if (!_chordPop || !_chordPop.shape) {  return; }
  if (!playGuitarNotes(_chordPop.shape.midi, _chordPop.name)) {  return; }
  const btn = document.getElementById('chordPopPlay');
  if (btn) {
    btn.classList.add('playing');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => btn.classList.remove('playing'), 950);
  }
}
window.addEventListener('resize', () => { if (_chordPop && _chordPop.btn) positionChordPop(_chordPop.btn); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const pop = document.getElementById('chordPop');
  if (pop && !pop.hidden) { e.stopImmediatePropagation(); closeChordPop(); }
}, true);

function renderSongDetail(song, dir, keepHeader) {
  closeChordPop();
  const el = document.getElementById('songDetail');
  el.classList.toggle('lyrics-mode', readerMode === 'lyrics');
  const tuneFrom = _tunePillFrom;
  _tunePillFrom = null;
  const parts = songDetailParts(song);
  const header = el.querySelector('.song-detail-header');
  if (keepHeader && !dir && header && el.dataset.songId === song.id) {
    header.classList.toggle('chord-header', readerMode === 'chords');
    header.classList.toggle('solfa-header', readerMode === 'solfa');
    const body = el.querySelector('.song-body');
    if (body) body.outerHTML = parts.body;
    else el.insertAdjacentHTML('beforeend', parts.body);
    pulseReaderContent();
  } else {
    el.dataset.songId = song.id;
    el.innerHTML = parts.header + parts.body;
  }
  const tuneSwitch = el.querySelector('.solfa-tunes');
  if (tuneSwitch) {
    const tuneTo = Number(tuneSwitch.dataset.tuneIdx) || 0;
    tuneSwitch.style.setProperty('--tune-idx', String(tuneTo));
    if (tuneFrom != null) {
      // paint the band where the old view left it, then slide it to the new tune
      syncTuneSwitch(tuneSwitch, false);
      requestAnimationFrame(() => {
        tuneSwitch.style.setProperty('--tune-idx', String(tuneTo));
        syncTuneSwitch(tuneSwitch, true);
      });
    } else {
      requestAnimationFrame(() => syncTuneSwitch(tuneSwitch, false));
    }
  }
  if (readerMode === 'chords') layoutChordSheetPositions(el);
  // ponytail: reflect the open song in the tab title.
  document.title = (song.title || 'Song') + ' – Khristian Labu';
  // ponytail: gallery-style slide when arriving via swipe/arrow nav.
  if (dir === 'next' || dir === 'prev') {
    el.classList.remove('slide-next', 'slide-prev');
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add(dir === 'next' ? 'slide-next' : 'slide-prev');
  }
  // A new song starts from the saved size; readerZoomFont only leads it mid-pinch.
  if (_readerZoomSongId !== song.id) { _readerZoomSongId = song.id; readerZoomFont = readerFont; }
  el.style.setProperty('--reader-font', readerZoomFont+'px');
  el.style.setProperty('--reader-lh', readerLH);
  // ponytail: the FOOTER is a separate in-flow element below the lyrics scroll area
  // (#songScroll): sliders + the song actions. Because it sits outside the scroll
  // container, lyrics physically cannot pass behind it — the container clips at the
  // footer's top edge.
  // Every song has a Chords view. Songs without a chart show the Add Chords
  // invitation; solfa stays conditional because not every song has a sheet.
  const viewList = [['lyrics', 'Lyrics']].concat(hasSolfa(song) ? [['solfa', 'Solfa']] : []).concat([['chords', 'Chords']]);
  const viewIdx = _readerViewIndex(readerMode, song);
  const pillFrom = _viewPillFrom;
  _viewPillFrom = null;
  const solfaSwitch = '<div class="solfa-switch" role="group" aria-label="Song view" data-view-n="' + viewList.length + '" data-view-idx="' + (pillFrom == null ? viewIdx : pillFrom) + '">'
    + '<span class="view-pill" aria-hidden="true"></span>'
    + viewList.map(v => '<button type="button" class="view-tab' + (readerMode === v[0] ? ' active' : '') + '" data-action="setReaderMode" data-mode="' + v[0] + '">' + v[1] + '</button>').join('')
    + '</div>';
  const solfaBar = '<div class="solfa-bar">' + solfaSwitch + '</div>';
  document.getElementById('readerControlsHost').innerHTML = solfaBar;
  const viewSwitch = document.querySelector('#readerControlsHost .solfa-switch');
  if (viewSwitch) {
    viewSwitch.style.setProperty('--view-n', String(viewList.length));
    viewSwitch.style.setProperty('--view-idx', String(pillFrom == null ? viewIdx : pillFrom));
  }
  // The switch is rebuilt on every mode change, so start the band where it was and
  // send it to the new tab after the first paint; fade the body that replaced the
  // old mode so the swap reads as one movement.
  if (pillFrom != null && pillFrom !== viewIdx) {
    const sw = document.querySelector('#readerControlsHost .solfa-switch');
    if (sw) requestAnimationFrame(() => sw.style.setProperty('--view-idx', viewIdx));
  }
  renderReaderMenu(song);
  syncFooterHeight(); // measure the footer so the floating menu sits above it
  // ponytail: openSong clears the saved position, so every song starts at the top;
  // explicit restores (solfa zoom) still flow through _songScroll.
  const scrollEl = document.getElementById('songScroll');
  const saved = _songScroll[song.id];
  if (dir || saved == null) scrollEl.scrollTo({top:0,behavior:'smooth'});
  else requestAnimationFrame(() => scrollEl.scrollTop = saved);
  // ponytail: keep the scroll lock in sync (fits-on-screen songs can't scroll).
  scheduleReaderControlsCheck();
}

// ponytail: full-screen solfa sheet. Close with the X, a click on the dark
// backdrop, Escape, or Android hardware back — never leave a blank reader behind.
let _solfaZoomReturn = null;
let _solfaZoomCleanup = null;
function openSolfaZoom(src) {
  src = safeSolfaSrc(src);
  if (!src) return;
  let z = document.getElementById('solfaZoom');
  if (!z) {
    z = document.createElement('div');
    z.id = 'solfaZoom'; z.className = 'solfa-zoom';
    z.setAttribute('role', 'dialog');
    z.setAttribute('aria-modal', 'true');
    z.setAttribute('aria-label', 'Tonic solfa');
    document.body.appendChild(z);
  }
  if (_solfaZoomCleanup) { _solfaZoomCleanup(); _solfaZoomCleanup = null; }
  const sc = document.getElementById('songScroll');
  _solfaZoomReturn = sc ? sc.scrollTop : null;
  z.innerHTML = '<button type="button" class="solfa-zoom-close" aria-label="Close" data-action="closeSolfaZoom">&times;</button>'
    + '<div class="solfa-zoom-stage"><img src="'+escAttr(solfaDisplaySrc(src))+'" data-sheet-src="'+escAttr(src)+'" alt="Tonic solfa" draggable="false"></div>';
  upgradeSolfaSheet(src);
  const stage = z.querySelector('.solfa-zoom-stage');
  const img = z.querySelector('img');
  const st = { scale: 1, x: 0, y: 0, pointers: new Map(), gesture: null, moved: false, downAt: 0, lastTap: 0, lastTapX: 0, lastTapY: 0 };

  function contentBox() {
    const cs = getComputedStyle(stage);
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
    const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const w = Math.max(1, stage.clientWidth - pl - pr);
    const h = Math.max(1, stage.clientHeight - pt - pb);
    return { w: w, h: h, cx: pl + w / 2, cy: pt + h / 2 };
  }
  function clampPan() {
    const b = contentBox();
    const mx = Math.max(0, (img.offsetWidth * st.scale - b.w) / 2);
    const my = Math.max(0, (img.offsetHeight * st.scale - b.h) / 2);
    st.x = Math.max(-mx, Math.min(mx, st.x));
    st.y = Math.max(-my, Math.min(my, st.y));
  }
  function paint(animate) {
    img.style.transition = animate ? 'transform .2s cubic-bezier(.22,.61,.36,1)' : 'none';
    img.style.transform = 'translate3d(' + st.x + 'px,' + st.y + 'px,0) scale(' + st.scale + ')';
    stage.classList.toggle('is-dragging', st.pointers.size > 0);
  }
  // Zoom around a screen point, keeping that point under the finger/cursor.
  function zoomAt(px, py, nextScale, animate) {
    const rect = stage.getBoundingClientRect(), b = contentBox();
    const target = Math.max(1, Math.min(5, nextScale));
    const contentX = (px - rect.left - b.cx - st.x) / st.scale;
    const contentY = (py - rect.top - b.cy - st.y) / st.scale;
    st.scale = target;
    st.x = (px - rect.left - b.cx) - contentX * target;
    st.y = (py - rect.top - b.cy) - contentY * target;
    clampPan();
    paint(animate);
  }
  function beginGesture() {
    const pts = Array.from(st.pointers.values());
    if (!pts.length) { st.gesture = null; return; }
    if (pts.length === 1) {
      st.gesture = { type: 'pan', sx: pts[0].x, sy: pts[0].y, tx: st.x, ty: st.y };
      return;
    }
    const a = pts[0], b = pts[1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rect = stage.getBoundingClientRect(), box = contentBox();
    st.gesture = {
      type: 'pinch', dist: dist, scale: st.scale,
      contentX: (mid.x - rect.left - box.cx - st.x) / st.scale,
      contentY: (mid.y - rect.top - box.cy - st.y) / st.scale
    };
  }
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pointers.size === 1) { st.moved = false; st.downAt = Date.now(); }
    else st.moved = true;
    beginGesture();
  });
  stage.addEventListener('pointermove', e => {
    const p = st.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    const g = st.gesture;
    if (!g) return;
    if (g.type === 'pan' && st.pointers.size === 1) {
      const dx = p.x - g.sx, dy = p.y - g.sy;
      if (Math.hypot(dx, dy) > 5) st.moved = true;
      st.x = g.tx + dx; st.y = g.ty + dy;
      clampPan(); paint(false);
      return;
    }
    if (g.type === 'pinch' && st.pointers.size >= 2) {
      const pts = Array.from(st.pointers.values());
      const a = pts[0], b = pts[1];
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = stage.getBoundingClientRect(), box = contentBox();
      const next = Math.max(1, Math.min(5, g.scale * (dist / g.dist)));
      st.scale = next;
      st.x = (mid.x - rect.left - box.cx) - g.contentX * next;
      st.y = (mid.y - rect.top - box.cy) - g.contentY * next;
      clampPan(); paint(false);
    }
  });
  function endPointer(e) {
    if (!st.pointers.has(e.pointerId)) return;
    const p = st.pointers.get(e.pointerId);
    const wasSingle = st.pointers.size === 1;
    st.pointers.delete(e.pointerId);
    try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
    if (wasSingle && e.type === 'pointerup' && !st.moved && Date.now() - st.downAt < 360) {
      const now = Date.now();
      if (now - st.lastTap < 330 && Math.hypot(p.x - st.lastTapX, p.y - st.lastTapY) < 34) {
        zoomAt(p.x, p.y, st.scale > 1.05 ? 1 : 2.5, true);
        st.lastTap = 0;
      } else {
        st.lastTap = now; st.lastTapX = p.x; st.lastTapY = p.y;
      }
    }
    if (st.pointers.size === 1) beginGesture();
    else if (st.pointers.size === 0) { st.gesture = null; clampPan(); paint(true); }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  // Desktop trackpads and mice: wheel zooms toward the cursor, same as a pinch.
  const onWheel = e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, st.scale * Math.exp(-e.deltaY * 0.0018), true);
  };
  const onResize = () => { clampPan(); paint(false); };
  stage.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', onResize);
  img.addEventListener('load', () => { clampPan(); paint(false); });
  _solfaZoomCleanup = () => {
    window.removeEventListener('resize', onResize);
    stage.removeEventListener('wheel', onWheel);
  };
  z.classList.add('open');
  document.documentElement.classList.add('scroll-locked');
  if (sc) sc.classList.add('scroll-locked');
  requestAnimationFrame(() => { clampPan(); paint(false); });
}
function closeSolfaZoom() {
  const z = document.getElementById('solfaZoom');
  if (_solfaZoomCleanup) { _solfaZoomCleanup(); _solfaZoomCleanup = null; }
  if (z) z.classList.remove('open');
  document.documentElement.classList.remove('scroll-locked');
  const sc = document.getElementById('songScroll');
  if (sc) {
    sc.classList.remove('scroll-locked');
    if (_solfaZoomReturn != null) sc.scrollTop = _solfaZoomReturn;
    // ponytail: some browsers drop the decoded 4k-tall AVIF while the overlay is
    // open, leaving a blank paper card — repaint the reader on close.
    if (currentView === 'detail' && currentList[currentSongIdx] && readerMode === 'solfa') {
      const song = currentList[currentSongIdx];
      // tell the re-render where to restore to (it reads _songScroll)
      _songScroll[song.id] = _solfaZoomReturn != null ? _solfaZoomReturn : 0;
      requestAnimationFrame(() => renderSongDetail(song));
    }
  }
  _solfaZoomReturn = null;
}
// Escape closes the zoom first, before any other Escape handler.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const z = document.getElementById('solfaZoom');
  if (z && z.classList.contains('open')) {
    e.preventDefault(); e.stopPropagation();
    closeSolfaZoom();
  }
}, true);
// Left/right arrows move to the previous/next song in the reader.
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (currentView !== 'detail' || !currentList.length) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const z = document.getElementById('solfaZoom');
  if (z && z.classList.contains('open')) return;
  if (document.querySelector('.modal-overlay.open, #searchBox.active, #sidebarModal.open')) return;
  const idx = currentSongIdx + (e.key === 'ArrowRight' ? 1 : -1);
  if (!currentList[idx]) return;
  e.preventDefault();
  openSong(currentList[idx], e.key === 'ArrowRight' ? 'next' : 'prev');
});

// ponytail: switch between the lyric view and the engraved tonic-solfa sheet.
function setReaderMode(mode) {
  const song = currentList[currentSongIdx];
  if (!song) return;
  const sw = document.querySelector('#readerControlsHost .solfa-switch');
  // remember where the band sits, so the rebuilt switch can slide from there
  _viewPillFrom = sw ? (Number(sw.style.getPropertyValue('--view-idx')) || 0) : null;
  const nextMode = mode === 'solfa' && hasSolfa(song) ? 'solfa'
    : mode === 'chords' ? 'chords'
    : 'lyrics';
  if (nextMode !== readerMode) haptic(8);
  readerMode = nextMode;
  _songScroll[song.id] = 0; // each view starts at the top
  renderSongDetail(song, undefined, true);
  if (nextMode === 'solfa') warmSolfaHd(song);
}

// Index of a reader mode inside the Lyrics / Solfa / Chords switch.
function _readerViewIndex(mode, song) {
  const canShowSolfa = hasSolfa(song);
  if (mode === 'solfa' && canShowSolfa) return 1;
  if (mode === 'chords') return canShowSolfa ? 2 : 1;
  return 0;
}

// ponytail: rebuild the floating menu (fav label/state) without a full song
// re-render, which would reset the reader scroll.
function refreshReaderActions() { renderReaderMenu(); }

// ponytail: which songbook a song belongs to, for share text (".cat" is only set on
// favorites / recents / playlist copies of a song).
function songBookKey(song) {
  if (!song) return null;
  if (song.cat && SONGS[song.cat]) return song.cat;
  return CAT_ORDER.find(k => SONGS[k] && (SONGS[k].songs || []).some(s => s.id === song.id)) || null;
}
// ponytail: build a plain-text copy of a song (title + songbook/number + verses), used
// by copy/share. Skip the 'p' Doh reference verse — it is shown as the Key line instead.
function songToText(id) {
  const song = currentList.find(s => s.id === id);
  if (!song) return '';
  const lines = [song.title || ''];
  const book = songBookKey(song);
  const sub = [book ? bookName(book) : '', song.number ? 'No. ' + song.number : ''].filter(Boolean).join(' · ');
  if (sub) lines.push(sub);
  if (song.key) lines.push('Key: ' + song.key);
  (song.verses || []).forEach(v => {
    if ((v.type || 'v') === 'p' && (v.lines || []).some(l => /\bdoh\s+is\b/i.test(l))) return;
    const indent = (v.type === 'c' || v.type === 'b') ? '    ' : '';
    const label = (v.type === 'c') ? '[Chorus]\n' : (v.type === 'b') ? '[Bridge]\n' : (v.type === 'pc') ? '[Pre-Chorus]\n' : '';
    lines.push(label + (v.lines || []).map(l => indent + l).join('\n'));
  });
  return lines.join('\n\n');
}

async function shareSong(id) {
  const song = currentList.find(s => s.id === id);
  const text = songToText(id);
  const shareData = { title: song ? (song.title || 'Song') : 'Song', text, dialogTitle: 'Share song' };
  // ponytail: native Capacitor Share opens the Android sheet; fall back to web share, then clipboard.
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
  if (cap && cap.share) {
    try { await cap.share(shareData); return; } catch (_) {}
  }
  if (navigator.share) {
    try { await navigator.share(shareData); return; } catch (_) {}
  }
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text);  return; }
    catch (e) {}
  }
}

// ─── SEARCH ───
// ponytail: precompute normalized fields once (after load) so every keystroke scan
// avoids re-normalizing the whole corpus — the single biggest search speedup.
// Normalization folds case, strips diacritics (â ê î ô û) and apostrophes, so
// typing "mihingte" finds "Mihingte'" and "mihingte" alike.
function normText(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’`]/g, '').toLowerCase();
}
let SONG_BY_ID = {};
function buildSearchIndex() {
  SONG_BY_ID = {};
  Object.keys(SONGS).forEach(k => {
    const list = SONGS[k] && SONGS[k].songs;
    if (!list) return;
    list.forEach(song => {
      // ponytail: keep title/author separately normalized so relevance can rank a
      // title hit above an author or lyric hit without re-normalizing per keystroke.
      song._lt = normText(song.title);
      song._la = normText(song.author);
      song._l = normText((song.title||'')+' '+(song.author||'')+' '+(song.key||'')+' '+(song.number||''));
      song._ll = song.verses ? song.verses.map(v => normText((v.lines||[]).join('\n'))) : [];
      SONG_BY_ID[song.id] = { song, key: k, catName: SONGS[k].info.name };
    });
  });
}
let searchTimeout;
// Search matches every field. The visible filter is the songbook scope, so the
// old Title/Lyrics/Author/Number chips are intentionally gone.
let searchFilter = 'all';
let searchSort = 'relevance'; // relevance | number | alpha | recent
let searchHistory = readJSON('labu_search_history', [], Array.isArray).filter(x => typeof x === 'string');
// Live search holds the query in memory while its results are on screen; it is
// committed to Recent Searches only when the user is done with it (clear/close/
// Enter/open result) so no keystroke prefix is ever stored.
let pendingSearchQuery = '';
// searchBook is the selected filter; searchScopedBook is set when the modal was
// opened from a songbook list/reader, which locks search to that book.
let searchBook = 'all';
let searchHomeBook = 'all';
let searchScopedBook = null;
function searchBookKeys() {
  return enabledBookKeys().filter(key => SONGS[key] && SONGS[key].songs);
}
function searchContextBook() {
  if (!currentCat || !searchBookKeys().includes(currentCat)) return null;
  if (currentView === 'list' && currentListKind === 'cat') return currentCat;
  if (currentView === 'detail') {
    if (currentListKind === 'cat') return currentCat;
    if (currentListKind === 'search' && searchScopedBook === currentCat) return currentCat;
  }
  return null;
}
const SEARCH_SORT_LABELS = { relevance: 'Relevance', number: 'Number', alpha: 'A–Z', recent: 'Recent' };
function closeSearchMenus() {
  ['searchBookMenu', 'searchSortMenu'].forEach(id => {
    const menu = document.getElementById(id);
    if (menu) menu.hidden = true;
  });
  ['searchBookFilterWrap', 'searchSortBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}
function renderSearchBookMenu() {
  const menu = document.getElementById('searchBookMenu');
  if (!menu) return;
  const item = (value, label, active) =>
    '<button type="button" class="search-menu-item' + (active ? ' active' : '') + '" role="option" aria-selected="' + (active ? 'true' : 'false') + '" data-action="pickSearchBook" data-book="' + escAttr(value) + '">' +
      '<span>' + esc(label) + '</span>' + (active ? '<span class="search-menu-check" aria-hidden="true">✓</span>' : '') +
    '</button>';
  let html = '<div class="search-menu-label">Search in</div>';
  html += item('all', 'All songbooks', searchBook === 'all');
  enabledGroups().forEach(group => {
    const books = (group.books || []).filter(key => SONGS[key] && SONGS[key].songs);
    if (!books.length) return;
    html += '<div class="search-menu-group">' + esc(group.name || 'Songbooks') + '</div>';
    books.forEach(key => { html += item(key, bookName(key), searchBook === key); });
  });
  menu.innerHTML = html;
}
function renderSearchSortMenu() {
  const menu = document.getElementById('searchSortMenu');
  if (!menu) return;
  menu.innerHTML = Object.entries(SEARCH_SORT_LABELS).map(([value, label]) =>
    '<button type="button" class="search-menu-item' + (searchSort === value ? ' active' : '') + '" role="option" aria-selected="' + (searchSort === value ? 'true' : 'false') + '" data-action="pickSearchSort" data-sort="' + value + '">' +
      '<span>' + label + '</span>' + (searchSort === value ? '<span class="search-menu-check" aria-hidden="true">✓</span>' : '') +
    '</button>'
  ).join('');
}
function toggleSearchBookMenu() {
  const menu = document.getElementById('searchBookMenu');
  const btn = document.getElementById('searchBookFilterWrap');
  if (!menu || !btn) return;
  const willOpen = menu.hidden;
  closeSearchMenus();
  if (!willOpen) return;
  renderSearchBookMenu();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
}
function toggleSearchSortMenu() {
  const menu = document.getElementById('searchSortMenu');
  const btn = document.getElementById('searchSortBtn');
  if (!menu || !btn) return;
  const willOpen = menu.hidden;
  closeSearchMenus();
  if (!willOpen) return;
  renderSearchSortMenu();
  menu.hidden = false;
  menu.style.right = 'auto';
  const toolbar = btn.closest('.search-modal-toolbar');
  if (toolbar) {
    const left = Math.min(btn.offsetLeft, toolbar.clientWidth - menu.offsetWidth - 12);
    menu.style.left = Math.max(12, left) + 'px';
  }
  btn.setAttribute('aria-expanded', 'true');
}
function pickSearchBook(el) {
  setSearchBookFilter(el.dataset.book || 'all');
  closeSearchMenus();
  document.getElementById('searchBookFilterWrap')?.focus();
}
function pickSearchSort(el) {
  setSearchSort(el.dataset.sort || 'relevance');
  closeSearchMenus();
  document.getElementById('searchSortBtn')?.focus();
}
function renderSearchBookFilter() {
  const wrap = document.getElementById('searchBookFilterWrap');
  const label = document.getElementById('searchBookFilterLabel');
  const pill = document.getElementById('searchScopePill');
  if (!wrap || !label || !pill) return;
  if (searchScopedBook) {
    wrap.hidden = true;
    pill.hidden = false;
    pill.textContent = bookName(searchScopedBook);
    pill.title = 'Searching in ' + bookName(searchScopedBook);
    closeSearchMenus();
    return;
  }
  wrap.hidden = false;
  pill.hidden = true;
  if (searchBook !== 'all' && !searchBookKeys().includes(searchBook)) searchBook = 'all';
  label.textContent = searchBook === 'all' ? 'All songbooks' : bookName(searchBook);
}
async function openSearchModal() {
  await ensureSongs();
  const scope = searchContextBook();
  searchScopedBook = scope;
  if (scope) searchBook = scope;
  else {
    searchBook = searchHomeBook;
    if (searchBook !== 'all' && !searchBookKeys().includes(searchBook)) searchBook = 'all';
  }
  closeSearchMenus();
  renderSearchBookFilter();
  const sortLabel = document.getElementById('searchSortLabel');
  if (sortLabel) sortLabel.textContent = SEARCH_SORT_LABELS[searchSort] || 'Relevance';
  const input = document.getElementById('searchModalInput');
  const clear = document.getElementById('searchModalClear');
  if (clear) clear.classList.toggle('show', !!(input && input.value.trim()));
  openModal('searchModal');
  if (input && input.value.trim()) doSearch(input.value);
  else renderRecentSearch();
  setTimeout(() => {
    const field = document.getElementById('searchModalInput');
    if (!field) return;
    field.focus();
    field.select();
  }, 90);
}
function closeSearchModal() {
  const modal = document.getElementById('searchModal');
  if (!modal || !modal.classList.contains('open')) return;
  commitSearchHistory();
  clearTimeout(searchTimeout);
  if (!searchScopedBook) searchHomeBook = searchBook;
  closeSearchMenus();
  closeModal('searchModal');
}
function onSearch(q) {
  const input = document.getElementById('searchModalInput');
  if (input && input.value !== q) input.value = q;
  const clear = document.getElementById('searchModalClear');
  if (clear) clear.classList.toggle('show', !!q);
  clearTimeout(searchTimeout);
  // Search-as-you-type: a short debounce keeps one scan per burst while results
  // update within a keystroke or two.
  searchTimeout = setTimeout(() => doSearch(q), 110);
}
// Enter commits immediately (and records the query now instead of on idle).
function submitSearch(input) {
  if (!input) return;
  clearTimeout(searchTimeout);
  doSearch(input.value);
  if (input.value.trim()) pushSearchHistory(input.value);
  pendingSearchQuery = '';
  input.blur();
}
function commitSearchHistory() {
  if (!pendingSearchQuery) return;
  pushSearchHistory(pendingSearchQuery);
  pendingSearchQuery = '';
}
function currentSearchQuery() {
  const input = document.getElementById('searchModalInput');
  return input ? input.value.trim() : '';
}
function setSearchSort(s) {
  searchSort = ['relevance', 'number', 'alpha', 'recent'].includes(s) ? s : 'relevance';
  const label = document.getElementById('searchSortLabel');
  if (label) label.textContent = SEARCH_SORT_LABELS[searchSort] || 'Relevance';
  doSearch(currentSearchQuery());
}
function setSearchBookFilter(value) {
  if (searchScopedBook) return;
  searchBook = value && value !== 'all' && searchBookKeys().includes(value) ? value : 'all';
  searchHomeBook = searchBook;
  renderSearchBookFilter();
  doSearch(currentSearchQuery());
}
function pushSearchHistory(q) {
  q = q.trim();
  if (!q) return;
  searchHistory = searchHistory.filter(x => x !== q);
  searchHistory.unshift(q);
  if (searchHistory.length > 8) searchHistory = searchHistory.slice(0, 8);
  localStorage.setItem('labu_search_history', JSON.stringify(searchHistory));
}
function runRecentSearch(q) {
  const input = document.getElementById('searchModalInput');
  if (input) input.value = q;
  onSearch(q);
  if (input) input.focus();
}

// Rank title first (exact → prefix → word start → contains), then author, number,
// key and finally lyrics. Ties keep book order because Array.sort is stable.
function matchSong(song, key, catName, q) {
  const title = song._lt || '';
  const author = song._la || '';
  const titleHit = title.includes(q);
  const authorHit = author.includes(q);
  const keyHit = normText(song.key).includes(q);
  const numHit = (song.number || '').includes(q);
  if (searchFilter === 'title' && !titleHit) return null;
  if (searchFilter === 'author' && !authorHit) return null;
  if (searchFilter === 'number' && !numHit) return null;
  if (searchFilter !== 'lyrics') {
    if (searchFilter === 'title') {
      const score = title === q ? 0 : (title.startsWith(q) ? 1 : ((' ' + title).includes(' ' + q) ? 2 : 3));
      return { ...song, cat: key, catName, matchField: 'title', matchLabel: 'Title', _score: score };
    }
    if (searchFilter === 'author') {
      return { ...song, cat: key, catName, matchField: 'title', matchLabel: 'Author', _score: author.startsWith(q) ? 4 : 5 };
    }
    if (searchFilter === 'number') {
      return { ...song, cat: key, catName, matchField: 'title', matchLabel: 'Number', _score: 6 };
    }
    if (titleHit || authorHit || keyHit || numHit) {
      let score = 7, label = 'Key';
      if (titleHit) { score = title === q ? 0 : (title.startsWith(q) ? 1 : ((' ' + title).includes(' ' + q) ? 2 : 3)); label = 'Title'; }
      else if (authorHit) { score = author.startsWith(q) ? 4 : 5; label = 'Author'; }
      else if (numHit) { score = 6; label = 'Number'; }
      return { ...song, cat: key, catName, matchField: 'title', matchLabel: label, _score: score };
    }
  }
  if (song._ll && song._ll.length) {
    for (let vi = 0; vi < song._ll.length; vi++) {
      if (song._ll[vi].indexOf(q) === -1) continue;
      const verse = song.verses[vi] || {};
      const vtype = SEARCH_VERSE_LABELS[verse.type || 'v'] || 'Verse';
      const vlabel = vtype + ((verse.type || 'v') === 'v' ? ' ' + (vi + 1) : '');
      const allLines = verse.lines || [];
      const li = allLines.findIndex(l => normText(l).includes(q));
      const start = Math.max(0, li - 1);
      const end = Math.min(allLines.length, li + 3);
      const context = allLines.slice(start, end).join('\n');
      return { ...song, cat: key, catName, matchField: 'verse', matchLabel: vlabel, snippet: context, _score: 10 };
    }
  }
  return null;
}
const SEARCH_VERSE_LABELS = { v: 'Verse', c: 'Chorus', b: 'Bridge', p: 'Reference', pc: 'Pre-Chorus' };async function doSearch(q) {
  await ensureSongs();
  // ponytail: keep the raw query for display/highlight/history, normalized for matching.
  q = (q || '').trim();
  const rawQ = q;
  q = normText(q);
  const el = document.getElementById('searchResults');
  if (!el) return;
  const count = document.getElementById('searchResultCount');
  if (!q) { commitSearchHistory(); renderRecentSearch(); return; }
  const scope = searchScopedBook && searchBookKeys().includes(searchScopedBook)
    ? searchScopedBook
    : (searchBook !== 'all' && searchBookKeys().includes(searchBook) ? searchBook : null);
  const books = scope ? [scope] : searchBookKeys();
  const results = [];
  books.forEach(key => {
    const book = SONGS[key];
    if (!book || !book.songs) return;
    book.songs.forEach(song => {
      const r = matchSong(song, key, book.info.name, q);
      if (r) results.push(r);
    });
  });
  if (searchSort === 'number') results.sort((a, b) => (parseInt(a.number)||0) - (parseInt(b.number)||0));
  else if (searchSort === 'alpha') results.sort((a, b) => (a.title||'').localeCompare(b.title||'', undefined, {sensitivity:'base'}));
  else if (searchSort === 'recent') { const ri = id => recents.indexOf(id); results.sort((a, b) => (ri(a.id)>=0?ri(a.id):1e9) - (ri(b.id)>=0?ri(b.id):1e9)); }
  else results.sort((a, b) => a._score - b._score);
  // Only a query that actually matched is worth remembering; the commit happens
  // when the user closes the popup, presses Enter, or opens a result.
  pendingSearchQuery = results.length ? rawQ : '';
  if (count) count.textContent = results.length.toLocaleString() + ' found';
  // ponytail: cap DOM nodes to the first 100 matches so the grid paints instantly
  // even when a query matches thousands of songs.
  const RENDER_CAP = 100;
  const shown = results.slice(0, RENDER_CAP);
  const moreNote = results.length > shown.length
    ? '<div class="si-more">Showing first '+shown.length+' of '+results.length.toLocaleString()+' matches — refine your search to narrow down.</div>' : '';
  el.innerHTML = '';
  if (!results.length) {
    el.innerHTML = '<div class="no-results"><div class="icon">'+SVG.search+'</div><p>No songs match your search.<br>Try a title, a lyric, an author, or a number.</p></div>';
    el.scrollTop = 0;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'song-grid';
  shown.forEach((song, i) => {
    const item = document.createElement('div');
    item.className = 'song-item search-item fade-in';
    item.style.animationDelay = Math.min(i*0.02,0.5)+'s';
    item.onclick = () => {
      closeSearchModal();
      currentCat = song.cat;
      currentList = SONGS[song.cat].songs;
      currentListKind = 'search';
      openSong(song);
    };
    const meta = [song.author, song.catName].filter(Boolean).join(' • ');
    const num = song.number ? '#'+song.number : '';
    const snippet = song.snippet
      ? '<div class="si-snippet">'+hl(song.snippet, rawQ)+'</div>'
      : '';
    const badges = [song.catName, song.key ? 'Key: '+song.key : ''].filter(Boolean)
      .map(b => '<span class="si-badge">'+esc(b)+'</span>').join('');
    const match = song.matchLabel ? '<div class="si-match">Matched in '+esc(song.matchLabel)+'</div>' : '';
    item.innerHTML =
      '<div class="si-top"><span class="si-num">'+esc(num)+'</span><span class="si-title">'+hl(song.title, rawQ)+'</span></div>'+
      '<div class="si-meta">'+hl(meta, rawQ)+'</div>'+
      snippet + (badges ? '<div class="si-badges">'+badges+'</div>' : '') + match;
    grid.appendChild(item);
  });
  el.appendChild(grid);
  if (moreNote) el.insertAdjacentHTML('beforeend', moreNote);
  el.scrollTop = 0;
}

// ponytail: empty search shows recent queries as tappable chips.
function clearSearchHistory() {
  searchHistory = [];
  pendingSearchQuery = '';
  localStorage.removeItem('labu_search_history');
  renderRecentSearch();
}
function renderRecentSearch() {
  const el = document.getElementById('searchResults');
  if (!el) return;
  const count = document.getElementById('searchResultCount');
  if (count) count.textContent = '';
  if (!searchHistory.length) {
    el.innerHTML = '<div class="no-results"><div class="icon">'+SVG.search+'</div><p>Search songs by title, lyrics, author, or number</p></div>';
    el.scrollTop = 0;
    return;
  }
  const chips = searchHistory.map(h => '<button type="button" class="si-rec" data-q="'+escAttr(h)+'">'+esc(h)+'</button>').join('');
  el.innerHTML = '<div class="song-list-header si-rec-head"><h2>Recent Searches</h2><button class="si-clear-hist" data-action="clearSearchHistory">Clear</button></div><div class="si-recent">'+chips+'</div>';
  el.querySelectorAll('.si-rec').forEach(btn => { btn.onclick = () => runRecentSearch(btn.dataset.q || ''); });
  el.scrollTop = 0;
}

// ─── THEME ───
function applyTheme() {
  const mode = localStorage.getItem('labu-theme') || 'system';
  let isLight;
  if (mode === 'system') {
    isLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  } else {
    isLight = mode === 'light';
  }
  document.documentElement.setAttribute('data-theme', isLight ? 'light' : '');
  applyAccent(localStorage.getItem('labu-accent') || 'madder');
  updateThemeButtons(mode);
  applyStatusBar(isLight);
}

// ponytail: the native Android status bar follows the app theme. Content is kept
// below the bar (setOverlaysWebView(false) — no-op on Android 15+, where edge-to-
// edge is enforced), the bar's background matches the theme, and icons stay readable.
// On Android 15/16 the WebView may not report env(safe-area-inset-top) at all, so we
// also set --sat-fallback from the plugin's getInfo().height — the CSS then uses the
// max of env(), Capacitor's injected --safe-area-inset-top, and this fallback.
function applyStatusBar(isLight) {
  const SB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
  if (!SB) return; // web build / test stub
  SB.setOverlaysWebView({ overlay: false }).catch(() => {});
  SB.setBackgroundColor({ color: isLight ? '#F2F5FB' : '#090A10' }).catch(() => {});
  SB.setStyle({ style: isLight ? 'DARK' : 'LIGHT' }).catch(() => {});
  syncStatusBarFallback();
  setTimeout(syncStatusBarFallback, 400); // re-check once layout settles
}

// Guaranteed status-bar height: the plugin measures it natively. Apply it as extra
// top padding only when Capacitor's own injected --safe-area-inset-top isn't present
// (the WebView isn't reporting insets — exactly the broken Android 15/16 case). max()
// in CSS means this can never double-pad when env()/--safe-area-inset-top do work.
function syncStatusBarFallback() {
  const SB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
  if (!SB || !SB.getInfo) return;
  SB.getInfo().then(info => {
    const h = info && typeof info.height === 'number' ? info.height : 0;
    // Check Capacitor's injected var (not the computed padding) to avoid a feedback
    // loop where applying the fallback makes the next check skip it.
    const injected = getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top').trim();
    const injectedPx = parseFloat(injected) || 0;
    if (h > 0 && injectedPx <= 0) {
      document.documentElement.style.setProperty('--sat-fallback', h + 'px');
    } else {
      document.documentElement.style.removeProperty('--sat-fallback');
    }
  }).catch(() => {});
}
window.addEventListener('resize', syncStatusBarFallback);

function setTheme(mode) {
  localStorage.setItem('labu-theme', mode);
  applyTheme();
  renderGroups();
  renderSidebarGroups();
}

function syncSegmented(id, idx) {
  const seg = document.getElementById(id);
  if (!seg) return;
  const btns = [...seg.querySelectorAll('.seg-btn')];
  if (!btns.length) return;
  idx = Math.max(0, Math.min(idx, btns.length - 1));
  seg.style.setProperty('--seg-n', btns.length);
  seg.style.setProperty('--seg-idx', idx);
  btns.forEach((b, i) => b.classList.toggle('active', i === idx));
}
function updateThemeButtons(active) {
  syncSegmented('themeOptions', ['light','dark','system'].indexOf(active));
}
// Fourteen dyes. The chosen one becomes --band, so it drives the tab rail, primary
// buttons, switches, sliders, chips and the floating block — not just a highlight.
// Each has a deeper partner for the paper theme, where the dye sits on cream.
const ACCENTS = [
  { id:'madder',  name:'Madder',  swatch:'#CF4A32', dark:'#CF4A32', light:'#A8392A' },
  { id:'rust',    name:'Rust',    swatch:'#A85A2E', dark:'#A85A2E', light:'#7C3F1E' },
  { id:'clay',    name:'Clay',    swatch:'#B4765A', dark:'#B4765A', light:'#8A563E' },
  { id:'rose',    name:'Rose',    swatch:'#C75B6A', dark:'#C75B6A', light:'#9B3D4B' },
  { id:'plum',    name:'Plum',    swatch:'#9A5B7A', dark:'#9A5B7A', light:'#6F3D57' },
  { id:'brass',   name:'Brass',   swatch:'#C9A227', dark:'#C9A227', light:'#8A6A0C' },
  { id:'saffron', name:'Saffron', swatch:'#D98F2B', dark:'#D98F2B', light:'#9A6414' },
  { id:'olive',   name:'Olive',   swatch:'#7D8F3E', dark:'#7D8F3E', light:'#5A6828' },
  { id:'pine',    name:'Pine',    swatch:'#4E8A68', dark:'#4E8A68', light:'#33634A' },
  { id:'forest',  name:'Forest',  swatch:'#3F7A4E', dark:'#3F7A4E', light:'#2C5B38' },
  { id:'teal',    name:'Teal',    swatch:'#3E9B94', dark:'#3E9B94', light:'#2A6F6A' },
  { id:'lagoon',  name:'Lagoon',  swatch:'#2F8FA8', dark:'#2F8FA8', light:'#1F6A7D' },
  { id:'indigo',  name:'Indigo',  swatch:'#5B7FC0', dark:'#5B7FC0', light:'#3E5C96' },
  { id:'cobalt',  name:'Cobalt',  swatch:'#3F63B5', dark:'#3F63B5', light:'#2C4A8C' },
];
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
function _rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function _swatchInk(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 155 ? '#0B1020' : '#FFFFFF';
}
// Relative luminance and a contrast pick, so a light dye (Brass) gets dark ink on
// its fill and a deep dye (Madder) keeps bone ink — both above 4.5:1.
function _lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  return .2126 * f((n >> 16) & 255) + .7152 * f((n >> 8) & 255) + .0722 * f(n & 255);
}
function _contrast(a, b) {
  const hi = Math.max(_lum(a), _lum(b)), lo = Math.min(_lum(a), _lum(b));
  return (hi + .05) / (lo + .05);
}
function _bandInk(deep) {
  return _contrast(deep, '#FBF4E8') >= _contrast(deep, '#150E02') ? '#FBF4E8' : '#150E02';
}
// Mix a hex toward black or white; used to derive the dye's deep and bright tones.
function _mix(hex, target, p) {
  const n = parseInt(hex.slice(1), 16);
  const t = target === '#000' ? 0 : 255;
  const ch = s => Math.round((((n >> s) & 255) * (1 - p)) + t * p);
  return '#' + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1).toUpperCase();
}
function renderAccentSwatches() {
  const row = document.getElementById('accentRow');
  if (!row) return;
  row.innerHTML = ACCENTS.map(a =>
    '<button type="button" class="accent-swatch" data-accent="' + a.id + '" data-swatch="' + a.swatch + '" data-ink="' + _swatchInk(a.swatch) + '" data-action="setAccent" aria-label="' + a.name + ' accent" aria-pressed="false" title="' + a.name + '">' + CHECK_SVG + '</button>'
  ).join('');
  row.querySelectorAll('.accent-swatch').forEach(btn => {
    btn.style.setProperty('--sw', btn.dataset.swatch);
    btn.style.setProperty('--sw-ink', btn.dataset.ink);
  });
  // Stored ids from before the Puan palette (white, sunset, …) fall back to Madder.
  const stored = localStorage.getItem('labu-accent') || 'madder';
  const applied = applyAccent(stored);
  if (applied !== stored) localStorage.setItem('labu-accent', applied);
}
function applyAccent(name) {
  const accent = ACCENTS.find(a => a.id === name) || ACCENTS[0];
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  const color = light ? accent.light : accent.dark;
  let deep = _mix(color, '#000', light ? .12 : .18);
  // Some dyes (Teal) land mid-tone, where neither ink reaches 4.5:1. Darken just
  // enough for one of them to pass, rather than shifting the whole palette.
  for (let i = 0; i < 8 && Math.max(_contrast(deep, '#FBF4E8'), _contrast(deep, '#150E02')) < 4.5; i++) {
    deep = _mix(deep, '#000', .08);
  }
  const bright = _mix(color, '#fff', light ? .10 : .12);
  const ink = light ? _mix(color, '#000', .28) : _mix(color, '#fff', .46);
  const root = document.documentElement.style;
  // The band is the app's identity colour: recolour it and every woven detail
  // (rail, primary buttons, switches, sliders, chips, floating block) follows.
  root.setProperty('--band', color);
  root.setProperty('--band-deep', deep);
  root.setProperty('--band-bright', bright);
  root.setProperty('--band-ink', _bandInk(deep));
  root.setProperty('--band-wash', _rgba(color, light ? .10 : .13));
  // Legacy accent tokens still colour the logo, stats and a few older surfaces.
  root.setProperty('--accent', deep);
  root.setProperty('--accent2', color);
  root.setProperty('--accent-ink', ink);
  root.setProperty('--accent-glow', _rgba(color, light ? .10 : .14));
  root.setProperty('--select-soft', _rgba(color, light ? .10 : .13));
  root.setProperty('--select-rim', _rgba(color, light ? .26 : .38));
  root.setProperty('--select-glow', _rgba(color, light ? .07 : .10));
  const row = document.getElementById('accentRow');
  if (row) {
    row.querySelectorAll('.accent-swatch').forEach(btn => {
      const on = btn.dataset.accent === accent.id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  const label = document.getElementById('accentName');
  if (label) label.textContent = accent.name;
  return accent.id;
}
function setAccent(name) {
  const chosen = applyAccent(name);
  localStorage.setItem('labu-accent', chosen);
}

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if ((localStorage.getItem('labu-theme') || 'system') === 'system') applyTheme();
});

// Admin account lives in Settings; Manage Songs is only the song editor.
const ADMIN_OWNER_EMAIL = 'minatolun@gmail.com';
const ADMIN_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>';
const ADMIN_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
const ADMIN_USER_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';
const ADMIN_SIGNOUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
const ADMIN_SYNC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><polyline points="3 21 3 16 8 16"/><polyline points="21 3 21 8 16 8"/></svg>';
const ADMIN_USERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
const ADMIN_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
function cloudCanCreateAdmin() {
  const session = cloudSession();
  const user = (session && session.user) || {};
  if (user.canCreateAdmin === true || user.isOwner === true) return true;
  const email = String((session && session.email) || user.email || '').toLowerCase();
  return email === ADMIN_OWNER_EMAIL;
}
async function renderAdminAccount() {
  const box = document.getElementById('adminAccountBody');
  if (!box) return;
  if (!CLOUD_ON) {
    box.innerHTML = '<div class="glass-card settings-panel"><div class="sc-head"><span class="sc-ic">' + ADMIN_SHIELD + '</span><span>Admin account</span></div><p class="admin-account-note">Admin access unavailable.</p></div>';
    return;
  }
  let session = cloudSession();
  if (!session) {
    // Checking the session is a network round trip; paint feedback first so the
    // page never looks frozen while the cookie is validated.
    box.innerHTML = '<div class="glass-card settings-panel">'
      + '<div class="sc-head"><span class="sc-ic">' + ADMIN_SHIELD + '</span><span>Admin account</span></div>'
      + '<div class="admin-account-loading"><span class="btn-spinner" aria-hidden="true"></span><span>Checking sign-in…</span></div>'
      + '</div>';
    await cloudRestoreSession();
    session = cloudSession();
  }
  if (!session || !(await cloudCheckAdmin())) {
    box.innerHTML = '<div class="glass-card settings-panel">'
      + '<div class="sc-head"><span class="sc-ic">' + ADMIN_SHIELD + '</span><span>Admin sign in</span></div>'
      + '<div class="form-group"><label for="adminAccountLogin">Email or username</label><input type="text" id="adminAccountLogin" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you@example.com or @username"></div>'
      + '<div class="form-group"><label for="adminAccountPass">Password</label><input type="password" id="adminAccountPass" autocomplete="current-password" data-enter-action="adminAccountSignIn"></div>'
      + '<div id="adminAccountErr" class="cloud-err" role="alert"></div>'
      + '<button class="btn btn-primary btn-block" id="adminAccountSignInBtn" data-action="adminAccountSignIn">Sign in</button>'
      + '</div>';
    return;
  }

  const user = session.user || {};
  const login = user.login || session.login || user.email || session.email || '';
  const owner = cloudCanCreateAdmin();
  box.innerHTML = '<div class="glass-card settings-panel admin-account-card">'
    + '<div class="admin-account-head">'
    + '<div class="admin-account-identity"><span class="admin-account-email">' + esc(login) + '</span><span class="admin-account-badge">' + (owner ? 'Main admin' : 'Admin') + '</span></div>'
    + '<div class="admin-account-tools" role="group" aria-label="Admin account actions">'
    + '<button class="admin-icon-btn" type="button" data-action="openAdminPasswordModal" aria-label="Change your password" title="Change your password">' + ADMIN_LOCK + '</button>'
    + (owner ? '<button class="admin-icon-btn" type="button" data-action="openAdminAddAdminModal" aria-label="Add another admin" title="Add another admin">' + ADMIN_USER_PLUS + '</button>' : '')
    + (owner ? '<button class="admin-icon-btn" type="button" data-action="openAdminManageModal" aria-label="Manage admins" title="Manage admins">' + ADMIN_USERS + '</button>' : '')
    + '<button class="admin-icon-btn admin-icon-btn-out" type="button" data-action="adminAccountSignOut" aria-label="Sign out" title="Sign out">' + ADMIN_SIGNOUT + '</button>'
    + '</div></div></div>'
    + '<div id="adminAccountMsg" class="admin-account-ok" role="status"></div>'
    + '<div class="glass-card settings-panel admin-sync-card">'
    + '<div class="sc-head"><span class="sc-ic">' + ADMIN_SYNC + '</span><span>Song sync</span></div>'
    + '<div id="cloudPanel" class="cloud-panel admin-cloud-panel"></div>'
    + '</div>';
  await renderCloudPanel();
}
function openAdminPasswordModal() {
  ['adminCurrentPass', 'adminNewPass', 'adminConfirmPass'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const err = document.getElementById('adminChangeErr');
  if (err) err.textContent = '';
  openModal('adminPasswordModal');
  setTimeout(() => document.getElementById('adminCurrentPass')?.focus(), 80);
}
function openAdminAddAdminModal() {
  ['adminAddName', 'adminAddUsername', 'adminAddEmail', 'adminAddPass', 'adminAddConfirm'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const err = document.getElementById('adminAddErr');
  if (err) err.textContent = '';
  openModal('adminAddAdminModal');
  setTimeout(() => document.getElementById('adminAddName')?.focus(), 80);
}
function showAdminAccountMsg(text) {
  const el = document.getElementById('adminAccountMsg');
  if (!el) return;
  el.textContent = text;
  clearTimeout(el._msgTimer);
  el._msgTimer = setTimeout(() => { if (el.isConnected) el.textContent = ''; }, 5000);
}
function renderSyncHistory() {
  const list = document.getElementById('syncHistoryList');
  if (!list) return;
  const edits = (PUB.edits || [])
    .filter(row => row && row.payload && Number.isFinite(Number(row.seq)))
    .slice()
    .sort((a, b) => Number(b.seq) - Number(a.seq))
    .slice(0, 50);
  if (!edits.length) {
    list.innerHTML = '<div class="sync-history-empty">No synced changes yet. Approved edits will appear here.</div>';
    return;
  }
  list.innerHTML = edits.map(row => {
    const when = row.published_at ? cloudAgo(row.published_at) : '';
    const meta = ['Published', when, '#' + Number(row.seq)].filter(Boolean).join(' · ');
    return '<div class="sync-history-item"><span class="sync-history-dot" aria-hidden="true"></span>'
      + '<div class="sync-history-main"><div class="sync-history-title">' + esc(cloudDescribe(row.kind, row.payload)) + '</div>'
      + '<div class="sync-history-meta">' + esc(meta) + '</div></div></div>';
  }).join('');
}
function openSyncHistory() {
  renderSyncHistory();
  openModal('syncHistoryModal');
  cloudLoadLayer().then(() => {
    const modal = document.getElementById('syncHistoryModal');
    if (modal && modal.classList.contains('open')) renderSyncHistory();
  }).catch(() => {});
}
function openAdminAccount(push) {
  showView('adminAccount');
  renderAdminAccount();
  if (push !== false) navPush();
  window.scrollTo(0, 0);
}
async function adminAccountSignIn() {
  const input = document.getElementById('adminAccountLogin');
  const passInput = document.getElementById('adminAccountPass');
  const err = document.getElementById('adminAccountErr');
  const btn = document.getElementById('adminAccountSignInBtn');
  await cloudSignInWith(input ? input.value.trim() : '', passInput ? passInput.value : '', err, btn, passInput, async () => {
    await renderAdminAccount();
  });
}
async function adminAccountSignOut() {
  const btn = document.querySelector('#adminAccountBody [data-action="adminAccountSignOut"]');
  setAdminIconBusy(btn, true);
  try {
    await cloudSignOut();
  } finally {
    if (btn && btn.isConnected) setAdminIconBusy(btn, false);
  }
}
async function adminChangePassword() {
  const current = document.getElementById('adminCurrentPass').value;
  const next = document.getElementById('adminNewPass').value;
  const confirm = document.getElementById('adminConfirmPass').value;
  const err = document.getElementById('adminChangeErr');
  const btn = document.getElementById('adminChangeBtn');
  err.textContent = '';
  if (!current || !next) { err.textContent = 'Current and new passwords are required'; return; }
  if (next.length < 12 || next.length > 128) { err.textContent = 'New password must be 12-128 characters'; return; }
  if (next !== confirm) { err.textContent = 'New passwords do not match'; return; }
  setCloudButtonBusy(btn, true, 'Updating…');
  try {
    await cloudReq('/api/auth/change-password', {
      body: { currentPassword: current, newPassword: next, revokeOtherSessions: true },
    });
    document.getElementById('adminCurrentPass').value = '';
    document.getElementById('adminNewPass').value = '';
    document.getElementById('adminConfirmPass').value = '';
    setCloudButtonBusy(btn, false);
    closeModal('adminPasswordModal');
    showAdminAccountMsg('Password updated.');
  } catch (e) {
    setCloudButtonBusy(btn, false);
    err.textContent = cloudErrorText(e);
  }
}
async function adminAddAdmin() {
  const name = document.getElementById('adminAddName').value.trim();
  const username = document.getElementById('adminAddUsername').value.trim();
  const email = document.getElementById('adminAddEmail').value.trim().toLowerCase();
  const pass = document.getElementById('adminAddPass').value;
  const confirm = document.getElementById('adminAddConfirm').value;
  const err = document.getElementById('adminAddErr');
  const btn = document.getElementById('adminCreateAdminBtn');
  err.textContent = '';
  if (!username && !email) { err.textContent = 'Enter a username or an email'; return; }
  if (username && !/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(username)) {
    err.textContent = 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore';
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter a valid email address'; return; }
  if (pass.length < 12 || pass.length > 128) { err.textContent = 'Password must be 12-128 characters'; return; }
  if (pass !== confirm) { err.textContent = 'Passwords do not match'; return; }
  setCloudButtonBusy(btn, true, 'Creating…');
  try {
    const d = await cloudReq('/api/admin/users', { body: { name: name, username: username, email: email, password: pass } });
    document.getElementById('adminAddName').value = '';
    document.getElementById('adminAddUsername').value = '';
    document.getElementById('adminAddEmail').value = '';
    document.getElementById('adminAddPass').value = '';
    document.getElementById('adminAddConfirm').value = '';
    setCloudButtonBusy(btn, false);
    closeModal('adminAddAdminModal');
    showAdminAccountMsg('Admin account created for ' + ((d && d.login) || email || '@' + username) + '.');
  } catch (e) {
    setCloudButtonBusy(btn, false);
    err.textContent = cloudErrorText(e);
  }
}

// ─── Main admin: manage the other admin accounts ───
let adminDirectory = null;
let adminPassTarget = null;

function setAdminIconBusy(btn, busy) {
  if (!btn) return;
  if (busy) {
    if (btn.dataset.idleHtml === undefined) btn.dataset.idleHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
  } else {
    btn.disabled = false;
    btn.classList.remove('is-busy');
    btn.removeAttribute('aria-busy');
    if (btn.dataset.idleHtml !== undefined) btn.innerHTML = btn.dataset.idleHtml;
  }
}
function adminRowHTML(a) {
  const label = a.login || a.email || '';
  const name = a.name || label;
  const initial = esc(String(name).replace(/^@/, '').slice(0, 1).toUpperCase() || 'A');
  const badge = a.isOwner
    ? '<span class="admin-badge-owner">Main admin</span>'
    : (a.isSelf ? '<span class="admin-badge-self">You</span>' : '');
  return '<div class="admin-row">'
    + '<span class="admin-row-avatar" aria-hidden="true">' + initial + '</span>'
    + '<div class="admin-row-main"><div class="admin-row-name">' + esc(name) + badge + '</div>'
    + '<div class="admin-row-login">' + esc(label) + '</div></div>'
    + '<div class="admin-row-tools">'
    + (a.isOwner ? '' : '<button class="admin-icon-btn" type="button" data-action="adminOpenSetPass" data-user-id="' + escAttr(a.id) + '" aria-label="Set password for ' + escAttr(label) + '" title="Set password">' + ADMIN_LOCK + '</button>')
    + (a.isOwner ? '' : '<button class="admin-icon-btn admin-icon-btn-out" type="button" data-action="adminDeleteUser" data-user-id="' + escAttr(a.id) + '" aria-label="Remove ' + escAttr(label) + '" title="Remove admin">' + ADMIN_TRASH + '</button>')
    + '</div></div>';
}
function renderAdminDirectory() {
  const list = document.getElementById('adminManageList');
  if (!list) return;
  const admins = adminDirectory || [];
  list.innerHTML = admins.length
    ? admins.map(adminRowHTML).join('')
    : '<div class="admin-manage-empty">No admin accounts found.</div>';
}
function openAdminManageModal() {
  const list = document.getElementById('adminManageList');
  const err = document.getElementById('adminManageErr');
  if (err) err.textContent = '';
  if (list) list.innerHTML = '<div class="admin-account-loading"><span class="btn-spinner" aria-hidden="true"></span><span>Loading admins…</span></div>';
  openModal('adminManageModal');
  loadAdminDirectory();
}
async function loadAdminDirectory() {
  const list = document.getElementById('adminManageList');
  const err = document.getElementById('adminManageErr');
  try {
    const d = await cloudReq('/api/admin/users');
    adminDirectory = (d && d.admins) || [];
    if (err) err.textContent = '';
    renderAdminDirectory();
  } catch (e) {
    adminDirectory = null;
    if (list) list.innerHTML = '';
    if (err) err.textContent = cloudErrorText(e);
  }
}
function openAdminSetPass(userId) {
  const target = (adminDirectory || []).find(a => a.id === userId);
  if (!target) return;
  adminPassTarget = target;
  const who = document.getElementById('adminSetPassWho');
  if (who) who.textContent = target.login || target.email || '';
  ['adminSetPassNew', 'adminSetPassConfirm'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const err = document.getElementById('adminSetPassErr');
  if (err) err.textContent = '';
  openModal('adminSetPassModal');
  setTimeout(() => document.getElementById('adminSetPassNew')?.focus(), 80);
}
async function adminSetOtherPassword() {
  if (!adminPassTarget) return;
  const passInput = document.getElementById('adminSetPassNew');
  const confirmInput = document.getElementById('adminSetPassConfirm');
  const next = passInput ? passInput.value : '';
  const confirm = confirmInput ? confirmInput.value : '';
  const err = document.getElementById('adminSetPassErr');
  const btn = document.getElementById('adminSetPassBtn');
  if (err) err.textContent = '';
  if (next.length < 12 || next.length > 128) { if (err) err.textContent = 'Password must be 12-128 characters'; return; }
  if (next !== confirm) { if (err) err.textContent = 'Passwords do not match'; return; }
  const target = adminPassTarget;
  setCloudButtonBusy(btn, true, 'Updating…');
  try {
    await cloudReq('/api/admin/users/' + encodeURIComponent(target.id) + '/password', { body: { newPassword: next } });
    setCloudButtonBusy(btn, false);
    closeModal('adminSetPassModal');
    showAdminAccountMsg('Password updated for ' + (target.login || target.email) + '.');
  } catch (e) {
    setCloudButtonBusy(btn, false);
    if (err) err.textContent = cloudErrorText(e);
  }
}
function adminDeleteUser(userId) {
  const target = (adminDirectory || []).find(a => a.id === userId);
  if (!target) return;
  const label = target.login || target.email || '';
  document.getElementById('confirmTitle').textContent = 'Remove admin';
  document.getElementById('confirmMsg').textContent = 'Remove ' + label + '? They are signed out immediately and lose admin access.';
  const btn = document.getElementById('confirmBtn');
  btn.textContent = 'Remove';
  btn.onclick = async () => {
    closeModal('confirmModal');
    try {
      await cloudReq('/api/admin/users/' + encodeURIComponent(target.id), { method: 'DELETE' });
      showAdminAccountMsg('Admin removed: ' + label + '.');
      await loadAdminDirectory();
    } catch (e) {
      await loadAdminDirectory();
      const err = document.getElementById('adminManageErr');
      if (err) err.textContent = cloudErrorText(e);
    }
  };
  openModal('confirmModal');
}

// ponytail: no login gate — every user can add/edit/remove songs. "Manage Songs" panel is public.
function openAdmin() {
  showView('admin'); currentListKind = 'admin';
  renderAdminPanel(); navPush();
  // Manage Songs is a fresh page: never inherit the scroll of the list we left.
  window.scrollTo(0, 0);
}

// ─── ADMIN PANEL ───
let adminBookFilter = 'all';
let adminSearchQuery = '';

function renderAdminPanel() {
  const sel = document.getElementById('adminFilterSelect');
  sel.innerHTML = '';
  const allCount = Object.values(SONGS).filter(s => s && s.songs).reduce((n, s) => n + s.songs.length, 0);
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'All Songbooks (' + allCount + ')';
  sel.appendChild(allOpt);
  Object.keys(SONGS).filter(k => SONGS[k] && SONGS[k].songs).forEach(k => {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = SONGS[k].info.name + ' (' + SONGS[k].songs.length + ')';
    if (k === adminBookFilter) opt.selected = true;
    sel.appendChild(opt);
  });
  renderAdminSongs();
  renderSongbookManage();
  buildFilterDropdown();
}

function filterAdminByBook(val) { adminBookFilter = val; renderAdminSongs(); }
function filterAdminSearch(val) { adminSearchQuery = val; renderAdminSongs(); }

// ponytail: native <select> popup can't be CSS-themed in Chrome; custom themed dropdown for the All-Songbooks filter
function buildFilterDropdown() {
  const sel = document.getElementById('adminFilterSelect');
  const menu = document.getElementById('adminFilterMenu');
  const label = document.getElementById('adminFilterLabel');
  const btn = document.getElementById('adminFilterBtn');
  if (!sel || !menu || !label || !btn) return;
  menu.innerHTML = '';
  [...sel.options].forEach(opt => {
    const item = document.createElement('div');
    item.className = 'dd-item' + (opt.value === sel.value ? ' sel' : '');
    item.textContent = opt.textContent;
    item.onclick = () => {
      sel.value = opt.value;
      label.textContent = opt.textContent;
      [...menu.children].forEach(c => c.classList.remove('sel'));
      item.classList.add('sel');
      filterAdminByBook(opt.value);
      closeFilterDropdown();
    };
    menu.appendChild(item);
  });
  const cur = [...sel.options].find(o => o.value === sel.value);
  label.textContent = cur ? cur.textContent : (sel.options[0] ? sel.options[0].textContent : '');
  btn.onclick = (e) => { e.stopPropagation(); toggleFilterDropdown(); };
  if (!window.__ddBound) {
    window.__ddBound = true;
    document.addEventListener('click', e => { if (document.getElementById('adminFilterDD') && !document.getElementById('adminFilterDD').contains(e.target)) closeFilterDropdown(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFilterDropdown(); });
    document.addEventListener('click', () => closeAllKebab());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllKebab(); });
  }
}
function openFilterDropdown(){ const b=document.getElementById('adminFilterBtn'), m=document.getElementById('adminFilterMenu'); if(b)m&&b.classList.add('open'); if(m)m.classList.add('open'); }
function closeFilterDropdown(){ const b=document.getElementById('adminFilterBtn'), m=document.getElementById('adminFilterMenu'); if(b)b.classList.remove('open'); if(m)m.classList.remove('open'); }
function toggleFilterDropdown(){ const m=document.getElementById('adminFilterMenu'); if(!m)return; m.classList.contains('open')?closeFilterDropdown():openFilterDropdown(); }

// ponytail: generic themed dropdown (mirrors the All-Songbooks .dd) so Add/Book selects match the theme.
function buildDropdown(ddId, items, onSelect) {
  const dd = document.getElementById(ddId);
  if (!dd) return;
  const menu = dd.querySelector('.dd-menu'), btn = dd.querySelector('.dd-btn'), label = dd.querySelector('.dd-label');
  menu.innerHTML = '';
  items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'dd-item' + (it.selected ? ' sel' : '');
    el.textContent = it.text;
    el.onclick = () => {
      dd.querySelectorAll('.dd-item').forEach(c => c.classList.remove('sel'));
      el.classList.add('sel');
      if (label) label.textContent = it.text;
      closeAllDD();
      if (onSelect) onSelect(it.value);
    };
    menu.appendChild(el);
  });
  const cur = items.find(i => i.selected) || items[0];
  if (label) label.textContent = cur ? cur.text : '';
  btn.onclick = e => { e.stopPropagation(); toggleDD(ddId); };
  btn.disabled = false;
}
function toggleDD(ddId) {
  const dd = document.getElementById(ddId), menu = dd.querySelector('.dd-menu');
  const willOpen = !menu.classList.contains('open');
  closeAllDD();
  if (willOpen) { menu.classList.add('open'); dd.querySelector('.dd-btn').classList.add('open'); }
}
function closeAllDD() {
  document.querySelectorAll('.dd').forEach(dd => {
    const m = dd.querySelector('.dd-menu'); if (m) m.classList.remove('open');
    const b = dd.querySelector('.dd-btn'); if (b) b.classList.remove('open');
  });
}
if (!window.__dd2Bound) {
  window.__dd2Bound = true;
  document.addEventListener('click', e => { if (!e.target.closest('.dd')) closeAllDD(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllDD(); });
}

function renderAdminSongs() {
  const list = document.getElementById('adminSongList');
  let songs = [];
  if (adminBookFilter === 'all') {
    Object.keys(SONGS).filter(k => SONGS[k] && SONGS[k].songs).forEach(k => songs = songs.concat(SONGS[k].songs));
  } else {
    songs = SONGS[adminBookFilter] ? SONGS[adminBookFilter].songs : [];
  }
  if (adminSearchQuery) {
    const q = normText(adminSearchQuery);
    songs = songs.filter(s => normText(s.title+' '+s.author+' '+s.number+' '+s.key).includes(q));
  }
  document.getElementById('adminCount').textContent = songs.length + ' songs';
  list.innerHTML = '';
  if (!songs.length) { list.innerHTML = '<div class="no-results"><div class="icon">'+SVG.music+'</div><p>No songs found</p></div>'; return; }
  // ponytail: never build all 5k+ rows at once — render in 200-row chunks; "Load more" appends the next.
  const CHUNK = 200, big = songs.length > CHUNK;
  let rendered = 0;
  const buildRow = (song, i) => {
    const row = document.createElement('div');
    row.className = 'admin-song-row' + (big ? '' : ' fade-in');
    if (!big) row.style.animationDelay = Math.min(i*0.015, 0.4)+'s';
    const meta = [song.author, song.key?'Key: '+song.key:''].filter(Boolean).join(' · ');
    row.innerHTML = '<div class="song-num">'+esc(song.number||'')+'</div><div class="song-info"><div class="song-title">'+esc(song.title)+'</div><div class="song-meta">'+esc(meta)+'</div></div><div class="admin-actions"><button type="button" data-action="export" title="Export">'+SVG.download+'</button><button type="button" data-action="edit" title="Edit">'+SVG.edit+'</button><button type="button" class="del" data-action="delete" title="Delete">'+SVG.trash+'</button></div>';
    row.querySelector('.admin-actions').addEventListener('click', ev => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'export') openExportModal(song.id);
      else if (btn.dataset.action === 'edit') openEditModal(song.id);
      else if (btn.dataset.action === 'delete') confirmDelete(song.id);
    });
    return row;
  };
  const renderChunk = (n) => {
    const frag = document.createDocumentFragment();
    const end = Math.min(rendered + n, songs.length);
    for (; rendered < end; rendered++) frag.appendChild(buildRow(songs[rendered], rendered));
    list.appendChild(frag);
  };
  renderChunk(CHUNK);
  if (songs.length > CHUNK) {
    const more = document.createElement('button');
    more.className = 'admin-more';
    more.textContent = 'Load more — showing ' + Math.min(CHUNK, songs.length) + ' of ' + songs.length;
    more.onclick = () => {
      const frag = document.createDocumentFragment();
      const end = Math.min(rendered + CHUNK, songs.length);
      for (; rendered < end; rendered++) frag.appendChild(buildRow(songs[rendered], rendered));
      list.insertBefore(frag, more);
      if (rendered >= songs.length) more.remove();
      else more.textContent = 'Load more — showing ' + rendered + ' of ' + songs.length;
    };
    list.appendChild(more);
  }
}

// ponytail: one "+ Add" button opens a small menu (Add Song / Main Songbook / Songbook).
function toggleAdminAdd(e) {
  e.stopPropagation();
  const m = document.getElementById('adminAddMenu'), b = document.getElementById('adminAddBtn');
  const open = m.classList.toggle('open');
  b.classList.toggle('open', open);
  b.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && !window.__addBound) {
    window.__addBound = true;
    document.addEventListener('click', ev => {
      const m = document.getElementById('adminAddMenu'), b = document.getElementById('adminAddBtn');
      if (m && !m.contains(ev.target) && b && !b.contains(ev.target)) { m.classList.remove('open'); b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { const m = document.getElementById('adminAddMenu'), b = document.getElementById('adminAddBtn'); if (m) m.classList.remove('open'); if (b) { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); } } });
  }
}
function adminAdd(kind) {
  const m = document.getElementById('adminAddMenu'), b = document.getElementById('adminAddBtn');
  if (m) m.classList.remove('open');
  if (b) { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); }
  if (kind === 'song') openAddModal();
  else if (kind === 'main') openSongbookModal();
  else if (kind === 'book') openBookModal();
}

// ─── EXPORT ───
let exportSongId = null;

async function openExportModal(songId) {
  await ensureSongs();
  exportSongId = songId || null;
  if (songId) {
    document.getElementById('exportScope').value = 'single';
    document.getElementById('exportScope').disabled = true;
    let song = null;
    CAT_ORDER.forEach(k => { const f = SONGS[k].songs.find(s => s.id === songId); if (f) song = f; });
    if (song) document.getElementById('exportSongTitle').textContent = song.title;
    document.getElementById('exportSingleInfo').classList.remove('is-hidden');
  } else {
    document.getElementById('exportScope').disabled = false;
    // ponytail: opening the modal from the toolbar must reset the scope — a
    // leftover 'single' selection has no song attached and fails the export.
    document.getElementById('exportScope').value = 'all';
    document.getElementById('exportSingleInfo').classList.add('is-hidden');
  }
  const ps = document.getElementById('exportPlaylistSelect');
  if (ps) {
    ps.innerHTML = '';
    playlists.forEach(pl => { const o = document.createElement('option'); o.value = pl.id; o.textContent = pl.name + ' (' + pl.songs.length + ')'; ps.appendChild(o); });
    document.getElementById('exportPlaylistRow').classList.toggle('is-hidden', document.getElementById('exportScope').value !== 'playlist');
  }
  openModal('exportModal');
}

document.getElementById('exportScope').addEventListener('change', function() {
  const v = this.value;
  document.getElementById('exportSingleInfo').classList.toggle('is-hidden', v !== 'single');
  const pr = document.getElementById('exportPlaylistRow');
  if (pr) pr.classList.toggle('is-hidden', v !== 'playlist');
});

function executeExport() {
  const scope = document.getElementById('exportScope').value;
  const format = document.getElementById('exportFormat').value;
  let data, filename;
  if (scope === 'all') {
    data = SONGS;
    filename = 'khristian-labu-all';
  } else if (scope === 'cat') {
    // ponytail: prefer the book selected in the admin filter; fall back to the last edited one.
    const cat = (adminBookFilter !== 'all' && SONGS[adminBookFilter]) ? adminBookFilter : adminCat;
    data = { [cat]: SONGS[cat] };
    filename = 'khristian-labu-' + cat;
  } else if (scope === 'playlist') {
    const pl = playlists.find(p => p.id === document.getElementById('exportPlaylistSelect').value);
    if (!pl) {  return; }
    const songs = [];
    pl.songs.forEach(id => CAT_ORDER.forEach(k => { const s = SONGS[k].songs.find(x => x.id === id); if (s) songs.push({...s, cat: k}); }));
    data = songs;
    filename = 'playlist-' + (pl.name || 'list').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  } else {
    let song = null, songCat = null;
    CAT_ORDER.forEach(k => { const f = SONGS[k].songs.find(s => s.id === exportSongId); if (f) { song = f; songCat = k; } });
    if (!song) {  return; }
    data = song;
    filename = 'song-' + (song.number || song.id);
  }
  if (format === 'json') {
    downloadFile(JSON.stringify(data, null, 2), filename + '.json', 'application/json');
  } else {
    downloadFile(exportAsText(data), filename + '.txt', 'text/plain');
  }
  closeModal('exportModal');
}

function exportAsText(data) {
  const vt = {v:'Verse',c:'Chorus',b:'Bridge',p:'Reference',pc:'Pre-Chorus'};
  let txt = '';
  const songs = data.songs ? data.songs : (data[CAT_ORDER[0]] ? [] : [data]);
  if (data.songs) {
    txt += data.info ? data.info.name + '\n' + '='.repeat(40) + '\n\n' : '';
    data.songs.forEach(song => { txt += formatSongText(song, vt) + '\n\n'; });
  } else if (Array.isArray(data)) {
    data.forEach(song => { txt += formatSongText(song, vt) + '\n\n'; });
  } else {
    txt = formatSongText(data, vt);
  }
  return txt;
}

function formatSongText(song, vt) {
  let txt = '';
  txt += (song.number ? '#' + song.number + ' ' : '') + song.title + '\n';
  if (song.author) txt += 'By: ' + song.author + '\n';
  if (song.key) txt += 'Key: ' + song.key + '\n';
  txt += '-'.repeat(30) + '\n';
  (song.verses || []).forEach(v => {
    const vtype = vt[v.type || 'v'] || 'Verse';
    txt += '\n[' + vtype + ']\n';
    txt += v.lines.join('\n') + '\n';
  });
  return txt;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  // ponytail: revoking synchronously can cancel the download before it starts — defer it.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function downloadFile(content, filename, type) {
  downloadBlob(new Blob([content], { type: type }), filename);
}

// ─── FIND & REPLACE ───
let frMatches = [];
// One-shot record of the last Replace All: what each touched field held before,
// so a bulk replacement can be rolled back without restoring anything else.
let frUndo = null;

function toggleFindReplace() {
  const modal = document.getElementById('findReplaceModal');
  if (modal.classList.contains('open')) { closeFindReplace(); return; }
  openModal('findReplaceModal');
  // Focus after the sheet animation has started, so mobile keyboards don't jump
  // it. Only if nothing inside the modal already has focus: this timer used to
  // pull the caret back out of the Replace field, so text typed quickly landed
  // in Find and the preview found nothing.
  setTimeout(() => {
    if (!modal.classList.contains('open')) return;
    const active = document.activeElement;
    if (active && active !== document.body && modal.contains(active)) return;
    const fi = document.getElementById('findInput'); if (fi) fi.focus();
  }, 80);
}
function closeFindReplace() { closeModal('findReplaceModal'); }

// The form is the source of truth: every action re-reads it, so a preview that
// was never rendered (or is out of date) cannot change what a button does.
function readFindReplaceForm() {
  return {
    findText: document.getElementById('findInput').value,
    replaceText: document.getElementById('replaceInput').value,
    caseSensitive: document.getElementById('frCaseSensitive').checked,
    searchTitles: document.getElementById('frTitles').checked,
    searchVerses: document.getElementById('frVerses').checked,
    searchAuthors: document.getElementById('frAuthors').checked,
  };
}

function collectFindMatches(form) {
  const { findText, caseSensitive, searchTitles, searchVerses, searchAuthors } = form;
  const matches = [];
  if (!findText) return matches;
  CAT_ORDER.forEach(key => {
    SONGS[key].songs.forEach(song => {
      if (searchTitles && song.title) {
        const idx = findIndex(song.title, findText, caseSensitive);
        if (idx !== -1) matches.push({ song, field: 'title', cat: key, original: song.title, idx });
      }
      if (searchAuthors && song.author) {
        const idx = findIndex(song.author, findText, caseSensitive);
        if (idx !== -1) matches.push({ song, field: 'author', cat: key, original: song.author, idx });
      }
      if (searchVerses && song.verses) {
        song.verses.forEach((v, vi) => {
          v.lines.forEach((line, li) => {
            const idx = findIndex(line, findText, caseSensitive);
            if (idx !== -1) matches.push({ song, field: 'verse', cat: key, verseIdx: vi, lineIdx: li, original: line, idx });
          });
        });
      }
    });
  });
  return matches;
}

function previewFindReplace() {
  const form = readFindReplaceForm();
  const findText = form.findText;
  const stats = document.getElementById('frStats');
  const results = document.getElementById('frResults');
  if (!findText) {
    // Emptying Find only clears the preview — it must not eat the Replace text.
    frMatches = [];
    stats.textContent = '';
    results.innerHTML = '';
    results.classList.remove('show');
    return;
  }
  const caseSensitive = form.caseSensitive;
  frMatches = collectFindMatches(form);
  if (!frMatches.length) {
    stats.textContent = 'No matches found';
    results.innerHTML = '';
    results.classList.remove('show');
    return;
  }
  stats.textContent = frMatches.length + ' match' + (frMatches.length !== 1 ? 'es' : '') + ' found across ' + [...new Set(frMatches.map(m => m.song.id))].length + ' songs';
  results.classList.add('show');
  const replaceText = form.replaceText;
  let html = '';
  frMatches.slice(0, 50).forEach(m => {
    const highlighted = highlightMatch(m.original, findText, caseSensitive);
    const songInfo = m.song.number ? '#' + m.song.number + ' ' : '';
    const fieldLabel = m.field === 'verse' ? ' (v' + (m.verseIdx+1) + ')' : ' [' + m.field + ']';
    // With something in Replace, show the line as it will read afterwards.
    let afterRow = '';
    if (replaceText) {
      const after = highlightMatch(replaceAll(m.original, findText, replaceText, caseSensitive), replaceText, true);
      afterRow = '<div class="match-after">' + (after ? after : '<span class="match-gone">(removed)</span>') + '</div>';
    }
    html += '<div class="match"><div><div class="match-song">' + esc(songInfo + m.song.title) + '</div><div class="match-text">' + esc(m.cat) + fieldLabel + ': ' + highlighted + '</div>' + afterRow + '</div></div>';
  });
  if (frMatches.length > 50) html += '<div class="match"><div class="match-text">... and ' + (frMatches.length - 50) + ' more matches</div></div>';
  results.innerHTML = html;
}

function findIndex(text, find, caseSensitive) {
  if (caseSensitive) return text.indexOf(find);
  return text.toLowerCase().indexOf(find.toLowerCase());
}

function highlightMatch(text, find, caseSensitive) {
  if (!find) return esc(text);
  const escaped = esc(text);
  const findEsc = esc(find);
  if (caseSensitive) return escaped.replace(new RegExp(findEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<span class="highlight">' + findEsc + '</span>');
  return escaped.replace(new RegExp(findEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<span class="highlight">' + findEsc + '</span>');
}

async function executeReplace() {
  const form = readFindReplaceForm();
  const findText = form.findText;
  const replaceText = form.replaceText;
  const caseSensitive = form.caseSensitive;
  const stats = document.getElementById('frStats');
  if (!findText) {
    stats.textContent = 'Type something to find first';
    return;
  }
  // Scan now, not from the preview: what the fields say is what gets replaced.
  const matches = collectFindMatches(form);
  if (!matches.length) {
    frMatches = [];
    stats.textContent = 'No matches to replace';
    return;
  }
  const touched = new Map();
  const changes = [];
  matches.forEach(m => {
    changes.push({ cat: m.cat, id: m.song.id, title: m.song.title, field: m.field, verseIdx: m.verseIdx, lineIdx: m.lineIdx, before: m.original });
    if (m.field === 'title') {
      m.song.title = replaceAll(m.song.title, findText, replaceText, caseSensitive);
    } else if (m.field === 'author') {
      m.song.author = replaceAll(m.song.author, findText, replaceText, caseSensitive);
    } else if (m.field === 'verse') {
      m.song.verses[m.verseIdx].lines[m.lineIdx] = replaceAll(m.original, findText, replaceText, caseSensitive);
    }
    touched.set(m.song.id, m.song);
  });
  try {
    await saveSongs();
    for (const [id, song] of touched) {
      let cat = null;
      CAT_ORDER.some(k => { if (SONGS[k].songs.some(s => s.id === id)) { cat = k; return true; } return false; });
      if (cat) await recordEdit(cat, song, 'update');
    }
  } catch (e) {
    stats.textContent = 'Could not save replacement';
    return;
  }
  frUndo = { changes: changes, songs: touched.size };
  syncReplaceUndo();
  previewFindReplace();
  renderAdminSongs();
  closeFindReplace();
}

// The admin banner is the only visible trace of a finished bulk replace, so it
// doubles as the undo affordance: there is no toast layer in this app.
function syncReplaceUndo() {
  const bar = document.getElementById('adminUndoBar');
  if (!bar) return;
  const text = document.getElementById('adminUndoText');
  if (!frUndo) { bar.hidden = true; text.textContent = ''; return; }
  const n = frUndo.changes.length;
  text.textContent = 'Replaced ' + n + ' match' + (n !== 1 ? 'es' : '') +
    ' in ' + frUndo.songs + ' song' + (frUndo.songs !== 1 ? 's' : '') + '.';
  bar.hidden = false;
}

async function undoReplace() {
  if (!frUndo) { syncReplaceUndo(); return; }
  const pending = frUndo;
  frUndo = null;
  const touched = new Map();
  let restored = 0;
  pending.changes.forEach(c => {
    const book = SONGS[c.cat];
    const song = book && book.songs && book.songs.find(s => s.id === c.id);
    if (!song) return;
    if (c.field === 'title') song.title = c.before;
    else if (c.field === 'author') song.author = c.before;
    else if (c.field === 'verse') {
      const line = song.verses && song.verses[c.verseIdx] && song.verses[c.verseIdx].lines;
      if (!line || line[c.lineIdx] === undefined) return;
      line[c.lineIdx] = c.before;
    } else { return; }
    restored++;
    touched.set(song.id + '\u0000' + c.cat, { cat: c.cat, song: song });
  });
  syncReplaceUndo();
  if (!restored) {
    // Nothing came back: say so rather than disappearing without a trace.
    const stats = document.getElementById('frStats');
    if (stats) stats.textContent = 'Nothing to undo';
    return;
  }
  try {
    await saveSongs();
    for (const { cat, song } of touched.values()) await recordEdit(cat, song, 'update');
  } catch (e) {
    // Keep the record so the user can try again rather than losing the way back.
    frUndo = pending;
    syncReplaceUndo();
    const stats = document.getElementById('frStats');
    if (stats) stats.textContent = 'Could not undo the replacement';
    return;
  }
  renderAdminSongs();
}

function replaceAll(text, find, replace, caseSensitive) {
  if (caseSensitive) return text.split(find).join(replace);
  return text.split(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(replace);
}

function clearFindReplace() {
  document.getElementById('findInput').value = '';
  document.getElementById('replaceInput').value = '';
  document.getElementById('frStats').textContent = '';
  document.getElementById('frResults').innerHTML = '';
  document.getElementById('frResults').classList.remove('show');
  frMatches = [];
}

// ─── ADD / EDIT MODAL ───
// Titles come from the songbook sheet, so a title typed in the form cannot win.
// Warn while typing instead of letting the change disappear on save.
function updateTitleHint() {
  const input = document.getElementById('formTitle');
  const hint = document.getElementById('formTitleHint');
  if (!hint) return;
  const printed = input.dataset.printed || '';
  const typed = input.value.trim();
  if (printed && typed && typed !== printed) {
    hint.textContent = 'The app shows the printed title “' + printed + '”, so this title will not appear.';
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}
function setPrintedTitle(title) {
  const input = document.getElementById('formTitle');
  input.dataset.printed = title || '';
  input.oninput = updateTitleHint;
  updateTitleHint();
}
async function openAddModal() {
  await ensureSongs();
  document.getElementById('modalTitle').textContent = 'Add Song';
  document.getElementById('editSongId').value = '';
  formCatValue = adminCat;
  populateFormCat();
  document.getElementById('formNum').value = '';
  document.getElementById('formKey').value = '';
  document.getElementById('formTitle').value = '';
  document.getElementById('formAuthor').value = '';
  document.getElementById('formVerses').value = '';
  setPrintedTitle('');
  openModal('songModal');
}

async function openEditModal(id) {
  await ensureSongs();
  let song = null, songCat = null;
  CAT_ORDER.forEach(k => {
    const found = SONGS[k].songs.find(s => s.id === id);
    if (found) { song = found; songCat = k; }
  });
  if (!song) return;
  document.getElementById('modalTitle').textContent = 'Edit Song';
  document.getElementById('editSongId').value = id;
  formCatValue = songCat;
  populateFormCat();
  document.getElementById('formNum').value = song.number || '';
  document.getElementById('formKey').value = song.key || '';
  document.getElementById('formTitle').value = song.title || '';
  setPrintedTitle(song.title || '');
  document.getElementById('formAuthor').value = song.author || '';
  // Convert verses back to text
  let txt = '';
  (song.verses||[]).forEach(v => {
    if (txt) txt += '\n\n';
    const prefix = v.type === 'c' ? 'C: ' : v.type === 'b' ? 'B: ' : v.type === 'p' ? 'P: ' : 'V: ';
    txt += v.lines.map((l,i) => (i===0?prefix:'') + l).join('\n');
  });
  document.getElementById('formVerses').value = txt;
  openModal('songModal');
}

function parseVerses(text) {
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim());
  return blocks.map(block => {
    const lines = block.split('\n').filter(l => l.trim());
    let type = 'v';
    const first = lines[0] || '';
    if (/^C:\s*/i.test(first)) { type = 'c'; lines[0] = first.replace(/^C:\s*/i, ''); }
    else if (/^B:\s*/i.test(first)) { type = 'b'; lines[0] = first.replace(/^B:\s*/i, ''); }
    else if (/^P:\s*/i.test(first)) { type = 'p'; lines[0] = first.replace(/^P:\s*/i, ''); }
    else if (/^V:\s*/i.test(first)) { lines[0] = first.replace(/^V:\s*/i, ''); }
    return { type, lines: lines.map(l => l.trim()).filter(Boolean) };
  }).filter(v => v.lines.length > 0);
}

async function saveSong() {
  const editId = document.getElementById('editSongId').value;
  const cat = formCatValue;
  const num = document.getElementById('formNum').value.trim();
  const key = document.getElementById('formKey').value.trim();
  const title = document.getElementById('formTitle').value.trim();
  const author = document.getElementById('formAuthor').value.trim();
  const versesText = document.getElementById('formVerses').value;

  if (!title) {  return; }

  const verses = parseVerses(versesText);
  // ponytail: the edit form has no solfa field yet — carry an existing sheet over
  // so editing a song can never silently drop its tonic solfa.
  let prevSong = null, oldCat = null;
  if (editId) CAT_ORDER.some(k => { const f = SONGS[k].songs.find(s => s.id === editId); if (f) { prevSong = f; oldCat = k; return true; } return false; });
  const song = {
    id: editId || cat + '_' + Date.now(),
    title, author, number: num, key, verses
  };
  if (prevSong && safeSolfaSrc(prevSong.solfa)) song.solfa = prevSong.solfa;

  let changed = false;
  if (editId) {
    // Find and update
    CAT_ORDER.forEach(k => {
      const idx = SONGS[k].songs.findIndex(s => s.id === editId);
      if (idx >= 0) {
        if (k !== cat) {
          // Moved to different category
          SONGS[k].songs.splice(idx, 1);
          SONGS[cat].songs.push(song);
        } else {
          SONGS[k].songs[idx] = song;
        }
        changed = true;
      }
    });
  } else {
    SONGS[cat].songs.push(song);
    changed = true;
  }

  // Re-number songs in category
  SONGS[cat].songs.forEach((s, i) => { if (!s.number) s.number = String(i + 1); });

  try {
    await saveSongs();
    await recordEdit(cat, song, 'update', oldCat);
  } catch (e) {
    return;
  }
  closeModal('songModal');
  adminCat = cat;
  renderAdminPanel();
  renderCategories();
}

// ─── DELETE ───
let pendingDeleteId = null;
let pendingDeleteCat = null;
// Generic confirm used by song delete AND songbook/book delete.
function confirmDangerous(msg, btnText, fn) {
  document.getElementById('confirmMsg').textContent = msg;
  const b = document.getElementById('confirmBtn');
  b.textContent = btnText;
  b.onclick = () => { closeModal('confirmModal'); fn(); };
  openModal('confirmModal');
}
function confirmDelete(id) {
  pendingDeleteId = id;
  pendingDeleteCat = null;
  let song = null;
  CAT_ORDER.forEach(k => {
    const found = SONGS[k].songs.find(s => s.id === id);
    if (found) { song = found; pendingDeleteCat = k; }
  });
  confirmDangerous('Delete "' + (song ? song.title : 'this song') + '"? This cannot be undone.', 'Delete', doDelete);
}

// ─── CREATE / MANAGE SONGBOOKS & BOOKS ───
// ponytail: users can create + manage main songbooks (groups) and sub-books;
// structural edits ride the same IndexedDB 'edits' store as songs so they survive corpus bumps.
function nextCode(prefix) {
  let n = 1;
  while (SONGS[prefix + n] || (SONGS.groups || []).some(g => g.id === prefix + n)) n++;
  return prefix + n;
}
let formCatValue = 'B&P';
function populateFormCat() {
  const items = Object.keys(SONGS).filter(k => SONGS[k] && SONGS[k].songs).map(k => ({
    value: k,
    text: (SONGS[k].info ? SONGS[k].info.name : k) + ' (' + SONGS[k].songs.length + ')',
    selected: k === formCatValue
  }));
  buildDropdown('formCatDD', items, v => { formCatValue = v; });
}
function openSongbookModal(editId) {
  const isEdit = !!editId;
  document.getElementById('sbModalTitle').textContent = isEdit ? 'Rename Main Songbook' : 'New Main Songbook';
  document.getElementById('sbEditId').value = editId || '';
  const g = isEdit ? (SONGS.groups || []).find(x => x.id === editId) : null;
  document.getElementById('sbName').value = g ? g.name : '';
  document.getElementById('sbDesc').value = g ? (g.desc || '') : '';
  document.getElementById('sbIcon').value = g ? (g.icon || '') : '';
  document.getElementById('sbBooks').value = '';
  document.getElementById('sbBooksRow').style.display = isEdit ? 'none' : '';
  openModal('songbookModal');
}
async function saveSongbook() {
  const name = document.getElementById('sbName').value.trim();
  const desc = document.getElementById('sbDesc').value.trim();
  const icon = document.getElementById('sbIcon').value.trim();
  if (!name) {  return; }
  const editId = document.getElementById('sbEditId').value;
  try {
    if (editId) {
      const payload = { name, desc, icon };
      await recordStruct(editId, 'renameGroup', payload);
      applyStruct({ id: editId, cat: null, op: 'renameGroup', song: payload });
    } else {
      const id = nextCode('ug');
      const names = document.getElementById('sbBooks').value.split('\n').map(s => s.trim()).filter(Boolean);
      const bookNames = names.length ? names : ['Songs'];
      const used = new Set();
      const codes = [], bookDefs = [];
      bookNames.forEach(nm => {
        let m = 1;
        while (used.has('U' + m) || SONGS['U' + m] || (SONGS.groups || []).some(g => g.id === 'U' + m)) m++;
        used.add('U' + m);
        codes.push('U' + m);
        bookDefs.push({ code: 'U' + m, name: nm, desc: '', icon: '' });
      });
      const payload = { id, name, desc, icon, books: codes, bookDefs };
      await recordStruct(id, 'addGroup', payload);
      applyStruct({ id, cat: null, op: 'addGroup', song: payload });
    }
    reindexBooks();
    await saveSongs();
  } catch (e) {
    return;
  }
  closeModal('songbookModal');
  renderSongbookManage(); renderGroups(); renderAdminPanel(); populateFormCat();
}
let bkGroupValue = '';
async function openBookModal(groupId, editCode) {
  await ensureSongs();
  if (editCode) {
    const info = SONGS[editCode] ? SONGS[editCode].info : {};
    document.getElementById('bkModalTitle').textContent = 'Rename Book';
    document.getElementById('bkEditCode').value = editCode;
    document.getElementById('bkEditGroup').value = groupId || '';
    document.getElementById('bkName').value = info.name || '';
    document.getElementById('bkDesc').value = info.description || '';
    bkGroupValue = groupId || (BOOK_GROUP[editCode] || ((SONGS.groups || [])[0] || {}).id || '');
    buildDropdown('bkGroupDD', (SONGS.groups || []).map(g => ({ value: g.id, text: g.name, selected: g.id === bkGroupValue })));
    const bbtn = document.getElementById('bkGroupBtn'); if (bbtn) bbtn.disabled = true;
    openModal('bookModal');
    return;
  }
  document.getElementById('bkModalTitle').textContent = 'New Book';
  document.getElementById('bkEditCode').value = '';
  document.getElementById('bkEditGroup').value = '';
  document.getElementById('bkName').value = '';
  document.getElementById('bkDesc').value = '';
  bkGroupValue = groupId || ((SONGS.groups || [])[0] || {}).id || '';
  buildDropdown('bkGroupDD', (SONGS.groups || []).map(g => ({ value: g.id, text: g.name, selected: g.id === bkGroupValue })));
  const bbtn = document.getElementById('bkGroupBtn'); if (bbtn) bbtn.disabled = false;
  openModal('bookModal');
}
async function saveBook() {
  const name = document.getElementById('bkName').value.trim();
  const desc = document.getElementById('bkDesc').value.trim();
  if (!name) {  return; }
  const editCode = document.getElementById('bkEditCode').value;
  try {
    if (editCode) {
      const payload = { name, desc, icon: '' };
      await recordStruct(editCode, 'renameBook', payload);
      applyStruct({ id: editCode, cat: null, op: 'renameBook', song: payload });
    } else {
      const groupId = bkGroupValue;
      const code = nextCode('U');
      const payload = { group: groupId, code, name, desc, icon: '' };
      await recordStruct(code, 'addBook', payload);
      applyStruct({ id: code, cat: null, op: 'addBook', song: payload });
    }
    reindexBooks();
    await saveSongs();
  } catch (e) {
    return;
  }
  closeModal('bookModal');
  renderSongbookManage(); renderGroups(); renderAdminPanel(); populateFormCat();
}
let expandedGroups = new Set();
function toggleCollapse(id) {
  const grp = document.querySelector('.sb-group[data-id="' + id + '"]');
  if (!grp) return;
  const open = grp.classList.toggle('open');
  if (open) expandedGroups.add(id); else expandedGroups.delete(id);
  const books = grp.querySelector(':scope > .sb-books');
  if (books) books.classList.toggle('collapsed', !open);
}
function toggleKebab(e, btn) {
  e.stopPropagation();
  const wrap = btn.closest('.sb-group, .sb-book-row');
  const menu = wrap ? wrap.querySelector(':scope > .sb-menu') : null;
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  closeAllKebab();
  if (!isOpen) menu.classList.add('open');
}
function closeAllKebab() {
  document.querySelectorAll('.sb-menu.open').forEach(m => m.classList.remove('open'));
}
async function renderSongbookManage() {
  await ensureSongs();
  const el = document.getElementById('songbookManage');
  if (!el) return;
  let html = '<div class="sb-manage-header"><h3>Songbooks</h3></div>';
  (SONGS.groups || []).forEach(g => {
    const books = g.books || [];
    let total = 0;
    books.forEach(code => { total += SONGS[code] ? SONGS[code].songs.length : 0; });
    const open = expandedGroups.has(g.id);
    html += '<div class="sb-group' + (open ? ' open' : '') + '" data-id="' + g.id + '">';
    html += '<div class="sb-head" data-action="toggleCollapse" data-id="' + g.id + '">';
    html += '<svg class="sb-chev" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l5 4-5 4z"/></svg>';
    html += '<span class="sb-name">' + esc(g.name) + '</span>';
    html += '<span class="sb-total">' + total.toLocaleString() + ' songs</span>';
    html += '<button type="button" class="sb-kebab" data-action="toggleKebab" aria-label="Options">⋮</button>';
    html += '</div>';
    html += '<div class="sb-menu"><div class="sb-menu-item" data-action="openSongbookModal" data-id="' + g.id + '">Rename</div><div class="sb-menu-item" data-action="openBookModal" data-group="' + g.id + '">Add Book</div><div class="sb-menu-item danger" data-action="confirmDeleteGroup" data-id="' + g.id + '">Delete</div></div>';
    html += '<div class="sb-books' + (open ? '' : ' collapsed') + '">';
    books.forEach(code => {
      const info = SONGS[code] ? SONGS[code].info : { name: code };
      const cnt = SONGS[code] ? SONGS[code].songs.length : 0;
      html += '<div class="sb-book-row">';
      html += '<span class="sb-book-name">' + esc(info.name) + ' <span class="sb-count">' + cnt + '</span></span>';
      html += '<button type="button" class="sb-kebab" data-action="toggleKebab" aria-label="Options">⋮</button>';
      html += '<div class="sb-menu"><div class="sb-menu-item" data-action="openBookModal" data-group="' + g.id + '" data-code="' + code + '">Rename</div><div class="sb-menu-item danger" data-action="confirmDeleteBook" data-id="' + code + '">Delete</div></div>';
      html += '</div>';
    });
    html += '</div></div>';
  });
  el.innerHTML = html;
}
function confirmDeleteGroup(id) {
  const g = (SONGS.groups || []).find(x => x.id === id);
  confirmDangerous('Delete songbook "' + (g ? g.name : '') + '" and ALL its books and songs? This cannot be undone.', 'Delete', () => deleteGroup(id));
}
async function deleteGroup(id) {
  try {
    await recordStruct(id, 'deleteGroup', {});
    applyStruct({ id, cat: null, op: 'deleteGroup', song: {} });
    reindexBooks();
    await saveSongs();
  } catch (e) {  return; }
  renderSongbookManage(); renderGroups(); renderAdminPanel(); populateFormCat();
}
function confirmDeleteBook(code) {
  const info = SONGS[code] ? SONGS[code].info : { name: code };
  const cnt = SONGS[code] ? SONGS[code].songs.length : 0;
  confirmDangerous('Delete book "' + (info.name || code) + '" and its ' + cnt + ' songs? This cannot be undone.', 'Delete', () => deleteBook(code));
}
async function deleteBook(code) {
  try {
    await recordStruct(code, 'deleteBook', {});
    applyStruct({ id: code, cat: null, op: 'deleteBook', song: {} });
    reindexBooks();
    await saveSongs();
  } catch (e) {  return; }
  renderSongbookManage(); renderGroups(); renderAdminPanel(); populateFormCat();
}

async function doDelete() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId, cat = pendingDeleteCat || '';
  CAT_ORDER.forEach(k => {
    const idx = SONGS[k].songs.findIndex(s => s.id === id);
    if (idx >= 0) SONGS[k].songs.splice(idx, 1);
  });
  try {
    await recordEdit(cat, { id }, 'delete');
    await saveSongs();
  } catch (e) {  return; }
  closeModal('confirmModal');
  pendingDeleteId = null;
  pendingDeleteCat = null;
  renderAdminPanel();
  renderCategories();
}

// ─── MODALS ───
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ─── UTILS ───
// ponytail: reuse one detached div instead of allocating per call — esc() runs on
// every row of a 5k+ song corpus (admin list, search, lists).
let _escDiv = null;
function esc(s) { if (!s) return ''; if (!_escDiv) _escDiv = document.createElement('div'); _escDiv.textContent = s; return _escDiv.innerHTML; }
function escAttr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escAttr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function hl(text, q) {
  if (!text) return '';
  let h = esc(text);
  if (!q) return h;
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return h.replace(re, '<mark>$1</mark>');
}

// ─── SIDEBAR ───
function toggleSidebar() {
  // ponytail: refresh the per-collection counts — the menu is rendered before the
  // corpus finishes loading, so stale "0 songs" labels were showing on desktop.
  if (typeof renderSidebarGroups === 'function') renderSidebarGroups();
  document.getElementById('sidebarModal').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebarModal').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') {
  closeSidebar();
  closeWaMenu();
  // ponytail: Escape closes any open modal (settings, export, playlist, add/edit, confirm…).
  document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
} });

// ponytail: hardware Back on Android. Mirrors web: overlay/search closes first, then SPA history,
// then double-press at root exits. (history.back() drives the existing popstate/applyState.)
// Note: history.length does NOT shrink on back(), so we test app state (atRoot), not length.
let _lastBack = 0;
function atRoot() {
  return currentView === 'home' && !currentGroup && currentHomeGrid !== 'categoryGrid';
}
function onHardwareBack() {
  // Android's back gesture dismisses the chord picker first, like any popup.
  if (CE.wheel) { ceCloseWheel(); return; }
  const sz = document.getElementById('solfaZoom');
  if (sz && sz.classList.contains('open')) { closeSolfaZoom(); return; }
  const overlays = ['confirmModal', 'exportModal', 'playlistModal', 'songModal', 'songbookModal', 'bookModal', 'findReplaceModal', 'sidebarModal', 'galleryModal', 'imagePreviewModal'];
  for (const id of overlays) {
    const el = document.getElementById(id);
    if (el && el.classList.contains('open')) {
      if (id === 'sidebarModal') closeSidebar(); else closeModal(id);
      return;
    }
  }
  const bookMenu = document.getElementById('searchBookMenu');
  const sortMenu = document.getElementById('searchSortMenu');
  if ((bookMenu && !bookMenu.hidden) || (sortMenu && !sortMenu.hidden)) { closeSearchMenus(); return; }
  if (document.getElementById('searchModal')?.classList.contains('open')) { closeSearchModal(); return; }
  if (!atRoot()) { history.back(); return; }
  const now = Date.now();
  if (now - _lastBack < 2000) { window.Capacitor.Plugins.App.exitApp(); }
  else { _lastBack = now;  }
}
function renderSidebarGroups() {
  const el = document.getElementById('sidebarGroups');
  if (!el) return;
  el.innerHTML = '';
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  enabledGroups().forEach(g => {
    const total = (g.books || []).reduce((n, b) => n + bookCount(b), 0);
    const icon = GROUP_SVGS[g.id] || SVG.book;
    const btn = document.createElement('button');
    btn.className = 'sidebar-group-item';
    btn.innerHTML = '<span class="sgi-icon">'+icon+'</span><span class="sgi-text"><span class="sgi-name">'+esc(g.name)+'</span><br><span class="sgi-count">'+total.toLocaleString()+' songs</span></span>';
    btn.onclick = () => { jumpToGroup(g.id); closeSidebar(); };
    el.appendChild(btn);
  });
}
function jumpToGroup(id) { showView('home'); openGroup(id); }

// ─── HISTORY (RECENTS VIEW) ───
// ─── FULL OPEN HISTORY ───
// Every song records the time it was last opened; this page lists them newest first.
function fmtOpenTime(ts) {
  if (!ts) return 'earlier';
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  return date + ' · ' + time;
}
function historySongs() {
  const out = [];
  openHistory.forEach(e => {
    CAT_ORDER.forEach(k => {
      const s = SONGS[k].songs.find(x => x.id === e.id);
      if (s) out.push({ ...s, cat: k, catName: bookName(k), _openedAt: e.t });
    });
  });
  return out;
}
async function openHistoryPage(push) {
  await ensureSongs();
  const songs = historySongs();
  currentCat = null; currentGroup = null; currentPlaylistId = null;
  currentList = songs; currentListKind = 'history';
  _rv.listKind = 'history'; _rv.cat = null; _rv.pid = null;
  if (push !== false && restoreList('history')) {  navPush(); return; }
  showView('list');
  document.getElementById('listHeader').innerHTML =
    '<div class="list-head-row"><h2>History</h2>'
    + (songs.length ? '<button data-action="clearOpenHistory" class="list-action-btn">Clear history</button>' : '')
    + '</div><p class="list-head-desc">'+songs.length+' song'+(songs.length!==1?'s':'')+' \u00b7 most recently opened first</p>';
  const grid = document.getElementById('songGrid');
  _stashCurrentList();
  grid.innerHTML = '';
  if (!songs.length) {
    grid.innerHTML = '<div class="no-results"><div class="icon">'+SVG.clock+'</div><p>No songs opened yet</p></div>';
  } else {
    songs.forEach((song, i) => {
      const item = document.createElement('div');
      item.className = 'song-item fade-in';
      item.dataset.sid = song.id;
      item.style.animationDelay = Math.min(i * 0.02, 0.5) + 's';
      item.onclick = () => openSong(song);
      const meta = [song.catName, fmtOpenTime(song._openedAt)].filter(Boolean).join(' \u00b7 ');
      item.innerHTML = '<div class="song-num">'+esc(song.number || '')+'</div><div class="song-info"><div class="song-title">'+esc(song.title)+'</div><div class="song-meta">'+esc(meta)+'</div></div>';
      grid.appendChild(item);
    });
  }
  _renderedListKey = 'history';
  restoreScroll('history');
  saveListCache('history');

  if (push !== false) navPush();
}
function clearOpenHistory() {
  openHistory = []; saveOpenHistory();
  // the home "Recently Viewed" card is the short version of this list — clear it too.
  recents = []; localStorage.setItem('labu_recents', JSON.stringify(recents));
  delete _listCache['history']; delete _listNodes['history'];
  openHistoryPage(false);
}

async function openRecents() {
  await ensureSongs();
  const songs = [];
  recents.forEach(id => {
    CAT_ORDER.forEach(k => {
      const s = SONGS[k].songs.find(x => x.id === id);
      if (s) songs.push({...s, cat: k, catName: SONGS[k].info.name});
    });
  });
  currentCat = null; currentList = songs; currentListKind = 'recent'; currentGroup = null;
  showView('list');
  document.getElementById('listHeader').innerHTML = '<h2>History</h2><p>'+songs.length+' recently viewed song'+(songs.length!==1?'s':'')+'</p>';
  if (songs.length) { renderSongList(songs); _renderedListKey = 'recent'; restoreScroll('recent'); saveListCache('recent'); }
  else { _stashCurrentList(); document.getElementById('songGrid').innerHTML = '<div class="no-results"><div class="icon">'+SVG.clock+'</div><p>No songs viewed yet</p></div>'; _renderedListKey = 'recent'; }

  _rv.listKind = 'recent'; _rv.cat = null; _rv.pid = null;
  navPush();
}

// ─── CUSTOM LISTS (PLAYLISTS) ───
function openPlaylists() {
  currentCat = null; currentList = []; currentListKind = 'playlists'; currentGroup = null; currentPlaylistId = null;
  _rv.listKind = 'playlists'; _rv.cat = null; _rv.pid = null;
  showView('list');
  document.getElementById('listHeader').innerHTML = '<h2>Playlist</h2><p>'+playlists.length+' playlist'+(playlists.length!==1?'s':'')+'</p>';
  const grid = document.getElementById('songGrid');
  _stashCurrentList();
  grid.innerHTML = '';
  _renderedListKey = 'playlists';
  saveListCache('playlists');
  if (!playlists.length) { grid.innerHTML = '<div class="no-results"><div class="icon">'+SVG.list+'</div><p>No playlists yet. Create one in Settings or from a song.</p></div>'; navPush(); return; }
  playlists.forEach(pl => {
    const item = document.createElement('div');
    item.className = 'song-item fade-in';
    item.style.cursor = 'pointer';
    item.onclick = () => openPlaylist(pl.id);
    item.innerHTML = '<div class="song-num song-num-accent">'+SVG.list+'</div><div class="song-info"><div class="song-title">'+esc(pl.name)+'</div><div class="song-meta">'+pl.songs.length+' song'+(pl.songs.length!==1?'s':'')+'</div></div>';
    grid.appendChild(item);
  });

  navPush();
}
async function openPlaylist(pid) {
  await ensureSongs();
  const pl = playlists.find(p => p.id === pid);
  if (!pl) { openPlaylists(); return; }
  const songs = [];
  pl.songs.forEach(id => {
    CAT_ORDER.forEach(k => {
      const s = SONGS[k].songs.find(x => x.id === id);
      if (s) songs.push({...s, cat: k, catName: SONGS[k].info.name});
    });
  });
  currentCat = null; currentList = songs; currentListKind = 'playlist'; currentGroup = null; currentPlaylistId = pid;
  _rv.listKind = 'playlist'; _rv.pid = pid; _rv.cat = null;
  showView('list');
  document.getElementById('listHeader').innerHTML = '<h2>'+esc(pl.name)+'</h2><p>'+songs.length+' song'+(songs.length!==1?'s':'')+' · <a data-action="renamePlaylist" data-id="'+pid+'" class="playlist-link">Rename</a> · <a data-action="deletePlaylist" data-id="'+pid+'" class="playlist-link playlist-link-danger">Delete</a></p>';
  renderSongList(songs);
  _renderedListKey = 'playlist:'+pid;
  restoreScroll('playlist:'+pid);
  saveListCache('playlist:'+pid);

  navPush();
}
function createPlaylist(name) {
  if (!name || !name.trim()) return;
  const pl = { id: _genId(), name: name.trim(), songs: [] };
  playlists.push(pl);
  savePlaylists();
  return pl;
}
function createPlaylistFromSettings() {
  const inp = document.getElementById('settingsPlaylistName');
  const name = inp ? inp.value.trim() : '';
  if (!name) { if (inp) inp.focus(); return; }
  const pl = createPlaylist(name);
  if (!pl) return;
  inp.value = '';
}
function renamePlaylist(pid) {
  const pl = playlists.find(p => p.id === pid);
  if (!pl) return;
  const name = prompt('Rename playlist:', pl.name);
  if (name && name.trim()) { pl.name = name.trim(); savePlaylists(); if (currentPlaylistId === pid) openPlaylist(pid); else openPlaylists(); }
}
function deletePlaylist(pid) {
  const pl = playlists.find(p => p.id === pid);
  if (!pl) return;
  document.getElementById('confirmMsg').textContent = 'Delete playlist "'+pl.name+'"?';
  openModal('confirmModal');
  document.getElementById('confirmBtn').onclick = () => {
    playlists = playlists.filter(p => p.id !== pid);
    savePlaylists();
    closeModal('confirmModal');
    openPlaylists();
  };
}
function addSongToPlaylist(songId, pid) {
  const pl = playlists.find(p => p.id === pid);
  if (!pl) return;
  const idx = pl.songs.indexOf(songId);
  if (idx === -1) { pl.songs.push(songId);  }
  else { pl.songs.splice(idx, 1);  }
  savePlaylists();
}
function openPlaylistChooser(songId) {
  const el = document.getElementById('playlistModalBody');
  el.innerHTML = '';
  if (!playlists.length) { el.innerHTML = '<div class="playlist-empty">No playlists yet. Create one below.</div>'; }
  else {
    playlists.forEach(pl => {
      const inList = pl.songs.includes(songId);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0.75rem;border-radius:8px;cursor:pointer;transition:background 0.15s;';
      row.onmouseover = () => row.style.background = 'var(--accent-glow)';
      row.onmouseout = () => row.style.background = '';
      row.innerHTML = '<span class="playlist-choice-name">'+esc(pl.name)+'</span><span class="playlist-choice-state'+(inList?' added':'')+'">'+(inList?'✓ Added':'+ Add')+'</span>';
      row.onclick = () => { addSongToPlaylist(songId, pl.id); openPlaylistChooser(songId); };
      el.appendChild(row);
    });
  }
  openModal('playlistModal');
}
let _playlistModalSongId = null;
function createPlaylistFromModal() {
  const inp = document.getElementById('newPlaylistInput');
  const pl = createPlaylist(inp.value);
  if (pl && _playlistModalSongId) { addSongToPlaylist(_playlistModalSongId, pl.id); openPlaylistChooser(_playlistModalSongId); }
  inp.value = '';
}

// ─── SETTINGS ───
function openSettings() {
  const push = currentView !== 'settings';
  showView('settings');
  window.scrollTo(0, 0);
  updateSettingsUI();
  renderGoogleSection();
  syncTabBar();
  if (push) navPush();
}
function updateSettingsUI() {
  updateThemeButtons(localStorage.getItem('labu-theme') || 'system');
  updateFontButtons(readerFamily);
  updateReaderSizeUI();
  applyAccent(localStorage.getItem('labu-accent') || 'madder');
  const wakeSwitch = document.getElementById('wakeSwitch');
  if (wakeSwitch) wakeSwitch.setAttribute('aria-checked', _wakeOn ? 'true' : 'false');
  const hapticSwitch = document.getElementById('hapticSwitch');
  if (hapticSwitch) hapticSwitch.setAttribute('aria-checked', _hapticsOn ? 'true' : 'false');
  renderSongbookPrefs();
}
function renderSongbookPrefs() {
  const host = document.getElementById('songbookPrefs');
  if (!host) return;
  if (!GROUPS.length) { host.innerHTML = '<p class="settings-note settings-note-inline">Loading songbooks…</p>'; return; }
  host.innerHTML = GROUPS.map(g => {
    const on = !isGroupDisabled(g.id);
    const total = (g.books || []).reduce((n, b) => n + bookCount(b), 0);
    const icon = GROUP_SVGS[g.id] || SVG.book;
    return '<div class="settings-row sb-pref">' +
      '<span class="sr-ic">' + icon + '</span>' +
      '<span class="sr-label">' + esc(g.name) + '<span class="sb-pref-meta">' + total.toLocaleString() + ' songs</span></span>' +
      '<button type="button" class="sb-switch" role="switch" aria-checked="' + on + '" aria-label="' + esc(g.name) + '" data-action="toggleSongbook" data-id="' + g.id + '"><span></span></button>' +
      '</div>';
  }).join('');
}
function toggleSongbook(id) {
  const g = GROUPS.find(x => x.id === id);
  if (!g) return;
  const wasDisabled = isGroupDisabled(id);
  if (wasDisabled) disabledGroups = disabledGroups.filter(x => x !== id);
  else {
    if (enabledGroups().length <= 1) {  return; }
    disabledGroups.push(id);
  }
  saveDisabledGroups();
  _groupsSig = null;
  updateStats();
  renderSongbookPrefs();
  renderSidebarGroups();
  // Rebuild even while Settings is open: Home may be one back-tap away and its
  // cached DOM would otherwise still show the collection we just turned off.
  renderGroups();
  // The switch already shows the new state — no toast for a routine toggle.
}
function setWakeLock(on) {
  _wakeOn = !!on;
  localStorage.setItem('labu_wake', _wakeOn ? '1' : '0');
  if (_wakeOn) requestWakeLock(); else releaseWakeLock();
  updateSettingsUI();
}
function setHaptics(on) {
  const next = !!on;
  if (next) { _hapticsOn = true; haptic(12); }
  else { if (_hapticsOn) haptic(10); _hapticsOn = false; }
  localStorage.setItem('labu_haptics', next ? '1' : '0');
  updateSettingsUI();
}
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) {  _wakeOn = false; localStorage.setItem('labu_wake','0'); return; }
  try { _wakeLockObj = await navigator.wakeLock.request('screen'); } catch (e) { /* user denied or unsupported */ }
}
function releaseWakeLock() { if (_wakeLockObj) { _wakeLockObj.release(); _wakeLockObj = null; } }
document.addEventListener('visibilitychange', () => { if (_wakeOn && document.visibilityState === 'visible') requestWakeLock(); });
function resetLocalEdits() {
  document.getElementById('confirmMsg').textContent = 'Reset all local edits? This will remove your changes and restore the published songs.';
  openModal('confirmModal');
  document.getElementById('confirmBtn').textContent = 'Reset';
  document.getElementById('confirmBtn').onclick = async () => {
    try { localStorage.removeItem('labu_chord_charts_v1'); } catch (e) {}
    USER_CHORD_IDS.forEach(id => delete CHORD_CHARTS[id]); USER_CHORD_IDS.clear();
    try { const db = await _idbOpen(); const tx = db.transaction(['cache','edits'], 'readwrite'); tx.objectStore('cache').clear(); tx.objectStore('edits').clear(); } catch(e) {}
    closeModal('confirmModal');
    setTimeout(() => location.reload(), 800);
  };
}

// ─── BACKUP / RESTORE (no accounts — a backup file is the only way to move
// favorites, playlists, edits and settings between devices or recover from a wipe) ───
function isSafeBackupId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9&_.-]{1,160}$/.test(v)
    && v !== '__proto__' && v !== 'constructor' && v !== 'prototype';
}
function isSafeChart(c) {
  return !!(c && typeof c === 'object' && Array.isArray(c.lines)
    && (c.verseLines == null || (Array.isArray(c.verseLines) && c.verseLines.every(Array.isArray)))
    && (c.chords == null || Array.isArray(c.chords)));
}
function isSafeEdit(e) {
  if (!e || typeof e !== 'object' || !isSafeBackupId(e.id)) return false;
  const structural = ['addGroup', 'addBook', 'renameGroup', 'renameBook', 'deleteBook', 'deleteGroup'];
  if (e.cat === null) {
    if (!structural.includes(e.op)) return false;
  } else if (!isSafeBackupId(e.cat) || (e.op !== 'update' && e.op !== 'delete')) return false;
  if (e.from != null && !isSafeBackupId(e.from)) return false;
  if (!e.song || typeof e.song !== 'object' || Array.isArray(e.song)) return false;
  if (e.cat !== null) {
    if (!isSafeBackupId(e.song.id) || e.song.id !== e.id) return false;
    if (e.op === 'update') {
      if (typeof e.song.title !== 'string' || !e.song.title.trim()) return false;
      // Older published overlays may omit verses; the reader already tolerates
      // a missing verse list. Only validate it when present.
      if (e.song.verses != null && (!Array.isArray(e.song.verses)
        || !e.song.verses.every(v => v && typeof v === 'object' && Array.isArray(v.lines)
          && v.lines.every(line => typeof line === 'string')))) return false;
    }
  }
  if (e.op === 'addGroup') {
    return isSafeBackupId(e.song.id) && Array.isArray(e.song.books) && e.song.books.every(isSafeBackupId)
      && (e.song.bookDefs == null || (Array.isArray(e.song.bookDefs) && e.song.bookDefs.every(b => b && isSafeBackupId(b.code))));
  }
  if (e.op === 'addBook') return isSafeBackupId(e.song.code) && isSafeBackupId(e.song.group);
  return true;
}
function isValidBackup(data) {
  if (!data || data.app !== 'khristian-labu' || !Array.isArray(data.favorites) || !data.favorites.every(x => typeof x === 'string')) return false;
  for (const key of ['recents', 'searchHistory', 'disabledGroups']) {
    if (data[key] != null && (!Array.isArray(data[key]) || !data[key].every(x => typeof x === 'string'))) return false;
  }
  if (data.playlists != null && (!Array.isArray(data.playlists) || !data.playlists.every(p => p && isSafeBackupId(p.id) && typeof p.name === 'string' && Array.isArray(p.songs) && p.songs.every(x => typeof x === 'string')))) return false;
  if (data.edits != null && (!Array.isArray(data.edits) || !data.edits.every(isSafeEdit))) return false;
  if (data.chordCharts != null && (typeof data.chordCharts !== 'object' || Array.isArray(data.chordCharts) || !Object.entries(data.chordCharts).every(([id, c]) => isSafeBackupId(id) && isSafeChart(c)))) return false;
  if (data.readerFont != null && typeof data.readerFont !== 'number') return false;
  if (data.readerLH != null && typeof data.readerLH !== 'number') return false;
  return true;
}
async function buildBackupPayload() {
  let edits = [];
  try { edits = await idbGetAll('edits'); } catch (e) {}
  const chordCharts = {};
  USER_CHORD_IDS.forEach(id => { if (CHORD_CHARTS[id]) chordCharts[id] = CHORD_CHARTS[id]; });
  return {
    app: 'khristian-labu',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    favorites, recents, playlists, searchHistory, disabledGroups,
    theme: localStorage.getItem('labu-theme') || 'system',
    readerFont, readerLH, readerFamily,
    edits, chordCharts
  };
}
async function backupData() {
  downloadFile(JSON.stringify(await buildBackupPayload(), null, 2), 'khristian-labu-backup.json', 'application/json');
}
document.getElementById('restoreFile').addEventListener('change', function() {
  const f = this.files && this.files[0];
  this.value = '';
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) {  return; }
    if (!isValidBackup(data)) {  return; }
    confirmDangerous('Restore favorites, recents, playlists, settings and edits from this backup? Current data will be replaced.', 'Restore', () => applyBackup(data));
  };
  reader.readAsText(f);
});
async function applyBackup(data) {
  if (!isValidBackup(data)) {  return; }
  try {
    favorites = Array.isArray(data.favorites) ? data.favorites.slice() : [];
    localStorage.setItem('labu_favs', JSON.stringify(favorites));
    recents = Array.isArray(data.recents) ? data.recents.slice() : [];
    localStorage.setItem('labu_recents', JSON.stringify(recents));
    playlists = Array.isArray(data.playlists) ? data.playlists.slice() : [];
    savePlaylists();
    searchHistory = Array.isArray(data.searchHistory) ? data.searchHistory.slice() : [];
    localStorage.setItem('labu_search_history', JSON.stringify(searchHistory));
    disabledGroups = Array.isArray(data.disabledGroups) ? data.disabledGroups.filter(id => typeof id === 'string') : [];
    saveDisabledGroups();
    if (data.theme) localStorage.setItem('labu-theme', data.theme);
    if (data.readerFont != null) localStorage.setItem('labu-reader-font', data.readerFont);
    if (data.readerLH != null) localStorage.setItem('labu-reader-lh', data.readerLH);
    if (data.readerFamily) localStorage.setItem('labu-reader-family', data.readerFamily);
    if (data.chordCharts) {
      USER_CHORD_IDS.forEach(id => delete CHORD_CHARTS[id]);
      USER_CHORD_IDS.clear();
      const saved = {};
      Object.entries(data.chordCharts).forEach(([id, chart]) => { CHORD_CHARTS[id] = chart; USER_CHORD_IDS.add(id); saved[id] = chart; });
      localStorage.setItem('labu_chord_charts_v1', JSON.stringify(saved));
    }
    const db = await _idbOpen();
    const tx = db.transaction('edits', 'readwrite');
    tx.objectStore('edits').clear();
    (data.edits || []).forEach(e => { if (e && e.id) tx.objectStore('edits').put(e); });
    await new Promise(res => { tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
    setTimeout(() => location.reload(), 900);
  } catch (e) {  }
}

// ─── GOOGLE DRIVE BACKUP / RESTORE (the user's own Drive is the sync store) ───
// Web uses the Google Identity Services popup; the APK (Capacitor WebView) uses the
// native @capawesome/capacitor-google-sign-in plugin, because Google blocks its
// sign-in popups inside embedded WebViews (disallowed_useragent).
let _gisLoaded = null;
function loadGis() {
  if (window.google && window.google.accounts) return Promise.resolve();
  if (_gisLoaded) return _gisLoaded;
  _gisLoaded = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => { _gisLoaded = null; rej(new Error('Could not load Google sign-in')); };
    document.head.appendChild(s);
  });
  return _gisLoaded;
}
function decodeJwt(t) {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; }
}
let _gToken = null; // { access_token, email, name, picture }
function _nativeGoogle() {
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
  return (cap.Plugins && cap.Plugins.GoogleSignIn) || null;
}
function _gisToken(prompt) { // request an access token via the GIS popup (web)
  return loadGis().then(() => new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE + ' openid email profile',
      prompt: prompt,
      callback: resp => {
        if (resp && resp.access_token) resolve(resp);
        else reject(new Error((resp && resp.error_description) || 'Sign-in cancelled'));
      },
      error_callback: err => reject(new Error((err && err.message) || 'Google sign-in failed'))
    });
    client.requestAccessToken();
  }));
}
async function _ensureGoogleToken() {
  if (_gToken && _gToken.access_token) return _gToken;
  if (_nativeGoogle()) {
    const p = _nativeGoogle();
    await p.initialize({ clientId: GOOGLE_CLIENT_ID, scopes: [GOOGLE_DRIVE_SCOPE] });
    const res = await p.signIn();
    if (!res || !res.accessToken) throw new Error('Google sign-in returned no access token');
    _gToken = { access_token: res.accessToken, email: res.email || '', name: res.displayName || '', picture: res.imageUrl || '' };
  } else {
    let resp;
    try { resp = await _gisToken(''); } catch (e) { resp = await _gisToken(undefined); } // silent refresh first, popup fallback
    const id = resp.id_token ? decodeJwt(resp.id_token) : {};
    _gToken = { access_token: resp.access_token, email: id.email || '', name: id.name || '', picture: id.picture || '' };
  }
  localStorage.setItem('labu_google', JSON.stringify({ email: _gToken.email, name: _gToken.name, picture: _gToken.picture }));
  return _gToken;
}
async function googleSignIn() {
  if (!GOOGLE_CLIENT_ID) {  return; }
  try {
    await _ensureGoogleToken();
    renderGoogleSection();
  } catch (e) {
  }
}
async function googleSignOut() {
  const legacy = readJSON('labu_google_token', null);
  const legacyToken = typeof legacy === 'string' ? legacy : (legacy && legacy.access_token);
  const token = (_gToken && _gToken.access_token) || legacyToken;
  _gToken = null;
  localStorage.removeItem('labu_google');
  localStorage.removeItem('labu_google_token'); // clear tokens left by older builds
  try {
    if (token) {
      await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' });
    }
    if (_nativeGoogle()) await _nativeGoogle().signOut();
  } catch (e) {}
  renderGoogleSection();
}
function renderGoogleSection() {
  const sec = document.getElementById('googleSection');
  if (!sec) return;
  sec.style.display = GOOGLE_CLIENT_ID ? '' : 'none';
  if (!GOOGLE_CLIENT_ID) return;
  const g = readJSON('labu_google', null, v => v && typeof v === 'object');
  const out = document.getElementById('googleSignedOut'), inn = document.getElementById('googleSignedIn');
  const signedIn = !!(g && (g.email || g.name));
  out.classList.toggle('is-hidden', signedIn);
  inn.classList.toggle('is-hidden', !signedIn);
  if (signedIn) {
    const av = document.getElementById('googleAvatar'); if (av) av.src = g.picture || '';
    const nm = document.getElementById('googleName'); if (nm) nm.textContent = g.name || '';
    const em = document.getElementById('googleEmail'); if (em) em.textContent = g.email || '';
  }
}
async function _driveApi(path, opts) {
  const t = await _ensureGoogleToken();
  const res = await fetch('https://www.googleapis.com/drive/v3' + path, Object.assign({}, opts, {
    headers: Object.assign({ 'Authorization': 'Bearer ' + t.access_token }, (opts && opts.headers) || {})
  }));
  // token expired → drop cache, fetch a fresh one, retry once
  if (res.status === 401 && !(opts && opts._retried)) {
    _gToken = null;
    return _driveApi(path, Object.assign({}, opts, { _retried: true }));
  }
  return res;
}
async function _driveFindBackup() {
  const res = await _driveApi('/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=10');
  if (!res.ok) throw new Error('Drive list failed (' + res.status + ')');
  const d = await res.json();
  return (d.files || []).find(f => f.name === GOOGLE_BACKUP_FILE) || null;
}
async function backupToGoogle() {
  if (!GOOGLE_CLIENT_ID) {  return; }
  try {
    const body = JSON.stringify(await buildBackupPayload());
    let file = await _driveFindBackup();
    if (!file) {
      const metaRes = await _driveApi('/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: GOOGLE_BACKUP_FILE, parents: ['appDataFolder'] })
      });
      if (!metaRes.ok) throw new Error('Drive create failed (' + metaRes.status + ')');
      file = await metaRes.json();
    }
    const up = await _driveApi('/files/' + file.id + '?uploadType=media', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: body
    });
    if (!up.ok) throw new Error('Drive upload failed (' + up.status + ')');
  } catch (e) {
  }
}
async function restoreFromGoogle() {
  if (!GOOGLE_CLIENT_ID) {  return; }
  try {
    const file = await _driveFindBackup();
    if (!file) {  return; }
    const res = await _driveApi('/files/' + file.id + '?alt=media');
    if (!res.ok) throw new Error('Download failed (' + res.status + ')');
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Backup file is corrupt'); }
    if (!isValidBackup(data)) throw new Error('Not a valid backup file');
    const when = file.modifiedTime ? ' from ' + new Date(file.modifiedTime).toLocaleString() : '';
    confirmDangerous('Replace your current data with the Google Drive backup' + when + '?', 'Restore', () => applyBackup(data));
  } catch (e) {
  }
}

// ─── WHATSAPP SHARE (text) & FULL-SONG IMAGE SHARE ───
function toggleWaMenu(e) {
  if (e) e.stopPropagation();
  const m = document.getElementById('waMenu'), f = document.getElementById('waFab');
  if (!m || !f) return;
  const open = !m.classList.contains('open');
  if (open) renderReaderMenu(); // fresh favourite state / solfa availability
  m.classList.toggle('open', open);
  f.classList.toggle('active', open);
  f.setAttribute('aria-expanded', open ? 'true' : 'false');
  // ponytail: warm the capture engine while the menu is open — first "Share as
  // image" otherwise pays script load + parse on top of the render.
  if (open) loadHtml2canvas().catch(() => {});
}
function closeWaMenu() {
  const m = document.getElementById('waMenu'); if (m) m.classList.remove('open');
  const f = document.getElementById('waFab');
  if (f) { f.classList.remove('active'); f.setAttribute('aria-expanded', 'false'); }
}
document.addEventListener('click', e => {
  // The FAB toggles the menu itself; a blanket close here would race that
  // handler and make the close button reopen the menu.
  if (!e.target || !e.target.closest || !e.target.closest('#waFabWrap')) closeWaMenu();
});

function shareWhatsAppText() {
  closeWaMenu();
  const song = currentList[currentSongIdx];
  if (!song) return;
  const text = songToText(song.id);
  const url = 'https://wa.me/?text=' + encodeURIComponent(text);
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (native) {
    // ponytail: open the installed WhatsApp app via its URL scheme; fall back to wa.me in the system browser.
    const launcher = window.Capacitor.Plugins && window.Capacitor.Plugins.AppLauncher;
    if (launcher) {
      const wa = 'whatsapp://send?text=' + encodeURIComponent(text);
      launcher.canOpenUrl({ url: wa }).then(r => {
        if (r && r.value) launcher.openUrl({ url: wa });
        else window.open(url, '_system');
      }).catch(() => window.open(url, '_system'));
      return;
    }
  }
  window.open(url, '_blank');
}

// capture a full-height screenshot of the current song, even when it scrolls.
let _h2cLoaded = null;
function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (_h2cLoaded) return _h2cLoaded;
  _h2cLoaded = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/html2canvas.min.js';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => { _h2cLoaded = null; rej(new Error('Could not load the screenshot engine')); };
    document.head.appendChild(s);
  });
  return _h2cLoaded;
}
async function captureFullSong() {
  await loadHtml2canvas();
  const src = document.getElementById('songDetail');
  if (!src) return null;
  // ponytail: render a pristine clone off-screen at the song's real width, stripped of
  // interactive chrome (action row, verse jump, back link) so the image is just the lyric.
  // Share card follows the app's current theme — light in light mode, dark in dark mode.
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const bg = isLight ? '#F2F5FB' : '#090A10';
  const textColor = isLight ? '#0B1020' : '#EEF2FA';
  const clone = src.cloneNode(true);
  clone.querySelectorAll('.song-actions-row, .verse-jump, .song-detail-back').forEach(el => el.remove());
  // Build a fully self-contained wrapper with inline styles that override
  // every ancestor background/shadow/overlay — the image is only the lyrics.
  const wrap = document.createElement('div');
  wrap.setAttribute('data-theme', isLight ? 'light' : 'dark');
  // ponytail: no negative z-index (root-stacking quirk) and overflow hidden (stray
  // scrollbar stripe on the right edge of shared images).
  wrap.style.cssText = 'position:absolute;left:-10000px;top:0;width:' + src.offsetWidth + 'px;overflow:hidden;pointer-events:none;background:' + bg + ';color:' + textColor + ';';
  clone.style.cssText = 'background:' + bg + ';color:' + textColor + ';box-shadow:none;border:none;opacity:1;transform:none;';
  // ponytail: paint verses OPAQUE with the card bg. Transparent verse layers let
  // underlying composited layers bleed through html2canvas in some engines — the
  // "translucent black/white overlay" users saw on shared lyrics images
  // (pixel-proven: opaque verse bg == zero drifted pixels).
  clone.querySelectorAll('.verse').forEach(v => { v.style.cssText = 'background:' + bg + ';transform:none;'; });
  clone.querySelectorAll('.verse p').forEach(p => { p.style.color = textColor; });
  // ponytail: freeze entrance animations (.verse/.header use fade-in). Sharing right
  // after opening a song used to snapshot verses mid-fade — text rendered
  // semi-transparent, reading as a hazy overlay over the lyrics.
  document.body.classList.add('capture-still');
  clone.querySelectorAll('.verse-type').forEach(vt => { /* keep verse-type badge colors */ });
  clone.querySelectorAll('.song-detail-header').forEach(h => { h.style.borderBottomColor = isLight ? '#D4DEEE' : '#1F2939'; });
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  // Hide body pseudo-element overlays (grid/radials) via permanent CSS rule
  document.body.classList.add('capture-mode');
  // Hide chrome during capture. ponytail: nav must be visibility:hidden, NOT
  // display:none — it's position:sticky IN FLOW, so removing it yanks the whole
  // page up by its height for the duration of the capture (the "page jumps" bug).
  document.body.classList.add('capture-hide-chrome');
  try {
    const canvas = await html2canvas(clone, {
      scale: 2, useCORS: true, logging: false,
      backgroundColor: bg,
      // ponytail: pin the render window to the card — html2canvas otherwise uses
      // viewport/scroll metrics, which bleeds a scrollbar stripe into the right
      // edge of the shared image on some engines.
      scrollX: 0, scrollY: 0, windowWidth: src.offsetWidth, windowHeight: src.scrollHeight + 64,
      // ponytail: WebView html2canvas composites fixed body::before/::after (grid + radial
      // accents) ON TOP of the captured subtree, and a live class toggle isn't reliably
      // honored there. Apply the hide rules in the render clone with CSSOM so they also
      // work under a style-src CSP that rejects inline <style> elements.
      onclone: (clonedDoc) => {
        clonedDoc.body.classList.add('capture-mode', 'capture-still', 'capture-hide-chrome');
        const Ctor = clonedDoc.defaultView && clonedDoc.defaultView.CSSStyleSheet;
        if (Ctor) {
          const sheet = new Ctor();
          sheet.replaceSync('body::before,body::after{display:none!important;background:none!important;}' +
            '.modal-overlay{display:none!important;}' +
            'nav,#tabBar{visibility:hidden!important;}#waFabWrap{display:none!important;}' +
            '#songDetail *{animation:none!important;transition:none!important;opacity:1!important;}');
          clonedDoc.adoptedStyleSheets = clonedDoc.adoptedStyleSheets.concat(sheet);
        }
      }
    });
    // ponytail: flatten to opaque RGB so no transparent pixels survive into the
    // shared PNG — on some devices/WhatsApp transparent pixels composite against
    // a black background, creating a visible dark overlay.
    const flatCanvas = document.createElement('canvas');
    flatCanvas.width = canvas.width;
    flatCanvas.height = canvas.height;
    const fctx = flatCanvas.getContext('2d');
    fctx.fillStyle = bg;
    fctx.fillRect(0, 0, flatCanvas.width, flatCanvas.height);
    fctx.drawImage(canvas, 0, 0);
    return await new Promise(res => flatCanvas.toBlob(res, 'image/png'));
  } finally {
    document.body.classList.remove('capture-mode', 'capture-still', 'capture-hide-chrome');
    wrap.remove();
  }
}
function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
async function shareImageBlob(blob, song) {
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (native) {
    // ponytail: write the PNG to the app cache and hand the file:// URI to the native share sheet.
    const fs = window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    const share = window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
    if (fs && share) {
      const name = 'song-' + Date.now() + '.png';
      try {
        await fs.writeFile({ path: name, data: await blobToBase64(blob), directory: 'CACHE', recursive: true });
        const uri = await fs.getUri({ path: name, directory: 'CACHE' });
        await share.share({ title: song.title || 'Song', files: [uri.uri], dialogTitle: 'Share song image' });
      } finally {
        try { await fs.deleteFile({ path: name, directory: 'CACHE' }); } catch (e) {}
      }
      return;
    }
  }
  const file = new File([blob], 'song.png', { type: 'image/png' });
  if (navigator.share) {
    try { await navigator.share({ files: [file], title: song.title || 'Song' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  // fallback: let the user download the image and share it from their gallery.
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'song-' + (song.number || song.id) + '.png';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
let _pendingImageBlob = null;
let _pendingImageSong = null;
function closeImagePreview() { closeModal('imagePreviewModal'); _pendingImageBlob = null; _pendingImageSong = null; }
async function confirmImageShare() {
  closeModal('imagePreviewModal');
  const blob = _pendingImageBlob, song = _pendingImageSong;
  _pendingImageBlob = null; _pendingImageSong = null;
  if (!blob || !song) return;
  // Auto-save to gallery before sharing
  saveSongImage(blob, song).catch(() => {});
  await shareImageBlob(blob, song);
}
// ─── IMAGE GALLERY (IndexedDB) ───
const _imgDBName = 'labu-image-gallery';
const IMAGE_GALLERY_LIMIT = 20;
function openImgDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(_imgDBName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function saveSongImage(blob, song) {
  try {
    const b64 = await blobToBase64(blob);
    const db = await openImgDB();
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').add({ title: song.title || 'Song', number: song.number || '', base64: b64, ts: Date.now() });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    db.close();
    await pruneGallery();
  } catch (e) { /* gallery save is best-effort */ }
}
async function getSavedImages() {
  const db = await openImgDB();
  const tx = db.transaction('images', 'readonly');
  const items = await new Promise((res, rej) => {
    const req = tx.objectStore('images').getAll();
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
  db.close();
  return items.reverse(); // newest first
}
async function deleteSavedImage(id) {
  const db = await openImgDB();
  const tx = db.transaction('images', 'readwrite');
  tx.objectStore('images').delete(id);
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  db.close();
}
async function pruneGallery() {
  const all = await getSavedImages();
  for (const old of all.slice(IMAGE_GALLERY_LIMIT)) {
    try { await deleteSavedImage(old.id); } catch (e) {}
  }
}
async function openGallery() {
  const all = await getSavedImages();
  const items = all.slice(0, IMAGE_GALLERY_LIMIT);
  for (const old of all.slice(IMAGE_GALLERY_LIMIT)) { try { await deleteSavedImage(old.id); } catch (e) {} }
  const container = document.getElementById('galleryGrid');
  if (!items.length) {
    container.innerHTML = '<div class="gallery-empty">No saved images yet.<br>Share a song as an image and it will appear here.</div>';
  } else {
    container.innerHTML = items.map(it => {
      const date = new Date(it.ts).toLocaleDateString();
      return '<div class="gallery-item" data-id="' + it.id + '">'
        + '<img src="data:image/png;base64,' + it.base64 + '" loading="lazy" />'
        + '<div class="gallery-meta"><span class="gallery-title">' + esc(it.title || 'Song') + (it.number ? ' #' + esc(it.number) : '') + '</span><span class="gallery-date">' + date + '</span></div>'
        + '<div class="gallery-actions">'
        + '<button data-action="shareGalleryImage" data-id="' + it.id + '" title="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></button>'
        + '<button data-action="removeGalleryImage" data-id="' + it.id + '" class="gallery-del" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
        + '</div></div>';
    }).join('');
  }
  openModal('galleryModal');
}
async function shareGalleryImage(id) {
  const db = await openImgDB();
  const tx = db.transaction('images', 'readonly');
  const item = await new Promise((res, rej) => {
    const req = tx.objectStore('images').get(id);
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
  db.close();
  if (!item) return;
  const blob = await (await fetch('data:image/png;base64,' + item.base64)).blob();
  const file = new File([blob], 'song-' + (item.number || item.id) + '.png', { type: 'image/png' });
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (native) {
    const fs = window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    const share = window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
    if (fs && share) {
      const name = 'gallery-' + Date.now() + '.png';
      try {
        await fs.writeFile({ path: name, data: item.base64, directory: 'CACHE', recursive: true });
        const uri = await fs.getUri({ path: name, directory: 'CACHE' });
        await share.share({ title: item.title, files: [uri.uri], dialogTitle: 'Share song image' });
      } finally { try { await fs.deleteFile({ path: name, directory: 'CACHE' }); } catch (e) {} }
      return;
    }
  }
  if (navigator.share) { try { await navigator.share({ files: [file], title: item.title }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'song-' + (item.number || id) + '.png'; document.body.appendChild(a); a.click(); a.remove();
}
async function removeGalleryImage(id) {
  await deleteSavedImage(id);
  const el = document.querySelector('.gallery-item[data-id="' + id + '"]');
  if (el) el.remove();
  if (!document.querySelectorAll('.gallery-item').length) {
    document.getElementById('galleryGrid').innerHTML = '<div class="gallery-empty">No saved images yet.</div>';
  }
}
// ponytail: shared preview step for every shareable image (lyrics card, solfa sheet).
async function openImagePreview(blob, song, title) {
  _pendingImageBlob = blob;
  _pendingImageSong = song;
  const url = URL.createObjectURL(blob);
  document.getElementById('imgPreviewTitle').textContent = title || song.title || 'Share Image';
  const img = document.getElementById('imgPreviewPic');
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  // ponytail: the canvas work blocks the main thread for seconds — without this
  // yield the browser's first paint already lands past the modal transition, so
  // the dialog "suddenly" appears instead of sliding up. Two rAFs = one painted
  // pre-open frame, then the animation runs.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  openModal('imagePreviewModal');
}
async function shareSongImage() {
  closeWaMenu();
  const song = currentList[currentSongIdx];
  if (!song) return;
  try {
    const blob = await captureFullSong();
    if (!blob) {  return; }
    await openImagePreview(blob, song, song.title || 'Share Image');
  } catch (e) {
  }
}
// ponytail: decode the stored AVIF sheet into a PNG blob so it can go through the
// native/web share sheet (AVIF is not shareable everywhere).
async function solfaToPng(url) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not decode the solfa sheet'));
    i.src = url;
  });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0);
  return await new Promise(res => c.toBlob(res, 'image/png'));
}
// Capacitor's WebView ignores <a download> for blob URLs, so the native shell
// exposes a MediaStore bridge that writes the file into public Downloads.
function nativeSolfaBridge() {
  const b = window.KhristianDownload;
  return b && typeof b.save === 'function' ? b : null;
}
async function saveSolfaBlob(blob, name) {
  const bridge = nativeSolfaBridge();
  if (!bridge) { downloadBlob(blob, name); return; }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  bridge.save(name, btoa(bin), blob.type || 'image/avif');
}
// Ask R2 for the 480 DPI sheet; null on offline, Save-Data, 404 or a timeout so
// the caller can always fall back to the bundled 240 DPI file.
async function fetchSolfaHdBlob(src) {
  const url = solfaHdUrl(src);
  if (!url || !solfaHdAllowed()) return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 12000) : null;
  try {
    const res = await fetch(url, { mode: 'cors', signal: ctl ? ctl.signal : undefined });
    if (!res.ok) { if (res.status === 404) _solfaHd.missing[src] = true; return null; }
    return await res.blob();
  } catch (e) { return null; }
  finally { if (timer) clearTimeout(timer); }
}
async function downloadSolfa() {
  const song = currentList[currentSongIdx];
  const sheet = currentSolfaSheet(song);
  if (!sheet) {  return; }
  const name = sheet.src.split('/').pop();
  const hd = await fetchSolfaHdBlob(sheet.src);
  if (hd) {
    _solfaHd.ready[sheet.src] = true;
    upgradeSolfaSheet(sheet.src);
    await saveSolfaBlob(hd, name);
    return;
  }
  // Native shells cannot download by link, so fetch the bundled file and save it
  // through the same bridge when HD is unavailable.
  if (nativeSolfaBridge()) {
    try {
      const res = await fetch(sheet.src);
      if (res.ok) { await saveSolfaBlob(await res.blob(), name); return; }
    } catch (e) {}
  }
  const a = document.createElement('a');
  a.href = sheet.src;
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
async function shareSolfaImage() {
  closeWaMenu();
  const song = currentList[currentSongIdx];
  const sheet = currentSolfaSheet(song);
  if (!sheet) {  return; }
  let blob = null;
  try { blob = await solfaToPng(sheet.src); } catch (e) { blob = null; }
  if (blob) {
    await openImagePreview(blob, song, 'Tonic Solfa — ' + (song.title || 'Song'));
    return;
  }
  // fallback: hand over the original sheet file so it is never a dead end.
  const a = document.createElement('a');
  a.href = sheet.src;
  a.download = sheet.src.split('/').pop();
  document.body.appendChild(a); a.click(); a.remove();
}

// ─── Delegated actions (CSP: no inline handlers) ───
// Handlers live here, not in HTML attributes. The action name is allowlisted, so
// injected markup can at most trigger an existing UI action, never arbitrary JS.
const CLICK_ACTIONS = {
  goHome, navBack, toggleSearch, clearSearchInput, openSearchModal, closeSearchModal, toggleSidebar, minimizeUpdate,
  toggleSearchBookMenu, toggleSearchSortMenu, pickSearchBook, pickSearchSort,
  restoreUpdate, closeSidebar, retryLoad, toggleFindReplace,
  openExportModal: () => openExportModal(),
  toggleAdminAdd: (el, event) => toggleAdminAdd(event), closeFindReplace, executeReplace, clearFindReplace, undoReplace,
  saveSongbook, saveBook, saveSong, ceUndo, ceRedo, requestCloseChordEditor,
  saveChordEditor, ceCloseWheel, ceWheelDelete, closeImagePreview, confirmImageShare,
  closeChordPop, playChordPop, executeExport, createPlaylistFromModal, toggleFontMenu,
  createPlaylistFromSettings, manualCheckUpdate, googleSignIn, googleSignOut,
  backupToGoogle, restoreFromGoogle, backupData, resetLocalEdits,
  toggleWaMenu: () => toggleWaMenu(),
  renderCloudPanel, cloudApproveAll, toggleSort, openChordEditor, resetChordTranspose,
  closeSolfaZoom, clearSearchHistory, clearOpenHistory, openSettings, cloudSignOut,
  openAdminAccount, adminAccountSignIn, adminChangePassword, adminAddAdmin,
  openAdminPasswordModal, openAdminAddAdminModal, openSyncHistory,
  openAdminManageModal, adminSetOtherPassword,
  adminOpenSetPass: el => openAdminSetPass(el.dataset.userId),
  adminDeleteUser: el => adminDeleteUser(el.dataset.userId),
  adminAccountSignOut: () => adminAccountSignOut(),
  openAdminAccountFromSettings: () => { closeSidebar(); openAdminAccount(); },
  openFavsThenClose: () => { openFavs(); closeSidebar(); },
  openHistoryThenClose: () => { openHistoryPage(); closeSidebar(); },
  openPlaylistsThenClose: () => { openPlaylists(); closeSidebar(); },
  openSettingsThenClose: () => { openSettings(); closeSidebar(); },
  openAdminFromSettings: () => { closeSidebar(); openAdmin(); },
  openPlaylistsFromSettings: () => { closeSidebar(); openPlaylists(); },
  closeModal: el => closeModal(el.dataset.modal),
  openModal: el => openModal(el.dataset.modal),
  adminAdd: el => adminAdd(el.dataset.kind),
  ceNudgeKey: el => ceNudgeKey(Number(el.dataset.step)),
  transposeChordView: el => transposeChordView(Number(el.dataset.step)),
  setTheme: el => setTheme(el.dataset.theme),
  setWakeLock: () => setWakeLock(!_wakeOn),
  setHaptics: () => setHaptics(!_hapticsOn),
  tabGo: el => tabGo(el.dataset.tab),
  pickRestoreFile: () => document.getElementById('restoreFile').click(),
  cloudCheckForUpdates: el => cloudCheckForUpdates(true, el),
  cloudApprove: el => cloudApprove(Number(el.dataset.proposalId), el),
  cloudReject: el => cloudReject(Number(el.dataset.proposalId), el),
  chooseFont: el => chooseFont(el.dataset.font),
  openChordShape: el => openChordShape(el),
  scrollToVerse: el => scrollToVerse(Number(el.dataset.index)),
  openSongNav: el => {
    const idx = currentSongIdx + (el.dataset.dir === 'next' ? 1 : -1);
    if (currentList[idx]) openSong(currentList[idx], el.dataset.dir);
  },
  openSolfaZoom: el => openSolfaZoom(el.dataset.sheetSrc || el.getAttribute('src') || ''),
  playKeyTone: el => playKeyTone(el),
  setReaderMode: el => setReaderMode(el.dataset.mode),
  setAccent: el => setAccent(el.dataset.accent),
  toggleCollapse: el => toggleCollapse(el.dataset.id),
  openSongbookModal: el => openSongbookModal(el.dataset.id),
  openBookModal: el => openBookModal(el.dataset.group, el.dataset.code || undefined),
  confirmDeleteGroup: el => confirmDeleteGroup(el.dataset.id),
  confirmDeleteBook: el => confirmDeleteBook(el.dataset.id),
  renamePlaylist: el => renamePlaylist(el.dataset.id),
  deletePlaylist: el => deletePlaylist(el.dataset.id),
  toggleSongbook: el => toggleSongbook(el.dataset.id),
  shareGalleryImage: el => shareGalleryImage(Number(el.dataset.id)),
  removeGalleryImage: el => removeGalleryImage(Number(el.dataset.id)),
  toggleKebab: (el, event) => toggleKebab(event, el),
  setSolfaTune: el => setSolfaTune(Number(el.dataset.tuneIndex)),
  setChordTune: el => setChordTune(Number(el.dataset.tuneIndex)),
};
const INPUT_ACTIONS = {
  search: el => onSearch(el.value),
  adminSearch: el => filterAdminSearch(el.value),
  readerFont: el => setReaderFont(el.value),
  previewFindReplace: () => previewFindReplace(),
};
const CHANGE_ACTIONS = {
  adminBook: el => filterAdminByBook(el.value),
  previewFindReplace: () => previewFindReplace(),
};
const ENTER_ACTIONS = {
  submitSearch: el => submitSearch(el),
  adminAccountSignIn: () => adminAccountSignIn(),
  adminChangePassword: () => adminChangePassword(),
  adminAddAdmin: () => adminAddAdmin(),
  adminSetOtherPassword: () => adminSetOtherPassword(),
  createPlaylistFromSettings: () => createPlaylistFromSettings(),
};
function delegatedTarget(event, attr) {
  const target = event.target;
  return target && target.closest ? target.closest('[' + attr + ']') : null;
}
document.addEventListener('click', event => {
  if (!event.target.closest?.('#searchBookMenu, #searchBookFilterWrap, #searchSortMenu, #searchSortBtn')) {
    const bookMenu = document.getElementById('searchBookMenu');
    const sortMenu = document.getElementById('searchSortMenu');
    if ((bookMenu && !bookMenu.hidden) || (sortMenu && !sortMenu.hidden)) closeSearchMenus();
  }
  const el = delegatedTarget(event, 'data-action');
  if (!el) return;
  const fn = CLICK_ACTIONS[el.dataset.action];
  if (!fn) return; // reader menu items have their own listeners
  if (el.hasAttribute('data-backdrop') && event.target !== el) return;
  if (el.dataset.action === 'toggleWaMenu' || el.dataset.action === 'toggleAdminAdd' || el.dataset.action === 'toggleKebab') {
    event.stopImmediatePropagation();
  }
  fn(el, event);
});
document.addEventListener('input', event => {
  const el = delegatedTarget(event, 'data-input-action');
  if (!el) return;
  const fn = INPUT_ACTIONS[el.dataset.inputAction];
  if (fn) fn(el, event);
});
document.addEventListener('change', event => {
  const el = delegatedTarget(event, 'data-change-action');
  if (!el) return;
  const fn = CHANGE_ACTIONS[el.dataset.changeAction];
  if (fn) fn(el, event);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  const el = delegatedTarget(event, 'data-enter-action');
  if (!el) return;
  const fn = ENTER_ACTIONS[el.dataset.enterAction];
  if (!fn) return;
  event.preventDefault();
  fn(el, event);
});

init();
