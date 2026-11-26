#!/usr/bin/env node
// Stage only the files that make up the public web app. The repository
// contains 5+ GB of sources, screenshots, tooling, and APK artifacts; deploying
// the repository root to Cloudflare Pages is both slow and wrong.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');

const FILES = [
  'index.html',
  'app.js',
  'cloud-sync.js',
  'styles.css',
  'logo.png',
  'icon-192.png',
  'icon-512.png',
  'manifest.webmanifest',
  'sw.js',
  'songs.json',
  'songs.json.gzip',
  'groups.json',
  'chords.json',
  'version.json',
];

const HEADERS = path.join(ROOT, 'pages', '_headers');

for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Missing required web file: ${rel}`);
  }
}

if (!fs.existsSync(HEADERS) || !fs.statSync(HEADERS).isFile()) {
  throw new Error('Missing pages/_headers');
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const rel of FILES) {
  fs.copyFileSync(path.join(ROOT, rel), path.join(OUT, rel));
}
fs.copyFileSync(HEADERS, path.join(OUT, '_headers'));

const assets = path.join(ROOT, 'assets');
if (!fs.existsSync(assets)) throw new Error('Missing assets/ directory');
fs.cpSync(assets, path.join(OUT, 'assets'), { recursive: true });

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(OUT);
const bytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
console.log(`Staged ${files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB) in dist/`);
