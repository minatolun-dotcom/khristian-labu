# Khristian Labu API (Cloudflare Worker + D1)

Cloudflare Worker + D1 for the approved-change overlay. The live web app and
release 1.5.63+ use the Worker; APKs 1.5.62 and older still use Supabase during
the compatibility window.

Production:

- Worker: `labu-api`
- URL: `https://api.labu.lengkhawm.online`
- D1: `labu-prod` (`e141007a-d35c-4060-b75a-47cac022f440`, APAC)
- Config: `workers/api/wrangler.prod.jsonc`
- Data: 772 published edits, 2 approved proposals, publish version 772

Staging:

- Worker: `labu-api-staging`
- URL: `https://api-staging.labu.lengkhawm.online`
- Fallback URL: `https://labu-api-staging.minatolun.workers.dev`
- D1: `labu-staging` (`75c4dc65-e770-42d6-8e29-b643907f99f6`, APAC)
- Config: `workers/api/wrangler.jsonc`

Both use Better Auth on native D1 with the `admin` plugin and an HttpOnly session cookie.

## Local

```sh
npm run api:migrate:local
npm run api:dev
npm run test:api
```

`wrangler dev` reads local-only values from `workers/api/.dev.vars` (gitignored).
The seeded staging admin email and password are stored there; do not commit or
paste that file into chat. `SETUP_TOKEN` protects the one-time setup endpoints.

## Staging setup

The app-owned tables are applied with Wrangler. Better Auth owns its tables, so
its schema is generated inside the Worker (D1 is not reachable from the CLI
directly):

```sh
npx wrangler d1 migrations apply labu-staging --remote --config workers/api/wrangler.jsonc

# First deploy, then once:
curl -X POST -H "x-setup-token: $SETUP_TOKEN" \
  https://api-staging.labu.lengkhawm.online/api/setup/migrate

curl -X POST -H "x-setup-token: $SETUP_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"minatolun@gmail.com","password":"...","name":"Admin"}' \
  https://api-staging.labu.lengkhawm.online/api/setup/admin
```

`/api/setup/admin` only accepts an email in `ADMIN_EMAILS`, creates the account
through Better Auth (password hashed there), and sets `role = 'admin'`.
Public `/api/auth/sign-up/*` is closed; the setup endpoint bootstraps the first
admin. Only `minatolun@gmail.com` can create more through `/api/admin/users`;
those accounts are also stored with `role = 'admin'`, so no redeploy is needed.
Other admins receive `403` from that endpoint.

Deploy and secrets:

```sh
npm run api:deploy
npx wrangler secret put BETTER_AUTH_SECRET --config workers/api/wrangler.jsonc
npx wrangler secret put SETUP_TOKEN --config workers/api/wrangler.jsonc
```

Production uses the same commands with `wrangler.prod.jsonc` and the `labu-prod`
database (`npm run api:deploy:prod`, `npm run api:migrate:prod`). The production
secrets live in gitignored `workers/api/.prod.vars`; use `--config
workers/api/wrangler.prod.jsonc` for every `secret put`.

## Endpoints

| Method | Path | Access |
|---|---|---|
| GET | `/api/health` | public |
| GET | `/api/state` | public; `{version, updated_at}` |
| GET | `/api/published-edits[?since=seq]` | public; array ordered by `seq` |
| POST | `/api/proposals` | public, D1 rate-limited (20/min/IP), deduplicated |
| GET | `/api/admin/me` | admin cookie |
| POST | `/api/admin/users` | owner only; create another admin `{name?, email, password}` |
| GET | `/api/admin/proposals[?status=pending\|approved\|rejected\|all&song=id&limit=n]` | admin; default is the pending queue (array, so older clients keep working) |
| GET | `/api/admin/proposals/counts` | admin; `{pending, approved, rejected}` |
| GET | `/api/admin/proposals/:id` | admin; one submission with its patch, fingerprint and decision |
| GET | `/api/admin/song-revisions?id=songId` | admin; published revisions + reviewed decisions (incl. rejection reasons) for one song |
| POST | `/api/admin/publish` | admin; `{kind, payload, expectedVersion?}` |
| POST | `/api/admin/approve` | admin; `{ids, expectedVersion?}`; refuses stale submissions (409) |
| POST | `/api/admin/reject` | admin; `{ids, note?}`; 409 if already decided |
| * | `/api/auth/*` | Better Auth |

