# Decor Rotation & Flip (Map Editor) — Spec

**Status:** Draft
**Date:** 2026-10-29
**Related:** `docs/specs/furniture-depth-pose-fix.md` (DecorCell.layer, depth sort),
`docs/specs/sit-lie-poses.md` (seat `dir`, lie transform), `docs/HANDOFF.md`

## Goal
Let map authors rotate (90° steps) and mirror decor pieces while placing them, so a 2x1 bed,
rug, table or counter can be laid out horizontally or vertically. Existing maps render unchanged.

## Context & Current State
- **Model.** `DecorCell = { x, y, sheet, sx, sy, layer? }` — one 32px sheet cell drawn on one tile
  (`shared/src/map.ts:8-16`). Multi-tile furniture = several independent cells.
  `parseMap` rebuilds each cell field-by-field and keeps `layer` only when valid
  (`shared/src/map.ts:110-121`) — any new field is dropped unless explicitly passed through.
- **Seats are authored separately**, not derived from decor: `Seat { x, y, kind, dir }`
  (`shared/src/map.ts:24-29`), placed with the Seat tool via `toggleSeat` (`client/src/editor-model.ts:71-83`),
  `seatDir` chosen in a `<select>` (`client/src/editor.ts:50`, `:105-108`, `:339-342`).
  Game entry sets pose + dir from the seat (`client/src/game.ts:279-286`); lie rendering is driven
  purely by `dir` via `lieTransform` (`client/src/render.ts:135-141`). Nothing reads decor to orient a seat.
- **Editor brush.** `DecorSelection { sheet, sx, sy, w, h }` (`client/src/editor-model.ts:4-10`), picked
  by drag on the sheet canvas (`client/src/editor.ts:407-428`). `stampDecor(m, x, y, sel, block)`
  writes one cell per `(dx,dy)` at `(x+dx, y+dy)` with `sx+dx, sy+dy`, `layer: block?'object':'floor'`,
  skipping exact duplicates (same tile+sheet+sx+sy) (`client/src/editor-model.ts:31-53`).
  Placement is single-click (`apply(..., first)`, `client/src/editor.ts:529-532`).
  Hover preview is only a white outline of `w x h` (`client/src/editor.ts:494-502`) — no ghost image.
  There is **no select/edit mode** for placed decor (tools: `client/src/editor.ts:17-27`); `erase`
  removes the topmost cell on a tile (`client/src/editor-model.ts:56-65`).
  One global keydown listener (Ctrl+Z only) at `client/src/editor.ts:317-322`.
- **Rendering.** `drawDecorCell(ctx, sheet, sx, sy, px, py)` does a plain 32x32 `drawImage`
  (`client/src/decor.ts:40-51`). All decor goes through `drawDecorCellAt(ctx, cell)`
  (`client/src/render.ts:37-39`): floor layer from `drawMap` (`render.ts:31-33`), object layer
  flat in the editor (`render.ts:42-46`, called at `editor.ts:449`) and depth-sorted in game
  (`client/src/game.ts:349-362`).
- **Depth.** `decorAnchorY(cell) = cell.y + 0.5` (`client/src/depth.ts:7-9`), per cell.
- **Persistence / sync.** Maps are stored as a whole JSON blob: Supabase `maps.data jsonb`
  (`supabase/schema.sql:8`, `client/src/store.ts:47-52`) or localStorage (`store.ts:116-118`); both
  load paths run `parseMap` (`store.ts:44`, `:113`). Players load the map once on join
  (`client/src/main.ts:187`). **The map is never sent over the realtime/ws protocol** (no map type
  in `server/src` or `shared/src/protocol.ts`). So no protocol, server, or SQL change is needed —
  only `parseMap` must pass the new fields through.

## Proposed Design

### 1. Scope decision: 90° steps + mirror, no free angles
The 8 orientations of a square (rotations 0/90/180/270, each optionally mirrored) — the
dihedral group D4. **Free angles are out:**
- Cells are 32px pixel art on a tile grid. Non-90° rotation needs resampling: smoothing blurs,
  nearest-neighbour makes jagged, uneven pixels. 90° steps map pixels 1:1 (exact).
- A rotated square no longer fits its tile: it overlaps neighbours and leaves gaps; walkability
  (`tiles[]`), blocking, seats and depth anchors are all per tile.
- LPC art is drawn top-down/3-4 with baked light from the top and visible front faces. Rotating
  shows that front face sideways (90/270) or upside-down (180). Any angle only makes this worse.

