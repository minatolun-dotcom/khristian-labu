#!/usr/bin/env python3
"""Songbook data sanity check for Khristian Labu.

The app now fetches songs.json at runtime (no data is embedded in index.html),
so this tool no longer bakes data into index.html. Its job is to:
  1. Validate songs.json (structure, groups, sub-book counts).
  2. Guarantee index.html is in fetch mode (no inline DEFAULT_SONGS blob),
     so an accidental re-embed can never blow the localStorage quota.

Run: python build_admin.py
"""
import json, re, os, sys

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.abspath(__file__))


def main():
    with open(os.path.join(ROOT, 'songs.json'), encoding='utf-8') as f:
        data = json.load(f)

    assert 'groups' in data, "songs.json is missing the 'groups' array"
    groups = data['groups']
    book_codes = [b for g in groups for b in g['books']]
    for code in book_codes:
        assert code in data, f"group references missing book '{code}'"
        assert 'songs' in data[code], f"book '{code}' has no 'songs'"

    total = sum(len(data[b]['songs']) for b in book_codes)
    print(f"songs.json OK: {total} songs across {len(groups)} main songbooks / {len(book_codes)} sub-books")

    # Ensure index.html stays in fetch mode (no inline corpus).
    p = os.path.join(ROOT, 'index.html')
    html = open(p, encoding='utf-8').read()
    stripped = re.sub(
        r'const DEFAULT_SONGS = .*?;\nlet SONGS = \{\};',
        "let DEFAULT_SONGS = null;\nlet SONGS = {};",
        html, flags=re.DOTALL,
    )
    if stripped != html:
        open(p, 'w', encoding='utf-8').write(stripped)
        print("Stripped inline DEFAULT_SONGS from index.html (fetch mode).")
    else:
        print("index.html already in fetch mode.")


if __name__ == '__main__':
    main()
