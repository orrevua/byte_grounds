# Avatar Wardrobe — Expanded Clothing (Addendum to Avatar Editor)

**Status:** Draft
**Date:** 2026-10-28
**Related:** `docs/specs/avatar-editor.md` (units E1–E9, implemented), `docs/specs/avatar-art.md` (A1–A8), `docs/HANDOFF.md`

## Goal
Expand the avatar editor's clothing: **more colors overall, a PINK option, a BUSINESS/FORMAL
outfit (suit/blazer look), and casual day-to-day clothes**. This is purely additive — new LPC
layers + new option values + new editor entries, reusing the existing compose/preload/render
pipeline (`appearanceToLayers` / `drawAppearance` / URL-keyed cache). It is **not** a rewrite.

## Context & Current State
- `Appearance` has four fixed-union axes (`shared/src/protocol.ts:17-22`): `body` (male|female),
  `hair` (brown|black|blonde|none), `torso` (teal|maroon|brown), `legs` (teal|red|white).
- `appearanceToLayers(a)` (`client/src/sprites.ts:57-66`) resolves bottom→top URLs:
  body `/body/${body}_light.png`, legs `/legs/${legs}_pants_${body}.png`, torso
  `/torso/${torso}_${male?longsleeve:tunic}_${body}.png`, hair `/hair/${hair}_${body}.png`
  (omitted when `none`). `body` already doubles as the garment-style selector (longsleeve vs
  tunic). The image cache is **keyed by PNG URL** (`sprites.ts:137`), so any new combo caches for
  free.
- Editor data tables (`sprites.ts:43-91`): `BODY/HAIR/TORSO/LEGS`, `CATEGORIES` (drives the
  generic prev/next UI), `PRESETS` (6), `DEFAULT_APPEARANCE`, `ALL_LAYER_URLS` (cartesian of all
  axes), plus `normalizeAppearance`/`serializeAppearance`/`parseAppearance`/`shuffleAppearance`.
- Editor UI (`client/src/main.ts:60-151`): loops **generically** over `CATEGORIES` building a
  prev/next row per axis (`main.ts:63-70,114-126`), a Shuffle button, and preset buttons; a live
  64×64 preview via `drawAppearance`; `preloadAll()` once on init.
- Vendored layers today (`client/public/sprites/lpc/`, 20 PNGs, all 832×1344 64-grid): body
  `{male,female}_light`; legs `{teal,red,white}_pants_{male,female}`; torso
  `{teal,maroon,brown}_longsleeve_male` + `{teal,maroon,brown}_tunic_female`; hair
  `{brown,black,blonde}_{male,female}`.
- Licensing: all LPC, CC-BY-SA 3.0 / GPL-3.0; attribution + share-alike required
  (`client/public/sprites/CREDITS.md`, `client/public/sprites/LICENSE/`).

## Proposed Design

### Representation — add an `outfit` axis; widen `torso`/`legs` color unions
A new fifth axis selects the garment **family**; existing color axes gain new values (incl. pink).
Pre-release, so the wire shape is extended freely.

```ts
// shared/src/protocol.ts
export interface Appearance {
  body: 'male' | 'female';
  hair: 'brown' | 'black' | 'blonde' | 'none';
  outfit: 'casual' | 'business';                              // NEW — garment family
  torso: 'teal' | 'maroon' | 'brown' | 'white' | 'pink' | 'navy'; // top color (widened)
  legs: 'teal' | 'red' | 'white' | 'pink' | 'navy';              // pants color (widened)
}
```

**Why an `outfit` axis (not just more torso colors):** business/formal is a *different garment*
(suit/blazer vs longsleeve/tunic), not a recolor, so it needs its own layer family. Modeling it as
a separate axis keeps the color axes orthogonal, keeps the editor's generic `CATEGORIES` loop, and
keeps everything a flat, JSON-serializable record that travels in `JoinMsg`/`PeerState` unchanged.

**Garment resolution.** `outfit` + `body` choose the torso garment; `torso` chooses its color;
`legs` is always "pants" (colors shared across outfits — "formal pants" is just a dark pants
color). This bounds new assets: only the **torso** garment splits by outfit.

