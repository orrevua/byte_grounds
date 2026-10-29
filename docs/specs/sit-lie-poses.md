# Sit & Side-Lie Poses — Spec

**Status:** Draft
**Date:** 2026-10-29
**Related:** `docs/HANDOFF.md`; `docs/specs/avatar-wardrobe.md` (author-time PIL
recolor/composite precedent); supersedes the lowered-standing-frame sit and the
`down`-frame-rotation lie in `client/src/render.ts:125` (`drawPosedSprite`).

## Goal
Replace the two "pose = reposition the standing frame" hacks with (1) a real
**bent-leg sitting** pose and (2) a genuine **lying-on-his-side** pose, keeping
the existing layered-compose / preload / depth pipeline and all clothing layers
visible and aligned.

## Context & Current State

Avatars are layered LPC sprites composed at runtime, bottom→top:
body → legs(pants) → torso(shirt/tunic/formal) → hair
(`client/src/sprites.ts:77` `appearanceToLayers`). Each layer is a standard LPC
sheet: 64×64 frames, 13 cols × 21 rows, rows grouped
spellcast / thrust / walk / slash / shoot / hurt. Only the **walk** rows are used:
`WALK_ROW = { up:8, left:9, down:10, right:11 }` (`sprites.ts:13`), col 0 = idle,
cols 1–8 = walk cycle (`sprites.ts:33`).

Drawing: `drawAppearance(ctx, a, dir, col, destX, destY)` blits
`(col, WALK_ROW[dir])` of every loaded layer (`sprites.ts:220`). `drawSprite`
feet-anchors the 64px frame on the tile point (`render.ts:92`).

Current poses (`render.ts:125` `drawPosedSprite`):
- **sit** = standing col-0 frame lowered `SIT_DROP=10`px (`render.ts:139`,
  `sprites.ts:217`). Legs straight — not seated.
- **lie** = the `down` (front) frame rotated 90° (`render.ts:107` `LIE_ROTATION`,
  `render.ts:142`). Lays the avatar on its **back/front** (we see the belly),
  not on its **side**; the old L/R sign was never pinned.

Pose plumbing already works end-to-end and needs **no change**:
`Pose='stand'|'sit'|'lie'` (`shared/src/protocol.ts:13`) travels in presence;
seats carry `kind:'sit'|'lie'` + `dir:Facing` (= where the feet point; for a bed
the pillow tile) (`shared/src/map.ts:24`); seat entry sets pose+dir
(`game.ts:286`); render calls `drawPosedSprite(... pose, dir, col, x, y)`
(`game.ts:383`); depth sort lets front furniture occlude legs (`depth.ts`,
`render.ts:360`).

Vendored layers (`client/public/sprites/lpc/`, catalogued in
`client/public/sprites/CREDITS.md`): body male/female; pants teal/red/white
verbatim + navy/pink **recolors**; torso longsleeve(m)/tunic(f) teal/maroon/
brown/white verbatim + pink **recolor**; formal(m/f) green **composite** + pink
**recolor** composite; hair brown/black/blonde. License CC-BY-SA 3.0 / GPL-3.0
dual. **Author-time derivation (PIL recolor/composite) is already the project's
established workflow** (`docs/specs/avatar-wardrobe.md:168`), though no script is
committed yet.

## Key Findings (asset reality)

1. **Bent-leg sitting cannot come from any sheet we already have.** Every row we
   use (walk) and every other vendored row (spellcast/thrust/slash/shoot/hurt)
   draws **straight legs**. A genuine seated pose needs **new leg pixels** — either
   fetched or synthesized. The only no-new-pixel "sit" is the rejected
   lowered-standing hack.
2. **The clothing we actually use has essentially no usable real sit coverage.**
   jrconway3@master has no sit/lie rows at all. The modern
   sanderfrenken generator bundles a "sit" animation, but its per-layer coverage
   is partial, and — decisively — our **formal is a composite and our pink/navy
   are recolors**: our own derivatives with **no sit frames**, which would each
   have to be re-composited / re-recolored against sit sources. There is also
   **no clean per-layer side-lying animation** in mainline LPC (only the
   body-centric hurt/death collapse). So any real-asset path is incomplete and
   forces per-outfit re-derivation anyway.
