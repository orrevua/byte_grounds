"""Author-time repacker for decor sheets whose objects do not sit on the 32px cell grid.

Some LPC item sheets place objects at arbitrary pixel offsets, so an object straddles cell
boundaries (picking one editor cell yields half a chair) or shares a cell with its neighbour.
This finds each object, gives it a block of whole cells, copies it 1:1 (never scaled) and
shelf-packs the blocks in source reading order into `<name>_grid.png` next to the original.
Originals stay untouched: saved maps reference their cells.

Objects: 8-connected regions of solid pixels (alpha >= SOLID_ALPHA). Translucent drop-shadow
pixels join the object they touch rather than bridging two neighbours, and never decide the
block size: a shadow spilling past the block is clipped. Small detached bits (sparks, steam)
join the nearest big object a few px away; leftover specks under MIN_PIXELS are dropped.

An object is misplaced when its solid pixels cover more cells than its size needs, or share a
cell with another object's solid pixels. Misplaced objects get the smallest block that holds
them, horizontally centred and bottom-aligned; the rest keep their source in-cell position, so
modular pieces drawn to line up with each other still do.

Usage:
    python tools/repack_decor.py --analyze            # report every sheet, write nothing
    python tools/repack_decor.py --analyze office --preview DIR  # DIR/office_check.png
    python tools/repack_decor.py chairs tables ...    # repack the named sheets
    python tools/repack_decor.py chairs --preview DIR # also write DIR/<name>_before_after.png

Author-time only (needs Pillow); the app just loads the generated PNGs.
"""

import argparse
import math
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DECOR = ROOT / "client" / "src" / "assets" / "decor"

CELL = 32
SOLID_ALPHA = 200  # below this a pixel is a drop shadow, not part of the art
MIN_PIXELS = 6  # objects with fewer pixels are stray specks
FRAGMENT_PIXELS = 48  # smaller pieces are bits of a nearby object when within FRAGMENT_GAP px
FRAGMENT_GAP = 3
MIN_COLS, MAX_COLS = 8, 12


def span(lo, hi):
    """Cells covered by the pixel range [lo, hi)."""
    return (hi - 1) // CELL - lo // CELL + 1


class Box:
    """One object: its full bounding box (shadow included) and its solid-pixel core box."""

    __slots__ = ("label", "x0", "y0", "x1", "y1", "cx0", "cy0", "cx1", "cy1", "pixels")

    def __init__(self, label):
        self.label, self.pixels = label, 0
        self.x0 = self.y0 = self.cx0 = self.cy0 = math.inf
        self.x1 = self.y1 = self.cx1 = self.cy1 = -math.inf

    def add(self, x, y, solid):
        self.x0, self.y0 = min(self.x0, x), min(self.y0, y)
        self.x1, self.y1 = max(self.x1, x + 1), max(self.y1, y + 1)
        self.pixels += 1
        if solid:
            self.cx0, self.cy0 = min(self.cx0, x), min(self.cy0, y)
            self.cx1, self.cy1 = max(self.cx1, x + 1), max(self.cy1, y + 1)

    def block(self):
        """(cols, rows) of the smallest whole-cell block that holds the core."""
        return math.ceil((self.cx1 - self.cx0) / CELL), math.ceil((self.cy1 - self.cy0) / CELL)

    def aligned(self):
        """Whether the core already sits in as few cells as its size needs."""
        return (span(self.cx0, self.cx1), span(self.cy0, self.cy1)) == self.block()


def flood(mask, w, h, label, seeds, lab_of):
    """8-connected fill over `mask` pixels not yet labelled, from `seeds` (breadth-first, so
    pixels reachable from several seeds go to the nearest)."""
    queue = deque(seeds)
    while queue:
        i = queue.popleft()
        lab = lab_of(i)
        x, y = i % w, i // w
        for ny in (y - 1, y, y + 1):
            if 0 <= ny < h:
                for nx in (x - 1, x, x + 1):
                    if 0 <= nx < w:
                        j = ny * w + nx
                        if not label[j] and mask[j]:
                            label[j] = lab
                            queue.append(j)


def label_regions(mask, w, h, label, count):
    """Give every still-unlabelled region of `mask` a fresh label; returns the last label used."""
    for i in range(w * h):
        if mask[i] and not label[i]:
            count += 1
            label[i] = count
            flood(mask, w, h, label, [i], lambda _, c=count: c)
    return count


