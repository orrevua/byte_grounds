"""Author-time converter: an AI-made "pixel art" image (Gemini & co.) → a clean decor sheet.

Such images only look like pixel art: each art pixel is a block of a few source px, with JPEG
noise, a flat background, grid lines, painted drop shadows and stray bits. This shrinks them back to
real pixels so the game (32px cells, LPC-sized characters) can use them:

1. each output pixel = the average of the biggest group of similar colors in its source block
   (`--scale` source px per pixel): a real color of the art; a block with enough outline-dark
   pixels becomes outline, so 1px outlines stay unbroken where the art's pixel grid drifts;
2. the background (the most common color, or `--bg`) becomes transparent;
3. grid lines go: long straight 1px dark runs with background (or shadow) on both sides — art
   outlines always have art on one side, so they stay;
4. painted shadows (big blobs of the background's hue, darker) become translucent black, so they
   darken whatever floor the piece stands on;
5. near-identical colors (JPEG wobble, within `--merge`) merge into the most common of them, while
   rare distinct colors (leaf greens, highlights) survive;
6. background- or shadow-colored pixels enclosed by a piece (grey seats, screens), and shadow-colored
   ones with art above and below them, stay opaque art; only what connects to the open background is
   see-through (`--keep-holes` turns this off);
7. specks smaller than `--min-blob` pixels are dropped (stray legs, crumbs).

Pick `--scale` so one of the image's grid cells (or one chair) becomes 32px. Then
`python tools/repack_decor.py <name>` gives every piece whole cells (`<name>_grid.png`, which the
editor picker shows instead of the raw sheet).

Usage:
    python tools/pixelate_image.py in.jpg client/src/assets/decor/<name>.png --scale 3.125
    python tools/pixelate_image.py in.jpg out.png --scale 8 --preview DIR   # also DIR/<name>_x4.png

Author-time only (needs Pillow + NumPy + SciPy).
"""

import argparse
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

LUM = np.array([0.299, 0.587, 0.114])


