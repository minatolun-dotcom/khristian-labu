# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Mizo, Zomi, Vaiphei, Gangte and related-language congregations, choir members and worship leaders who sing from printed hymnals. Primary scene: a dim church service, phone in one hand at reading distance, a hymn announced by number. Secondary scene: quiet personal reading at home.

## Product Purpose
An offline hymnbook app carrying 17 songbooks and 5,723 songs: lyrics, the printed tonic-solfa notation sheet, and a chord chart for each song, searchable across the whole corpus. Success is finding the right hymn and reading it comfortably in seconds, with no network.

## Positioning
The only app that pairs the printed tonic-solfa sheet (as a faithful scan) with clean lyric text and chord charts across several denominational hymnals, working fully offline.

## Operating Context
Services are low-lit; phones are dimmed; the screen is glanced at between lines, not studied. Hymns are referred to by printed number, often in another language's book. Choir practice uses the solfa sheet and chord chart; congregational use is lyrics only. Devices are mid-range Android, frequently in a Capacitor WebView, with unreliable data.

## Capabilities and Constraints
Vanilla HTML/CSS/JS in one index.html, no build step; service worker + IndexedDB caching; Capacitor Android/iOS wrapper; per-song font size and line-height controls persisted locally; favourites, history, playlists, share-as-image; Google-signed-in admin editing of songs and chords; 44px touch targets; prefers-reduced-motion honoured; dark and light themes; printed song numbers must match the books.

## Brand Commitments
The name "Khristian Labu" and its logo mark are fixed. Song numbering and printed-book fidelity are non-negotiable. Colour direction is open by the owner's explicit decision; the incumbent navy/ember identity is not binding.

## Evidence on Hand
songs.json / groups.json (real corpus, 5,723 songs), chords.json (514 real charts), assets/solfa/*.avif (real printed sheets), logo.png. No testimonials, benchmarks, prices or marketing claims exist and none may be invented.

## Product Principles
1. The printed page outranks the chrome: lyrics and notation stay legible before anything decorative.
2. A hymn is reachable in three taps or fewer from a cold start.
3. Offline is the normal case, not a fallback.
4. Controls must work in low light, one-handed, with a thumb.
5. Faithfulness to the printed books (numbers, notation, wording) is the product's credibility.

## Accessibility & Inclusion
WCAG AA text contrast (4.5:1) against the surface it sits on; 44px minimum touch targets; reduced-motion respected; readable at 200% text size.
