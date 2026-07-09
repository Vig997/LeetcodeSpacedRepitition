"""Regenerate build/icon.ico with transparent rounded corners.

Usage: python scripts/generate-icon.py [source]
Default source: build/icon.png (or build/icon.ico if png missing)
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
OUT_ICO = BUILD / 'icon.ico'
OUT_PNG = BUILD / 'icon.png'
# Matches the squircle in the original asset (dark edge starts ~40px in on 256px).
CORNER_RADIUS_AT_256 = 40
ICO_SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def apply_transparent_corners(img: Image.Image, radius_at_256: int = CORNER_RADIUS_AT_256) -> Image.Image:
    size = img.size[0]
    radius = max(1, int(radius_at_256 * size / 256))
    mask = rounded_mask(size, radius)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(img.convert('RGBA'), (0, 0), mask)
    return out


def save_ico(img: Image.Image, path: Path) -> None:
    icons = [img.resize(s, Image.Resampling.LANCZOS) for s in ICO_SIZES]
    icons[0].save(path, format='ICO', sizes=[(s.width, s.height) for s in icons])


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else (OUT_PNG if OUT_PNG.exists() else OUT_ICO)
    if not src.exists():
        raise SystemExit(f'Source not found: {src}')

    fixed = apply_transparent_corners(Image.open(src))
    BUILD.mkdir(parents=True, exist_ok=True)
    fixed.save(OUT_PNG)
    save_ico(fixed, OUT_ICO)
    print(f'Wrote {OUT_PNG} and {OUT_ICO}')


if __name__ == '__main__':
    main()
