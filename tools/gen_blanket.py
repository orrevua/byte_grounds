"""Author-time generator for the bed blanket drawn over a tucked-in avatar (up/down beds).

Writes client/public/sprites/blanket.png: a W x H pixel-art quilt (original art, CC0) with a
rounded 1px outline, a folded sheet hem across the chest, side shading and a quilt seam. The
size must match `tuckLayout().blanket` in client/src/sprites.ts (top row = chest end).

Usage:
    python tools/gen_blanket.py

Author-time only (needs Pillow); the app just loads the generated PNG.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "client" / "public" / "sprites" / "blanket.png"

W, H = 26, 35

OUTLINE = (92, 80, 62, 255)
BASE = (214, 200, 170, 255)
SHADE = (190, 175, 145, 255)
SEAM = (198, 184, 154, 255)
HEM = (246, 242, 232, 255)
HEM_SHADE = (222, 216, 202, 255)
HEM_EDGE = (150, 136, 110, 255)

HEM_ROWS = 4  # folded sheet across the chest (rows 1..HEM_ROWS-1 inside the outline)
SEAM_EVERY = 8  # horizontal quilt seams below the hem


def corner(x: int, y: int) -> bool:
    """True for the transparent pixels that round off each corner."""
    cx = min(x, W - 1 - x)
    cy = min(y, H - 1 - y)
    return cx + cy < 2


def edge(x: int, y: int) -> bool:
    """True on the 1px outline (including the diagonal corner pixels)."""
    cx = min(x, W - 1 - x)
    cy = min(y, H - 1 - y)
    return cx == 0 or cy == 0 or cx + cy == 2


def colour(x: int, y: int) -> tuple:
    if corner(x, y):
        return (0, 0, 0, 0)
    if edge(x, y):
        return OUTLINE
    if y < HEM_ROWS:
        return HEM_SHADE if y == HEM_ROWS - 1 else HEM
    if y == HEM_ROWS:
        return HEM_EDGE
    side = min(x, W - 1 - x)
    if side <= 2 or y >= H - 3:
        return SHADE
    if (y - HEM_ROWS) % SEAM_EVERY == 0:
        return SEAM
    return BASE


def main() -> None:
    img = Image.new("RGBA", (W, H))
    for y in range(H):
        for x in range(W):
            img.putpixel((x, y), colour(x, y))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
