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

## Deploy (Vercel + Supabase, no server to host)
Vercel can't hold long-lived WebSocket connections, so in production the relay is replaced by a
[Supabase Realtime](https://supabase.com/docs/guides/realtime) channel: presence tracks who is in
the room, broadcast carries positions and WebRTC signaling (`client/src/net-supabase.ts`). The
`server/` package is then only used for local dev. No database tables or SQL are needed.

1. **Supabase:** create a free project at supabase.com. Under Project Settings → API (or
   "Connect"), copy the **Project URL** and the **anon / publishable key**. The anon key is meant
   to be public; it ships in the browser bundle.
2. **Vercel:** import this repo (Root Directory = repo root; `vercel.json` sets the build), then
   add two environment variables and deploy:
   - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon key

   They're read at build time, so redeploy after changing them.

When both variables are set the client uses Supabase; otherwise it falls back to the ws server at
`VITE_WS_URL`. To try Supabase locally, put the two variables in `client/.env.local`
(see `client/.env.example`) and run `npm run dev:client`.

Free-plan Realtime allows ~100 messages/s per project, and every delivery to every peer counts.
Positions are therefore sent at ~5 Hz (vs ~12 Hz over ws), which is fine for a handful of people.

**Alternative:** host the ws server yourself, e.g. on Render with `render.yaml` (New → Blueprint),
and set `VITE_WS_URL=wss://<your-service>.onrender.com` in Vercel instead of the Supabase vars.

## Caveats
- No auth; server trusts clients (client-authoritative positions). Fine for friends.
- WebRTC uses public STUN only. Symmetric NATs may fail to connect without a TURN server
  (out of scope for the MVP).
- Server state is in-memory and lost on restart.
