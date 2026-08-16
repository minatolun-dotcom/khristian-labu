#!/usr/bin/env python3
"""Thorough data-corpus validation for Khristian Labu."""
import json, gzip, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []
def check(name, cond, detail=''):
    tag = 'PASS' if cond else 'FAIL'
    print(f"{tag}  {name}{(' — ' + detail) if detail and not cond else ''}")
    if not cond: fails.append(name)

data = json.load(open(os.path.join(ROOT, 'songs.json'), encoding='utf-8'))
meta = json.load(open(os.path.join(ROOT, 'groups.json'), encoding='utf-8'))

# 1. top-level structure
check('songs.json has groups', 'groups' in data and isinstance(data['groups'], list))
check('groups.json has groups', 'groups' in meta and isinstance(meta['groups'], list))

groups = data['groups']
books = {}
for g in groups:
    for code in g.get('books', []):
        books[code] = g['id']

check('group ids unique', len({g['id'] for g in groups}) == len(groups))
for g in groups:
    check(f"group '{g['id']}' has name", bool(g.get('name')))
    check(f"group '{g['id']}' books unique", len(set(g.get('books', []))) == len(g.get('books', [])))

# 2. every referenced book exists, has info + songs
book_codes = list(books.keys())
for code in book_codes:
    ok = code in data and isinstance(data[code], dict) and isinstance(data[code].get('songs'), list)
    check(f"book '{code}' present with songs", ok)
    if ok:
        check(f"book '{code}' has info.name", bool((data[code].get('info') or {}).get('name')))

# 3. groups.json counts match songs.json (meta books are {code,name,count} objects)
for g in meta['groups']:
    for b in g.get('books', []):
        code = b['code'] if isinstance(b, dict) else b
        actual = len(data[code]['songs']) if code in data else -1
        expected = b.get('count') if isinstance(b, dict) else None
        if expected is not None:
            check(f"meta count {code}={expected} == actual {actual}", expected == actual, f"code={code}")

# 4. song-level integrity
ALLOWED_TYPES = {'v', 'c', 'b', 'p', 'pc'}
# a leading "N." is a verse-number artifact UNLESS it's a bible ref like "2 Kor. 5:14"
# (kept on purpose as preface scripture).
BIBLE_REF = re.compile(r'^\s*\d+\s*[A-Za-z]{2,}\.?\s*\d+:\d+')
VERSE_ARTIFACT = re.compile(r'^\d+[\.\)]?\s')
total = 0
no_number = 0
global_ids = {}
html_re = re.compile(r'<[a-zA-Z/][^>]*>')
for code in book_codes:
    seen = {}
    for s in data[code]['songs']:
        total += 1
        sid = s.get('id')
        check(f"{code}/{sid}: id unique in book", sid not in seen) if False else None
        if sid in seen:
            check(f"duplicate id {code}/{sid}", False, 'duplicate within book')
        seen[sid] = 1
        global_ids[sid] = global_ids.get(sid, 0) + 1
        check(f"{code}/{sid}: has title", bool((s.get('title') or '').strip()))
        if not str(s.get('number', '')).strip(): no_number += 1  # e-Hymn source files can lack numbers (app falls back to list index)
        verses = s.get('verses')
        check(f"{code}/{sid}: verses is list", isinstance(verses, list) and len(verses) > 0)
        if not isinstance(verses, list): continue
        for vi, v in enumerate(verses):
            t = v.get('type', 'v')
            check(f"{code}/{sid}: verse {vi} type ok", t in ALLOWED_TYPES, f"type={t}")
            lines = v.get('lines')
            check(f"{code}/{sid}: verse {vi} lines list non-empty", isinstance(lines, list) and len(lines) > 0)
            if not isinstance(lines, list): continue
            for ln in lines:
                check(f"{code}/{sid}: line is str", isinstance(ln, str))
                if isinstance(ln, str):
                    check(f"{code}/{sid}: no HTML tags in lyrics", not html_re.search(ln), repr(ln[:60]))
                    # leading number is an artifact UNLESS it's a bible reference (kept on purpose)
                    check(f"{code}/{sid}: no leading verse-number artifact", not (VERSE_ARTIFACT.match(ln) and not BIBLE_REF.match(ln)), repr(ln[:40]))

dups = {k: v for k, v in global_ids.items() if v > 1}
check('no duplicate song ids across corpus', not dups, str(list(dups)[:5]))
print(f"  -> {total} songs validated; {no_number} songs without a number (by design, app falls back to list index)")

# 5. gzip matches plain
plain = open(os.path.join(ROOT, 'songs.json'), 'rb').read()
gz = gzip.open(os.path.join(ROOT, 'songs.json.gzip'), 'rb').read()
check('songs.json.gzip decompresses to identical bytes', gz == plain, f'{len(plain)} vs {len(gz)}')

# 6. config files parse
for f in ['groups.json', 'manifest.webmanifest', 'version.json']:
    try:
        json.load(open(os.path.join(ROOT, f), encoding='utf-8'))
        check(f'{f} parses', True)
    except Exception as e:
        check(f'{f} parses', False, str(e))

print()
print('FAILURES:', len(fails), fails if fails else 'none')
sys.exit(1 if fails else 0)
