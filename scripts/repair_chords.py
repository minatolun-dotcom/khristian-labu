#!/usr/bin/env python3
"""Repair the BL chord charts against the printed key and hymn convention.

Four defects are provable from the corpus itself, without reading the sheets:

  1. key drift    - the chart's key disagrees with the printed "Doh is X" line.
                    Either the label is a typo (chords already sit in the
                    printed key) or the chart was transposed. The final chord
                    tells us which: a hymn ends on its tonic. A chart whose
                    chords cannot be reconciled is left untouched and flagged.
  2. cadence      - the last chord is not the tonic. Every hymn resolves.
  3. duplicate    - a line repeats a chord at consecutive positions, which
                    reads as a chord change that is not there.
  4. verse drift  - a strophic hymn (all verses type 'v') carries a different
                    chord pattern in later verses. The tune is shared, so the
                    pattern is too; only choruses may legitimately differ.

Every change is deterministic, and chords.json is tracked by git.

Usage:
    .venv-solfa/bin/python scripts/repair_chords.py --check
    .venv-solfa/bin/python scripts/repair_chords.py
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHORDS = ROOT / "chords.json"
SONGS = ROOT / "songs.json"

PC = {
    "C": 0, "B#": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4,
    "Fb": 4, "E#": 5, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8,
    "A": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11,
}
SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
MAJOR = [0, 2, 4, 5, 7, 9, 11]
FLAT_KEYS = {"F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"}

ROOT_RE = re.compile(r"^([A-G](?:#|b)?)(.*)$")


def norm_key(raw):
    """'Doh is G.' / 'key Ab' / 'Doh is Fb (Damdam in)' -> 'G' / 'Ab' / 'Fb'."""
    s = re.sub(r"^(?:key\s*|doh\s+is\s*)", "", (raw or "").strip(), flags=re.I)
    m = re.match(r"^([A-G](?:#|b)?)", s)
    return m.group(1) if m else None


def diatonic(tonic_name):
    t = PC[tonic_name]
    return {(t + o) % 12 for o in MAJOR}


def spell(pc, prefer_flat):
    return (FLAT if prefer_flat else SHARP)[pc % 12]


def chord_pc(ch):
    m = ROOT_RE.match(ch or "")
    return PC.get(m.group(1)) if m else None


def transposed_name(ch, from_tonic, to_tonic):
    """Move a chord by the interval between two keys, preserving function."""
    m = ROOT_RE.match(ch or "")
    if not m or m.group(1) not in PC:
        return None
    offset = (PC[to_tonic] - PC[from_tonic]) % 12
    new_pc = (PC[m.group(1)] + offset) % 12
    flat = to_tonic in FLAT_KEYS or to_tonic.endswith("b")
    return spell(new_pc, flat) + m.group(2)


def events(chart):
    for verse in chart.get("verseLines") or []:
        for line in verse or []:
            for ev in line or []:
                yield ev


def last_event(chart):
    for verse in reversed(chart.get("verseLines") or []):
        for line in reversed(verse or []):
            for ev in reversed(line or []):
                return ev
    return None


def dedupe_line(line):
    out = []
    for ev in line or []:
        if out and (out[-1].get("ch") == ev.get("ch") or out[-1].get("at") == ev.get("at")):
            continue
        out.append(ev)
    return out


def all_diatonic(chart, key):
    dia = diatonic(key)
    for ev in events(chart):
        pc = chord_pc(ev.get("ch"))
        if pc is not None and pc not in dia:
            return False
    return True


def repair(chart, song, stats):
    """Mutate chart in place. Returns False when the chart must be left alone."""
    printed = norm_key(song.get("key"))
    chart_key = norm_key(chart.get("key"))
    if not printed or not (chart.get("verseLines") or []):
        stats["skipped"] += 1
        return False

    if chart_key and chart_key != printed:
        end_pc = chord_pc((last_event(chart) or {}).get("ch"))
        if end_pc == PC[printed]:
            stats["key_relabelled"] += 1          # chords already in the printed key
        elif end_pc is not None and end_pc == PC[chart_key]:
            moved = 0
            trial = json.loads(json.dumps(chart))
            ok = True
            for ev in events(trial):
                n = transposed_name(ev.get("ch"), chart_key, printed)
                if not n:
                    ok = False
                    break
                ev["ch"] = n
                moved += 1
            if ok and all_diatonic(trial, printed):
                chart["verseLines"] = trial["verseLines"]
                chart["lines"] = trial.get("lines")
                stats["key_transposed"] += 1
                stats["chords_transposed"] += moved
            else:
                stats["key_flagged"] += 1
                return False
        else:
            stats["key_flagged"] += 1
            return False

    chart["key"] = printed

    # Duplicate consecutive events read as a chord change that is not there.
    for verse in chart.get("verseLines") or []:
        for li, line in enumerate(verse or []):
            before = len(line or [])
            verse[li] = dedupe_line(line)
            stats["duplicates_removed"] += before - len(verse[li])

    # Strophic verses share the tune, so they share the pattern. A chorus may
    # legitimately differ, so only songs whose verses are all plain verses move.
    vl = chart["verseLines"]
    types = [(v.get("type") or "v") for v in (song.get("verses") or [])]
    if types and all(t == "v" for t in types) and len(vl) > 1 and all(len(v) == len(vl[0]) for v in vl[1:]):
        changed = 0
        for i in range(1, len(vl)):
            if vl[i] != vl[0]:
                vl[i] = json.loads(json.dumps(vl[0]))
                changed += 1
        if changed:
            stats["verses_unified"] += 1

    # Cadence: every verse closes the tune on the tonic. Fixing each verse (not
    # just the last) keeps the pass idempotent, because unification copies
    # verse 1's ending forward and would otherwise undo a single fix.
    for verse in vl:
        end = None
        for line in reversed(verse or []):
            if line:
                end = line[-1]
                break
        if end is None:
            continue
        if chord_pc(end.get("ch")) != PC[printed]:
            end["ch"] = spell(PC[printed], printed in FLAT_KEYS or printed.endswith("b"))
            stats["cadence_fixed"] += 1

    # The cadence can land on a chord the line already held; collapse that pair.
    for verse in vl:
        for li, line in enumerate(verse or []):
            before = len(line or [])
            verse[li] = dedupe_line(line)
            stats["duplicates_removed"] += before - len(verse[li])

    # Keep the flat chord summary in step with the per-line data.
    seen = []
    for ev in events(chart):
        if ev.get("ch") and ev["ch"] not in seen:
            seen.append(ev["ch"])
    chart["chords"] = seen
    chart["verses"] = len(vl)
    return True


def metrics(charts):
    out = Counter()
    outside = total = 0
    for chart in charts.values():
        key = norm_key(chart.get("key"))
        if not key:
            continue
        dia = diatonic(key)
        if chord_pc((last_event(chart) or {}).get("ch")) == PC[key]:
            out["end_on_tonic"] += 1
        out["charts"] += 1
        for ev in events(chart):
            pc = chord_pc(ev.get("ch"))
            if pc is None:
                continue
            total += 1
            if pc not in dia:
                outside += 1
    out["events"] = total
    out["outside_pct"] = round(100 * outside / max(total, 1), 1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report without writing")
    args = ap.parse_args()

    charts = json.loads(CHORDS.read_text())
    songs = json.loads(SONGS.read_text())
    by_id = {}
    for book in songs.values():
        items = book.get("songs", []) if isinstance(book, dict) else book
        for s in items or []:
            if isinstance(s, dict) and "id" in s:
                by_id[s["id"]] = s

    before = metrics(charts)
    stats = Counter()
    for sid, chart in charts.items():
        song = by_id.get(sid)
        if not song:
            stats["skipped"] += 1
            continue
        original = json.loads(json.dumps(chart))
        if not repair(chart, song, stats):
            charts[sid] = original
    after = metrics(charts)

    print("charts: %d | repairable: %d" % (after["charts"], after["charts"] - stats["skipped"] - stats["key_flagged"]))
    print("end on tonic: %d%% -> %d%%" % (
        round(100 * before["end_on_tonic"] / before["charts"]),
        round(100 * after["end_on_tonic"] / after["charts"]),
    ))
    print("outside key: %s%% -> %s%%" % (before["outside_pct"], after["outside_pct"]))
    print("chord events: %d -> %d" % (before["events"], after["events"]))
    for k in ("key_relabelled", "key_transposed", "key_flagged", "cadence_fixed",
              "duplicates_removed", "verses_unified",
              "chords_transposed", "skipped"):
        print("  %-20s %d" % (k, stats[k]))

    if args.check:
        return
    CHORDS.write_text(json.dumps(charts, ensure_ascii=False, separators=(",", ":")))
    print("wrote", CHORDS)


if __name__ == "__main__":
    main()
