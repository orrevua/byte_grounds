# Auto seats (chairs sittable, beds layable on placement) — Spec

**Status:** Draft
**Date:** 2026-10-29
**Related:** `docs/HANDOFF.md`, `docs/specs/decor-rotation.md` (transformFacing), `docs/specs/object-footprint.md`,
`docs/specs/sit-lie-poses.md`, the (concurrent) realtime-building spec.

## Goal
Any chair, armchair, sofa, stool, bench, throne or bed stamped into a map is usable at once (Sit / Lie down
with E), with no Seat-tool step. Authored seats keep working and become overrides; a "No seat" marker can
turn an automatic seat off.

## Context & Current State
- Seats are explicit data: `Seat {x,y,kind:'sit'|'lie',dir}` and `OfficeMap.seats` (`shared/src/map.ts:33-38`,
  `:52`), validated in `parseMap` (`:134-143`). Lookups `seatAt` / `seatsNear` read `m.seats` only (`:164-175`).
- Decor is stored **per 32px cell**: `DecorCell {x,y,sheet,sx,sy,layer?,baseDy?,rot?,flipX?}` (`map.ts:11-25`).
  A multi-cell object has no identity once stamped: `brushCells` (`client/src/editor-model.ts:44-63`) writes one
  cell per source cell at its transformed offset and copies the transform onto every cell.
- Game: `freeSeatNearby` (`client/src/game.ts:279-286`) = `seatsNear(map, self, SEAT_REACH=1.6)` minus seats a
  remote occupies; `toggleSeat` (`:288-298`) teleports onto the seat tile centre and remembers `standX/standY`;
  `standUp` (`:300-306`) returns there. Walkability of the seat tile is never checked (sofa side views are
  `all`-blocked in built-ins and already work). `position` (`:123-125`) returns the seat tile while seated.
- Editor: Seat tool (`client/src/editor.ts:88-89`, `:140-150`, `:370-397`, `:607-620`, `:685-686`) calls
  `toggleSeat` (`editor-model.ts:114-126`); R/F turn `seatDir` via `transformFacing` (`editor.ts:372`).
- `transformFacing(dir, t)` lives in the client (`client/src/decor-transform.ts:62-68`); shared can't import it.
- Built-in maps: `tools/build_maps.py` calls `seat()` for every chair/stool/sofa/armchair/bed it places
  (`:270-299`, plus ottomans at `:583`, `:671`, `:719-720`); `check()` requires seat reachability (`:325-331`);
  `shared/test/maps.test.ts:56-63` re-checks it on `m.seats`. Counts: office 76, lounge 78, home 32.
- Sheet layouts (verified by looking at the PNGs + build_maps catalog `:39-76`):
  - `chairs.png` 16x10 cells, `armchairs.png` 16x14: 2-row styles x 8 colours x 2 cols. Even row: even col =
    front (`down`), odd col = back (`up`); odd row: even col = side `right`, odd col = side `left`.
  - `sofas.png` 16x21: per colour 2 cols. Front (`down`, 2x1) rows 0,1,5,9,13,17; back (`up`, 2x1) rows
    4,8,12,16,20; side views (1x2) rows 2-3,6-7,10-11,14-15,18-19, even col `right`, odd col `left`.
  - `bar_stools.png` 8x1 (one stool per colour). `ottomans.png` 8x7 (benches, ottomans, poufs; every cell).
  - Beds are **pieces**: a headboard/pillow piece and a separate blanket piece (`beds_grid.png`,
    `beds_single_grid.png`, `upholstery.png`); whole beds in `house_inside.png` (0,5) 2x3 and
    `wooden_furniture.png` (13,13)/(15,13) 1x2. Pillow piece above the blanket = feet `down`, below = `up`,
    at the left = `right`, at the right = `left`.
  - More seating with irregular layout: `thrones.png` 10x5, `sofas_formal.png` 16x13, `upholstery.png` 16x32,
    `wooden_furniture.png` chair block (~cols 12-15, rows 15-22), `house_inside.png` chairs (~cols 7-10,
    rows 3-5) and armchairs, `tavern_furniture_grid.png` 12x43 (chairs, stools, benches). `office.png` has no
    chairs.

## Proposed Design

