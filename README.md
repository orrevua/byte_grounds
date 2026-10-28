# ByteGrounds

A minimal, Gather-like 2D virtual office for a handful of friends (2–8). Top-down tile
map, WASD/arrow avatars moving in real time, with proximity-based WebRTC audio/video
(peer-to-peer mesh). Personal use — simplicity over scalability.

## Stack
- TypeScript end to end, npm workspaces monorepo: `shared/`, `server/`, `client/`.
- Server: Node + [`ws`](https://github.com/websockets/ws) — signaling + presence + position relay.
- Client: plain TS + HTML5 Canvas, bundled with Vite.
- Tests: Vitest (pure logic only).

Node 24 runs the `.ts` server directly via native type stripping; no build step for the
server. `@byte_grounds/shared` is consumed as source by both the server (Node) and client (Vite).

## Run locally
```bash
npm install
npm run dev
```
- Client (Vite): http://localhost:5173
- Server (ws):   ws://localhost:8080

Open two browser tabs, join with different names/colors. Override the server URL for the
client with `VITE_WS_URL` (default `ws://localhost:8080`).

### Other scripts
- `npm run dev:server` / `npm run dev:client` — run one side.
- `npm run build` — typecheck shared + server, production-build the client.
- `npm test` — run Vitest across workspaces.

## Deploy
Vercel can't hold long-lived WebSocket connections, so the client and server are hosted separately.

1. **Server on Render** (`render.yaml`): Render → New → Blueprint → pick this repo. It runs
   `npm start --workspace server`, listens on `$PORT`, and answers health checks at `/healthz`.
   Note the service URL, e.g. `https://byte-grounds-ws.onrender.com`. The free plan sleeps
   when idle, so the first connection after a while can take ~30–60 s (the client retries).
2. **Client on Vercel** (`vercel.json`): import the repo, keep Root Directory at the repo root, and
   set the environment variable `VITE_WS_URL=wss://byte-grounds-ws.onrender.com` (it must be
   `wss://`; HTTPS pages can't open `ws://`). It is read at build time, so redeploy after
   changing it.

## Caveats
- No auth; server trusts clients (client-authoritative positions). Fine for friends.
- WebRTC uses public STUN only. Symmetric NATs may fail to connect without a TURN server
  (out of scope for the MVP).
- Server state is in-memory and lost on restart.
