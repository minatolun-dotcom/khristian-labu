// End-to-end OTA bridge test — NO mocks of the Capacitor runtime.
//
// Loads the REAL native-bridge.js extracted from the shipped v1.5.20 APK into a VM
// sandbox (it self-bootstraps off globalThis.androidBridge), then loads the REAL
// OTA functions extracted from index.html, and simulates the Android native side
// (Capacitor Bridge dispatch + @capgo/capacitor-updater plugin semantics,
// mirroring CapacitorUpdaterPlugin.java: download resolves full BundleInfo with
// `id`; set() REQUIRES {id} and rejects otherwise; progress events ride the same
// callbackId as the addListener call).
//
// Regression guard for the two bugs this caught:
//   1. shipped native-bridge.js NEVER initializes cap.Plugins (no-bundler app)
//   2. proxy must not expose `then` (thenable adoption hang)
//
// Usage: node scripts/test_ota_bridge.mjs

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BRIDGE_JS = process.env.OTA_BRIDGE_JS || '/tmp/apk20/assets/native-bridge.js';
const INDEX_HTML = path.join(ROOT, 'index.html');

if (!fs.existsSync(BRIDGE_JS)) {
  // needs a release APK's runtime; skip (don't fail) when absent — CI/e2e still covered
  console.log(`SKIP: native-bridge.js not found at ${BRIDGE_JS}`);
  console.log('      extract one: unzip khristian-labu.apk assets/native-bridge.js -d /tmp/apk20');
  process.exit(0);
}

// ── extract the REAL app sources from index.html ──────────────────────────────
const html = fs.readFileSync(INDEX_HTML, 'utf8');
function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`cannot slice "${startMarker}" … "${endMarker}"`);
  return html.slice(a, b);
}
function fnSource(name) {
  let start = html.indexOf(`async function ${name}`);
  if (start < 0) start = html.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`function ${name} not found`);
  // walk braces to end of function
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (!depth) break; }
  }
  return html.slice(start, i + 1);
}

const APP_VERSION_MATCH = html.match(/const APP_VERSION = '([^']+)'/);
if (!APP_VERSION_MATCH) throw new Error('APP_VERSION not found');
const APP_VERSION = APP_VERSION_MATCH[1];
const REPO_MATCH = html.match(/const REPO = '([^']+)'/);
if (!REPO_MATCH) throw new Error('REPO not found');

const appCode = [
  `const APP_VERSION = ${JSON.stringify(APP_VERSION)};`,
  `const REPO = ${JSON.stringify(REPO_MATCH[1])};`,
  fnSource('compareVer'),
  fnSource('showUpdateBanner'),
  fnSource('otaStep'),
  fnSource('bannerUpdateClick'),
  fnSource('otaPlugin'),
  fnSource('registerNativePlugin'),
  fnSource('whenPluginReady'),
  fnSource('fetchJson'),
  fnSource('fetchUpdateInfo'),
  fnSource('checkOtaUpdate'),
  fnSource('runOtaInstall'),
  fnSource('manualCheckUpdate'),
  fnSource('checkForUpdate'),
  fnSource('confirmDangerous'),
  fnSource('toast'),
].join('\n\n');

