# Approved-change sync (Supabase)

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
Everyone else can submit (including anonymous devices).

## 3. Point the app at the project

Dashboard → **Project Settings → API**:

- **Project URL**
- **anon public** key (safe to ship; it is not a secret)

Paste them into `index.html` near `APP_VERSION`:

```js
const SUPABASE_CONF = { url: 'https://YOUR-PROJECT.supabase.co', anonKey: 'YOUR-ANON-KEY' };
```

Leaving them empty disables cloud sync entirely — the app behaves exactly as
before and every edit stays device-local.

`window.LABU_SUPABASE = { url, anonKey }` takes precedence over the constant, so
a fork or the test harness can point somewhere else without editing the file.

## 4. Use it

- **Everyone**: Manage Songs → add / edit / delete a song, songbook or chord
  chart. The change applies on that device immediately and is submitted. The
  toast says *Sent for admin review* (or *Published to all devices* for admins).
- **Admin**: Manage Songs → **Admin sign in** (email + password). The review
  queue lists pending changes with who/when. **Approve** publishes instantly,
  **Reject** discards, **Approve all** clears the batch.
- **Every other device**: checks on launch, when the app regains focus, when it
  comes back online, and every 5 minutes. The new version is applied in place
  and the reader is re-rendered — no reload required.

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
