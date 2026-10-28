# Avatar Editor — Join-Screen Customization (Addendum to Avatar Art)

**Status:** Draft
**Date:** 2026-10-28
**Related:** `docs/specs/avatar-art.md` (units A1–A8, implemented), `docs/HANDOFF.md`

## Goal
Replace the fixed 6-variant picker on the join screen with a small **avatar editor**: the
user mixes and matches character layers (body, hair, shirt, pants) with a live preview before
entering, and everyone renders everyone else's custom character. This is a join-screen +
representation change that reuses the existing sprite composition / preload / render pipeline
(`client/src/sprites.ts`, `render.ts`, `game.ts`) — not a rendering rewrite.

## Context & Current State
- Appearance is a single `variant: string` id (`m1`–`f3`) chosen from `VARIANTS`
  (`client/src/sprites.ts:45`), each a fixed ordered list of layer PNG URLs. It travels in
  `JoinMsg` and `PeerState` (`shared/src/protocol.ts:17,31`), is copied into presence by the
  server (`server/src/index.ts:52`), and drives composition via `drawVariant` /
  `variantReady` / `preloadVariants` (`sprites.ts:128,144,152`).
- The join screen renders a 3-col grid of the 6 variants, each a 64×64 canvas standing frame
  (`client/src/main.ts:34-75`); selection is threaded into `net.connect` + `Game`.
- Rendering composes layers per frame feet-anchored: `drawSprite` (`render.ts:75`) →
  `drawVariant` blits the `(dir,col)` sub-rect of each loaded layer. The image cache is already
  **keyed by layer PNG URL** (`sprites.ts:112`), so arbitrary layer combos cache for free.
- `game.ts` stores `variant` on self + each `RemoteAvatar`, preloads on start / presence /
  peer-joined, and falls back to the disc until `variantReady` (`game.ts:84,130,246,267`).
- Vendored layers (verified present, `client/public/sprites/lpc/`):
  - `body/`: `male_light.png`, `female_light.png` — **light skin only**.
  - `legs/`: `{teal,red,white}_pants_{male,female}.png`.
  - `torso/`: `{teal,maroon,brown}_longsleeve_male.png`, `{teal,maroon,brown}_tunic_female.png`.
  - `hair/`: `{brown,black,blonde}_{male,female}.png` (plain style only).

## Proposed Design

### Representation — structured `appearance` descriptor (replaces `variant`)
Pre-release, so the wire field is broken cleanly. `PeerState.variant: string` and
`JoinMsg.variant: string` are **replaced** by a structured, typed descriptor:

```ts
// shared/src/protocol.ts — canonical, pure data (no rendering concern)
export interface Appearance {
  body: 'male' | 'female';            // sex; light skin only (asset limit)
  hair: 'brown' | 'black' | 'blonde' | 'none'; // 'none' = omit the hair layer
  torso: 'teal' | 'maroon' | 'brown'; // shirt color (style auto by body)
  legs: 'teal' | 'red' | 'white';     // pants color
}
```

Chosen over a serialized composite-id string in the `variant` field because it is typed,
self-documenting, validated at the boundary, and travels naturally as JSON in `JoinMsg` /
`PeerState` (both `presence-snapshot` and `peer-joined` carry full `PeerState`, so it
propagates with no new message types). A compact serialized form (`body.hair.torso.legs`) is
still provided — but only for **localStorage persistence** and preset keys, not the wire.

`body` doubles as the **style selector**: `male` → longsleeve shirt, `female` → tunic; and it
selects the sex-specific `legs`/`hair` file. So the 4 editable axes map onto the vendored set
exactly: 2 × 4 × 3 × 3 = **72 combinations**, no new assets required.

### Layer resolution (`client/src/sprites.ts`)
`appearanceToLayers(a)` builds the ordered (bottom→top) URL list:
- body: `/sprites/lpc/body/${a.body}_light.png`
- legs: `/sprites/lpc/legs/${a.legs}_pants_${a.body}.png`
- torso: `/sprites/lpc/torso/${a.torso}_${a.body === 'male' ? 'longsleeve' : 'tunic'}_${a.body}.png`
- hair: `a.hair === 'none'` → omit; else `/sprites/lpc/hair/${a.hair}_${a.body}.png`

Composition, preload, and ready-check become appearance-driven but reuse the **URL-keyed
cache** unchanged: `drawAppearance(ctx, a, dir, col, destX, destY)` iterates
`appearanceToLayers(a)`; `preloadAppearance(a)` / `appearanceReady(a)` likewise. Because the
cache is per-PNG, two avatars sharing a body or hair file share one `Image`.