- casual, male → `longsleeve`; casual, female → `tunic`
- business, male/female → `formal`

**Per-outfit color palettes** (a torso color only exists for one family; legs shared):
- `CASUAL_TORSO = ['teal','maroon','brown','white','pink']`
- `BUSINESS_TORSO = ['navy','pink']`  (navy = the base LPC formal color; pink = recolor)
- `LEGS = ['teal','red','white','navy','pink']`
- `TORSO` (the full union, for the type + `normalizeAppearance`) = `CASUAL_TORSO ∪ BUSINESS_TORSO`
  = `['teal','maroon','brown','white','pink','navy']`

`appearanceToLayers` **clamps** the torso color into the current outfit's palette (unavailable →
palette[0]), so an inconsistent pair (e.g. `{outfit:'business', torso:'teal'}`) renders safely as
`navy_formal` instead of 404-ing on `teal_formal`:

```ts
const style = a.outfit === 'business' ? 'formal' : (a.body === 'male' ? 'longsleeve' : 'tunic');
const palette = a.outfit === 'business' ? BUSINESS_TORSO : CASUAL_TORSO;
const topColor = palette.includes(a.torso) ? a.torso : palette[0];
// /torso/${topColor}_${style}_${a.body}.png
// legs unchanged: /legs/${a.legs}_pants_${a.body}.png
```

### Editor data tables (`client/src/sprites.ts`)
- Add `OUTFIT = ['casual','business'] as const`; widen `TORSO`/`LEGS`.
- `CATEGORIES` gains an **Outfit** entry and the torso color options become **outfit-aware**.
  Extend the option field to accept a function and resolve it in the UI:
  ```ts
  export const CATEGORIES: {
    key: keyof Appearance; label: string;
    options: readonly string[] | ((a: Appearance) => readonly string[]);
  }[] = [
    { key: 'body',   label: 'Body',   options: BODY },
    { key: 'hair',   label: 'Hair',   options: HAIR },
    { key: 'outfit', label: 'Outfit', options: OUTFIT },
    { key: 'torso',  label: 'Top',    options: (a) => outfitTorso(a.outfit) }, // CASUAL/BUSINESS
    { key: 'legs',   label: 'Pants',  options: LEGS },
  ];
  export function outfitTorso(outfit: Appearance['outfit']): readonly string[] {
    return outfit === 'business' ? BUSINESS_TORSO : CASUAL_TORSO;
  }
  export function optionsFor(
    c: (typeof CATEGORIES)[number], a: Appearance,
  ): readonly string[] {
    return typeof c.options === 'function' ? c.options(a) : c.options;
  }
  ```
- `ALL_LAYER_URLS`: rebuild from the **real** per-outfit palettes (not the naive cartesian of the
  widened unions, which would invent files like `teal_formal`):
  ```ts
  BODY.flatMap(body => HAIR.flatMap(hair => LEGS.flatMap(legs =>
    OUTFIT.flatMap(outfit => outfitTorso(outfit).map(torso =>
      appearanceToLayers({ body, hair, outfit, torso, legs }))))))
  ```
  deduped via `new Set`. Guarantees `ALL_LAYER_URLS` lists only real files and covers every new
  layer.
- `PRESETS`: keep the 6; **add two** — `{ id:'biz', label:'Business (M)', appearance:{ body:'male',
  hair:'black', outfit:'business', torso:'navy', legs:'navy' } }` and `{ id:'pink', label:'Casual
  Pink (F)', appearance:{ body:'female', hair:'blonde', outfit:'casual', torso:'pink', legs:'pink'
  } }`. Existing 6 get `outfit:'casual'` added.
- `DEFAULT_APPEARANCE = PRESETS[0].appearance` (unchanged; now carries `outfit:'casual'`).

### Validation / serialization / shuffle (`client/src/sprites.ts`)
- `normalizeAppearance`: add `outfit: coerce(o.outfit, OUTFIT, default)`; `torso`/`legs` coerce
  against the widened unions. Unknown inbound values fall back to defaults (defensive on every
  peer appearance + localStorage load, as today).
