# ByteGrounds — HANDOFF

**Last updated:** 2026-10-29 (sit & side-lie poses, uncommitted)
**Branch:** master (git initialized)

## Sit & side-lie poses — UNITS 1–3, 5–11 DONE, UNCOMMITTED (2026-10-29)
Spec: `docs/specs/sit-lie-poses.md`. Branch `claude/nifty-archimedes-e4o1ce`. **Not committed /
not pushed — awaiting the user's review of the preview PNGs.** `npm test` → **103 green** (was 96:
+3 lieTransform, +4 sit layers/frame); `npm run typecheck --workspace client` + `npm run build` green.
- **U1–3 side-lie:** `sprites.ts` pure `lieTransform(dir)` (left/up → `right` frame +π/2; right/down →
  `left` frame −π/2; side picked by source frame, belly toward viewer) + `LIE_SHIFT = 8`.
  `render.ts` lie branch draws the profile frame rotated, shifted `LIE_SHIFT` along `dir`;
  `LIE_ROTATION` + `down`-frame draw removed. Tests lock the table + feet/belly vectors.
- **U5 recon:** sanderfrenken generator has `sit` rows for body + pants (extended 832×2944 sheets,
  body is headless there), but longsleeve/tunic/vest/sash-dress are plain 832×1344 (no sit) and our
  formal/pink/navy are our own derivatives → no complete drop-in set. Synthesis kept.
- **U6–8 sit sheets:** `tools/gen_pose_sheets.py` (Pillow; `--preview OUT_DIR`). Profile bend for
  left/right (torso kept, lowered `SEAT_DROP`; front-leg thigh band rotated 90°, stretched,
  knee/underside outlined; front lower leg hung under the knee), row-cut squash for up/down.
  Final constants: `HIP_Y=48 KNEE_Y=56 SHIN_Y=52 THIGH_X0,X1=33,39 SHIN_X0=31 THIGH_LEN=16
  THIGH_AT=(28,47) SHIN_DX=6 SEAT_DROP=4 SQUASH_Y0,Y1=46,52`. Generated 32 sheets (256×64, cols
  up/left/down/right) under `client/public/sprites/lpc/sit/{body,legs,torso,hair}/`;
  `client/public/sprites/CREDITS.md` entry (CC-BY-SA 3.0 derivatives, original authors kept).
- **U9–11 compose:** `appearanceToLayers(a, pose='stand')` (sit → `sit/` subtree), `sitFrame(dir)`,
  `ALL_LAYER_URLS` + `preloadAppearance` include sit layers; `drawSitAppearance` (shared
  `blitLayers`); render sit branch feet-anchored like standing; `SIT_DROP` removed.
- Previews (session scratchpad, 4× nearest): `scratchpad/poses/preview_{sit,lie,stand}.png`.
- Known weaknesses: up/down sit is a squash (reads as short legs, not a clear bend); up/down lie
  is the horizontal fallback and overhangs a vertical bed; female formal dress turns into a
  white "hem blob" at the feet in profile sit; lie uses the walk-idle stride (legs slightly apart);
  `appearanceReady` still only checks stand layers (sit layers preload together, so a gap is unlikely).
- **Pending:** U4 + U12 manual two-tab checks; user preview approval; commit.

## Furniture depth + pose fix — UNITS 1–7 DONE (2026-10-28)
Spec: `docs/specs/furniture-depth-pose-fix.md`. All 7 units implemented, committed, and pushed to
`claude/nifty-archimedes-e4o1ce`. `npm test` → **96 tests green** (was 88: +4 depth, +4 shared
layer/parseMap); `npm run typecheck --workspace client` + `npm run build` green. No protocol/network
change; existing maps render via `decorLayer` inference (no re-tag/migration).

What shipped:
- **U1** `shared/src/map.ts`: `DecorCell.layer?: 'floor'|'object'`; `parseMap` keeps a valid layer,
  strips junk (+ shared test).
- **U2** `shared/src/map.ts`: pure `decorLayer(map, cell)` = `cell.layer ?? (tileAt==1?'object':'floor')`
  (+ shared test).
- **U3** `client/src/depth.ts` (new) + `client/test/depth.test.ts`: `decorAnchorY` (`y+0.5`),
  `avatarAnchorY` (`y`), stable `sortRenderables` (anchor asc; tie → decor before avatar).
- **U4** `client/src/render.ts`: `drawMap` draws tiles+grid+**floor** decor only; new
  `drawDecorCellAt` + `drawObjectDecorFlat`.
- **U5** `client/src/render.ts`+`sprites.ts`: full-body **sit** (standing frame, col 0, lowered
  `SIT_DROP`, no crop) and **lie** (standing `down` frame rotated to point `dir`, half-tile shift).
  Removed dead `SIT_KEEP`/`LIE_COL`/`LIE_ROW` and now-unused `drawAppearanceRegion`. **[M]**
  - Lie rotation chosen: `down:0, up:π, left:+π/2, right:-π/2` (standing feet point south). The
    left/right sign is a visual guess — **flip left/right if a body lies head-first** (see checklist).
- **U6** `client/src/game.ts` `render()`: merged y-sorted pass over object-decor + all avatars
  (remotes + self), `sortRenderables`, draw back-to-front (prox ring then sprite); **final pass**
  draws all name labels + places/volumes bubbles so furniture never covers names/bubbles. Added a
  shared `Avatar` interface (self + `RemoteAvatar extends Avatar`); `drawAvatar` no longer draws the
  name (names are the top pass). **[M]**
