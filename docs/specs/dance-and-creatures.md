# Dance & Creatures (Orc, Skeleton) — Spec

**Status:** Draft
**Date:** 2026-10-29
**Related:** `docs/specs/sit-lie-poses.md`, `docs/specs/avatar-wardrobe.md`, `docs/specs/avatar-editor*.md`, `docs/HANDOFF.md`

## Goal
(a) A **dance** pose: press Q (or a button) and your avatar loops a short dance that everyone
sees. (b) **Orc** and **Skeleton** characters from the same LPC source we already vendor
(`jrconway3/Universal-LPC-spritesheet`), wearing the existing clothes/hair or going bare.

## Context & Current State
- **Pose model:** `shared/src/protocol.ts:13` `type Pose = 'stand' | 'sit' | 'lie'`; carried as
  optional `pose`/`dir` in `PeerState` (`:33-34`), `PositionMsg` (`:57-58`), `PeerMovedMsg`
  (`:105-106`). Server stores/relays it unvalidated (`server/src/room.ts:15-20`,
  `server/src/index.ts:84-90`); Supabase transport passes it through
  (`client/src/net-supabase.ts:114-116,229,257-261,339-340`). So widening the union needs no
  transport change.
- **Game:** `client/src/game.ts` — self `pose` (`:100`), E key → `toggleSeat` (`:272-276`,
  `:288-298`), moving stands up (`:223`), broadcast sends `pose`+`dir` only when not standing
  (`:248-256`), remote pose jump (`:194-201`), remotes walk-animate only when standing (`:239`),
  `freeSeatNearby` treats *any* non-stand remote at a seat centre as occupying it (`:283`),
  `drawCharacter` → `drawPosedSprite(..., walkFrameIndex(...), x, y)` (`:400`). Seat button
  `#seat-btn` created at `:103-107`, label logic `:309-320`, CSS `client/index.html:43-47`.
- **Render:** `client/src/render.ts:128-160` `drawPosedSprite` — `stand` → `drawSprite`, `sit` →
  `drawSitAppearance`, **anything else falls into the lie branch** (relevant: an unknown pose
  renders lying down; we normalize incoming poses, see U5).
- **Sprites:** `client/src/sprites.ts` — `FRAME_SIZE=64` (`:7`), `WALK_ROW` up/left/down/right =
  8/9/10/11 (`:14-19`), `appearanceToLayers(a, pose)` body/legs/torso/hair with `sit` →
  `/sprites/lpc/sit/` subtree, `stand`/`lie` → walk sheets (`:81-93`); body file is
  `${body}_light.png` (`:87`); `blitLayers` (`:299-313`); `drawSitAppearance` (`:328-337`);
  `CATEGORIES` with function-form options (`:60-75`); `PRESETS` (`:104-113`);
  `ALL_LAYER_URLS` (`:118-133`); `normalizeAppearance`/`serializeAppearance`/`parseAppearance`/
  `shuffleAppearance` (`:142-184`). `body` doubles as the **sex** suffix of legs/torso/hair files.
- **Editor:** `client/src/main.ts:66-148` generic arrow cycling over `CATEGORIES` via
  `optionsFor`, with an inline outfit→torso clamp (`:126-132`); presets (`:143-148`).
- **Sit sheets:** `tools/gen_pose_sheets.py` globs every PNG in `lpc/{body,legs,torso,hair}`
  (`:111-112`) and writes `lpc/sit/<same path>` (`:115-121`) — **new body PNGs get sit sheets
  with no code change**; only `PREVIEW_COMBOS` (`:124-138`) needs creature entries.
