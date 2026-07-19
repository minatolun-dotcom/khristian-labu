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

# shared: a verse-start is "N." / "N) " / "N " followed by text, but NOT a bible
# reference like "2 Kor. 5:14" (which belongs in the preface and must stay).
VERSE_START = re.compile(r'^\s*\d+[\.\)]?\s+\S')
BIBLE_REF   = re.compile(r'^\s*\d+\s*[A-Za-z]{2,}\.?\s*\d+:\d+')
# strip a leading verse marker from a line: "N." / "N)" / "(N)" / "N " (incl.
# N<space> before a voice label like "All:"). Bible references ("2 Kor. 5:14")
# are NOT verse numbers and must be kept, so callers use strip_lead() which
# short-circuits on BIBLE_REF.
LEAD_NUM = re.compile(r'^\s*(?:\(\d+\)\s*|\d+[\.\)]\s*|\d+\s+)')


def strip_lead(line):
    line = line.strip()
    if BIBLE_REF.match(line):
        return line
    return LEAD_NUM.sub('', line).strip()

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
            lines = [strip_lead(l) for l in stanza.split('\n')]
            lines = [l for l in lines if l]
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
        ln = strip_lead(ln)
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

# ─── La (Thiangtho/Vaiphei): HTML lyrics, <b>N.</b> verse markers, <i> chorus ───
def la_verses(lyrics):
    raw = re.split(r'<br\s*/?>', lyrics or '')
    verses, cur, cur_type = [], [], None
    in_chorus = False

    def flush():
        nonlocal cur, cur_type
        if cur:
            verses.append({'type': cur_type or 'v', 'lines': cur})
        cur = []

    for seg in raw:
        has_open = '<i>' in seg
        has_close = '</i>' in seg
        text = re.sub(r'</?b>', '', seg)
        if has_open and has_close:
            inner = re.sub(r'.*?<i>(.*?)</i>.*', r'\1', text, flags=re.S)
            flush()
            lines = [l.strip() for l in inner.split('\n') if l.strip()]
            if lines:
                verses.append({'type': 'c', 'lines': lines})
            cur_type = None
            continue
        if has_open:
            flush(); cur_type = 'c'; in_chorus = True
            text = re.sub(r'.*?<i>', '', text, flags=re.S)
        if has_close:
            text = re.sub(r'</i>.*', '', text, flags=re.S)
            in_chorus = False
        for ln in text.split('\n'):
            ln = strip_lead(ln)
            if not ln:
                if cur:
                    flush(); cur_type = None
                continue
            cur_type = 'c' if (in_chorus or cur_type == 'c') else 'v'
            cur.append(ln)
    flush()
    return verses

def la_book(path, code, name, desc):
    data = load(path)
    songs = []
    for s in data:
        num = s.get('songNumber')
        songs.append({
            'id': f"{code}_{num}",
            'title': s.get('title', '').strip(),
            'author': '',
            'number': str(num),
            'key': '',
            'verses': la_verses(s.get('lyrics', '')),
        })
    return code, {'info': {'name': name, 'description': desc, 'icon': ''}, 'songs': songs}

# ─── Gangte e-Hymn: one plain .txt per song (UUID-named); line 1 = "N. Title",
#     optional tune/ref metadata line(s), then blank-separated numbered verses ───
EH_SEP_RE = re.compile(r'^[\s~_=\-]{5,}$')
EH_NUM_RE = re.compile(r'^\s*(\d+)[\.\)]\s+(.*)$')
EH_VNUM_RE = re.compile(r'^\s*\d+[\.\)]\s+(.*)$')

def ehymn_song(path):
    raw = open(path, encoding='utf-8-sig').read()
    lines = raw.split('\n')
    while lines and EH_SEP_RE.match(lines[-1].strip()):
        lines.pop()
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return None
    title = lines[0].strip()
    m = EH_NUM_RE.match(title)
    number = m.group(1) if m else ''
    if m:
        title = m.group(2).strip()
    preface, verses, seen = [], [], False
    for blk in re.split(r'\n\s*\n', '\n'.join(lines[1:])):
        bl = [x.strip() for x in blk.split('\n') if x.strip()]
        if not bl:
            continue
        is_vstart = bool(VERSE_START.match(bl[0])) and not BIBLE_REF.match(bl[0])
        if not seen and not is_vstart:
            # tune / ref metadata line — still strip a stray leading verse marker
            preface.extend([strip_lead(x) for x in bl])
            continue
        seen = True
        # strip a leading verse marker (N. / N) / N ) from every line
        bl = [strip_lead(x) for x in bl]
        verses.append({'type': 'v', 'lines': bl})
    if preface:
        verses.insert(0, {'type': 'p', 'lines': preface})
    return {'number': number, 'title': title, 'verses': verses}

