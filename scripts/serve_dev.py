#!/usr/bin/env python3
"""Local dev server: static files, never cached by the browser.

Unlike `python -m http.server`, every response carries `Cache-Control: no-store`,
so edits to index.html / songs.json / sw.js show up on a plain reload.

    python3 scripts/serve_dev.py [port]   # default 8080
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The app registers sw.js on every host. In dev that worker would serve cached
# shell/corpus and hide our edits, so serve a network-only worker instead: it clears
# all Cache Storage on activation and never answers a fetch from cache.
DEV_SW = """
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  await self.clients.claim();
})()));
// no fetch handler: the network stays authoritative during local development
""".lstrip()


class NoStoreHandler(SimpleHTTPRequestHandler):
    # python's mime table lacks these, and .gzip must not be served as an archive.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.avif': 'image/avif',
        '.gzip': 'application/gzip',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.woff2': 'font/woff2',
        '.js': 'text/javascript',
    }

    def _serve_dev_sw(self, head_only=False):
        body = DEV_SW.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/javascript')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?', 1)[0] == '/sw.js':
            return self._serve_dev_sw()
        super().do_GET()

    def do_HEAD(self):
        if self.path.split('?', 1)[0] == '/sw.js':
            return self._serve_dev_sw(head_only=True)
        super().do_HEAD()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = partial(NoStoreHandler, directory=ROOT)
    with ThreadingHTTPServer(('0.0.0.0', port), handler) as httpd:
        print(f'serving {ROOT} at http://localhost:{port} (no-store)', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
