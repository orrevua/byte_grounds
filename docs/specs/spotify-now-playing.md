# Spec: Spotify "now playing"

## Goal
A player can connect Spotify and share what they're listening to (Spotify desktop app, phone or
web): "♪ Song — Artist" under their name in the map and on their meeting tile. Opt-in, off until
they connect, and they can pause sharing or disconnect any time.

## Spotify setup (owner, once)
developer.spotify.com → create an app (Web API) → Client ID into `VITE_SPOTIFY_CLIENT_ID`
(client/.env.local and Vercel). Redirect URIs: `https://<site>/spotify-callback.html` and, for local
dev, `http://127.0.0.1:5173/spotify-callback.html` (Spotify rejects `localhost`; open the dev site
on 127.0.0.1). In development mode each friend's Spotify email must be added under User Management.
No Client ID → the feature is hidden.

## Design
- **OAuth: Authorization Code + PKCE, all in the browser** (no secret, no server). Scope
  `user-read-currently-playing`. "Connect Spotify" opens a popup to Spotify's consent page; the
  verifier + state are saved in localStorage first. `spotify-callback.html` (a 4th Vite page) checks
  the state, exchanges the code for tokens, saves them (`byte_grounds.spotify`) and closes; the game
  hears it via the `storage` event (no reload, the game keeps running). Tokens refresh with the PKCE
  refresh grant before they expire; a refused refresh disconnects.
- **Polling:** `GET /v1/me/player/currently-playing?additional_types=episode` every 30 s while
  connected and sharing (also right after connecting). 204 or paused → nothing. Episodes show
  "Episode — Show". 429 → wait `Retry-After`. 401 → refresh once, then retry. 403 (not on the app's
  user list) → a clear message.
- **Shared state:** `StatusFields.music: string` ("Song — Artist", ≤ 100 chars, control chars
  stripped; `normalizeMusic`), sent only when it changes; rides the existing status path on both
  transports (no server change). '' when nothing plays, sharing is paused or disconnected.
- **UI:** a HUD button "♪ Spotify". Not connected → connects. Connected → a small popover: what's
  playing (or "Nothing playing"), "Share: on/off", "Disconnect". In the map, a green "♪ …" line
  above the status line (tags and chat balloons make room); in the meeting view, under the name.
- Pure helpers in `client/src/spotify.ts` (PKCE challenge, authorize URL, parse now playing,
  token expiry) with tests; the network client is a thin class over `fetch`.

## Units
1. Protocol `music` + `normalizeMusic` + tests.
2. `spotify.ts` helpers + client, callback page, Vite input, env typing + example.
3. HUD button + popover, game wiring (send, remotes, tags, meeting), i18n, CSS.
4. Docs: README setup, handoff.
