# Khristian Labu

A gospel songbook app — 5,723 hymns across 17 songbooks in 6 collections.

[Try it live](https://minatolun-dotcom.github.io/khristian-labu/) · [Download the APK](https://github.com/minatolun-dotcom/khristian-labu/releases)

## Screenshots

**Web**

![Web app](Desktop-Screenshot.png)

**Android**

![Android app](Mobile-Screenshot.png)

## Features

- 17 songbooks across 6 Kuki, Zomi, and Mizo collections
- Full-text search of titles, lyrics, authors, and numbers across every songbook, with filters, sorting, and recent searches
- Choose which main songbooks appear on Home and in search; turn off collections you don't use
- Favorites and recently viewed songs, saved on device
- Playlists with rename, delete, and JSON or text export
- Reader with font size, line spacing, scroll memory, verse jump, and swipe navigation
- WhatsApp sharing as text or a full-song image
- Google Drive backup and restore, plus local backup
- Offline access to the entire songbook
- Dark and light themes, plus an admin editor with find and replace

## Install

Download the latest APK from [Releases](https://github.com/minatolun-dotcom/khristian-labu/releases).
To update, install it over the existing app; your data is kept. The app checks `version.json` on
launch and from Settings → Check for update.

## Development

The app is `index.html` and `sw.js` — there is no web build step.

```bash
python3 scripts/serve_dev.py 8080   # http://localhost:8080
```

Build the Android APK:

```bash
npm run sync
cd android && ./gradlew assembleDebug --no-daemon
# android/app/build/outputs/apk/debug/app-debug.apk
```

The padded Android launch-screen icons are tracked in `resources/android-splash/`.
`npm run sync` installs them into the generated `android/` project.

To release, bump `APP_VERSION` in `index.html`, `version.json`, and `CACHE` in `sw.js`, then:

```bash
git tag vX.Y.Z && git push origin main --tags
gh release create vX.Y.Z android/app/build/outputs/apk/debug/app-debug.apk#khristian-labu.apk --latest
```

## Tests

```bash
npm test   # corpus validation + full browser E2E
```

## License

MIT
