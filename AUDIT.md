# Codebase audit — 26 November 2026

Whole-repo audit (static read plus live probes against `api.labu.lengkhawm.online`
and `labu.lengkhawm.online`). No code was changed to produce this report.

## What this repo does

A gospel songbook (5,723 hymns across 17 books) served as one static page from
Cloudflare Pages and packaged as an Android app with Capacitor. A Cloudflare
Worker plus D1 holds a small "approved changes" layer and a queue of submitted
edits, so editors' changes reach every device without a new release. Visitors
read offline; admins review submissions in the same page.

**Load assumed:** thousands of readers, a handful of editors, one to three
admins, one person doing releases. Admin and deploy paths were judged with
several admins acting at the same moment.

---

## Status after the fix pass (26 November 2026)

| # | Finding | Outcome |
|---|---------|---------|
| 1 | Cross-origin admin writes | Fixed: origin guard in `route()` and JSON-only bodies in `readJson`; two contract checks added |
| 2 | Pages workflow ignores `app.js`/`styles.css` | Fixed: both added to `paths:` |
| 3 | Version lock last in the approve batch | Fixed: lock taken on its own first; each insert re-checks the submission is still pending |
| 4 | Approved layer in localStorage | Fixed: cached in IndexedDB, one-time carry-over from the old key |
| 5 | The Worker is untested | Fixed: `.github/workflows/api-contract.yml` runs the contract suite against a local Worker on every Worker change |
| 6 | Anyone can fill the review queue | Fixed: 25 pending per address (`migrations/0004_proposal_ip.sql`) |
| 7 | Outbox drops edits past 100 | Fixed: nothing is trimmed |
| 8 | `/api/published-edits` unbounded | Fixed: `limit` on the server, paging loop on the client |
| 9 | Unescaped rejection reason | **False positive.** `reviewNoticeHTML` already escapes its text. The real defect was the opposite — reviewer name and status were escaped twice and showed `&amp;`. Fixed |
| 10 | Cancelled install prompt re-downloads | Fixed: the verified APK is kept and re-offered |
| 11 | Dead functions, duplicate `escAttr` | Fixed: 79 lines removed |
| 12 | One 9,050-line file | Partly: cloud sync moved to `cloud-sync.js` (316 lines); the rest stays put |

Verified after the pass: `npm test` green (255/255 browser checks, cloud sync
92/92, every other suite), and the API contract suite 45/45 against a local
Worker on a clean D1. Nothing was committed, pushed or deployed.

---

## Must fix

### 1. Any website can make a signed-in admin change the songbook
`workers/api/src/index.mjs:42`, `:88`, `:956`

**What this is:** the Worker accepts admin commands over cookies, which browsers
attach to requests other websites trigger, unless the server checks who asked.

**Problem:** the Worker never checks the `Origin` header, and `readJson` ignores
`Content-Type`. A page on `evil.example` can POST a form-style body
(`text/plain`, which browsers send without a preflight) to `/api/admin/publish`
or `/api/admin/approve`; Chrome attaches the admin cookie because it is
`SameSite=None`. Verified against production: a POST with
`Origin: https://evil.example` is not rejected — it reaches the handler and
answers `401 authentication required` only because no cookie was sent. With an
admin's cookie the same request would publish.

**Fix:** three lines in `route()` — for any method other than GET/OPTIONS, if
`Origin` is present and not in `allowedOrigins()`, return 403. As a second lock,
have `readJson` reject bodies whose `Content-Type` is not JSON.

**If we skip it:** one link in a chat is enough to publish arbitrary text into
5,723 hymns on every device, or to approve the whole queue.

### 2. A CSS or JS fix can ship without deploying
`.github/workflows/pages.yml:6`

**What this is:** the Pages workflow only runs when files in a `paths:` list
change.

**Problem:** `app.js` and `styles.css` are not in that list. A commit touching
only them builds nothing and the live site keeps the old files. Release 1.5.85
deployed only because `sw.js` and `version.json` changed in the same commit.

**Fix:** add `- 'app.js'` and `- 'styles.css'`. Two lines.

**If we skip it:** the next client-only fix appears merged while users still see
the old code.

### 3. An approval can publish without bumping the version, and report failure
`workers/api/src/index.mjs:863`

**What this is:** approving writes the change, marks the submission approved and
raises the version number, all in one D1 batch. Devices only fetch when the
version number rises.

