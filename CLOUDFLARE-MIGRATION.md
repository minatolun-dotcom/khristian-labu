# Cloudflare-first migration plan — Khristian Labu

**Status:** Phase 1 complete; Phase 2 pipeline and in-app updater complete (1.5.71 published, now carrying admin username management and HD solfa sheets served from R2); Phase 3 API complete (Google sign-in pending); Phase 4 production cutover complete, with the 30–60 day compatibility soak in progress; Phase 5 pending.
**Last audited:** 2026-11-24
**Scope:** website hosting, database/auth, APK build/distribution, and the supporting Cloudflare configuration.

### Execution log

- **2026-11-23 — Phase 1 complete.** Created the `khristian-labu` Pages project, deployed the staged `dist/` build, attached `labu.lengkhawm.online`, changed the proxied CNAME from `minatolun-dotcom.github.io` to `khristian-labu.pages.dev`, and verified the Pages domain is active.
- The live site now serves from Pages with no GitHub origin header; `/`, `songs.json`, and `songs.json.gzip` are byte-identical to the repo.
- Added a scoped Cloudflare Cache Rule for `labu.lengkhawm.online/sw.js` because the zone-level 4-hour Browser Cache TTL was overriding the Pages `no-cache` header. The rule bypasses edge cache and respects the origin header.
- Added `.github/workflows/pages.yml` and set `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` as repository Actions secrets. The automated deploy was verified in [run 45209121813](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45209121813); `npm run deploy:pages` remains the manual recovery path.
- **2026-11-23 — Phase 2 pipeline complete.** Created `labu-artifacts` and `labu-backups`, attached the active `dl.labu.lengkhawm.online` R2 domain, tracked the native Android source, added release signing, and added `.github/workflows/android-release.yml`.
- Published signed **1.5.62 (1562)** to R2 and GitHub Releases in [run 45211032332](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45211032332). Both downloads are byte-identical: **37,392,250 bytes**, SHA-256 `e2a1f41e2c19cee44a829bf4ccf95b51f1c9ad8d36dccfbe3ef4257abea4a564`.
- **2026-11-23 — rollback drill passed.** Moving the proxied CNAME to `minatolun-dotcom.github.io` reached GitHub Pages in about 20 seconds (`x-github-request-id`, `max-age=600`). Restoring DNS alone left the Pages custom domain `deactivated` and returned a temporary 522; deleting and re-adding `labu.lengkhawm.online` under Pages restored `active` and 200. This is now the required return path.
- GitHub Pages remains enabled as rollback. Do not disable it before **2026-11-30**.
- **2026-11-23 — Phase 3 API staging complete.** Created `labu-staging` D1 in APAC, added the Worker at `https://api-staging.labu.lengkhawm.online`, and implemented Better Auth on native D1 with the `admin` plugin (cookie sessions; the initial bearer plugin was later removed). Exported and imported **772 published edits**, **2 proposals**, publish version **772**; all 772 payload checksums match the Supabase export. The full API contract suite passed locally and remotely (25 checks). Test data was removed afterward, leaving the imported baseline.
- Staging admin auth uses the allowlisted email/password break-glass path (`minatolun@gmail.com`). Google OAuth is coded but disabled until web/Android client credentials are supplied. At that point the app and APK still used Supabase; Phase 4 later migrated the web client and the 1.5.63 debug build to the Worker.
- The Worker custom-domain certificate is an advanced certificate pack and took a few minutes to become active; it is now serving TLS normally.
- **2026-11-23 — 1.5.62 on-device install passed (debug key).** Built a local debug-signed 1.5.62 with Java 21, then installed it in place over 1.5.61 on the connected SM-S921B. The signature matched, so app data was preserved; `versionCode`/`versionName` are now 1562/1.5.62, cold launch took 3.2 s, and there were no fatal Android or renderer errors. The release-signed APK still uses a different certificate and still requires a one-time uninstall/reinstall.
- **2026-11-23 — Phase 4 production infrastructure complete.** Created `labu-prod` D1 in APAC and the production Worker at `https://api.labu.lengkhawm.online`. Imported the full Supabase export: **772 published edits**, **2 proposals**, publish version **772**. Better Auth tables were created and the allowlisted admin was seeded. The 25-check API contract suite passed against production, and the production test rows were removed so it matches the imported baseline.
- **2026-11-23 — web and APK client cut over to the Worker (1.5.63).** `index.html` now reads `LABU_CLOUD_API` and uses `/api/state`, `/api/published-edits`, `/api/proposals`, `/api/admin/*`, and `/api/auth/*`; Supabase is no longer in the client path. A debug-signed 1.5.63 was installed in place on the SM-S921B, and its WebView was verified reading production state version 772. The release-signed 1.5.62 APK still points at Supabase, so the public web cutover is held to avoid splitting the review queue between two databases.
- Production D1 export, the fresh Supabase export, and the D1 import SQL were uploaded to private R2 under `d1/2026-11-23-prod/` and `supabase/2026-11-23-prod/`; the D1 readback checksum matches.
- **2026-11-23 — signed 1.5.63 published.** Pushed tag `v1.5.63`; [run 45228490708](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45228490708) built and published the release in 3m34s. APK: **37,391,762 bytes**, SHA-256 `df8e184f3164ee50a7095445f26dfbe95a0aa15d0d4814d7ad8ac6917ed94dc4`. The signer certificate digest matches 1.5.62 (`1f4f4bb4dcfdbfd34b769b1fdb29a588a3cb82529e9b58a1504e410a89000afb`), so existing release installs update in place. R2 `latest.json` and GitHub Release `v1.5.63` both point at it.
- **2026-11-23 — production web cutover complete.** Pushed `main`; [run 45229428623](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45229428623) deployed Pages. The live site serves 1.5.63, `sw.js` cache `labu-v134`, and a browser check loaded state version 772 with 772 edits, no page errors, and 200s from `/api/state` and `/api/published-edits`.
- **2026-11-23/24 — native updater released and tested.** `v1.5.64` [run 45238150902](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45238150902) and `v1.5.65` [run 45239082836](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45239082836) both signed and published; 1.5.65 is **37,395,678 bytes**, SHA-256 `bea6c925bcf3aaab9f6bd399fb055c6356cfbf2559fcae15e91549b69222757d`. R2 CORS now allows `GET`/`HEAD` for the public artifacts. On the SM-S921B, 1.5.64 installed over 1.5.63 with data intact; **Settings → Check for update** fetched 1.5.65, downloaded it in-app, verified size/SHA-256, and installed it. The phone reports 1565/1.5.65 and the saved favourite is still present. Browser suite: 201/201. Android auto-allowed `REQUEST_INSTALL_PACKAGES` for the self-update, so the denied uninstall-sources handoff was not exercised on this device; its JS state and native settings intent are covered by the E2E simulation and code path.
- **2026-11-24 — signed 1.5.70 published.** [run 45394992396](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45394992396) built the APK (**37,411,562 bytes**, SHA-256 `5547624c66de2aa2cd377aa58aef7c84b570b423f27bfa474e9071b994211da8`) and [run 45394985715](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45394985715) deployed Pages. This release adds email-or-username admin sign-in, owner-only admin management, and the 480 DPI solfa sheets in R2.
- **2026-11-24 — 1.5.71 fixes the HD solfa layout shift.** A production Chromium check showed the reader moving 12 px when the sharper sheet replaced the bundled one: the 480 DPI crops are not exact 2x of the 240 DPI files, so width/height attributes did not hold the layout. The reader now pins the on-screen `aspect-ratio` before swapping, and the E2E mock serves a deliberately different-aspect sheet. Signed 1.5.71 [run 45396667821](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45396667821): **37,411,670 bytes**, SHA-256 `10c5143d0e32df80981c7cc0b9d0186bde4989fb1812e03b5412509e6ae1f11c`; Pages [run 45396661957](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45396661957). Verified live: 1077×1352 bundled swaps to 2152×2626 HD with the rendered height unchanged at 422 px, HD download 187,739 bytes, no page errors; the shipped APK carries the new `img-src`, 496 bundled sheets, and no HD files. Browser suite: **226/226**.
- **2026-11-24 — updater UX, detection, and resume verified.** Published signed 1.5.66/1566 ([run 45245733265](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45245733265), SHA-256 `02fde3e3c2ce70d53a7f39d9d9c5195b509dea12369354c624555826ac4f6d4d`), 1.5.67/1567 ([run 45246546732](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45246546732), SHA-256 `0787a46ff7c645477ef50bba9e5c370043b3b110a35b61188e6ed32204846ee4`), and 1.5.68/1568 ([run 45247374617](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45247374617), SHA-256 `db00f3d20727ff67ee448dddae9cf1510351f9da5bd6a9dcee49fca06351bd27`), all **37,397,862 bytes**. The checker now takes the higher of `version.json` and `latest.json`, so R2 can publish before Pages/raw GitHub catches up. The website hides **Check for update**; native startup shows a centered dialog and minimizes to a floating progress pill when the backdrop is tapped. Toasts are removed. On the SM-S921B, the 1.5.67 → 1.5.68 download was killed after `HTTP 200`; relaunch logged `partial resume=true bytes=285683` and `HTTP 206 append=true`, the UI showed “Resuming update…”, and 1.5.68 installed with the saved favourite intact. Browser suite: **203/203**.