- `serializeAppearance` → `"${body}.${hair}.${outfit}.${torso}.${legs}"` (5 parts).
- `parseAppearance`: split on `.`; map positionally through `normalizeAppearance`. **Backward
  tolerant:** a legacy 4-part string (no `outfit`) still parses — the missing field normalizes to
  the default `casual` (pre-release, but costs nothing to keep).
- `shuffleAppearance`: pick `outfit` first, then torso from **that outfit's** palette
  (`pick(outfitTorso(outfit), rand)`), legs from `LEGS`. Deterministic for a seeded `rand`.

### Editor UI (`client/src/main.ts`)
- The generic `CATEGORIES` loop resolves options via `optionsFor(cat, appearance)` so the **Top**
  arrows cycle the current outfit's palette.
- When the **Outfit** arrows change `outfit`, re-validate `torso` against the new palette and clamp
  to `outfitTorso(next)[0]` if the current color isn't in it (keeps editor state consistent with
  what renders), then `redraw()`.
- New presets appear automatically (preset loop is generic). No CSS structure change required; the
  extra axis row + two preset buttons reuse existing `.axis` / `.preset` styles.

### Assets + licensing
New PNGs go under `client/public/sprites/lpc/` following the existing naming scheme:
- casual torso: `torso/white_longsleeve_male.png`, `torso/white_tunic_female.png`,
  `torso/pink_longsleeve_male.png`, `torso/pink_tunic_female.png`
- business torso: `torso/navy_formal_male.png`, `torso/navy_formal_female.png`,
  `torso/pink_formal_male.png`, `torso/pink_formal_female.png`
- legs: `legs/navy_pants_male.png`, `legs/navy_pants_female.png`,
  `legs/pink_pants_male.png`, `legs/pink_pants_female.png`

**12 new PNGs.** Each must be a standard LPC sheet (832×1344, 64-grid) to blit identically.

**Sourcing — list real paths first (guessed paths 404).** The Implementer MUST enumerate real
folders via the GitHub API before downloading, exactly as in A1/E0:
`https://api.github.com/repos/jrconway3/Universal-LPC-spritesheet/contents/<dir>?ref=master`,
then download raw from `https://raw.githubusercontent.com/jrconway3/Universal-LPC-spritesheet/master/<path>`.
Known-relevant dirs: `torso/shirts/longsleeve/{male,female}/`, `torso/tunics/female/`, a formal
set directory (the repo tree earlier showed `formal_male_no_th-sh`; list `torso/` and the formal
dir to find the real male **and** female formal sheet paths + their actual color token), and
`legs/pants/{male,female}/`.
- If LPC ships a color under a **different token** than assumed here (e.g. the base formal is
  `black`/`charcoal` not `navy`, or casual "white" is "gray"), **use the real token**: rename the
  destination file, and update `BUSINESS_TORSO`/`CASUAL_TORSO`/`LEGS`/`TORSO` + the two new presets
  consistently. The palette names in this spec are the intended defaults, not a promise about LPC's
  catalog.
- If LPC has **no pink** for a given garment: recolor at author-time (see below).

**Pink recolor (derivative).** For any pink file LPC doesn't provide, derive it by hue-shifting an
existing light/white sheet of the *same garment* (preserve alpha + shading) with a small PIL step,
e.g.:
```python
from PIL import Image
src = Image.open('white_longsleeve_male.png').convert('RGBA')
r,g,b,a = src.split()
# colorize luminance toward pink, keep alpha + shadow detail
import PIL.ImageOps as ops
gray = Image.open('white_longsleeve_male.png').convert('L')
pink = ops.colorize(gray, black=(60,10,30), white=(255,190,210), mid=(235,120,160))
pink.putalpha(a)
pink.save('pink_longsleeve_male.png')
```
A recolored PNG is a **derivative** under CC-BY-SA 3.0: it must credit the original layer author(s)
and carry the same share-alike license. Record it as a derivative in CREDITS.md.

**CREDITS.md.** Add the new layers to the "Vendored layers" table; for each fetched layer copy the
exact author name(s) from the LPC `AUTHORS.txt` / per-file credits; mark each recolored pink file
as "derivative (hue-recolor) of `<source file>` by `<original author>`, CC-BY-SA 3.0".