def ehymn_books(dirpath, codes, names, desc):
    # ponytail: split into N books by alternating each repeated number across books,
    # so every book ends up with unique numbering (e-Hymn has 2 collections that
    # both number 1..N). First occurrence of a number -> book 0, 2nd -> book 1, ...
    import glob as _g
    from collections import OrderedDict
    alls = []
    for f in sorted(_g.glob(os.path.join(ROOT, dirpath, '*.txt'))):
        s = ehymn_song(f)
        if not s:
            continue
        stem = os.path.splitext(os.path.basename(f))[0]
        alls.append({'id': stem, 'title': s['title'], 'author': '',
                     'number': s['number'], 'key': '', 'verses': s['verses']})
    alls.sort(key=lambda x: (int(x['number']) if x['number'].isdigit() else 9999, x['id']))
    buckets = OrderedDict()
    for s in alls:
        buckets.setdefault(s['number'] or 'zzz', []).append(s)
    books = {c: {'info': {'name': n, 'description': desc, 'icon': ''}, 'songs': []}
             for c, n in zip(codes, names)}
    for lst in buckets.values():
        for j, s in enumerate(lst):
            c = codes[j % len(codes)]
            sc = dict(s); sc['id'] = f"{c}_{s['id']}"
            books[c]['songs'].append(sc)
    return books

# ─── Gangte KRISTIEN LABU: scraped from https://media.ipsapps.org/gnb/ora/songbook/
#     App Builder "rab" HTML. div classes: s=title, r=scripture ref, pr=tune,
#     p=meter ("Doh is .."), q=verse line, q3=chorus line, b/qc=stanza break ───
def klab_book(dirpath, code, name, desc):
    import glob as _g, re as _re
    from html.parser import HTMLParser
    KL = {'s', 'r', 'pr', 'p', 'q', 'q3', 'b', 'qc'}

    class P(HTMLParser):
        def __init__(self):
            super().__init__(); self.cur = None; self.depth = 0; self.buf = ''
            self.divs = []
        def handle_starttag(self, tag, attrs):
            if tag == 'div':
                cls = dict(attrs).get('class')
                if cls in KL and self.cur is None:
                    self.cur = cls; self.depth = 0; self.buf = ''
                elif self.cur is not None:
                    self.depth += 1
        def handle_endtag(self, tag):
            if tag == 'div' and self.cur is not None:
                if self.depth > 0:
                    self.depth -= 1
                else:
                    self.divs.append((self.cur, self.buf)); self.cur = None; self.buf = ''
        def handle_data(self, data):
            if self.cur is not None:
                self.buf += data

    songs = []
    for f in sorted(_g.glob(os.path.join(ROOT, dirpath, '*.html'))):
        h = open(f, encoding='utf-8', errors='ignore').read()
        m = _re.search(r'<title>([^<]+)</title>', h)
        num = _re.search(r'(\d+)\s*$', m.group(1).strip()).group(1) if m else ''
        p = P(); p.feed(h)
        title = None; preface = []; verses = []; cur_v = []; cur_c = []; in_verse = False

        def flush():
            nonlocal cur_v, cur_c
            if cur_v:
                verses.append({'type': 'v', 'lines': [strip_lead(x) for x in cur_v]}); cur_v = []
            if cur_c:
                verses.append({'type': 'c', 'lines': [strip_lead(x) for x in cur_c]}); cur_c = []

        for cls, inner in p.divs:
            t = _re.sub(r'\s+', ' ', inner.replace('\xa0', ' ')).strip()
            if cls == 's':
                if title is None:
                    title = t
                continue
            if cls in ('b', 'qc'):
                flush(); in_verse = False; continue
            if cls == 'q3':                       # chorus line
                if cur_v:
                    flush()
                cur_c.append(strip_lead(t)); in_verse = False; continue
            is_vstart = bool(VERSE_START.match(t)) and not BIBLE_REF.match(t)
            if is_vstart:                         # numbered verse start
                flush()
                cur_v = [strip_lead(t)]; in_verse = True; continue
            if in_verse:                          # continuation of current verse
                cur_v.append(strip_lead(t)); continue
            preface.append(strip_lead(t))   # scripture ref / tune / meter
        flush()
        if preface:
            verses.insert(0, {'type': 'p', 'lines': preface})
        songs.append({'id': f"{code}_{num}", 'title': title or '', 'author': '',
                      'number': num, 'key': '', 'verses': verses})
    # renumber sequentially from 1 (source numbers start at 100)
    songs.sort(key=lambda x: (int(x['number']) if x['number'].isdigit() else 9999, x['id']))
    for i, s in enumerate(songs):
        s['number'] = str(i + 1)
        s['id'] = f"{code}_{i + 1}"
    return code, {'info': {'name': name, 'description': desc, 'icon': ''}, 'songs': songs}