**Problem:** the version guard is the *last* statement in the batch, and the
comment claims a missed guard discards the batch. It does not: D1 commits
whatever the statements did, and an `UPDATE` matching no rows is not an error.
Two admins approving different submissions at the same moment → the slower one
commits its song, leaves the version unchanged, then throws 409, so the song is
published but invisible until a later approval bumps the version. If the two
overlap on the same submission, the unique index on `proposal_id` fires first
and the admin gets a bare 500 instead of "someone else reviewed this".

**Fix:** take the version guard first on its own
(`UPDATE publish_state SET version = version + 1, updated_at = ? WHERE id = 1 AND version = ?`),
check `meta.changes === 1`, return 409 when it is 0, then run the inserts and the
proposal update in a second batch.

**If we skip it:** two admins, one queue, a "published" song nobody can see, and
a red error saying it failed.

### 4. The approved layer fills localStorage, then favorites and playlists stop saving
`app.js:721`, `:743`

**What this is:** every approved change is stored as a whole song on the device,
in `localStorage` (about 5 MB per site).

**Problem:** production returns 768 rows / 1.39 MB today (3.26 s, measured).
Stored as text that is roughly half the quota and grows with every approval.
When the write fails, the error is swallowed (`catch (e) {}`) so the cache
silently freezes; and every other `setItem` (favorites, recents, playlists,
chord charts) starts throwing `QuotaExceededError` inside click handlers that do
not catch it. A reader taps the heart and nothing happens.

**Fix:** store `PUB` in IndexedDB, which already holds the 5 MB corpus
(`idbGet`/`idbPut` exist). Two await lines in `cloudLoadLayer`.

**If we skip it:** within months admin and editor devices lose favorites and
playlist saving with no message explaining why.

---

## Should fix

### 5. The most dangerous code has no test that runs
`scripts/test_staging_api.mjs`, `package.json:23`

**What this is:** the Worker holds auth, rate limits, the approval race and the
publish rules. A 25-check contract suite for it exists.

**Problem:** that suite needs a live server plus an admin password and is not
part of `npm test` or any workflow. The client suite mocks the Worker, so a
change to `index.mjs` ships on the strength of `node --check`. Findings 1 and 3
both live in code no automated test touches.

**Fix:** add the approve/reject/publish contract checks to a local
`wrangler dev` job in CI (the suite already defaults to `127.0.0.1:8791`), or at
minimum one test proving an off-list `Origin` gets 403 and a double approval
gets a clean 409.

**If we skip it:** the next refactor of the approval path is verified by reading
it.

### 6. Anyone can fill the review queue and block real submissions
`workers/api/src/index.mjs:16`, `:412`, `:430`

**What this is:** submissions are public — no account — limited to 20/minute per
IP, and the queue stops accepting at 1,000 pending.

**Problem:** fifty requests per minute from ten addresses fills 1,000 slots in
about five minutes. After that a real editor gets
`429 review queue is full; try again later` and the admin has 1,000 junk rows to
reject.

**Fix:** cap pending rows per IP (one extra `WHERE` on the count) or auto-expire
pending rows older than N days.

**If we skip it:** one scripted afternoon takes the editor pipeline down until
someone clears the queue by hand.

### 7. Queued offline submissions are dropped past 100
`app.js:788`

**What this is:** changes made offline wait in an outbox in `localStorage` and
are sent when the network returns.

**Problem:** the outbox keeps only the last 100 entries (`q.slice(-100)`) and
drops the oldest silently. A long offline editing session loses its earliest
changes from the queue — they stay on that device but never reach review.

**Fix:** remove the slice, or raise it and tell the user when it trims.

**If we skip it:** silent, unreproducible "my edits never showed up" reports.

### 8. The published layer is downloaded in one unbounded response
`workers/api/src/index.mjs:389`

**What this is:** `/api/published-edits` returns every row (optionally from a
sequence number) with no page size.

**Problem:** 1.39 MB and 3.3 s today, growing ~2 KB per approval. A fresh
install, private window or device whose cache failed downloads all of it in one
request; on a slow phone that is a multi-second stall with no progress shown.

**Fix:** accept `limit` (say 200) alongside `since` and have the client loop
until a short page comes back. The query already orders by `seq`.

**If we skip it:** first-load cost grows forever, on mobile data.### 9. A rejection reason is inserted as HTML into the admin page
`app.js:1754`

**What this is:** the review notice looked like string-built HTML with the
reviewer's typed reason concatenated in unescaped.

