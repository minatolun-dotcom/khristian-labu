// Khristian Labu service worker — app shell + offline support (free, no backend).
// ponytail: cache name is tied to DATA_VERSION; bump both together so data updates propagate.
const CACHE = 'labu-v44';
const SHELL = ['./', 'index.html', 'groups.json', 'logo.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'assets/fonts/outfit-400.woff2', 'assets/fonts/inter-400.woff2', 'assets/fonts/noto-400.woff2'];

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

  // Song data: cache-first (instant repeat loads + offline). Keyed by pathname only
  // (query stripped) so each DATA_VERSION replaces the prior entry instead of leaking.
  // ponytail: background-refresh runs on cache miss only — version bumps bump CACHE,
  // which purges the old corpus on activate, so we never silently re-fetch every visit.
  if (url.pathname.endsWith('songs.json.gzip') || url.pathname.endsWith('songs.json')) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const key = url.origin + url.pathname;
      const cached = await c.match(key);
      if (cached) return cached;
      const net = await fetch(req);
      c.put(key, net.clone());
      return net;
    })());
    return;
  }

  // Shell / navigation: network-first, cache fallback (fresh when online, works offline).
  if (req.mode === 'navigate' || SHELL.some(s => url.pathname.endsWith(s))) {
    e.respondWith(
      fetch(req).then(res => {
        const c = caches.open(CACHE); c.then(cc => cc.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req).then(m => m || caches.match('index.html')))
    );
    return;
  }

  // Anything else: network with cache fallback.
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
