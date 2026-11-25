// Khristian Labu service worker — app shell + offline support.
// ponytail: cache name is tied to DATA_VERSION; bump both together so data updates propagate.
const CACHE = 'labu-v160';
const SHELL = ['./', 'index.html', 'app.js', 'styles.css', 'groups.json', 'chords.json', 'logo.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'assets/fonts/outfit-400.woff2', 'assets/fonts/inter-400.woff2', 'assets/fonts/noto-400.woff2',
  'assets/fonts/literata-400.woff2', 'assets/fonts/lora-400.woff2', 'assets/fonts/merriweather-400.woff2',
  'assets/fonts/sourceserif-400.woff2', 'assets/fonts/crimson-400.woff2', 'assets/fonts/ebgaramond-400.woff2',
  'assets/fonts/librebaskerville-400.woff2', 'assets/fonts/newsreader-400.woff2', 'assets/fonts/spectral-400.woff2',
  'assets/fonts/alegreya-400.woff2', 'assets/vendor/html2canvas.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle same-origin; let the browser deal with cross-origin (update API, fonts).
  if (url.origin !== self.location.origin) return;

  // Tonic solfa sheet images: cache-first, filled on first view (web offline).
  // ponytail: these are not precached (one AVIF per tune would bloat install).
  if (url.pathname.includes('/assets/solfa/')) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const cached = await c.match(req);
      if (cached) return cached;
      const net = await fetch(req);
      if (net.ok) c.put(req, net.clone());
      return net;
    })());
    return;
  }

  // Song data: cache-first (instant repeat loads + offline). Keyed by the FULL URL
  // including DATA_VERSION so a version bump is a cache miss even when an older
  // worker is still in control, instead of serving the previous corpus.
  // ponytail: background-refresh runs on cache miss only — version bumps bump CACHE,
  // which purges the old corpus on activate, so we never silently re-fetch every visit.
  if (url.pathname.endsWith('songs.json.gzip') || url.pathname.endsWith('songs.json')) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const key = req.url;
      const cached = await c.match(key);
      if (cached) return cached;
      const net = await fetch(req);
      if (net.ok) c.put(key, net.clone());
      return net;
    })());
    return;
  }

  // Shell / navigation: network-first, cache fallback (fresh when online, works offline).
  if (req.mode === 'navigate' || SHELL.some(s => url.pathname.endsWith(s))) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const c = caches.open(CACHE); c.then(cc => cc.put(req, res.clone())); }
        return res;
      }).catch(async () => {
        const exact = await caches.match(req);
        if (exact) return exact;
        // Versioned shell requests (groups.json?v=N) must still match the precached
        // unversioned asset; otherwise offline startup receives index.html instead.
        const loose = await caches.match(req, { ignoreSearch: true });
        if (loose) return loose;
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      })
    );
    return;
  }

  // Anything else: network with cache fallback.
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