### Validation / normalization / serialization (`client/src/sprites.ts`)
- `normalizeAppearance(x: unknown): Appearance` — coerce each field to a valid option, missing
  / invalid → the `DEFAULT_APPEARANCE` value for that field. Applied **defensively on every
  inbound peer appearance** (`makeRemote` / presence) and on localStorage load. (Server keeps
  the existing trust model — it just copies the field, consistent with `name`/`color`.)
- `serializeAppearance(a): string` → `"${a.body}.${a.hair}.${a.torso}.${a.legs}"`.
- `parseAppearance(s: string): Appearance` → split + `normalizeAppearance` (invalid → default).
- `shuffleAppearance(rand: () => number = Math.random): Appearance` — pick a random option per
  category from the option tables. Deterministic for a seeded `rand` (unit-tested).

### Editor data tables (`client/src/sprites.ts`)
- Per-axis option arrays: `BODY`, `HAIR`, `TORSO`, `LEGS` (the literal unions above).
- `CATEGORIES: { key: keyof Appearance; label: string; options: readonly string[] }[]` — drives
  the UI's per-category controls generically (`[{key:'body',label:'Body'},{key:'hair',
  label:'Hair'},{key:'torso',label:'Shirt'},{key:'legs',label:'Pants'}]`).
- `PRESETS: { id: string; label: string; appearance: Appearance }[]` — the **old 6**
  (`m1`–`f3`) re-expressed as `Appearance` objects, offered as quick-start buttons.
- `DEFAULT_APPEARANCE: Appearance` = `PRESETS[0].appearance` (the old `m1`).
- `ALL_LAYER_URLS: string[]` + `preloadAll(): Promise<void>` — the full (~20) vendored PNG set,
  preloaded once at editor init so cycling categories redraws the preview instantly.

### Editor UI (`client/src/main.ts` + `client/index.html` CSS)
`renderJoin` holds a mutable `appearance` (from localStorage else `DEFAULT_APPEARANCE`) and:
- A **live preview**: a canvas drawing the standing frame (`dir='down'`, `col=0`) via
  `drawAppearance`; a `redraw()` helper re-blits after any change. `preloadAll()` runs once,
  then the initial `redraw()`.
- **Per-category controls**: one row per `CATEGORIES` entry — prev/next arrows (`◀ label ▶`)
  that cycle that axis's options (wrap-around), updating `appearance[key]` + `redraw()`.
- A **Shuffle** button → `appearance = shuffleAppearance(); redraw()`.
- **Preset** quick-start buttons (the 6 `PRESETS`) → set `appearance` + `redraw()`.
- Name input + Join button (unchanged flow). Join threads `appearance` into `net.connect` and
  `startGame`; `color` stays a fixed `DEFAULT_COLOR` constant for the disc fallback.

### Rendering integration (`render.ts`, `game.ts`)
- `drawSprite(ctx, appearance, dir, col, x, y)` — signature changes from `variantId` to
  `Appearance`, calls `drawAppearance`. Feet-anchor math unchanged.
- `game.ts`: `SelfInfo` + self object + `RemoteAvatar` store `appearance: Appearance` instead
  of `variant`. `makeRemote` runs `normalizeAppearance(p.appearance)`. `preloadAppearance`
  replaces `preloadVariants` on `start()` / `presence-snapshot` / `peer-joined`.
  `drawCharacter` uses `appearanceReady(a)` + `drawSprite(ctx, a, ...)`; disc fallback intact.

### Optional extra assets (NOT in default scope)
Keep the default set modest (personal project). If more skin tones / hair styles are later
wanted: first **list real paths via the GitHub API**
(`https://api.github.com/repos/jrconway3/Universal-LPC-spritesheet/contents/<dir>?ref=master`),
download the raw PNGs, extend the option unions + `appearanceToLayers`, and update
`client/public/sprites/CREDITS.md` + license files (CC-BY-SA 3.0 share-alike). Captured as
optional Unit E0 below.

## Scope
- **In scope:** structured `appearance` protocol field (replacing `variant`); appearance
  resolution/validation/serialization/shuffle + editor data tables in `sprites.ts`;
  appearance-driven preload/compose/ready; join-screen editor (live preview, per-category
  cycling, shuffle, presets); render + game integration; optional localStorage persistence;
  pure-logic Vitest coverage.
- **Out of scope:** new LPC assets / extra skin tones / hair styles (Unit E0, optional); skin
  tinting; emotes/sit animations; mobile layout; changes to `media.ts` (self-camera-preview fix
  is handled concurrently elsewhere — **do not touch `media.ts`**).