### Scope
- **In scope:** `outfit` axis + widened `torso`/`legs` unions in the protocol; outfit-aware
  resolution/clamp/tables/normalize/serialize/shuffle in `sprites.ts`; two new presets; the 12 new
  LPC layers (fetched + pink-recolored) with CREDITS; editor UI picking up the new axis/options via
  the existing generic loop; Vitest coverage of the new pure logic.
- **Out of scope:** new hair styles / skin tones (still light-only); separate formal-pants garment
  (formal = dark pants color, reuse `pants`); accessories/shoes/hats; `render.ts`/`game.ts` changes
  (appearance flows through unchanged); any touch of `client/src/assets/decor/**` or `docs/HANDOFF.md`
  (**concurrent decor-tiles Implementer owns those — do not touch**).

## Interfaces / Models (exact)
```ts
// shared/src/protocol.ts — Appearance gains `outfit`; torso/legs widened (above).

// client/src/sprites.ts (new/changed)
export const OUTFIT: readonly ['casual','business'];
export const CASUAL_TORSO, BUSINESS_TORSO, TORSO, LEGS: readonly string[];
export function outfitTorso(outfit: Appearance['outfit']): readonly string[];
export function optionsFor(c, a: Appearance): readonly string[];
// CATEGORIES.options widened to `readonly string[] | ((a:Appearance)=>readonly string[])`
// appearanceToLayers: outfit branch + torso-color clamp (above)
// ALL_LAYER_URLS: built from per-outfit palettes
// normalizeAppearance/serializeAppearance/parseAppearance/shuffleAppearance: include `outfit`
```

## Impact Analysis
- **Protocol/construct sites:** adding a required `outfit` field surfaces every `Appearance`
  literal — `PRESETS`, `DEFAULT_APPEARANCE`, `shuffleAppearance`, `server/test/room.test.ts`
  literal, and any test fixtures. All in-scope units cover these. `main.ts`/`game.ts`/`render.ts`
  pass `Appearance` through opaquely → no signature changes.
- **Server:** copies `appearance` verbatim (trust model unchanged) — no code change; only the
  `room.test.ts` fixture literal needs `outfit`.
- **Tests:** `client/test/sprites.test.ts` extended (new cases below); `server/test/room.test.ts`
  fixture updated.
- **Perf:** vendored set grows 20 → 32 PNGs; `preloadAll()` once at editor init; per-frame cost
  unchanged (≤4 `drawImage`/avatar, shared PNGs cached once).
- **Failure modes:** inconsistent `(outfit,torso)` → clamp (no 404); unknown inbound values →
  `normalizeAppearance` → defaults; legacy 4-part serialized string → `outfit` defaults to casual;
  layers mid-load → disc fallback (unchanged).
- **Legal:** 12 new layers → CREDITS update required; recolored pinks flagged as CC-BY-SA
  derivatives with original author credit.

## Implementation Units
Dependency-ordered, ~50 LOC each. `(ASSET)` = author-time fetch/recolor, no app code.
`(MANUAL)` = needs two-tab [M] browser verification.

1. **W1 — Fetch casual + legs colors (ASSET)** — files: `client/public/sprites/lpc/torso/*`,
   `.../legs/*` — change: via the GitHub API list `torso/shirts/longsleeve/{male,female}/`,
   `torso/tunics/female/`, `legs/pants/{male,female}/`; download + rename `white_longsleeve_male`,
   `white_tunic_female`, `navy_pants_{male,female}` (use the real LPC color token if not "white"/
   "navy", and note it for W5/W6) — acceptance: 6 PNGs present, 832×1344, valid signature.
2. **W2 — Fetch business/formal torso (ASSET)** — files: `.../torso/*` — change: list `torso/`
   + the formal dir; download the male **and** female formal sheets → `navy_formal_male`,
   `navy_formal_female` (name by the real base color token) — acceptance: both PNGs present,
   832×1344, valid.
3. **W3 — Pink recolor derivatives (ASSET)** — files: `.../torso/pink_*`, `.../legs/pink_*` —
   change: hue-recolor pink from the white/light sheets (longsleeve M, tunic F, formal M/F,
   pants M/F) via a PIL step; preserve alpha/shading — acceptance: 6 pink PNGs present, 832×1344,
   alpha intact.
