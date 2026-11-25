#!/usr/bin/env python3
"""Build the tonic-solfa AVIF sheets for the BL songbook.

Each tune is cropped from the printed PDF (header/footer/title stripped) and,
when a tune runs over more than one page, the page segments are trimmed and
stitched into one tall sheet with no page-header gaps.

Usage:
    .venv-solfa/bin/python scripts/build_solfa.py --dry-run
    .venv-solfa/bin/python scripts/build_solfa.py --only BL_72
    .venv-solfa/bin/python scripts/build_solfa.py
"""
import argparse
import json
import re
from pathlib import Path

from solfa_scan import page_lines

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageOps
import pillow_avif  # noqa: F401  (registers the AVIF plugin)

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "Tonic Solfa" / "Biakna Late.pdf"
OUT = ROOT / "assets" / "solfa"
STARTS = ROOT / "scripts" / "solfa_starts.json"

SCALE = 240 / 72
X0, X1 = 40, 380
TOP_PDF, BOTTOM_PDF = 550, 45  # content band, excludes running header/footer
PAGE_SEGMENT_GAP = 10
COMPACT_GAP = 18
PAD = 8
QUALITY = 55
SPEED = 6

# Every sheet is placed on a page of A4 proportions: the crop is tight to the
# engraving, so the white frame is what gives the title block room to breathe and
# makes short tunes and long tunes share one canvas width and minimum height.
PAGE_RATIO = 297 / 210
FRAME_PAD = 36  # white band above and below the engraving, in pixels

HD_SCALE = 480 / 72


def set_hd():
    """Render the same sheets at 480 DPI for the R2 copies.

    The app bundles the 240 DPI files; the HD set is display/download quality
    and is uploaded to R2, never committed. Spacers scale with the render so the
    HD sheet keeps the bundled sheet's proportions.
    """
    global SCALE, QUALITY, SPEED, OUT, PAGE_SEGMENT_GAP, COMPACT_GAP, PAD, FRAME_PAD
    SCALE = HD_SCALE
    QUALITY = 70
    SPEED = 8
    OUT = ROOT / "solfa-hd"
    PAGE_SEGMENT_GAP = 20
    COMPACT_GAP = 36
    PAD = 16
    FRAME_PAD = 72

# Songs whose tune is printed elsewhere ("Kaih No. X" / same tune note).
SHARED = {
    "4": "3",
    "9": "8",
    "26": "25",
    "36": "35",
    "38": "37",
    "90": "89",
    "101": "100",
    "130": "129",
    "196": "195",
    "198": "197",
    "208": "207",
    "214": "151",
    "246": "2",
    "253": "239",
    "262": "261",
    "265": "26",
    "271": "20",
    "283": "282",
    "302": "25",
    "302A": "42",
    "311": "2",
    "311A": "167",
    "328": "327",
    "345": "346",
    "348A": "118",
    "403A": "303",
    "445": "170",
    "35A": "35",
    "127A": "127",
}

# Title starts that have no "Doh is" line (lyrics-only reuse songs, doxology,
# chorus page). They are boundaries only, never assets.
EXTRA_STOPS = [
    (9, 33, 527.3),
    (90, 120, 291.0),
    (101, 132, 289.0),
    (262, 311, 530.3),
    (271, 320, 529.7),
    (283, 333, 256.0),
    (308, 358, 259.6),
    (311, 361, 185.1),
    (328, 380, 530.1),
    (345, 400, 364.5),
    ("C1", 619, 520.3),
]
# No solfa in this PDF: 308 is the lyrics-only doxology, and the A-variants are
# hymns that are not in the PDF at all (kept from the older BL edition).
NO_SOLFA = {"308", "119A", "147A", "388A", "425A"}

# App entries that contain more than one printed tune.
MULTI = {"1", "2", "3", "5", "21", "22", "35", "105", "127", "131", "239"}
# Explicit A-variant / special starts, keyed by app number.
SPECIAL = {
    "0": {"pages": [22], "start_y": None},  # Gloria Patri
    "C1": {"pages": [619], "start_y": 105},  # chorus page, no Doh line
}


def norm_num(value):
    return str(value) if value is not None else None