---

## 1. Decision summary

| Area | Target | Why |
|---|---|---|
| Website | **Cloudflare Pages**, custom domain `labu.lengkhawm.online` | Removes GitHub Pages from the serving path; Cloudflare caching/WAF/analytics apply directly. |
| API | **Cloudflare Worker** at `api.labu.lengkhawm.online` | Keeps static hosting and stateful API independently deployable. |
| Database | **Cloudflare D1** | The app stores only a small diff/queue layer; SQLite is enough. |
| Auth | **Better Auth on D1**, Google sign-in plus a break-glass admin path | Replaces Supabase Auth without inventing a password/session system. |
| APK/artifacts | **Cloudflare R2**, custom domain `dl.labu.lengkhawm.online` | The 37.4 MB APK does not fit Cloudflare Pages' 25 MiB per-file limit. |
| Solfa sheets (HD) | **Cloudflare R2** at `labu-artifacts/solfa-hd/`, same custom domain | The app bundles 240 DPI sheets for offline use; 480 DPI copies are fetched only for viewing/downloading, so the APK stays small. |
| APK build | **GitHub Actions**, publishing artifacts to R2 | Cloudflare cannot build an Android APK with Gradle/Android SDK. |
| DNS/WAF/cache/analytics | **Cloudflare** | Already proxying the domain today. |
| Supabase | **Retire after a compatibility window** | Old APKs have the Supabase URL baked in and cannot be switched remotely. |

**Recommended order:** Pages first, then release signing + Android CI, then D1/Better Auth in staging, then a controlled cutover. Do not start by deleting Supabase.

---

## 2. Current-state audit

### 2.1 Website

- `CNAME` still contains `labu.lengkhawm.online` for the GitHub Pages rollback.
- GitHub Pages was built from `main` at `/`, with `build_type: legacy`.
- At audit time, GitHub Pages reported HTTPS certificate approved but `https_enforced: false`.
- Before the cutover, the live site was proxied by Cloudflare but its origin was GitHub Pages:
  - Response headers included `server: cloudflare` and `x-github-request-id`.
  - `cf-cache-status: DYNAMIC`; the request reached GitHub Pages rather than a Pages project.
- A `khristian-labu` Pages project now exists. Before the migration, the account had only the unrelated `zledgercraft` project.
- As of 2026-11-23, the proxied CNAME for `labu.lengkhawm.online` points to `khristian-labu.pages.dev`, and the Pages custom domain is `active`.
- Web payload is small enough for Pages:
  - `index.html`: ~531 KB
  - `songs.json`: ~5.0 MB
  - `songs.json.gzip`: ~1.4 MB
  - `assets/`: ~29 MB, 512 files
  - total staged web content: ~37 MB
- Cloudflare Pages limits: 20,000 files, 25 MiB per file, 500 builds/month on Free. Current site is comfortably inside those limits.
- The app router uses `history.pushState(buildState(), '')` with an empty URL, not path-based deep links. A SPA `_redirects` fallback is not required for current routing.
- `sw.js` uses cache `labu-v133` and precaches the shell. The version bump forces the current shell cache to refresh.
- `version.json` and the APK update checker currently use GitHub raw/GitHub Releases. Those URLs must remain available for old APKs.

### 2.2 Database and auth

Supabase stores **only the approved-change diff layer**, not the 5,723-song corpus:

- `public.proposals` — pending/rejected/approved submissions
- `public.published_edits` — append-only approved overlay
- `public.publish_state` — one row whose `version` increments
- `public.admins` — Supabase `auth.users` allowed to approve
- Postgres RLS policies and `security definer` functions enforce access
- Supabase Auth email/password is used only for the admin
- No Supabase Storage and no Realtime; devices poll on launch, focus, online, and every 5 minutes
- The publishable Supabase URL/key are baked into `index.html` by `scripts/set_cloud_config.mjs`
- Devices cache the published layer in `localStorage['labu_pub_cache']`
- Offline proposals queue in `localStorage['labu_cloud_outbox']`

The data volume is tiny. The difficult parts are **Postgres-specific behavior** (RLS, `auth.uid()`, `jsonb`, arrays, security-definer functions) and **auth**, not the row count.

### 2.3 Android/APK