- **U7** `client/src/editor-model.ts`: `stampDecor` writes `layer: block?'object':'floor'`;
  `editor.ts` `draw()` calls `drawObjectDecorFlat` after `drawMap`; `editor-model.test.ts`
  expectations updated (block=true cells → `layer:'object'`).

### Two-tab / browser manual checklist (units 5, 6, 7 — NOT exercised here)
1. Sit on a **plain chair** (no desk in front) → full body with **feet visible**, settled on the seat.
2. Sit on a chair with a **desk one tile below (in front, facing down)** → desk draws **over** the
   legs/feet (reads as sitting at the desk); chair stays behind.
3. Walk a standing avatar **behind** a desk/table (row above) → occluded; **in front** (row below) →
   draws over it.
4. **Lie on a bed** → whole body incl. **feet**, flat, feet pointing the seat `dir`; bed stays under.
   **If the body lies head-first, flip the left/right rotation sign** in `render.ts` `LIE_ROTATION`.
5. Second tab: a remote seated/lying/occluded avatar renders identically; **name labels never covered**
   by furniture; proximity rings + video bubbles still track.
6. Editor: all furniture still shows; stamp with "Block tiles under it" ON → occludes (object), OFF →
   stays under (floor).
7. An **existing saved map** (no `layer` fields) still renders: solid tables now occlude seated
   avatars; rugs/beds stay under (inference check).

## Project rename (2026-10-28)
Renamed in-place from "business_city" to **ByteGrounds** (top-level folder path unchanged:
`C:/Users/felip/repositories/business_city`). Display/product name → `ByteGrounds`; identifiers
→ `byte_grounds`; npm scope `@bc/*` → `@byte_grounds/*` (root + shared/server/client `package.json`
names, `@byte_grounds/shared` dependency, all `@byte_grounds/shared/{protocol,map}` imports, and the
`exports` subpaths — unchanged, still `./protocol`/`./map`). No tsconfig `paths` or vite aliases
existed; resolution is via workspace symlinks + the `exports` map, both regenerated by `npm install`.
localStorage key `bc.appearance` → `byte_grounds.appearance` (pre-release, no migration kept).
`docs/specs/business-city-mvp.md` → `docs/specs/byte-grounds-mvp.md` (git mv). Intentionally kept:
the literal folder path and dir-tree root `business_city/` in `byte-grounds-mvp.md` (folder not
renamed). After rename: `npm install`, `npm run build`, `npm run typecheck --workspace client`, and
`npm test` (52 tests) all green.

## Decor sheets fetched (2026-10-28) — AWAIT LICENSE REVIEW + COMMIT
Fetched LPC-style office/home furniture tile sheets from OpenGameArt into
`client/src/assets/decor/` (uncommitted). **Do not commit until the orchestrator reviews licenses.**
New files + their packs/authors/licenses are in `client/src/assets/decor/CREDITS.md`:
- `office.png` — assembled from "[LPC Revised] The Office" item sprites (Eliza Wyatt / Death's
  Darling, + Lanea Zimmerman / Sharm). OGA-BY 3.0 (page also lists CC-BY-SA 3.0).
- `tables_stools.png` — "Tables & Stools" by Jordan Irwin (AntumDeluge). CC-BY 3.0 / OGA-BY 3.0.
- `interior_tiles.png` — "Interior Tiles" by Connor Sherson. CC-BY-SA 3.0 / GPL 3.0.
Skipped: **LPC House Insides** (both PNGs byte-identical to existing `house_inside.png`);
**[LPC] Simple Modern Furniture** (all PNGs non-32-multiple dimensions — fail the 32px grid rule).
Fetched pack-page HTML saved for license re-check in the session scratchpad under `scratchpad/`
(`page-*.html`). `npm test` → 77 tests green; `npm run build` green (after `npm install` pulled the
previously-missing `@supabase/supabase-js`).

### More decor sheets fetched (2026-10-28, 2nd pass) — AWAIT LICENSE REVIEW + COMMIT
Added **24 new sheets** (uncommitted) to `client/src/assets/decor/`, all with CREDITS.md entries.
**Do not commit until the orchestrator reviews licenses.** Packs + licenses (all CC-BY-SA / CC-BY / CC0):
- **[LPC Revised] Base Object Kit!** (Eliza Wyatt, Lanea Zimmerman/Sharm, bluecarrot16, Hyptosis;
  CC-BY-SA 3.0 / CC-BY 3.0 / CC0) → `chairs.png`, `armchairs.png`, `bar_stools.png`, `ottomans.png`,
  `sofas.png`, `sofas_formal.png`, `thrones.png`, `beds.png`, `beds_single.png`, `tables.png`,
  `countertops.png`, `decorative_furniture.png` (rugs + clocks), `cabinets.png`, `chests.png`,
  `lamps.png`, `curtains.png`, `pillows.png`, `flowers.png`, `plants.png`, `paintings.png`.
- **[LPC] Wooden Furniture** (bluecarrot16, Baŝto, Lanea Zimmerman/Sharm, William Thompson,
  Tuomo Untinen/Reemax, Janna/Lilius/Jannax; CC-BY-SA 3.0 / 4.0 / GPL 3.0) → `wooden_furniture.png`.
