#!/usr/bin/env node
// Export the complete Supabase diff layer, including JSON payloads, before the
// D1 cutover. Uses the Management API because server-side grants intentionally
// block the secret key from reading these tables directly.
//
// Usage: node scripts/export_supabase.mjs [--out backups/supabase/YYYY-MM-DD]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');

function readEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const env = { ...readEnv(path.join(ROOT, '.env')), ...process.env };
const supabaseUrl = env.SUPABASE_URL;
const pat = env.PAT;
if (!supabaseUrl || !pat) throw new Error('SUPABASE_URL and PAT are required in .env or the environment');

const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
const outArg = process.argv.indexOf('--out');
const outDir = path.resolve(ROOT, outArg >= 0 ? process.argv[outArg + 1] : 'backups/supabase/2026-11-23');

async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase query failed (${response.status}): ${text.slice(0, 300)}`);
  const body = text ? JSON.parse(text) : [];
  // PostgREST-style aggregate queries return [{ data: ... }]; plain selects
  // return an array of rows. Normalize both shapes.
  if (Array.isArray(body) && body[0] && Object.prototype.hasOwnProperty.call(body[0], 'data')) {
    return body[0].data;
  }
  return body;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const published = await sql(`
  select coalesce(json_agg(row_to_json(t) order by t.seq), '[]'::json) as data
  from (
    select seq, kind, payload, proposal_id, published_at
    from public.published_edits
    order by seq
  ) t
`);
const proposals = await sql(`
  select coalesce(json_agg(row_to_json(t) order by t.id), '[]'::json) as data
  from (
    select id, kind, payload, summary, note, status, base_version, submitter,
           submitter_name, created_at, reviewed_at, reviewed_by
    from public.proposals
    order by id
  ) t
`);
const publishState = await sql(`
  select coalesce(json_agg(row_to_json(t)), '[]'::json) as data
  from (select id, version, updated_at from public.publish_state) t
`);
const admins = await sql(`
  select coalesce(json_agg(row_to_json(t)), '[]'::json) as data
  from (select user_id, email, created_at from public.admins order by created_at) t
`);
const authUsers = await sql(`
  select coalesce(json_agg(row_to_json(t)), '[]'::json) as data
  from (
    select id, email, created_at, email_confirmed_at, last_sign_in_at
    from auth.users
    order by created_at
  ) t
`);

const manifest = {
  exported_at: new Date().toISOString(),
  project_ref: projectRef,
  counts: {
    published_edits: published.length,
    proposals: proposals.length,
    admins: admins.length,
    auth_users: authUsers.length,
  },
  max_published_seq: published.reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0),
  max_proposal_id: proposals.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0),
  publish_state: publishState[0] || null,
  payload_sha256: {
    published_edits: published.map(row => ({ seq: row.seq, sha256: sha256(JSON.stringify(row.payload)) })),
    proposals: proposals.map(row => ({ id: row.id, sha256: sha256(JSON.stringify(row.payload)) })),
  },
};

fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
const files = {
  'published_edits.json': published,
  'proposals.json': proposals,
  'publish_state.json': publishState,
  'admins.json': admins,
  'auth_users.json': authUsers,
  'manifest.json': manifest,
};
for (const [name, value] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

console.log(`Exported to ${outDir}`);
console.log(`published_edits=${published.length} proposals=${proposals.length} admins=${admins.length} version=${publishState[0]?.version ?? 'missing'}`);
console.log(`max_seq=${manifest.max_published_seq} max_proposal_id=${manifest.max_proposal_id}`);
