# Object Footprint (base row blocks, base row sorts) — Spec

**Status:** Approved
**Date:** 2026-10-29
**Related:** `docs/specs/furniture-depth-pose-fix.md` (layers, depth sort), `docs/specs/decor-rotation.md`
(transforms), `docs/HANDOFF.md` (picker selects the whole object)

## Goal
A desk 3 cells wide whose 3/4 top-down art is 2 rows tall (desktop + drawer front) should take up
a 1x3 **footprint**: only its bottom (base) row blocks walking, and the whole desk depth-sorts by
that base row. Then an avatar standing in the row behind it is hidden behind the desk, and one in
front draws over it. The picture stays 2 rows tall, because pixel art can't shrink.

## Context & Current State
- `DecorCell {x,y,sheet,sx,sy,layer?,rot?,flipX?}` — `shared/src/map.ts:11-23`. `parseMap` rebuilds
  each cell field by field, so unknown fields are dropped (`shared/src/map.ts:123-129`).
- `decorLayer` = `cell.layer ?? (wall under it ? 'object' : 'floor')` (`shared/src/map.ts:148-150`).
- `brushCells(x,y,sel,t,layer?)` puts each source cell on its transformed offset
  (`client/src/editor-model.ts:32-49`). `stampDecor(m,x,y,sel,block,t)` writes
  `layer: block?'object':'floor'` and blocks **every** covered tile when `block`
  (`client/src/editor-model.ts:56-79`). A duplicate (same tile, sheet, sx, sy) only gets its transform
  updated (`:70-73`).
- Editor: `let blockDecor = true` (`client/src/editor.ts:85`); checkbox `#block-decor` "Block tiles
  under it" (`:419-420`, listener `:432-434`); the ghost preview is `brushCells(hover…)` at alpha 0.6
  plus a white footprint outline (`:622-636`); stamping happens at `:665`. The wall overlay is red
  `rgba(220,60,60,0.28)` with an X (`:577-596`).
- Depth: `decorAnchorY(cell) = cell.y + 0.5` (`client/src/depth.ts:7-9`), avatar anchor = feet `y`,
  ties draw decor first (`:25-34`). `game.ts:352-353` pushes each object-layer cell with
  `decorAnchorY(d)`. Each cell sorts by its own row, so the desk's top row (anchor `y0+0.5`) draws
  under an avatar at `y0+0.7`, which is wrong once that row is walkable.
- Collision only checks tiles: `movement.ts:36-37` → `isWalkable` → `tileAt === 0`. Decor is never
  checked, so unblocking a tile makes it walkable with no other change. Seats are tiles
  (`seatAt`), and decor doesn't affect them.

## Proposed Design

### 1. Model: `DecorCell.baseDy?: number`
`baseDy` = how many rows down from this cell the object's base row is, in screen/map space after
the transform. It is omitted when 0. A 2-row desk stamped at row `y0`: the top cells get
`baseDy: 1`, and the base cells get no field.

- **Why per-cell offset, not an object id/group:** depth needs it per cell (`decorAnchorY(cell)`),
  so there's no lookup or group table. Erasing works per cell, with no dangling group to maintain.
  JSON stays flat and old maps stay valid. A group id would need a resolver pass on every render and
  would break when one cell of the group is erased.
- **Backward compatible:** old cells have no `baseDy` and anchor at `y+0.5` as today.
- **`parseMap`:** keep `baseDy` only if `Number.isInteger(d.baseDy) && d.baseDy > 0 &&
  d.baseDy < MAX_MAP_SIZE`. Otherwise drop it, the same way junk `layer`/`rot` is stripped.