- **[LPC] Tavern** (bluecarrot16, Lanea Zimmerman/Sharm, William.Thompsonj, Jetrel, DCSS Contributors,
  Reemax, Hyptosis, Daniel Eddeland/Daneeklu, BenCreating, Evert, tapatilorenzo; CC-BY-SA 3.0) →
  `tavern_furniture.png`, `tavern_kitchen.png`, `tavern_decor.png`.
Skipped: **RPG Indoor Tileset Expansion 1** (176x192 — not a 32 multiple); **[LPC] Simple Modern
Furniture** (individual sprites, non-32 dims); **[LPC] House Insides** (byte-identical to existing
`house_inside.png`); **Home Objects** (small 192x192, overlaps existing wood sheets). Pack-page HTML
+ pack credits saved in the session scratchpad (`pages/*.html`, `ex/**/Credits*.txt`). `npm test` →
77 tests green; `npm run build` green.

## Avatar-wardrobe progress (W1-W9) — AWAIT LICENSE REVIEW + COMMIT
Implementing `docs/specs/avatar-wardrobe.md` (expanded clothing: outfit axis, more colors,
pink, business/formal). **Do not commit until the orchestrator reviews the new clothing licenses.**
Real LPC assets forced documented deviations from the spec's assumed layout (see CREDITS + report):
no single formal sheet (male formal composited from shirt+vest+tie), no female formal (composited
from underdress+sash dress), formal base color is **green** not navy, and LPC has no navy/pink
pants (recolored from white). Credit sources saved in session scratchpad (`W-credit-sources.md`,
`AUTHORS.txt`, `tree.json`).
- **W1 done** — fetched casual sheets: `torso/white_longsleeve_male.png` (LPC base),
  `torso/white_tunic_female.png` (JaidynReiman). (navy pants unavailable in LPC -> deferred to W3 recolor.)
- **W2 done** — composited business torsos: `torso/green_formal_male.png` (Thane Brimhall formal set),
  `torso/green_formal_female.png` (Sharm underdress + Thane Brimhall sash dress).
- **W3 done** — PIL recolors (CC-BY-SA derivatives): `torso/pink_{longsleeve_male,tunic_female,
  formal_male,formal_female}.png`, `legs/{navy,pink}_pants_{male,female}.png`. All 12 new PNGs
  832x1344, valid signature, alpha preserved.
- **W4 done** — `client/public/sprites/CREDITS.md`: added fetched/composite/recolor tables with
  per-layer authors + share-alike derivative notes.
- **W5 done** — `shared/src/protocol.ts`: `Appearance` gained `outfit:'casual'|'business'`; `torso`
  widened to `teal|maroon|brown|white|pink|green`, `legs` to `teal|red|white|navy|pink`.
  `server/test/room.test.ts` + `client/test/net-supabase.test.ts` fixtures gained `outfit:'casual'`.
- **W6 done** — `client/src/sprites.ts`: `OUTFIT`, `CASUAL_TORSO`, `BUSINESS_TORSO=['green','pink']`,
  widened `TORSO`/`LEGS`, `outfitTorso`, `optionsFor`; `CATEGORIES` widened (+Outfit, functional Top
  options); `appearanceToLayers` outfit branch (business→`formal`) + torso clamp to the outfit palette;
  `ALL_LAYER_URLS` rebuilt from real per-outfit palettes; 6 presets gained `outfit:'casual'` + 2 new
  presets `biz` (green/navy business M) and `pink` (casual pink F).
- **W7 done** — `sprites.ts`: `normalizeAppearance` coerces `outfit`; 5-part `serializeAppearance`
  (`body.hair.outfit.torso.legs`); `parseAppearance` tolerant of legacy 4-part strings; outfit-aware
  `shuffleAppearance` (picks outfit first, torso from that palette).
- **W8 done** — `client/test/sprites.test.ts`: outfit/formal/clamp/pink cases, legacy parse,
  shuffle-in-palette, 8-preset integrity, `ALL_LAYER_URLS` real-file existence + new-layer coverage +
  no-invented-combos. Suite 77→88 tests green; client typecheck + `npm run build` green.
- **W9 done [M]** — `client/src/main.ts`: cycling loop resolves options via `optionsFor(cat,
  appearance)`; changing Outfit clamps `torso` into the new palette before redraw. Needs two-tab
  browser verification (checklist below).

### Avatar-wardrobe real-asset notes (vs spec)
- Business base color token is **green** (not navy): BUSINESS_TORSO=['green','pink'], biz preset
  torso:'green'. Navy survives as a legs/pants color (recolored). navy_formal_* renamed green_formal_*.
- Counts: 2 fetched verbatim, 2 composited, 8 recolored (6 pink + 2 navy pants) — differs from the
  spec's assumed 6/6 split because LPC lacks single formal sheets, female formal, and navy/pink pants.

### Avatar-wardrobe W9 two-tab manual checklist
1. Join screen shows an **Outfit** row; cycling it swaps casual↔business garment in the preview.
2. **Top** arrows cycle the outfit's colors (casual: teal/maroon/brown/white/pink; business:
   green/pink); switching outfit clamps an out-of-palette color (no broken/empty preview).
3. **Pants** arrows include navy + pink.
4. **Business (M)** and **Casual Pink (F)** presets set the expected looks.
5. Shuffle produces valid combos only (no 404s in the network tab); business shows the formal
   garment; pink renders.
