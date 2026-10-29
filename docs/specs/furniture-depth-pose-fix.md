# Furniture Depth + Pose Rendering Fix — Spec

**Status:** Draft
**Date:** 2026-10-28
**Related:** `docs/HANDOFF.md` (sit/lie + furniture feature, "Character stats" commit f2b177e); `client/src/render.ts`, `client/src/sprites.ts`, `client/src/game.ts`, `client/src/decor.ts`, `client/src/editor.ts`, `client/src/editor-model.ts`, `shared/src/map.ts`, `shared/src/protocol.ts`.

## Goal
Fix three top-down rendering bugs in the sit/lie + furniture feature:
1. Furniture (desk/table) never occludes avatars — decor is always drawn under every avatar, so "sitting at a desk" looks like sitting on top of the desk.
2. A seated character's feet/legs always vanish (unconditional crop), even on a plain chair with nothing in front of it.
3. A lying character's feet vanish on a bed.

Deliver proper top-down depth sorting (furniture can occlude avatars by screen row), draw the full seated/lying body, and let furniture — not a crop — hide legs only when something is actually in front.

## Context & Current State

### Render order (the root of bug 1)
- `render.ts:32` `drawMap` draws base tiles + grid, then **all** `map.decor[]` cells (`render.ts:40-42`).
- `game.ts:350` calls `drawMap` first, then draws every avatar (`game.ts:351-361`), self last.
- Net effect: 100% of decor is under 100% of avatars. Furniture can never occlude a character.

### Seated crop (bug 2)
- `render.ts:138-141` (`drawPosedSprite`, `pose==='sit'`) draws the standing frame (col 0, `WALK_ROW[dir]`) but via `drawAppearanceRegion(..., FRAME_SIZE, SIT_KEEP, ...)` — it crops the 64px frame to its top `SIT_KEEP=46` px (`sprites.ts:220`), unconditionally hiding the lower ~18px (legs/feet). There is no furniture-aware logic; the crop always fires.

### Lying frame (bug 3)
- `render.ts:143-157` (`pose==='lie'`) draws the **hurt/death** frame (`LIE_COL=5`, `LIE_ROW=20`, `sprites.ts:217-218`) — a collapsed pose that does not contain a full head-to-feet extended body — rotated by `LIE_ROTATION` (comment at `render.ts:106`: "the frame's feet point up") and shifted half a tile toward `dir`. Using the collapsed death frame as a "lying" body is why the feet read as missing/cut; it is not a crop and (currently) not a decor-occlusion issue (decor is still under everything today).

### Decor data model
- `shared/src/map.ts:8` `DecorCell = { x, y, sheet, sx, sy }` — one 32px cell, no layer/z/ordering info. Multi-tile furniture is several independent single-cell stamps (`editor-model.ts:31-46`), each at its own `(x,y)`.
- `editor-model.ts` `stampDecor(..., block)` also marks covered tiles blocked (`setBlocked`) for solid furniture (tables/shelves). So "is this furniture solid?" is already encoded as the tile being a wall (`tileAt === 1`).
- `shared/src/map.ts:91` `parseMap` filters decor to the 5 known integer fields.

### Seats
- `map.ts:22` `Seat = { x, y, kind:'sit'|'lie', dir }`. Sitting/lying snaps the avatar to the seat tile center: `self.x = sx+0.5`, `self.y = sy+0.5` (`game.ts:289-291`). `self.y` is therefore the avatar's feet anchor in tile space.

## Proposed Design