Admin sessions use the HttpOnly Better Auth session cookie. The client never
receives or stores a bearer token; after a reload the cookie restores the session.
Production CORS is exact-origin for
`https://labu.lengkhawm.online`, `https://localhost`, and `capacitor://localhost`;
staging adds local dev origins. The debug APK uses `https://localhost` inside Capacitor.

## Reviewing a submission

A proposal is a patch and always carries the complete proposed song (or chord
chart). To judge it, the review page needs the other side — the song as it is
published right now — and a rule for detecting that the song moved on while the
proposal waited.

- **Original** is replayed from `published_edits` for that song id
  (`workers/api/src/revisions.mjs`); the reader itself renders the published
  corpus it already has.
- **Proposed** is the proposal payload, rendered by the same reader functions
  (`reviewSongHTML`/`chordSheetHTML`), never by a second renderer.
- `GET /api/admin/proposals/:id` returns the proposal plus `published`
  (`{rev, song, cat, deleted, chart}`, replayed from the same rows), so the page
  renders "Original" from the server rather than from a device that may not have
  synced. It also returns `legacy` and `stale`, so a conflict is visible before
  the reviewer taps anything.
- **`base_rev`** is a SHA-256 fingerprint of the published revision a proposal
  was written against, computed at submission and stored on the row
  (`proposals.base_rev`, migration `0003_review.sql`). An approval recomputes it:
  if it differs, the request fails with `409 the song changed after this was
  submitted` and nothing is written.
- **Proposals written before migration `0003` (`base_rev = NULL`)** have no
  fingerprint, so the approval falls back to the publish clock: `published_edits`
  records `published_at`, and if any row for that song landed after the
  submission the approval is refused with the same `409`. If nothing for that
  song was published since, the row is still approvable (backward compatible);
  the page labels it "pre-tracking" and asks for confirmation first.

To exercise the legacy path locally, create a proposal, clear its fingerprint in
D1, then publish an edit for the same song — the detail reports `stale: true` and
the approval returns 409:

```sh
npx wrangler d1 execute labu-staging --local --config workers/api/wrangler.jsonc \
  --command "UPDATE proposals SET base_rev = NULL WHERE id = <id>"
```
- Approval writes the reviewed payload into `published_edits`, marks the
  proposal approved, and bumps `publish_state.version` in one `env.DB.batch`
  (atomic). The version bump is guarded by `WHERE version = <read version>`, so a
  concurrent approval invalidates the batch instead of interleaving with it.
- Decisions are recorded with `reviewed_by`, `reviewed_by_name` (snapshot, so a
  deleted admin still reads correctly) and `reviewed_at`; rejections keep the
  optional reason in `note`.

No Turnstile/WAF change was needed: proposal submits are already IP rate-limited
(20/min) and payload-capped, and every moderation route requires the admin
session checked on the Worker.

## Data and backups

```sh
node scripts/export_supabase.mjs   # full payload export + checksums
node scripts/import_d1.mjs         # idempotent SQL, preserves ids/seq
```

The 2026-11-23 staging exports are in gitignored `backups/` and in the private
`labu-backups` R2 bucket under `supabase/2026-11-23/` and `d1/2026-11-23/`.
The production export is under `supabase/2026-11-23-prod/` and
`d1/2026-11-23-prod/` (D1 baseline plus `import.sql`). The D1 export contains
Better Auth password hashes and must stay private.

```sh
npx wrangler d1 export labu-prod --remote --config workers/api/wrangler.prod.jsonc \
  --output backups/d1/2026-11-23-prod/labu-prod.sql
```

## Google sign-in (not configured yet)

No Google OAuth client credentials are present in this repository or `.env`.
The Worker accepts them when supplied:

```sh
npx wrangler secret put GOOGLE_CLIENT_IDS --config workers/api/wrangler.jsonc
npx wrangler secret put GOOGLE_CLIENT_SECRET --config workers/api/wrangler.jsonc
```

`GOOGLE_CLIENT_IDS` is a comma-separated list with the web OAuth client first,
then the Android client. Register both callback URLs —
`https://api.labu.lengkhawm.online/api/auth/callback/google` and
`https://api-staging.labu.lengkhawm.online/api/auth/callback/google` — as web
redirect URIs, and the release signing SHA-1/SHA-256 as the Android client
fingerprint. Until then, the allowlisted admin uses the email/password
break-glass path.
