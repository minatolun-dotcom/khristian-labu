#!/usr/bin/env python3
"""Split the multi-tune BL sheets into one AVIF per tune.

A handful of BL hymns print two different tunes under one song number. The
regular builder stacks both tunes into BL_<num>.avif; the app now shows them as
Tune 1 / Tune 2 tabs, so this script rebuilds each tune as its own sheet:

    BL_<num>-t1.avif   first printed tune
    BL_<num>-t2.avif   second printed tune (and so on)

Run with the solfa venv after changing the PDF/plan:

    .venv-solfa/bin/python scripts/split_solfa_tunes.py --only BL_1
    .venv-solfa/bin/python scripts/split_solfa_tunes.py
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_solfa as B  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated song ids, e.g. BL_1,BL_21")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--hd", action="store_true", help="write the 480 DPI copies into solfa-hd/")
    args = ap.parse_args()
    if args.hd:
        B.set_hd()
    only = {x.strip() for x in args.only.split(",") if x.strip()}

    rows = B.load_rows()
    plan = B.build_plan(rows)
    songs = json.loads((B.ROOT / "songs.json").read_text())["BL"]["songs"]
    by_num = {str(s["number"]): s for s in songs}

    pdf = B.pdfium.PdfDocument(str(B.PDF))
    B.OUT.mkdir(parents=True, exist_ok=True)
    written = 0
    for num in sorted(B.MULTI, key=lambda n: int(n)):
        song = by_num.get(num)
        if not song:
            continue
        if only and song["id"] not in only:
            continue
        row_list = plan.get(num) or []
        if len(row_list) < 2:
            print(f"SKIP {song['id']} ({len(row_list)} tune start)")
            continue
        for i, row in enumerate(row_list, 1):
            dest = B.OUT / f"BL_{num}-t{i}.avif"
            if dest.exists() and not args.force and B.read_ok(dest):
                print(f"keep {dest.name}")
                continue
            sheet = B.build_asset(f"{num}t{i}", [row], rows, pdf)
            if sheet is None:
                print(f"EMPTY {dest.name}")
                continue
            B.save_avif(sheet, dest)
            written += 1
            print(f"{dest.name:18} {sheet.width}x{sheet.height} {dest.stat().st_size / 1024:5.1f} KB")
        print(f"{song['id']} -> {len(row_list)} tunes ({song['title']})")
    print(f"wrote {written} sheets")


if __name__ == "__main__":
    main()