6. A second tab building a pink/business character renders it correctly in the first tab.

## What this is
A minimal Gather-like virtual office: 2D top-down tile map, WASD avatars moving in real time, proximity-based WebRTC audio/video for a handful of friends (2–8). Personal use, not production.

## Current state
Units **1–22 implemented** (Phases 0–7: setup, shared protocol + map, server, client core, multiplayer, proximity, full WebRTC mesh, polish). Everything compiles and all pure-logic tests pass. **MVP feature-complete** — only two-tab/media manual verification remains.

New addendum spec **`docs/specs/avatar-art.md`** (avatar pixel art, units A1–A8) is drafted and ready to implement — it replaces the colored-shape avatars with animated LPC pixel sprites.

- **Builds green:** `npm run build` (shared `tsc --noEmit`, server `tsc --noEmit`, client `vite build`) and `npm run typecheck --workspace client` all pass.
- **Tests green:** `npm test` → 31 tests across 7 files (map parsing/bounds, Room state, movement collision, proximity hysteresis, politeness, reconnect backoff, distance volume).
- **Server smoke-tested** live with two scripted ws clients: `welcome`, `presence-snapshot`, `peer-joined`, `peer-moved`, `peer-left` all relay correctly.
- **Units 12–20 need two-tab + camera/mic manual verification** (see checklist below) — all [M] work is implemented and compiling but could not be exercised in a browser here.

### How to run
```bash
npm install
npm run dev
```
- Client (Vite dev): http://localhost:5173
- Server (ws): ws://localhost:8080
- Client reads server URL from `VITE_WS_URL` (default `ws://localhost:8080`).

## Architecture notes (locked in during implementation)
- **No server build step.** Node 24 runs `server/src/index.ts` directly via native TS type
  stripping (`node --watch src/index.ts`). `@byte_grounds/shared` is consumed as `.ts` source by both
  Node (verified: node_modules workspace `.ts` imports strip fine) and Vite.
- **tsconfig.base.json** is `noEmit` + `allowImportingTsExtensions` + `verbatimModuleSyntax`;
  shared/server build scripts are `tsc --noEmit` (typecheck only), client build is `vite build`.
- All relative imports use explicit `.ts` extensions (required by Node native TS + allowed by tsc).
- `@byte_grounds/shared` exposes subpaths `@byte_grounds/shared/protocol` and `@byte_grounds/shared/map` via its `exports` map.
- Dependencies pinned via package-lock: `ws` + `@types/ws` (server), `concurrently` (root),
  `typescript` + `vite` + `vitest` + `@types/node` (dev). No others added.

## Phase 4-6 progress (units 12-20)
- **12 done** — Position broadcast (`game.ts`: ~12 Hz tick, send only on change) + remote avatars (`game.ts` `handleMessage` for presence-snapshot/peer-joined/peer-moved/peer-left; draws remotes). `main.ts` threads `net`+`selfId` into `Game` and forwards non-welcome messages. Build green.

- **13 done** — Remote interpolation (`game.ts`): remotes carry `tx/ty` targets; `peer-moved` sets target; each frame exponential-smooths `x,y` toward target (`INTERP_RATE=12`). Build green.
- **14 done** — `client/src/proximity.ts` (`distanceTiles`, `nextProxState` hysteresis 4/5) + `client/test/proximity.test.ts` (6 tests). Build + test green (21 tests total).

- **15 done** — Proximity visual wiring (`game.ts`): per-peer `ProxState` map updated each frame via `nextProxState`; `near` peers get a green ring (`drawRing`); `prox` entry cleared on `peer-left`. No media yet. Build green.

- **16 done** — `client/src/media.ts` `MediaManager`: lazy cached `acquire()` (getUserMedia video+audio), muted mirrored corner preview, Mic/Cam toggle buttons (`track.enabled`), denial notice fallback. Not yet wired into Game (wired in unit 19). Build + client typecheck green.
- **17 done** — `client/src/webrtc.ts`: `isPolite` (self < other) + `PeerLink` class — builds `RTCPeerConnection` with Google STUN, adds local tracks, forwards `onicecandidate`→`sendIce` and `ontrack`→`onTrack`, `close()`. `client/test/webrtc.test.ts` (3 tests). Test green (24 total).
- **18 done** — `client/src/webrtc.ts` `PeerLink`: perfect-negotiation handlers — `onnegotiationneeded` (makingOffer guard), `onDescription` (polite rollback / impolite ignore on glare), `onIce` (swallow errors while ignoring an offer). net.ts needed no change (it already relays signaling verbatim). Typecheck green.
- **19 done** — `client/src/webrtc.ts` `WebrtcMesh` (connect/disconnect/handleSignal/closeAll, in-flight de-dup) + `game.ts` wiring: proximity far→near calls `mesh.connect`, near→far / peer-left calls `mesh.disconnect`; offer/answer/ice routed to `mesh.handleSignal`; media acquired lazily via `MediaManager`. Build + typecheck green.
- **20 done** — `client/src/media.ts` `VideoBubbles` (per-peer `<video>` overlay layer, add/place/remove; `BUBBLE_W/H`) + `render.ts` `tileToScreen` + `game.ts`: `ontrack`→`bubbles.add`, teardown→`bubbles.remove`, bubble repositioned over each remote avatar every frame. Build + typecheck + 24 tests green.