def gap(a, b):
    """Transparent pixels between two boxes' full extents (0 when they touch or overlap)."""
    return max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1, 0)


def absorb_fragments(label, boxes):
    """Fold small detached bits (sparks, steam, a loose leg) into the nearest big object at most
    FRAGMENT_GAP px away. Only small pieces move: two big neighbours are never merged."""
    big = [b for b in boxes.values() if b.pixels >= FRAGMENT_PIXELS]
    remap = {}
    for b in boxes.values():
        if b.pixels >= FRAGMENT_PIXELS:
            continue
        near = min(big, key=lambda o: gap(b, o), default=None)
        if near is not None and gap(b, near) <= FRAGMENT_GAP:
            remap[b.label] = near
    for lab, into in remap.items():
        b = boxes.pop(lab)
        into.x0, into.y0 = min(into.x0, b.x0), min(into.y0, b.y0)
        into.x1, into.y1 = max(into.x1, b.x1), max(into.y1, b.y1)
        into.cx0, into.cy0 = min(into.cx0, b.cx0), min(into.cy0, b.cy0)
        into.cx1, into.cy1 = max(into.cx1, b.cx1), max(into.cy1, b.cy1)
        into.pixels += b.pixels
    if remap:
        for i, lab in enumerate(label):
            if lab in remap:
                label[i] = remap[lab].label


