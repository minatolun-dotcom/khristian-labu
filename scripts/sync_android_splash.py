#!/usr/bin/env python3
"""Install the tracked, padded Android splash icons into the native project.

android/ is generated and gitignored, so the launch-screen artwork lives in
resources/android-splash/. This runs after `npx cap sync` so a clean native
project gets the same inset icons instead of tightly-cropped ones.
"""

from __future__ import annotations

import shutil
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "resources" / "android-splash"
DESTINATION = ROOT / "android" / "app" / "src" / "main" / "res"
DENSITIES = {
    "drawable": 288,
    "drawable-hdpi": 432,
    "drawable-xhdpi": 576,
    "drawable-xxhdpi": 864,
    "drawable-xxxhdpi": 1152,
}


def png_info(path: Path) -> tuple[int, int, int, int]:
    with path.open("rb") as handle:
        header = handle.read(26)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"{path} is not a valid PNG")
    width, height, bit_depth, color_type = struct.unpack(">IIBB", header[16:26])
    return width, height, bit_depth, color_type


def main() -> int:
    if not DESTINATION.is_dir():
        print("android/ is not generated; skipping splash icon sync")
        return 0

    for folder, expected in DENSITIES.items():
        source = SOURCE / folder / "splash_icon.png"
        if not source.is_file():
            print(f"Missing tracked splash source: {source}", file=sys.stderr)
            return 1

        width, height, bit_depth, color_type = png_info(source)
        if (width, height) != (expected, expected):
            print(
                f"{source} is {width}x{height}, expected {expected}x{expected}",
                file=sys.stderr,
            )
            return 1
        if bit_depth != 8 or color_type != 6:
            print(f"{source} must be an 8-bit RGBA PNG", file=sys.stderr)
            return 1

        destination = DESTINATION / folder
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination / "splash_icon.png")
        print(f"synced {folder}/splash_icon.png ({width}px)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