- **Licensing:** `client/public/sprites/LICENSE/AUTHORS.txt` credits **orc** to Marcel van de
  Steeg (`:68-75`; orc heads adapted from Stephen Challener's material, `:145`) and the skeleton
  base animations **Walkcycle, Hurt, Slash, Spellcast** to Johannes Sjölund (`:55-61`; also
  "bow/arrow (skeleton)"). **No Thrust is credited for the skeleton** → the skeleton's thrust
  rows are probably empty, so the dance must not use thrust rows.
- LPC universal sheet rows (832x1344, 13x21 frames of 64px): 0-3 spellcast (7 frames),
  4-7 thrust (8), 8-11 walk (9, col 0 = stand), 12-15 slash (6), 16-19 shoot (13), 20 hurt (6).
  Each block is ordered up/left/down/right.

## Proposed Design

### 1. Creatures — a new `skin` axis (not new Body values)
`body` stays the **sex** (`male | female`), because every legs/torso/hair file is keyed by it
(`sprites.ts:88-91`). New axis **`skin: 'light' | 'orc' | 'skeleton'`** selects the body sheet:
`lpc/body/${body}_${skin}.png` — the existing files are already named `male_light.png` /
`female_light.png`, so the light case is byte-identical. LPC ships orc/skeleton as body colour
variants next to `light.png` (`body/male/orc.png` etc.), so "Skin" is the natural label.

*Rejected:* widening `body` to `male|female|orc|orc_female|skeleton` — every layer path would
need a `sexOf(body)` indirection and the editor axis would mix sex and species.

**Sex variants (assumed; U1 confirms):** `body/male/orc.png`, `body/female/orc.png`,
`body/male/skeleton.png`; **no female skeleton**. Rule, pure `skinsFor(body)`:
`male → ['light','orc','skeleton']`, `female → ['light','orc']` (if U1 finds a female skeleton,
add it; if no female orc, `female → ['light']`). Red orc / other bodies: out of scope.

**Clothes & hair on creatures:** allowed. The orc/skeleton sheets share the human frame
registration for their sex (same rows, same skeleton), so existing male/female legs/torso/hair
layers line up. Plus a new **bare** option so a skeleton can look like a skeleton:
`outfit` widens to `'casual' | 'business' | 'none'`; `'none'` omits **both torso and legs**
layers and is offered only for creatures (`outfitsFor(skin)`: `light → ['casual','business']`,
otherwise all three). Humans never go bare. `outfitTorso('none')` returns `CASUAL_TORSO`
(the stored `torso`/`legs` values are kept but not drawn).

**Cross-axis clamp, one place:** new pure `fitAppearance(a)`:
1. `skin ∉ skinsFor(body)` → `'light'`;
2. `outfit ∉ outfitsFor(skin)` → `'casual'`;
3. `outfit !== 'none'` and `torso ∉ outfitTorso(outfit)` → `outfitTorso(outfit)[0]`.
`appearanceToLayers` starts with `const f = fitAppearance(a)` (this subsumes today's torso
clamp at `:84-85`; behaviour for existing appearances unchanged). `normalizeAppearance` stays
field-level only (coerce each field; `skin` missing/junk → `'light'`), so existing normalize
tests keep their meaning. The editor calls `fitAppearance` after every change (replacing the
inline clamp at `main.ts:126-132`).

**Editor (`main.ts`, generic loop unchanged):** `CATEGORIES` becomes Body, **Skin**
(`options: (a) => skinsFor(a.body)`), Hair, Outfit (`options: (a) => outfitsFor(a.skin)`), Top,
Pants. After a change: `appearance = fitAppearance(appearance)`. Convenience default: when the
**Skin** arrow lands on `skeleton`, also set `hair: 'none'` and `outfit: 'none'` (the user can
cycle them back). When `outfit === 'none'`, the Top and Pants rows get class `disabled` (dimmed,
arrows still harmless). Two new presets: `orc` "Orc" `{male, orc, hair none, casual, brown,
teal}` and `skel` "Skeleton" `{male, skeleton, hair none, outfit none, torso teal, legs teal}`.

**Serialization:** `body.hair.outfit.torso.legs.skin` — `skin` appended **last** so 4- and
5-part legacy strings still parse (`skin` → `'light'`). **Shuffle:** body → `skinsFor(body)` →
hair → `outfitsFor(skin)` → `outfitTorso(outfit)` → legs (uniform picks).

**Assets:** vendored verbatim to `client/public/sprites/lpc/body/{male_orc,female_orc,
male_skeleton}.png` (832x1344). Sit sheets generated by the unchanged `gen_pose_sheets.py`
pipeline into `lpc/sit/body/`. Lie (side + tucked) reuses the standing walk sheets
automatically (`appearanceToLayers(a, 'lie')` = stand). Credits: new CREDITS.md section.

### 2. Dance — a looping 16-step sequence from existing rows
LPC has no dance; we choreograph one from **spellcast** (arms out/up), **walk** (turns and
steps) and **slash** (arm swings). Thrust/shoot/hurt are not used (skeleton gaps, weapons).
`DANCE_FRAME_MS = 125` (8 fps), 16 steps → `DANCE_LOOP_MS = 2000`.

Offsets are whole pixels added to the normal feet-anchored destination: `dx` (+ = right, sway),
`dy` (− = up, bob). The name label, bubble and depth anchor do **not** move.

| Step | anim | dir | col | row | dx | dy | fallback (anim dir col) |
|---|---|---|---|---|---|---|---|
| 0 | walk | down | 0 | 10 | 0 | 0 | — |
| 1 | cast | down | 2 | 2 | -1 | -1 | walk down 1 |
| 2 | cast | down | 3 | 2 | 0 | -2 | walk down 0 |
| 3 | cast | down | 2 | 2 | +1 | -1 | walk down 5 |
| 4 | walk | right | 0 | 11 | +1 | 0 | — |
| 5 | walk | up | 0 | 8 | 0 | -1 | — |
| 6 | walk | left | 0 | 9 | -1 | 0 | — |
| 7 | walk | down | 0 | 10 | 0 | -1 | — |
| 8 | slash | left | 1 | 13 | -2 | 0 | walk left 2 |
| 9 | slash | left | 3 | 13 | -2 | -1 | walk left 6 |
| 10 | slash | right | 1 | 15 | +2 | 0 | walk right 2 |
| 11 | slash | right | 3 | 15 | +2 | -1 | walk right 6 |
| 12 | cast | down | 4 | 2 | 0 | -2 | walk down 0 |
| 13 | cast | down | 5 | 2 | 0 | -1 | walk down 0 |
| 14 | walk | down | 3 | 10 | -1 | 0 | — |
| 15 | walk | down | 7 | 10 | +1 | -1 | — |

Reading: arm pump (1-3), a full spin on standing frames (4-7), left/right arm swings with sway
(8-11), arms high (12-13), two bouncy steps (14-15). Rows come from
`ANIM_ROW = { cast: {up:0,left:1,down:2,right:3}, walk: WALK_ROW, slash: {up:12,left:13,down:14,right:15} }`;
bounds `ANIM_FRAMES = { cast: 7, walk: 9, slash: 6 }`.

**Fallback rule (resolved by U1 data, not by taste):** U1 measures every vendored layer + the
new creature bodies at every (row, col) above. If any layer that has pixels in its walk-down
standing frame (row 10 col 0) has **zero** opaque pixels at a step's frame (e.g. a garment drawn
only for walking), that step ships with its **fallback** column instead (the `dy`/`dx` stay).
If a *body* sheet is empty at a frame, same rule. U1 records which steps (if any) fall back;
U4 encodes the final table.