### D1. Per-cell seat catalog (data), not per-object
A seat is a property of a **sheet cell**: `(sheet, sx, sy) -> {kind, dir}`. Each stamped decor cell whose
source cell is in the catalog yields a seat **on that cell's own map tile**.
Why per cell (trade-off): objects lose identity once stamped (drag-stamping, partial erase, re-stamp, overlap),
so an object-anchor match would be fragile; per cell needs no anchor at all:
- Drag/partial stamps and partial erases just work (erase half a sofa -> one seat left; erase the pillow
  piece -> the bed has no lie spot).
- Rotation/flip already moves each cell to its transformed tile (`brushCells`); only `dir` needs turning.
- Multi-seat objects fall out naturally: a 2x1 sofa front = 2 seat cells, a side sofa 1x2 = 2, a double-bed
  pillow piece 2x1 = 2 lie spots, a bench = one per cell. Exactly what build_maps authors today.
- Bed rule: only the pillow/headboard cells are `lie` cells (the Seat contract: tile with the pillow, `dir` =
  where the feet point). Blanket/foot cells are not seats.
- Undirected pieces (stools, ottomans, poufs, benches) get a fixed default: `bar_stools` = `up` (they stand
  at counters to the north; matches every built-in stool), everything else undirected = `down`.

### D2. Catalog format: hand-authored JSON rules, shared by TS and Python
`shared/src/seat-catalog.json` (hand-edited; no generator). Rejected alternatives: a fully expanded generated
list (thousands of lines, hides the pattern); deriving from build_maps (covers only the ~10 objects the maps
use); TS-only table (build_maps needs it too). Rules are rectangles with an optional stride:
```json
{ "rules": [
  { "sheet": "chairs", "x": 0, "y": 0, "w": 16, "h": 10, "step": [2, 2], "kind": "sit", "dir": "down" }
] }
```
Cells covered: `(x + i*step[0], y + j*step[1])` for `i*step[0] < w`, `j*step[1] < h`. Defaults `w=1`, `h=1`,
`step=[1,1]`. `kind: "none"` removes cells (exceptions inside a rect). **Later rules override earlier ones**
for the same cell. `dir` is required for `sit`/`lie`, ignored for `none`.

### D3. Derivation and merge (pure, in shared)
New module `shared/src/seats.ts` (export subpath `@byte_grounds/shared/seats`):
- `seatSpot(sheet, sx, sy)` — catalog lookup; index built once at module load from the JSON.
- `derivedSeats(m)` — for each `m.decor` cell with a spot: `{x: cell.x, y: cell.y, kind, dir:
  transformFacing(spot.dir, {rot: cell.rot ?? 0, flipX: cell.flipX === true})}`. One seat per tile: the
  **last** seat-bearing cell in `m.decor` order wins (topmost drawn). Non-seat cells on the same tile (a desk
  top row with a tucked chair) never cancel a seat.
- `effectiveSeats(m)` — authored `m.seats` first, then derived seats whose tile has no authored seat and is
  not listed in `m.noSeats`. Authored always beats derived; `noSeats` only suppresses derived seats.