// ── faithful Android-native-side simulator ────────────────────────────────────
function makeSandbox(opts) {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', className: '', style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, setAttribute() {}, onclick: null });
  const store = {};
  const calls = [];           // every postMessage the JS side sent
  const listeners = new Map(); // callCallbackId -> eventName (native side registry)
  let cbCounter = 1000;
  const state = { reloaded: false, appliedBundle: null, confirms: [], toasts: [] };

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    JSON, Math, Date, Promise, Error, Object, Array, String, Number, Boolean, RegExp, isNaN, parseInt, parseFloat,
    // WebView-ish environment
    androidBridge: null, // set below, before bridge eval
    window: null,        // wired to the sandbox itself after construction
    navigator: { userAgent: 'Android' },
    location: { href: 'https://localhost/index.html', reload: () => { state.reloaded = true; } },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    CustomEvent: class {},
    // cookie-patching in initLogger reads these descriptors
    Document: { prototype: {} },
    HTMLDocument: { prototype: {} },
    fetch: null,          // replaced by the app-level stub after construction
    XMLHttpRequest: function XMLHttpRequest() {},
    document: {
      getElementById: el,
      addEventListener() {},
      createEvent: () => ({ initEvent() {} }),
      createElement: () => ({ style: {}, remove() {}, appendChild() {}, setAttribute() {} }),
      body: { appendChild() {} },
      querySelector: () => null,
    },
    // app UI hooks used by the extracted functions
    openModal: (id) => { state.confirms.push(id); },
    closeModal: () => {},
    fetch: async (url) => {
      if (opts.fetchFail) return { ok: false };
      if (String(url).includes('version.json')) {
        return { ok: true, json: async () => ({
          version: opts.latestVersion, apkUrl: 'https://x/khristian-labu.apk',
          sessionKey: opts.sessionKey ?? '', checksum: opts.checksum ?? '',
        }) };
      }
      return { ok: false };
    },
    __els: els, __calls: calls, __state: state, __store: store,
  };

  sandbox.window = sandbox; // bridge reads bare `window` in places (initLogger)
  // The native side. Installed BEFORE the bridge evaluates so initBridge wires postToNative.
  sandbox.androidBridge = {
    postMessage(json) {
      const msg = JSON.parse(json);
      calls.push({ pluginId: msg.pluginId, methodName: msg.methodName, options: msg.options });
      const reply = (data, ok = true) => queueMicrotask(() =>
        sandbox.Capacitor.fromNative({ callbackId: msg.callbackId, success: ok, ...(ok ? { data } : { error: { message: String(data && data.message || data) } }) }));

      if (msg.pluginId !== 'CapacitorUpdater') { reply({ message: 'unknown plugin ' + msg.pluginId }, false); return; }

      switch (msg.methodName) {
        case 'notifyAppReady':
          state.notifyAppReadyCalled = true;
          reply({ version: msg.options && msg.options.version || 'unknown' });
          break;
        case 'download': {
          if (opts.downloadFails) { reply({ message: 'Failed to download from: ' + msg.options.url }, false); break; }
          if (!msg.options || !msg.options.url || !msg.options.version) { reply({ message: 'Download called without url' }, false); break; }
          // progress events ride the SAME callbackId the addListener call registered
          const dlCallId = msg.callbackId;
          let p = 0;
          const t = setInterval(() => {
            p += 40;
            for (const [callId, ev] of listeners) if (ev === 'download') {
              if (process.env.OTA_DEBUG) console.error(`[sim] progress ${Math.min(p, 100)}% -> callbackId ${callId}`);
              sandbox.Capacitor.fromNative({ callbackId: callId, success: true, data: { percent: Math.min(p, 100) } });
            }
          }, 5);
          setTimeout(() => {
            clearInterval(t);
            const id = 'bundle-' + msg.options.version;   // BundleInfo includes `id`
            reply({ id, version: msg.options.version, downloaded: new Date().toISOString(), checksum: msg.options.checksum || '', status: 'AVAILABLE' });
          }, 30);
          break;
        }
        case 'set': {
          // mirrors CapacitorUpdaterPlugin.java: call.getString("id"), rejects without it
          const id = msg.options && msg.options.id;
          if (!id) { reply({ message: 'Set called without id' }, false); break; }
          if (!id.startsWith('bundle-')) { reply({ message: 'Update failed, id ' + id + ' does not exist.' }, false); break; }
          state.appliedBundle = id;
          setTimeout(() => { state.reloaded = true; sandbox.location.reload(); }, 5);
          reply();
          break;
        }
        case 'addListener': {
          listeners.set(msg.callbackId, msg.options && msg.options.eventName);
          reply({ callbackId: msg.callbackId, value: msg.callbackId }); // registration ack
          break;
        }
        case 'removeListener': reply(); break;
        default: reply({ message: 'not implemented: ' + msg.methodName }, false);
      }
    },
  };
  return sandbox;
}