- **Rotation/flip:** depth is screen-y based, so the base is **the bottom row of the transformed
  footprint**. With `fh = footprint(sel.w, sel.h, t).h` and the cell's transformed offset `o.dy`
  (`transformOffset`): `baseDy = fh - 1 - o.dy`. A 2x3 piece rotated 90° (footprint 3 tall) gets
  `baseDy` 2/1/0 by row. A flipped piece keeps the same rows (flipX only moves columns). A V-flip
  (rot 180 + flipX) uses the same formula, so the base is whatever row ends up at the bottom.

### 2. Blocking: a 3-way `BlockMode`
`type BlockMode = 'none' | 'base' | 'all'` replaces the `block: boolean` stamp flag.

| mode   | layer    | tiles blocked                      | `baseDy` written |
|--------|----------|------------------------------------|------------------|
| `none` | `floor`  | none (rugs, beds)                  | no               |
| `base` | `object` | bottom row of the footprint only   | yes              |
| `all`  | `object` | every covered tile (old behaviour) | no               |

- **Default `base`**, with exactly 1 base row. Art-derived "feet" rows were rejected: they need image
  data in the pure model, the shadow and outline rules are fuzzy, and they guess wrong on bookshelves
  and counters. `all` is the manual override for pieces whose footprint really is the whole block
  (a big round table, a piece rotated 90° whose 3/4 depth now runs sideways).
- **`all` writes no `baseDy`.** Every row is blocked, so no avatar can stand inside the object, and
  per-row anchors give the same sort for neighbours above and below. `all` therefore stays
  byte-identical to today's stamp.
- 1-row pieces: `base` gives `baseDy` 0 everywhere, so the field is omitted. The result is the same
  as the old `block=true`.
- **Layer inference:** unchanged. Every stamp already writes an explicit `layer`, so the top cells of a
  `base` object are `'object'` even though the tile under them is now floor. Inference only runs for
  legacy cells with no `layer`.
- **Per-cell block predicate (pure, shared by stamp and ghost):**
  `cellBlocks(cell, mode) = mode === 'all' || (mode === 'base' && (cell.baseDy ?? 0) === 0)`.
- **Stamping never unblocks.** A `base` stamp leaves tiles that were already walls as walls, including
  real walls under wall decor.

### 3. Depth
`decorAnchorY(cell: { y: number; baseDy?: number }) = cell.y + (cell.baseDy ?? 0) + 0.5`. The
tiebreak doesn't change. `game.ts:353` already passes the whole cell, so it needs no change.

Cases (desk top row `y0`, base row `y0+1`, `base` mode → all desk cells anchor `y0+1.5`):
- **Avatar behind the desk**, feet in the now-walkable row `y0` (`y ∈ [y0, y0+1)`): anchor `< y0+1.5`.
  The avatar draws first and the whole desk covers it. ✔ (Today the top cells, at `y0+0.5`, would draw
  under an avatar at `y0+0.7`.)
- **Avatar in front**, row `y0+2` (`y ≥ y0+2 > y0+1.5`): drawn after, over the desk. ✔
- **Seated at a chair in front facing up** (chair at `y0+2`, seat centre `y0+2.5`): drawn over the
  desk, the same as today. ✔
- **Seated behind the desk facing down** (chair in row `y0`, which is now possible because `y0` is
  walkable; seat centre `y0+0.5`): the chair (`y0+0.5`) and avatar draw before the desk (`y0+1.5`),
  so the desk covers the legs. ✔ The existing "desk one tile below the chair" case (chair row `c`,
  desk rows `c+1`/`c+2`) now anchors the desk at `c+2.5`, which is still above the seat at `c+0.5`. ✔
- **Floor layer (rugs, beds stamped `none`):** never in the sorted pass (`render.ts:41`). ✔
- **Legacy cells / `all` mode:** no `baseDy`, so the anchor is unchanged. ✔

### 4. Editor UX
- Replace the checkbox with a select `#block-decor`, labelled "Block": `Base row (desks, shelves)`
  [default] / `Whole piece` / `Nothing (rugs, beds)`. `let blockMode: BlockMode = 'base'`.
