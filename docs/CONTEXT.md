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
  - `shared/` — `@byte_grounds/shared`: protocol types (`protocol.ts`) + map model/office map (`map.ts`). Consumed as TS source via `exports` subpaths; Node 24 strips types, Vite bundles it.
  - `server/` — `ws` server (`src/index.ts`), in-memory room state (`src/room.ts`). Dumb relay: no game logic, no proximity, no DB. State is lost on restart (fine).
  - `client/` — Vite + TS. Key modules: `net` (typed WS client + reconnect), `game` (loop/state), `input`, `movement` (+collision), `proximity` (distance + hysteresis), `webrtc` (mesh + perfect negotiation), `media` (local stream, bubbles, toggles, volume), `sprites` (LPC compose/animation + appearance), `render` (canvas), `main` (join screen + avatar editor). Assets in `client/public/sprites/` (LPC, CC-BY-SA 3.0 / GPL 3.0 — see its `CREDITS.md`).
- **Model:** client-authoritative positions (trust is fine for friends), ~12 Hz broadcast, 60 fps interpolation. Proximity computed per-client; server just relays. Appearance carried in `JoinMsg`/`PeerState` so everyone renders everyone.
- **Media:** WebRTC mesh, STUN only (`stun.l.google.com:19302`). No TURN — works on LAN / most home networks; strict symmetric NAT across different networks may not connect (TURN is a future add).

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
