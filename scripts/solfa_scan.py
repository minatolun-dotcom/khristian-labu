#!/usr/bin/env python3
"""Scan the Biakna Late PDF for tune starts (the 'Doh is ...' key line).

This is a build-time helper for the tonic-solfa artwork pipeline. It writes a
JSON index of each tune start with its page, key-line position, nearby title
text, and best-guess printed number.
"""
import json
import re
import sys
from pathlib import Path

import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "Tonic Solfa" / "Biakna Late.pdf"
OUT = ROOT / "scripts" / "solfa_starts.json"


def page_lines(page):
    """Group page characters into visual lines by their baseline."""
    tp = page.get_textpage()
    text = tp.get_text_range()
    chars = []
    for i, ch in enumerate(text):
        if ch in "\r\n":
            continue
        b = tp.get_charbox(i)
        chars.append((b[1], b[0], ch, b))
    chars.sort()
    groups = []
    for bot, left, ch, b in chars:
        placed = False
        for g in groups[-4:]:
            if abs(g["bot"] - bot) <= 1.2:
                g["chars"].append((left, ch, b))
                g["bot"] = (g["bot"] + bot) / 2
                placed = True
                break
        if not placed:
            groups.append({"bot": bot, "chars": [(left, ch, b)]})
    out = []
    for g in groups:
        cs = sorted(g["chars"])
        out.append(
            {
                "y": g["bot"],
                "x0": min(b[0] for _, _, b in cs),
                "x1": max(b[2] for _, _, b in cs),
                "h": max(b[3] - b[1] for _, _, b in cs),
                "text": "".join(c for _, c, _ in cs),
            }
        )
    out.sort(key=lambda line: -line["y"])
    return out


def extract_num(cand):
    cand = sorted(cand, key=lambda x: -x["y"])
    # The PDF sometimes spaces out a multi-digit hymn number ("3 0" = 30,
    # "27 8" = 278) because each glyph is its own text run.
    combined = " ".join(line["text"].strip() for line in cand)
    m = re.match(r"^(\d{1,2})(?:\s+)(\d)(?:\s*)(\d)?(?=\D|$)", combined)
    if m:
        return "".join(g for g in m.groups() if g)
    for line in cand:
        t = line["text"].strip()
        m = re.fullmatch(r"(\d{1,3})[.,]?", t)
        if m:
            return m.group(1)
        m = re.match(r"^(\d{1,3})(?=[A-Za-z])", t)
        if m:
            return m.group(1)
        m = re.search(r"(\d{1,3})[.,]?$", t)
        if m:
            return m.group(1)
    txt = " ".join(line["text"].strip() for line in cand)
    m = re.match(r"^(\d)\s+(\d)\b", txt)
    if m:
        return m.group(1) + m.group(2)
    nums = re.findall(r"\b\d{1,3}\b", txt)
    return nums[0] if nums else None


def scan():
    pdf = pdfium.PdfDocument(str(PDF))
    rows = []
    for idx in range(21, len(pdf)):
        lines = page_lines(pdf[idx])
        for line in lines:
            if not re.search(r"\bDoh\s*is|\bLah\s*is|\bKey\b", line["text"], re.I):
                continue
            cand = [
                x
                for x in lines
                if line["y"] + 7 < x["y"] < line["y"] + 56
                and x["h"] >= 11.0
                and "|" not in x["text"]
            ]
            rows.append(
                {
                    "page": idx + 1,
                    "key_y": round(line["y"], 1),
                    "key": line["text"],
                    "num": extract_num(cand),
                    "title": " ".join(
                        x["text"].strip()
                        for x in sorted(cand, key=lambda x: -x["y"])
                    ),
                    "cand": [
                        [round(x["y"], 1), round(x["x0"], 1), round(x["h"], 1), x["text"]]
                        for x in sorted(cand, key=lambda x: -x["y"])
                    ],
                }
            )
    for i, row in enumerate(rows):
        row["order"] = i
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    print(f"wrote {len(rows)} tune starts to {OUT}")
    return rows


if __name__ == "__main__":
    rows = scan()
    if "--dump" in sys.argv:
        for r in rows:
            print(
                f"{r['order']:3} p{r['page']:3} y{r['key_y']:6.1f} "
                f"n={str(r['num']):>4} {r['title'][:70]!r}"
            )
