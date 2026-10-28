# ByteGrounds — MVP Spec (Gather-like Virtual Office)

**Status:** Draft
**Date:** 2026-10-28
**Related:** `docs/HANDOFF.md` (initial state)

## Goal
A minimal, Gather-like 2D virtual office for a handful of friends (~2–8) who work together. Each user controls an avatar on a top-down tile map with WASD/arrow movement; other avatars move in real time. When avatars come within N tiles of each other their webcam/mic streams connect (WebRTC peer-to-peer mesh); when they move apart the streams disconnect. Personal use only — favor simplicity over scalability.

## Context & Current State
Greenfield. Target folder `C:/Users/felip/repositories/business_city` is empty and not a git repo. No `docs/HANDOFF.md` yet. Environment: Windows 11, Node v24.16.0, npm 11.13.0.

## Locked Decisions (do not re-litigate)
- **Scale:** personal use, 2–8 concurrent. Not for production/sale. Simplicity > scalability.
- **Stack:** TypeScript end to end. Backend Node + `ws` WebSocket server (signaling + presence + position relay). Frontend plain TS + HTML5 Canvas, Vite for dev/build. Minimal deps.
- **Media:** WebRTC peer-to-peer mesh. WebSocket server is the signaling channel (SDP + ICE) and position/presence relay. Public STUN `stun:stun.l.google.com:19302`. TURN out of scope (flag: symmetric NAT may need TURN later).
- **Rooms:** single shared room for MVP; model allows multiple rooms later but don't build them.
- **Auth:** trivial — display name + avatar color on a join screen. No accounts/passwords/DB. In-memory server state (lost on restart — fine).
- **Map:** fixed tile grid in a data file (2D array / JSON of walkable/blocked). Simple wall collision. No map editor — hand-author one small office.

## Proposed Design

### High-level architecture
```
┌────────────┐   WebSocket (signaling + presence + positions)   ┌────────────┐
│  Client A  │◄────────────────────────────────────────────────►│   Server   │
│ (Vite/TS)  │                                                    │ (Node/ws)  │
└─────┬──────┘◄──────────── relayed signaling ─────────────────►└─────┬──────┘
      │                                                                 │
      │           WebRTC P2P mesh (media, direct, STUN)                 │
      └───────────────────◄────────────────────►──────────── Client B ─┘
```

**Server responsibilities (dumb relay + presence authority):**
- Accept WS connections; assign each a unique `peerId` (server-generated UUID).
- Hold in-memory room state: `Map<peerId, { name, color, x, y }>`.
- On join: register peer, send `welcome` (own id + map id) and `presence-snapshot` (all current peers) to the newcomer; broadcast `peer-joined` to others.
- Relay `position` updates: store latest, broadcast to all other peers (no validation — client-authoritative).
- Relay WebRTC signaling (`offer`/`answer`/`ice-candidate`) addressed to a specific `to` peerId — forward verbatim, stamping `from`.
- On disconnect: remove peer, broadcast `peer-left`.
- **No proximity logic on the server.** Server never computes distances or decides media connections.

**Client responsibilities:**
- Join screen: capture display name + color, open WS, show canvas on `welcome`.
- Local avatar: read keyboard, apply collision against map, send own `position` at a fixed tick.
- Remote avatars: apply incoming `position` updates, interpolate between ticks for smooth motion.
- Compute proximity to every other peer each frame; initiate/tear down WebRTC connections as peers cross the threshold (with hysteresis).
- Manage WebRTC mesh via perfect-negotiation; attach remote streams to `<video>`/`<audio>` elements; handle mic/cam permissions and mute/cam-off toggles.
- Render map tiles, avatars + name labels, and a video bubble per connected nearby peer.

### Movement model
- **Client-authoritative** positions. Each client owns its avatar's `(x, y)` in continuous tile-space (floats), applies local collision, and broadcasts position. Server relays as-is. Trust tradeoff acceptable for friends.
- **Broadcast tick:** send own position at ~12 Hz (every ~83 ms) *only when it changed* since last send (idle peers send nothing).
- **Receivers interpolate** remote positions toward the latest received target each render frame (lerp) to smooth the 12 Hz stream at 60 fps.
- Movement speed: constant tiles/second; local movement integrated per render frame using delta time, independent of broadcast tick.