def shrink(src: np.ndarray, scale: float, dark_below: float, dark_share: float) -> np.ndarray:
    """Each scale x scale block (edges trimmed by 15%) → the average of its biggest group of similar
    colors, or of its outline-dark pixels when there are enough of them."""
    h, w, _ = src.shape
    oh, ow = int(h / scale), int(w / scale)
    out = np.zeros((oh, ow, 3), np.int32)
    m = scale * 0.15
    for y in range(oh):
        y0, y1 = int(y * scale + m), max(int(y * scale + m) + 1, int((y + 1) * scale - m))
        for x in range(ow):
            x0, x1 = int(x * scale + m), max(int(x * scale + m) + 1, int((x + 1) * scale - m))
            block = src[y0:y1, x0:x1].reshape(-1, 3)
            dark = block @ LUM < dark_below
            if dark.mean() >= dark_share:
                out[y, x] = block[dark].mean(0)
                continue
            keys = (block[:, 0] // 14) * 400 + (block[:, 1] // 14) * 20 + block[:, 2] // 14
            vals, counts = np.unique(keys, return_counts=True)
            out[y, x] = block[keys == vals[counts.argmax()]].mean(0)
    return out


def runs_along(mask: np.ndarray, axis: int) -> np.ndarray:
    """For each True pixel, the length of the straight run of True it belongs to (axis 0 = vertical)."""
    out = np.zeros(mask.shape, np.int32)
    m = mask if axis == 0 else mask.T
    o = out if axis == 0 else out.T
    for j in range(m.shape[1]):
        col = m[:, j]
        i = 0
        while i < len(col):
            if not col[i]:
                i += 1
                continue
            k = i
            while k < len(col) and col[k]:
                k += 1
            o[i:k, j] = k - i
            i = k
    return out


def shifted(mask: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """mask moved by (dy, dx); the uncovered border is False."""
    out = np.zeros_like(mask)
    h, w = mask.shape
    out[max(dy, 0) : h + min(dy, 0), max(dx, 0) : w + min(dx, 0)] = mask[max(-dy, 0) : h + min(-dy, 0), max(-dx, 0) : w + min(-dx, 0)]
    return out


def enclosed(art: np.ndarray) -> np.ndarray:
    """Non-art pixels that the art encloses, bridging 1-2px gaps in its outlines."""
    closed = ndimage.binary_closing(np.pad(art, 2), np.ones((3, 3)))[2:-2, 2:-2]
    lab, _ = ndimage.label(~closed)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    outside = ndimage.binary_dilation(np.isin(lab, border[border > 0]), np.ones((3, 3)))
    return ~art & ~outside


def _before_after(piece: np.ndarray, reach: int) -> tuple[np.ndarray, np.ndarray]:
    """Per pixel: any piece pixel within `reach` before it / after it along axis 0."""
    c = np.vstack([np.zeros((1, piece.shape[1]), np.int32), np.cumsum(piece, 0, dtype=np.int32)])
    y = np.arange(piece.shape[0])
    before = c[y] - c[np.maximum(y - reach, 0)] > 0
    after = c[np.minimum(y + 1 + reach, piece.shape[0])] - c[y + 1] > 0
    return before, after


def sandwiched(art: np.ndarray, reach: int = 16) -> np.ndarray:
    """Pixels inside a piece's outline by column: art of one piece (8-connected, so a piece in the
    next row of the sheet doesn't count) below them within `reach` px, and above them or on both
    sides of them (a seat between armrests). Cast shadows have nothing of their piece below."""
    out = np.zeros_like(art)
    lab, _ = ndimage.label(art, structure=np.ones((3, 3)))
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        piece = lab[sl] == i
        above, below = _before_after(piece, reach)
        left, right = (m.T for m in _before_after(piece.T, reach))
        out[sl] |= below & (above | (left & right)) & ~piece
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--scale", type=float, required=True, help="source px per output pixel")
    ap.add_argument("--bg", help="background color #rrggbb (default: the most common color)")
    ap.add_argument("--tol", type=int, default=30, help="color distance (|dr|+|dg|+|db|) keyed as background")
    ap.add_argument("--dark", type=float, default=0.62, help="outline-dark = darker than this x background luminance")
    ap.add_argument("--dark-share", type=float, default=0.2, help="outline-dark share of a block that makes it outline")
    ap.add_argument("--line-run", type=int, default=28, help="min length of a straight dark run to remove as a grid line (longer than lamp poles)")
    ap.add_argument("--min-shadow", type=int, default=40, help="min size (px) of a dark background-hue blob to make a shadow")
    ap.add_argument("--merge", type=int, default=18, help="merge colors closer than this (|dr|+|dg|+|db|)")
    ap.add_argument("--min-blob", type=int, default=60)
    ap.add_argument("--keep-holes", action="store_true", help="leave background-colored pixels enclosed by art transparent")
    ap.add_argument("--preview")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    src = np.array(Image.open(args.input).convert("RGB")).astype(np.int32)
    if args.bg:
        bg = np.array([int(args.bg[i : i + 2], 16) for i in (1, 3, 5)])
    else:
        q = (src[::4, ::4] // 4 * 4).reshape(-1, 3)
        bg = np.array(Counter(map(tuple, q)).most_common(1)[0][0]) + 2
    bg_lum = float(bg @ LUM)
    small = shrink(src, args.scale, bg_lum * args.dark, args.dark_share)
    lum = small @ LUM

    clear = np.abs(small - bg).sum(2) < args.tol
    # Same hue as the background (its channel offsets), darker: a painted shadow.
    hue = np.abs((small - small.mean(2, keepdims=True)) - (bg - bg.mean())).sum(2) < 18
    shadowish = ~clear & hue & (lum >= bg_lum * 0.45) & (lum < bg_lum * 0.93)
    darkish = ~clear & ~shadowish & (lum < bg_lum * args.dark) | (~clear & (lum < bg_lum * 0.45))

    # Grid lines: long straight 1px runs (dark, or blended into shadow color by the shrink) with plain
    # background on both sides are removed; inside a shadow (shadow on both sides) they become shadow.
    # Shadow edges (background on one side, shadow on the other) are left alone.
    removed = {0: np.zeros_like(clear), 1: np.zeros_like(clear)}
    for _ in range(3):
        for axis, (d1, d2) in ((0, ((0, 1), (0, -1))), (1, ((1, 0), (-1, 0)))):
            ca, cb = shifted(clear, *d1), shifted(clear, *d2)
            sa, sb = shifted(shadowish, *d1), shifted(shadowish, *d2)
            thin = darkish | shadowish | (~clear & (lum < bg_lum * 0.95))
            # 1px wide: background on both sides; 2px wide (a line straddling two output pixels):
            # background, line, line, background.
            far = (d2[0] * 2, d2[1] * 2)
            # (the second pixel may be a lighter JPEG halo: anything not background)
            pair_first = thin & ca & shifted(~clear, *d2) & shifted(clear, *far)
            in_bg = (thin & ca & cb) | pair_first | shifted(pair_first, *d1)
            in_shadow = darkish & sa & sb
            runs = runs_along(in_bg, axis)
            line_bg = in_bg & (runs >= args.line_run)
            # A grid line broken into short pieces by stacked art still spans the sheet: a column
            # (row) with many such pieces in total is a line too.
            pieces = in_bg & (runs >= 4)
            total = pieces.sum(axis)
            long_lines = total >= 48
            line_bg |= pieces & np.broadcast_to(long_lines[None, :] if axis == 0 else long_lines[:, None], pieces.shape)
            line_sh = in_shadow & (runs_along(in_shadow, axis) >= args.line_run)
            clear |= line_bg
            shadowish = (shadowish & ~line_bg) | line_sh
            darkish &= ~(line_bg | line_sh)
            removed[axis] |= line_bg | line_sh

    # Leftovers on the grid itself: the columns / rows where lines were removed are the grid. Around
    # each grid line, a band 1px wider on both sides: wherever what is inside the band has background
    # (or shadow) on both sides of it, it's line, not art crossing the band — it goes (in a shadow it
    # becomes shadow). Catches short stubs between pieces and lines blurred into a halo.
    line_hue = np.abs((small - small.mean(2, keepdims=True)) - (bg - bg.mean())).sum(2) < 30
    for axis in (0, 1):
        counts = removed[axis].sum(axis)
        lines = np.nonzero(counts >= 12)[0]
        groups: list[list[int]] = []
        for g in lines:
            if groups and g - groups[-1][-1] <= 1:
                groups[-1].append(int(g))
            else:
                groups.append([int(g)])
        if args.debug:
            print("axis", axis, "grid lines at", [grp[0] for grp in groups])
        size = clear.shape[1 - axis] if axis == 0 else clear.shape[0]
        for grp in groups:
            lo, hi = grp[0] - 1, grp[-1] + 1
            if lo - 1 < 0 or hi + 1 >= size:
                continue
            if axis == 0:  # vertical band of columns lo..hi; outside = columns lo-1 and hi+1
                out_a, out_b = clear[:, lo - 1], clear[:, hi + 1]
                sh_a, sh_b = shadowish[:, lo - 1], shadowish[:, hi + 1]
                band = (slice(None), slice(lo, hi + 1))
                to_bg = (out_a & out_b)[:, None]
                to_sh = ((out_a | sh_a) & (out_b | sh_b) & ~(out_a & out_b))[:, None]
            else:  # horizontal band of rows lo..hi
                out_a, out_b = clear[lo - 1, :], clear[hi + 1, :]
                sh_a, sh_b = shadowish[lo - 1, :], shadowish[hi + 1, :]
                band = (slice(lo, hi + 1), slice(None))
                to_bg = (out_a & out_b)[None, :]
                to_sh = ((out_a | sh_a) & (out_b | sh_b) & ~(out_a & out_b))[None, :]
            sub_clear = clear[band]
            sub_sh = shadowish[band]
            sub_dark = darkish[band]
            # Only line-colored pixels: darker than the background and of its hue (art drawn on the
            # grid, like a lamp pole centered on a grid column, has its own color and stays).
            liney = (line_hue & (lum < bg_lum * 0.97))[band] | sub_clear
            bgm = np.broadcast_to(to_bg, sub_clear.shape) & liney
            shm = np.broadcast_to(to_sh, sub_clear.shape) & liney
            clear[band] = sub_clear | bgm
            shadowish[band] = (sub_sh & ~bgm) | (shm & ~sub_clear)
            darkish[band] = sub_dark & ~(bgm | shm)

    # The image's own border line (background on one side only): dark pixels in the outer 2px go.
    edge = np.zeros_like(clear)
    edge[:2, :] = edge[-2:, :] = True
    edge[:, :2] = edge[:, -2:] = True
    clear |= edge & (darkish | shadowish)
    darkish &= ~edge
    shadowish &= ~edge

    # Shadows: big same-hue dark blobs → translucent black; small ones stay art (e.g. grey chair bases).
    lab, n = ndimage.label(shadowish)
    sizes = ndimage.sum(shadowish, lab, range(1, n + 1)) if n else np.array([])
    shadow = np.isin(lab, np.nonzero(sizes >= args.min_shadow)[0] + 1)
    # A shadow touching no art (painted under a wall item, floating below it) would become an empty
    # piece in the picker: drop it.
    near_art = ndimage.binary_dilation(~clear & ~shadowish, iterations=2)
    for i in np.nonzero(sizes >= args.min_shadow)[0] + 1:
        blob = lab == i
        if not (blob & near_art).any():
            shadow &= ~blob
            clear |= blob
    # One opacity per shadow (its median): smooth, and grid lines crossing it don't show.
    raw = np.clip((1 - lum / bg_lum) * 255 * 1.25, 40, 160)
    shade = np.zeros(lum.shape, np.uint8)
    for i in np.nonzero(sizes >= args.min_shadow)[0] + 1:
        blob = lab == i
        shade[blob] = int(np.median(raw[blob]))

    # Holes: background- or shadow-colored pixels enclosed by a piece (a grey seat or monitor on a
    # grey background, a screen the background's hue) are the art's own colors, not see-through. Only
    # what connects to the open background (4-connected, so 1px diagonal outlines still enclose) stays
    # transparent / shadow. Outlines often have 1-2px gaps, so enclosure is judged on the art closed
    # by one pixel; the open background then grows back by one pixel, so notches stay see-through.
    art = ~clear & ~shadow
    if not args.keep_holes:
        # ...and shadow-colored pixels with art above and below them are the piece's own (an
        # unoutlined grey cushion, a JPEG fringe): cast shadows lie under a piece, not inside it.
        holes = enclosed(art) | (shadow & sandwiched(art))
        art |= holes
        clear &= ~holes
        shadow &= ~holes
        print(f"{int(holes.sum())} enclosed hole px filled")

    # Flat colors on the opaque art.
    colors, counts = np.unique(small[art].reshape(-1, 3), axis=0, return_counts=True)
    centers: list[np.ndarray] = []
    lookup: dict[tuple, np.ndarray] = {}
    for c in colors[np.argsort(-counts)]:
        hit = next((k for k in centers if np.abs(k - c).sum() <= args.merge), None)
        if hit is None:
            centers.append(c)
            hit = c
        lookup[tuple(c)] = hit
    flat = small.copy()
    for y, x in zip(*np.nonzero(art)):
        flat[y, x] = lookup[tuple(small[y, x])]

    # Specks: small isolated bits of art (touching only a shadow doesn't count).
    lab, n = ndimage.label(art, structure=np.ones((3, 3)))
    sizes = ndimage.sum(art, lab, range(1, n + 1)) if n else np.array([])
    specks = np.isin(lab, np.nonzero(sizes < args.min_blob)[0] + 1)
    art &= ~specks

    out = np.zeros(small.shape[:2] + (4,), np.uint8)
    out[art, :3] = flat[art]
    out[art, 3] = 255
    out[shadow, 3] = shade[shadow]
    h, w = out.shape[:2]
    sheet = np.zeros((-(-h // 32) * 32, -(-w // 32) * 32, 4), np.uint8)
    sheet[:h, :w] = out
    Image.fromarray(sheet, "RGBA").save(args.output)
    print(
        f"{args.output}: {sheet.shape[1]}x{sheet.shape[0]} px ({sheet.shape[1] // 32}x{sheet.shape[0] // 32} cells), "
        f"background #{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}, {len(centers)} colors, {int(shadow.sum())} shadow px, "
        f"{int(specks.sum())} speck px dropped"
    )
    if args.preview:
        im = Image.fromarray(sheet, "RGBA")
        floor = Image.new("RGBA", im.size, (215, 216, 234, 255))
        floor.alpha_composite(im)
        floor.resize((im.width * 4, im.height * 4), Image.NEAREST).save(Path(args.preview) / f"{Path(args.output).stem}_x4.png")


if __name__ == "__main__":
    main()
