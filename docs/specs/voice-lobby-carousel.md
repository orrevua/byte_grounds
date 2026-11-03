# Voice reliability, map carousel, online counts, one login per name

## 1. Voice reliability (meeting rooms and proximity)

Reported: in meetings, sometimes one person can't hear another, as if their mic stopped.

Likely causes in the code:

| # | Cause | Fix |
|---|-------|-----|
| a | The remote voice plays from the video bubble element, and the speaking meter also runs that remote stream through Web Audio. Safari/WebKit can go silent on the element when that happens. | The remote speaking level comes from `RTCRtpReceiver.getSynchronizationSources()[].audioLevel` (no Web Audio on remote streams). Web Audio stays only on our own mic. |
| b | Remote audio rides in a `<video>` that is `display:none` while the camera is off or the meeting view is open. If `play()` is refused (autoplay policy), the person stays silent forever. | Each peer gets its own hidden `<audio>` element for sound (the bubble `<video>` is muted). A refused `play()` is retried on the next click or key press. |
| c | The mic track can end: device unplugged, Bluetooth switched, the OS or another app took the mic, a phone call. Nothing re-acquires it, so the person goes silent for everyone. A mic that failed once is never retried. | `MediaManager` watches the audio track's `ended` event (and `devicechange`). It re-runs `getUserMedia` and hands the new track to the mesh, which calls `replaceTrack` on every link's audio sender (or adds a track when the link had none). Turning the mic on after a failure retries. |
| d | A connection stuck in `disconnected` (it never reaches `failed`) is never replaced. | 8 s in `disconnected` means a fresh call, like `failed`. |
| e | STUN only: strict NATs and company networks (UDP blocked) can't connect at all. | Optional TURN from env: `VITE_TURN_URLS` (comma separated), `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`. Added to `iceServers` when set. |

## 2. Map carousel on the join screen

The `<select id="map">` becomes a carousel:

- ◀ / ▶ arrows, dots, swipe and the ←/→ keys.
- Each slide shows:
  - a miniature (the map drawn off-screen with `drawMap` plus flat object decor, scaled into a 280x170 canvas);
  - the map name;
  - "N online".
- Maps load lazily: the current slide first, then its neighbours. Decor sheets load per map, and the thumbnail is drawn again once they arrive.
- The Office stays preselected. The selected id is what `join()` gets.

## 3. Online counts: `Lobby`

Game clients announce `{ name, uid?, room }` to a lobby. The join screen watches it.

- **Supabase:** presence on the channel `byte_grounds:lobby` (key = the net self id). The join screen subscribes without tracking.
- **ws dev:** the server's HTTP `GET /lobby` returns `[{ name, uid?, room }]`. The join screen polls it every 3 s.
- `client/src/lobby.ts` has:
  - `createLobby()` returning `{ watch(cb), stop() }`;
  - the pure helpers `countByRoom(entries)` and `nameKey(name)` (trimmed, lowercased).

## 4. One instance per nick or per registered account

- **Same name (case-insensitive), different account** (or no uid): the new join is refused with "That name is already online".
- **Same account** (the same uid: the same browser for guests, the same login for registered people), whatever the name: newest wins. The older tab gets `{type:'kicked'}`, leaves its room and shows "You opened ByteGrounds somewhere else" with a Reload button.

How each transport enforces it:

- **ws server:** at `join`:
  - a name that is taken by another uid gets `{type:'refused', reason:'name'}` and the socket is closed;
  - the same uid closes the older socket after sending it `kicked`.
- **Supabase** (in the client, best effort; there is no server):
  - Before joining a room, `SupabaseNet` subscribes to the lobby and waits for the first sync.
  - A taken name refuses (it emits `refused`).
  - The same uid gets a lobby broadcast `kick {id}` aimed at the old instance's key; on receiving it, the old instance emits `kicked`.
  - Then it tracks itself.
- **Protocol:** `ServerToClient` gains `RefusedMsg {type:'refused'; reason:'name'}` and `KickedMsg {type:'kicked'}`.
- **main.ts:**
  - `refused` before the welcome goes back to the join screen with the error.
  - `kicked` disposes the game and shows the overlay.
  - Reconnects never auto-rejoin after either one.
