# Social HUD: leave, status, busy, chat, screen share, wardrobe additions

**Date:** 2026-10-30 · **Branch:** `master` (work lands on master directly, no PRs)

## Goals
1. **Leave** button in-game → back to the character + map selection screen.
2. **Daily status**: a short text ("Shipping the login page") shown above your avatar; resets the
   next day.
3. **Busy** (`/busy` in chat, or the HUD button): `zzZ` floats over the avatar; walking ends it.
4. **Chat**: room-wide text chat, ephemeral (no history), with a speech bubble over the sender.
5. **Screen share** (Google Meet style): share a screen/window/tab; nearby peers (the existing
   proximity call) see it in a large stage panel.
6. **Name labels** above the head instead of over the face.
7. **Wardrobe**: more skin tones (tan, bronze, brown, dark), a female skeleton (female clothes fit
   the skeleton sheet), more female presets (incl. female orc/skeleton).

## Design

### Protocol (`shared/src/protocol.ts`)
- `PeerState` + `JoinMsg` gain optional `status?: string`, `busy?: boolean`, `sharing?: boolean`.
- `STATUS_MAX = 80`, `CHAT_MAX = 300`; `normalizeStatus(x)` / `normalizeChat(x)` (string, trimmed,
  clipped; anything else → `''`).
- Client → server: `StatusMsg { type: 'status'; status; busy; sharing }` (full replacement) and
  `ChatMsg { type: 'chat'; text }`.
- Server → client: `PeerStatusMsg { type: 'peer-status'; id; status; busy; sharing }` and
  `ChatRelayMsg { type: 'chat'; from; name; text; at }`.
- ws server: `Room.updateStatus`; `status` and `chat` broadcast to the room (not echoed).
- `SupabaseNet`: `status` updates `self`, broadcasts event `status`, re-tracks presence (late
  joiners get it); `chat` broadcasts event `chat` with the sender's name. A presence `join` for a
  known peer also emits `peer-status`. `toPeer` keeps the new fields.

### Game (`client/src/game.ts`)
- `RemoteAvatar` / `Avatar`: `status`, `busy`, `sharing`, `say?: { text; until }`.
- `setStatus(text)`, `toggleBusy()`, `setSharing(on)` update self and send a `status` message;
  `onReconnect` re-sends it (ws gives a new id and re-joins with the stale join object).
- Busy: entering it stops a dance; held movement while busy (and not seated) clears it.
- `say(id|null, text)`: bubble for 6 s. `chat` messages → `onChat` callback (chat panel).
- Render top pass per avatar, stacked upward from above the head: name (baseline `py - 38`),
  status (small, muted), `zzZ` (animated, busy), chat bubble.

### HUD (`client/src/hud.ts`, new)
Top-left bar: `← Leave`, status pill (click → inline input, Enter saves, Esc cancels, empty
clears), `Busy` toggle, `Chat` toggle with unread count. Chat panel under it: log + input; lines
starting with `/` are commands: `/busy`, `/status <text>`, `/help`. Enter anywhere (not in an
input) focuses the chat input. `Keyboard` ignores keys typed into inputs.

### Leave (`main.ts`)
Save position, then `location.reload()`: the join screen is the page's start state and a reload
releases mic/cam/screen, Realtime channels and timers with no leak-prone teardown.

### Daily status persistence
localStorage `byte_grounds.status = { text, day: 'YYYY-MM-DD' }`; a different day loads empty.
Sent in the join message and on every change.

### Screen share (`media.ts`, `webrtc.ts`)
- The outgoing video track is the screen while sharing, else the camera (if on). `WebrtcMesh`
  remembers the current outgoing video and applies it to links created later (a peer walking up
  mid-share sees it). Same transceiver as the camera, so no new m-lines or stream bookkeeping.
- `MediaManager`: `Screen` button; `getDisplayMedia({ video: true })`; the track's `ended`
  (browser "Stop sharing") stops it; stopping restores the camera track if the camera is on.
  `onSharing(on)` tells the game to broadcast `sharing`.
- `ScreenStage`: a large panel (top centre) showing the remote stream of the nearest sharing peer
  we're connected to (muted element: audio stays in the bubble). Header "<name> is presenting",
  Minimize/Show. The sharer's own bubble hides while staged.

### Wardrobe (`sprites.ts` + assets)
- Vendor upstream `body/{male,female}/{tanned,tanned2,dark,dark2}.png` as
  `lpc/body/<sex>_{tan,bronze,brown,dark}.png`; `female_skeleton.png` = copy of
  `male_skeleton.png`. Regenerate sit sheets (`tools/gen_pose_sheets.py`).
- `SKIN = light, tan, bronze, brown, dark, orc, skeleton`; `skinsFor` → every skin for both sexes;
  `outfitsFor`: only orc/skeleton may go bare. Presets: + Tan (F), Dark (F), Bronze (M), Orc (F),
  Skeleton (F), Business (F).
- CREDITS.md rows.

## Units
1. Protocol + ws server + room (tests: protocol, room).
2. SupabaseNet status/chat (tests).
3. Wardrobe assets + sprites (tests).
4. Name/status/zzZ/bubble rendering + game state + busy.
5. HUD + chat + leave + daily status (+ Keyboard input guard).
6. Screen share (mesh current video, MediaManager button, stage).

## Manual checks (two browsers)
1. Labels sit above heads in every pose. 2. Status set in one window shows in the other; reload
keeps it; tomorrow it is gone. 3. `/busy` → zzZ in both; walking clears it. 4. Chat lines reach
the other window with a bubble over the sender; typing WASD in chat doesn't move. 5. Walk close,
Share screen → the other window shows the stage; browser "Stop sharing" ends it; a third person
walking up mid-share sees it. 6. Leave → join screen, pick another map, join. 7. New skin tones,
female skeleton with tunic/dress, new presets.
