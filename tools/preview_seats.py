"""Author-time preview of the seat catalog (`shared/src/seat-catalog.json`) over its decor sheets.

For each sheet it writes `<sheet>_seats.png`: the sheet scaled up, a grid of 32px cells labelled
`sx,sy`, and on every catalog cell an arrow toward the seat's `dir` (orange = sit, purple = lie;
for a bed, the arrow points where the feet go). Rules expand exactly as in the app (rect +
stride, later rules override, `none` removes). Look at the output before committing catalog
edits: every arrow must sit on a seat cell and point the way the art faces.

Usage:
    python tools/preview_seats.py --out DIR                  # every sheet named in the catalog
    python tools/preview_seats.py chairs sofas --out DIR     # just these sheets
    python tools/preview_seats.py thrones --out DIR --scale 3

Author-time only (needs Pillow).
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
from build_maps import ROOT, load_seat_catalog  # noqa: E402

DECOR = ROOT / "client" / "src" / "assets" / "decor"
CELL = 32
COLORS = {"sit": (255, 150, 30, 255), "lie": (170, 90, 255, 255)}
VECTORS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}


def arrow(draw, cx, cy, size, d, color):
    vx, vy = VECTORS[d]
    tail = (cx - vx * size * 0.22, cy - vy * size * 0.22)
    tip = (cx + vx * size * 0.22, cy + vy * size * 0.22)
    head = size * 0.12
    px, py = -vy, vx  # perpendicular
    wing1 = (tip[0] - vx * head + px * head, tip[1] - vy * head + py * head)
    wing2 = (tip[0] - vx * head - px * head, tip[1] - vy * head - py * head)
    width = max(2, size // 22)
    for w, c in ((width + 2, (0, 0, 0, 255)), (width, color)):
        draw.line([tail, tip], fill=c, width=w)
        draw.line([wing1, tip, wing2], fill=c, width=w, joint="curve")


def preview(sheet, spots, out, scale):
    src = Image.open(DECOR / f"{sheet}.png").convert("RGBA")
    img = Image.new("RGBA", src.size, (60, 60, 70, 255))
    img.alpha_composite(src)
    img = img.resize((src.width * scale, src.height * scale), Image.NEAREST)
    draw = ImageDraw.Draw(img)
    size = CELL * scale
    cols, rows = src.width // CELL, src.height // CELL
    for x in range(cols + 1):
        draw.line([(x * size, 0), (x * size, rows * size)], fill=(255, 40, 40, 160))
    for y in range(rows + 1):
        draw.line([(0, y * size), (cols * size, y * size)], fill=(255, 40, 40, 160))
    for y in range(rows):
        for x in range(cols):
            label = f"{x},{y}"
            draw.text((x * size + 3, y * size + 2), label, fill=(0, 0, 0, 255))
            draw.text((x * size + 2, y * size + 1), label, fill=(255, 255, 255, 255))
    for (name, sx, sy), (kind, d) in spots.items():
        if name == sheet:
            arrow(draw, sx * size + size / 2, sy * size + size / 2, size, d, COLORS[kind])
    path = out / f"{sheet}_seats.png"
    img.save(path)
    print(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("sheets", nargs="*", help="sheet names (default: every sheet in the catalog)")
    parser.add_argument("--out", type=Path, required=True, help="directory for <sheet>_seats.png")
    parser.add_argument("--scale", type=int, default=2, help="pixel scale (default 2)")
    args = parser.parse_args()
    spots = load_seat_catalog()
    sheets = args.sheets or sorted({name for name, _, _ in spots})
    args.out.mkdir(parents=True, exist_ok=True)
    for sheet in sheets:
        preview(sheet, spots, args.out, args.scale)


if __name__ == "__main__":
    main()