**Phase / sync:** the step is a pure function of a millisecond clock:
`danceStep(ms) = DANCE_STEPS[mod(floor(ms / DANCE_FRAME_MS), 16)]` (positive modulo;
non-finite `ms` → step 0). The game passes **`Date.now()`** — a shared wall clock — so every
dancer on every screen is on the same beat with no protocol field (clock skew of tens of ms is
invisible at 8 fps). This also delivers the "nearby dancers sync" stretch for free.
*Rejected:* a `danceStart` timestamp in the protocol (more fields, same visual result).

**Trigger & rules (`game.ts`):**
- **Q** (case-insensitive, no repeat, ignored when focus is in an input/textarea/select) or the
  new **`#dance-btn`** toggles `self.pose` between `'dance'` and `'stand'`.
- Not while seated: Q / the button do nothing while `this.seat` is set, and the dance button is
  hidden while seated.
- Not sitting while dancing: `toggleSeat` returns early when `self.pose === 'dance'`, and the
  seat button is hidden while dancing.
- Any movement input (keyboard or touchpad) while dancing sets `pose = 'stand'` before the
  movement step of the same frame.
- Dance button label: `Dance (Q)` / `Stop dancing (Q)`; stacked above the seat button
  (desktop `bottom: 64px`, coarse pointers `bottom: 268px`), same look as `#seat-btn`.
- Broadcast unchanged: the existing "pose ≠ stand → send pose + dir" path sends `'dance'`.
- `freeSeatNearby` counts only `sit`/`lie` remotes as occupying a seat (a dancer standing on a
  seat tile must not lock it).
- Incoming poses are normalized: `normalizePose(x)` → one of `POSES`, unknown → `'stand'`
  (in `makeRemote` and the `peer-moved` handler), so a future/garbage pose never renders lying.

