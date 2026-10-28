# Avatar Art — Pixel Sprites (Addendum to MVP Spec)

**Status:** Draft
**Date:** 2026-10-28
**Related:** `docs/specs/byte-grounds-mvp.md`, `docs/HANDOFF.md` (units 1–22 code-complete)

## Goal
Replace the colored-shape avatars with animated pixel-art characters that walk in 4
directions, giving ByteGrounds a Gather-like look. Characters are composed from the
**Universal LPC spritesheet** (CC-BY-SA 3.0 / GPL 3.0, legally clean), picked from a small
variant set on the join screen, and animated for both local and remote avatars. This is a
rendering + join-screen + one-protocol-field change — movement, proximity, net, and WebRTC
code are reused untouched.

## Context & Current State
- Avatars are drawn as colored discs with a name label: `client/src/render.ts:42`
  (`drawAvatar`) draws an `arc` at `x*TILE_SIZE, y*TILE_SIZE` plus a centered text label.
- The render loop draws remotes then self: `client/src/game.ts:175` (`render`), calling
  `drawAvatar(ctx, r.x, r.y, r.color, r.name, false)` and `drawAvatar(... isSelf=true)`.
- Local position is integrated per frame at `client/src/game.ts:137` (`stepMovement`);
  remotes are exponentially interpolated toward `tx/ty` at `client/src/game.ts:141`.
- `TILE_SIZE = 32` px (`shared/src/protocol.ts:2`).
- The join screen captures name + a `<input type="color">`:
  `client/src/main.ts:30` (`renderJoin`) and `client/src/main.ts:47` (`join`), threading
  `{ name, color }` into `NetClient.connect` and `Game`.
- `JoinMsg` (`shared/src/protocol.ts:26`) and `PeerState` (`shared/src/protocol.ts:12`)
  carry `name` + `color`. The server copies them into presence at
  `server/src/index.ts:47` and relays via `presence-snapshot` / `peer-joined` (which carry
  full `PeerState`, so new fields propagate for free).
- Vite serves `client/public/` statically at the web root (default Vite behavior; no
  `publicDir` override in `client/vite.config.ts`). `client/public/` does not exist yet.
- Tests live in `client/test/*.test.ts` (Vitest); pure logic only.

### LPC asset facts (verified)
- Repo: `jrconway3/Universal-LPC-spritesheet`. Raw base:
  `https://raw.githubusercontent.com/jrconway3/Universal-LPC-spritesheet/master`.
- `body/male/light.png` and `body/female/light.png` exist, each **832×1344** px.
- Standard LPC frame = **64×64** px → sheet is **13 cols × 21 rows**.
- **Walk-cycle rows** are 4 directions, 9 frames each: row **8 = up, 9 = left, 10 = down,
  11 = right**; **col 0 = standing/idle frame**, cols 1–8 = the 8 walk frames.
- Base body sheets are skin-only (effectively nude) → a decent look needs **legs + torso**
  on top; **hair** is a strong nice-to-have.