## Interfaces / Models (exact)
```ts
// shared/src/protocol.ts
export interface Appearance {
  body: 'male' | 'female';
  hair: 'brown' | 'black' | 'blonde' | 'none';
  torso: 'teal' | 'maroon' | 'brown';
  legs: 'teal' | 'red' | 'white';
}
export interface JoinMsg   { type: 'join'; name: string; color: string; appearance: Appearance; room?: string; }
export interface PeerState { id: PeerId; name: string; color: string; appearance: Appearance; x: number; y: number; }

// client/src/sprites.ts (new/changed)
import type { Appearance } from '@byte_grounds/shared/protocol';
export const BODY, HAIR, TORSO, LEGS: readonly string[];
export const CATEGORIES: { key: keyof Appearance; label: string; options: readonly string[] }[];
export const PRESETS: { id: string; label: string; appearance: Appearance }[];
export const DEFAULT_APPEARANCE: Appearance;
export const ALL_LAYER_URLS: string[];
export function appearanceToLayers(a: Appearance): string[];
export function normalizeAppearance(x: unknown): Appearance;
export function serializeAppearance(a: Appearance): string;
export function parseAppearance(s: string): Appearance;
export function shuffleAppearance(rand?: () => number): Appearance;
export function preloadAppearance(a: Appearance): Promise<void>;
export function preloadAll(): Promise<void>;
export function appearanceReady(a: Appearance): boolean;
export function drawAppearance(ctx: CanvasRenderingContext2D, a: Appearance, dir: Direction, col: number, destX: number, destY: number): void;

// client/src/render.ts (changed)
export function drawSprite(ctx: CanvasRenderingContext2D, a: Appearance, dir: Direction, col: number, x: number, y: number): void;
```

## Impact Analysis
- **Protocol/server:** `variant` → `appearance` object breaks construct sites: `main.ts`,
  `server/src/index.ts:52`, `server/test/room.test.ts` literal, `game.ts` (SelfInfo + self +
  remotes). Pre-release → no back-compat shim.
- **Tests:** `client/test/sprites.test.ts` is **replaced** (it imports the removed `VARIANTS`/
  `DEFAULT_VARIANT`). Keep the still-valid `directionFromDelta` / `walkFrameIndex` cases; add
  the new appearance cases. `server/test/room.test.ts` literal updated.
- **Perf:** full vendored set is ~20 PNGs; `preloadAll()` once at editor init. Per-frame cost
  unchanged (≤4 `drawImage` per avatar; shared PNGs cached once). `imageSmoothingEnabled=false`
  already set in `drawSprite`.
- **Failure modes:** unknown/garbage inbound appearance → `normalizeAppearance` → valid
  default; `hair:'none'` → hair layer omitted (no 404); layers mid-load → disc fallback.
- **Intentional-red windows (A-series precedent):** `shared`+`server` stay green from E2 on;
  `client` typecheck is red between E6 (drawSprite signature change) and E7 (game.ts migration)
  until E7 lands — expected, mirrors the avatar-art rollout.
- **Legal:** no new assets in default scope → no CREDITS change unless E0 is taken.

## Implementation Units
Dependency-ordered, ~50 LOC each. "(MANUAL)" = needs browser [M] verification.

1. **E1 — Appearance type + protocol field** — files: `shared/src/protocol.ts` — change: add the
   `Appearance` interface; replace `variant: string` with `appearance: Appearance` in `JoinMsg`
   and `PeerState` — acceptance: `tsc --noEmit` (shared) passes; surfaces the construct sites.
2. **E2 — Server copies appearance** — files: `server/src/index.ts`, `server/test/room.test.ts`
   — change: `appearance: msg.appearance` in the join `PeerState` (replace `variant` at
   `index.ts:52`); update the test literal to an `appearance` object — acceptance: server
   typecheck + `npm test` green.
3. **E3a — Appearance options, resolution, presets** — files: `client/src/sprites.ts` — change:
   import `Appearance`; add `BODY/HAIR/TORSO/LEGS`, `CATEGORIES`, `appearanceToLayers`,
   `PRESETS` (old 6 as appearances), `DEFAULT_APPEARANCE`, `ALL_LAYER_URLS` — acceptance:
   compiles.
4. **E3b — Normalize / serialize / shuffle** — files: `client/src/sprites.ts` — change:
   `normalizeAppearance`, `serializeAppearance`, `parseAppearance`, `shuffleAppearance` —
   acceptance: compiles.