def load_rows():
    rows = json.loads(STARTS.read_text())
    for r in rows:
        r["num"] = norm_num(r.get("num"))
    for num, page, title_y in EXTRA_STOPS:
        rows.append(
            {
                "page": page,
                "key_y": title_y - 28,
                "title_y": title_y,
                "num": str(num),
                "title": f"{num} stop",
                "cand": [],
                "key": "",
                "extra": True,
            }
        )
    rows.sort(key=lambda r: (r["page"], -r["key_y"]))
    return rows


def row_at(rows, page, key_y):
    return next(r for r in rows if r["page"] == page and abs(r["key_y"] - key_y) < 0.6)


def build_plan(rows):
    by_num = {}
    for r in rows:
        if not r["num"] or r.get("extra"):
            continue
        if r["page"] >= 619 and r["num"] in {"2", "3", "5"}:
            continue  # chorus pages C2-C4, handled explicitly
        by_num.setdefault(r["num"], []).append(r)

    for r in rows:
        if "title_y" in r:
            continue
        title_y = max((p[0] for p in r.get("cand", [])), default=None)
        r["title_y"] = title_y if title_y is not None else r["key_y"] + 35

    plan = {}
    for n, rs in by_num.items():
        if n == "496":
            rs = [r for r in rs if r["page"] == 607]
        elif n == "500":
            rs = [r for r in rs if r["page"] == 617]
        elif n == "166":
            rs = [r for r in rs if r["page"] == 209]
        elif n == "302":
            rs = [r for r in rs if abs(r["key_y"] - 486.6) < 0.6]
        elif n == "399":
            rs = [r for r in rs if r["page"] == 459]
        elif n == "403":
            rs = [r for r in rs if r["page"] == 465]
        elif n == "426":
            rs = [r for r in rs if r["page"] == 499]
        elif n == "448":
            rs = [r for r in rs if r["page"] == 528]
        elif n == "348":
            rs = [r for r in rs if r["page"] == 403]
        plan[n] = rs

    plan["166A"] = [row_at(rows, 210, 504.2)]
    plan["302A"] = [row_at(rows, 352, 252.8)]
    plan["348A"] = [row_at(rows, 404, 366.4)]
    plan["399A"] = [row_at(rows, 460, 366.1)]
    plan["403A"] = [row_at(rows, 466, 315.5)]
    plan["426A"] = [row_at(rows, 500, 336.0)]
    plan["448A"] = [row_at(rows, 529, 493.7)]
    plan["496A"] = [row_at(rows, 609, 492.2)]
    plan["500A"] = [row_at(rows, 618, 494.5)]
    plan["0"] = [row_at(rows, 22, 496.5)]
    plan["C2"] = [row_at(rows, 620, 500.8)]
    plan["C3"] = [row_at(rows, 621, 501.7)]
    plan["C4"] = [row_at(rows, 622, 508.6)]
    return plan


def single_tune_page(rows, start):
    """True when this tune is the only thing printed on its page."""
    for r in rows:
        if r["page"] != start["page"]:
            continue
        if r["num"] == start["num"] and abs(r["key_y"] - start["key_y"]) < 0.6:
            continue
        return False
    return True


def segments_for(rows, order_to_next, pdf=None):
    """Return (page, start_pdf_y, end_pdf_y) segments for a tune start."""
    start = order_to_next["start"]
    nxt = order_to_next.get("next")
    segments = []
    if nxt is None:
        pages = list(range(start["page"], start["page"] + 1))
    else:
        # A tune only continues onto the next start's page when that next
        # tune begins mid-page; a top-of-page start means a fresh leaf.
        last = nxt["page"] if nxt["key_y"] < 450 else nxt["page"] - 1
        pages = list(range(start["page"], last + 1))
    for page in pages:
        if page == start["page"]:
            top = start["_start_pdf_y"]
        else:
            top = TOP_PDF
        bottom = BOTTOM_PDF
        if nxt is not None and page == nxt["page"] and nxt["key_y"] < 450:
            # Cut in the blank gap above the next title, not at a fixed offset:
            # a last stave or its lyric line often sits lower than the title + 42.
            bottom = header_top(pdf, nxt["page"], nxt["title_y"]) if pdf is not None else min(nxt["title_y"] + 42, TOP_PDF)
        if top - bottom > 8:
            segments.append((page, top, bottom))
    return segments


_TOP_CACHE = {}