**Problem:** this one was wrong. `reviewNoticeHTML(type, text)` runs `esc(text)`
on every path, so the reason was already escaped and there was no hole. The
symptom in that spot was the reverse: `reviewed_by_name` and `status` were escaped
at the call site *and* again inside `reviewNoticeHTML`, so a reviewer named
"Ben & Co" appeared as "Ben &amp; Co".

**Fix:** pass those two fields in raw and let `reviewNoticeHTML` do the escaping,
which is what the regression check now pins down (a note containing `<img onerror>`
renders as text, no element, no script).

**If we skip it:** reviewer names with an ampersand keep displaying `&amp;`.

**Outcome:** fixed — see the status table above.

### 10. Cancelling the Android install prompt costs another 45 MB download
`android/app/src/main/java/org/khristianlabu/app/UpdateInstaller.java:192`

**What this is:** the updater downloads the APK to private cache, verifies its
SHA-256, then opens Android's installer.

**Problem:** it sets `pendingFile = null` the moment the installer opens. If the
user backs out of the confirmation, `onResume` finds nothing to re-offer and the
next attempt starts from zero — `start()` deletes the finished file and
re-downloads.

**Fix:** do not null `pendingFile` there; clear it only when the installer
reports success or a newer version replaces it.

**If we skip it:** users on metered connections pay twice for the same update.

---

## Nice to have

### 11. Seven functions are never called
`app.js:3154`, `:3311`, `:4003`, `:4062`, `:4786`, `:5299`, `:5931`

**What this is:** `clearRecents`, `catColorOf`, `transposeChordLineText`,
`chordLineText`, `parseChordPlacement`, `playChordTone`, `refreshReaderActions`
— 75 lines between them.

**Problem:** each name appears exactly once in the tree, at its own definition.
Dead code still gets read, reviewed and carried through every refactor of the
chord engine. `escAttr` is also defined twice in a row (`app.js:7881-7882`).

**Fix:** delete them.

**If we skip it:** they keep costing attention and will drift out of sync.

### 12. One 9,050-line file does six unrelated jobs
`app.js`

**What this is:** reader, search, favorites, chord engine, cloud sync, review UI
and backups in one file, plus a 2,280-line stylesheet.

**Problem:** not a bug, but every change means finding things in 434 KB with no
module boundaries, which is why the review logic and the sync logic have grown
into each other. The tests load it as one blob, so nothing forces separation.

**Fix:** lift one job (cloud sync is cleanest — one API) into its own file when
the boundary is next touched. No big-bang split.

**If we skip it:** onboarding, reviewing and testing stay expensive.

---

**Verdict:** healthy overall — escaping, CSP, revision fingerprints, the release
pipeline and the 255-check browser suite are better than most projects this
size. Findings 1 and 2 first: small edits that close a security hole and a
silent no-deploy.

**Lean: -79 lines net, -0 dependencies possible** (plus 316 cloud lines moved
out of `app.js`, which is now 8,702 lines).

## Not checked (as first written)

- chord transposition and solfa maths (logic not executed, only read)
- `styles.css` layout
- `android/app/src` beyond `UpdateInstaller.java`
- `songs.json` content
- the Google Drive backup round-trip
- the staging Worker (no admin password)
- real D1 behaviour: the batch reasoning in finding 3 comes from D1's documented
  transactional `batch()` semantics, not from a live two-admin race

---

## Second pass — what those seven items actually showed

**Chord transposition: correct.** Twelve cases run in the real page: `C+2→D`,
`Bb+2→C`, `F#m7+1→Gm7`, `C/G+2→D/A`, `C#m7b5+1→Dm7b5`, `Eb−1→D`, `G/B+3→Bb/D`,
`Am−3→F#m`, `D/F#−2→C/E`, `A7sus4+3→C7sus4`, `B+1→C`, and `N.C.` unchanged.
Slash chords, qualities and the flat/sharp preference all held.

**Key-tone maths: one latent bug, now fixed.** Pitch was already right (A4 = 440 Hz,
C4 = MIDI 60, root/third/fifth/octave), but `parseKeyTone` only recognised the word
"minor": `parseKeyTone('Am')` returned **major**, so a song whose key is written
`Am` played an A major triad. No corpus song uses that form (0 of the 2,362
non-empty keys), so nothing was broken in production — an editor typing `Am`
would have heard the wrong tonic. `Am`, `Amin` and `A minor` now all give a minor
third; `A` stays major. Covered by a new E2E check.

