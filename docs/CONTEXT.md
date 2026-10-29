# ByteGrounds — Project Context

Orientation for anyone (human or a cloud agent) picking this up fresh. Read this first, then `docs/HANDOFF.md` for live status, then the specs in `docs/specs/`.

> Note: the on-disk folder is still named `business_city/` (not renamed to avoid breaking paths); the **project** is **ByteGrounds** (`byte_grounds` in code). GitHub: https://github.com/orrevua/byte_grounds

## What it is
A minimal, Gather-like virtual office for a handful of friends (~2–8). A 2D top-down map where each person drives a pixel avatar; when two avatars get near each other their webcams/mics connect (proximity video chat), and disconnect when they move apart. Personal project — not for production or sale.

## Status (2026-10-28)
Feature-complete MVP, **not yet committed** until this first push.
- **Core (units 1–22):** monorepo, WebSocket server (presence + position relay + WebRTC signaling), canvas client, join screen, movement + wall collision, live multiplayer avatars with interpolation, proximity detection with hysteresis, WebRTC peer-to-peer mesh (perfect negotiation, STUN-only), proximity-based connect/disconnect, video bubbles, mic/cam toggles, distance-based volume, connection status + auto-reconnect.
- **Avatar art (A1–A8):** colored dots replaced with animated LPC pixel characters (4-direction walk).
- **Avatar editor (E1–E9):** join-screen character creator — cycle body/hair/shirt/pants with live preview, shuffle, 6 presets, remembered in localStorage. Appearance travels to all peers.
- **Fixes:** self-camera preview now shows only when the camera is on.
- **Tests:** 52 Vitest tests passing; `npm run build` + client typecheck green.

## Architecture
- **Monorepo, npm workspaces**, TypeScript end to end.
  - `shared/` — `@byte_grounds/shared`: protocol types (`protocol.ts`) + map model (`map.ts`) + built-in maps (`maps.ts`, data in `maps/*.json`). Consumed as TS source via `exports` subpaths; Node 24 strips types, Vite bundles it.
  - `server/` — `ws` server (`src/index.ts`), in-memory room state (`src/room.ts`). Dumb relay: no game logic, no proximity, no DB. State is lost on restart (fine).
  - Maps: `shared/src/map.ts` `OfficeMap` = walkable `tiles` (0/1) + optional per-tile `colors` + `decor` cells (`{x,y,sheet,sx,sy}`, 32px cells of `client/src/assets/decor/<sheet>.png`, discovered by `import.meta.glob` in `client/src/decor.ts`). `client/src/store.ts`: `SupabaseStore` (tables in `supabase/schema.sql`: `maps`, `player_positions` keyed by map + lowercased name) or `LocalStore` (localStorage) when Supabase isn't configured. Room = map id (ws server keeps one `Room` per map). Editor page: `client/editor.html` + `src/editor.ts` (pure edits in `src/editor-model.ts`); Vite multi-page build, Vercel `cleanUrls` serves it at `/editor`.
  - `client/src/net-supabase.ts` — production transport: a Supabase Realtime channel stands in for the ws server (presence = roster, broadcast = positions at ~5 Hz + addressed signaling), emitting the same `ServerToClient` messages. `createNet()` in `net.ts` picks it when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set, else the ws `NetClient`.
  - `client/` — Vite + TS. Key modules: `net` (typed WS client + reconnect), `game` (loop/state), `input`, `movement` (+collision), `proximity` (distance + hysteresis), `webrtc` (mesh + perfect negotiation), `media` (local stream, bubbles, toggles, volume), `sprites` (LPC compose/animation + appearance), `render` (canvas), `main` (join screen + avatar editor). Assets in `client/public/sprites/` (LPC, CC-BY-SA 3.0 / GPL 3.0 — see its `CREDITS.md`).
- **Model:** client-authoritative positions (trust is fine for friends), ~12 Hz broadcast, 60 fps interpolation. Proximity computed per-client; server just relays. Appearance carried in `JoinMsg`/`PeerState` so everyone renders everyone.
- **Media:** WebRTC mesh, STUN only (`stun.l.google.com:19302`). No TURN — works on LAN / most home networks; strict symmetric NAT across different networks may not connect (TURN is a future add).