**Render:** `drawPosedSprite(ctx, a, pose, dir, col, x, y, nowMs = 0)` gains a `dance` branch
(before the lie code): `drawDanceAppearance(ctx, a, nowMs, px - FRAME_SIZE/2, py - FRAME_SIZE + FOOT_OFFSET)`,
which blits `appearanceToLayers(a)` (stand sheets) at `danceStep(nowMs)` row/col shifted by
`dx`/`dy`. `game.ts` `drawCharacter` passes `Date.now()`. Depth sort, names, bubbles, rings:
untouched.

**Compatibility:** pre-update clients render a remote `'dance'` as lying (their render falls
into the lie branch) and a remote creature as a light human (`skin` ignored, `outfit 'none'` →
casual). Friends-only, pre-release: everyone reloads; accepted.

## Scope
- In: `skin` axis (light/orc/skeleton) with sex rules, bare outfit for creatures, 2 presets,
  editor Skin row, creature sit sheets, credits; `dance` pose (Q + button), synced by wall
  clock; normalizePose; tests.
- Out: red orc / goblin / other bodies; creature-specific clothes; per-body sit tuning
  constants; dance music/emotes; alternative dances; dancing while seated; editor dance preview.

## Interfaces / Models / Endpoints
```ts
// shared/src/protocol.ts
export const POSES = ['stand', 'sit', 'lie', 'dance'] as const;
export type Pose = (typeof POSES)[number];
export function normalizePose(x: unknown): Pose; // unknown/undefined -> 'stand'
export interface Appearance {
  body: 'male' | 'female';
  hair: 'brown' | 'black' | 'blonde' | 'none';
  outfit: 'casual' | 'business' | 'none';      // 'none' = bare (creatures only)
  torso: ...unchanged; legs: ...unchanged;
  skin: 'light' | 'orc' | 'skeleton';          // body sheet
}

// client/src/sprites.ts
export const SKIN = ['light', 'orc', 'skeleton'] as const;
export const OUTFIT = ['casual', 'business', 'none'] as const;
export function skinsFor(body: Appearance['body']): readonly Appearance['skin'][];
export function outfitsFor(skin: Appearance['skin']): readonly Appearance['outfit'][];
export function fitAppearance(a: Appearance): Appearance;
export type DanceAnim = 'cast' | 'walk' | 'slash';
export interface DanceStep { anim: DanceAnim; dir: Direction; col: number; dx: number; dy: number }
export const DANCE_FRAME_MS = 125;
export const ANIM_ROW: Record<DanceAnim, Record<Direction, number>>;
export const ANIM_FRAMES: Record<DanceAnim, number>;
export const DANCE_STEPS: readonly DanceStep[];           // the table above (16 entries)
export const DANCE_LOOP_MS: number;                        // DANCE_STEPS.length * DANCE_FRAME_MS
export function danceStep(ms: number): DanceStep & { row: number };
export function drawDanceAppearance(ctx, a: Appearance, ms: number, destX: number, destY: number): void;

// client/src/render.ts
export function drawPosedSprite(ctx, a, pose, dir, col, x, y, nowMs = 0): void;
```
Files: `client/public/sprites/lpc/body/{male_orc,female_orc,male_skeleton}.png` and
`client/public/sprites/lpc/sit/body/{male_orc,female_orc,male_skeleton}.png` (names adjusted to
U1 results).

## Impact Analysis
- **Tests that change:** `client/test/sprites.test.ts` — appearance literals gain `skin`
  (legacy-parse expectation `:218`, shuffle bounds `:248-256` now end on `female/orc/none`),
  preset count 8 → 10, `CATEGORIES` order. `server/test/room.test.ts` and
  `client/test/net-supabase.test.ts` appearance fixtures gain `skin: 'light'`.
- **New tests:** `shared/test/protocol.test.ts` (normalizePose); dance (`danceStep` timing, wrap,
  negative, NaN, bounds, layers = stand); pose transport (`net-supabase` peer-moved carries
  `pose:'dance'`+`dir`; `room.test` stores `'dance'`); creatures (`appearanceToLayers` orc /
  skeleton / bare / female-skeleton clamp, `fitAppearance`, normalize/parse fallbacks, 6-part
  round-trip, shuffle validity, `ALL_LAYER_URLS` contains creature stand + sit bodies and every
  URL exists on disk — the existing `lists only real vendored files` test guards the assets).
- **Layers:** shared protocol (types + 1 pure fn), client sprites/render/game/main, index.html
  CSS, assets + credits, author-time preview combos. Server: none (fixture only).
- **Perf:** `ALL_LAYER_URLS` grows by 3 body sheets + 3 sit sheets (the editor preloads all);
  negligible. Dance adds one `Date.now()` per frame.
