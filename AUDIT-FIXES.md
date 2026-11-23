# Khristian Labu — visual audit fix record

Recorded from a real rendered pass (Playwright + Chrome for Testing 159), 29 captures in
`shots/audit/` at 1440×900, 768×1024 and 390×844, dark and light. This started as a work list and
is now the record of what was fixed.

## Status — implemented

Seven of the eight P1 items (P1 7, the reader back button, was added and then removed at the project
owner's request — the reader keeps edge-swipe navigation) and all fourteen P2 items are applied in
`index.html`, plus P3 23, 26, 27 and 28.
Detector findings went from **27 non-advisory to 2** (`overused-font`, `dark-glow`); 29 screenshots
re-captured with 0 console errors.

Deliberately not changed: P3 24 (Inter stays the reading face — swapping the body face changes the
book's voice and deserves its own decision) and the advisory grid ground, which now appears only on
chrome pages and no longer behind lyrics.

Re-run the visual pass:

```bash
node scripts/visual_audit.mjs                         # writes shots/audit/*.png
IMPECCABLE_BROWSER="$HOME/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome" \
  .agents/skills/impeccable/scripts/impeccable shot index.html --viewport 1440x900,390x844 --out shots/audit
```

(`IMPECCABLE_BROWSER` is required: the launcher searches PATH for Chrome, and this machine only has
Playwright's bundled Chrome for Testing.)

## P1 — before release

| # | Where | Problem seen | Fix |
|---|-------|--------------|-----|
| 1 | tokens `--accent`, `--text2/3` | Dark: `#274B9F` on `#090A10` = 2.4:1. Light: `#7B89A1` on `#F2F5FB` ≈ 3.4:1 — light is the default for most users, so the *worse* case is what they see. Song counts, meta rows, section labels all sit in it. | Split accent into `--accent` (fills) and `--accent-ink` (text: #6E92E8 dark / #274B9F light), raise `--text3` to ≥4.5:1 in both themes. |
| 2 | `.logo-sub`, `.hb-kicker`, `.settings-eyebrow`, `.settings-label` | 9.6–10.24px uppercase labels: "GOSPEL SONGBOOK", APPEARANCE/READING/SONGBOOKS/LIBRARY/BACKUP & SYNC/DANGER ZONE. At 390 they are the only structure on the Settings page and they read as texture, not labels. | 11px floor; recover the width by reducing letter-spacing (.26em → .14em). |
| 3 | `.song-item`, `.cat-card`, `.glass-card`, `button` | 56 `backdrop-filter` declarations; every list row blurs 18px. 100+ rows per songbook on a mid-range Android WebView. | Glass on fixed chrome only (tab bar, reader pill, FAB menu). Content rows: flat `--card` with a hairline border. |
| 4 | `.chord-tool-btn` 28px, `.chord-tool-edit` 30px, `.admin-actions button` 28–32px, `.mclear` 32px, `.modal-close` 34px, `.si-chip` ~26px | Transposing a chord is a core action done one-handed; 28px misses. | 44px hit area via padding or `::after` inset, keep the visual size. |
| 5 | `#homeView` desktop | Content is a ~320px band in a 900px viewport: ~200px dead above the logo, ~250px below the cards. Nav is empty except search + menu. Reads unfinished, not spacious. | Give home a real first screen: masthead + collections sized to the viewport (or add the search field and a "continue reading" row into the void). |
| 6 | `body::before` grid over `.song-detail` | The 40px two-axis grid runs *through* the lyrics on 390 and 1440. It is the reading surface; graph paper behind body text is the single biggest craft miss. | Reader gets its own opaque ground (`--bg` or a paper tint) with no grid; keep the grid for chrome-only pages. |
| 7 | `#detailView` on ≤768 | No back button anywhere: phones navigate by edge swipe + Android hardware back only. On a mobile browser or iOS PWA there is no visible or discoverable way out of a song. | Restore a small back control in the reader header (or a swipe-hint affordance on first open). |
| 8 | `button{border-radius:999px!important}` + global glass | One `!important` radius overrides the 22/15px scale for every button including 32px admin icon buttons; the `:not()` chain silently changes shape for any new control family. | Replace with an opt-in `.btn--glass` class; drop the `!important`. |

## P2

| # | Where | Problem | Fix |
|---|-------|---------|-----|
| 9 | `.logo-name`, `.hero h1`, `.hb-name`, `.settings-hero h1` | Gradient text on the wordmark ×4 — AI tell, disappears in forced-colors mode. | Solid ink + `font-weight:800` + negative tracking. |
| 10 | 41 `transition:all` | Animates layout-triggering properties; makes duration audit impossible. | Name the properties. |
| 11 | `#imgPreviewPic` (line 1504), `#googleAvatar` (1681) | `<img>` with no `src` → broken-image box before JS assigns one. | Empty placeholder or `hidden` until a source exists. |
| 12 | Settings view | `h1 "Settings"` → `h3 "Saved Images"`; two card levels nested; "PREFERENCES" kicker above the h1. | h1 → h2 sections; one card level; drop the kicker. |
| 13 | Motion layer | Five entrance keyframes and ad-hoc durations 150–800ms with no tokens (only the easings are tokenised). | One `--dur-1/2/3` scale; one entrance; delete `fadeIn` from `nav .logo` and `h1`. |
| 14 | Line 676 | `*{animation-duration:.01ms!important}` blanket kill, while edge-back drag and pinch stay animated from JS. | Per-surface reduced variants; keep the gestures' commit without the travel. |
| 15 | `--green:#274B9F`, `--amber:#FF7A1A`, `--blue:#3B63C4` | Token names contradict their values. | Rename to `--info/--warm/--accent-2` or delete the unused ones. |
| 16 | `.btn-danger` | `#fff` on `#E5484D` = 3.9:1 at 14px. | Darken the red or set the label to `--warm-ink`. |
| 17 | `.song-item:hover`, `.cat-card:hover`, `.fr-card:hover` | Hover is unguarded above the `@media(hover:hover)` block; a tapped row stays highlighted (mobile-list row 4). | Move base hover styles behind `@media (hover:hover) and (pointer:fine)`; keep `:active` for touch. |
| 18 | `#accentRow` | 15 swatches including violet/lavender (banned by the design brief) and a "White" swatch that is invisible on the white card. | 5–6 accents, no violet, and a visible ring on the white one. |
| 19 | `body[data-view="home"] nav .logo{opacity:0}` (desktop) | Renders a ~10% ghost wordmark top-left instead of hiding it. | `visibility:hidden` or remove it from the home header entirely. |
| 20 | `.chord-empty` | One card high on an otherwise empty 390×844 screen. | Fill the space: a sample chart, or the "how chords work here" line. |
| 21 | Search, mobile | "1386 results for "Jesu"" is clipped under the sticky chip bar; the 4th chip is half-cut by the sort control. | Reserve toolbar height / move the count below the chips; let the chip row scroll clear of the sort. |
| 22 | `.verse p` mobile | `line-height:1.2` on ≤768 overrides the reader's saved 1.6 — the reading mode with the least air is the one on the phone. | Use the same `--reader-lh` default in both. |

## P3

23. 89 characters of body copy in uppercase.
24. Inter as the primary UI face — Outfit belongs on chrome, Inter on dense meta only.
25. The two-axis grid ground is a template texture, not this book's paper.
26. Zero-offset accent glow on the logo (`0 0 15px`).
27. Song counts read "1411 songs" in cards but "5,723 hymns" in the masthead — add thousands separators.
28. Disabled prev arrow at `opacity:.2` in the reader header reads as a broken button, not a state.

## Checked and *not* defects

- The tab bar appearing mid-page in `mobile-settings.png` is a full-page screenshot artifact (fixed
  elements paint at the viewport position); the real 844px viewport is correct.
- A faint vertical seam around the content column in the dark captures is likely a software-raster
  tile edge from `backdrop-filter`; confirm on a device before treating it as a bug.
- No scroll-triggered fades, parallax, tilt, carousels or timed tabs anywhere — the motion bans hold.