def find_objects(img):
    """(per-pixel label, 0 = transparent; solid mask; objects in source reading order)."""
    w, h = img.size
    alpha = img.getchannel("A")
    solid = alpha.point(lambda a: 255 if a >= SOLID_ALPHA else 0).tobytes()
    shadow = alpha.point(lambda a: 255 if 0 < a < SOLID_ALPHA else 0).tobytes()
    label = [0] * (w * h)
    count = label_regions(solid, w, h, label, 0)
    flood(shadow, w, h, label, [i for i in range(w * h) if label[i]], lambda i: label[i])
    label_regions(shadow, w, h, label, count)  # a shadow touching no art stands alone

    boxes = {}
    for i, lab in enumerate(label):
        if lab:
            b = boxes.get(lab) or boxes.setdefault(lab, Box(lab))
            b.add(i % w, i // w, solid[i])
    for b in boxes.values():
        if b.cx0 == math.inf:  # all shadow (a translucent rug or decal): it is its own core
            b.cx0, b.cy0, b.cx1, b.cy1 = b.x0, b.y0, b.x1, b.y1
    absorb_fragments(label, boxes)
    objs = [b for b in boxes.values() if b.pixels >= MIN_PIXELS]
    objs.sort(key=lambda b: ((b.cy0 + b.cy1) // 2 // CELL, b.cx0))
    return label, solid, objs


def misplaced(img, label, solid, objs):
    """Indices of objects that cannot be picked as whole cells of their own in the source."""
    w = img.width
    obj_of = {b.label: k for k, b in enumerate(objs)}
    owner = {}
    bad = {k for k, b in enumerate(objs) if not b.aligned()}
    for i, lab in enumerate(label):
        k = obj_of.get(lab)
        if k is None or not solid[i]:
            continue
        other = owner.setdefault((i % w // CELL, i // w // CELL), k)
        if other != k:
            bad.update((k, other))
    return bad


def place(b, moved):
    """(cols, rows, dx, dy): the object's block and the shift from source to block pixels.
    Moved objects are centred horizontally and bottom-aligned, by their full box when it fits
    the block, else by the core; the others keep their source in-cell position."""
    cols, rows = b.block()
    if not moved:
        return cols, rows, -(b.cx0 // CELL) * CELL, -(b.cy0 // CELL) * CELL
    fx0, fx1 = (b.x0, b.x1) if b.x1 - b.x0 <= cols * CELL else (b.cx0, b.cx1)
    fy0, fy1 = (b.y0, b.y1) if b.y1 - b.y0 <= rows * CELL else (b.cy0, b.cy1)
    return cols, rows, (cols * CELL - (fx1 - fx0)) // 2 - fx0, rows * CELL - fy1


def cutout(img, label, b, cols, rows, dx, dy):
    """The object's own pixels moved into its block (neighbours' pixels and spill clipped)."""
    w = img.width
    out = Image.new("RGBA", (cols * CELL, rows * CELL), (0, 0, 0, 0))
    src = img.load()
    dst = out.load()
    for y in range(max(b.y0, -dy), min(b.y1, rows * CELL - dy)):
        for x in range(max(b.x0, -dx), min(b.x1, cols * CELL - dx)):
            if label[y * w + x] == b.label:
                dst[x + dx, y + dy] = src[x, y]
    return out


def pack(img, label, objs, bad):
    """Shelf-pack every object's block in order into a new sheet."""
    blocks = [place(b, k in bad) for k, b in enumerate(objs)]
    widest = max(cols for cols, _, _, _ in blocks)
    sheet_cols = max(widest, min(MAX_COLS, max(MIN_COLS, img.width // CELL)))
    spots = []
    cx = cy = shelf = 0
    for cols, rows, _, _ in blocks:
        if cx + cols > sheet_cols:
            cx, cy, shelf = 0, cy + shelf, 0
        spots.append((cx * CELL, cy * CELL))
        cx += cols
        shelf = max(shelf, rows)
    out = Image.new("RGBA", (sheet_cols * CELL, (cy + shelf) * CELL), (0, 0, 0, 0))
    for b, blk, spot in zip(objs, blocks, spots):
        out.alpha_composite(cutout(img, label, b, *blk), spot)
    return out


def grid_overlay(img, scale=2):
    big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    bg = Image.new("RGBA", big.size, (60, 60, 70, 255))
    tile = 8 * scale
    for y in range(0, big.height, tile):
        for x in range(0, big.width, tile):
            if (x // tile + y // tile) % 2:
                bg.paste((75, 75, 85, 255), (x, y, x + tile, y + tile))
    bg.alpha_composite(big)
    d = ImageDraw.Draw(bg)
    step = CELL * scale
    for x in range(0, bg.width + 1, step):
        d.line([(x, 0), (x, bg.height)], fill=(255, 0, 0, 255))
    for y in range(0, bg.height + 1, step):
        d.line([(0, y), (bg.width, y)], fill=(255, 0, 0, 255))
    return bg


def outlined(img, objs, bad):
    """The source at 2x on a red cell grid, object cores outlined (yellow = moved, cyan = kept)."""
    a = grid_overlay(img)
    d = ImageDraw.Draw(a)
    for k, o in enumerate(objs):
        colour = (255, 220, 0, 255) if k in bad else (0, 200, 255, 255)
        d.rectangle([o.cx0 * 2, o.cy0 * 2, o.cx1 * 2 - 1, o.cy1 * 2 - 1], outline=colour)
    return a


def preview(before, after, objs, bad, path):
    """Outlined source on the left, the repacked sheet on the same 2x grid on the right."""
    a, b = outlined(before, objs, bad), grid_overlay(after)
    out = Image.new("RGBA", (a.width + 16 + b.width, max(a.height, b.height)), (20, 20, 20, 255))
    out.paste(a, (0, 0))
    out.paste(b, (a.width + 16, 0))
    out.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheets", nargs="*", help="sheet names (file name without .png) to repack")
    ap.add_argument("--analyze", action="store_true",
                    help="report the named sheets (default: all), write no sheet")
    ap.add_argument("--preview", type=Path,
                    help="write <name>_before_after.png here (with --analyze: <name>_check.png)")
    args = ap.parse_args()

    names = args.sheets
    if args.analyze and not names:
        names = sorted(p.stem for p in DECOR.glob("*.png") if not p.stem.endswith("_grid"))
    if args.preview:
        args.preview.mkdir(parents=True, exist_ok=True)
    for name in names:
        img = Image.open(DECOR / f"{name}.png").convert("RGBA")
        label, solid, objs = find_objects(img)
        bad = misplaced(img, label, solid, objs)
        straddle = sum(1 for b in objs if not b.aligned())
        print(f"{name}: {len(objs)} objects, {straddle} straddle cell lines, "
              f"{len(bad) - straddle} more share a cell -> {len(bad)} moved "
              f"({100 * len(bad) // max(1, len(objs))}%)")
        if args.analyze:
            if args.preview:
                outlined(img, objs, bad).save(args.preview / f"{name}_check.png")
            continue
        out = pack(img, label, objs, bad)
        out.save(DECOR / f"{name}_grid.png", optimize=True)
        print(f"  -> {name}_grid.png {out.width}x{out.height}")
        if args.preview:
            preview(img, out, objs, bad, args.preview / f"{name}_before_after.png")


if __name__ == "__main__":
    main()