### Depth model: floor layer vs object layer, one y-sorted pass
Split decor into two layers:
- **floor** — floors, rugs, flat textures. Always drawn under all avatars (today's behavior).
- **object** — furniture (desks, tables, shelves, cabinets). Depth-sorted against avatars by screen row.

Rendering becomes:
1. `drawMap`: base tiles + grid + **floor-layer decor only**.
2. One merged, y-sorted pass over **object-layer decor cells + all avatars** (remotes and self), drawn back-to-front by an anchor row.
3. A final top pass: proximity rings already drawn with their avatar; name labels drawn last so furniture never covers a name; video bubbles positioned.

#### Layer source — minimal model addition + inference (keeps old maps working)
Add an **optional** `layer?: 'floor' | 'object'` to `DecorCell`. Resolve per cell:

```
decorLayer(map, cell) = cell.layer ?? (tileAt(map, cell.x, cell.y) === 1 ? 'object' : 'floor')
```

- **New maps:** the editor writes `layer` explicitly at stamp time (`block ? 'object' : 'floor'`), so a map is self-describing.
- **Existing maps (no `layer`):** inference from the already-stored block flag — solid furniture was stamped `block:true` (its tile is a wall) → `object` (now occludes, fixing bug 1 with zero re-tagging); rugs/floors/beds/plain chairs were stamped non-blocking → `floor` (stay under, unchanged). This is why beds and plain chairs remain under the avatar automatically.

Trade-off: in the editor, "occludes" is coupled to the "Block tiles under it" checkbox. Acceptable for a personal project; a decorative-but-occluding non-blocking object would need a future explicit override (the `layer` field already supports it; only an editor control is missing). Noted in Open Questions.

#### Anchor + tiebreak rules (the exact sort key)
All anchors are in tile-space Y (screen rows; larger Y = lower on screen = nearer the viewer). Lower anchor draws first (farther/behind).

- **Avatar anchor** = `avatar.y` (its feet point; for a seated/lying avatar this is the seat tile center `seatY + 0.5`).
- **Object decor cell anchor** = `cell.y + 0.5` (the cell's vertical center).
- **Comparator:** ascending anchor; on an exact tie **decor draws before the avatar** (avatar ends up on top); remaining ties keep input order (stable — self stays after remotes as today).

Worked cases (chair at tile `(cx, cy)`, seated avatar at `cy + 0.5`):
- **Plain chair, same tile** — chair anchor `cy+0.5` ties the avatar → chair first → **avatar on top of the chair** (sits on it), full body incl. feet visible.
- **Desk one row below / in front** (`cy+1`, the screenshot-1 layout: character above, desk below, facing down) — desk anchor `cy+1.5 > cy+0.5` → **desk draws after the avatar → occludes the lower legs/feet** → reads as "sitting at the desk." This is the intended interaction with bug 2: we now draw the *full* seated body, and the desk in front is what hides the legs.
- **Avatar standing one row above furniture** (behind it) — avatar anchor `≈ ty-0.5 <` cell anchor `ty+0.5` → furniture draws after → avatar correctly occluded behind the furniture.
- **Avatar standing one row below furniture** (in front) — avatar anchor `> ` cell anchor → avatar on top. Correct.

Tall multi-row furniture needs no special handling: each cell is anchored by its own row, so the near (lower) cells correctly draw over an avatar that the far (upper) cells draw behind.

### Pose rendering (bugs 2 & 3)
- **Sit:** stop cropping. Draw the **full** standing frame (col 0, `WALK_ROW[dir]`), lowered by `SIT_DROP` so the figure settles onto the seat. Feet are always drawn; they are hidden only when object-layer furniture is y-sorted in front (the depth fix). Remove `SIT_KEEP` and the region-crop call. LPC has no true sit frame; the full standing frame on the chair is the accepted simple approximation (unchanged from before except the crop is gone).
- **Lie:** stop using the collapsed hurt/death frame. Draw the **full standing frame** (col 0, `WALK_ROW[dir]`) rotated so the body lies flat with the feet pointing `dir`, centered across the pillow tile and the next tile (keep the existing half-tile shift). The standing frame is a complete head-to-feet figure, so feet survive the rotation. Remove `LIE_COL`/`LIE_ROW`. Beds resolve to the `floor` layer (non-blocking), so the bed stays under the whole body.
  - Rotation (standing frame's feet point *down/south*): `down: 0`, `up: π`, `left: +π/2`, `right: -π/2`. Left/right signs and the center offset are visual [M] — the Implementer confirms the orientation in a browser and flips a sign if a body lies head-first.

### Why this is the smallest viable design
- Reuses the existing decor pipeline and the standing-frame approximation already in use.
- One tiny optional model field, backward-compatible via inference — no protocol change, no migration.
- The only genuinely new logic (layer resolution, anchor, comparator) is pure and Vitest-testable; everything else is a render-order change verified manually.

## Scope
- **In scope:** `DecorCell.layer` field + `parseMap` passthrough; `decorLayer` resolver; pure depth sort; split floor/object rendering in `render.ts`; merged y-sorted pass in `game.ts`; full-body sit + lie rendering; editor writes `layer` and still shows object decor; test updates.
- **Out of scope:** new sit/lie sprite art; any protocol/network change; camera/scroll; multi-tile furniture grouping; an editor control to decouple occlusion from blocking (future).

## Interfaces / Models / Endpoints
- `shared/src/map.ts`:
  - `DecorCell` gains `layer?: 'floor' | 'object'`.
  - `parseMap` keeps `layer` only when it is `'floor'` or `'object'`, else omits it.
  - New pure `decorLayer(map: OfficeMap, cell: DecorCell): 'floor' | 'object'` (as above).
- `client/src/depth.ts` (new, pure):
  - `decorAnchorY(cell: { y: number }): number` → `cell.y + 0.5`.
  - `avatarAnchorY(a: { y: number }): number` → `a.y`.
  - `interface Renderable { anchorY: number; isAvatar: boolean }`.
  - `sortRenderables<T extends Renderable>(items: T[]): T[]` — stable sort: `anchorY` asc, tie → `isAvatar` last (decor first), then original index.
- `client/src/render.ts`:
  - `drawMap(ctx, map)` — unchanged signature; now draws only floor-layer decor.
  - `drawDecorCellAt(ctx, cell: DecorCell): void` — draws one cell at its tile (wrapper over `drawDecorCell`).
  - `drawObjectDecorFlat(ctx, map): void` — draws all object-layer decor flat (for the editor).
  - `drawPosedSprite` — sit/lie bodies as described.
- `client/src/editor-model.ts`: `stampDecor` writes `layer: block ? 'object' : 'floor'` on each cell.

## Impact Analysis
- **Breaking tests:**
  - `client/test/editor-model.test.ts:27-30` asserts decor cells deep-equal objects without `layer`; must add `layer:'object'` (block=true) / `layer:'floor'` (block=false) to expectations. Line 49/53 stamp (block=false) → `layer:'floor'`; line 54 `parseMap` round-trip must still equal.
- **New tests:** `parseMap` keeps/strips `layer`; `decorLayer` field vs inference; `depth.test.ts` for anchors + sort (tie→avatar-on-top, decor-below-on-top, stable order).
- **No change** to protocol, server, net, or persisted map JSON shape beyond the optional field (old JSON parses unchanged).
- **Perf:** per-frame sort of (object decor + avatars); negligible for these small maps.
- **Failure modes:** unloaded decor images already no-op in `drawDecorCell` (`decor.ts:49`); disc-fallback avatars keep working; a map with no `layer` fields renders correctly via inference.

## Implementation Units
1. **DecorCell.layer + parseMap** — files: `shared/src/map.ts` — add optional `layer?: 'floor'|'object'` to `DecorCell`; `parseMap` passes it through only when valid. Acceptance: typecheck; parseMap test keeps a valid layer and strips a junk one.
2. **decorLayer resolver** — files: `shared/src/map.ts` — pure `decorLayer(map, cell)` = `cell.layer ?? (tileAt==1 ? 'object' : 'floor')`. Acceptance: unit test covers explicit field and both inferred branches.
3. **Pure depth module** — files: `client/src/depth.ts`, `client/test/depth.test.ts` — `decorAnchorY`, `avatarAnchorY`, `sortRenderables`. Acceptance: tests prove avatar-on-top at a tie, decor-below draws last, stable tiebreak.
4. **render.ts decor split** — files: `client/src/render.ts` — `drawMap` draws floor-layer decor only (via `decorLayer`); add `drawDecorCellAt` and `drawObjectDecorFlat`. Acceptance: typecheck; floor decor still under; object decor no longer drawn by `drawMap`.
5. **render.ts pose fix** — files: `client/src/render.ts`, `client/src/sprites.ts` — sit draws the full standing frame lowered by `SIT_DROP` (no crop); lie draws the full standing frame rotated to lie feet-`dir`; remove `SIT_KEEP`/`LIE_COL`/`LIE_ROW` and the "feet point up" comment. Acceptance [M]: seated feet visible on a plain chair; lying body shows full with feet.
6. **game.ts merged y-sorted pass** — files: `client/src/game.ts` — in `render()`, build renderables (object-layer decor cells + all avatars incl. self), `sortRenderables`, draw back-to-front (near-remote ring then its sprite); final pass draws name labels and positions/volumes bubbles. Acceptance [M]: desk in the row below a seated avatar occludes its legs; avatar behind furniture is occluded, in front is not.
7. **editor writes + shows layer** — files: `client/src/editor-model.ts`, `client/src/editor.ts`, `client/test/editor-model.test.ts` — `stampDecor` sets `layer: block?'object':'floor'`; editor `draw()` calls `drawObjectDecorFlat` after `drawMap` so furniture still shows in the editor; update the editor-model test expectations. Acceptance: editor renders all decor; `npm test` green.

Dependency order: 1→2 (shared) feed 4/6/7; 3 feeds 6; 5 is independent (can run any time); 7 depends on 4.

Units needing manual [M] two-tab / browser verification: **5** and **6** (and a visual check in the editor for **7**). Units 1–4 and 7's test are covered by `npm test` + typecheck.

### Manual [M] checklist (units 5, 6, 7)
1. Sit on a **plain chair** (no desk) → full body with **feet visible**, figure settled on the seat.
2. Sit on a chair with a **desk one tile in front (below, facing down)** → the desk draws **over** the lower legs/feet → reads as sitting at the desk; the chair stays behind.
3. Walk a standing avatar **behind** a desk/table (one row above it) → avatar is occluded by the furniture; walk it **in front** (one row below) → avatar draws over the furniture.
4. **Lie on a bed** → whole body incl. **feet** visible, lying flat with feet pointing the seat `dir`; bed stays under. If the body lies head-first, flip the left/right rotation sign.
5. Second tab: a remote seated/lying/occluded avatar renders identically; name labels are not covered by furniture; proximity rings and video bubbles still track.
6. Open the **editor**: all furniture still appears; stamping with "Block tiles under it" on → furniture; off → floor.
7. An **existing saved map** (no `layer` fields) still renders: its solid tables now occlude seated avatars; rugs/beds stay under (inference check).

## Open Questions
- Editor couples occlusion (`object`) to the "Block tiles under it" checkbox. Add a separate "Draws over characters" toggle later if a non-blocking-but-occluding piece is needed? (Assumed not needed now; the `layer` field already supports it.)
- Sit/lie reuse the standing frame (LPC has no sit/lie frame). Accepted as the simple approximation; revisit only if it reads poorly in-browser.