### Proximity logic (client-side)
- Distance metric: Euclidean distance in tile units between avatar centers.
- **Thresholds with hysteresis** to avoid flap at the boundary:
  - `CONNECT_RADIUS = 4` tiles — when distance ≤ 4 and not connected, initiate connection.
  - `DISCONNECT_RADIUS = 5` tiles — when distance ≥ 5 and connected, tear down.
  - Band between 4 and 5 keeps current state (hysteresis gap of 1 tile).
- Each client evaluates proximity for all other known peers every render frame (cheap for ≤8 peers). State machine per peer: `far → connecting → connected → far`.
- **Volume scaling (optional stretch):** map distance in `[0, CONNECT_RADIUS]` to gain `[1.0 … ~0.25]`; set on an element volume or a `GainNode`. Implemented as the final polish unit; skip if time-constrained.

### WebRTC mesh specifics
- **Perfect negotiation** pattern (MDN) to avoid glare. For each pair, deterministically assign politeness by comparing peerIds as strings: the peer with the **lexicographically smaller id is `polite`**, the other `impolite`.
- Connection initiation: when the proximity state machine decides to connect, **the impolite peer creates the data/offer** (both sides create `RTCPeerConnection`; only impolite calls the initial `negotiationneeded`-driven offer; polite waits). Using `negotiationneeded` + `onicecandidate` + `ontrack` handlers uniformly keeps logic symmetric.
- Glare handling: polite peer rolls back on offer collision; impolite ignores incoming offer during collision — standard perfect-negotiation `makingOffer` / `ignoreOffer` flags.
- **Local media:** acquire `getUserMedia({ video, audio })` once on first connection need (lazily, after a user gesture on join); reuse the single `MediaStream` across all peer connections (add its tracks to each `RTCPeerConnection`).
- **Stream attach:** on `ontrack`, attach the remote stream to a per-peer `<video>` element (audio rides in the same element; a separate `<audio>` is unnecessary when using a muted-local / unmuted-remote video). Local preview video element is muted to avoid echo.
- **Mic/cam toggles:** toggle `track.enabled` on the local stream's audio/video tracks (no renegotiation needed). UI buttons reflect state.
- ICE: single public STUN server. TURN out of scope (flag symmetric NAT caveat in README).

### Rendering
- **Canvas render loop** via `requestAnimationFrame`: clear, draw map tiles (floor vs wall colors from the map data), draw each avatar as a colored circle/square with a name label above, draw the local avatar last/highlighted.
- **Video bubbles:** chosen approach = **HTML `<video>` overlays positioned over the canvas** near each connected peer's avatar (absolute-positioned DOM elements synced to avatar screen coordinates each frame). Justification: overlays-near-avatar best conveys the spatial "who's next to me" feel of Gather and is simple to position from the same coordinate math the renderer already computes; a sidebar would hide the spatial relationship. Bubbles are small (e.g. 120×90) and follow their avatar; the local preview sits in a fixed corner.
- Coordinate transform: tile-space → screen-space via a single camera (MVP: fixed camera showing whole small map, or centered on local avatar — MVP uses whole-map fixed view since the office is small).

### Project layout
Single repo, npm workspaces monorepo, shared protocol types in `shared/`:
```
business_city/
  package.json                 # workspaces: client, server, shared; root scripts
  tsconfig.base.json           # shared compiler options
  README.md
  docs/
    HANDOFF.md
    specs/byte-grounds-mvp.md
  shared/
    package.json
    src/protocol.ts            # all WS message types + shared enums/consts
    src/map.ts                 # map data shape + sample office map + helpers
  server/
    package.json
    src/index.ts               # ws server, presence, relay
    src/room.ts                # in-memory room state
    test/*.test.ts
  client/
    package.json
    index.html
    vite.config.ts
    src/main.ts                # entry: join screen → game
    src/net.ts                 # WS client wrapper (typed)
    src/game.ts                # state, render loop
    src/input.ts               # keyboard
    src/movement.ts            # local integration + collision
    src/proximity.ts           # distance + hysteresis state machine
    src/webrtc.ts              # perfect-negotiation mesh manager
    src/media.ts               # getUserMedia, toggles, attach
    src/render.ts              # canvas draw
    test/*.test.ts
```
- **Scripts (root `package.json`):** `dev` runs server + client concurrently (use `npm-run-all` or `concurrently` — pick `concurrently`, one small dep); `dev:server`, `dev:client`, `build`, `test` (runs vitest across workspaces).
- **Client finds server:** WS URL from Vite env var `VITE_WS_URL` (default `ws://localhost:8080`), read in `net.ts` via `import.meta.env`.