- Package: `org.khristianlabu.app`
- Version at audit: `1.5.62`, versionCode `1562`; current after updater testing: `1.5.68`, versionCode `1568`
- compileSdk/targetSdk: 36; minSdk: 24
- APK size: 37,392,250 bytes (~35.7 MiB) at audit; 37,395,678 bytes for 1.5.64/1.5.65; 37,397,862 bytes for 1.5.66–1.5.68
- The APK is built and signed by `.github/workflows/android-release.yml`; `apksigner` verification passes in CI.
- Release signing uses the `KEYSTORE_*` repository secrets. Keystore values are never committed or printed.
- `android/` native source is tracked. Generated outputs, `local.properties`, copied web assets, and keystore files are ignored.
- `android/app/src/main/assets/public/` is generated by `npm run sync` and is not committed.
- 1.5.64 adds the in-app downloader/installer; 1.5.63 and older still open the APK in the browser.

### 2.4 Credentials and access

- Wrangler is authenticated with an account API token through `CLOUDFLARE_API_TOKEN`.
- GitHub CLI is authenticated as `minatolun-dotcom` with `repo` and `workflow` scopes.
- `.env` contains `SUPABASE_*`, `PAT`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `GITHUB_PAT`; `.env` is gitignored. Values must never be printed, committed, or shipped to the client.
- No Cloudflare D1 database or KV namespace exists yet.
- R2 buckets `labu-artifacts` (public APK and `latest.json`) and `labu-backups` (private) now exist. Do not reuse the separate `zledgercraft` buckets.
- The Android workflow validated the release keystore and signed APK; the signing certificate is not committed.
- The Cloudflare API token can list Pages/R2/D1 and read the `lengkhawm.online` zone (`920f905bb46558da94fc14df63506cf8`). The zone is active in the same account as the Pages project.
- The Pages custom-domain cutover was completed through the API; the old GitHub Pages CNAME target is recorded in this document for rollback.

---

## 3. Target architecture

```text
Browser / Capacitor WebView
        |
        |  static app
        v
labu.lengkhawm.online  ──►  Cloudflare Pages
        |
        |  API calls
        v
api.labu.lengkhawm.online  ──►  Cloudflare Worker
                                  ├── D1: proposals / published edits / version
                                  ├── D1: Better Auth users, sessions, accounts
                                  └── R2: backups, release metadata

APK download
        |
        v
dl.labu.lengkhawm.online  ──►  R2 bucket + Cloudflare cache

GitHub Actions ──build/sign──► APK ──upload──► R2
                                      └──────► GitHub Release (fallback)
```

Suggested names:

- Pages project: `khristian-labu`
- Worker: `labu-api`
- D1: `labu-prod`, `labu-staging`
- R2: `labu-artifacts`, `labu-backups`
- Public hosts: `labu.`, `api.labu.`, `dl.labu.`

Keep the existing `zledgercraft` resources separate.

---

## 4. Workstream A — move the website to Cloudflare Pages

### A1. Add a deterministic web build

The repository is 5.4 GB because of untracked tooling, sources, and APKs. Never upload the repository root to Pages.

Add a small staging script, for example `scripts/build-pages.mjs`, that creates `dist/` containing only:

```text
index.html
logo.png
icon-192.png
icon-512.png
manifest.webmanifest
sw.js
songs.json
songs.json.gzip
groups.json
chords.json
version.json
assets/fonts/*
assets/solfa/*
assets/vendor/*
_headers
```

Do **not** stage:

- `CNAME` (Pages uses its own custom-domain configuration)
- `.nojekyll`
- `android/`, `apk/`, `www/`
- `sources/`, `backups/`, `scripts/`, `shots/`
- `.env`, `.git`, `node_modules`
- docs, screenshots, tests

Add a package script:

```json
"build:pages": "node scripts/build-pages.mjs"
```

The generated `dist/` should be reproducible from a clean checkout.

### A2. Create the Pages project

Use GitHub Actions with a direct upload. This keeps the site on Cloudflare while making deploys reproducible from a clean checkout, without depending on a long-lived Pages Git integration.

- Workflow: `.github/workflows/pages.yml`
- Trigger: push to `main` touching web files, or manual `workflow_dispatch`
- Build command: `npm run build:pages`
- Deploy command: `npx wrangler@4.156.0 pages deploy dist --project-name=khristian-labu --branch=main`
- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

For manual recovery, `npm run deploy:pages` performs the same build and upload. The initial cutover was direct upload:

```bash
npm run build:pages
npx wrangler pages deploy dist --project-name khristian-labu --branch main
```

Git integration remains an option, but it is not required and is not enabled on the project.

### A3. Custom domain and DNS cutover

Do **not** merely edit the existing CNAME to `khristian-labu.pages.dev`; associate the domain in the Pages project first.

Order:

1. Deploy to `https://khristian-labu.pages.dev`.
2. Verify content, headers, PWA install, offline load, and the service worker.
3. Add `labu.lengkhawm.online` under **Pages → Custom domains**.
4. After the domain is active, update the proxied CNAME to `khristian-labu.pages.dev`. Do not delete the Pages custom-domain association; that is what keeps the hostname attached to the project.
5. Purge the zone cache.
6. Keep GitHub Pages enabled as a rollback for at least 7 days.
7. After the soak, disable GitHub Pages and remove the stale `CNAME`/`.nojekyll` if they are no longer useful.

**Tested rollback runbook (2026-11-23):**

1. PATCH the proxied CNAME to `minatolun-dotcom.github.io` and purge the `labu.lengkhawm.online` host cache.
2. Wait about 20 seconds; verify `x-github-request-id` and `Cache-Control: max-age=600`.
3. To return, PATCH DNS to `khristian-labu.pages.dev` and purge the host cache.
4. Do **not** assume the Pages custom domain reactivates. Delete and re-add `labu.lengkhawm.online` under the Pages project, then wait for `status: active`.
5. Verify 200, Pages' `Cache-Control: public, max-age=0, must-revalidate`, and no `x-github-request-id`.

Restoring DNS alone produced a temporary 522 during the drill; the delete/re-add step is mandatory.

The domain is already proxied by Cloudflare, so WAF/cache/analytics rules will apply after cutover.

### A4. Headers and caching

Add `_headers` to the staged site. Cloudflare Pages applies `_headers` to static assets, not to Functions responses.

Recommended starting point:

```text
/sw.js
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache

/version.json
  Cache-Control: no-store

/songs.json
  Cache-Control: public, max-age=300

/songs.json.gzip
  Cache-Control: public, max-age=300

/assets/*
  Cache-Control: public, max-age=604800

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

Do not mark non-fingerprinted assets `immutable`; the filenames do not contain content hashes. The service worker is the primary offline cache.

**Production cache rule:** the zone-level Browser Cache TTL is 4 hours and was overriding the Pages `no-cache` header on `/sw.js`. A scoped Cache Rule now matches `http.host eq "labu.lengkhawm.online" and http.request.uri.path eq "/sw.js"`, bypasses edge cache, and respects origin headers. Keep this rule; without it a stale service worker can survive for four hours.

The app now loads its code from `app.js`, has no inline event handlers, and sends a strict `script-src` CSP without `'unsafe-inline'`. Google Identity and the vendor screenshot script remain explicit sources. Keep the CSP in sync with any new script or API origin.

### A5. Service worker and version cutover

- Bump `CACHE` in `sw.js` when the shell or data changes, together with `DATA_VERSION`. A host-only cutover does not require a bump; this cutover kept the existing app payload, so the worker content is unchanged.
- Verify the old worker updates on the custom domain.
- Force one navigation test with the old cache present.
- Confirm `sw.js` is served with `no-cache`; otherwise a stale worker can survive for a long time.
- Keep `fetchSongsJSON()`'s `https://labu.lengkhawm.online/` fallback; it remains correct after Pages.
- Move the primary update metadata to Pages/R2 later, but keep the GitHub raw `version.json` fallback for old APKs.

### A6. Pages acceptance checks

- `curl -I https://labu.lengkhawm.online/` shows Cloudflare serving Pages, not GitHub (`x-github-request-id` absent).
- `sw.js`, `index.html`, and `version.json` have the intended cache headers.
- PWA install works at the custom domain.
- Offline reload works after one online load.
- Search, reader, favorites, playlists, export, share image, and admin editing still work.
- `npm test` passes against the staged site.
- Mobile Chrome and the Capacitor WebView both load the app.
- Rollback drill passed on 2026-11-23; the runbook includes re-adding the Pages custom domain.

---

## 5. Workstream B — D1 + Better Auth

### B1. Recommendation: D1, not Hyperdrive

Cloudflare gives two plausible database paths:

- **D1** — native SQLite, simple binding, free tier, 500 MB per database on Free and 10 GB on Workers Paid.
- **Hyperdrive** — acceleration/proxy in front of an existing Postgres database. It does not remove Supabase; it still requires a Postgres origin.

This app's data is a small overlay/queue, so **D1 is the correct target** if the goal is to remove Supabase. It is a schema rewrite, not a `pg_dump` import.

Do not use Workers KV for the proposal queue or publish version: KV is eventually consistent and does not provide transactional counters. Do not use R2 as a database.

### B2. Auth decision: Better Auth on D1

**Better Auth** is a good fit because it is a TypeScript auth library that can run inside the Worker and store its tables in D1. It is not a Cloudflare managed auth service; the Worker owns the auth code, secrets, and authorization checks.

Recommended configuration:

- Auth tables in D1: `user`, `session`, `account`, `verification`
- `admin` plugin for the admin role
- Google sign-in for the admin
- Email/password only as a break-glass fallback, or disabled entirely
- HttpOnly session cookies for both the website and the Capacitor app
- `SameSite=None; Secure` for the cross-origin WebView, with exact trusted origins
- `ADMIN_EMAILS` allowlist so a random Google account cannot become an admin
- No public sign-up UI; the admin account is provisioned deliberately
- `BETTER_AUTH_SECRET` stored with `wrangler secret put`, never in Git
- `baseURL = https://api.labu.lengkhawm.online`
- `trustedOrigins` includes `https://labu.lengkhawm.online`, `https://localhost`, and `capacitor://localhost`
- `advanced.ipAddress.ipAddressHeaders = ["cf-connecting-ip"]` because Workers do not populate `X-Forwarded-For` the way Better Auth expects
- Node compatibility: compatibility date on/after `2026-08-04`, or `nodejs_compat`

Why not Cloudflare Access for this:

- Access is excellent for internal dashboards and previews.
- It is not a consumer account system.
- A Capacitor WebView would have to handle Access redirects, cookies, and cross-origin sessions.
- Use Access, if at all, for `*.pages.dev` previews or an internal admin page — not as the app's admin API auth.

Why not hand-rolled JWT-only auth:

- Better Auth already provides sessions, OAuth, account linking, rate limiting, and the admin role.
- It reduces the amount of security-sensitive code you own.
- It still requires you to enforce authorization in every Worker route.

Google flow:

1. Admin taps **Admin sign in**.
2. Web uses Google Identity Services; the APK uses the existing Capacitor Google Sign-In plugin.
3. Client sends the Google ID token to Better Auth (`signIn.social({ provider: "google", idToken: { token } })`).
4. Better Auth verifies the token against the configured Google client IDs.
5. Worker checks the resulting email against `ADMIN_EMAILS` and the Better Auth admin role.
6. Non-admins are signed out immediately.
7. API mutations require a valid session and the admin role.

Google client IDs:

- Web client ID for the website
- Android client ID for the APK, with the app's SHA-1/SHA-256 signing fingerprint registered
- Better Auth accepts an array of client IDs for ID-token audience verification
- Keep Google Drive sync separate: its `drive.appdata` scope is a different feature and should not be conflated with admin login

If Google is unavailable and a fallback is required, keep one email/password admin with a strong unique password and TOTP. Do not expose public registration.

### B3. D1 schema mapping

The exact SQL belongs in a migration; this is the intended shape.

| Supabase | D1 |
|---|---|
| `admins.user_id uuid` | Better Auth `user` row with `role = 'admin'` (admin plugin), or a small `admins` table keyed by Better Auth user id |
| `publish_state.id int`, `version bigint`, `updated_at timestamptz` | `publish_state(id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, updated_at INTEGER NOT NULL)` |
| `published_edits.seq bigint identity` | `published_edits(seq INTEGER PRIMARY KEY AUTOINCREMENT, ...)`; preserve imported IDs and reset `sqlite_sequence` |
| `published_edits.payload jsonb` | `payload TEXT NOT NULL` containing JSON; parse/stringify in the Worker |
| `proposals.payload jsonb` | `payload TEXT NOT NULL`; add `payload_hash TEXT` for deduplication |
| `proposals.submitter uuid` | `submitter_user_id TEXT NULL` (normally null for anonymous submissions) |
| `proposals.reviewed_by uuid` | `reviewed_by TEXT NULL` (Better Auth user id) |
| `timestamptz` | integer Unix epoch milliseconds, or ISO text; pick one and use it consistently |
| `bigint[]` arguments | JSON array text, parsed in the Worker |
| RLS policies | Worker-side authorization; D1 is never exposed to the client |
| Security-definer functions | Worker endpoints with explicit admin checks |
| `FOR UPDATE` | D1 `batch()` transaction plus unique constraints and optimistic version checks |

Schema rules:

- `kind` check constraint: `song`, `struct`, `chord`
- `status` check constraint: `pending`, `approved`, `rejected`
- `published_edits.proposal_id` unique
- `proposals.payload_hash` indexed for duplicate detection
- Index pending proposals by `status, created_at`
- Enforce the 200 KB payload limit in the Worker and, where practical, in SQLite
- Keep the 1,000-pending-row queue cap
- Preserve `seq`/`id` values during import so clients' cached cursors remain valid

