#!/usr/bin/env python3
"""Merge the KBC and Zomi songbook XAPK JSON into the app's songs.json.

Source assets (already extracted to sources/):
  sources/kbc/houbungla.json   -> book "HB"
  sources/kbc/ladeilhen.json   -> book "LD"
  sources/zomi/labu.json       -> books "ZG" (Galhiam), "ZT" (Tedim Labu 7th Edition),
                                   "ZW" (Worship Songs), "ZP" (Phatna Luangkhawm)

The existing 4 books (B&P, BL, PN, SM) are preserved untouched.
A top-level "groups" array describes the 3 main songbooks + their sub-divisions.
"""
import json, re, html, os, gzip

ROOT = os.path.dirname(os.path.abspath(__file__))

def load(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return json.load(f)

# ─── KBC: plain-text lyrics with [CHORUS_START]/[CHORUS_END] markers ───
def kbc_verses(lyrics, reference=None):
    parts = re.split(r'\[(CHORUS_START|CHORUS_END)\]', lyrics)
    verses, mode = [], 'v'
    for part in parts:
        if part == 'CHORUS_START':
            mode = 'c'; continue
        if part == 'CHORUS_END':
            mode = 'v'; continue
        for stanza in re.split(r'\n\s*\n', part):
            lines = [l.strip() for l in stanza.split('\n') if l.strip()]
            if lines:
                verses.append({'type': mode, 'lines': lines})
    if reference:
        verses.append({'type': 'p', 'lines': ['Reference: ' + reference]})
    return verses

def kbc_book(path, code, name, desc):
    data = load(path)
    songs = []
    for s in data:
        num = s.get('number')
        songs.append({
            'id': f"{code}_{num}",
            'title': s.get('title', '').strip(),
            'author': s.get('author', '') or '',
            'number': str(num),
            'key': s.get('key', '') or '',
            'verses': kbc_verses(s.get('lyrics', ''), s.get('reference')),
        })
    return code, {'info': {'name': name, 'description': desc, 'icon': ''}, 'songs': songs}

# ─── Zomi: HTML body, grouped by "type" ───
ZOMI_MAP = {
    'Galhiam': ('ZG', 'Galhiam'),
    'Tedim Labu 7th Edition': ('ZT', 'Tedim Labu 7th Edition'),
    'Worship Songs': ('ZW', 'Worship Songs'),
    'Phatna Luangkhawm': ('ZP', 'Phatna Luangkhawm'),
}

def zomi_verses(body):
    b = (body or '').replace('<br>', '\n').replace('<br/>', '\n')
    b = re.sub(r'</p>\s*<p[^>]*>', '\n\n', b)   # paragraph boundary -> blank line
    b = re.sub(r'<[^>]+>', '', b)               # strip remaining tags
    b = html.unescape(b)
    verses, cur = [], []
    for ln in b.split('\n'):
        ln = ln.strip()
        if ln == '':
            if cur:
                verses.append(cur); cur = []
        else:
            cur.append(ln)
    if cur:
        verses.append(cur)
    result = []
    for v in verses:
        vtype = 'v'
        if not v:
            continue
        first = re.sub(r'[\s\-0-9]+$', '', v[0].strip())
        fl = first.lower()
        if fl in ('chorus', 'refrain'):
            vtype = 'c'; v = v[1:]
        elif fl == 'bridge':
            vtype = 'b'; v = v[1:]
        elif fl.replace('-','') in ('prechorus', 'pre chorus', 'pre-chorus'):
            vtype = 'pc'; v = v[1:]
        elif re.match(r'^verse\s*\d*\s*$', fl):
            # "Verse 1" / "Verse" label only — strip it, keep the lyrics
            v = v[1:]
            if not v:
                continue
        elif re.match(r'^(phuak|bpm|timesig|time sig|key|composer|author|tune|metre|meter|copyright|capo)', fl):
            # song metadata, not a verse
            continue
        if v:
            result.append({'type': vtype, 'lines': v})
    return result

def zomi_books(path):
    data = load(path)
    out = {}
    for s in data:
        t = s.get('type')
        if t not in ZOMI_MAP:
            continue
        code, name = ZOMI_MAP[t]
        num = s.get('number')
        song = {
            'id': f"{code}_{num}",
            'title': s.get('title', '').strip(),
            'author': '',
            'number': str(num),
            'key': s.get('key', '') or '',
            'verses': zomi_verses(s.get('body', '')),
        }
        out.setdefault(code, {'info': {'name': name, 'description': 'Zomi Labu', 'icon': ''}, 'songs': []})
        out[code]['songs'].append(song)
    return out

def main():
    songs = load('songs.json')
    groups = [
        {'id': 'kl',   'name': 'Khristian Labu',                 'icon': '', 'desc': 'Biakna leh Phatna',        'books': ['B&P', 'BL', 'PN', 'SM']},
        {'id': 'kbc',  'name': 'KBC Houbungla leh Ladeilhen',    'icon': '', 'desc': 'KBC literature',             'books': ['HB', 'LD', 'LC']},
        {'id': 'zomi', 'name': 'Zomi Labu',                      'icon': '', 'desc': 'Galhiam, Tedim, Worship, Phatna', 'books': ['ZG', 'ZT', 'ZW', 'ZP']},
    ]

    # KBC books
    for path, code, name, desc in [
        ('sources/kbc/houbungla.json', 'HB', 'Houbungla', 'KBC'),
        ('sources/kbc/ladeilhen.json', 'LD', 'Ladeilhen', 'KBC'),
        ('sources/kbc/lachom.json', 'LC', 'La Chom', 'KBC'),
    ]:
        c, book = kbc_book(path, code, name, desc)
        songs[c] = book

    # Zomi books
    for code, book in zomi_books('sources/zomi/labu.json').items():
        songs[code] = book

    songs['groups'] = groups

    # ponytail: emit both plain and gzipped corpus; app fetches .gzip when supported.
    # Use .gzip (not .gz) so Android's asset merger doesn't treat it as a duplicate of songs.json.
    payload = json.dumps(songs, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(ROOT, 'songs.json'), 'w', encoding='utf-8') as f:
        f.write(payload)
    with gzip.open(os.path.join(ROOT, 'songs.json.gzip'), 'wt', encoding='utf-8') as f:
        f.write(payload)

    total = sum(len(songs[k]['songs']) for g in groups for k in g['books'])
    print(f"Wrote songs.json: {total} songs across {len(groups)} main songbooks / "
          f"{sum(len(g['books']) for g in groups)} sub-books")
    for g in groups:
        print(f"  {g['name']}: " + ', '.join(f"{k}={len(songs[k]['songs'])}" for k in g['books']))

if __name__ == '__main__':
    main()