# ─── Mizo Khristian Labu (Zofate): SQLCipher DB exported to sources/mizo/hlabu.json.
#     Songs have no verse/chorus markers; lyrics are run-on text. Imported as ONE
#     flat book (no key-based sub-books); each song keeps its 'key' as metadata. ───
MIZO_SENT_RE = re.compile(r'(?<=[.!?])\s+')

def mizo_verses(text):
    text = (text or '').strip()
    if not text:
        return []
    lines = [strip_lead(s) for s in MIZO_SENT_RE.split(text) if s.strip()]
    return [{'type': 'v', 'lines': lines}]

def mizo_book(path, code, name, desc):
    # ponytail: flat single book; sentence-split lyrics, pull "Lettu <composer>" into author.
    data = load(path)
    songs = []
    for s in data:
        k = (s.get('keys') or '').strip()
        thu = s.get('thu') or ''
        author = s.get('author') or ''
        m = re.search(r'\s*Let(?:t)?u(?:te)?\s*(.*)$', thu, re.I)
        if m:
            author = (author + ' ' + m.group(1).strip()).strip()
            thu = thu[:m.start()].strip()
        num = str(s.get('page_no'))
        songs.append({
            'id': f"{code}_{num}",
            'title': (s.get('title') or '').strip(),
            'author': author,
            'number': num,
            'key': k,
            'verses': mizo_verses(thu),
        })
    songs.sort(key=lambda x: int(x['number']) if x['number'].isdigit() else 9999)
    return code, {'info': {'name': name, 'description': desc, 'icon': ''}, 'songs': songs}

def main():
    songs = load('songs.json')
    groups = [
        {'id': 'kl',   'name': 'Khristian Labu (EBC)',          'icon': '', 'desc': 'Biakna leh Phatna',        'books': ['B&P', 'BL', 'PN', 'SM']},
        {'id': 'kbc',  'name': 'KBC Houbungla leh Ladeilhen',    'icon': '', 'desc': 'KBC literature',             'books': ['HB', 'LD', 'LC']},
        {'id': 'zomi', 'name': 'Zomi Labu',                      'icon': '', 'desc': 'Galhiam, Tedim, Worship, Phatna', 'books': ['ZG', 'ZT', 'ZW', 'ZP']},
        {'id': 'la',   'name': 'La Thiangtho Vaiphei Labu',     'icon': '', 'desc': 'La, Thiangtho, Vaiphei',      'books': ['LT']},
        {'id': 'geh',  'name': 'Gangte',                        'icon': '', 'desc': 'Gangte hymn collections',     'books': ['EH1', 'EH2', 'GK', 'GL']},
        {'id': 'mz',   'name': 'Khristian Hla Bu (Mizo)',      'icon': '', 'desc': 'Mizo hymnal (Zofate)',        'books': ['MZ']},
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

    # La (Thiangtho / Vaiphei) — single flat book
    c, book = la_book('sources/la/songs.json', 'LT', 'La Thiangtho Vaiphei', 'La')
    songs[c] = book

    # Gangte e-Hymn — split into e-Hymn 1 / e-Hymn 2 (alternating repeated numbers)
    for c, book in ehymn_books('sources/ehymn', ['EH1', 'EH2'],
                                ['e-Hymn 1', 'e-Hymn 2'], 'Gangte').items():
        songs[c] = book
    # Gangte KRISTIEN LABU — scraped from media.ipsapps.org songbook
    c, book = klab_book('sources/klab', 'GK', 'Kristien Labu', 'Gangte')
    songs[c] = book
    # Gangte LA LAKKHAWM — scraped from the same songbook (book 01)
    c, book = klab_book('sources/lakkhawm', 'GL', 'La Lakkhawm', 'Gangte')
    songs[c] = book

    # Mizo Khristian Labu (Zofate) — one flat book (no key sub-books)
    c, book = mizo_book('sources/mizo/hlabu.json', 'MZ', 'Khristian Hla Bu (Mizo)', 'Mizo (Zofate)')
    songs[c] = book

    songs['groups'] = groups

    # ponytail: tiny metadata so the home grid paints instantly without parsing the full corpus.
    meta = []
    for g in groups:
        books = []
        for code in g['books']:
            bk = songs.get(code, {})
            books.append({'code': code, 'name': (bk.get('info') or {}).get('name', code), 'count': len(bk.get('songs', []))})
        meta.append({'id': g['id'], 'name': g['name'], 'desc': g.get('desc', ''), 'icon': g.get('icon', ''), 'books': books})
    with open(os.path.join(ROOT, 'groups.json'), 'w', encoding='utf-8') as f:
        json.dump({'groups': meta}, f, ensure_ascii=False, separators=(',', ':'))

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