3. **Every layer we use shares the identical LPC skeleton and frame
   registration.** Therefore a geometric pixel transform applied *identically* to
   body + pants + torso + hair yields layers that **still line up** — no per-layer
   hand-alignment. This is what makes self-synthesis both feasible and uniform.
4. **Side-lying needs no new pixels at all:** the LPC side (left/right) frame is a
   clean profile; rotating it 90° at runtime reads as lying on one's side.

   > Tooling note: this spec was written without web access. A *quick* check of
   > the sanderfrenken `spritesheets/` tree (Unit 1) is retained only to confirm
   > there is no drop-in sit sheet covering 100% of our layers (expected: there
   > isn't). We do **not** block on it — synthesis is the recommended path.

## Approach Comparison (chosen: synthesize)

| | Real LPC sit assets | **Self-synthesis (chosen)** |
| --- | --- | --- |
| Coverage of our layers | partial; composites/recolors absent | **100% in one pass** (run on final PNGs) |
| Alignment | per-sheet, hand-checked | **free** (same transform, shared skeleton) |
| Style consistency | mixed authors | **uniform** (one algorithm) |
| Network / reproducibility | fetch each sheet | **offline, versioned, re-runnable** |
| Polish | higher (hand-drawn) | lower (algorithmic bend) |
| New-asset licensing | fetched + re-derived | derivatives of our own CC-BY-SA layers |

**Recommendation:** synthesize per-layer **sit** sheets with an author-time
Python/PIL script in `tools/`, run over every vendored layer (including our
formal composites and recolors), written into new sheets the composer indexes.
Keep **lie** as a runtime 90° rotation of the side frame (zero new assets). The
polish gap is acceptable at a 32px tile and is the only feasible path that keeps
*all* our clothing consistent. If Unit 1 surprises us with a complete drop-in sit
set, we can swap individual synthesized sheets for the real ones later (same
`sit/` paths) — confirm that tradeoff with the user if it arises.

## Proposed Design

### A. Side-lie (runtime transform — do first, no assets)

Rotate the **profile** (left/right) standing frame 90° so the body lies
horizontal, feet along `dir`, belly toward the viewer so the face shows.

A 90°-rotated profile is **inherently horizontal**: feet end up screen-left or
-right. You cannot have feet pointing up/down with a horizontal side-lie — so
lie-seats should be authored with `dir` left/right (recommended), and up/down
reuse a pinned horizontal fallback so vertical beds don't break (documented
limitation).

Pure helper (canvas x-right, y-down; `ctx.rotate(θ)` clockwise for θ>0; feet at
local `(0,+28)`, belly at local `+x` in the `right` frame):

```
lieTransform(dir: Facing): { src: Direction; rot: number }
  left  -> { src: 'right', rot: +Math.PI/2 }   // feet left,  belly toward viewer
  right -> { src: 'left',  rot: -Math.PI/2 }   // feet right, belly toward viewer
  up    -> { src: 'right', rot: +Math.PI/2 }   // fallback: render as 'left'
  down  -> { src: 'left',  rot: -Math.PI/2 }   // fallback: render as 'right'
```

Derivation for `dir:left`,`src:'right'`,`θ=+π/2`: feet `(0,28)→(−28,0)` (left ✓),
belly `(+1,0)→(0,+1)` (down = toward viewer ✓). **This resolves the old L/R sign
bug: fix it by choosing the source side-frame (`left` vs `right`), not by flipping
the angle** — both angles keep the belly toward the viewer.

Placement: head on the pillow tile (`seat.x/y`); translate from the pillow-tile
center by `+LIE_SHIFT` along the feet vector, then draw the rotated 64px frame
centered. `LIE_SHIFT` is a single tunable px constant for pillow alignment.

### B. Sit (synthesized bent-leg frames — author-time)

**Pixel-edit method (profile thigh-bend, lossless).** For a believable bend we
derive from the **side** idle frame (col 0): row 9 for left-facing, row 11 for
right-facing. In profile the knee bend reads unambiguously, and a 90° rotation of
a pixel band is lossless (no interpolation mush).

Per-frame y-bands within the 64×64 frame — **tuned once against
`body/male_light.png` and reused for every layer** (shared skeleton):
- `HEAD_TORSO = [0, HIP_Y)` — kept upright (torso stays vertical when seated)
- `THIGH = [HIP_Y, KNEE_Y)`
- `SHIN = [KNEE_Y, ANKLE_Y)`
- `FOOT = [ANKLE_Y, 64)`
- starting estimates: `HIP_Y≈41, KNEE_Y≈49, ANKLE_Y≈58` (author tunes via the
  preview step).