- **Licensing:** orc (Marcel van de Steeg, from Stephen Challener), skeleton (Johannes Sjölund
  animations; original skeleton art per AUTHORS) — CC-BY-SA 3.0 / GPL 3.0, verbatim; creature sit
  sheets are CC-BY-SA derivatives like the existing ones.
- **Failure modes:** missing creature PNG → `blitLayers` skips it (invisible body, clothes still
  drawn) and the existence test fails in CI; empty dance frame in a layer → handled by the U1
  fallback rule.

## Implementation Units
Run `npm test` after each; client typecheck + build after U3+. Commit per unit or per group as
usual (`feat(avatar): ...`).

1. **Recon (author-time, no committed code)** — files: none (scratch script in the session
   scratchpad). Change: (a) list via GitHub API
   `https://api.github.com/repos/jrconway3/Universal-LPC-spritesheet/contents/body/male?ref=master`
   and `.../contents/body/female?ref=master` (and `.../contents/body?ref=master`); record exact
   orc/skeleton file names and whether female variants exist; download candidates to scratch and
   verify PNG 832x1344. (b) Pillow script: for every PNG in `client/public/sprites/lpc/{body,legs,torso,hair}`
   plus the creature candidates, count opaque pixels at each dance (row, col) of the table and at
   (10, 0); print a gap list per the fallback rule. (c) Also check the creature sheets' rows
   8-11 col 0 match the human head/feet registration (opaque bbox of `male_light` vs creature at
   (10,0) within ±2px). Acceptance: report with final file list, `skinsFor` sex rule, and the
   list of dance steps that must use their fallback (possibly none).
2. **Vendor creature bodies + sit sheets + credits** — files:
   `client/public/sprites/lpc/body/{male_orc,female_orc,male_skeleton}.png` (verbatim, per U1),
   generated `client/public/sprites/lpc/sit/body/*` (run `python tools/gen_pose_sheets.py`),
   `tools/gen_pose_sheets.py` (`PREVIEW_COMBOS` += `orc_male` [orc body + teal casual + no hair]
   and `skeleton` [bare skeleton body]; docstring mentions creature bodies),
   `client/public/sprites/CREDITS.md` (new "Creature bodies" table: file, LPC source path,
   authors from AUTHORS.txt; sit section lists the 3 new derivatives). Acceptance: `git status`
   shows only the new files + the two edits (if regeneration rewrote existing sit sheets with
   different bytes, restore them); `--preview` PNGs for the creatures look seated (attach path
   in report).
3. **Pose 'dance' + normalizePose** — files: `shared/src/protocol.ts` (`POSES`, `Pose` derived,
   `normalizePose`, doc comment), new `shared/test/protocol.test.ts`, `server/test/room.test.ts`
   (+1: `updatePosition(..., 'dance', 'down')` is stored and returned),
   `client/test/net-supabase.test.ts` (+1: position with `pose:'dance', dir:'down'` → other side's
   `peer-moved` carries both). Acceptance: tests green; all typechecks green.
4. **Dance model (pure) + tests** — files: `client/src/sprites.ts` (`DanceAnim`, `DanceStep`,
   `DANCE_FRAME_MS`, `ANIM_ROW`, `ANIM_FRAMES`, `DANCE_STEPS` per the table with U1 fallbacks
   applied, `DANCE_LOOP_MS`, `danceStep`, `drawDanceAppearance` via `blitLayers`),
   `client/test/sprites.test.ts` (danceStep(0)/(124) = step 0 `{row:10,col:0}`; (125) = step 1
   `{row:2,col:2,dx:-1,dy:-1}` (or its fallback); (2000) = step 0; (-125) = step 15; (NaN) = step 0;
   every step `col < ANIM_FRAMES[anim]`, `row < 21`, `|dx| ≤ 2`, `-2 ≤ dy ≤ 0`; `DANCE_LOOP_MS`
   = 2000; `appearanceToLayers(a, 'dance')` equals stand). Acceptance: tests green.
5. **Render dance + remote normalization** — files: `client/src/render.ts` (`nowMs` param,
   `dance` branch before the lie code), `client/src/game.ts` (`drawCharacter` passes
   `Date.now()`; `makeRemote` and `peer-moved` use `normalizePose`). Acceptance: typecheck +
   build green; a remote sending `'dance'` animates (verified in U9).