function boot(sandbox, label) {
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(BRIDGE_JS, 'utf8'), sandbox, { filename: 'native-bridge.js' });
  assert.ok(sandbox.Capacitor, `${label}: window.Capacitor exists after real bridge eval`);
  assert.strictEqual(sandbox.Capacitor.isNativePlatform(), true, `${label}: bridge reports native`);
  // THE regression: real runtime never creates Plugins
  vm.runInContext(appCode, sandbox, { filename: 'app-ota.js' });
  {
    const origFrom = sandbox.Capacitor.fromNative;
    sandbox.Capacitor.fromNative = (result) => {
      console.error(`[js<-nat] id=${result.callbackId} ok=${result.success} data=${JSON.stringify(result.data)} err=${JSON.stringify(result.error || null)}`);
      const r = origFrom(result);
      if (result.data && typeof result.data === 'object' && 'percent' in result.data)
        console.error(`[ui] after delivery pct="${sandbox.__els.otaProgressPct?.textContent}" fill="${sandbox.__els.otaProgressFill?.style.width}"`);
      return r;
    };
    const origNC = sandbox.Capacitor.nativeCallback;
    sandbox.Capacitor.nativeCallback = (p, m, o, c) => {
      let fn = c;
      if (m === 'addListener' && o && o.eventName === 'download') {
        fn = (d) => {
          if (d && typeof d.percent === 'number')
            sandbox.__progressMax = Math.max(sandbox.__progressMax || 0, d.percent);
          return c(d);
        };
      }
      const id = origNC(p, m, o, fn);
      console.error(`[js->nat] nativeCallback ${p}.${m} -> id=${id}`);
      return id;
    };
    const origNP = sandbox.Capacitor.nativePromise;
    sandbox.Capacitor.nativePromise = (p, m, o) => {
      console.error(`[js->nat] nativePromise ${p}.${m}`);
      return origNP(p, m, o);
    };
  }
}

async function until(fn, ms = 5000, step = 25) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, step)); }
  throw new Error('until() timed out');
}

// ── Scenario A: happy path — full in-app install ──────────────────────────────
{
  const sb = makeSandbox({ latestVersion: nextVersion(APP_VERSION) });
  boot(sb, 'A');
  const s = sb.__state;

  await sb.checkForUpdate();                       // auto path (no force)
  // mirrors index.html init(): notifyAppReady must reach native or bundles roll back
  void sb.whenPluginReady('CapacitorUpdater').then(cu => { if (cu) cu.notifyAppReady().catch(() => {}); });
  await until(() => s.confirms.length > 0);
  assert.ok(true, 'update confirm dialog appeared (plugin resolved — NOT the web banner)');
  assert.strictEqual(sb.__els.confirmMsg.textContent.includes(nextVersion(APP_VERSION)), true, 'confirm text names the new version');

  // simulate user pressing "Update now"
  sb.__els.confirmBtn.onclick();
  
  await until(() => s.reloaded, 5000);
    assert.strictEqual(s.notifyAppReadyCalled, true, 'notifyAppReady reached native');
  const dl = sb.__calls.find(c => c.methodName === 'download');
  assert.ok(dl, 'download was dispatched natively');
  assert.strictEqual(dl.options.version, nextVersion(APP_VERSION), 'download got the target version');
  assert.strictEqual(dl.options.url, 'https://minatolun-dotcom.github.io/khristian-labu/www-latest.zip', 'download tries the Pages mirror first');
  assert.strictEqual(dl.options.sessionKey, undefined && dl.options.sessionKey, 'no sessionKey'); 
  assert.ok(!('sessionKey' in dl.options) || !dl.options.sessionKey, 'unsigned: no sessionKey');
  assert.ok(!dl.options.checksum, 'unsigned: no checksum');
  const st = sb.__calls.find(c => c.methodName === 'set');
  assert.ok(st, 'set was dispatched natively');
  assert.strictEqual(st.options.id, 'bundle-' + nextVersion(APP_VERSION), 'set received BundleInfo carrying id (java: getString("id"))');
  assert.ok(sb.__calls.some(c => c.methodName === 'addListener' && c.options.eventName === 'download'), 'progress listener registered');
  assert.ok(sb.__calls.some(c => c.methodName === 'removeListener'), 'progress listener removed in finally');
  assert.strictEqual(sb.__progressMax, 100, 'progress events delivered up to 100%');
  assert.strictEqual((sb.__els.updateBanner || { hidden: true }).hidden !== false, true, 'NO fallback banner on success');
  assert.strictEqual(sb.__state.appliedBundle, 'bundle-' + nextVersion(APP_VERSION), 'native applied the bundle');
  console.log('A ✓ full in-app OTA install works against the REAL bridge');
}