**`songs.json`: clean on the rules that matter, three data blemishes.**

- 17 groups, 5,723 songs. 0 duplicate ids, 0 empty titles, 0 songs without
  verses, 0 ids outside the safe pattern the cloud and backup paths require.
- 90 songs carried `key: "Key"` — a stray word, all in group ZT. `parseKeyTone`
  returned null, so the reader showed a bare "Key" with no play button. **Fixed**
  in `songs.json` (all 90 cleared), with `songs.json.gzip` regenerated, the
  `dataHash` in `groups.json` recomputed and `DATA_VERSION` bumped 39 → 40 so
  cached corpora reload.
- 8 songs carried a cross-reference (`"Kaih No. 8"`, `"Kaih - No. 303"`) in the
  key field, so the reader showed it as "Key: Kaih No. 8" with no play button.
  Cleared. **Guard added** so this class cannot silently return: `clean_key()` in
  `merge_songbooks.py` drops any key that names no note (a bare "Key", a
  cross-reference) while keeping real spellings (`Key G`, `Doh is Bb (Moderato)`,
  `Eb/D#`, `Doh is C or G`), and `scripts/validate_data.py` now fails on any key
  that is neither empty nor contains a note letter.
- 3,459 songs have no key (fine), 15 have no number, 29 duplicate titles inside
  one group, 4 blank lyric lines, 88 lyric lines over 200 characters, no control
  characters.

**Google Drive backup: was switched off, now removed.** `GOOGLE_CLIENT_ID = ''`
and `renderBackupSection` set the section to `display: none` with an early return,
so no user could ever reach it. **Removed entirely**: the Drive/GIS code in
`app.js`, the settings card in `index.html`, its CSS, the action entries, the
`@capawesome/capacitor-google-sign-in` dependency (package.json, lock file and
both Gradle files), the Google hosts in the Pages CSP and the Android CSP
injection, and the three E2E checks plus the legacy-token check that only
exercised it. Local file backup/restore is untouched and still tested.

**Staging Worker:** alive (`environment: staging`, version 773), 772 rows /
1.46 MB served unbounded (so the paging build is not deployed), anonymous admin
routes 401, HSTS and `no-store` present. A cross-site POST still reaches the
handler (404 on an unknown path, not 403), which confirms finding 1's fix is
local only.

**Two-admin approval race:** 12 rounds of two admins approving different
submissions in parallel against a local Worker — every round both succeeded, the
version advanced by exactly 2, and both payloads were in the overlay (0
inconsistencies). A local Worker serializes the two requests, so this does not
reproduce the exact two-reads-then-two-writes interleave; that path is closed by
construction now (the lock is its own statement). The refusal path was verified
directly: approving with a stale `expectedVersion` returns 409, publishes nothing
and leaves the version alone; retrying publishes and advances it.

**`styles.css` layout:** no horizontal overflow (`scrollWidth == clientWidth`) on
home, reader, settings and the admin account at 360×640, 768×1024 and 1280×800,
with no page errors. 42 `!important`, 75 custom properties, 1,483 `var()` uses,
51 media queries. 55 class selectors have no literal reference, but several
(`is-warn`, `is-approved`) are built by string concatenation, so they are not
called dead. The CSP allows one style hash (`sha256-UP0Q…`) while `index.html`
contains no inline `<style>`, so that allowance is unused.

**Merge guard:** `merge_songbooks.py` copies `key` from its sources, so a future
rebuild would have restored the stray values. It now funnels every source key
through `clean_key()`, which keeps any value that contains a note letter and
drops the rest. The same rule runs in the corpus validator. The merge script
itself cannot be executed in this checkout (only `sources/mizo/` is present; the
KBC, Zomi and Lakkhawm extracts are not), so the guard is verified by importing
`clean_key` and exercising its cases, not by a full rebuild.

**`android/app/src`:** two classes. `MainActivity` registers three JS bridges
(splash, update, download), sanitises the download name to `[A-Za-z0-9._-]` and
writes through MediaStore on API 29+. **The Gradle build could not run here:**
the only JDK on this machine is Java 27 and this Gradle rejects class-file
version 71, so the Java change from the fix pass is still uncompiled. It deleted
one statement; the Android release workflow compiles it.

Still not checked: the audio output itself (no speakers here — only the MIDI
numbers were verified), the installed APK on a real device, and production D1.