Transform (identical for every layer → stays aligned):
1. Paste `HEAD_TORSO` into a fresh transparent 64×64 frame, lowered by
   `SEAT_DROP` px so the hips meet the seat.
2. Rotate the `THIGH` band 90° toward the facing direction → a horizontal thigh;
   the knee moves forward by ≈ the thigh's pixel length.
3. Paste `SHIN` vertically below the knee (shifted forward by that thigh length);
   paste `FOOT` grounded at the shin's base, feet visible.
4. Save the composed frame into a new sheet.

Honest fidelity note: profile (left/right) seated frames read well. Front/back
(`up`/`down`) seated poses can't be faked cleanly this way; generate them with a
simpler **vertical leg-squash** (compress `[HIP_Y,64)` to ~⅔ height, re-ground
feet) as a lower-fidelity fallback. **Recommend authoring sit-seats as left/right
facing** for the showcase look; keep up/down as the squash fallback, documented.

**The script** — `tools/gen_pose_sheets.py` (PIL/Pillow):
- Enumerates every vendored layer under `client/public/sprites/lpc/` (body, legs,
  torso, hair — including the formal composites and pink/navy recolors, since it
  operates on the final PNGs, so coverage is automatically total).
- For each, extracts the needed source frames, applies the transform above, and
  writes a **sit sheet** to `client/public/sprites/lpc/sit/<same relative path>`.
- Band constants + `SEAT_DROP` are module-level and documented; a `--preview`
  mode writes a few composed frames to the scratchpad for the manual tuning step.
- Deterministic, offline, re-runnable (mirrors the established author-time PIL
  recolor/composite workflow). It is **author-time only** — the app never runs
  Python; it just loads the generated PNGs.

**Composer integration (code):**
- `appearanceToLayers(a: Appearance, pose: Pose = 'stand'): string[]` — for
  `pose:'sit'` return the same filenames under the `sit/` subtree; `stand`/`lie`
  return today's URLs. Extend `ALL_LAYER_URLS` + preload to include sit layers.
- Add pure `sitFrame(dir): { row: number; col: number }` matching the sheet the
  script writes (constant, pinned by test).
- A pose-aware blit (`drawAppearance(..., pose)` or a thin `drawPosedAppearance`)
  resolves layers via `appearanceToLayers(a, pose)` and uses `sitFrame(dir)` /
  the sit sheet origin. `drawPosedSprite`'s sit branch calls it, feet-anchored
  like `drawSprite` (drop `SIT_DROP`). Feet read bent + visible on a plain chair;
  a desk in front occludes via depth (`render.ts:360`).

### Representation / protocol
**No protocol change.** `Pose` covers sit/lie; `dir` carries feet-direction; the
side-facing (belly-toward-viewer) for lie is **derived** from `dir`. Presence
payloads stay untouched and JSON-serializable.

## Scope
- In scope: `tools/gen_pose_sheets.py` + generated sit sheets; runtime side-lie
  transform; pose-aware compose/preload; pure helpers (`lieTransform`,
  `sitFrame`, pose-aware `appearanceToLayers`) + tests; CREDITS for the synthesized
  derivatives.
- Out of scope: protocol fields; multi-frame animated sit/lie (single resting
  frame is enough); new chair/bed decor art; non-light skin tones.

## Interfaces / Models
- `sprites.ts` (pure, exported, tested): `lieTransform(dir)`,
  `appearanceToLayers(a, pose?)`, `sitFrame(dir)`, sit geometry consts,
  `LIE_SHIFT`; extended `ALL_LAYER_URLS`.
- `render.ts`: rewrite `drawPosedSprite` sit + lie branches; remove `LIE_ROTATION`
  / `SIT_DROP` hacks.
- `tools/gen_pose_sheets.py`: author-time generator (not shipped to the browser).

## Impact Analysis
- Tests: `client/test/sprites.test.ts` grows (lieTransform table, pose-aware
  `appearanceToLayers`, `sitFrame`); default `pose='stand'` keeps existing URLs so
  current tests pass. Update any test asserting `SIT_DROP`/`LIE_ROTATION` (none
  found).