- Ghost preview: call `brushCells(hover.x, hover.y, selection, brushT, blockMode)`. After drawing the
  ghost cells, fill each cell where `cellBlocks(cell, blockMode)` with the wall red
  `rgba(220,60,60,0.35)`, so only the base row is red in `base` mode. The white footprint outline is
  unchanged.
- Hint line: "Base row: only the bottom row blocks; people can walk behind it. Use Whole piece for
  pieces turned sideways."
- Erase stays per cell. Erasing a base cell leaves the top cells' `baseDy` in place, which is
  harmless because they still sort by that row.
- **Duplicate rule extended:** re-stamping an identical cell now replaces its transform, `layer`
  **and** `baseDy` (delete the old ones, then assign). The cell takes the brush's current settings.
- **Existing maps (no migration button):** to convert an old fully blocked desk, choose "Base row",
  pick the same piece, and stamp it on the same anchor. The cells update in place and get `baseDy`.
  Then use the **Walk** tool on the top row to unblock it, since stamping never unblocks. A legacy
  cell with no `layer` whose tile was unblocked by hand would infer `floor`. Re-stamping fixes that,
  because the duplicate now writes `layer`.

### 5. Walking / collision
No change. Movement only checks tiles (`movement.ts:36-37`), so a `base` stamp leaves the top row
walkable and the next frame lets avatars walk there. Seats are tile-addressed and decor doesn't
affect them. `startPosition` uses `isWalkable`, which is also unaffected.

## Scope
- In scope: `baseDy` field + validation, `BlockMode` stamping, anchor change, editor select + ghost
  tint, tests.
- Out of scope: art-derived feet detection, a "block N rows" numeric option, a migration button,
  multi-row anchors for sideways pieces (they use `all`), server/protocol changes (maps are JSON
  through `parseMap` only).

## Interfaces
```ts
// shared/src/map.ts — DecorCell
/** Rows from this cell down to its object's base row (where it stands). Absent = 0. */
baseDy?: number;

// client/src/editor-model.ts
export type BlockMode = 'none' | 'base' | 'all';
export function cellBlocks(cell: DecorCell, mode: BlockMode): boolean;
export function brushCells(x: number, y: number, sel: DecorSelection, t: DecorTransform, mode?: BlockMode): DecorCell[];
//   mode given → layer = mode==='none' ? 'floor' : 'object'; mode==='base' → baseDy = fh-1-o.dy (omit 0)
//   mode omitted → no layer, no baseDy (as today without layer)
export function stampDecor(m: OfficeMap, x: number, y: number, sel: DecorSelection, mode: BlockMode, t?: DecorTransform): void;

// client/src/depth.ts
export function decorAnchorY(cell: { y: number; baseDy?: number }): number;
```
Field order in a cell object: `{x,y,sheet,sx,sy,layer?,baseDy?,rot?,flipX?}`. `toEqual` doesn't care
about order, but keep this order for readable JSON.

## Impact Analysis
- **Tests that change:** `client/test/editor-model.test.ts` calls `stampDecor(..., true|false, ...)`
  at lines 26, 33, 41, 55, 56, 58, 72. Change these mechanically to `'all'|'none'`. Their expectations
  stay the same, because `all` = old `true` and `none` = old `false`.
- **New tests:** see the units below.
- **Layers:** shared model (field + parse), client pure model (`editor-model`, `depth`), editor UI.
  No changes to the server, protocol, `render.ts`, or `game.ts`.
- **Compat:** old maps render and block exactly as before. New maps opened by an older client lose
  `baseDy` in `parseMap`. Those desks then sort per row, and the top row is walkable, so avatars there
  draw over the desktop. That's cosmetic only and acceptable (pre-release, single deploy).
- **Failure modes:** a bad `baseDy` in JSON is stripped. A `baseDy` pointing past the map edge only
  shifts the sort anchor, so it can't crash anything.