- `torso/`, `legs/`, `hair/` exact filenames are **not known** (guessed paths 404'd) and
  **must be discovered** from the repo tree before downloading.
- License files in the repo root: `cc-by-sa-3.0.txt`, `gpl-3.0.txt`, `AUTHORS.txt`.

## Proposed Design

### Composition strategy — runtime layer stacking over a fixed variant table
Two options were considered:
- **(a) Pre-compose** each variant into one flattened sheet at author time. Rejected: needs
  offline image tooling (node-canvas / GIMP) and a build step this project doesn't have.
- **(b) Stack layers at runtime** — load each layer PNG (body, legs, torso, hair) as an
  `HTMLImageElement` and, per frame, blit the same `(row, col)` sub-rect of every layer to
  the same destination. **Chosen.** No offline tooling; the browser composites. Cost is a
  few extra `drawImage` calls per avatar per frame — negligible for ≤8 avatars × ≤4 layers.

Variety comes from a **fixed table of 6 pre-made variants** (what the user picks from),
each variant being an ordered list of layer URLs. This gives the "pick a premade character"
UX of (a) with the authoring simplicity of (b).

### Chosen layers & variants
- **Layers per character (bottom→top draw order):** `body` → `legs` → `torso` → `hair`.
  `body` + `legs` + `torso` are **required** (clothed, not nude); `hair` recommended.
- **Asset set to vendor** (small): 2 bodies (`male/light`, `female/light`), ~3 `legs`,
  ~3 `torso`, ~3 `hair` — exact files chosen in Unit 1 from the live tree.
- **6 variants** defined as combinations of the above (e.g. male/female × a few
  torso/legs/hair colors). IDs are stable strings, e.g. `m1`, `m2`, `m3`, `f1`, `f2`, `f3`.

### Asset location & attribution
- Under `client/public/sprites/`:
  - `client/public/sprites/lpc/body/<file>.png`, `.../legs/`, `.../torso/`, `.../hair/`
    → served at URLs like `/sprites/lpc/body/male_light.png`.
  - `client/public/sprites/LICENSE/cc-by-sa-3.0.txt`, `gpl-3.0.txt`, `AUTHORS.txt`
    (copied verbatim from the repo — CC-BY-SA requires carrying the license + attribution).
  - `client/public/sprites/CREDITS.md` — attribution: source repo, authors (from
    `AUTHORS.txt`), license names + links, and the share-alike notice.

### Sprite module (new `client/src/sprites.ts`) — pure logic + loader
Pure, unit-testable:
- `export type Direction = 'up' | 'left' | 'down' | 'right';`
- `export const FRAME_SIZE = 64;`
- `export const WALK_FRAMES = 8;` (cols 1–8)
- `export const FRAME_MS = 100;` (~10 fps walk cadence)
- `export const WALK_ROW: Record<Direction, number> = { up: 8, left: 9, down: 10, right: 11 };`
- `directionFromDelta(dx, dy, prev: Direction): Direction` — if `|dx|,|dy|` are both below a
  small epsilon, return `prev` (idle keeps facing); else pick the **dominant axis**
  (`|dx| >= |dy|` → left/right by sign of `dx`, else up/down by sign of `dy`). Note screen
  y grows downward: `dy > 0` ⇒ `down`, `dy < 0` ⇒ `up`.
- `walkFrameIndex(animMs: number, moving: boolean): number` — `moving` →
  `1 + Math.floor(animMs / FRAME_MS) % WALK_FRAMES` (cols 1–8 cycle); idle → `0` (standing).
- `export interface Variant { id: string; label: string; layers: string[]; }`
- `export const VARIANTS: Variant[]` — the 6 variants, `layers` = ordered absolute URLs
  (`/sprites/lpc/...`).
- `export const DEFAULT_VARIANT = VARIANTS[0].id;`

Loader (same module, non-pure):
- An image cache keyed by URL returning `HTMLImageElement` (set `.src`, resolve on `load`).
- `preloadVariants(ids: string[]): Promise<void>` — preload every layer image for the given
  variant ids (idempotent via the cache).
- `drawVariant(ctx, variantId, dir, col, destX, destY)` — for each layer URL in the variant,
  if its image is loaded, `drawImage(img, col*64, WALK_ROW[dir]*64, 64, 64, destX, destY,
  64, 64)`. Skip layers not yet loaded (no throw).

### Rendering integration (`client/src/render.ts`, `client/src/game.ts`)
- **Scale/anchor:** 64×64 sprite over a 32 px tile → the sprite is 2 tiles wide. Draw it
  **feet-anchored, centered** on the avatar's tile point `(px, py) = (x*TILE_SIZE,
  y*TILE_SIZE)`: `destX = px - FRAME_SIZE/2` (= `px - 32`), `destY = py - FRAME_SIZE +
  FOOT_OFFSET`, where `FOOT_OFFSET` (~`+16`) drops the frame so the character's feet sit on
  the tile point rather than the frame's bottom edge. Exact offset tuned during manual check.
- `render.ts`: add `drawSprite(ctx, variantId, dir, col, x, y)` (does the anchor math + calls
  `drawVariant`) and `drawNameLabel(ctx, x, y, name)` (the existing label logic extracted so
  sprites keep labels). Keep `drawAvatar` as a fallback for not-yet-loaded sheets.
- `game.ts`: extend the self object and `RemoteAvatar` with `variant: string`, `dir:
  Direction` (default `'down'`), `animMs: number`, and previous-position tracking
  (`px/py` or `prevX/prevY`) to derive the per-frame movement delta.
  - **Self:** delta = `self.x - prevX`, `self.y - prevY` this frame; `moving` = delta beyond
    epsilon (or keyboard input active). Update `dir = directionFromDelta(dx, dy, dir)`;
    accumulate `animMs += dt*1000` while moving, reset to `0` when idle.
  - **Remotes:** same, using the **interpolated** delta (`r.x - r.prevX`) computed after the
    lerp at `game.ts:141`. Remotes thus animate from their visible motion.
  - In `render` (`game.ts:175`), replace each `drawAvatar(...)` with
    `drawSprite(ctx, a.variant, a.dir, walkFrameIndex(a.animMs, a.moving), a.x, a.y)` plus
    `drawNameLabel(...)`. Keep the proximity ring (`drawRing`, `game.ts:191`) and the
    `bubbles.place` call unchanged.
- **Preload:** `Game` calls `preloadVariants([...unique variant ids including self])` at
  `start()` and when new peers arrive; until a sheet is loaded, `drawVariant` draws nothing
  for that layer, so fall back to `drawAvatar` disc if the whole variant is unloaded.

### Join screen (`client/src/main.ts`)
- Replace the `<input type="color">` (`main.ts:37`) with a **variant picker**: a row of
  clickable tiles, one per `VARIANTS` entry, each a small canvas/`<img>` showing that
  variant's **standing frame** (`dir='down'`, `col=0`). Clicking selects (visual highlight);
  default = `DEFAULT_VARIANT`.
- `join()` passes the selected `variant` id through `NetClient.connect` and `startGame`.
- `color` is now vestigial in the UI; `main.ts` sends a fixed default color constant (e.g.
  `'#4f8cff'`) so the still-required `color` field and any color-dependent code keep working
  with no server/type churn.

### Protocol change (`shared/src/protocol.ts`)
Add one field, `variant: string`, to the two shapes that carry identity. Pre-release, so no
versioning/back-compat shim — just add the field:
- `JoinMsg` (`protocol.ts:26`): add `variant: string;` (after `color`).
- `PeerState` (`protocol.ts:12`): add `variant: string;` (after `color`).
- `presence-snapshot`, `peer-joined` already carry full `PeerState` → no change to those
  message types.
- `server/src/index.ts:47`: copy `msg.variant` into the new `PeerState`. No other server
  change (relay is generic).

### Tiles (optional stretch — NOT in this addendum)
To later replace the flat drawn floor/walls (`render.ts:18` `drawMap`) with a tileset, good
**CC0** sources are **Kenney** (kenney.nl, e.g. "Roguelike/RPG" top-down packs) and the
**LPC base tiles**. Noted only; do not implement here.

## Scope
- **In scope:** vendoring LPC layers + license/credits; a sprite module (pure logic +
  loader); feet-anchored animated sprite rendering for local + remote avatars; walk
  animation driven by movement delta; join-screen variant picker; one `variant` protocol
  field + server copy; pure-logic unit tests.
- **Out of scope:** tileset floor/walls; emotes/sit/other LPC animation rows; per-user
  custom layer mixing in the UI (fixed variant table only); runtime color tinting; mobile.

## Interfaces / Models / Endpoints
```ts
// shared/src/protocol.ts — additions
export interface JoinMsg  { type: 'join'; name: string; color: string; variant: string; room?: string; }
export interface PeerState { id: PeerId; name: string; color: string; variant: string; x: number; y: number; }