- Assets: new PNGs under `client/public/sprites/lpc/sit/`; CC-BY-SA 3.0
  derivatives of our own layers (same share-alike + original author chain already
  in CREDITS). Update `CREDITS.md`: note the sit sheets are algorithmic
  derivatives produced by `tools/gen_pose_sheets.py`, crediting the source layer
  authors.
- Perf: a few more preloaded sheets; negligible. `drawAppearance` already skips
  unloaded layers (`sprites.ts:232`), so a missing sit layer degrades gracefully;
  lie reuses walk layers so it never gaps.
- Reproducibility: regenerating sit sheets is one script run; no network.

## Implementation Units
Tags: **[R]** recon, **[A]** asset/tooling, **[C]** code, **[M]** manual-verify.
Side-lie (Units 1–4) is independent of sit and should land first.

1. **[C] `lieTransform` + `LIE_SHIFT`** — files: `client/src/sprites.ts` — add the
   pure helper + constant per the table. — acceptance: exported, typechecks.
2. **[C] Rewrite lie branch** — files: `client/src/render.ts` — use
   `lieTransform(dir)` (profile frame rotated, feet along `dir`, centered +
   `LIE_SHIFT`); drop `LIE_ROTATION`/`down`-frame draw. — acceptance: lie no
   longer references the `down` frame; sit/stand untouched here.
3. **[C] Lie tests** — files: `client/test/sprites.test.ts` — assert
   `lieTransform` for all four dirs (exact `src`+`rot`), locking L/R. —
   acceptance: `npx vitest run` green.
4. **[M] Lie visual check** — two tabs; left/right bed reads as side-lying, head
   on pillow, face toward viewer, L vs R correct; up/down uses the fallback
   cleanly. — acceptance: user confirms.
5. **[R] Sit asset sanity check** — files: append "Recon Findings" to this spec —
   quick GitHub `spritesheets/` check only to confirm no complete drop-in sit set
   covers all our layers (expected: none). — acceptance: one-line conclusion; do
   not block synthesis.
6. **[A] `tools/gen_pose_sheets.py`** — files: `tools/gen_pose_sheets.py` — PIL
   generator: enumerate vendored layers, apply the profile thigh-bend (left/right)
   + leg-squash (up/down) transform, write `lpc/sit/<rel path>`; module-level band
   consts + `--preview`. — acceptance: script runs offline, emits a sit sheet per
   layer, `--preview` writes tunable sample frames.
7. **[M] Tune sit bands** — adjust `HIP_Y/KNEE_Y/ANKLE_Y/SEAT_DROP` against the
   `--preview` output until the bend reads cleanly on body + a clothed combo. —
   acceptance: user approves the preview; final sheets regenerated.
8. **[A] Generate + credit sit sheets** — files: `client/public/sprites/lpc/sit/**`,
   `CREDITS.md` — run the script for the full layer set; add a CREDITS entry
   (algorithmic derivative via `tools/gen_pose_sheets.py`, CC-BY-SA 3.0, original
   authors retained). — acceptance: sit PNG per vendored layer; CREDITS updated.
9. **[C] Pose-aware compose** — files: `client/src/sprites.ts` — add `pose` to
   `appearanceToLayers` (sit→`sit/` subtree), `sitFrame(dir)`, sit geometry
   consts; extend `ALL_LAYER_URLS`/preload. — acceptance: `appearanceToLayers(a)`
   unchanged; `appearanceToLayers(a,'sit')` returns sit URLs.
10. **[C] Rewrite sit branch** — files: `client/src/render.ts` — draw the sit
    frame via the pose-aware blit, feet-anchored (drop `SIT_DROP`). — acceptance:
    sit no longer uses the lowered standing frame.
11. **[C] Sit tests** — files: `client/test/sprites.test.ts` — assert sit URL
    resolution + `sitFrame(dir)`. — acceptance: vitest green.
12. **[M] Sit visual check** — two tabs; sit shows bent legs with clothing
    present, feet visible on a plain chair, occluded at a desk. — acceptance:
    user confirms.

## Open Questions
- Sit-seat facing: author left/right for the high-fidelity profile bend, or also
  support up/down via the squash fallback? (Default: support both; profile is the
  showcase.)
- Band constants are estimates — finalized in Unit 7 against live preview.
- If Unit 5 finds a complete real sit set, swap per-sheet later (same `sit/`
  paths) — confirm the polish-vs-consistency tradeoff with the user first.