## Implementation Units
1. **U1 — `baseDy` model + parse** — files: `shared/src/map.ts`, `shared/test/map.test.ts`.
   Change: add the `DecorCell.baseDy?` doc'd field; `parseMap` keeps it when it's an integer in
   `1..MAX_MAP_SIZE-1`. Acceptance: a test where `baseDy: 1` survives a parse; `0`, `-1`, `1.5` and
   `'1'` are stripped; a cell without it has no key. `npm test` green.
2. **U2 — Depth anchor by base row** — files: `client/src/depth.ts`, `client/test/depth.test.ts`.
   Change: `decorAnchorY(cell: {y; baseDy?})` = `y + (baseDy ?? 0) + 0.5`. Update the header comment.
   Acceptance: `decorAnchorY({y:3})` is still 3.5 and `{y:3,baseDy:1}` is 4.5. A sort test with desk
   cells `{y:4,baseDy:1}` and `{y:5}` plus avatar feet at 4.7 → the avatar comes before both desk
   cells. Avatar at 6.2 → after both. Avatar seated at 6.5 in front → after. `npm test` green.
3. **U3 — `BlockMode` in the pure editor model** — files: `client/src/editor-model.ts`,
   `client/test/editor-model.test.ts`. Change: `BlockMode`, `cellBlocks`. `brushCells` takes
   `mode?` (layer from the mode, `baseDy` in `base`). `stampDecor` takes `mode: BlockMode` and blocks
   per `cellBlocks`. The duplicate path also replaces `layer` + `baseDy`. Switch the existing call
   sites to `'all'`/`'none'`. Acceptance (new tests):
   (a) a 3x2 selection stamped at (1,1) in `base` → top cells `baseDy:1`, bottom cells without the
   field, all `layer:'object'`; tiles in row 1 walkable, row 2 blocked.
   (b) the same piece with `rot:90` (footprint 2x3) → `baseDy` 2/1/0 by row, only row 3 blocked.
   (c) `all` → no `baseDy`, all 6 tiles blocked (old behaviour).
   (d) a duplicate re-stamp from `all` to `base` adds `baseDy` to the top cells.
   (e) a `parseMap` JSON round trip equals `m`. `npm test` green.
4. **U4 — Editor select + ghost tint** — files: `client/src/editor.ts`. Change: replace
   `blockDecor` with `blockMode: BlockMode = 'base'`. Replace the checkbox with the `#block-decor`
   select (3 options, default Base row) and its `change` listener. Add the hint line. In the ghost,
   pass `blockMode` to `brushCells` and red-fill the cells where `cellBlocks`. At `:665`, pass
   `blockMode`. Acceptance: `npm run typecheck --workspace client` + `npm run build` green. Manual
   checks below.
5. **U5 — Manual verification + HANDOFF** (Implementer runs the checks; no code).

## Manual checks (browser)
1. Pick the 3x2 desk with Block = Base row. The ghost is red only on the bottom row. Stamp it: only
   the bottom row shows a red X.
2. In game, walk into the row behind the desk. The avatar is hidden behind the desktop, and its head
   shows above if the sprite is taller. Walk in front of it: the avatar draws over the drawers.
3. Put a chair in the row behind the desk facing down with a Sit seat, then sit. The desk covers the
   legs. A chair in front facing up draws over the desk.
4. Whole piece blocks all 6 tiles, the same as before. Nothing gives no X and draws under avatars.
5. Press R on the desk (footprint 2x3) with Base row: only the bottom row is red. Whole piece blocks
   all of it.
6. An old saved map looks and blocks the same. Re-stamping a desk on its own anchor with Base row,
   then using Walk on its top row, converts it.
7. Save, reload, open in game: `baseDy` persists.

## Open Questions
None blocking. If users often stamp 2-row footprints (deep tables), a "Base: 2 rows" option can be
added later as a 4th mode without a model change, since `cellBlocks` would compare `baseDy < 2`.