def header_top(pdf, page_no, title_pdf_y):
    """Top crop edge just above a tune's printed title block.

    A sheet keeps the song's own details — number, title, subtitle, credits and
    the "Doh is ..." line — so the reader shows which tune the engraving is.
    Only the page's running header (page number, book name) stays out: the band
    is capped at TOP_PDF, and a mid-page tune starts at its own title.
    """
    key = ("hdr", page_no, round(title_pdf_y, 1))
    if key in _TOP_CACHE:
        return _TOP_CACHE[key]
    img = pdf[page_no - 1].render(scale=SCALE).to_pil().convert("L")
    left = round(X0 * SCALE)
    right = min(img.width, round(X1 * SCALE))
    band = img.crop((left, 0, right, img.height))
    raw = band.tobytes()
    bw = band.width

    def ink(row):
        return min(raw[row * bw:(row + 1) * bw]) < 245

    y = min(band.height - 1, max(0, int(round((595.28 - title_pdf_y) * SCALE))))
    # Enter the title line, then walk up to the top of its ink block.
    while y < band.height - 1 and not ink(y):
        y += 1
    while y > 0 and ink(y):
        y -= 1
    top = min(TOP_PDF, 595.28 - y / SCALE)
    _TOP_CACHE[key] = top
    return top


def snap_top(pdf, page_no, limit_pdf_y):
    """Crop top just above the first printed stave block below limit_pdf_y.

    Using the "Doh is" line position alone clips the top of the first system
    (its notation line sits only a few points below the key line).
    """
    key = (page_no, round(limit_pdf_y, 1))
    if key in _TOP_CACHE:
        return _TOP_CACHE[key]
    img = pdf[page_no - 1].render(scale=SCALE).to_pil().convert("L")
    left = round(X0 * SCALE)
    right = min(img.width, round(X1 * SCALE))
    band = img.crop((left, 0, right, img.height))
    raw = band.tobytes()
    bw = band.width
    y = max(0, int((595.28 - limit_pdf_y) * SCALE))

    def ink(row):
        return min(raw[row * bw:(row + 1) * bw]) < 245

    while y < band.height and ink(y):  # finish the key/title line itself
        y += 1
    while y < band.height and not ink(y):  # cross the gap below it
        y += 1
    top = None
    if y < band.height:
        top = 595.28 - y / SCALE
    out = top if top is not None else limit_pdf_y
    _TOP_CACHE[key] = out
    return out


REF_LINE = re.compile(r"^(S\.?\s*S|ALEX|GREAT\s+HYMN|CH\.G\.H|BMH|SS)\b", re.I)


def full_page_bottom(pdf, page_no, bottom_pdf):
    """Bottom edge for a crop that ships a whole printed page.

    The content band stops at BOTTOM_PDF, but a page whose engraving runs to the
    foot (five systems — song 8) prints its last lyric line below that line, so
    the fixed cut sliced it in half. When ink crosses the band edge, follow it
    down to the end of that ink block and keep a PAD of white under it, never
    reaching the cross-reference line printed at the page foot.
    """
    key = ("full", page_no, round(bottom_pdf, 1))
    if key in _TOP_CACHE:
        return _TOP_CACHE[key]
    img = pdf[page_no - 1].render(scale=SCALE).to_pil().convert("L")
    band = img.crop((round(X0 * SCALE), 0, min(img.width, round(X1 * SCALE)), img.height))
    raw = band.tobytes()
    bw = band.width

    def ink(row):
        return min(raw[row * bw:(row + 1) * bw]) < 245

    edge = min(band.height - 1, int(round((595.28 - bottom_pdf) * SCALE)))
    if not ink(edge):
        _TOP_CACHE[key] = bottom_pdf
        return bottom_pdf
    limit = band.height
    for line in page_lines(pdf[page_no - 1]):
        txt = line["text"].strip()
        # Foot captions are set in caps a line or two below the music; keep them
        # out of the crop so the sheet ends on the tune.
        if len(txt) < 6 or txt.upper() != txt or line["y"] + line["h"] / 2 > bottom_pdf:
            continue
        limit = min(limit, int(round((595.28 - (line["y"] + line["h"] / 2 + 3)) * SCALE)))
    y = max(0, min(limit - 1, band.height - 1))
    while y > edge and not ink(y):
        y -= 1
    out = min(bottom_pdf, 595.28 - (y + PAD) / SCALE)
    _TOP_CACHE[key] = out
    return out


