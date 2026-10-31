"""Author-time generator for the blanket "lie" spots in shared/src/seat-catalog.json.

LPC beds are modular: a pillow strip plus a blanket. The catalog already marks the pillow cells
(lie, feet pointing away from the pillows). This marks each blanket's head-end cells too, as
`fallback` spots: a blanket on its own still offers "Lie down", and the app drops a blanket spot
when a pillow spot sits right at its head (so pillow + blanket still puts the head on the pillow).

The head end is the side with the blanket's white hem (it is the edge drawn against the pillows);
the feet point away from it.

Usage:
    python tools/gen_bed_seats.py            # rewrite the generated rules in the catalog
    python tools/gen_bed_seats.py --preview DIR   # also write DIR/<sheet>_blankets.png

Author-time only (needs Pillow + NumPy + SciPy); the app just reads the catalog.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
DECOR = ROOT / "client" / "src" / "assets" / "decor"
CATALOG = ROOT / "shared" / "src" / "seat-catalog.json"
SHEETS = ("beds_grid", "beds_single_grid")
CELL = 32
SOLID_ALPHA = 200
MIN_HEM_LEN = 24  # a hem runs (nearly) the blanket's width or height
MAX_HEM_THICK = 6
BAND = 16  # px on each side of the hem compared to find the blanket
AWAY = {"top": "down", "bottom": "up", "left": "right", "right": "left"}


def hem_mask(rgba):
    r, g, b = (rgba[..., i].astype(int) for i in range(3))
    hi = np.maximum(np.maximum(r, g), b)
    lo = np.minimum(np.minimum(r, g), b)
    return (rgba[..., 3] >= SOLID_ALPHA) & (lo >= 170) & (hi - lo <= 40)


def blankets(sheet, existing):
    """Find each blanket by its hem: a long straight white bar outside the pillow cells. The
    blanket is the side of the hem with the coloured fill; its head row is the cells just inside
    the hem, and the feet point away from it."""
    rgba = np.array(Image.open(DECOR / f"{sheet}.png").convert("RGBA"))
    H, W = rgba.shape[:2]
    solid = rgba[..., 3] >= SOLID_ALPHA
    hem = hem_mask(rgba)
    for x, y in existing:  # pillow pieces have light frames too
        hem[y * CELL : (y + 1) * CELL, x * CELL : (x + 1) * CELL] = False
    fill = solid & ~hem
    lab, _ = ndimage.label(hem)
    out = []
    for sl in ndimage.find_objects(lab):
        if sl is None:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        horizontal = (x1 - x0) >= (y1 - y0)
        length, thick = (x1 - x0, y1 - y0) if horizontal else (y1 - y0, x1 - x0)
        if length < MIN_HEM_LEN or thick > MAX_HEM_THICK:
            continue
        if horizontal:
            above = fill[max(0, y0 - BAND) : y0, x0:x1].sum()
            below = fill[y1 : min(H, y1 + BAND), x0:x1].sum()
            side = "top" if below >= above else "bottom"  # hem on the blanket's top edge
            row = (y1 if side == "top" else y0 - 1) // CELL
            head = [(x, row) for x in range(x0 // CELL, (x1 - 1) // CELL + 1)]
        else:
            left = fill[y0:y1, max(0, x0 - BAND) : x0].sum()
            right = fill[y0:y1, x1 : min(W, x1 + BAND)].sum()
            side = "left" if right >= left else "right"
            col = (x1 if side == "left" else x0 - 1) // CELL
            head = [(col, y) for y in range(y0 // CELL, (y1 - 1) // CELL + 1)]
        head = [c for c in head if c not in existing and 0 <= c[0] < W // CELL and 0 <= c[1] < H // CELL]
        if head:
            out.append({"cells": head, "dir": AWAY[side], "box": (x0, y0, x1, y1)})
    return out


def lie_cells(rules, sheet):
    cells = set()
    for r in rules:
        if r.get("sheet") != sheet or r.get("kind") != "lie" or r.get("fallback"):
            continue
        sx, sy = r.get("step", [1, 1])
        for j in range(0, r.get("h", 1), sy):
            for i in range(0, r.get("w", 1), sx):
                cells.add((r["x"] + i, r["y"] + j))
    return cells


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview")
    args = ap.parse_args()
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    rules = [r for r in data["rules"] if not r.get("fallback")]
    generated = []
    for sheet in SHEETS:
        found = blankets(sheet, lie_cells(rules, sheet))
        for b in found:
            for x, y in b["cells"]:
                generated.append({"sheet": sheet, "x": x, "y": y, "kind": "lie", "dir": b["dir"], "fallback": True})
        print(f"{sheet}: {len(found)} blankets, {sum(len(b['cells']) for b in found)} spots")
        if args.preview:
            im = Image.open(DECOR / f"{sheet}.png").convert("RGBA")
            bg = Image.new("RGBA", im.size, (40, 40, 40, 255))
            bg.alpha_composite(im)
            d = ImageDraw.Draw(bg)
            for b in found:
                d.rectangle([b["box"][0], b["box"][1], b["box"][2] - 1, b["box"][3] - 1], outline=(0, 255, 120))
                for x, y in b["cells"]:
                    cx, cy = x * CELL + 16, y * CELL + 16
                    dx, dy = {"up": (0, -8), "down": (0, 8), "left": (-8, 0), "right": (8, 0)}[b["dir"]]
                    d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], outline=(255, 200, 60), width=2)
                    d.line([cx, cy, cx + dx, cy + dy], fill=(255, 255, 255), width=2)
            bg.save(Path(args.preview) / f"{sheet}_blankets.png")
    data["rules"] = rules + generated
    write(data)


def write(data):
    """Same layout as the hand-edited file: one rule per line, a blank line between sheets."""
    lines, prev = [], None
    for r in data["rules"]:
        if prev is not None and r["sheet"] != prev:
            lines.append("")
        prev = r["sheet"]
        lines.append("    " + json.dumps(r, ensure_ascii=False).replace('{"', '{ "').replace('}', ' }').replace('": ', '": '))
    body = []
    for i, line in enumerate(lines):
        nxt = next((l for l in lines[i + 1 :] if l), None)
        body.append(line + ("," if line and nxt is not None else ""))
    CATALOG.write_text('{\n  "rules": [\n' + "\n".join(body) + "\n  ]\n}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