The app does not need the full corpus in D1. `songs.json` stays on Pages/R2 and in the APK.

### B4. Worker API

Suggested endpoints:

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/state` | Public; returns `{ version }` |
| `GET` | `/api/published-edits` | Public; returns `seq, kind, payload` ordered by `seq` |
| `POST` | `/api/proposals` | Anonymous, rate-limited, deduplicated |
| `GET` | `/api/admin/proposals` | Admin session |
| `POST` | `/api/admin/publish` | Admin session |
| `POST` | `/api/admin/approve` | Admin session |
| `POST` | `/api/admin/reject` | Admin session |
| `GET` | `/api/admin/me` | Admin session |
| `*` | `/api/auth/*` | Better Auth handler |

Implementation notes:

- Return only the fields the client uses; do not expose internal auth rows.
- Use exact CORS origins: the Pages domain, `https://localhost`, and `capacitor://localhost`.
- Use cookies with `credentials: include` and `SameSite=None; Secure` for the cross-origin WebView; do not issue bearer tokens to page script.
- Use `cf-connecting-ip` for rate limiting, not a client-supplied header.
- Set `Cache-Control: no-store` on admin endpoints and auth responses.
- Public state/overlay responses can use a short edge cache, but publish must invalidate or version the URL. Start with `no-store` for correctness, then optimize.
- Use `db.batch()` for approve/publish. D1 documents batched statements as SQL transactions: if one fails, the sequence rolls back. Still test the exact batch in staging.
- Use a unique `proposal_id` and an optimistic `version` check to prevent double approval.
- Return a clear `409`/`conflict` for stale approvals rather than silently overwriting.

### B5. Data migration

Before touching production:

1. Take a full Supabase backup (`pg_dump` or the Management API/SQL export).
2. Export each table to JSON/CSV:
   - `publish_state`
   - `published_edits` ordered by `seq`
   - `proposals` ordered by `id`
   - `admins` (emails/user ids)
3. Store the export in a private R2 backup bucket and locally.
4. Create `labu-staging` D1.
5. Apply the D1 schema.
6. Import with an idempotent script; preserve IDs.
7. Verify:
   - row counts
   - max `seq` and max `id`
   - `publish_state.version`
   - SHA-256 of each payload
   - a sample of approved edits applied to the corpus
8. Run the app and cloud-sync tests against the staging Worker.
9. Repeat into `labu-prod` during the cutover window.

Do not migrate Supabase Auth password hashes. They are not portable to Better Auth. Create the admin account through Better Auth/Google and verify the allowlist.

### B6. Legacy APK compatibility — important

Existing APKs have this baked into `index.html`:

```text
https://rxbrozmwznjmdgirekma.supabase.co
```

You cannot change that URL remotely. If Supabase is deleted or made unreachable, old APKs lose cloud sync but continue to work locally.

Choose one:

**Option 1 — compatibility window (recommended)**

- Keep Supabase online, read-only for old clients, for 30–60 days.
- New web/APK clients use D1.
- To keep old clients seeing new approvals, add a temporary one-way bridge: when the Worker publishes to D1, also append the same published edit and bump `publish_state` in Supabase using the server-side secret.
- Old clients can still submit proposals to Supabase; either accept that those proposals are reviewed in the old app, or run a small cron import into D1.
- Remove the bridge after old APK usage is negligible.

**Option 2 — hard cutover**

- Freeze cloud writes, export, switch, and require a new APK.
- Old APKs keep their last cached approved layer and cannot see new approvals.
- Simpler, but worse for users who do not update.

Do not shut down Supabase on the same day as the D1 cutover.

### B7. D1/Better Auth acceptance checks

- Anonymous proposal submission works and is deduplicated.
- Pending queue cap is enforced.
- Non-admin cannot read or mutate the queue.
- Admin Google sign-in works on web and in the Capacitor app.
- Admin approve/reject/publish updates `published_edits` and `publish_state` atomically.
- A second device picks up the new version and applies the overlay.
- Offline submissions queue and flush.
- Bad/expired session returns `401`; non-admin returns `403`.
- CORS works from the Pages origin, `https://localhost`, and `capacitor://localhost`.
- Rate limiting triggers on abusive proposal submissions.
- D1 backup/export and restore are tested.
- Old APK still reads the legacy layer during the compatibility window.

---

## 6. Workstream C — APK build and distribution

### C1. Cloudflare cannot build the APK

Cloudflare Pages/Workers build Node/Workers projects. They do not provide a supported Android SDK/Gradle build environment, and Workers have execution/memory limits that are a poor fit for a 37.4 MB Android build.

Cloudflare Containers could theoretically run a custom Android build image, but it would add:

- a large custom image and Android SDK maintenance
- Gradle cache/performance problems
- signing-key handling in a container
- no first-class Android build UI or artifact model

**Use GitHub Actions for the APK.** Cloudflare still stores and serves the result.

### C2. Commit the Android source

Change `.gitignore` so the native project is tracked while generated outputs stay ignored:

Track:

- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/org/khristianlabu/app/MainActivity.java`
- `android/app/src/main/res/**`
- `android/app/build.gradle`
- `android/build.gradle`
- `android/settings.gradle`
- `android/variables.gradle`
- `android/gradle.properties`
- `android/gradle/wrapper/**`
- `android/gradlew`, `android/gradlew.bat`
- `android/capacitor.settings.gradle`
- `android/app/capacitor.build.gradle`
- `android/app/proguard-rules.pro`

Ignore:

- `android/.gradle/`
- `android/build/`
- `android/app/build/`
- `android/local.properties`
- `android/app/src/main/assets/public/` (generated by `npm run sync`)
- keystores and signing files

Without this, CI cannot reproduce the current native shell, splash config, or `MainActivity`.

### C3. Release signing is a prerequisite

The current debug-signed APK cannot be updated by a new release-signed APK. Android requires the same package and signing certificate.

Before building the updater:

- Create a release keystore.
- Back it up offline in two places.
- Store the keystore base64, alias, and passwords as GitHub Actions secrets.
- Never commit the keystore.
- Configure a Gradle `release` signing config from environment variables.
- Build `assembleRelease`, not `assembleDebug`.
- Verify with `apksigner verify --print-certs`.
- Increment `versionCode` for every release.

Migration choices for the existing debug install:

1. **One-time uninstall/reinstall** to the release-signed app; add data export/import first.
2. Keep using the existing debug certificate as the release key; not recommended.
3. Use Android key rotation; complex and not reliable across the full minSdk range.

For a small user base, the clean path is a one-time migration to a proper release key now.

### C4. GitHub Actions workflow

Suggested `.github/workflows/android-release.yml`:

1. Checkout repository.
2. Set up Node and Java 21.
3. Set up Android SDK (GitHub's Ubuntu runner includes it; pin versions).
4. `npm ci`
5. `npm run sync` (copies web assets and runs `cap sync`)
6. Restore Gradle cache.
7. Decode the keystore from secrets into `$RUNNER_TEMP`.
8. `./gradlew assembleRelease` with signing environment variables.
9. `apksigner verify --print-certs`.
10. Compute SHA-256 and size.
11. Upload the APK to `s3://labu-artifacts/apk/<versionCode>/khristian-labu.apk` via the R2 S3 endpoint, or `wrangler r2 object put`.
12. Upload `latest.json` with versionCode, versionName, URL, SHA-256, size, and rollout fields.
13. Optionally create a GitHub Release as the fallback.
14. Leave website deployment to `.github/workflows/pages.yml`; do not duplicate it in the APK workflow.

Use `GITHUB_TOKEN` for the repository release; the `GITHUB_PAT` in `.env` is not needed for this workflow. Store any cross-repo token as an Actions secret, not in the repository.

### C5. R2 layout

```text
labu-artifacts/
  apk/1562/khristian-labu.apk
  apk/1563/khristian-labu.apk
  apk/1564/khristian-labu.apk
  apk/1565/khristian-labu.apk
  latest.json
  solfa-hd/BL_1-t1.avif      # 480 DPI display/download copies

labu-backups/
  supabase/2026-11-23/*.json
  d1/2026-11-23/*.sql
  supabase/2026-11-23-prod/*.json
  d1/2026-11-23-prod/*.sql
```

- APK paths are immutable; never overwrite a version path.
- `latest.json` is small and must not be cached for long.
- Attach a custom domain to the public bucket (`dl.labu.lengkhawm.online`); `r2.dev` is not for production.
- APK is in Cloudflare's default cached file types; set long-lived cache headers for versioned paths.
- Keep GitHub Releases as a fallback during the transition.
- Use a separate private bucket for backups, not the public APK bucket.

### C6. In-app update flow (implemented in 1.5.64)

The shipped path is intentionally the least-privileged one that works on a side-loaded app:

- `REQUEST_INSTALL_PACKAGES` in the manifest.
- Check `version.json`; on **Update now**, fetch `latest.json` from R2 for the URL, size, and SHA-256.
- Download into app-private cache with progress reporting (`UpdateInstaller.java`).
- Keep a `.part` file and URL/hash/size sidecar; resume an interrupted transfer with an HTTP `Range` request.
- Enforce the published size and full-file SHA-256 before doing anything with the file.
- Expose the verified file through `FileProvider` and launch `ACTION_VIEW` with the APK MIME type.
- If `canRequestPackageInstalls()` is false, open `ACTION_MANAGE_UNKNOWN_APP_SOURCES` for the package and retry on `onResume`.
- Show a centered download dialog and minimize it to a floating progress pill when the backdrop is tapped; the download continues. Permission, error, and Retry states share the dialog. Toasts are removed.
- Keep the browser/GitHub Release fallback; the website itself hides the manual check and skips startup checks.
- Android always shows its own install confirmation. This is not a silent installer.
- `UPDATE_PACKAGES_WITHOUT_USER_ACTION` / `PackageInstaller` sessions are **not** used: they do not remove OEM or Advanced Protection prompts, and they add privileged-installer complexity without a user-visible guarantee.

### C7. APK acceptance checks

- Release APK installs over the migrated release-signed build.
- VersionCode increases and data is preserved.
- APK signature is stable across two builds.
- CI produces the same version/metadata as the local build.
- R2 URL serves the correct APK and SHA-256.
- Update manifest rejects a lower versionCode.
- In-app download/install works on Android 12–17 and at least one Samsung/Xiaomi device.
- Fallback browser install works if the in-app installer is denied.
- GitHub Release fallback still works.

---

### C8. HD solfa sheets (implemented in 1.5.70/1.5.71)

The app bundles one 240 DPI AVIF per printed tune (496 files, ~26 MB) so
`assets/solfa/*` works fully offline. A 480 DPI copy of every sheet lives in R2
(~96 MB) and is fetched only when a sheet is viewed or downloaded.

```text
labu-artifacts/solfa-hd/BL_1-t1.avif    # 480 DPI, AVIF quality 70
```

- Served at `https://dl.labu.lengkhawm.online/solfa-hd/<same filename as assets/solfa>`.
- Objects are immutable: upload with `--content-type image/avif --cache-control
  "public, max-age=31536000, immutable"`. The bucket CORS rule (`r2-cors.json`)
  allows `GET`/`HEAD`, which the browser needs for the HD download fetch.
- One HD file exists per bundled sheet; `npm run solfa:hd:upload` fails if any is
  missing and uploads only the 496 bundled names.
- Rebuild: `npm run solfa:hd` (re-renders from `Tonic Solfa/Biakna Late.pdf` at
  480 DPI into gitignored `solfa-hd/`), then `npm run solfa:hd:upload`.
  `wrangler r2 object put` **must** pass `--remote`; without it the upload lands in
  Wrangler's local simulated bucket and the public URL 404s.
- Reader behaviour: the bundled sheet paints first, HD is fetched once the view
  settles, and the swap happens only after `HTMLImageElement.decode()`. The ratio
  already on screen is pinned with `aspect-ratio` before the swap, because the
  480 DPI crops are not exact 2x of the bundled files and would otherwise reflow
  the page by ~12 px.
- Skipped offline, under `Save-Data`, and on `2g`/`slow-2g`. A failed fetch keeps
  the bundled sheet and allows a retry on the next open; only a real 404 is
  remembered as missing.
- **Download tonic solfa** saves the HD file via `fetch`; on any failure it falls
  back to the bundled sheet, so the action always produces a file.
- CSP: `img-src` must include `https://dl.labu.lengkhawm.online` in both
  `pages/_headers` and the injected Android CSP (`scripts/inject_android_csp.mjs`).
  `connect-src` already allowed it for the APK updater.

## 7. Workstream D — Cloudflare operations

### 7.1 DNS and hostnames

- `labu.lengkhawm.online` → Pages
- `api.labu.lengkhawm.online` → Worker
- `dl.labu.lengkhawm.online` → R2 public bucket
- `staging.labu...` or Pages preview URLs → staging
- Keep the zone in the same Cloudflare account as the Pages project.

### 7.2 Security

- WAF/rate limit `POST /api/proposals`.
- Exact-origin CORS; do not use `*` with credentials.
- Do not expose D1 directly; only the Worker can query it.
- Do not put `CLOUDFLARE_API_TOKEN`, `SUPABASE_SECRET_KEY`, `BETTER_AUTH_SECRET`, or keystore material in the client.
- Use Cloudflare secrets for Worker secrets; GitHub Actions secrets for CI.
- Rotate the Supabase secret and Cloudflare token after migration.
- Keep `.env` ignored; update `.env.example` with placeholders only.
- Keep `X-Content-Type-Options: nosniff` and the conservative referrer policy on Pages.
- Keep the strict script CSP (`script-src-attr 'none'`) in sync with new script/API origins.
- Keep the scoped `/sw.js` Cache Rule in place; it prevents the zone's 4-hour Browser Cache TTL from overriding the service worker's `no-cache` header.
- Enable Cloudflare Access on preview deployments if they should not be public.
- Do not put Turnstile on the app's JSON API; the Capacitor app cannot reliably solve a browser challenge. Turnstile is for a web download/proposal page if one is added.

### 7.3 Observability and backups

- Cloudflare Web Analytics for the website.
- Workers Logs/analytics for API errors and latency.
- A small `POST /api/telemetry` or structured log for update check/download/install outcomes.
- Uptime checks for `labu.`, `api.`, and `dl.`.
- D1 Time Travel is available (7 days Free, 30 days Paid); still export nightly to R2.
- R2 lifecycle rules for old APK versions and backups.
- Budget/spend alerts on the Cloudflare account.
- Cloudflare Workers Free is 100,000 requests/day. With 5-minute polling, a few hundred active users can approach that; budget for Workers Paid ($5/month) if usage grows.

---

## 8. Phased execution

### Phase 0 — decisions and safety (1–2 days)

- [x] Confirm the domain zone is in the same Cloudflare account as the Pages project.
- [x] Use GitHub Actions for Pages deployment (`.github/workflows/pages.yml`), with `deploy:pages` available for manual recovery.
- [ ] Decide the admin identity: Google-only, Google + break-glass password, or password + TOTP.
- [ ] Decide the legacy APK policy: bridge Supabase or accept frozen old clients.
- [ ] Back up Supabase.
- [x] Release signing is configured and `apksigner` verification passes; on-device migration remains untested.
- [x] Commit the Android native source.
- [x] Add `.env.example` placeholders for Cloudflare/Better Auth/R2; never add values.

### Phase 1 — Pages cutover (complete, 2026-11-23)

- [x] Add `scripts/build-pages.mjs` and `npm run build:pages`.
- [x] Add `_headers` and the scoped `/sw.js` Cache Rule.
- [x] Create the `khristian-labu` Pages project.
- [x] Deploy and test `https://khristian-labu.pages.dev`.
- [x] Add the custom domain and replace the GitHub Pages DNS record.
- [x] Purge cache and verify headers/service worker.
- [x] Keep GitHub Pages as a rollback for 7 days (until at least 2026-11-30).
- [x] Add `.github/workflows/pages.yml` and set the repository's Cloudflare Actions secrets.

Live URLs:

- Production: `https://labu.lengkhawm.online/`
- Pages project: `https://khristian-labu.pages.dev/`
- Deployment: `https://4aac5eeb.khristian-labu.pages.dev/`
- Rollback CNAME target: `minatolun-dotcom.github.io`

### Phase 2 — R2 + APK pipeline (pipeline complete, 2026-11-23)

- [x] Create `labu-artifacts` and `labu-backups`.
- [x] Add the R2 custom domain.
- [x] Add release signing config.
- [x] Add GitHub Actions build/sign/upload workflow.
- [x] Publish APK v1.5.62 to R2 and GitHub Releases.
- [x] Verify signature, checksum, R2 download, and GitHub Release fallback.
- [x] Verify install/upgrade on a physical Android device — debug-signed 1.5.62 installed in place over 1.5.61 on the connected SM-S921B; data preserved, cold launch 3.2 s, no fatal errors. The release-signed APK still requires a one-time uninstall/reinstall because its key differs.
- [x] Add the in-app updater in 1.5.64; verify the 1.5.64 → 1.5.65 install and the 1.5.67 → 1.5.68 resumable/minimized flow on the SM-S921B.

Published artifacts:

- APK: `https://dl.labu.lengkhawm.online/apk/1562/khristian-labu.apk`
- Metadata: `https://dl.labu.lengkhawm.online/latest.json`
- GitHub Release: `https://github.com/minatolun-dotcom/khristian-labu/releases/tag/v1.5.62`
- SHA-256: `e2a1f41e2c19cee44a829bf4ccf95b51f1c9ad8d36dccfbe3ef4257abea4a564`
- Size: 37,392,250 bytes
- `aapt` confirms package `org.khristianlabu.app`, version `1.5.62` (1562), minSdk 24, targetSdk 36.

### Phase 3 — D1 + Better Auth staging (API complete, 2026-11-23)

- [x] Create `labu-staging` D1.
- [x] Write D1 migrations and Better Auth schema.
- [x] Create the Worker and `/api/auth/*`.
- [x] Implement public state/overlay/proposal endpoints.
- [x] Implement admin approval/publish endpoints.
- [ ] Configure Google OAuth client IDs and `ADMIN_EMAILS` — allowlist is set; Google credentials are still missing.
- [x] Add HttpOnly cookie sessions for the APK (bearer plugin removed).
- [x] Add rate limiting and CORS.
- [x] Import a copy of Supabase data into staging.
- [x] Add `scripts/test_staging_api.mjs` and run the 25-check contract suite locally and remotely.
- [x] Test the full admin/device loop — the staging browser loop passed; the device loop was verified in Phase 4 against production.

Staging details:

- Worker: `https://api-staging.labu.lengkhawm.online` (fallback `https://labu-api-staging.minatolun.workers.dev`)
- D1: `labu-staging` (`75c4dc65-e770-42d6-8e29-b643907f99f6`, APAC)
- Data: 772 published edits (seq 13–784), 2 approved proposals, version 772
- Auth: Better Auth on native D1, `admin` + HttpOnly cookie; email/password break-glass active
- Secrets: `BETTER_AUTH_SECRET` and `SETUP_TOKEN` set on the Worker; local copies live only in gitignored `workers/api/.dev.vars`
- Backup: full payload export and D1 SQL export in private R2 `labu-backups/supabase/2026-11-23/` and `labu-backups/d1/2026-11-23/`
- Test: `npm run test:api` against local Wrangler; `LABU_API_URL=https://api-staging.labu.lengkhawm.online npm run test:api` against staging
- Google sign-in: Worker code accepts `GOOGLE_CLIENT_IDS` (web + Android audience list) and `GOOGLE_CLIENT_SECRET`; no credentials exist yet, so public Google sign-in is not active

### Phase 4 — production cutover (complete, 2026-11-23; compatibility soak in progress)

- [x] Export the final Supabase data at a quiet point and import it into `labu-prod` D1 (772 edits, 2 proposals, version 772).
- [x] Deploy the production Worker at `https://api.labu.lengkhawm.online`.
- [x] Point `index.html` at `LABU_CLOUD_API`; remove Supabase from the web client path.
- [x] Build and install a debug-signed 1.5.63 on the connected device; verify the WebView reads production state.
- [x] Publish 1.5.63 signed with the release key.
- [x] Deploy the 1.5.63 web build to Pages and complete the public cutover.
- [x] Keep Supabase online for old APKs (still read/write until they are replaced).
- [x] No bridge for current data: the Supabase pending-proposal queue was empty at cutover. Monitor it during update adoption; import anything that appears before decommissioning.
- [ ] Monitor errors, sync lag, old-APK proposals, and update adoption during the 30–60 day soak.
- [ ] Decommission Supabase after the 30–60 day compatibility window, once the legacy pending-proposal queue is empty.

**Release facts:** `latest.json` → 1.5.63 (1563), SHA-256
`df8e184f3164ee50a7095445f26dfbe95a0aa15d0d4814d7ad8ac6917ed94dc4`. The release
certificate matches 1.5.62, so normal Play-style side-load updates work.

**Test-phone migration:** the debug-signed install was backed up, uninstalled, and replaced
with the published release APK. The installed APK hash and certificate match the release;
restore brought back **736 edits, 1 favourite, 20 recents, 1 chord chart**, and the reader/theme
settings. The pre-swap backup is in gitignored `backups/device/2026-11-23/` and on the phone
at `Download/khristian-labu-backup.json`.

### Phase 5 — cleanup (1 day)

- [ ] Disable GitHub Pages.
- [ ] Remove stale `CNAME`/`.nojekyll` if no longer used.
- [ ] Remove Supabase project or downgrade to a read-only archive after the soak.
- [ ] Rotate all migration-time secrets.
- [ ] Document rollback and on-call steps.

Rough engineering estimate: **2–3 weeks**, excluding the 30–60 day legacy compatibility soak and app-update adoption.

---

## 9. Risks and recommendations

### Highest-risk items

1. **APK signing migration.** A new release key cannot update the current debug-signed install. Resolve this before building the Cloudflare API client.
2. **Old APKs have Supabase baked in.** Keep Supabase alive during the transition or accept degraded cloud sync for old users.
3. **Android source is untracked.** GitHub Actions cannot build the real app until `android/` source is committed.
4. **D1 is not Postgres.** RLS, `auth.uid()`, `jsonb`, arrays, and stored functions must be rewritten; this is the largest engineering task.
5. **Pages custom-domain cutover.** Follow the Pages custom-domain flow; do not just edit DNS. Keep GitHub Pages for rollback.
6. **Service-worker cache.** A stale worker can hide the cutover; bump the cache and set `sw.js` to `no-cache`.

### Recommendations beyond the literal request

- **Keep static Pages and the API Worker separate.** It makes website deploys low-risk and API/auth deploys independent.
- **Use `api.labu...` rather than putting auth and D1 behind the Pages project.** Pages Functions would work, but coupling a static site to auth/database migrations makes rollback harder.
- **Use Better Auth, but keep authorization in the Worker.** Better Auth authenticates; it does not know that only one email may approve hymns. Every admin route still needs an explicit role/allowlist check.
- **Do not use Cloudflare Access as consumer auth.** It is an internal-access product; Better Auth is the right layer for an app admin.
- **Do not build the APK on Cloudflare.** GitHub Actions is the supported, cheaper, more reproducible path; Cloudflare should own storage and delivery.
- **Add a payload hash for deduplication.** It is cheaper and more reliable than comparing 200 KB JSON blobs in SQLite.
- **Keep the 200 KB payload and 1,000-pending-row caps.** They are good abuse controls and fit D1 comfortably.
- **Use immutable APK paths.** A newly signed build must never reuse a URL that a CDN might have cached.
- **Do not claim fully silent Android updates.** Android 12+ can suppress the confirmation, but OEM behavior and Advanced Protection vary.
- **Keep GitHub Releases during the transition.** It is a useful fallback while R2 and the new updater are proven.
- **Do not reuse the `zledgercraft` R2 buckets or Pages project.** Separate billing, lifecycle, and access boundaries.

---

## 10. Cost expectation

At current scale, the Cloudflare stack should be near zero:

- Pages: Free tier is sufficient (site is well under file/size limits).
- R2: 10 GB storage and 10 million Class B reads/month free; APK egress is free.
- D1: Free tier includes 5 GB total storage, 5 million rows read/day, 100,000 rows written/day. The overlay is tiny.
- Workers: Free tier includes 100,000 requests/day. If polling traffic grows, budget **$5/month** for Workers Paid.
- Domain: already owned.
- Supabase: can be retired after the compatibility window, removing that bill.

The main cost is engineering time, especially the D1/Better Auth rewrite and the legacy migration.

---

## 11. Open decisions

1. ~~Is `lengkhawm.online` definitely in the same Cloudflare account as the Pages project?~~ Resolved: the zone is active in the same account.
2. ~~Should the website use Pages Git integration or a GitHub Actions deploy step?~~ Resolved: GitHub Actions direct upload; Git integration is not enabled.
3. Google-only admin login, or Google plus a break-glass email/password + TOTP?
4. How long must old APKs keep cloud sync? This determines whether the Supabase bridge is required.
5. Is the current Cloudflare account on Workers Free or Paid?
6. How many published edits/proposals exist today? This determines the import and verification effort.
7. Is Play Store distribution planned later? If so, keep the signing strategy and Play policy separation in mind.

---

## 12. Source links

**Cloudflare**

- Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Pages build configuration: https://developers.cloudflare.com/pages/configuration/build-configuration/
- Pages custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/
- Pages headers: https://developers.cloudflare.com/pages/configuration/headers/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- D1 batch/transactions: https://developers.cloudflare.com/d1/worker-api/d1-database/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 public buckets/custom domains: https://developers.cloudflare.com/r2/buckets/public-buckets/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- Cloudflare cache behavior: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/

**Auth**

- Better Auth Cloudflare guide: https://better-auth.com/docs/guides/cloudflare
- Better Auth database/D1: https://better-auth.com/docs/concepts/database
- Better Auth Google: https://better-auth.com/docs/authentication/google
- Better Auth admin plugin: https://better-auth.com/docs/plugins/admin

**Android/update context**

- Android in-app updates: https://developer.android.com/guide/playcore/in-app-updates/kotlin-java
- Android 12 automatic updates: https://developer.android.com/about/versions/12/features#automatic-app-updates
- PackageInstaller: https://developer.android.com/reference/android/content/pm/PackageInstaller
- Android developer verification: https://developer.android.com/developer-verification/guides
- Android Advanced Protection Mode: https://developer.android.com/privacy-and-security/advanced-protection-mode
- Play Device and Network Abuse policy: https://support.google.com/googleplay/android-developer/answer/16559646
- Play `REQUEST_INSTALL_PACKAGES` policy: https://support.google.com/googleplay/android-developer/answer/12085295