### Testing
- **Framework: Vitest** (single runner for client + shared pure logic; minimal, TS-native). Server pure logic also via Vitest.
- **Unit-tested pure logic:** proximity distance + hysteresis state machine (`proximity.ts`), collision + map parsing (`movement.ts`, `shared/map.ts`), politeness assignment (`webrtc.ts` helper).
- **Manual (two browser tabs):** multiplayer position sync, WebRTC connect/disconnect on proximity, media attach, toggles. See checklist in Impact Analysis.

### Error handling / failure modes
- WS disconnect: client shows "reconnecting"/"disconnected" banner; attempt simple reconnect with backoff (MVP: single manual reload acceptable, but auto-retry once).
- `getUserMedia` denied: proceed without local media (can still move/see others; no outbound stream). Show a notice.
- Peer leaves abruptly: `peer-left` (or WS close) triggers teardown of avatar + any RTCPeerConnection + video bubble.
- WebRTC ICE failure (likely symmetric NAT): log + show per-bubble "connection failed"; documented TURN caveat.

## Scope
- **In scope:** single shared room; join screen (name + color); tile map with collision; real-time avatar movement for 2–8 peers; proximity-driven WebRTC mesh audio/video; mute/cam-off toggles; one hand-authored office map; pure-logic unit tests; manual test checklist.
- **Out of scope:** multiple rooms; accounts/auth/DB/persistence; TURN server; map editor; mobile/touch; screen share; chat text; spatial/positional audio panning (only optional distance-volume stretch); production hardening, rate limiting, horizontal scaling.

## Interfaces / Models / Endpoints

### Shared constants
```ts
export const TILE_SIZE = 32;            // px per tile for rendering
export const MOVE_SPEED = 4;            // tiles per second
export const POSITION_TICK_MS = 83;     // ~12 Hz position broadcast
export const CONNECT_RADIUS = 4;        // tiles
export const DISCONNECT_RADIUS = 5;     // tiles
export const STUN_URLS = ['stun:stun.l.google.com:19302'];
export const DEFAULT_ROOM = 'office';
```

### Core models (`shared/src/protocol.ts`)
```ts
export type PeerId = string;

export interface PeerState {
  id: PeerId;
  name: string;
  color: string;       // hex, e.g. "#4fa"
  x: number;           // tile-space float
  y: number;
}

export interface Position { x: number; y: number; }
```

### WebSocket protocol (JSON; discriminated union on `type`)

Client → Server:
```ts
// sent once right after socket opens
export interface JoinMsg      { type: 'join'; name: string; color: string; room?: string; }
// sent at ~12 Hz when moved
export interface PositionMsg  { type: 'position'; x: number; y: number; }
// WebRTC signaling, addressed to a peer
export interface OfferMsg     { type: 'offer';  to: PeerId; sdp: RTCSessionDescriptionInit; }
export interface AnswerMsg    { type: 'answer'; to: PeerId; sdp: RTCSessionDescriptionInit; }
export interface IceMsg       { type: 'ice-candidate'; to: PeerId; candidate: RTCIceCandidateInit; }
```

Server → Client:
```ts
export interface WelcomeMsg          { type: 'welcome'; selfId: PeerId; room: string; }
export interface PresenceSnapshotMsg { type: 'presence-snapshot'; peers: PeerState[]; } // excludes self
export interface PeerJoinedMsg       { type: 'peer-joined'; peer: PeerState; }
export interface PeerLeftMsg         { type: 'peer-left'; id: PeerId; }
export interface PeerMovedMsg        { type: 'peer-moved'; id: PeerId; x: number; y: number; }
// relayed signaling (server stamps `from`)
export interface RelayOfferMsg       { type: 'offer';  from: PeerId; sdp: RTCSessionDescriptionInit; }
export interface RelayAnswerMsg      { type: 'answer'; from: PeerId; sdp: RTCSessionDescriptionInit; }
export interface RelayIceMsg         { type: 'ice-candidate'; from: PeerId; candidate: RTCIceCandidateInit; }

export type ClientToServer = JoinMsg | PositionMsg | OfferMsg | AnswerMsg | IceMsg;
export type ServerToClient =
  | WelcomeMsg | PresenceSnapshotMsg | PeerJoinedMsg | PeerLeftMsg | PeerMovedMsg
  | RelayOfferMsg | RelayAnswerMsg | RelayIceMsg;
```
Signaling relay rule: server reads `to`, looks up that socket, forwards the same message replacing `to` with `from = senderId`. Unknown `to` is dropped silently.

