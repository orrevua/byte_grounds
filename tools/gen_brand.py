"""Generate ByteGrounds brand assets into client/public/ from one 16x16 pixel-art logo.

Outputs: logo.svg (crisp vector), favicon-32.png, favicon-16.png, apple-touch-icon.png (180),
og-image.png (1200x630 link preview). Run from the repo root: python3 tools/gen_brand.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / 'client' / 'public'

# Palette (matches the game UI).
C = {
    'b': (79, 140, 255),    # blue tile
    'd': (47, 93, 186),     # tile shade
    'w': (238, 241, 245),   # letter
    'g': (79, 224, 160),    # online dot
    'k': (20, 22, 26),      # outline
}

# 16x16: a blue rounded tile with a pixel "B" and a green "online" dot, bottom-right.
LOGO = [
    '..bbbbbbbbbbbb..',
    '.bbbbbbbbbbbbbb.',
    'bbbbbbbbbbbbbbbb',
    'bbbbwwwwwwbbbbbb',
    'bbbbwwbbbwwbbbbb',
    'bbbbwwbbbwwbbbbb',
    'bbbbwwbbbwwbbbbb',
    'bbbbwwwwwwbbbbbb',
    'bbbbwwbbbbwwbbbb',
    'bbbbwwbbbbwwbbbb',
    'bbbbwwbbbbwwbbbb',
    'bbbbwwwwwwwbkkkk',
    'bbbbbbbbbbbbkggk',
    'ddddddddddddkggk',
    '.dddddddddddkkkk',
    '..dddddddddddd..',
]
SIZE = len(LOGO)


def logo_image(scale: int) -> Image.Image:
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    for y, row in enumerate(LOGO):
        for x, ch in enumerate(row):
            if ch != '.':
                img.putpixel((x, y), C[ch] + (255,))
    return img.resize((SIZE * scale, SIZE * scale), Image.NEAREST)


def logo_svg() -> str:
    rects = []
    for y, row in enumerate(LOGO):
        x = 0
        while x < SIZE:
            ch = row[x]
            if ch == '.':
                x += 1
                continue
            run = 1
            while x + run < SIZE and row[x + run] == ch:
                run += 1
            r, g, b = C[ch]
            rects.append(f'<rect x="{x}" y="{y}" width="{run}" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>')
            x += run
    body = ''.join(rects)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" '
        f'shape-rendering="crispEdges">{body}</svg>\n'
    )


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    for base in ('/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/dejavu'):
        p = Path(base) / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def og_image() -> Image.Image:
    w, h = 1200, 630
    img = Image.new('RGB', (w, h), (20, 22, 26))
    d = ImageDraw.Draw(img)
    # A floor of 32px tiles fading to the right, like the game's map.
    for ty in range(0, h, 32):
        for tx in range(0, w, 32):
            shade = 34 + ((tx // 32 + ty // 32) % 2) * 4
            d.rectangle([tx, ty, tx + 31, ty + 31], fill=(shade, shade + 4, shade + 10))
    d.rectangle([0, 0, w, h], outline=(51, 58, 68), width=6)
    img.paste(logo_image(16), (110, 187), logo_image(16))
    d.text((430, 205), 'ByteGrounds', font=font(92, bold=True), fill=(238, 241, 245))
    d.text((434, 330), 'A tiny virtual office for friends.', font=font(36), fill=(190, 198, 208))
    d.text((434, 382), 'Walk up to someone and just talk.', font=font(36), fill=(79, 224, 160))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'logo.svg').write_text(logo_svg())
    logo_image(2).save(OUT / 'favicon-32.png')
    logo_image(1).save(OUT / 'favicon-16.png')
    icon = Image.new('RGBA', (180, 180), (20, 22, 26, 255))
    icon.paste(logo_image(10), (10, 10), logo_image(10))
    icon.convert('RGB').save(OUT / 'apple-touch-icon.png')
    og_image().save(OUT / 'og-image.png', optimize=True)
    print('wrote', ', '.join(sorted(p.name for p in OUT.glob('*') if p.is_file())))


if __name__ == '__main__':
    main()
