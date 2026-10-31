"""Author-time generator for recolored avatar layers (more clothes and hair colors).

Each new layer is a gradient map of an existing LPC layer: every pixel's brightness (relative to the
layer's own range) picks a color on a dark → base → highlight ramp built from the target color, so
the shading, outlines and every animation frame stay exactly as in the source. Outline pixels (the
darkest) stay near-black. Writes into client/public/sprites/lpc/<kind>/; then run
`python tools/gen_pose_sheets.py` for the seated versions.

Usage:
    python tools/recolor_layers.py            # (re)write every layer in RECOLORS
    python tools/recolor_layers.py --preview DIR
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LPC = ROOT / "client" / "public" / "sprites" / "lpc"

# target color per name (the "base" of the ramp)
COLORS = {
    "black": (58, 60, 70),
    "blue": (60, 110, 200),
    "red": (196, 58, 58),
    "yellow": (232, 190, 64),
    "purple": (132, 82, 190),
    "orange": (232, 128, 52),
    "grey": (140, 146, 156),
    "navy": (46, 62, 112),
    "burgundy": (120, 34, 52),
    "brown": (118, 80, 50),
    "green": (70, 132, 76),
    "khaki": (186, 164, 116),
    "white": (226, 226, 222),
    "pink": (236, 128, 176),
}

# (source file, output pattern with {c}, colors)
RECOLORS = [
    ("torso/white_longsleeve_male.png", "torso/{c}_longsleeve_male.png", ["black", "blue", "red", "yellow", "purple", "orange", "grey"]),
    ("torso/white_tunic_female.png", "torso/{c}_tunic_female.png", ["black", "blue", "red", "yellow", "purple", "orange", "grey"]),
    ("torso/green_formal_male.png", "torso/{c}_formal_male.png", ["navy", "black", "grey", "burgundy"]),
    ("torso/green_formal_female.png", "torso/{c}_formal_female.png", ["navy", "black", "grey", "burgundy"]),
    ("legs/white_pants_male.png", "legs/{c}_pants_male.png", ["black", "brown", "grey", "green", "khaki"]),
    ("legs/white_pants_female.png", "legs/{c}_pants_female.png", ["black", "brown", "grey", "green", "khaki"]),
    ("hair/blonde_male.png", "hair/{c}_male.png", ["red", "white", "pink", "blue"]),
    ("hair/blonde_female.png", "hair/{c}_female.png", ["red", "white", "pink", "blue"]),
]

LUM = np.array([0.299, 0.587, 0.114])


def ramp(color):
    """Dark → base → highlight stops for a target color (darker colors get a lighter top end)."""
    c = np.array(color, float)
    dark = c * 0.38
    light = c + (255 - c) * (0.55 if c @ LUM < 90 else 0.42)
    return np.stack([dark, c, light])


def recolor(src: Image.Image, color) -> Image.Image:
    a = np.array(src.convert("RGBA")).astype(float)
    alpha = a[..., 3] > 0
    lum = a[..., :3] @ LUM
    vals = lum[alpha]
    outline_cut = np.percentile(vals, 6)  # the darkest few % are outlines
    body = alpha & (lum > outline_cut)
    lo, hi = np.percentile(lum[body], [3, 97])
    t = np.clip((lum - lo) / max(1.0, hi - lo), 0, 1)
    stops = ramp(color)
    # piecewise linear over 3 stops: 0 → dark, 0.55 → base, 1 → light
    k = np.clip(t / 0.55, 0, 1)[..., None]
    k2 = np.clip((t - 0.55) / 0.45, 0, 1)[..., None]
    out = np.where((t < 0.55)[..., None], stops[0] + (stops[1] - stops[0]) * k, stops[1] + (stops[2] - stops[1]) * k2)
    outline = alpha & ~body
    out[outline] = np.minimum(a[outline][:, :3], stops[0] * 0.6)
    res = a.copy()
    res[..., :3] = np.where(alpha[..., None], out, a[..., :3])
    return Image.fromarray(np.clip(res, 0, 255).astype(np.uint8), "RGBA")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview")
    args = ap.parse_args()
    made = []
    for src_rel, pattern, colors in RECOLORS:
        src = Image.open(LPC / src_rel)
        for c in colors:
            out = LPC / pattern.format(c=c)
            recolor(src, COLORS[c]).save(out)
            made.append(out)
    print(f"wrote {len(made)} layers")
    if args.preview:
        # the standing down frame of each, side by side
        frames = [Image.open(p).crop((0, 640, 64, 704)) for p in made]
        sheet = Image.new("RGBA", (64 * 12, 64 * ((len(frames) + 11) // 12)), (90, 90, 90, 255))
        for i, f in enumerate(frames):
            sheet.alpha_composite(f, ((i % 12) * 64, (i // 12) * 64))
        sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST).save(Path(args.preview) / "recolors.png")


if __name__ == "__main__":
    main()