// client/src/sprites.ts — new
export type Direction = 'up' | 'left' | 'down' | 'right';
export const FRAME_SIZE = 64;
export const WALK_FRAMES = 8;
export const FRAME_MS = 100;
export const WALK_ROW: Record<Direction, number>;
export function directionFromDelta(dx: number, dy: number, prev: Direction): Direction;
export function walkFrameIndex(animMs: number, moving: boolean): number;
export interface Variant { id: string; label: string; layers: string[]; }
export const VARIANTS: Variant[];
export const DEFAULT_VARIANT: string;
export function preloadVariants(ids: string[]): Promise<void>;
export function drawVariant(ctx: CanvasRenderingContext2D, variantId: string, dir: Direction, col: number, destX: number, destY: number): void;

// client/src/render.ts — additions
export function drawSprite(ctx: CanvasRenderingContext2D, variantId: string, dir: Direction, col: number, x: number, y: number): void;
export function drawNameLabel(ctx: CanvasRenderingContext2D, x: number, y: number, name: string): void;
```

## Impact Analysis
- **Tests:** new `client/test/sprites.test.ts` (directionFromDelta, walkFrameIndex, variant
  integrity). No existing test imports `variant`, so adding the required field only touches
  code that *constructs* `JoinMsg`/`PeerState` — `main.ts` and `server/src/index.ts` (and any
  server test that builds a `PeerState` literal, if present — check `server/test/room.test.ts`
  and update the literal if it exists). Sprite drawing is manual-only.
- **Dependencies:** none added (plain `HTMLImageElement` + canvas `drawImage`).
- **Back-compat:** none needed (pre-release, single deploy). Old clients would omit
  `variant`; not a concern.
- **Perf:** ≤8 avatars × ≤4 layers × 1 `drawImage`/frame = trivial. Preload a handful of
  PNGs once. Set `ctx.imageSmoothingEnabled = false` once so pixel art stays crisp when
  scaled.
- **Failure modes:** sheet not yet loaded → layer skipped / disc fallback (no throw);
  unknown `variant` id → fall back to `DEFAULT_VARIANT`.
- **Legal:** CC-BY-SA 3.0 requires attribution + share-alike → license files + `CREDITS.md`
  vendored alongside the art (Unit 1). Do **not** use Habbo/Gather proprietary art.

## Implementation Units
Dependency-ordered, ~50 LOC each. "(MANUAL)" = needs two-tab [M] browser verification.

1. **Vendor LPC assets** — files: `client/public/sprites/lpc/{body,legs,torso,hair}/*.png`,
   `client/public/sprites/LICENSE/{cc-by-sa-3.0.txt,gpl-3.0.txt,AUTHORS.txt}`,
   `client/public/sprites/CREDITS.md` — change: **first list the real folder contents via the
   GitHub API** (`https://api.github.com/repos/jrconway3/Universal-LPC-spritesheet/contents/<dir>?ref=master`
   for `legs`, `torso`, `hair` — filenames are unknown and guessed paths 404), pick 2 bodies
   + ~3 legs + ~3 torso + ~3 hair, download their raw PNGs + the 3 license files, and write
   `CREDITS.md` (source, authors, licenses, share-alike notice) — acceptance: files present;
   each PNG opens; CREDITS + licenses included. (Author-time task, not app code.)
2. **Sprite pure logic + variant table** — files: `client/src/sprites.ts` — change:
   `Direction`, constants, `WALK_ROW`, `directionFromDelta`, `walkFrameIndex`, `Variant`,
   `VARIANTS` (6 combos referencing the Unit-1 URLs), `DEFAULT_VARIANT` — acceptance:
   compiles; imported without error.
3. **Sprite logic tests** — files: `client/test/sprites.test.ts` — change: cover
   `directionFromDelta` (each axis/sign, idle-keeps-prev), `walkFrameIndex` (idle=0, cycles
   1–8, wraps), and variant integrity (ids unique & non-empty, every `layers` non-empty,
   every URL starts `/sprites/`) — acceptance: `npm test` green.
4. **Protocol `variant` field** — files: `shared/src/protocol.ts` — change: add
   `variant: string` to `JoinMsg` and `PeerState` — acceptance: `tsc --noEmit` passes
   across workspaces (will surface the construct sites to fix next).
5. **Server copies variant** — files: `server/src/index.ts` (+ `server/test/room.test.ts` if
   it builds a `PeerState` literal) — change: set `variant: msg.variant` in the join
   `PeerState` at `index.ts:47`; fix any test literal — acceptance: server typecheck + tests
   green.
6. **Sprite loader + draw helpers** — files: `client/src/sprites.ts` (loader half),
   `client/src/render.ts` — change: image cache + `preloadVariants` + `drawVariant` in
   sprites.ts; `drawSprite` (feet-anchored: `destX=px-32`, `destY=py-FRAME_SIZE+FOOT_OFFSET`)
   and `drawNameLabel` in render.ts; set `imageSmoothingEnabled=false` — acceptance:
   compiles; (MANUAL) a standing sprite renders feet-anchored on the tile.
7. **Join variant picker** — files: `client/src/main.ts` (+ `client/index.html` CSS for the
   picker row) — change: replace the color input with a clickable variant grid showing each
   standing frame; thread selected `variant` id into `connect`/`startGame`; send a default
   color constant — acceptance: (MANUAL) picker shows variants; selection highlights; chosen
   id reaches the server.
8. **Game sprite integration** — files: `client/src/game.ts` — change: add `variant/dir/
   animMs` + prev-position tracking to self and `RemoteAvatar`; derive `dir` + `moving` from
   per-frame delta (self) and interpolated delta (remotes); accumulate/reset `animMs`;
   replace `drawAvatar` calls in `render` with `drawSprite` + `drawNameLabel`; call
   `preloadVariants` on start and on `peer-joined`/`presence-snapshot`; store each peer's
   `variant` from presence — acceptance: (MANUAL) two tabs each show the other's chosen
   animated character walking in the correct of 4 directions; idle shows standing frame;
   name labels + proximity ring + video bubbles still work.

## Manual verification (two-tab [M])
- **Unit 6:** a sprite draws, feet on the tile, crisp (no blur).
- **Unit 7:** the join screen shows the variant grid; selecting changes the highlighted
  character; the chosen id is what others render.
- **Unit 8:** full two-tab check — both avatars are pixel characters; walking animates and
  faces the movement direction (up/left/down/right); stopping shows the standing frame;
  remote characters animate from their interpolated motion; labels, ring, and bubbles intact.
Units 2–5 are covered by `npm test` / typecheck (no browser needed).

## Open Questions
- **Hair layer:** include it (recommended) or ship body+legs+torso only if a clean hair file
  is awkward to find? **Assumption:** include hair; drop it per-variant only if no suitable
  file exists.
- **FOOT_OFFSET exact value:** tuned visually in Unit 6. **Assumption:** ~`+16` px.
- **Idle animation:** none (standing frame). **Assumption:** acceptable for MVP look.