- Derivation ignores `layer`, `baseDy` and tile walkability.
- `transformFacing` moves to `shared/src/map.ts` (signature `(dir: Facing, t: {rot: Rotation; flipX:
  boolean}): Facing`, structurally identical to the client's `DecorTransform`); `client/src/decor-transform.ts`
  re-exports it so existing imports/tests are untouched.
- `seatsNearIn(seats, x, y, reach)` added to `map.ts`; `seatsNear(m, …)` becomes
  `seatsNearIn(m.seats ?? [], …)` (unchanged behaviour).

### D4. Map model: `noSeats`
`OfficeMap.noSeats?: {x: number; y: number}[]` — tiles whose automatic seat is turned off. `parseMap` keeps
only integer `x,y` entries and sets the field **only when at least one valid entry exists** (canonical: absent
when empty, so built-in round-trip and existing fixtures are unchanged). `resizeMap` filters it like `seats`.

### D5. Walkability and stand-up (decision: no change to rules)
- A seat may sit on a blocked tile (side sofas, `base`-blocked armchairs) or a walkable one (`free` chairs).
  Sitting teleports onto the tile centre regardless; reach stays "within 1.6 tiles of the seat centre".
- Stand-up keeps returning to the remembered `standX/standY` (always a spot the player walked to).
- New: `Game.position` returns `standX/standY` while seated, so a saved position never lands on a blocked
  seat tile (today `startPosition` would silently fall back to spawn).
- A catalog seat nobody can get within 1.6 tiles of is simply never offered; no validation needed.

### D6. Game integration and live building
`Game` caches `private seats: Seat[] = effectiveSeats(map)` at construction and uses
`seatsNearIn(this.seats, …)` in `freeSeatNearby`. Public `refreshSeats()` recomputes the cache; if the player
is seated and no seat with the same `x,y,kind` remains, it calls `standUp()`. **Contract for the realtime-
building spec:** after applying any remote/local edit that changes `decor`, `seats` or `noSeats`, call
`game.refreshSeats()`. Derivation is deterministic from map data, so every client agrees with no protocol
change.

### D7. Editor
- Draw `effectiveSeats(map)`: authored seat = filled badge (today's look); automatic seat = same colour,
  **outlined** ring + arrow (no fill); `noSeats` tiles = grey badge with "×". Recomputed in `draw()` (O(decor)).
- Seat tool kind select gains a 3rd option `none` = "No seat (turn off automatic)". Click with `none` ->
  `toggleNoSeat`; with `sit`/`lie` -> `toggleSeat` (which now also clears a `noSeats` entry on that tile).
- `toggleNoSeat(m, x, y)` (editor-model): toggles `{x,y}` in `m.noSeats` (creating the array on demand,
  deleting the field when it becomes empty) and removes an authored seat on that tile.
- Hint text: automatic seats come from chairs/sofas/stools/beds; click to override facing/kind; "No seat" to
  turn one off. R/F on the Seat tool unchanged.
- Stamping needs **no change**: seats appear the moment the piece is stamped because they are derived.

### D8. Built-in maps
`build_maps.py` loads `seat-catalog.json`, derives seats from its own decor (built-ins never use rot/flip;
the script asserts that), and writes to `seats` **only authored seats that differ from the derived seat on
that tile** (overrides). `check()` validates reachability over the effective set and keeps the "two authored
seats share a tile" check. Expected overrides: office 0, lounge 1 (piano ottoman `up`), home 1 (piano ottoman
`up`). Effective counts must stay office 76, lounge 78, home 32. `maps.test.ts` checks reachability and counts
on `effectiveSeats(m)`.

## Scope
- In scope: catalog JSON + loader, derivation/merge, `noSeats`, `transformFacing` move, game cache/refresh,
  editor drawing + "No seat", build_maps derivation, tests, an author-time catalog preview script.
- Out of scope: per-object seat offsets that are not a whole cell (all seats snap to tile centres as today);
  catalog entries for the hidden pre-repack originals (`beds.png`, `beds_single.png`, `tavern_furniture.png`
  etc.) — old maps using them keep their authored seats; occupancy/protocol changes; pose art changes.

## Interfaces / Models / Endpoints
```ts
// shared/src/map.ts
export interface OfficeMap { /* … */ noSeats?: { x: number; y: number }[] }
export function transformFacing(dir: Facing, t: { rot: Rotation; flipX: boolean }): Facing;
export function seatsNearIn(seats: readonly Seat[], x: number, y: number, reach: number): Seat[];

// shared/src/seats.ts  (package.json exports "./seats": "./src/seats.ts")
export interface SeatSpot { kind: Seat['kind']; dir: Facing }
export function seatSpot(sheet: string, sx: number, sy: number): SeatSpot | undefined;
export function derivedSeats(m: OfficeMap): Seat[];
export function effectiveSeats(m: OfficeMap): Seat[];

// client/src/editor-model.ts
export function toggleNoSeat(m: OfficeMap, x: number, y: number): boolean; // true = now off

// client/src/game.ts
refreshSeats(): void;
```
JSON rule (in `shared/src/seat-catalog.json`):
`{sheet: string, x: int, y: int, w?: int, h?: int, step?: [int, int], kind: 'sit'|'lie'|'none', dir?: Facing}`.
The loader skips malformed rules; a test asserts there are none.

## Impact Analysis
- Tests: `decor-transform.test.ts` keeps passing via re-export. `maps.test.ts` "every seat reachable" switches
  to `effectiveSeats` (the `m.seats!.length > 0` assertion becomes `effectiveSeats(m).length > 0`). New
  `shared/test/seats.test.ts`. `editor-model.test.ts` gains `toggleNoSeat` cases.
- Layers: shared gains a module + JSON (Vite/Vitest/Node already import JSON `with { type: 'json' }`,
  `shared/src/maps.ts:1-3`). Server untouched (does not import seats).
- Backward compat: old saved maps keep their authored seats; they now also get automatic seats on any catalog
  cell, possibly on tiles they never marked. That is the requested behaviour; `noSeats` turns any off.
- Performance: derivation O(decor cells) with one `Map` lookup each; game computes once (+ on refresh), the
  editor per draw (~3k cells, negligible).
- Failure modes: a catalog mistake gives a wrong facing or a seat on a non-seat cell; mitigated by the
  preview script (U5), the built-in regression counts (U4) and per-sheet tests.

## Implementation Units
1. **Shared map helpers** — files: `shared/src/map.ts`, `client/src/decor-transform.ts`,
   `shared/test/map.test.ts` — change: move `transformFacing` (+ its `CLOCKWISE` table) into `map.ts` with the
   structural `t` type; `decor-transform.ts` re-exports it. Add `noSeats` (D4) to `OfficeMap` + `parseMap`.
   Add `seatsNearIn`; `seatsNear` delegates. — acceptance: `npm test` green; new tests: parseMap keeps valid
   `noSeats`, drops junk, omits the field when empty; `seatsNearIn` on a plain array.
2. **Catalog core** — files: `shared/src/seat-catalog.json`, `shared/src/seats.ts`, `shared/package.json`,
   `shared/test/seats.test.ts` — change: JSON with tier-A rules: `chairs` + `armchairs` (4 stride-2 rules each:
   down x0y0, up x1y0, right x0y1, left x1y1, rect to sheet edge), `sofas` (down rows 0-1; down y5 h13
   step[1,4]; up y4 h17 step[1,4]; right x0 y2 and x0 y3 h17 step[2,4]; left x1 y2 and x1 y3 h17 step[2,4]),
   `bar_stools` x0 y0 w8 sit `up`, `ottomans` x0 y0 w8 h7 sit `down`, `house_inside` (0,5),(1,5) lie `down`,
   `wooden_furniture` (13,13),(15,13) lie `down`. `seats.ts`: rule type guard, expansion, override order,
   `seatSpot`. Add `"./seats"` export. — acceptance: tests for chair facings (e.g. chairs (2,4) down, (3,4) up,
   (2,5) right, (3,5) left), sofas (0,5) down, (1,20) up, (0,6) right, (1,7) left, stool up, bed pillow lie,
   bed foot (0,6) on house_inside undefined, unknown sheet undefined, a later `none` rule removing a cell (unit
   test via an exported pure `buildIndex(rules)`), every catalog rule valid and inside its sheet (read PNG IHDR
   as `maps.test.ts:10-17` does).
3. **Derivation + merge** — files: `shared/src/seats.ts`, `shared/test/seats.test.ts` — change: `derivedSeats`,
   `effectiveSeats` per D3. — acceptance: tests: chair `down` with rot 90 -> `left`, flipX side `right` ->
   `left`; sofa front 2x1 -> 2 seats; side sofa 1x2 -> 2 seats; double bed via `brushCells`-equivalent cells
   -> 2 `lie` on the pillow row only, rotated 90° -> 2 lie seats in a column facing `left`; erased one sofa
   cell -> 1 seat; two seat cells on one tile -> last wins; desk cell + chair on one tile -> seat kept;
   authored seat overrides derived dir; `noSeats` suppresses derived but not authored.
4. **Built-in regression test** — files: `shared/test/maps.test.ts` — change: reachability over
   `effectiveSeats(m)`; assert effective counts `{office: 76, lounge: 78, home: 32}`; assert every derived seat
   tile is also an authored tile in the current JSON **or** the map has no authored seat there (i.e. derived
   adds no unexpected extra seats: `effectiveSeats(m).length === expected`). — acceptance: green against the
   current (un-regenerated) JSON; any failure means a tier-A rule is wrong: fix the catalog, not the test.
5. **Catalog preview tool** — files: `tools/preview_seats.py` (Pillow, author-time) — change: for each sheet
   named on the CLI (default: every sheet in the catalog), write `<sheet>_seats.png` to `--out DIR`: the sheet
   at 2x, a 32px grid with `sx,sy` labels every cell, and on each catalog cell an arrow toward `dir`, orange
   for sit, purple for lie (same expansion/override semantics as D2). — acceptance: running it on `chairs`,
   `sofas`, `house_inside` shows arrows matching the art; documented in the script docstring.
6. **Catalog tier B: beds** — files: `shared/src/seat-catalog.json`, `shared/test/seats.test.ts` — change:
   `lie` rules for every headboard/pillow piece cell in `beds_grid`, `beds_single_grid`, `upholstery` (bed
   area, ~rows 15-23) and any remaining `wooden_furniture` bed heads (rows 13-14, cols 12-15), dir per D1
   pillow rule. Find coordinates with U5's preview; never mark blanket cells. — acceptance: preview shows a
   purple arrow on every pillow cell pointing toward the foot end and nowhere else; 2 spot-check tests per sheet.
7. **Catalog tier B: chairs, sofas, benches** — files: same — change: `sit` rules for `thrones` (seat = lower
   cell of each 1x2: row 1 even col `down`, odd col `up`; row 4 sides — verify left/right in preview),
   `sofas_formal`, `upholstery` seating (rows ~4-14), `wooden_furniture` chair block, `house_inside` chairs and
   armchairs, `tavern_furniture_grid` chairs/stools/benches (undirected = `down`; high-back chairs per art).
   Mark only the seat cell of tall pieces (the lower cell). If this exceeds ~50 lines of JSON, split per sheet.
   — acceptance: preview check per sheet; 1-2 spot-check tests per sheet; full suite green.
8. **Game** — files: `client/src/game.ts` — change: per D5/D6: `seats` cache, `seatsNearIn` in
   `freeSeatNearby`, public `refreshSeats()` (stand up if our seat vanished), `position` returns the stand
   spot while seated. — acceptance: typecheck + build green. [M] stamp a chair in the editor, save, join:
   "Sit (E)" appears; rotated chair faces the turned way; lie on both halves of a double bed; reload while
   seated -> you return near the seat, not at spawn.
9. **Editor model** — files: `client/src/editor-model.ts`, `client/test/editor-model.test.ts` — change:
   `toggleNoSeat` (D7), `toggleSeat` clears a `noSeats` entry on its tile, `resizeMap` filters `noSeats`. —
   acceptance: tests: toggle on/off (field deleted when empty), removes authored seat, `toggleSeat` clears it,
   resize filter, parseMap round trip.
10. **Editor UI** — files: `client/src/editor.ts` — change: `seatKind` type `Seat['kind'] | 'none'`, 3rd select
    option, `apply` routes `none` to `toggleNoSeat`, markers per D7 from `effectiveSeats(map)`, new hint text.
    — acceptance: typecheck + build green. [M] stamp a sofa: two outlined badges appear instantly; rotate a
    chair with R before stamping: outlined arrow turned; "No seat" on one: grey ×, and the game no longer offers
    it; Sit tool click on it: filled badge with the chosen facing.
11. **build_maps derivation** — files: `tools/build_maps.py`, regenerated `shared/src/maps/*.json` — change:
    per D8: `load_seat_catalog()` (same expansion/override as D2), derived seats from `floor_decor +
    object_decor` (assert no `rot`/`flipX`), output only overriding seats, `check()` over effective seats,
    print overrides per map. Run `python tools/build_maps.py`. — acceptance: prints overrides office 0,
    lounge 1, home 1; U4 tests still green (counts 76/78/32); decor/tiles in the JSON byte-identical except the
    `seats` arrays.
12. **Manual checks + docs** — files: none (Implementer reports; HANDOFF/CONTEXT updated by whoever owns them)
    — [M] browser checklist: units 8 and 10 items; built-in maps still let you sit everywhere they did; a
    remote tab sees you seated on an automatic seat; an old saved map gains automatic seats and keeps authored
    ones.

Order: 1 -> 2 -> 3 -> 4 -> 8 (feature usable) -> 9 -> 10 -> 11 -> 5 -> 6 -> 7 -> 12. U5 may move earlier if
U4 fails and a visual check is needed.

## Open Questions
- Stool/bench facing defaults (`bar_stools` up, others down) are a guess at the common case; override per seat
  with the Seat tool. Revisit if users mostly place stools away from counters.
- A future "seat offset" (sofa seat between two cells, bed centre) would need sub-tile seat positions; out of
  scope, the current lie/sit renderers assume tile centres.
- Realtime-building spec must call `game.refreshSeats()` after applying decor/seat edits (D6 contract).