## Units completed
1. Repo + workspaces scaffold — root `package.json` (workspaces + scripts), `tsconfig.base.json`, per-workspace `package.json`/`tsconfig.json`, `.gitignore`, git init.
2. Vite client shell — `client/index.html`, `vite.config.ts`, `src/main.ts`, `src/vite-env.d.ts`.
3. Protocol types + constants — `shared/src/protocol.ts`.
4. Map model + sample 20×15 office — `shared/src/map.ts` (+ `test/map.test.ts`).
5. Room state — `server/src/room.ts` (+ `test/room.test.ts`).
6. [M] ws server connect + join + presence — `server/src/index.ts`.
7. [M] ws server position + signaling relay — `server/src/index.ts` (same file).
8. Typed WS client — `client/src/net.ts`.
9. Join screen — `client/src/main.ts`.
10. Canvas + map render — `client/src/render.ts`, `client/src/game.ts`.
11. [M] Input + local movement + collision — `client/src/input.ts`, `client/src/movement.ts` (+ `test/movement.test.ts`); movement integrated into `game.ts`.

## Awaiting manual two-tab verification ([M] units 12–20)
All implemented, compile, and pass unit tests, but need a human with two browser tabs on
machines/profiles with a camera + mic. Use Chrome/Edge. `chrome://webrtc-internals` helps confirm
peer-connection state. **Run `npm run dev`**, open http://localhost:5173 in two tabs.

### Two-tab manual test checklist (units 12–20)
1. **Join (both tabs):** enter different names + colors, click "Join office". Both avatars render on
   the map in both tabs. *(units 9–12)*
2. **Movement sync (12):** move with WASD/arrows in tab A — tab A's avatar moves and tab B sees it
   move. Do the reverse in tab B.
3. **Interpolation (13):** remote motion in the other tab is smooth (no 12 Hz stutter) at 60 fps.
4. **Walls (11):** avatars are blocked by wall tiles in both tabs.
5. **Proximity ring (15):** walk the two avatars within ~4 tiles — a green ring appears around the
   remote avatar in each tab. Loiter at ~4.5 tiles — ring state should NOT flap. Walk ≥5 tiles apart
   — ring disappears.
6. **Media permission + preview (16):** on first time the avatars come within 4 tiles, the browser
   prompts for camera/mic. **Allow it.** A muted mirrored self-preview appears bottom-left with
   "Mic: on" / "Cam: on" buttons. (If you Deny, a red notice shows and you can still move/see others.)
7. **WebRTC connect + video bubbles (17–20):** within 4 tiles, after allowing media, a video bubble
   showing the OTHER person's camera appears floating above their avatar in each tab, and their audio
   is audible. The bubble follows their avatar as they move. (Confirm `connected` in
   `chrome://webrtc-internals` if a bubble is black.)
8. **Toggles (16):** click "Mic: off" — other tab stops hearing you (bubble video still shows).
   Click "Cam: off" — other tab's bubble of you goes black/frozen. Toggling back restores both.
9. **Disconnect on distance (19–20):** walk ≥5 tiles apart — the video bubbles disappear and the
   peer connection tears down (ring gone too). Walk back within 4 — it reconnects.
10. **Peer leave (7/19):** close one tab — in the surviving tab that avatar, its ring, and its video
    bubble all vanish.
11. **Status banner (21):** on load an amber "Connecting…" banner flashes, then clears once joined.
12. **Auto-reconnect (21) [needs two tabs]:** with both tabs joined and connected, stop the server
    (Ctrl-C the `npm run dev` server, or kill the ws process) — both tabs show amber "Reconnecting…".
    Restart the server (`npm run dev:server`) within ~a few attempts — each tab re-joins (new peerId),
    the banner clears, avatars reappear in both tabs, and proximity/video re-establishes on approach.
    Leave the server down past 5 attempts (~20s) — banner goes red "Disconnected — reload to retry".
13. **Distance volume (22):** with two connected peers, walk them from ~1 tile apart to ~4 tiles apart
    — the remote audio should audibly fade (gain 1.0 → ~0.25) and swell back as they close in. (Needs
    working mic/audio on both ends; verify with headphones to avoid feedback.)

### Notes / caveats for the tester
- Two tabs in the **same** browser profile may share one camera; use two profiles/devices or a
  virtual camera if the second bubble is black.
- STUN-only (no TURN): on symmetric NAT across different networks the PC may never reach `connected`
  (bubble stays black). On localhost/LAN it should connect fine. Documented spec caveat.
- Glare: both peers fire `negotiationneeded` on connect; perfect-negotiation (polite rollback /
  impolite ignore) should prevent console errors — watch the console for `InvalidState`/glare errors.

