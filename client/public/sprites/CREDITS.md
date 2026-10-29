# Sprite Credits & Attribution

The pixel-art avatars in ByteGrounds are composed from the **Universal LPC
Spritesheet**.

- **Source:** https://github.com/jrconway3/Universal-LPC-spritesheet
  (based on the OpenGameArt.org "Liberated Pixel Cup" / LPC collaboration).
- **Authors:** many contributors — see `LICENSE/AUTHORS.txt` for the full,
  per-layer attribution list (Luke Mehl, Johannes Sjölund, and others).

## License

Dual-licensed, your choice of:

- **Creative Commons Attribution-ShareAlike 3.0** (CC-BY-SA 3.0) —
  https://creativecommons.org/licenses/by-sa/3.0/ — full text in
  `LICENSE/cc-by-sa-3.0.txt`.
- **GNU General Public License 3.0** (GPL-3.0) —
  https://www.gnu.org/licenses/gpl-3.0.html — full text in
  `LICENSE/gpl-3.0.txt`.

## Share-alike notice

These assets are used under CC-BY-SA 3.0, which requires **attribution** (given
above) and **share-alike**: any derivative of these sprite sheets must be
distributed under the same CC-BY-SA 3.0 (or GPL-3.0) terms, carrying this
attribution and the license files. Most sheets here are vendored verbatim
(unmodified PNG layers); the wardrobe additions below include **derivatives**
(hue-recolors and layer composites) which are redistributed under the same
CC-BY-SA 3.0 share-alike terms, crediting the original layer author(s).
ByteGrounds composites all layers at runtime.

## Vendored layers

| Category | Files |
| --- | --- |
| body  | `lpc/body/{male_light,female_light}.png` |
| legs  | `lpc/legs/{teal,red,white}_pants_{male,female}.png` |
| torso | `lpc/torso/{teal,maroon,brown}_longsleeve_male.png`, `lpc/torso/{teal,maroon,brown}_tunic_female.png` |
| hair  | `lpc/hair/{brown,black,blonde}_{male,female}.png` |

## Wardrobe additions (avatar-wardrobe spec)

Twelve extra clothing sheets for the expanded editor (white + pink casual, a
green business/formal outfit, navy + pink pants). All are standard LPC sheets
(832×1344 px, 64×64 frame grid). Per-layer authorship is from the LPC
`LICENSE/AUTHORS.txt`.

**Fetched verbatim**

| File | LPC source | Author(s) |
| --- | --- | --- |
| `lpc/torso/white_longsleeve_male.png` | `torso/shirts/longsleeve/male/white_longsleeve.png` | LPC base clothing (see `AUTHORS.txt`) |
| `lpc/torso/white_tunic_female.png` | `torso/tunics/female/white_tunic.png` | JaidynReiman |

**Composites** (CC-BY-SA 3.0 derivatives — multiple LPC layers merged into one sheet)

| File | Composited from | Author(s) |
| --- | --- | --- |
| `lpc/torso/green_formal_male.png` | `formal_male_no_th-sh/{shirt,vest,tie}.png` | Thane Brimhall (Formal Male Attire group) |
| `lpc/torso/green_formal_female.png` | `torso/dress_female/underdress.png` + `dress_w_sash_female.png` | underdress: Lanea Zimmerman (AKA Sharm); dress with sash: Thane Brimhall |

**Recolored derivatives** (CC-BY-SA 3.0 — hue-recolor of the source sheet, alpha/shading preserved)

| File | Recolored from | Original author(s) |
| --- | --- | --- |
| `lpc/torso/pink_longsleeve_male.png` | `white_longsleeve_male.png` | LPC base clothing (see `AUTHORS.txt`) |
| `lpc/torso/pink_tunic_female.png` | `white_tunic_female.png` | JaidynReiman |
| `lpc/torso/pink_formal_male.png` | `green_formal_male.png` | Thane Brimhall |
| `lpc/torso/pink_formal_female.png` | `green_formal_female.png` | Lanea Zimmerman (AKA Sharm) + Thane Brimhall |
| `lpc/legs/navy_pants_male.png` | `white_pants_male.png` | LPC base clothing (see `AUTHORS.txt`) |
| `lpc/legs/navy_pants_female.png` | `white_pants_female.png` | LPC base clothing (see `AUTHORS.txt`) |
| `lpc/legs/pink_pants_male.png` | `white_pants_male.png` | LPC base clothing (see `AUTHORS.txt`) |
| `lpc/legs/pink_pants_female.png` | `white_pants_female.png` | LPC base clothing (see `AUTHORS.txt`) |

Notes: LPC has no single "formal" sheet (the male formal is component layers) and
no female formal sheet, so the business torsos are composited (male suit =
shirt+vest+tie; female = underdress + sash dress) — the real base color is
**green**, not navy. LPC ships no navy or pink pants, so those are PIL
hue-recolors of the white pants. Each composite and recolor is a derivative work
under CC-BY-SA 3.0 and is shared under the same license, retaining the original
author credit above.

## Seated (sit) pose sheets (sit-lie-poses spec)

`lpc/sit/<category>/<file>.png` — one 4-frame sheet (256×64 px; cols up/left/down/right)
for **every** vendored layer above, including the formal composites and the pink/navy
recolors (32 sheets). Each is an **algorithmic derivative** of the same-named source layer,
produced by `tools/gen_pose_sheets.py` from its standing walk-row idle frames: left/right
get a profile thigh-bend (torso lowered, thigh band turned 90° and outlined at the knee,
lower leg hung under the knee); up/down get a vertical leg-squash (thigh rows removed).

These are **CC-BY-SA 3.0 derivative works** (GPL-3.0 dual-licensed like their sources),
shared under the same terms. Original authorship is unchanged and follows each source
layer: the Universal LPC Spritesheet contributors (`LICENSE/AUTHORS.txt`), JaidynReiman
(tunics), Thane Brimhall (formal shirt/vest/tie and sash dress) and Lanea Zimmerman (AKA
Sharm) (underdress), as credited in the tables above. Regenerate with
`python tools/gen_pose_sheets.py` (needs Pillow).

## Bed blanket (`blanket.png`)

`blanket.png` (26×35 px) — the blanket drawn over a tucked-in avatar on an up/down bed.
**Original art** made for ByteGrounds, generated programmatically by `tools/gen_blanket.py`
(no third-party pixels). Released under **CC0 1.0** (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/). Regenerate with
`python tools/gen_blanket.py` (needs Pillow).