## Maps
- **Built-in maps** (`shared/src/maps.ts` → `BUILT_IN_MAPS`, `OFFICE_MAP`, `builtInMap(id)`): `office`
  "Office" 48x32 (six back-to-back desk pods, huddle tables, meeting room for ten, break room with
  kitchenette/café tables/sofa corner, library, lobby with reception), `lounge` "Lounge & Café"
  44x30 (coffee bar with stools, round café tables, two-seat tables, fireplace lounge, sofa L,
  piano, chess), `home` "Home" 40x30 (kitchen with island, dining for ten, living room with TV and
  fireplace corners, double bedroom, two-bed room with desk, bathroom, hall).
- **Generated, not hand-edited:** `python tools/build_maps.py` lays each map out from a catalog of
  whole sheet objects (`Obj(sheet, sx, sy, w, h, block)`, block = `base` | `all` | `free` (object,
  no blocking: chairs, stools, table-top items) | `none` (floor layer: rugs, beds, wall art, floor
  textures)), applies the editor's stamp rules (`baseDy` on upper rows of `base` objects), and
  refuses to write a map with overlapping objects, a blocked spawn, or an unreachable room/seat.
  Chairs use the pre-drawn facing toward their table; north-side chairs are tucked into a desk's or
  round table's walkable top row. `shared/test/maps.test.ts` re-checks parse, border, spawn, seat
  reachability (BFS) and that every decor cell exists on its sheet.
- **Store precedence:** `store.listMaps()` lists the built-ins first, then other saved maps;
  `loadMap(id)` returns a saved map with that id if there is one, else the built-in. So an office
  someone edited and saved before keeps winning over the new built-in office; deleting the saved
  copy in the editor brings the built-in back. Nothing is seeded into Supabase/localStorage.
- **Camera:** the game canvas is `min(map, window)` px (`client/src/camera.ts` `viewportSize`), and a
  bigger map scrolls to keep the local avatar centred, clamped at the edges (`cameraOffset`, whole
  px). Drawing runs under a `setTransform(-camX, -camY)`; video bubbles are placed at
  `(px - camX) * scale`.

## How to run (local, needs a browser)
```
cd C:/Users/felip/repositories/business_city
npm install
npm run dev          # server :8080 + client :5173
```
Open http://localhost:5173 in two tabs (ideally two browser profiles so they don't share one webcam), build a character, join, walk close → cameras connect.

- Tests: `npm test`  • Build: `npm run build`  • Client typecheck: `npm run typecheck --workspace client`

## Conventions
- **Workflow:** Architect → Implementer. Architect writes specs in `docs/specs/` (never code); Implementer implements one unit at a time, runs the full test suite after each, never edits specs. Keep `docs/HANDOFF.md` current.
- **Commits:** `<semantic>(context): <message>` (e.g. `feat(editor): shuffle button`). Never start a commit message with `@`.
- **Units are small** (~50 LOC). Pure logic is Vitest-tested; realtime/WebRTC/rendering need manual two-tab browser verification (marked [M] in specs).

## Cloud-session limits
A cloud agent **can**: edit code/specs/docs, run `npm install`, `npm run build`, `npm test`, typecheck. A cloud agent **cannot**: run the interactive app in a real browser, use a webcam/mic, or do the two-tab proximity/video verification — those must be done on a local machine. So implement + keep tests green in the cloud, and leave a clear manual checklist for the human to verify locally.

## Where it's going (backlog / ideas)
- CC0 top-down floor/wall tileset to replace the plain drawn map (Kenney / LPC base tiles).
- Optional: more avatar options (extra skin tones / hair styles — fetch more LPC layers, update CREDITS).
- Optional: TURN server if friends on strict NATs can't connect.
- Optional: multiple rooms (data model already leaves room for it), interactive objects, text chat, persistence.
