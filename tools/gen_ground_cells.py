"""Author-time generator for shared/src/ground-cells.json: which decor cells are *ground*.

Ground = the bottom of the decor hierarchy: a cell of a floor/wall tile sheet that paints (almost)
its whole 32px cell (>= 95% of its pixels). Placing a ground cell replaces only the ground on that
tile and goes under the furniture standing there (see shared/src/ground.ts). Partial cells of these
sheets (trims, rugs, edges) stay furniture-level. Re-run after adding or changing a tile sheet.

Usage:
    python tools/gen_ground_cells.py
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DECOR = ROOT / "client" / "src" / "assets" / "decor"
OUT = ROOT / "shared" / "src" / "ground-cells.json"
# Floor / wall tile sets (decor.ts TILE_SHEETS) and the Gemini floor textures.
SHEETS = ["castle", "gemini_floors", "house_inside", "interior", "interior_tiles", "stairs"]
CELL = 32
COVER = 0.95


def ground_cells(sheet: str) -> list[str]:
    alpha = np.array(Image.open(DECOR / f"{sheet}.png").convert("RGBA"))[..., 3]
    cells = []
    for sy in range(alpha.shape[0] // CELL):
        for sx in range(alpha.shape[1] // CELL):
            if (alpha[sy * CELL : (sy + 1) * CELL, sx * CELL : (sx + 1) * CELL] > 0).mean() >= COVER:
                cells.append(f"{sx},{sy}")
    return cells


def main() -> None:
    catalog = {s: ground_cells(s) for s in SHEETS}
    OUT.write_text(json.dumps(catalog, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {sum(len(v) for v in catalog.values())} ground cells")


if __name__ == "__main__":
    main()