def render_segment(pdf, page_no, top_pdf, bottom_pdf, full=False):
    if full:
        bottom_pdf = full_page_bottom(pdf, page_no, bottom_pdf)
    page = pdf[page_no - 1]
    img = page.render(scale=SCALE).to_pil().convert("L")
    w, h = img.size
    left = round(X0 * SCALE)
    right = min(w, round(X1 * SCALE))
    top = max(0, round((595.28 - top_pdf) * SCALE))
    bottom = min(h, round((595.28 - bottom_pdf) * SCALE))
    crop = img.crop((left, top, right, bottom))
    # The book prints cross-reference lines ("S.S. 526: ...") between a tune
    # and the next title, and sometimes at the page foot. Blank them out.
    draw = ImageDraw.Draw(crop)
    for line in page_lines(page):
        txt = line["text"].strip()
        if not REF_LINE.search(txt) and not ("HYMN" in txt.upper() and txt.upper() == txt):
            continue
        y0 = (595.28 - (line["y"] + line["h"] / 2 + 5)) * SCALE - top
        y1 = (595.28 - (line["y"] - line["h"] / 2 - 5)) * SCALE - top
        x0 = line["x0"] * SCALE - left
        x1 = line["x1"] * SCALE - left
        draw.rectangle((x0, y0, x1, y1), fill=255)
    if full:
        # A page that prints one song is shipped whole: the printed page already
        # has its own margins, and trimming to the ink is what cut the last line.
        return crop
    bbox = ImageOps.invert(crop).point(lambda v: 255 if v > 10 else 0).getbbox()
    if not bbox:
        return None
    pad = PAD
    bbox = (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(crop.width, bbox[2] + pad),
        min(crop.height, bbox[3] + pad),
    )
    return crop.crop(bbox)