4. **W4 — CREDITS update (ASSET/docs)** — files: `client/public/sprites/CREDITS.md` — change: add
   all 12 layers to the table with per-layer author(s) from `AUTHORS.txt`; mark each pink file as a
   CC-BY-SA derivative of its source + original author — acceptance: every new file attributed;
   share-alike note covers derivatives.
5. **W5 — Protocol: `outfit` axis + widened unions** — files: `shared/src/protocol.ts`,
   `server/test/room.test.ts` — change: add `outfit` to `Appearance`, widen `torso`/`legs`; add
   `outfit` to the server test fixture — acceptance: shared + server typecheck + `npm test` green.
6. **W6 — sprites tables + resolution** — files: `client/src/sprites.ts` — change: add `OUTFIT`,
   `CASUAL_TORSO`, `BUSINESS_TORSO`, widened `TORSO`/`LEGS`, `outfitTorso`, `optionsFor`; widen
   `CATEGORIES` (+ Outfit entry, functional torso options); outfit branch + clamp in
   `appearanceToLayers`; rebuild `ALL_LAYER_URLS` from per-outfit palettes; add `outfit` to the 6
   presets + the 2 new presets (`biz`, `pink`) — acceptance: client typecheck green.
7. **W7 — normalize / serialize / shuffle** — files: `client/src/sprites.ts` — change: `outfit`
   in `normalizeAppearance`; 5-part `serialize`/`parse` (legacy-tolerant); outfit-aware
   `shuffleAppearance` — acceptance: typecheck green.
8. **W8 — Sprite logic tests** — files: `client/test/sprites.test.ts` — change: add cases —
   `appearanceToLayers` casual→longsleeve/tunic vs business→formal, per-sex, legs path, pink URL,
   clamp (`{business,teal}`→`navy_formal`); `normalizeAppearance` unknown `outfit`/color→default;
   `serialize↔parse` round-trip incl. outfit + legacy 4-part string; `shuffleAppearance` determinism
   + torso∈outfit palette; `PRESETS`/`DEFAULT_APPEARANCE` integrity (incl. new presets);
   `ALL_LAYER_URLS` covers every new layer and only real files — acceptance: `npm test` green.
9. **W9 — Editor picks up outfit + options (MANUAL)** — files: `client/src/main.ts` — change:
   resolve per-axis options via `optionsFor(cat, appearance)` in the cycling loop; on an `outfit`
   change clamp `torso` into the new palette before `redraw()` — acceptance: build + typecheck
   green; (MANUAL) Outfit/Top/Pants cycle correctly, Business + Casual Pink presets work, pink
   renders, business shows the formal garment, nothing 404s.

## Manual verification (browser [M], W9)
- Join screen shows the new **Outfit** row; cycling it swaps casual↔business garment in the preview.
- **Top** arrows cycle the current outfit's colors (casual: teal/maroon/brown/white/pink; business:
  navy/pink); switching outfit clamps an out-of-palette color without a broken/empty preview.
- **Pants** arrows include navy + pink.
- The **Business (M)** and **Casual Pink (F)** presets set the expected looks; Shuffle produces
  valid combos only (no 404s in the network tab).
- A second tab building a pink/business character renders it correctly in the first tab.
Units W5–W8 are covered by `npm test` + typecheck (no browser).

## Open Questions
- **Real LPC color tokens:** `navy`/`white` are intended names; the Implementer uses whatever LPC
  actually ships (listed via API) and keeps tables/presets/filenames consistent. **Assumption:** a
  dark formal base + a light casual base exist; pink is recolored.
- **Female formal garment:** LPC's female formal may be a dress/blazer under a distinct path —
  resolve via the API listing; file still lands as `*_formal_female.png`. **Assumption:** a usable
  female formal sheet exists; if not, recolor the male formal onto the female body sheet or fall
  back to a dark tunic (note the substitution in CREDITS).
- **Business palette size:** kept to `navy,pink` to bound recolor work; `charcoal`/`white` are an
  easy later add (append to `BUSINESS_TORSO` + fetch/recolor).
