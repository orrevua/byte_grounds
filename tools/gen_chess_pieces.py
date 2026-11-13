"""Author-time: cut the 12 chess pieces out of a pixelated Gemini sheet into the game's piece sheet.

The source (after `tools/pixelate_image.py`) has white pieces in the top row and black ones in the
bottom row, each row K Q R B N P left to right. Every piece goes bottom-centred into a CELL x CELL
square of `client/src/assets/chess/pieces.png` (6 columns, row 0 white, row 1 black), the sheet
`client/src/chess-view.ts` draws the board from.

Usage:
    python tools/pixelate_image.py art/gemini/chess_pieces.png /tmp/pieces.png --scale 8.3 --min-blob 20
    python tools/gen_chess_pieces.py /tmp/pieces.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

CELL = 48
OUT = Path(__file__).resolve().parent.parent / "client/src/assets/chess/pieces.png"


def main() -> None:
    src = Image.open(sys.argv[1]).convert("RGBA")
    alpha = np.array(src)[:, :, 3] > 0
    labels, n = ndimage.label(alpha, structure=np.ones((3, 3)))
    boxes = [b for b in ndimage.find_objects(labels) if b is not None]
    big = sorted(boxes, key=lambda b: (b[0].stop - b[0].start) * (b[1].stop - b[1].start), reverse=True)[:12]
    if len(big) != 12:
        sys.exit(f"expected 12 pieces, found {len(big)}")
    mid = np.median([b[0].stop for b in big])
    rows = [sorted([b for b in big if (b[0].stop < mid) == top], key=lambda b: b[1].start) for top in (True, False)]
    sheet = Image.new("RGBA", (CELL * 6, CELL * 2), (0, 0, 0, 0))
    for r, row in enumerate(rows):
        if len(row) != 6:
            sys.exit(f"row {r}: {len(row)} pieces")
        for c, (ys, xs) in enumerate(row):
            piece = src.crop((xs.start, ys.start, xs.stop, ys.stop))
            w, h = piece.size
            if w > CELL or h > CELL:
                sys.exit(f"piece {r},{c} is {w}x{h}, bigger than {CELL}")
            sheet.alpha_composite(piece, (c * CELL + (CELL - w) // 2, r * CELL + CELL - 2 - h))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    print(f"{OUT}: {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    main()
