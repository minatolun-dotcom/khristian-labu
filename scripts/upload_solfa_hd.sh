#!/usr/bin/env bash
# Upload the 480 DPI solfa sheets to R2 (labu-artifacts).
#
# The app fetches them from https://dl.labu.lengkhawm.online/solfa-hd/v4/<file>.avif
# (v4 keeps a whole-page tune's last lyric line inside the crop; v2/v3 and the
#  unversioned path stay untouched so their immutable caches keep the old crop)
# and keeps the bundled 240 DPI copies as the offline/fallback view.
#
#   npm run solfa:hd          # build solfa-hd/ from the printed PDF
#   npm run solfa:hd:upload   # push every bundled sheet to R2
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=solfa-hd
[ -d "$SRC" ] || { echo "missing $SRC — run: npm run solfa:hd" >&2; exit 1; }

# Only the sheets the app can actually ask for: one HD file per bundled AVIF.
names=$(ls assets/solfa)
count=$(printf '%s\n' "$names" | wc -l)
missing=$(for n in $names; do [ -f "$SRC/$n" ] || echo "$n"; done)
if [ -n "$missing" ]; then
  echo "missing HD sheets:" >&2
  printf '%s\n' "$missing" >&2
  exit 1
fi
echo "uploading $count sheets from $SRC to labu-artifacts/solfa-hd/v4/ ..."

# Each sheet is immutable content under its own name, so it can be cached for a
# year at both the edge and in the browser. --remote is required: without it,
# `r2 object put` writes to Wrangler's local simulated bucket. 10 parallel calls
# keep the 496-object run to a couple of minutes without hammering the API.
for n in $names; do printf '%s\0' "$SRC/$n"; done | xargs -0 -P 10 -I{} bash -c '
  f="$1"
  npx --no-install wrangler r2 object put "labu-artifacts/solfa-hd/v4/$(basename "$f")" \
    --file "$f" \
    --content-type image/avif \
    --cache-control "public, max-age=31536000, immutable" \
    --remote > /dev/null
' _ {}

echo "uploaded $count sheets"
