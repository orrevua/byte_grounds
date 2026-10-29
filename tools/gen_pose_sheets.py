"""Author-time generator for the seated (sit) LPC avatar sheets.

Reads every vendored layer under client/public/sprites/lpc/ (body, legs, torso, hair -- including
the formal composites and pink/navy recolors) and writes a 4-frame sit sheet per layer to
client/public/sprites/lpc/sit/<same relative path>. Sheet layout: one row of 64x64 frames, cols
up/left/down/right (matches `sitFrame` in client/src/sprites.ts).

Every LPC layer shares the same skeleton and frame registration, so applying the identical pixel
transform to each layer keeps them aligned when composed at runtime.

- left/right: profile thigh-bend. The torso is kept upright and lowered SEAT_DROP px, the thigh
  band is rotated 90 degrees to lie horizontal (stretched to THIGH_LEN), and the shin + foot hang
  from the knee, shifted forward SHIN_DX px. Feet stay on the frame's ground line.
- up/down: vertical leg-squash fallback. The thigh rows are cut out and the body above them
  lowered, so the legs read foreshortened with the feet still grounded.

Usage:
    python tools/gen_pose_sheets.py                    # (re)generate every sit sheet
    python tools/gen_pose_sheets.py --preview OUT_DIR  # write sample composed frames for tuning

Author-time only (needs Pillow); the app just loads the generated PNGs.
"""

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LPC = ROOT / "client" / "public" / "sprites" / "lpc"
OUT = LPC / "sit"
LAYER_DIRS = ("body", "legs", "torso", "hair")

FRAME = 64
WALK_ROW = {"up": 8, "left": 9, "down": 10, "right": 11}
SIT_COL = {"up": 0, "left": 1, "down": 2, "right": 3}

# Profile bands, in right-facing frame coordinates (y down, +x = forward). Tuned against
# body/male_light.png and reused for every layer.
HIP_Y = 48  # rows [0, HIP_Y) = head + torso, kept upright
KNEE_Y = 56  # rows [HIP_Y, KNEE_Y) = thigh band, turned horizontal
SHIN_Y = 52  # rows [SHIN_Y, 64) = lower leg + foot, hung from the knee
THIGH_X0, THIGH_X1 = 33, 39  # thigh columns (excludes the hand hanging behind the hip)
SHIN_X0 = 31  # lower-leg columns [SHIN_X0, 64): the front leg only (drops the walk stride's back leg)
THIGH_LEN = 16  # horizontal thigh length after the 90-degree turn
THIGH_AT = (28, 47)  # top-left of the turned thigh in the output frame
SHIN_DX = 6  # lower leg shifted forward to hang under the knee
SEAT_DROP = 4  # torso lowered onto the seat

# Front/back squash: rows [SQUASH_Y0, SQUASH_Y1) are removed and everything above drops down.
SQUASH_Y0, SQUASH_Y1 = 46, 52


def frame_at(sheet: Image.Image, row: int, col: int = 0) -> Image.Image:
    x, y = col * FRAME, row * FRAME
    return sheet.crop((x, y, x + FRAME, y + FRAME))


def outline_thigh(piece: Image.Image) -> Image.Image:
    """Close the turned thigh's cut knee end (+x) and underside with the piece's own outline color."""
    px = piece.load()
    opaque = [px[x, y] for x in range(piece.width) for y in range(piece.height) if px[x, y][3]]
    if not opaque:
        return piece
    ink = min(opaque, key=lambda c: c[0] + c[1] + c[2])
    for y in range(piece.height):
        xs = [x for x in range(piece.width) if px[x, y][3]]
        if xs:
            px[xs[-1], y] = ink
    for x in range(piece.width):
        ys = [y for y in range(piece.height) if px[x, y][3]]
        if ys:
            px[x, ys[-1]] = ink
    return piece


def sit_profile_right(f: Image.Image) -> Image.Image:
    out = Image.new("RGBA", (FRAME, FRAME))
    out.alpha_composite(f.crop((SHIN_X0, SHIN_Y, FRAME, FRAME)), (SHIN_X0 + SHIN_DX, SHIN_Y))
    out.alpha_composite(f.crop((0, 0, FRAME, HIP_Y)), (0, SEAT_DROP))
    # ROTATE_90 is counter-clockwise: the knee end swings forward (+x), the thigh's front goes up.
    thigh = f.crop((THIGH_X0, HIP_Y, THIGH_X1, KNEE_Y)).transpose(Image.Transpose.ROTATE_90)
    thigh = thigh.resize((THIGH_LEN, thigh.height), Image.Resampling.NEAREST)
    out.alpha_composite(outline_thigh(thigh), THIGH_AT)
    return out


def sit_profile(f: Image.Image, facing: str) -> Image.Image:
    if facing == "right":
        return sit_profile_right(f)
    mirror = Image.Transpose.FLIP_LEFT_RIGHT
    return sit_profile_right(f.transpose(mirror)).transpose(mirror)


def sit_squash(f: Image.Image) -> Image.Image:
    out = Image.new("RGBA", (FRAME, FRAME))
    out.alpha_composite(f.crop((0, SQUASH_Y1, FRAME, FRAME)), (0, SQUASH_Y1))
    out.alpha_composite(f.crop((0, 0, FRAME, SQUASH_Y0)), (0, SQUASH_Y1 - SQUASH_Y0))
    return out


def sit_sheet(sheet: Image.Image) -> Image.Image:
    out = Image.new("RGBA", (FRAME * len(SIT_COL), FRAME))
    for facing, col in SIT_COL.items():
        f = frame_at(sheet, WALK_ROW[facing])
        posed = sit_profile(f, facing) if facing in ("left", "right") else sit_squash(f)
        out.alpha_composite(posed, (col * FRAME, 0))
    return out


def layer_paths() -> list[Path]:
    return sorted(p for d in LAYER_DIRS for p in (LPC / d).glob("*.png"))


def generate() -> None:
    for src in layer_paths():
        dst = OUT / src.relative_to(LPC)
        dst.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(src) as im:
            sit_sheet(im.convert("RGBA")).save(dst, optimize=True)
        print(dst.relative_to(ROOT).as_posix())


PREVIEW_COMBOS = {
    "body_male": ["body/male_light.png"],
    "teal_male": [
        "body/male_light.png",
        "legs/teal_pants_male.png",
        "torso/teal_longsleeve_male.png",
        "hair/brown_male.png",
    ],
    "formal_female": [
        "body/female_light.png",
        "legs/pink_pants_female.png",
        "torso/pink_formal_female.png",
        "hair/blonde_female.png",
    ],
}
PREVIEW_SCALE = 4


def preview(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, layers in PREVIEW_COMBOS.items():
        composed = Image.new("RGBA", (FRAME * len(SIT_COL), FRAME * 2), (170, 170, 170, 255))
        for rel in layers:
            with Image.open(LPC / rel) as im:
                sheet = im.convert("RGBA")
            for facing, col in SIT_COL.items():
                composed.alpha_composite(frame_at(sheet, WALK_ROW[facing]), (col * FRAME, 0))
            composed.alpha_composite(sit_sheet(sheet), (0, FRAME))
        size = (composed.width * PREVIEW_SCALE, composed.height * PREVIEW_SCALE)
        composed.resize(size, Image.Resampling.NEAREST).save(out_dir / f"sit_{name}.png")
        print((out_dir / f"sit_{name}.png").as_posix())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--preview", type=Path, metavar="OUT_DIR", help="write tuning previews instead")
    args = parser.parse_args()
    if args.preview:
        preview(args.preview)
    else:
        generate()


if __name__ == "__main__":
    main()
