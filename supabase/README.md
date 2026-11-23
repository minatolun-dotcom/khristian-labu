# Approved-change sync (Supabase) — legacy

> **Legacy path.** The web app and 1.5.63+ APKs use the Cloudflare Worker + D1 API in
> `workers/api/README.md`. Keep this project online for old APKs during the compatibility
> window; do not use this guide for new installs or new features.

Goal: a user edits a song or chord chart, the admin approves it, and every
install plus the website picks it up automatically — no rebuild, no redeploy,
no app-store release.

```
edit on any device ──► proposals (pending)
                            │  admin approves
                            ▼
                   published_edits  +  publish_state.version++
                            │
       every device checks on launch / focus / every 5 min
                            ▼
        base songs.json  +  approved overlay  +  own edits
```

The base corpus (`songs.json`) stays exactly as it is. Supabase stores only the
**diff** layer, so publishing is one small insert plus a version bump.

## 1. Create the tables and functions

Supabase → **SQL Editor** → New query → paste `supabase/schema.sql` → **Run**.
It is idempotent, so re-running after an update is safe.

## 2. Create the admin account

1. **Authentication → Users → Add user**: email + password, and confirm the
   user (or turn off "Confirm email" for this project).
2. Back in the SQL editor, register that user as an admin:

   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'you@example.com'
   on conflict (user_id) do nothing;
   ```

Only accounts in `admins` can list the queue, approve, reject or publish.
Everyone else can submit (including anonymous devices). Email + password sign-in
must be enabled (Authentication → Providers → Email; it is on by default).

## 3. Point the app at the project

Dashboard → **Project Settings → API**:

- **Project URL**
- **anon public** key (safe to ship; it is not a secret)

Put them in `.env` at the project root (git-ignored; see `.env.example`) and bake
them into the static page:

```sh
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

node scripts/set_cloud_config.mjs   # rewrites SUPABASE_CONF near APP_VERSION
```

The script writes only the publishable key and refuses `SUPABASE_SECRET_KEY`,
which must never reach a browser. Re-run it after rotating keys or on a fresh
clone, before deploying.

Leaving them empty disables cloud sync entirely — the app behaves exactly as
before and every edit stays device-local.

`window.LABU_SUPABASE = { url, anonKey }` takes precedence over the constant, so
a fork or the test harness can point somewhere else without editing the file.

## 4. Use it

- **Everyone**: Manage Songs → add / edit / delete a song, songbook or chord
  chart. The change applies on that device immediately and is submitted quietly
  — no "sent for review" toast, because the user's own device already shows the
  result. Admins, who publish directly, get *Published to all devices*.
- **Admin**: Manage Songs → **Admin sign in** (email + password). The review
  queue lists pending changes with who/when. **Approve** publishes instantly,
  **Reject** discards, **Approve all** clears the batch.
- **Every other device**: checks on launch, when the app regains focus, when it
  comes back online, and every 5 minutes. The new version is applied in place
  and the reader is re-rendered — no reload required.

## Optional: Management API access (PAT)

The app never needs this; it is for checking or operating the project from a
terminal without opening the SQL editor. Create a token at
**Dashboard → Account → Access Tokens → Generate new token**, scope it to this
project (Database → read is enough to inspect; read-write if you want to run
SQL through it), and save it in `.env`:

```sh
PAT=sbp_...
```

`.env` is git-ignored — the token grants account access, so it must never be
committed, pasted into `index.html`, or shipped to a device. Delete the token
when you no longer need it.

Query the project through the Management API (`{ref}` is the subdomain of
`SUPABASE_URL`):

```sh
curl -s -X POST \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/{ref}/database/query" \
  -d '{"query":"select * from public.publish_state"}'
```

Useful queries:

```sql
select version, updated_at from public.publish_state;              -- what devices hold
select id, status, summary, created_at from public.proposals        -- the queue
 where status = 'pending' order by id;
select seq, kind, payload from public.published_edits order by seq; -- backup / audit
select user_id, email from public.admins;
```

Note that the `service_role` / secret key has **no grants** on `admins`,
`proposals`, `published_edits` or `publish_state`: writes exist only through the
security-definer functions, so plain REST with the secret key returns `403`.
The Management API (SQL as `postgres`) is the administrative path.

## How the layers combine

1. `songs.json` (base corpus, shipped with the app / served by Pages)
2. `published_edits` in `seq` order (all approved changes)
3. the device's own `edits` in IndexedDB

Local edits deliberately stay on top, so a contributor's unapproved change is
never overwritten by someone else's approval. To drop them, Settings → *Reset
all local edits*; the published layer then shows through.

Approved chord charts live in the same overlay (`kind = 'chord'`); a chart
edited on the device still wins locally.

## Operational notes

- **Offline submissions** queue in `localStorage['labu_cloud_outbox']` and flush
  automatically when the device is back online.
- **Realtime is not used.** A 5-minute poll plus focus/online checks keeps
  battery and bandwidth low; approval is live for anyone opening the app.
- **Spam**: `submit_proposal` de-duplicates identical pending payloads, caps the
  queue at 1000 pending rows and payloads at 200 KB. For a public deployment you
  may also want Supabase rate limits or anonymous sign-in.
- **Deletes** are tombstones in the overlay (the song is removed at replay time);
  the base corpus is untouched.
- **Corpus rebuilds**: if `merge_songbooks.py` ever changes song ids, re-check
  the overlay (`select * from published_edits`) — edits keyed to vanished ids are
  skipped, and a followed-up `songs.json` refresh should absorb them.
- **Backups** (`Settings → Export`) still contain only the device's local edits
  and chord charts. The published overlay is server-side state; export it with
  `select * from published_edits` if you need a copy.

## Tests

`npm run test:cloud` runs the whole loop headlessly against a mocked Supabase
project: overlay pull, proposal submission, admin sign-in, approval and the
follow-up sync.

`npm test` runs everything, with cloud sync forced off (`window.LABU_SUPABASE =
{}`) so browser tests never touch the live project.