## Phase 7 progress (units 21-22)
- **21 done** — Status banner + auto-reconnect + edge cleanup.
  - `net.ts`: `NetClient` now stores join params + handlers, auto-reconnects on unexpected
    close with exponential backoff (`reconnectDelay(n)` = 500ms·2^(n-1), capped 10s, up to
    `MAX_RECONNECTS=5`), re-sends `join` on every reopen, and reports a `NetStatus`
    (`connecting`/`open`/`reconnecting`/`closed`) via `onStatus`. `close()` sets an intentional
    flag + clears the pending timer so a deliberate close never triggers reconnect.
  - `main.ts`: owns a fixed top `#net-banner` wired to `onStatus` (hidden when open; amber
    "Connecting…"/"Reconnecting…", red "Disconnected — reload to retry"). On a *second* `welcome`
    (reconnect) it calls `game.onReconnect(newSelfId)` instead of recreating the Game.
  - `game.ts`: `onReconnect(selfId)` adopts the fresh id, `mesh.closeAll()` + `mesh.setSelfId()`,
    clears `remotes`/`prox`, resets `sentX/sentY` so position re-broadcasts. Remotes re-arrive via
    the new presence snapshot; bubbles are torn down through the mesh `onClosed` callback.
  - `webrtc.ts`: `WebrtcMesh.setSelfId()` (selfId no longer readonly) so post-reconnect links get
    correct politeness.
  - Abrupt peer-leave cleanup was already robust (unit 7 server `peer-left` + `game.handleMessage`
    teardown of avatar/prox/mesh/bubble) — unchanged.
  - `index.html`: banner CSS. Tests: `client/test/net.test.ts` (3) for `reconnectDelay`.
- **22 done** (small + clean, so implemented) — Distance-based volume.
  - `media.ts`: pure `volumeForDistance(dist)` maps `[0, CONNECT_RADIUS]` → gain `[1.0 … 0.25]`
    (clamped); `VideoBubbles.setVolume(peerId, v)` sets the element volume.
  - `game.ts`: render loop sets each *near* peer's bubble volume from its current tile distance.
  - Tests: `client/test/media.test.ts` (4) for `volumeForDistance`.

## Avatar-art addendum progress (units A1–A8)
- **A1 done** — Vendored LPC assets under `client/public/sprites/` (served at `/sprites/...`).
  Discovered real folder paths via GitHub API first (guessed paths 404). All PNGs verified:
  valid signature, 832×1344, 64-grid.
  - `lpc/body/`: `male_light.png`, `female_light.png` (from `body/{male,female}/light.png`)
  - `lpc/legs/`: `{teal,red,white}_pants_male.png`, `{teal,red,white}_pants_female.png`
    (from `legs/pants/{male,female}/`)
  - `lpc/torso/`: `{teal,maroon,brown}_longsleeve_male.png` (from `torso/shirts/longsleeve/male/`),
    `{teal,maroon,brown}_tunic_female.png` (from `torso/tunics/female/`)
  - `lpc/hair/`: `{brown,black,blonde}_male.png` (from `hair/male/plain/`),
    `{brown,black,blonde}_female.png` (from `hair/female/plain/`)
  - `LICENSE/`: `cc-by-sa-3.0.txt`, `gpl-3.0.txt`, `AUTHORS.txt`; plus `CREDITS.md`.

- **A2 done** — `client/src/sprites.ts` pure half: `Direction`, `FRAME_SIZE`, `WALK_FRAMES`,
  `FRAME_MS`, `WALK_ROW`, `directionFromDelta` (dominant axis, ties→horizontal, idle keeps prev),
  `walkFrameIndex` (idle=0, cols 1-8 cycle), `Variant`, `VARIANTS` (6: m1-m3, f1-f3),
  `DEFAULT_VARIANT='m1'`. Build + typecheck green.
- **A3 done** — `client/test/sprites.test.ts` (11 tests): direction axes/signs/ties/idle,
  walkFrameIndex idle/cycle/wrap, variant integrity (unique ids, non-empty layers, `/sprites/`
  URLs, default is real). `npm test` → 42 tests green.

- **A4 done** — `shared/src/protocol.ts`: added `variant: string` to `PeerState` (after `color`)
  and `JoinMsg` (after `color`). As the spec expects, this surfaced the construct sites to fix.
- **A5 done** — `server/src/index.ts:50`: copies `variant: msg.variant` into the join `PeerState`;
  `server/test/room.test.ts:5`: literal updated with `variant: 'm1'`. Shared + server typecheck +
  42 tests green. NOTE: **client typecheck is intentionally red until A7** — `main.ts` constructs
  `JoinMsg` (`net.connect({ name, color })`) without `variant`; the variant picker in A7 fixes it.

- **A6 done** — Loader half of `client/src/sprites.ts`: URL-keyed `Image` cache, `preloadVariants`
  (idempotent, resolves on load/error), `variantReady`, `drawVariant` (blits (dir,col) frame of each
  loaded layer; skips unloaded; unknown id → default variant). `client/src/render.ts`: `drawSprite`
  (feet-anchored `destX=px-32`, `destY=py-64+FOOT_OFFSET`, `FOOT_OFFSET=16`, sets
  `imageSmoothingEnabled=false`) + `drawNameLabel` (extracted; `drawAvatar` now reuses it and stays
  as disc fallback). A6 code compiles clean; only remaining client error is the expected main.ts
  one (fixed in A7).

- **A7 done** — `client/src/main.ts`: replaced the `<input type=color>` with a 3-col variant grid
  (one button per `VARIANTS` entry, each a 64x64 `<canvas>` showing the standing frame via
  `preloadVariants`→`drawVariant(dir='down', col=0)`); clicking selects + highlights; default =
  `DEFAULT_VARIANT`. `join()`/`startGame()` thread the selected `variant` into `net.connect` and
  `Game`; a fixed `DEFAULT_COLOR='#4f8cff'` fills the still-required `color`. `client/index.html`:
  CSS for `.variant`/`#variants`/`.selected`/pixelated thumbnails. Also added `variant` to
  `SelfInfo` + the self object in `game.ts` (needed for the constructor to accept it; A8 consumes
  it). Full build (shared+server+client) green again; 42 tests green.

