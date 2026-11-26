# Cloudflare-first migration plan — Khristian Labu

**Status:** Phase 1 complete; Phase 2 pipeline and in-app updater complete (1.5.82 published, now carrying admin username management, HD solfa sheets served from R2, native solfa downloads, the chord-lane fixes, and a tap-driven chord picker); Phase 3 API complete (Google sign-in pending); Phase 4 production cutover complete, with the 30–60 day compatibility soak in progress; Phase 5 pending.
**Last audited:** 2026-11-24
**Scope:** website hosting, database/auth, APK build/distribution, and the supporting Cloudflare configuration.

### Execution log

- **2026-11-26 — 1.5.86 closes the audit findings.** A whole-repo audit (`AUDIT.md`) found twelve issues; all are fixed here. **Security:** the Worker now refuses a write whose `Origin` is present and not in `CORS_ORIGINS` — the session cookie is `SameSite=None`, so a form on any site could otherwise publish or approve as the signed-in admin — and `readJson` refuses bodies that are not JSON. **Correctness:** approval takes the `publish_state.version` guard as its own statement *before* writing (the old batch put it last, so a concurrent approval could commit a song with the version unchanged and then report failure), and each `published_edits` insert re-checks that its submission is still pending. The approved layer moved from `localStorage` to IndexedDB — it had reached 1.39 MB, roughly half the quota, and a full quota silently stopped favourites and playlists from saving — `/api/published-edits` is paged (`limit`, default 200, the client loops), the offline outbox no longer drops edits past 100, and the Android updater keeps the verified APK when the install prompt is cancelled instead of re-downloading 45 MB. Public submissions are capped at 25 pending per address (`0004_proposal_ip.sql`) so one script cannot fill the shared queue. **Testing:** the Worker's contract suite now runs in CI (`.github/workflows/api-contract.yml`, local `wrangler dev` + a fresh D1, migrations applied in the two passes the auth tables require) and gained checks for the origin guard, non-JSON bodies, paging and the version/edit invariant. **Removal:** Google Drive backup, unreachable in production because `GOOGLE_CLIENT_ID` was empty, is gone — code, settings card, CSS, the Capacitor plugin and the Google hosts in both CSPs. **Data:** `parseKeyTone` reads `Am`/`Amin` as minor (it played a major triad), 90 songs had `key: "Key"` cleared, 8 taught "Kaih No. N" cross-references moved out of the key field, and `merge_songbooks.py` funnels every source key through `clean_key()` with a matching validator rule so neither can return. **Structure:** cloud sync lives in `cloud-sync.js` (316 lines); `app.js` lost 7 dead functions and a duplicate `escAttr`. SW cache `labu-v164`, `DATA_VERSION` 40. Tests: browser **253/253**, cloud sync **92/92**, API contract **45/45** against a local Worker on a clean D1, data validation green. Schema: `0004_proposal_ip.sql` applied to `labu-staging` and `labu-prod` before the Workers were redeployed (staging `f62fb101-4738-45b7-86ca-3904e925d81a`, production `c773b454-7ccf-49a4-8798-296a8404a3ca`). Checked live rather than assumed: `/api/published-edits?limit=1` returns one row on both, an off-list `Origin` gets `403 origin not allowed`, a `text/plain` body gets `415 expected a JSON body`, an anonymous `/api/admin/me` is still `401`, and `publish_state` stayed at version 780 with the overlay untouched — no test data was written to production. Pages [run 45768295561](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45768295561) serves 1.5.86 (`app.js` byte-identical to the repo, `cloud-sync.js` 13,048 B, SW cache `labu-v164`, corpus gzip 1,432,102 B). Signed 1.5.86 [run 45768495497](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45768495497): **44,374,920 bytes**, SHA-256 `d47c2eef05cdc658bcc82b655e4e04567aabd51d6fb4f5044e065c5503667dc8` — the downloaded APK matches `latest.json`, carries `APP_VERSION = '1.5.86'`, `DATA_VERSION = 40`, `labu-v164` and `cloud-sync.js`, and GitHub Release `v1.5.86` publishes the same file. **Paging default corrected after release.** The first deploy of 0004's Worker defaulted `/api/published-edits` to 200 rows, so any 1.5.85 client — which sends no `limit` — would have held only the first page and treated it as current (production served 200 of 768 rows). A request without `limit` now returns the whole overlay (`LIMIT -1`); only an explicit `limit` pages. Both Workers were redeployed (staging `473ed559-144f-462b-a8b8-ebb7f83fb03e`, production `0f8e7206-676c-44a5-8d3d-81f0414c3ca6`), and the contract suite now seeds 206 rows and asserts the unlimited request returns every one of them.
- **2026-11-26 — 1.5.85 makes the review queue feel local.** Deciding a submission sent the reviewer through a full layer re-download (`since=0`, all 766 rows replayed into the corpus, search index rebuilt) before the queue even started re-fetching, and every visit to the admin page waited on `/api/admin/me` plus a blank queue card. The queue now paints from a per-status cache and refreshes in parallel behind it; an admin whose rights are already verified skips the round trip, so a warm re-open shows rows in **6–11 ms** instead of after a burst of round trips, and approving removes the row in **8–23 ms** (measured against a mocked 250 ms API) because the decision is applied optimistically and the layer reload is incremental (`since=<last seq>`) and off the critical path. Approve and Reject also return to the queue now, with the decision echoed under the account card, instead of leaving the reviewer on the decided submission (a decided submission opened from the Approved/Rejected tab is still read-only and still offers the next pending one). The admin page gained pull-to-refresh — drag down from the top and the hint rises into the gap it opens, "Pull to refresh" → "Release to refresh" → "Refreshing…" — which re-validates the cookie, re-checks rights and reloads the queue in place. The Add Chords empty state is now a filled band pill with a sheen sweep and a breathing plus (animations off under reduced motion). Contrast audit of 17 admin/review surfaces in both themes found three failures, all fixed: "Synced" on a primary button was painted `--band-deep` on a `--band-deep` fill (**1.0:1**, invisible), the ghost success state was 3.2:1, and `.cloud-err` used the fill red (**2.22:1**) on the dark card; new `--ok`/`--ok-text`/`--ok-ink` tokens and `--red-ink` bring them to **5.38/6.47**, **9.64/6.10** and **7.01/7.49** (dark/light). SW cache `labu-v163`. Tests: browser suite **255/255**, cloud sync **91/91** (four assertions follow the new return-to-queue flow; the rejected text is now checked against the corpus rather than the review body), plus the other suites green.
- **2026-11-26 — 1.5.84 ships the admin review page.** First release to carry the review queue, the review page and the stale/pre-tracking guards, so the Worker and the site are deployed together: `0003_review.sql` applied to `labu-prod` (only `0003` was pending there) and the Worker redeployed (version `82a989a3-dcb0-431c-a9f5-594647f7e652`, previous `858e5fa2-1bf6-4a82-9539-02a7f8a83e27` stays as the rollback target). Checked live rather than assumed: the review routes went from `404` to `401` anonymously, `/api/admin/me` and `/api/admin/proposals/counts` answer `200` for the admin session, and `publish_state` stayed at version 778 with the overlay untouched at 766 rows — no test data was written to production. Staging got the same treatment earlier (`0002`/`0003` applied, Worker `9509ded0-07d9-4ad1-ae63-3d89e7db3a13`). SW cache `labu-v162` (the shell changed, the corpus did not, so `DATA_VERSION` stays 39). Tests against a local `wrangler dev`: API contract suite **41 checks** and the legacy-approval scenario **8/8**; the remote staging run is still unrun because the staging admin password is not stored here. Pages [run 45745317570](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45745317570) serves 1.5.84.
- **2026-11-26 — Unreleased: the review page no longer trusts the device, and old submissions get a real conflict check.** The review detail now returns the published side (`published: {rev, song, cat, deleted, chart}`) replayed from `published_edits`, so "Original" shows what readers actually have instead of whatever the reviewing phone last synced, and it returns `stale` up front: an outdated submission opens with a warning and a disabled Approve rather than failing only after a tap (the Worker still refuses it, which covers a conflict that appears mid-review). Proposals written before `0003` (`base_rev = NULL`) were the other blind spot; they are now checked against the publish clock — if any row for that song has `published_at` after the submission, approval returns the same `409`, and if nothing landed since, the row stays approvable (backward compatible) behind a "pre-tracking" badge, a warning and one confirmation. A decided review also chains: the bar offers "Review next pending (n)" so a queue can be worked through without going back to the dashboard (bulk approve stays on the dashboard and uses the same stale-safe endpoint). Tests: revision logic **13/13** (`changedSince` cases), cloud-sync browser suite **92/92** (server-sourced Original, stale-on-open, stale-mid-review, pre-tracking warning + confirm + cancel, next-pending chaining), browser suite **255/255**, API contract suite **39 checks** against a local `wrangler dev`; the legacy rule was also exercised end to end (create → `base_rev = NULL` in D1 → publish for that song → detail `stale: true`, approve `409`, other legacy row approved `200`). Still unrun here: the contract suite against remote staging (it would leave `api_stale_*` rows in the staging overlay).
- **2026-11-26 — Unreleased: admins can review a submission before approving it.** The queue only said *what* a proposal touched; approval was blind. There is now a dedicated review page (`#reviewView`, routed, not a modal) with three modes: **Changes** (verse-aligned lyric diff plus a per-character chord diff), **Original** (the published song through the reader's own renderer) and **Proposed** (the proposal payload through the same renderer, i.e. exactly what approval publishes). Verse alignment uses an LCS over `type + content`, so an inserted chorus no longer shifts every later verse; modified lines get word-level highlighting, and chords are compared position by position (`C → D` retimed, moved, added, removed, unchanged) and drawn above their own lyric line instead of as a name list. The dashboard gained status filters with counts, per-row change categories (new song, lyrics, chords, one-off "Lyrics + chords", metadata), Anonymous attribution and Review/History actions, and a sticky bottom Approve/Reject bar on mobile that reserves its own height so it never covers the song. Concurrency: `proposals.base_rev` (migration `0003_review.sql`, additive) stores a SHA-256 fingerprint of the published revision at submission; approval recomputes it and returns `409 the song changed after this was submitted; sync and review it again` without writing, while the existing `env.DB.batch` gained a `publish_state.version` guard so two approvals cannot interleave. Duplicate approve/reject is refused, rejections keep an optional reason, and reviewer name/timestamp are snapshotted. New admin-only endpoints: `GET /api/admin/proposals?status&song&limit`, `/api/admin/proposals/counts`, `/api/admin/proposals/:id`, `/api/admin/song-revisions?id=`; the plain `GET /api/admin/proposals` still returns the pending array. Anonymous contract unchanged — no accounts, no sign-in, no Turnstile (submits are already 20/min/IP and payload-capped) — and every moderation route re-checks the admin session on the Worker. Tests: `scripts/test_revision_logic.mjs` (new, in `npm test`) 11/11; cloud-sync browser suite **82/82**, browser suite **255/255**; the API contract suite (38 checks, incl. anonymous 401s, counts/filter contracts, stale-approve 409 then reject, history with reason) passed against a local `wrangler dev` + D1 after applying `0003_review.sql` locally. Known gaps: proposals written before `0003` have `base_rev = NULL` and skip the staleness gate; the review page compares against the device's synced corpus, so a very stale device can still see an older "Original" (approval still refuses it); no bulk approve on the review page.
- **2026-11-25 — Unreleased: Find & Replace keeps the caret in the Replace field.** The admin CRUD E2E check failed roughly one run in eight with "timed out waiting for the replace modal" and no console error. Reproduced with a probe that logs `#findInput` events: the modal's delayed autofocus (`setTimeout(..., 80)`) fired *after* Playwright had focused Replace, so the replace text was typed into Find — the trace read `input="E2EMARKERE2EREPLACED"`. The preview then found 0 matches, and `executeReplace()` returned silently on `!frMatches.length`, leaving the modal open until the 20 s timeout. The autofocus now only fires if nothing inside the modal already has focus, `executeReplace()` re-runs the preview when its state is empty and reports "No matches to replace" instead of a silent no-op, and a failed save says "Could not save replacement" rather than returning with no feedback. Probe: 2 failures in 16 runs before, 0 in 54 after. The button no longer depends on the preview at all: `readFindReplaceForm()` reads Find, Replace and the three scope toggles at click time and `collectFindMatches()` does the scan, so a preview that was never rendered, or went stale because the corpus changed, cannot disable Replace All — an empty Find says "Type something to find first", a real scan with no hits says "No matches to replace", and emptying Find now clears only the result list instead of wiping the Replace text. Replace All also leaves a one-shot undo: `frUndo` keeps the previous value of each touched title, author and verse line, and an admin banner ("Replaced N matches in M songs." with an Undo button, `#adminUndoBar`) restores exactly those fields, skips any song or line that no longer exists, and re-saves plus re-records the edits so the rollback survives a reload; a failed undo keeps the record so it can be retried. Typing a replacement now previews it: each match in the list gains a second line showing the text as it will read after Replace All, with the inserted text highlighted green (or "(removed)" when the replacement is empty), and `#replaceInput` refreshes the preview as it is typed. Tests: "replace text stays in the replace field", "preview shows the replacement result", a stale-preview case that writes the fields without an input event and still expects the replacement in the lyrics, and undo coverage (offer shown with its count, offer hidden after use, lyrics back to the pre-replace text); browser suite **248/248**. The PWA probe that intermittently failed with `song corpus cached by SW — null` on a cold install was a real app race, not a slow test: `loadSongs()` warmed the SW corpus cache on `navigator.serviceWorker.ready`, which resolves when a worker is *active*, not when it has *claimed* the page, so the warm-up `fetch('songs.json.gzip?v=N')` bypassed the worker on a first visit and nothing was ever cached. The warm-up now runs immediately if the page is controlled and otherwise waits for `controllerchange`; a cold-install probe measures the cache entry at 1.2–1.7 s in 6/6 fresh contexts (control lands at 0.6–1.1 s, every load starting uncontrolled), so the suite's poll was widened to 20 s with a cache-key dump on failure and three consecutive suites passed 248/248. The reader's pinch zoom used to be transient (a per-song `readerZoomFont` that reset to the Settings size on the next song); it now commits on pinch end through `setReaderFont()`, so the pinched size becomes the Settings font size — slider, label and `labu-reader-font` all move with it — and the next song opens at it. Tests: "pinch enlarges the lyrics", "pinch writes its size into the Settings font size", "the next song keeps the pinched size". The native launch-time update check still downloads immediately, but now starts minimized: the progress lives in the bottom pill (`width:190px`, `white-space:nowrap`, one line) instead of a modal over the songbook, and tapping the pill opens the full dialog. Tests: "startup download starts minimized in the pill", "pill sits at the bottom of the screen", "pill shows the download percentage while minimized", "pill keeps a fixed width as the percentage grows" (9% vs 100%), "pill content stays on one line"; the manual-check test now waits for the startup check before flipping its mocked version, which was starting a second download and skipping the `length === 1` poll; suite **255/255**. Not released yet — committing this needs a version/SW bump to reach installed clients.
- **2026-11-25 — 1.5.83 ends every solfa sheet below its music, never inside a footer.** 1.5.82's whole-page crop followed the printed band, so 10 of the 496 bundled sheets (BL_12, 137, 189, 436, 444, 450, 463, 478, 480, 492) had a tune's last lyric line sliced at the page-foot band, and 147 sheets ended on a clipped separator rule or the tops of the caps cross-reference caption (38 rules, 109 thin slivers, 84 lines flush at the edge). The crop now finds the lowest line that belongs to the tune, keeps `PAD` under it, and stops above the whole printed foot block — the short rule plus the caps caption, or the copyright/renewal block — so nothing at the bottom is cut in half. `frame_sheet()` also pads the bottom at assembly, because some pages simply print the next stave a few points under the last line and the crop had no white left to keep. Result: all 496 sheets are 1134 px wide with **at least 43 px of white** under the last ink (it was 31 px on the tightest 1.5.82 sheet and 0 px on the flush ones), and the formerly cut line is whole on all ten. The builder itself is now resumable and parallel: writes go through `.part` + `os.replace`, a builder fingerprint stamp (`.solfa-build*.json`, gitignored) lets an interrupted run resume instead of restarting, and `ProcessPoolExecutor` cuts a full bundled build to **6m54s** on 4 cores (the 13-sheet sample went 40 s → 12 s); `npm run solfa:hd` resumes while `solfa:hd:rebuild` forces. The 480 DPI set was rebuilt to 496 files at 2266 px (103 MB, min 79 px white) and uploaded to a new **`solfa-hd/v5/`** path (v4 objects stay cached untouched; one 500 during upload, BL_233 retried and verified); `SOLFA_HD_BASE`, the E2E assertion and the upload script follow. SW cache `labu-v161`. Browser suite: **240/240** (first run hit a known admin-CRUD replace-modal timeout, passed on rerun). Pages [run 45597907381](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45597907381) serves 1.5.83; signed 1.5.83 [run 45597912551](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45597912551): **45,284,510 bytes**, SHA-256 `07c5dc1d8029f050428cfb141a9a56e9bdbef4156f65729e619206ca406a181c` — the APK carries all 496 bundled sheets and BL_8, BL_444 and BL_233 unzip byte-identical to `assets/solfa/`.
- **2026-11-25 — 1.5.82 lets the last stave on a full page breathe.** The A4 framing still cut tight at the foot: a tune that fills its printed page (five systems, e.g. song 8, whose tune song 9 reuses as "Kaih No. 8") prints its final lyric line just **below** the fixed content band (`BOTTOM_PDF = 45`), so the whole-page crop sliced that row in half. The white `FRAME_PAD` under it hid the problem in a margin measurement but not to the eye. `full_page_bottom()` now walks the ink past the band edge, stops above the caps cross-reference line at the page foot, and leaves `PAD` of white under the tune. 196 of the 496 bundled sheets changed (BL_8: 1134×1755 → 1134×1794); every sheet now keeps at least 31 px of white under its ink (the page frame's 36 px pad plus the new crop margin), and the bundled 240 DPI set totals 33.5 MB. The 480 DPI set was fully re-cut and uploaded to **`solfa-hd/v4/`** (v3 objects stay cached untouched), `SOLFA_HD_BASE` and the E2E assertion follow. SW cache `labu-v160`. Browser suite: **240/240**. Pages [run 45567392509](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45567392509) serves 1.5.82; signed 1.5.82 [run 45567397449](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45567397449): **45,404,422 bytes**, SHA-256 `cce50ed6e674e5042f9dba5cc8f70836aab414f845dcd11afe87caf8fab1f9ea` — the APK's 496 bundled sheets unzip byte-identical to `assets/solfa/`, BL_8 included.
- **2026-11-25 — 1.5.81 frames every solfa sheet as an A4 page.** Two crop problems came from following each tune's ink: a page that prints two songs cut the first tune at `next title + 42pt`, which landed inside its last bass stave (BL_3, the sheet song 4 “Biakna Late - 4” shows), and short tunes ended up on shorter canvases than the rest. `single_tune_page()` now ships a page that holds one tune **whole** — the full printed content band with its own top margin, title block and bottom margin, no ink trim and no blank-run compaction — while multi-tune pages cut in the blank gap above the next title. Every sheet is **1134 px wide** on a minimum A4-proportioned page (1134×1604), contents centred: 313 of the 496 sheets are whole pages at 1134×1755, 14 sit at the A4 minimum, the rest are taller (multi-page tunes and two-tune crops). All 496 bundled sheets and the 16 split tune sheets were rebuilt, and the eight unsplit multi-tune AVIFs the builder still emits were dropped so the set matches what the reader can request. The 480 DPI copies were re-cut at 2266 px wide and uploaded to a new **`solfa-hd/v3/`** path (v2 objects are cached immutably for a year); `SOLFA_HD_BASE` and the E2E assertion follow. SW cache `labu-v159`. Browser suite: **240/240** (the SW corpus-cache probe flaked on the first run after the cache rename and passed on rerun; on the local server BL_3 measures 331 px of white below the last stave, BL_2 and BL_1 ship whole pages). Pages [run 45557094180](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45557094180) serves 1.5.81 from Pages; signed 1.5.81 [run 45557097466](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45557097466): **45,480,630 bytes**, SHA-256 `36fb95160f359636f3a13e44c22962c2e6cc16106af1a168b73f85efcd9723ff` (the A4 pages add ~4.4 MB to the bundle).
- **2026-11-25 — Unreleased: title-edit warning and layer consolidation.** The edit form shows a hint under the title field as soon as a typed title differs from the printed one, and saving asks for confirmation, because the corpus title always wins. The published layer was consolidated: the 111 temporary rows from the 1.5.79/1.5.80 re-publishes were folded into the original per-song rows (eight songs had a duplicate row whose older title still won), leaving 102 BL rows / 765 total with zero title mismatches against `songs.json`. Not released yet — verified on the local server.
- **2026-11-25 — 1.5.80 keeps the printed caption authoritative.** A caption-by-caption review of the 1.5.79 titles against the PDF showed that twenty titles had been "restored" to longer forms the sheets do not print (`Tanglai Lumsuang`, `Tatna`, `Khros Hon Naihsak In`, `Jesu'n Hon Sam!`, …); all twenty are back to the caption text and were re-published, `publish_state.version` → 777, dataHash `fab9a0d91c24748d`. `applyEdit` now keeps the corpus title when replaying a published `song` edit, so an older stored title can never mask the sheet again while the edit's other fields still apply. `DATA_VERSION` 39, SW cache `labu-v155`. CI run 45530926948 built the APK (41,246,162 bytes, SHA-256 `2fe4aed3…`); on-device search confirms #6 `Toupa Lama Pang?`, #88 `Tanglai Lumsuang` and #267 `Tatna`. The only titles that intentionally differ from the raw caption run are BL_3 and BL_233 (their captions end in the author credit) and BL_1 (the printed title really ends in “E”).
- **2026-11-25 — 1.5.79 publishes the printed titles through the edit layer.** The published-change layer overrides the bundled corpus, so 80 BL songs still showed their older names on devices after 1.5.78 (BL_6 read "Kanan zuan I Pai" instead of "Toupa Lama Pang?"). Those 80 published `song` edits were re-published with the printed titles (append-only rows, so clients keep their history) and `publish_state.version` advanced to 775; the live API now returns the new titles. Nine titles the caption extraction had clipped were restored (BL_15, 49, 66, 88, 127, 267, 280, 387, 459), plus eleven near-complete ones the edit layer already carried (BL_97, 123, 134, 185, 218, 226, 279, 374, 377, 390, 392). `DATA_VERSION` 38, SW cache `labu-v154`. CI run 45475338278 built the APK (41,246,190 bytes, SHA-256 `ffe4bff6…`).
- **2026-11-25 — 1.5.78 titles the BL songs as the printed book does.** The BL titles came from each hymn's first lyric line, which often differs from the name printed above the music (No. 2 "Pathian Hon Phat Ung" is printed "Hon Halhsak Nawn In"; No. 5 "Tangtawn La Kilawm Ngai Un" is printed "Toupa Mangpen"). Every song with an engraving was compared against its printed title band and **404 now carry the printed title**. The names were read from the PDF's caption block (author initials and scripture references trimmed; nine sheets where the text layer drops a glyph were read from the page images). `songs.json`/`.gzip` were regenerated, `groups.json` dataHash updated, `DATA_VERSION` is 37 and the SW cache `labu-v153`; browser suite: **240/240**. Signed 1.5.78 [run 45471168085](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45471168085): **41,246,042 bytes**, SHA-256 `6631966b9a357d49487e21db719c56fa79014a08fc16943e9a967f3a415955c2`. On the SM-S921B, searching "Hon Halhsak" returns **#2 Hon Halhsak Nawn In** and the reader header carries the printed title.
- **2026-11-25 — 1.5.77 keeps the printed title and key on every solfa sheet.** The builder cropped each tune from just above its first stave, so the engraving lost the printed song details — number, title, subtitle, credits and the "Doh is ..." line — that tell a singer which tune and key the sheet is. `header_top` now starts each sheet above its own title block and caps it inside the printed content band, so the page's running header (page number, "BIAKNA LATE") still stays out, and a tune that starts mid-page begins at its own title rather than the previous tune's tail. All 496 bundled sheets were rebuilt (16% taller, 26 MB → 30 MB) and the 480 DPI copies re-cut; those were re-uploaded under a new `solfa-hd/v2/` path because the old objects are cached immutably for a year. Browser suite: **240/240**. Signed 1.5.77 [run 45465085127](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45465085127): **41,248,066 bytes** (the fuller sheets add ~3.8 MB), SHA-256 `96ade2c5cec25ce494c0c09b6d55c492dd6fdc51422b40f3a862676562d02bd4`. On the SM-S921B, BL_1 Tune 1 now opens on its printed header — title, "Kaib Ina", "Phil. 2:9-10", Edward Perronet / Diadem / Holden Holden and "DOH IS G" — with the page number and "BIAKNA LATE" still cropped away.
- **2026-11-24 — 1.5.76 stops the update loop that 1.5.75 caused.** 1.5.75 bumped `version.json`, `sw.js` and `build.gradle` but not `const APP_VERSION` in `app.js`, so the 1.5.75 package still called itself 1.5.74: the startup check downloaded and "installed" 1.5.75 on every launch, forever. The checker now compares against `Capacitor App.getInfo().version` (the installed package) and keeps the bundled constant only as a fallback, and Settings prints the same authoritative value. `android-release.yml` now fails before building when `version.json`, `versionName` and `app.js APP_VERSION` disagree, so a release cannot drift again. The E2E suite covers the exact loop: a native page whose package version equals the published version starts no download and shows no dialog. Signed 1.5.76 [run 45453398012](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45453398012): **37,414,462 bytes**, SHA-256 `1efff9bcfb8f589613c24bcc702f538294a85d983f29901735bfc4be98ac871e`; Pages [run 45453389409](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45453389409). Browser suite: **240/240** (the PWA cache probe flaked on the first run after the cache rename and passed on rerun). On the SM-S921B, 1.5.76 launched with no update prompt — the loop is gone.
- **2026-11-24 — 1.5.75 heals a stale on-device chord chart.** With the SM-S921B back on ADB, 1.5.74 still showed BL_1 with chords on verse 1 only, and **Edit Chords** reported **11 chords**: this phone had its own saved BL_1 chart covering verse 1, and a local chart outranks both the published and the bundled one, so 1.5.73's published-chart merge never ran for it. The shipped `chords.json` charts now live in their own map (`BUNDLED_CHORD_CHARTS`), and `chordChartFor` fills a local chart's missing verses from the published chart first, then the shipped one, transposing each borrowed line into the local chart's key. The editor saves `allVerses: true` (it always writes every verse), so a verse the user empties on purpose is never refilled; only charts from older builds and old backups heal, once, on first read. `saveChordEditor` also copies the existing entry instead of mutating it, so saving can no longer rewrite the shipped fallback in place. Coverage in `test_chord_sync`: a stale one-verse local chart borrows verses 2-6 with the shipped G chords transposed into the device's D, while an `allVerses` chart keeps its deliberately empty verse. On the same device the 1.5.74 picker was confirmed: one tap on a lyric opened the wheel, and x, a tap outside, and the back key each closed it without charting a chord. This build shipped without its `APP_VERSION` bump and looped its own update prompt; 1.5.76 fixes that. Signed 1.5.75 [run 45447739562](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45447739562): **37,414,214 bytes**, SHA-256 `6a131a488fab48149a90e832a616c9c35339c9513bedd743fa25a43b5f87b02c`; Pages [run 45447732244](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45447732244). Browser suite: **238/238**. Installed on the SM-S921B over 1.5.74 with data intact; with the stale 11-chord local chart still on the device, BL_1 renders chords on verses 2–6 (G D G / G D / Em D G / G C G) exactly as on verse 1, and the editor opens on the merged chart at **66 chords** with the borrowed lines in place — closed without saving, so the device's own chart is untouched.
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
- **2026-11-24 — 1.5.74 opens the chord picker on a tap and dismisses it like a popup.** A phone report said charting a lyric needed a press-and-hold. The picker had opened on `pointerup`, and a quick tap whose finger drifts a pixel or two is read by the browser as the start of a scroll — which fires `pointercancel` and never delivers the release, while holding still does. Taps are now taken from `click` (a scroll produces no click), so one tap on a letter, the gap beside it, or the empty chord lane opens the picker; chord drags still run on pointer events and swallow the click that follows a drag. The picker also gained an x button, closes on any tap outside it (capture-phase, so the tap cannot chart a chord underneath), and Android's back gesture closes it before anything else. Escape still works. Coverage in `e2e_full` includes real `touchscreen.tap` on a 390×844 page. Signed 1.5.74 [run 45439629137](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45439629137): **37,413,486 bytes**, SHA-256 `9f9ae0cf32f3eec2cb39efd73700f43b62f75033da76bbd2d1e907efa4245a1d`. Browser suite: **238/238**. The known PWA cache assertion flaked once and passed on rerun. On-device check still pending — the SM-S921B has not been on ADB since 1.5.72.
- **2026-11-24 — 1.5.73 keeps chords on the lane and on every verse.** Two field reports: a chord added on the phone drew over the lyric and adding one felt like it needed a press-and-hold, and BL_1's verses 2–6 had lost their chords again. The editor only reserved the chord lane on lines charted at render time, so a line gaining its first chord placed the chip at the word's top with no padding; `ceLayoutLine` now toggles `has-chords`, and any tap inside a lyric line (including the empty lane above a word) resolves to the nearest syllable instead of requiring a glyph hit. The BL_1 regression was data: published edits seq 16, 17 and 785 carry `verseLines` `[11,0,0,0,0,0]`, and since 1.5.69 a published chart outranks the bundled one, so the six-verse bundled chart was masked. `chordChartFor` now merges empty published verses with the bundled chart before rendering. Regression coverage in `e2e_full` (lane tap, lane reservation) and `test_chord_sync` (partial published chart). Signed 1.5.73 [run 45407386507](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45407386507): **37,412,894 bytes**, SHA-256 `2b85fac71119ef6ba5658e67d83e9c02a1e8848ba40565023fcada243bbff82a`. Browser suite: **231/231**. On-device check is pending — the SM-S921B dropped off ADB before the APK could be installed.
- **2026-11-24 — 1.5.72 saves solfa downloads on Android.** Testing 1.5.71 on the SM-S921B showed **Download tonic solfa** did nothing: Capacitor's WebView has no `DownloadListener`, so the `<a download>` blob URL was ignored and no file or toast appeared. 1.5.72 adds `DownloadBridge` (`KhristianDownload`) in `MainActivity`, which decodes the blob in JS and writes it to public Downloads through MediaStore, falling back to the bundled sheet when R2 is unreachable. On-device check: the sheet renders and downloads `BL_1-t1.avif` at **187,739 bytes**, SHA-256 `0861fa6c1b4802a540b6f28d13ad8d5fa08ccf73e764be1b13437e100a19ccb6`, identical to `solfa-hd/BL_1-t1.avif` in R2, with the native toast “Saved to Downloads/BL_1-t1.avif”. Signed 1.5.72 [run 45400437740](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45400437740): **37,412,334 bytes**, SHA-256 `899124ff89c3b8cd0bc80144662a229444175877d538868db8938e1070d6595b`; Pages [run 45400429777](https://github.com/minatolun-dotcom/khristian-labu/actions/runs/45400429777). Browser suite: **228/228**.
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
  back to the bundled sheet, so the action always produces a file. On Android the
  bytes go through the `KhristianDownload` MediaStore bridge
  (`MainActivity.DownloadBridge`) into public Downloads: Capacitor's WebView has
  no `DownloadListener`, so an `<a download>` with a blob URL silently does
  nothing. The web build keeps the anchor download.
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
