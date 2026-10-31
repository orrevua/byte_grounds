# Meeting rooms + Google Meet-style view

**Date:** 2026-10-30 · **Branch:** `master`

## Behavior
- A **meeting room** is a tile rectangle on the map (`OfficeMap.zones`). Built-in: Office's walled
  meeting room (x 32–46, y 1–12). Admins/editors add or remove rooms with the editor's
  **Meeting room** tool (drag a rectangle → name it; click inside one → remove).
- **Audio:** everyone in the same room is connected and heard at full volume wherever they stand;
  nobody outside hears the room and the room doesn't hear outside. Outside rooms: proximity as before
  (`nextLinkState` in `proximity.ts`).
- **Screen share** exists only inside a room: the Share screen button appears on entering and
  leaving stops a share. Everyone in the room sees it.
- Entering shows a pill "<room> · Open meeting view". The **meeting view** (`meeting.ts`) is a
  full-screen overlay styled after Google Meet: participant grid (camera, or the pixel face in a
  colored circle), presentation layout (screen large + people strip), bottom bar with clock · room,
  mic / camera / present / red leave (walks you out via `stepOutOf`), people count, Back to map (Esc).
  All its media elements are muted: the call's audio keeps playing from the world's bubbles.
  Movement keys are ignored while it is open.

## Data
- `Zone { name, x, y, w, h }`; `parseMap` clips zones to the map; **absent** `zones` = never set.
- A saved copy of a built-in map without `zones` inherits the built-in's rooms that fit
  (`pickMap` in `store.ts`); an explicit `[]` keeps none. No `rev` bump, so nobody's saved edits are
  hidden.
- `zoneAt`, `zoneKey`, `stepOutOf` in `shared/src/map.ts`; `tools/build_maps.py` `m.zone(...)`.

## Manual checks
1. Office: walk into the meeting room → blue outline + label, pill, Share screen button appear.
2. Two people at opposite ends of the room hear each other at full volume; a third person outside
   the wall hears neither.
3. Open meeting view: tiles, camera on/off, present → presentation layout on both sides.
4. Red button → you're outside, view closed, share stopped.
5. Editor: drag a room on Lounge, name it, reload the game → it works there.