- **A8 done** — `client/src/game.ts`: `RemoteAvatar` + self gained `variant/dir/animMs/moving`;
  `makeRemote(PeerState)` builds remotes from presence (stores `variant`); `preloadVariants` called
  in `start()` (self) and on `presence-snapshot`/`peer-joined` (peers). New `animate(a, dx, dy, dt)`
  sets `moving` (per-frame delta > `MOVE_EPS=1e-3`), `dir` via `directionFromDelta`, and
  accumulates/resets `animMs`; applied to self (post-`stepMovement` delta) and each remote
  (post-interpolation delta). `drawCharacter(...)` replaces the two `drawAvatar` calls: draws
  `drawSprite` + `drawNameLabel` when `variantReady`, else falls back to the `drawAvatar` disc.
  Proximity ring, bubbles, volume unchanged. Full build + 42 tests green.

## Avatar-art status
**All units A1–A8 implemented.** Pure logic (A2–A5) covered by `npm test` (42) + typecheck/build.
A6–A8 are rendering/UI and need two-tab [M] browser verification (checklist below) — not exercised
in a browser here (`npm run dev` intentionally not started). Do not commit (per instructions).

### Avatar-art two-tab manual checklist (A6–A8)
1. **A7 picker:** join screen shows a 3x2 grid of 6 pixel characters (m1-m3, f1-f3), each a
   standing frame; clicking highlights the selection (blue border); default is the first (m1).
2. **A6 feet-anchored + crisp:** after joining, your character is a pixel sprite standing with its
   feet on the tile point (not floating/sunk); art is crisp, not blurred (imageSmoothing off).
   Tune `FOOT_OFFSET` (render.ts, currently 16) if feet sit slightly off.
3. **A8 self walk:** WASD/arrows animate your character through the 8-frame walk cycle and it faces
   the movement direction (up/left/down/right); stopping shows the standing frame; walls stop both
   motion and animation.
4. **A8 remote walk:** in a second tab join as a *different* variant; each tab shows the other's
   chosen character animating from its interpolated motion in the correct direction; idle = standing.
5. **Regressions intact:** name labels above sprites, green proximity ring within 4 tiles, and
   video bubbles over avatars all still work; disc fallback shows only in the brief moment before a
   variant's PNGs finish loading.

## Avatar-editor addendum progress (E1–E9) — ALL DONE
Replaces the fixed 6-variant picker with a join-screen avatar editor. Full build + typecheck +
all 52 tests green. E7–E9 are implemented but need two-tab [M] browser verification.

- **E1** `shared/src/protocol.ts` — added `Appearance` interface; replaced `variant: string`
  with `appearance: Appearance` in `PeerState` and `JoinMsg`.
- **E2** `server/src/index.ts` — join `PeerState` now copies `appearance: msg.appearance`;
  `server/test/room.test.ts` literal updated to an `appearance` object.
- **E3a/E3b/E4** `client/src/sprites.ts` — appearance-driven rewrite: `BODY/HAIR/TORSO/LEGS`,
  `CATEGORIES`, `appearanceToLayers` (male→longsleeve, female→tunic, `hair:'none'` omits hair),
  `PRESETS` (old 6), `DEFAULT_APPEARANCE` (=PRESETS[0]), `ALL_LAYER_URLS`; `normalizeAppearance`
  (coerce invalid→default), `serializeAppearance`/`parseAppearance` ("body.hair.torso.legs"),
  `shuffleAppearance(rand?)`; loader `preloadAppearance`/`preloadAll`/`appearanceReady`/
  `drawAppearance` (reuse URL-keyed cache). Removed dead `Variant`/`VARIANTS`/`DEFAULT_VARIANT`/
  `drawVariant`/`variantReady`/`preloadVariants`.
- **E5** `client/test/sprites.test.ts` — kept direction/frame cases; added appearanceToLayers
  rules, normalize invalid→default, serialize↔parse round-trip, seeded-shuffle determinism +
  bounds, PRESETS/DEFAULT/CATEGORIES integrity. 21 sprite tests (52 total).
- **E6** `client/src/render.ts` — `drawSprite` now takes `Appearance` and calls `drawAppearance`;
  anchor math unchanged.
- **E7** `client/src/game.ts` — `SelfInfo` + self + `RemoteAvatar` store `appearance`;
  `makeRemote` runs `normalizeAppearance(p.appearance)`; `preloadAppearance` on start /
  presence-snapshot / peer-joined (peers normalized before preload); `drawCharacter` uses
  `appearanceReady` + `drawSprite(ctx, appearance, ...)`; disc fallback intact. **[M]**
- **E8a/E8b** `client/src/main.ts` + `client/index.html` — join-screen editor: 96px live preview
  canvas drawing the standing frame via `drawAppearance`, `preloadAll()` then initial `redraw()`;
  per-`CATEGORIES` prev/next arrow cycling (wrap) → update appearance + redraw; Shuffle button;
  6 preset quick-start buttons. `join`/`startGame` thread `appearance`. CSS for editor/axes/
  presets/preview. **[M]**
- **E9** `client/src/main.ts` — localStorage `byte_grounds.appearance`: load via `parseAppearance` on editor
  init (fallback default), save via `serializeAppearance` on join. **[M]**