6. **Dance controls** — files: `client/src/game.ts` (`danceBtn` created/removed like `seatBtn`;
   `toggleDance()`; `onKey` handles `q`; movement input ends the dance in `frame` before the seat
   check; `toggleSeat` early-returns while dancing; `updateSeatButton` hides while dancing and
   also updates the dance button label/visibility (hidden while seated); `freeSeatNearby`
   predicate → `r.pose === 'sit' || r.pose === 'lie'`), `client/index.html` (`#dance-btn`
   shares `#seat-btn` styles; `bottom: 64px`, coarse `bottom: 268px`). Acceptance: typecheck +
   build green; manual in U9.
7. **Creature appearance model** — files: `shared/src/protocol.ts` (`Appearance.skin`, `outfit`
   + `'none'`), `client/src/sprites.ts` (`SKIN`, `OUTFIT` + `'none'`, `skinsFor`, `outfitsFor`,
   `outfitTorso('none')` → casual palette, `fitAppearance`, `appearanceToLayers` uses it: body
   `${body}_${skin}.png`, `outfit 'none'` omits legs + torso; `CATEGORIES` with Skin + function-
   form Outfit; `PRESETS` all gain `skin:'light'` + `orc` + `skel`; `ALL_LAYER_URLS` iterates
   body → `skinsFor` → hair → legs → `outfitsFor` → torso), fixtures in `server/test/room.test.ts`,
   `client/test/net-supabase.test.ts`. Acceptance: all typechecks + build green; existing
   `lists only real vendored files` test green (proves U2 assets match).
8. **Creature normalize / serialize / parse / shuffle + tests** — files: `client/src/sprites.ts`
   (`normalizeAppearance` coerces `skin` → `'light'` fallback; 6-part serialize with `skin` last;
   parse accepts 4/5/6 parts; shuffle order per design), `client/test/sprites.test.ts` (update
   literals listed in Impact; new: orc/skeleton/bare layers, female+skeleton → light,
   light+outfit none → casual, bare skeleton = body (+hair) only, `skin:'alien'` → light,
   `'male.none.none.teal.teal.skeleton'` round-trip, 5-part legacy → light, shuffle always
   `fitAppearance`-stable, `ALL_LAYER_URLS` has creature stand + sit body URLs, 10 presets valid).
   Acceptance: tests green.
9. **Editor Skin row + manual checks [M]** — files: `client/src/main.ts` (after each arrow /
   shuffle / preset: `appearance = fitAppearance(appearance)` replacing the inline clamp; Skin →
   skeleton also sets `hair:'none', outfit:'none'`; toggle `disabled` class on the `torso`/`legs`
   axis rows when `outfit === 'none'`), `client/index.html` (`.axis.disabled { opacity: .4 }`).
   Acceptance: typecheck + build green; manual checklist below run in the browser.

### Manual checks (U9, browser, two tabs)
1. Editor: Skin row cycles Light → Orc → Skeleton for male, Light → Orc for female; switching a
   male skeleton to female falls back to Light. Choosing Skeleton makes it bald and bare; Top/Pants
   dim; Outfit can go back to casual/business (clothes fit the skeleton). Orc and Skeleton
   presets work. Reload restores the creature.
2. In world: orc and skeleton walk in 4 directions with clothes/hair aligned; sit on a chair
   (profile + front), lie on a left/right bed and an up/down bed (tucked).
3. Press Q: the avatar dances (arm pump, spin, swings, arms up, steps), crisp, small bob/sway,
   name label steady. Button shows "Stop dancing (Q)". Q again or WASD stops it.
4. While dancing, no seat button and E does nothing; while seated, no dance button and Q does
   nothing.
5. Second tab sees the dance; two dancers in two tabs move on the same beat. Stop → the other tab
   sees standing/walking again. A dancer on a chair tile does not block sitting there.
6. Dance in every outfit (casual M/F, business M/F, bare skeleton, clothed orc): no layer pops
   out (e.g. a shirt vanishing on one step) — if one does, apply that step's fallback.
7. Phone: dance button sits above the seat button, clear of the touchpad and media controls.

## Open Questions
- Female skeleton / female orc existence (U1 decides `skinsFor`; defaults stated above).
- If creature sit previews look broken (skeleton thigh band is thin), accept for now; per-body
  constants in `gen_pose_sheets.py` would be a follow-up.
- Shuffle picks creature skins uniformly (2/3 of male shuffles are creatures). If that feels
  too frequent, weight `light` higher later.
