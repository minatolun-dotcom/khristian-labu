#!/usr/bin/env node
// Injects the Supabase project URL + publishable (anon) key from .env into
// index.html. The site is a static PWA with no bundler, so these two values have
// to be baked into SUPABASE_CONF by hand. Run this after cloning or after
// rotating keys:  node scripts/set_cloud_config.mjs
//
// Only the publishable key is written — never SUPABASE_SECRET_KEY. It is a public
// identifier (RLS and the security-definer RPCs guard every write), and it ships
// to every browser that loads the app.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const htmlPath = join(root, 'index.html');

if (!existsSync(envPath)) {
  console.error('No .env found at ' + envPath + ' — copy .env.example and fill it in.');
  process.exit(1);
}

const env = {};
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[m[1]] = v;
}

const url = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
if (missing.length) {
  console.error('Missing in .env: ' + missing.join(', '));
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error('SUPABASE_URL does not look like https://<ref>.supabase.co — got ' + url);
  process.exit(1);
}
if (/service_role|^sb_secret_/.test(key)) {
  console.error('Refusing to embed a secret key: use the publishable (anon) key.');
  process.exit(1);
}

const html = readFileSync(htmlPath, 'utf8');
const block = [
  "const SUPABASE_CONF = (typeof window !== 'undefined' && window.LABU_SUPABASE) || {",
  "  url: '" + url + "',",
  "  anonKey: '" + key + "', // publishable key — public by design, RLS guards writes",
  '};',
].join('\n');
const pattern = /const SUPABASE_CONF = \(typeof window !== 'undefined' && window\.LABU_SUPABASE\) \|\| \{[^}]*\};/;
if (!pattern.test(html)) {
  console.error('Could not find the SUPABASE_CONF block in index.html.');
  process.exit(1);
}
writeFileSync(htmlPath, html.replace(pattern, block));
console.log('Configured ' + new URL(url).host + ' (key ' + key.slice(0, 10) + '…' + key.slice(-4) + ')');
