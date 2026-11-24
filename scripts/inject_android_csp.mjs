#!/usr/bin/env node
// Capacitor serves the packaged app from https://localhost, so Cloudflare Pages
// headers never reach the WebView. Inject the same script policy into the copied
// shell before `cap sync`; keep it out of the web source so local API mocks in the
// browser tests remain reachable.
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'www', 'index.html');
if (!fs.existsSync(file)) throw new Error('Missing www/index.html; run the web copy step first');

const csp = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com https://apis.google.com",
  "script-src-attr 'none'",
  "style-src 'self' 'sha256-UP0QZg7irvSMvOBz9mH2PIIE28+57UiavRfeVea0l3g='",
  "style-src-attr 'none'",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' data: https://api.labu.lengkhawm.online https://labu.lengkhawm.online https://accounts.google.com https://apis.google.com https://oauth2.googleapis.com https://www.googleapis.com https://api.github.com https://raw.githubusercontent.com https://dl.labu.lengkhawm.online",
  "frame-src https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  'upgrade-insecure-requests',
].join('; ');

let html = fs.readFileSync(file, 'utf8');
if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
  console.log('Android CSP already present');
  process.exit(0);
}
const tag = `<meta http-equiv="Content-Security-Policy" content="${csp}">\n`;
if (!/<head[^>]*>/i.test(html)) throw new Error('www/index.html has no <head>');
html = html.replace(/<head[^>]*>/i, match => match + '\n' + tag);
fs.writeFileSync(file, html);
console.log('Injected Android WebView CSP into www/index.html');