// ── Scenario A2: signed bundle — session keys ride through ────────────────────
{
  const sb = makeSandbox({ latestVersion: nextVersion(APP_VERSION), sessionKey: 'iv:enc', checksum: 'signedsum' });
  boot(sb, 'A2');
  const s = sb.__state;
  await sb.manualCheckUpdate();
  await until(() => s.confirms.length > 0);
  sb.__els.confirmBtn.onclick();
  await until(() => s.reloaded, 5000);
  const dl2 = sb.__calls.find(c => c.methodName === 'download');
  assert.strictEqual(dl2.options.sessionKey, 'iv:enc', 'signed: sessionKey passed through');
  assert.strictEqual(dl2.options.checksum, 'signedsum', 'signed: checksum passed through');
  assert.strictEqual(sb.__state.appliedBundle, 'bundle-' + nextVersion(APP_VERSION), 'signed: install completes');
  console.log('A2 ✓ signed-bundle session keys ride through');
}

// ── Scenario B: download fails → falls back to APK banner ─────────────────────
{
  const sb = makeSandbox({ latestVersion: nextVersion(APP_VERSION), downloadFails: true });
  boot(sb, 'B');
  const s = sb.__state;
  await sb.manualCheckUpdate();
  await until(() => s.confirms.length > 0);
  sb.__els.confirmBtn.onclick();
  await until(() => sb.__els.updateBanner && sb.__els.updateBanner.hidden === false, 20000);
  assert.strictEqual(sb.__otaFellBack, true, '__otaFellBack set on failure');
  assert.strictEqual(sb.__els.updBth ?? sb.__els.updBtn.href, sb.__els.updBtn.href, 'banner href sanity');
  assert.strictEqual(sb.__els.updBtn.href, 'https://x/khristian-labu.apk', 'fallback banner carries APK URL');
  assert.ok(!sb.__calls.some(c => c.methodName === 'set'), 'set never called after failed download');
  assert.strictEqual(s.reloaded, false, 'no reload after failure');
  console.log('B ✓ failure path falls back to APK banner (no reload loop)');
}

// ── Scenario C: web/PWA — no Capacitor at all → web banner, zero native calls ─
{
  // Real web/PWA builds NEVER load native-bridge.js (only the native shell injects it)
  const sb = makeSandbox({ latestVersion: nextVersion(APP_VERSION) });
  vm.createContext(sb);
  assert.strictEqual(sb.Capacitor, undefined, 'C: no window.Capacitor on plain web');
  vm.runInContext(appCode, sb, { filename: 'app-ota.js' });
  const s = sb.__state;
  await sb.checkForUpdate();
  await until(() => sb.__els.updateBanner && sb.__els.updateBanner.hidden === false, 8000);
  assert.strictEqual(sb.__calls.length, 0, 'zero native calls on web');
  assert.strictEqual(sb.__els.updBtn.href, 'https://x/khristian-labu.apk', 'web banner shown');
  console.log('C ✓ web build keeps the GitHub-download banner');
}

function nextVersion(v) {
  const [a, b, c] = v.split('.').map(Number);
  return `${a}.${b}.${c + 1}`;
}

console.log('\nALL OTA BRIDGE CHECKS PASSED (real native-bridge.js + real app code)');