- **E0** skipped (optional author-time extra assets), per instructions.

### Avatar-editor two-tab manual checklist (E7–E9)
1. **E8a live preview:** join screen shows a 96px preview of the default (or last-saved) character
   standing, crisp (pixelated), facing down.
2. **E8b controls:** prev/next arrows on Body/Hair/Shirt/Pants cycle options (wrap-around) and the
   preview updates instantly; Shuffle randomizes all four axes; each of the 6 preset buttons sets a
   known look. `hair:'none'` shows a bald character.
3. **E7 self render:** after Join, your avatar in-world matches the character you built; walks/faces
   correctly; name label + proximity ring + video bubbles still work; disc only shows pre-load.
4. **E7 remote render:** a second tab building a different appearance renders that exact character in
   the first tab (and vice versa); garbage/unknown fields normalize to defaults (no 404s).
5. **E9 persistence:** reload the page → the editor restores your last-used appearance.

**Representation change:** the single `variant: string` is replaced (pre-release, clean break)
by a structured `appearance: Appearance` object in `JoinMsg` + `PeerState`:
`{ body:'male'|'female'; hair:'brown'|'black'|'blonde'|'none'; torso:'teal'|'maroon'|'brown';
legs:'teal'|'red'|'white' }`. `body` doubles as the style selector (male→longsleeve shirt,
female→tunic) and picks the sex-specific legs/hair file, so the 4 axes map onto the already-
vendored layers exactly (2×4×3×3 = 72 combos, **no new assets**). `sprites.ts` becomes
appearance-driven (`appearanceToLayers`, `normalizeAppearance`, `serialize/parseAppearance`,
`shuffleAppearance`, `CATEGORIES`, `PRESETS` = old 6, `DEFAULT_APPEARANCE`, `preloadAppearance`,
`drawAppearance`), reusing the existing URL-keyed image cache.

Units E1–E9 (+ optional E0), ~50 LOC each, dependency-ordered:
- **E1** protocol: add `Appearance`, swap `variant`→`appearance` in `JoinMsg`/`PeerState`.
- **E2** server copies `appearance`; fix `room.test.ts` literal.
- **E3a** sprites: option arrays, `CATEGORIES`, `appearanceToLayers`, `PRESETS`, defaults.
- **E3b** sprites: normalize / serialize / parse / shuffle.
- **E4** sprites: appearance loader (`drawAppearance`/`preloadAppearance`/`preloadAll`/
  `appearanceReady`); remove dead `variant`-era exports.
- **E5** rewrite `sprites.test.ts` (keep dir/frame cases; add appearance cases).
- **E6** `render.ts` `drawSprite` takes `Appearance`.
- **E7** `game.ts` appearance integration. **(MANUAL)**
- **E8a** editor scaffold + live preview. **(MANUAL)**
- **E8b** category controls + shuffle + presets. **(MANUAL)**
- **E9** optional localStorage persistence. **(MANUAL)**
- **E0** optional author-time extra LPC assets (skip unless requested).

E1–E6 are covered by `npm test` + typecheck; E7–E9 need two-tab [M] verification. Expect the
**client** typecheck to be intentionally red between E6 and E7 (drawSprite signature change),
mirroring the avatar-art rollout; `shared`+`server` stay green from E2 on. **Do not touch
`client/src/media.ts`** — the self-camera-preview bug is being fixed concurrently there.
Delegate one unit at a time to the Implementer; Architect reviews each before the next.

## Previously completed: Avatar-art addendum (A1–A8)
Avatar-art addendum complete (now superseded on the join screen by the avatar-editor above, which
replaces the fixed `variant` with a structured `appearance`). Remaining: two-tab manual
verification (MVP units 12–22 checklist above + avatar-art A6–A8 checklist); optional Architect
`/code-review` before the first commit. Units A1–A8, ~50 LOC each, dependency-ordered. A1 was an
author-time asset task (list the real `legs/torso/hair` filenames via the GitHub API before
downloading — guessed paths 404). A2–A5 are covered by `npm test`/typecheck; A6–A8 need two-tab
[M] verification. Source is `jrconway3/Universal-LPC-spritesheet` (CC-BY-SA 3.0 / GPL 3.0 —
license files + CREDITS.md vendored). Do **not** use Habbo/Gather proprietary art.

Delegate one unit at a time to the Implementer; Architect reviews each before the next.

## Other remaining work
- Units 12–22 still need the two-tab + camera/mic manual verification checklist above.
- Optional Architect `/code-review` pass before the first real commit.

### Wiring reference (as built in 12–20)
- `main.ts` threads `net` + `selfId` into `Game` and forwards every non-`welcome` message to
  `game.handleMessage`.
- `Game` owns `MediaManager`, `VideoBubbles`, and `WebrtcMesh`; proximity transitions in
  `updateProximity` drive `mesh.connect`/`mesh.disconnect`; signaling is routed via `mesh.handleSignal`.
- `webrtc.ts` holds `isPolite`, `PeerLink` (perfect negotiation), and `WebrtcMesh` (lifecycle).

## Open questions / assumptions (unchanged)
- Camera: whole-map fixed view (small office). Revisit if map grows.
- Reconnect issues a fresh `peerId` (no session resumption) — assumed acceptable.
- No video-bubble cap at 8 peers — assumed fine.
- No commits made yet beyond the initial `git init` staging — nothing committed; commit when asked.
