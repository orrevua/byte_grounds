# Spec: meeting invites + password-locked rooms

## Goal
Click another player → invite them to a meeting room. Only when they accept are both teleported
into the room; the inviter's password then closes the room's door to everyone else.

## Flow
1. Ana clicks Bia → the player menu (everyone gets it now; the admin also sees the grant toggles)
   offers **Invite to a meeting room**: the room (the one Ana is in, else the first free one; a
   select when the map has several) and an optional password. Rooms already locked by someone else
   are not offered. Ana's client sends `invite { to, zone, locked }` and remembers it for 60 s.
2. Bia sees a prompt: "Ana invites you to <room> (locked)" — Accept / Decline, auto-declines after
   60 s. Accept: Bia's client sends `invite-reply { to, zone, accept: true }` and teleports Bia into
   the room. Decline: the reply says so and Ana gets a toast.
3. Ana's client, on a matching accept (same peer + room, not expired): teleports Ana into the room
   and, when a password was set, publishes the lock in her status.
4. Teleport spots: walkable tiles inside the room not taken by others, nearest the room centre
   first; the invitee takes the 1st, the inviter the 2nd, so they don't land on each other. Remotes
   snap (instead of gliding across the map) when a peer moves more than 3 tiles in one update.

## Lock
- `StatusFields.lock: RoomLock | null`, `RoomLock = { zone, hash, allow: PeerId[] }`. `hash` =
  SHA-256 hex of `zoneKey + "\n" + password` (the password itself never leaves the inviter's
  client); `allow` = the accepted invitees. Rides the existing status path (no server change).
  `normalizeStatusFields` validates it (zone ≤ 40 chars, 64-hex hash, ≤ 16 ids).
- A room is locked while its owner is present with that lock. The owner clears it when they leave
  the room (or it vanishes with their presence when they disconnect).
- Entering: walking from outside into a locked room is blocked unless you own the lock, are in
  `allow`, or typed the right password (remembered per owner + hash for the session). A blocked
  step asks for the password (at most once every 3 s); a correct one lets you in.
- People already inside when the lock is set stay. Enforcement is client-side (a friends' app; the
  same trust model as the rest of presence).

## Messages
`InviteMsg { type: 'invite', to, zone, locked }`, `InviteReplyMsg { type: 'invite-reply', to, zone,
accept }`; relayed with `from` (ws server: same-room only; Supabase: the existing signal path).

## Units
1. Protocol: messages, `RoomLock`, `normalizeLock`, status field; server + Supabase relay; tests.
2. `client/src/meeting-lock.ts` (pure): `hashPassword`, `lockedBy`, `canEnter`, `teleportSpots`; tests.
3. `client/src/invite.ts` (DOM): invite form, invite prompt, password prompt.
4. Player menu for everyone (AvatarMenu with optional feed + invite action).
5. Game: send/receive invites, teleport, lock publish/clear, movement block + password, remote snap.
6. i18n (en/pt), CSS.