**UX guidance (shown as editor hint text):** directional furniture (chairs, sofas, armchairs,
thrones) already has pre-drawn facing variants in the sheet — pick the right variant instead of
rotating. Rotation/flip is mainly for pieces that read well from above: rugs, tables, beds,
counters, flat decor. Horizontal flip is almost always safe; 90/180/270 may look odd on tall pieces.

### 2. Model
Add to `DecorCell` (shared, optional, canonical/sparse):
```ts
export type Rotation = 0 | 90 | 180 | 270;
// in DecorCell:
/** Clockwise rotation in degrees, applied after flipX. Absent = 0. */
rot?: Rotation;
/** Mirror horizontally (in the cell's own space, before rotating). Absent = false. */
flipX?: boolean;
```
- **One flip flag is enough:** vertical flip = horizontal flip + 180° rotation, so `{rot, flipX}`
  represents all 8 orientations exactly once (unique representation, easy equality).
- **Canonical form:** writers omit `rot` when 0 and `flipX` when false. `parseMap` keeps `rot` only
  when it is `90|180|270` and `flipX` only when `=== true`; anything else (0, junk, `false`) is
  dropped. Identity cells therefore serialize byte-identically to today (existing tests unchanged).
- Backward compatible: old maps have neither field → identity. JSON-serializable. No migration.

Semantics (canvas coordinates, x right, y down): a cell-local point `p` (relative to the cell
centre) is drawn at `R(rot) · F(flipX) · p`, where `F` negates x and `R(90)` maps `(x,y) → (−y, x)`
(clockwise on screen; matches `ctx.rotate(+π/2)`).

### 3. Rendering
`drawDecorCell` gains optional trailing params `rot: Rotation = 0, flipX = false`:
- Identity → existing single `drawImage` (fast path, no save/restore; most cells).
- Otherwise: `ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(px + 16, py + 16);
  ctx.rotate(rot * Math.PI / 180); if (flipX) ctx.scale(-1, 1); ctx.drawImage(img, sx*32, sy*32,
  32, 32, -16, -16, 32, 32); ctx.restore();` (use `TILE_SIZE`/`TILE_SIZE/2`, not literals).
  Canvas applies the last-specified transform to points first, so this is exactly `R·F·p`.
  `px, py` are integer multiples of 32 and the centre offset is 16 → integer pixel grid; with
  90° multiples the blit is a lossless pixel permutation.
- `drawDecorCellAt(ctx, cell)` passes `cell.rot ?? 0, cell.flipX === true`. That is the only
  render.ts change, and since every decor draw path (floor in `drawMap`, editor
  `drawObjectDecorFlat`, game depth pass `game.ts:362`) goes through it, floor, object, editor and
  game all honour the transform with no other edits.
- **Depth anchor unchanged and still correct:** rotation is applied per cell *within its own
  tile*, and multi-cell arrangements are re-laid-out on real tiles at stamp time (section 4). A
  rotated bed's cells therefore sit on the rows they actually occupy, and `decorAnchorY = y + 0.5`
  sorts them exactly like natively drawn furniture of that shape. No change to `depth.ts`/`game.ts`.

### 4. Multi-tile brushes: rotate the arrangement too
Rotating each cell in place is not enough: a 2x1 bed must become a 1x2 footprint. At stamp time,
each source cell `(dx, dy)` of a `w x h` selection is placed at a transformed offset, and every
cell carries the same `{rot, flipX}`. Pure math (new client module, tested):
```
footprint(w, h, t)  -> rot 90|270 ? {w: h, h: w} : {w, h}
transformOffset(dx, dy, w, h, t):
  if t.flipX: dx = w - 1 - dx                 // mirror first (matches render order)
  rot 0:   (dx,          dy)
  rot 90:  (h - 1 - dy,  dx)                  // footprint h x w
  rot 180: (w - 1 - dx,  h - 1 - dy)
  rot 270: (dy,          w - 1 - dx)          // footprint h x w
```
Check (2x1, `rot 90`): `(0,0)→(0,0)`, `(1,0)→(0,1)` — the west cell goes north, as a clockwise
turn should. The stamp anchor stays the **top-left of the transformed footprint** at the clicked
tile (same convention as today). The source sheet cell is unchanged (`sx+dx, sy+dy`); only the
target tile and the transform fields change.