### Map model (`shared/src/map.ts`)
```ts
export type Tile = 0 | 1;                 // 0 = floor (walkable), 1 = wall (blocked)
export interface OfficeMap {
  id: string;
  width: number;
  height: number;
  tiles: Tile[];                          // row-major, length = width*height
  spawn: { x: number; y: number };
}
export function tileAt(m: OfficeMap, tx: number, ty: number): Tile;   // out-of-bounds = wall
export function isWalkable(m: OfficeMap, x: number, y: number): boolean; // float pos, considers bounds+wall
```

### Proximity API (`client/src/proximity.ts`)
```ts
export type ProxState = 'far' | 'near';
export function distanceTiles(a: Position, b: Position): number;
// pure hysteresis step: given current state + distance, return next state
export function nextProxState(prev: ProxState, dist: number): ProxState;
```

### WebRTC helper (`client/src/webrtc.ts`)
```ts
export function isPolite(selfId: PeerId, otherId: PeerId): boolean; // self < other => polite
```

## Impact Analysis
- **Tests:** new unit tests for `map.ts` (parsing/bounds/walkable), `proximity.ts` (distance + hysteresis across the 4–5 band), `webrtc.isPolite`, `movement.ts` (collision stops at wall). No existing tests to break (greenfield).
- **Dependencies:** `ws` (server), `concurrently` (root dev), `vitest` + `typescript` + `vite` (dev). Keep it to these.
- **Backward-compat:** none (new project).
- **Security/perf:** no auth by design; server trusts clients (documented). Mesh is O(n²) connections — fine at ≤8. STUN-only; symmetric NAT caveat documented.
- **Manual two-tab checklist:**
  1. Two tabs join with different names/colors — both avatars appear in each.
  2. Move in tab A — avatar moves smoothly (interpolated) in tab B at ~12 Hz.
  3. Walls block movement in both tabs.
  4. Walk avatars within 4 tiles — video/audio connects both ways; bubbles appear near avatars.
  5. Walk apart beyond 5 tiles — streams tear down, bubbles disappear; no flapping while loitering at ~4.5 tiles.
  6. Mute mic / cam-off toggles reflect on the remote side.
  7. Close one tab — its avatar + bubble vanish for the other.
  8. (Stretch) Volume drops as peers near the edge of connect radius.

## Implementation Units
Dependency-ordered. Each ~50 LOC max. "(MANUAL)" = needs two-tab browser verification in addition to/instead of unit tests.

**Phase 0 — Setup**
1. **Repo + workspaces scaffold** — files: `package.json`, `tsconfig.base.json`, `shared/package.json`, `server/package.json`, `client/package.json`, `.gitignore` — change: npm workspaces, root scripts (`dev`, `dev:server`, `dev:client`, `build`, `test`), base tsconfig, concurrently dep — acceptance: `npm install` succeeds; `npm run build` resolves workspaces (no app code yet).
2. **Vite client shell** — files: `client/index.html`, `client/vite.config.ts`, `client/src/main.ts` (placeholder "join screen" div) — change: Vite TS app boots, reads `VITE_WS_URL` default — acceptance: `npm run dev:client` serves a page.

**Phase 1 — Shared protocol & map**
3. **Protocol types + constants** — files: `shared/src/protocol.ts` — change: all message interfaces, unions, `PeerState`, constants — acceptance: compiles; imported by server/client without error.
4. **Map model + sample office** — files: `shared/src/map.ts` — change: `OfficeMap` type, `tileAt`, `isWalkable`, one hand-authored small map (e.g. 20×15 with a few wall blocks + spawn) — acceptance: unit tests for bounds/wall/walkable pass.

**Phase 2 — Server**
5. **Room state** — files: `server/src/room.ts` — change: in-memory `Map<PeerId,PeerState>`, add/remove/update/list — acceptance: unit test add/update/remove/list.
6. **ws server: connect + join + presence** — files: `server/src/index.ts` — change: start `ws` on 8080, assign id, handle `join`, send `welcome` + `presence-snapshot`, broadcast `peer-joined`/`peer-left` — acceptance: (MANUAL) two `wscat`/tab connections see each other's join/leave.
7. **ws server: position + signaling relay** — files: `server/src/index.ts` — change: relay `position` → `peer-moved` broadcast; relay `offer`/`answer`/`ice-candidate` to `to`, stamping `from` — acceptance: (MANUAL) messages forwarded correctly (log-verify or via client).

