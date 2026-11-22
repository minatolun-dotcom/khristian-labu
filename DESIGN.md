# Design — Khristian Labu

<!-- impeccable:design-system 1 -->

## World: Puan (the woven band)

The control language comes from Mizo handwoven cloth: opaque madder bands separated by bone hairlines on an indigo-dyed ground. Cloth has no gloss and nothing shows through it, so the chrome carries no blur, translucency or specular rim. State is drawn, not lit: a woven band marks the active tab, the filled half of a slider, the current switch segment.

Because the primary scene is a dim church, the ground is ink and the ink on it is bone. Brass is reserved for musical notation (chords, key).

## Tokens

| Role | Dark | Light |
|---|---|---|
| Ground | `--bg #0B0E14` | `--bg #F4EFE6` |
| Surface | `--surface #10141C`, `--surface-2 #161B24`, `--surface-3 #1C222D` | `#FBF8F1 / #F3EEE3 / #EAE3D5` |
| Card | `--card #141922` | `--card #FBF8F1` |
| Rule | `--rule #262C38`, strong `#39434F` | `#D9D0BE / #BFB29A` |
| Band (action/state) | `--band #CF4A32`, deep `#A8392A`, bright `#E46245` | `#A8392A / #8F2F23 / #B23B2A` |
| Ink | `--text #F1E9DA`, `--text2 #AAB2C0`, `--text3 #7F8898` | `#1B1A17 / #55524A / #6E6A5F` |
| Notation | `--brass #C9A227`, `--chord #D9B344` | `#7A5E0A` |

Radii: every control — buttons, text fields, switches, segmented tracks, menu rows, list rows, chips and slider tracks/knobs — is a full capsule (`999px`). Cards, sheets and modals keep 12–14px; those are containers, not controls. Shadows are depth only (`0 14px 34px rgba(0,0,0,.42)`), never coloured glow.

Legacy `--glass-*` variables survive as aliases to opaque surfaces so no stale rule can reintroduce a frosted layer; `backdrop-filter` is globally disabled.

**Accent** is the dye, so the six swatches in Settings each rewrite `--band`, `--band-deep`, `--band-bright` and `--band-wash` (plus the legacy `--accent*` and `--select-*` tones) for the current theme. Everything woven follows: tab rail, primary buttons, switches, sliders, chips, the floating block. Madder is the default; ids saved before this palette fall back to it.

## Components

- **Buttons** — capsule (999px), 1px rule, `surface-2`; primary is `band-deep` with `--band-ink` text; press translates 1px down.
- **Bottom tab bar** — full-bleed cloth bar, 1px top rule; the active tab is marked by a single unbroken 3px band rail that slides between the five positions, and its icon thickens (`stroke-width` 1.7 → 2.5). No glow, gradient or lift behind the active icon: selection is weight, not light.
- **Segmented switches** (view tabs, settings) — capsule track, 1px rule, a `band-deep` capsule segment that slides between positions.
- **Reader controls** — capsule opaque bar above a gradient scrim so lyrics fade out instead of clipping; sliders are a 4px capsule track filled with the band and an 18px bone knob.
- **View switch** (Lyrics / Solfa / Chords) — a capsule track with one travelling band segment (`--view-n`, `--view-idx`); the selected label takes `--band-ink`, nothing is filled behind it separately.
- **Song text size** (Settings) — a slider, not stepper buttons, with a live sample set in the chosen reading face at the chosen size. It moves in 0.1px steps and the sample has no transition, so it tracks the thumb exactly.
- **Song header** — previous/next are bare chevrons beside the title (44px tap boxes with no circle, fill or border). Verse labels are neutral (`surface-2` with body ink) and never take the accent dye.
- **Floating song menu** — 54px round madder block; the stack is compact capsule rows, each with a 2px band chip on its leading edge and a 26ms stagger.
- **Menus, dropdowns, sheets, modals** — opaque `surface`, 1px rule, hairline row separators, no blur.
- **Cards and lists** — 12px, 1px rule, flat; hover lifts 2px and strengthens the rule.

## Motion

`--ease-out cubic-bezier(.22,.61,.36,1)`; 120ms press, 180ms state, 240ms reveals, 320ms rail travel. Lists and grids rise 7px with an 18ms stagger. No overshoot, no spring. `prefers-reduced-motion` kills all of it through the existing global rule.

Movement follows the path, not the click. A page enters from the side the move came from (`--puan-dir`, set by view depth: home → list → reader enters from the right, back from the left). The reader itself is exempt so swipe and edge-back keep their own transform; its lyrics rise 12px while its pinned control bar (fade only, never a transform) follows 70ms later. The floating block arrives with the reader, turns on open (menu mark leaves upward, close mark rises in, a 3px band wash ring appears), and its rows leave on a 10ms stagger — a faster mirror of the 26ms opening weft. Entry animations never use a fill mode, so no transform is left behind to fight a drag.

The reader's mode switch is rebuilt on every change, so the band is seeded at the previous index and moved to the new one on the next frame, while the replaced body fades in over 180ms. The settings text-size sample transitions its font size on the same curve, so dragging the slider reads as one continuous change.

## Accessibility

Bone on ink and ink on paper exceed 4.5:1; madder fills use the deep tone under bone text (≈5.3:1). Controls keep 44px touch targets, focus rings are 2px bone at 2px offset, and `aria-*` state on tabs/switches is unchanged.

## Do not

Reintroduce blur, translucent fills, capsule chrome, gradient sheen or spring easing. New surfaces take the tokens above; the reader's lyric surface stays opaque and undecorated. Controls are capsules by decree — do not square off a button, field, switch, menu row or slider. Also do not reintroduce a dashed/segmented selection rail, a glow behind the active tab icon, or a titled hero above the Settings controls.
