#!/usr/bin/env node
// Bake the Cloudflare Worker API URL into the static app. The site has no
// bundler, so the production URL lives directly in app.js. Override it
// locally with `LABU_CLOUD_API=https://api-staging... node scripts/set_cloud_config.mjs`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const appPath = join(root, 'app.js');

const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
}

const api = String(process.env.LABU_CLOUD_API || env.LABU_CLOUD_API || 'https://api.labu.lengkhawm.online').replace(/\/+$/, '');
const parsed = new URL(api);
if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.pathname !== '/') {
  console.error('LABU_CLOUD_API must be an https origin, got ' + api);
  process.exit(1);
}

const source = readFileSync(appPath, 'utf8');
const start = source.indexOf('const CLOUD_API = String(');
const marker = ").replace(/\\/+$/, '');";
const end = start >= 0 ? source.indexOf(marker, start) : -1;
if (start < 0 || end < 0) {
  console.error('Could not find the CLOUD_API block in app.js.');
  process.exit(1);
}
const block = [
  "const CLOUD_API = String(",
  "  (typeof window !== 'undefined' && window.LABU_CLOUD_API !== undefined)",
  "    ? window.LABU_CLOUD_API",
  "    : '" + api + "'",
  ").replace(/\\/+$/, '');",
].join('\n');
writeFileSync(appPath, source.slice(0, start) + block + source.slice(end + marker.length));
console.log('Configured ' + parsed.host);