Brush-transform composition (pure, applied to the editor's current `{rot, flipX}`):
```
rotateCW(t)  = { rot: (t.rot + 90)  % 360, flipX: t.flipX }
rotateCCW(t) = { rot: (t.rot + 270) % 360, flipX: t.flipX }
flipH(t)     = { rot: (360 - t.rot) % 360, flipX: !t.flipX }   // screen-horizontal mirror
flipV(t)     = { rot: (540 - t.rot) % 360, flipX: !t.flipX }   // = flipH then rotate 180
```
(`flipH`: `F·R(r)·F(f) = R(−r)·F(f+1)`; `flipV = R(180)·F·…`.)

### 5. Editor UX
- **Brush transform state:** `let brushT: DecorTransform = IDENTITY` in `editor.ts`. Persists across
  piece picks (so several pieces can be laid out the same way); a Reset button returns to identity.
  Changing it is not a map edit (no undo entry, no dirty flag).
- **Keyboard** (extend the listener at `editor.ts:317`; ignore when `e.target` is an
  `input`/`select`/`textarea`, or Ctrl/Meta/Alt is held):
  `R` = rotate 90° clockwise, `Shift+R` = counter-clockwise, `F` = flip horizontal,
  `V` = flip vertical. Active in the Decoration tool (and in the Seat tool, see section 6).
  Match on `e.key.toLowerCase()` + `e.shiftKey`.
- **Toolbar** in the Decoration section (`renderDecorPicker`, `editor.ts:354-361`): a row of four
  small buttons `⟲` `⟳` `⇋` `⇵` (with `title` tooltips naming the shortcut) + `Reset`, and a
  read-only label showing the current transform, e.g. `Rotation 90° · mirrored` / `No rotation`.
  Clicking a button also selects the Decoration tool (like the sheet picker does, `editor.ts:427`).
- **Hint text** under the toolbar: the section-1 guidance (directional chairs/sofas: pick the
  facing variant from the sheet; rotate/flip is for rugs, tables, beds, counters).
- **Live ghost preview:** in `draw()`'s brush-preview block (`editor.ts:494-502`), when
  `tool === 'decor' && selection && hover`, draw the brush cells (`brushCells(hover.x, hover.y,
  selection, brushT)`) via `drawDecorCellAt` at `globalAlpha ≈ 0.6`, then the white outline using
  the **transformed footprint** dims. Other tools keep the 1x1 outline.
- **Placed pieces:** the editor has no select/edit mode, so rotation/flip is **placement-only** in
  this spec. To re-orient a placed piece: erase it and stamp again (or stamp over it — see the
  duplicate rule below, which updates the transform of an identical cell on the same tile).
  A select/move/rotate tool is out of scope.

### 6. Seats / beds
Seats are authored independently of decor (Context) and a stamp has no link to any seat, so
**rotating decor does not auto-rotate seats** — there is no reliable way to know which seat
belongs to which stamped piece, and auto-mutating seats would surprise authors. Instead:
- Pure `transformFacing(dir, t)` (flip swaps left/right, then each 90° CW step maps
  `up→right→down→left→up`). Tested.
- **Seat tool shortcuts:** when `tool === 'seat'`, `R`/`Shift+R`/`F`/`V` transform `seatDir` with
  the same composition (`transformFacing(seatDir, {rot:90,flipX:false})`, etc.) and update the
  `#seat-dir` select. Authoring a vertical bed is then: stamp bed with `R`, switch to Seat/Lie,
  press `R` to turn the arrow the same way, click the pillow tile.
- **Lie / blanket logic:** lie rendering keys only off `seat.dir` (`render.ts:135-141`), so a bed
  rotated to vertical + a seat authored `up`/`down` behaves exactly like a natively vertical bed
  today (including the up/down fallback / vertical-bed blanket fix currently in progress in
  `render.ts`). No change required. **Review check:** if that blanket fix redraws bed decor cells
  over the body, it must draw them via `drawDecorCellAt(ctx, cell)` (not raw `drawDecorCell` with
  coordinates) so rotated beds re-draw rotated.

### Trade-offs considered
- `flipX` + `flipY` + `rot`: 16 combos for 8 orientations → non-unique, needs normalization for
  equality/dedupe. Rejected in favour of `rot` + `flipX`.
- Single numeric code `t: 0..7`: compact but opaque in saved JSON. Rejected.
- Storing the transform on a "piece" (group) instead of per cell: no piece entity exists; per-cell
  matches the current model and the renderer. Chosen per cell.
- Free-angle rotation: rejected (section 1).

## Scope
- **In scope:** `DecorCell.rot/flipX` + `parseMap` passthrough; pure transform/offset/facing math;
  `stampDecor` arrangement transform; transformed drawing in `drawDecorCell(At)`; editor shortcuts,
  buttons, transform label, hint, ghost preview; seat-tool `seatDir` shortcuts; tests.
- **Out of scope (explicitly):** free angles; select/move/rotate of already-placed pieces; linking
  seats to decor or auto-rotating seats; rotating in game; new art; protocol/server/SQL changes;
  changing `depth.ts`.

## Interfaces / Models / Endpoints
- `shared/src/map.ts`: `export type Rotation = 0|90|180|270;` `DecorCell.rot?: Rotation`,
  `DecorCell.flipX?: boolean`; `parseMap` canonical passthrough.
- `client/src/decor-transform.ts` (new, pure, no DOM):
  ```ts
  export interface DecorTransform { rot: Rotation; flipX: boolean }
  export const IDENTITY: DecorTransform;
  export function rotateCW(t: DecorTransform): DecorTransform;
  export function rotateCCW(t: DecorTransform): DecorTransform;
  export function flipH(t: DecorTransform): DecorTransform;
  export function flipV(t: DecorTransform): DecorTransform;
  export function footprint(w: number, h: number, t: DecorTransform): { w: number; h: number };
  export function transformOffset(dx: number, dy: number, w: number, h: number, t: DecorTransform): { dx: number; dy: number };
  export function transformFacing(dir: Facing, t: DecorTransform): Facing;
  /** Canonical fields for a DecorCell: {} for identity, else {rot?} / {flipX: true}. */
  export function transformFields(t: DecorTransform): Pick<DecorCell, 'rot' | 'flipX'>;
  export function describeTransform(t: DecorTransform): string; // UI label
  ```
- `client/src/editor-model.ts`:
  `export function brushCells(x, y, sel: DecorSelection, t: DecorTransform, layer?: 'floor'|'object'): DecorCell[]`
  (no bounds filtering; used by both stamp and ghost);
  `stampDecor(m, x, y, sel, block, t: DecorTransform = IDENTITY)` — default keeps all current callers/tests.
  Duplicate rule: a cell matching tile+sheet+sx+sy is not pushed again; its `rot`/`flipX` are
  replaced by the new canonical fields (deleted when identity). `layer`/blocking behaviour unchanged.
- `client/src/decor.ts`: `drawDecorCell(ctx, sheet, sx, sy, px, py, rot: Rotation = 0, flipX = false)`.
- `client/src/render.ts`: `drawDecorCellAt` passes the cell transform (one line).

## Impact Analysis
- **Tests:** none break — identity is omitted from cells, `stampDecor`'s new param is defaulted,
  `parseMap` output for old cells is unchanged (`shared/test/map.test.ts:57-71`,
  `client/test/editor-model.test.ts:24-37`). New: `shared/test/map.test.ts` (passthrough/
  validation), `client/test/decor-transform.test.ts` (composition, offsets, facing, fields),
  `client/test/editor-model.test.ts` (rotated stamp + duplicate-update).
- **Layers:** shared model (field + parse), client pure module, editor model, decor/render draw,
  editor UI. Game, depth, server, protocol, store, SQL untouched.
- **Compat / rollout:** old maps identical. A map saved with rotated cells and opened by an older
  client build: its `parseMap` drops the unknown fields → pieces show unrotated (graceful). Single
  deploy, so not a concern in practice.
- **Performance:** identity fast path keeps the common case at one `drawImage`; transformed cells add
  save/translate/rotate/restore — negligible at map sizes ≤ 80x80.
- **Failure modes:** unloaded sheet still no-ops (`decor.ts:49`); junk `rot` in stored JSON is
  dropped by `parseMap`; a rotated stamp partially out of bounds skips off-map cells like today.
- **Concurrency:** `client/src/render.ts` is being edited for the vertical-bed blanket fix. Only
  **U5** touches it (one line); do U5 after that fix lands. U1–U4 don't touch render.ts or HANDOFF.

## Implementation Units
1. **Model + parseMap** — files: `shared/src/map.ts`, `shared/test/map.test.ts` — add `Rotation`,
   `DecorCell.rot?`, `DecorCell.flipX?` (doc comments per section 2); in `parseMap`'s decor `.map`
   keep `rot` only if `90|180|270`, `flipX` only if `=== true`. Tests: valid rot/flip kept; `rot:0`,
   `rot:45`, `rot:'90'`, `flipX:false`, `flipX:'yes'` dropped; existing layer test still exact.
   — acceptance: `npm test` green; `npm run build` green.
2. **Transform math (pure)** — files: `client/src/decor-transform.ts` (new),
   `client/test/decor-transform.test.ts` (new) — `DecorTransform`, `IDENTITY`, `rotateCW/CCW`,
   `flipH/V`, `footprint`, `transformOffset` exactly per section 4. Tests: rotateCW x4 = identity;
   rotateCW∘rotateCCW = identity; flipH x2 and flipV x2 = identity; flipH∘flipV = rot 180;
   all 8 orientations reachable; 2x1 under rot 90 → footprint 1x2 and offsets (0,0),(0,1);
   2x3 under each of the 8 transforms maps offsets bijectively into the footprint; flipX on 3x1
   reverses. — acceptance: vitest green; typecheck green.
3. **Facing + fields + label (pure)** — files: `client/src/decor-transform.ts`,
   `client/test/decor-transform.test.ts` — `transformFacing`, `transformFields`,
   `describeTransform`. Tests: rot 90 maps up→right→down→left→up; flipX swaps left/right, keeps
   up/down; flipV keeps left/right, swaps up/down; `transformFields(IDENTITY)` is `{}`;
   `{rot:0,flipX:true}` → `{flipX:true}`. — acceptance: vitest green.
4. **Stamp with transform** — files: `client/src/editor-model.ts`, `client/test/editor-model.test.ts`
   — add `brushCells` (target tile = `(x,y) + transformOffset`, source `sx+dx, sy+dy`,
   `...transformFields(t)`, optional `layer`); `stampDecor` gains `t = IDENTITY`, iterates
   `brushCells`, keeps in-bounds/blocking logic, applies the duplicate rule (update transform in
   place). Tests: 2x1 stamped with rot 90 at (1,1) → cells at (1,1) `sx:4` and (1,2) `sx:5`, both
   `rot:90`, blocking (1,1),(1,2); identity stamp output unchanged (existing test); re-stamping the
   same cell with flip updates `flipX` without adding a cell; JSON round-trip through `parseMap`
   equals the map. — acceptance: vitest green.
5. **[M] Transformed drawing** — files: `client/src/decor.ts`, `client/src/render.ts` — **start only
   after the vertical-bed blanket fix in render.ts has landed.** `drawDecorCell` optional
   `rot, flipX` with identity fast path and save/translate/rotate/scale/restore otherwise
   (section 3); `drawDecorCellAt` passes `cell.rot ?? 0, cell.flipX === true`. — acceptance:
   typecheck/build/tests green; a hand-edited map cell with `rot:90` draws rotated in editor and game.
6. **[M] Editor transform state, shortcuts, toolbar** — files: `client/src/editor.ts` — `brushT`
   state; buttons ⟲ ⟳ ⇋ ⇵ + Reset + label (`describeTransform`) + hint text in
   `renderDecorPicker`; keydown R / Shift+R / F / V with the input/modifier guard; pass `brushT`
   to `stampDecor` in `apply`. Update label + `draw()` on change. — acceptance: typecheck green;
   pressing keys updates the label; typing "r" in the map-name field does nothing.
7. **[M] Ghost preview** — files: `client/src/editor.ts` — brush block in `draw()` renders
   `brushCells(hover.x, hover.y, selection, brushT)` via `drawDecorCellAt` at alpha ~0.6, outline
   uses `footprint(selection.w, selection.h, brushT)`. — acceptance: hovering shows the
   rotated/mirrored piece exactly where a click will stamp it.
8. **[M] Seat-tool direction shortcuts** — files: `client/src/editor.ts` — when `tool === 'seat'`,
   R / Shift+R / F / V update `seatDir` via `transformFacing` and sync the `#seat-dir` select (the
   Decoration-tool branch from U6 stays as is); add one sentence to the lie hint ("Rotated a bed?
   Press R here to turn the arrow the same way."). — acceptance: in Seat tool, R cycles the select
   down→left→up→right; badges reflect the chosen dir.
9. **[M] Manual verification** — no code. Checklist:
   1. Pick a 2x1 bed, press R: ghost shows a vertical 1x2 bed; click stamps it there; Shift+R back.
   2. F mirrors a rug/table; V mirrors vertically; R x4 and F x2 return to the original.
   3. Pixels stay crisp at zoom 2 (no blur, no 1px seams between rotated cells).
   4. "Block tiles" ON → rotated table occludes avatars correctly in game (object layer depth);
      OFF → rotated rug stays under avatars.
   5. Vertical bed + Lie seat set with R (arrow down/up) → lying works like a native vertical bed.
   6. Save, reload editor, open in game: transforms persist; an old map looks unchanged.
   7. Typing R/F/V in the map name field does not change the brush.

U1–U4 are covered by Vitest; U5–U9 are manual-verify [M] (plus typecheck/build).

## Open Questions
- None blocking. Assumption: transform persists across piece picks (Reset button available); flip
  if users find it surprising.
- If a select/rotate tool for placed pieces is wanted later, it can reuse `transformOffset` around
  the piece's bounding box — separate spec.