def build_asset(app_id, row_list, rows, pdf):
    whole = False
    if len(row_list) == 1:
        start = row_list[0]
        # find next tune start in reading order
        order = rows.index(start)
        nxt = rows[order + 1] if order + 1 < len(rows) else None
        if app_id == "C1":
            start = dict(start)
            start["_start_pdf_y"] = header_top(pdf, 619, start["title_y"])
            nxt = row_at(rows, 620, 500.8)
        else:
            start = dict(start)
            start["_start_pdf_y"] = header_top(pdf, start["page"], start["title_y"])
            if app_id == "0":
                nxt = rows[order + 1]
        segs = segments_for(rows, {"start": start, "next": nxt}, pdf)
        if len(segs) == 1 and single_tune_page(rows, start):
            whole = True
            segs = [(segs[0][0], TOP_PDF, BOTTOM_PDF)]
        parts = []
        for page, top, bottom in segs:
            part = render_segment(pdf, page, top, bottom, full=whole)
            if part:
                parts.append(part)
        label = app_id
    else:
        parts = []
        for r in row_list:
            order = rows.index(r)
            nxt = rows[order + 1]
            start = dict(r)
            start["_start_pdf_y"] = header_top(pdf, r["page"], r["title_y"])
            for page, top, bottom in segments_for(rows, {"start": start, "next": nxt}, pdf):
                part = render_segment(pdf, page, top, bottom)
                if part:
                    parts.append(part)
            parts.append(None)  # separator marker between tunes
        label = app_id

    if not parts:
        return None
    # drop separators at the ends
    while parts and parts[0] is None:
        parts.pop(0)
    while parts and parts[-1] is None:
        parts.pop()

    max_w = max(p.width for p in parts if p is not None)
    out_parts = []
    for p in parts:
        if p is None:
            out_parts.append(Image.new("L", (max_w, PAGE_SEGMENT_GAP), 255))
            continue
        canvas = Image.new("L", (max_w, p.height), 255)
        canvas.paste(p, ((max_w - p.width) // 2, 0))
        out_parts.append(canvas)
    total_h = sum(p.height for p in out_parts)
    sheet = Image.new("L", (max_w, total_h), 255)
    y = 0
    for p in out_parts:
        sheet.paste(p, (0, y))
        y += p.height
    if whole:
        return frame_sheet(sheet)
    return frame_sheet(compact_vertical(sheet))


def frame_sheet(sheet):
    """Place the engraving on a uniform A4-proportioned page.

    Sheets are cut to their ink, so every one used to be a different size with
    the title pressed against the top edge. A fixed page width and a white band
    above and below give the whole book one canvas; a tune that runs past one
    page keeps its natural height instead of being shrunk to fit, because
    squeezing a three-page tune onto one page would halve the notes.
    """
    page_w = max(round(X1 * SCALE) - round(X0 * SCALE), sheet.width)
    page_h = max(round(page_w * PAGE_RATIO), sheet.height + FRAME_PAD * 2)
    page = Image.new("L", (page_w, page_h), 255)
    # Centre the engraving: a short tune sits in the middle of the page with the
    # same white margin above and below, and a near-full page is still held off
    # the edges by FRAME_PAD.
    top = max(FRAME_PAD, (page_h - sheet.height) // 2)
    page.paste(sheet, ((page_w - sheet.width) // 2, top))
    return page


def compact_vertical(sheet, gap=COMPACT_GAP):
    """Collapse blank runs (page breaks, removed reference lines) to a small gap."""
    w, h = sheet.size
    raw = sheet.tobytes()
    rows = [min(raw[y * w:(y + 1) * w]) < 245 for y in range(h)]
    runs = []
    y = 0
    while y < h:
        if rows[y]:
            start = y
            while y < h and rows[y]:
                y += 1
            runs.append((start, y))
        else:
            y += 1
    if not runs:
        return sheet
    new_h = sum(b - a for a, b in runs) + gap * (len(runs) - 1)
    out = Image.new("L", (w, new_h), 255)
    y = 0
    for i, (a, b) in enumerate(runs):
        part = sheet.crop((0, a, w, b))
        out.paste(part, (0, y))
        y += part.height
        if i < len(runs) - 1:
            y += gap
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--hd", action="store_true", help="build the 480 DPI R2 copies into solfa-hd/")
    args = ap.parse_args()
    if args.hd:
        set_hd()

    rows = load_rows()
    plan = build_plan(rows)
    songs = json.loads((ROOT / "songs.json").read_text())["BL"]["songs"]
    song_ids = [s["id"] for s in songs]
    only = {x.strip() for x in args.only.split(",") if x.strip()}

    # app number -> source app number for shared assets
    targets = {}
    for s in songs:
        num = s["number"]
        if num in NO_SOLFA:
            continue
        if num in SHARED:
            targets[num] = SHARED[num]
        elif num in plan:
            targets[num] = num
        elif num in SPECIAL:
            targets[num] = num
        else:
            print(f"UNMAPPED {num} {s['title']}")

    if args.dry_run:
        print(f"{len(targets)} songs have a solfa source")
        for num, src in sorted(targets.items(), key=lambda kv: song_ids.index(f"BL_{kv[0]}")):
            if src != num:
                print(f"  {num:>4} -> {src}")
            elif num in SPECIAL:
                print(f"  {num:>4} special")
            else:
                rs = plan[num]
                print(f"  {num:>4} p{','.join(str(r['page']) for r in rs)}")
        return

    pdf = pdfium.PdfDocument(str(PDF))
    OUT.mkdir(parents=True, exist_ok=True)
    built = {}
    for num, src in sorted(targets.items(), key=lambda kv: song_ids.index(f"BL_{kv[0]}")):
        if only and f"BL_{num}" not in only:
            continue
        dest = OUT / f"BL_{src}.avif"
        if dest.exists() and not args.force:
            built[num] = dest
            continue
        if src == "C1":
            row = row_at(rows, 619, 492.3)
            part = render_segment(pdf, 619, header_top(pdf, 619, row["title_y"]), BOTTOM_PDF)
            sheet = frame_sheet(part) if part else None
        else:
            row_list = plan[src]
            sheet = build_asset(src, row_list, rows, pdf)
        if sheet is None:
            print(f"EMPTY {num} ({src})")
            continue
        sheet.save(dest, "AVIF", quality=QUALITY, speed=SPEED)
        built[num] = dest
        print(f"{dest.name:16} {sheet.width}x{sheet.height} {dest.stat().st_size/1024:5.1f} KB")
    print(f"built {len(built)} assets")


if __name__ == "__main__":
    main()