**Phase 3 — Client core**
8. **Typed WS client** — files: `client/src/net.ts` — change: open socket, send `join`, typed `send()` + `onMessage` dispatch of `ServerToClient` — acceptance: connects, logs `welcome` + snapshot.
9. **Join screen** — files: `client/src/main.ts` (+ minimal markup) — change: name input + color picker + Join button → opens net, swaps to canvas view — acceptance: entering name/color transitions to game view.
10. **Canvas + map render** — files: `client/src/render.ts`, `client/src/game.ts` — change: `requestAnimationFrame` loop, draw tiles (floor/wall), tile→screen transform — acceptance: office map renders.
11. **Input + local movement + collision** — files: `client/src/input.ts`, `client/src/movement.ts` — change: WASD/arrows, delta-time integration at `MOVE_SPEED`, `isWalkable` collision; draw local avatar + name — acceptance: unit test collision; (MANUAL) avatar moves, blocked by walls.

**Phase 4 — Multiplayer**
12. **Position broadcast + remote avatars** — files: `client/src/game.ts`, `client/src/net.ts` — change: send `position` at `POSITION_TICK_MS` when moved; apply `peer-moved`/`peer-joined`/`peer-left` to remote avatar set; draw remote avatars + labels — acceptance: (MANUAL) two tabs see each other move.
13. **Remote interpolation** — files: `client/src/game.ts` — change: lerp remote avatars toward latest target each frame — acceptance: (MANUAL) remote motion smooth at 60 fps despite 12 Hz updates.

**Phase 5 — Proximity**
14. **Proximity logic (pure)** — files: `client/src/proximity.ts` — change: `distanceTiles`, `nextProxState` hysteresis (4 connect / 5 disconnect) — acceptance: unit tests cover below-4, in-band, above-5, and no-flap transitions.
15. **Proximity wiring (visual only)** — files: `client/src/game.ts` — change: each frame compute state per peer; highlight near peers (e.g. ring) — no media yet — acceptance: (MANUAL) ring appears/disappears with hysteresis, no flapping at boundary.

**Phase 6 — WebRTC**
16. **Local media acquire + preview + toggles** — files: `client/src/media.ts` — change: lazy `getUserMedia`, local muted preview element, mic/cam toggle via `track.enabled`, denial fallback — acceptance: (MANUAL) preview shows; toggles work; denial shows notice.
17. **Politeness + peer-connection factory** — files: `client/src/webrtc.ts` — change: `isPolite`, create `RTCPeerConnection` with STUN, wire `onicecandidate` → send `ice-candidate`, `ontrack` callback, add local tracks — acceptance: unit test `isPolite`; compiles.
18. **Perfect-negotiation handlers** — files: `client/src/webrtc.ts`, `client/src/net.ts` — change: `negotiationneeded`/`makingOffer`, handle relayed `offer`/`answer`/`ice-candidate` with polite rollback + impolite ignore — acceptance: (MANUAL) two peers negotiate without glare errors.
19. **Proximity → connect/teardown mesh** — files: `client/src/game.ts`, `client/src/webrtc.ts` — change: on `far→near` create+connect peer, on `near→far` close PC + remove bubble — acceptance: (MANUAL) walking near/apart connects/disconnects media.
20. **Attach remote streams as video bubbles** — files: `client/src/media.ts`, `client/src/render.ts` — change: on `ontrack` create per-peer `<video>` overlay, position over avatar each frame; remove on teardown — acceptance: (MANUAL) bubble follows nearby peer's avatar; audio audible.

**Phase 7 — Polish**
21. **Connection status + reconnect + edge cleanup** — files: `client/src/net.ts`, `client/src/game.ts` — change: WS status banner, single auto-reconnect, robust teardown on `peer-left`/abrupt close — acceptance: (MANUAL) closing a tab cleans up the other; reconnect works.
22. **(Stretch) Distance-based volume** — files: `client/src/media.ts`, `client/src/game.ts` — change: scale element volume by distance within connect radius — acceptance: (MANUAL) volume fades near edge. Skippable.

## Open Questions
- Camera: whole-map fixed view vs. follow-local-avatar. **Assumption:** whole-map fixed (small office) for MVP; revisit if map grows.
- Reconnect identity: on reconnect the server issues a new `peerId` (simplest). **Assumption:** acceptable; no session resumption in MVP.
- Video bubble count cap: at 8 peers up to 7 bubbles. **Assumption:** fine; no cap for MVP.