5. **E4 — Appearance-driven loader** — files: `client/src/sprites.ts` — change: `drawAppearance`,
   `preloadAppearance`, `preloadAll`, `appearanceReady` (reuse the URL-keyed cache); remove the
   now-dead `VARIANTS`/`DEFAULT_VARIANT`/`drawVariant`/`variantReady`/`preloadVariants` exports —
   acceptance: sprites.ts compiles (client overall red until E6/E7 migrate consumers).
6. **E5 — Sprite logic tests** — files: `client/test/sprites.test.ts` — change: keep
   direction/frame cases; add `normalizeAppearance` (invalid→default), serialize↔parse
   round-trip, `shuffleAppearance` determinism with a seeded `rand`, `appearanceToLayers`
   (male→longsleeve, female→tunic, `hair:'none'` omits the hair URL, all start `/sprites/`),
   `PRESETS`/`DEFAULT_APPEARANCE` integrity — acceptance: `npm test` green.
7. **E6 — render.ts drawSprite by appearance** — files: `client/src/render.ts` — change:
   `drawSprite` takes `Appearance` and calls `drawAppearance` (anchor math unchanged); drop the
   `drawVariant` import — acceptance: render.ts compiles (surfaces game.ts).
8. **E7 — game.ts appearance integration** — files: `client/src/game.ts` — change: `SelfInfo` +
   self + `RemoteAvatar` store `appearance`; `makeRemote` runs `normalizeAppearance`;
   `preloadAppearance` on start / presence / peer-joined; `drawCharacter` uses
   `appearanceReady` + `drawSprite(ctx, a, ...)` — acceptance: client typecheck + build green;
   (MANUAL) self + remotes render their custom character.
9. **E8a — Editor scaffold + live preview** — files: `client/src/main.ts`, `client/index.html`
   (CSS) — change: `renderJoin` holds an `appearance` state (default `DEFAULT_APPEARANCE`), a
   preview canvas drawing the standing frame via `drawAppearance` with a `redraw()` helper,
   `preloadAll()` then initial draw; `join`/`startGame` thread `appearance` into `connect`/
   `Game` — acceptance: (MANUAL) join screen shows a live preview of the default character.
10. **E8b — Category controls + shuffle + presets** — files: `client/src/main.ts`,
    `client/index.html` (CSS) — change: per-`CATEGORIES` prev/next cycling (wrap) updating
    `appearance` + `redraw()`; a Shuffle button (`shuffleAppearance`); the 6 `PRESETS` as
    quick-start buttons — acceptance: (MANUAL) cycling any axis / shuffle / preset updates the
    live preview immediately; chosen appearance reaches the server.
11. **E9 — Persistence (optional)** — files: `client/src/main.ts` — change: on editor init load
    `localStorage['byte_grounds.appearance']` via `parseAppearance` (fallback default); on join save
    `serializeAppearance(appearance)` — acceptance: (MANUAL) reload keeps the last-used look.
12. **E0 — Extra LPC assets (OPTIONAL, author-time, skipped by default)** — files:
    `client/public/sprites/lpc/**`, `CREDITS.md`, license files, `sprites.ts` option unions —
    change: list real paths via the GitHub API, vendor extra skin tones / hair styles, extend
    the unions + `appearanceToLayers`, update CREDITS (CC-BY-SA share-alike) — acceptance: new
    PNGs open; CREDITS updated; new options cycle in the editor. Do NOT take unless requested.

## Manual verification (browser [M])
- **E7:** self and a second-tab peer each render their own customized character; walk animation,
  facing, name label, proximity ring, and video bubbles still work; disc shows only pre-load.
- **E8a:** join screen shows a live standing-frame preview of the default character.
- **E8b:** prev/next on Body/Hair/Shirt/Pants, Shuffle, and the 6 preset buttons each update the
  preview instantly; the character you built is what the other tab renders.
- **E9:** reload the page → the editor restores your last-used appearance.
Units E1–E6 are covered by `npm test` + typecheck (no browser).

## Open Questions
- **Skin tones:** only `light` is vendored → body axis is sex-only for now. Add tones via E0 if
  wanted. **Assumption:** light-only is fine for MVP.
- **Hair style:** only `plain` vendored → hair axis is color + `none`. **Assumption:** fine.
- **Controls style:** prev/next arrows (compact, generic over `CATEGORIES`) vs. swatch rows.
  **Assumption:** arrows; swatches are a trivial later swap.
- **Server validation:** server trusts the client (as with `name`/`color`); clients normalize on
  ingress. **Assumption:** acceptable for a personal, friends-only app.
