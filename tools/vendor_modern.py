"""Author-time vendoring of the modern LPC wardrobe (new garment, bottom and hair *styles*).

Fetches sheets from the Universal LPC Spritesheet Character Generator
(https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator, CC-BY-SA 3.0 /
GPL-3.0; per-file authors in its CREDITS.csv), crops each to the 832x1344 universal grid the
vendored bodies use (the generator sheets carry extra rows below), maps the generator color names
onto ours and writes them into client/public/sprites/lpc/<kind>/:

    torso/{color}_{style}_{body}.png    (tshirt, vneck, polo, cardigan, blouse, tank, vest, jacket)
    legs/{color}_{bottom}_{body}.png    (shorts, skirt)
    hair/{color}_{style}_{body}.png     (bob, pixie, ponytail, ...)

The vest and the jacket are worn over our white longsleeve (composited). Then run `python tools/gen_pose_sheets.py`
for the seated versions.

Usage:
    python tools/vendor_modern.py [--cache DIR]
"""

import argparse
import io
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LPC = ROOT / "client" / "public" / "sprites" / "lpc"
BASE = "https://raw.githubusercontent.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator/master/spritesheets/"
SHEET = (832, 1344)

# our color name -> generator file name
TOPS = {c: c for c in ["teal", "maroon", "brown", "white", "pink", "black", "blue", "red", "yellow", "purple", "orange"]}
TOPS["grey"] = "gray"
BOTTOMS = {c: c for c in ["teal", "red", "white", "navy", "pink", "black", "brown", "green"]}
BOTTOMS.update(grey="gray", khaki="tan")
HAIR = {"brown": "chestnut", "black": "black", "blonde": "blonde", "red": "redhead", "white": "white", "pink": "pink", "blue": "blue"}

# style -> {body: generator dir}
TORSO_STYLES = {
    "tshirt": {"male": "torso/clothes/shortsleeve/shortsleeve/male", "female": "torso/clothes/shortsleeve/tshirt/female"},
    "vneck": {"female": "torso/clothes/shortsleeve/tshirt_vneck/female"},
    "polo": {"female": "torso/clothes/shortsleeve/shortsleeve_polo/female"},
    "cardigan": {"female": "torso/clothes/longsleeve/longsleeve2_cardigan/female"},
    "blouse": {"female": "torso/clothes/blouse/female"},
    "tank": {"male": "torso/clothes/sleeveless/sleeveless/male", "female": "torso/clothes/sleeveless/tanktop/female"},
    "vest": {"male": "torso/clothes/vest/male"},
    "jacket": {"male": "torso/jacket/collared/male"},
}
UNDER = {"vest": "torso/white_longsleeve_male.png", "jacket": "torso/white_longsleeve_male.png"}  # worn over a shirt
BOTTOM_STYLES = {
    "shorts": {"male": "legs/shorts/shorts/male", "female": "legs/shorts/shorts/thin"},
    "skirt": {"female": "legs/skirts/plain/female"},
}
HAIR_STYLES = {
    "bob": "bob/adult",
    "pixie": "pixie/{body}",
    "ponytail": "ponytail/{body}",
    "curly": "curly_short/adult",
    "afro": "afro/{body}",
    "spiked": "spiked/{body}",
    "long": "long/{body}",
    "buzzcut": "buzzcut/adult",
    "bun": "bangs_bun/adult",
    "messy": "messy1/{body}",
    "dreads": "dreadlocks_short/adult",
    "parted": "parted/{body}",
}


def fetch(rel: str, cache: Path) -> Image.Image:
    local = cache / rel
    if not local.exists():
        local.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(BASE + rel) as r:
            local.write_bytes(r.read())
    img = Image.open(io.BytesIO(local.read_bytes())).convert("RGBA")
    if img.width != SHEET[0] or img.height < SHEET[1]:
        raise ValueError(f"{rel}: unexpected size {img.size}")
    return img.crop((0, 0, *SHEET))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(ROOT / ".cache" / "ulpc"))
    cache = Path(ap.parse_args().cache)
    n = 0

    def put(img: Image.Image, rel: str) -> None:
        nonlocal n
        img.save(LPC / rel, optimize=True)
        n += 1

    for style, per_body in TORSO_STYLES.items():
        for body, d in per_body.items():
            for ours, theirs in TOPS.items():
                img = fetch(f"{d}/{theirs}.png", cache)
                if style in UNDER:
                    under = Image.open(LPC / UNDER[style]).convert("RGBA")
                    under.alpha_composite(img)
                    img = under
                put(img, f"torso/{ours}_{style}_{body}.png")
    for style, per_body in BOTTOM_STYLES.items():
        for body, d in per_body.items():
            for ours, theirs in BOTTOMS.items():
                put(fetch(f"{d}/{theirs}.png", cache), f"legs/{ours}_{style}_{body}.png")
    for style, pattern in HAIR_STYLES.items():
        for body in ("male", "female"):
            for ours, theirs in HAIR.items():
                put(fetch(f"hair/{pattern.format(body=body)}/{theirs}.png", cache), f"hair/{ours}_{style}_{body}.png")
    print(f"wrote {n} layers")


if __name__ == "__main__":
    main()
