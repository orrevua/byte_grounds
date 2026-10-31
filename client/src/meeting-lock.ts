import { isWalkable, zoneKey, type OfficeMap, type Zone } from '@byte_grounds/shared/map';
import type { PeerId, RoomLock } from '@byte_grounds/shared/protocol';

/** A room's password as shared: SHA-256 hex of `zone + "\n" + password` (the password stays local). */
export async function hashPassword(zone: string, password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${zone}\n${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Someone present and the lock they carry (null = none). */
export interface LockHolder {
  id: PeerId;
  lock: RoomLock | null;
}

export interface ActiveLock {
  owner: PeerId;
  lock: RoomLock;
}

/** The lock on a room: the first present holder locking that zone (a room is locked while its owner is here). */
export function lockOn(zone: string | null, holders: Iterable<LockHolder>): ActiveLock | null {
  if (!zone) return null;
  for (const h of holders) if (h.lock?.zone === zone) return { owner: h.id, lock: h.lock };
  return null;
}

/** The session memory key for a password typed in correctly (a new lock needs it again). */
export function unlockKey(a: ActiveLock): string {
  return `${a.owner}:${a.lock.hash}`;
}

/** May `self` walk in: no lock, their own lock, an accepted invitee, or they typed the password. */
export function canEnter(a: ActiveLock | null, self: PeerId, unlocked: ReadonlySet<string>): boolean {
  return !a || a.owner === self || a.lock.allow.includes(self) || unlocked.has(unlockKey(a));
}

/** The zone with this key on the map. */
export function zoneByKey(map: OfficeMap, key: string): Zone | null {
  return (map.zones ?? []).find((z) => zoneKey(z) === key) ?? null;
}

/**
 * Where to put people teleported into a room: walkable tile centres inside it, minus tiles someone
 * stands on, nearest the room's centre first (ties: top to bottom, left to right).
 */
export function teleportSpots(map: OfficeMap, zone: Zone, taken: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  const busy = new Set(taken.map((p) => `${Math.floor(p.x)},${Math.floor(p.y)}`));
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;
  const spots: { x: number; y: number; d: number }[] = [];
  for (let ty = zone.y; ty < zone.y + zone.h; ty++) {
    for (let tx = zone.x; tx < zone.x + zone.w; tx++) {
      if (!isWalkable(map, tx + 0.5, ty + 0.5) || busy.has(`${tx},${ty}`)) continue;
      spots.push({ x: tx + 0.5, y: ty + 0.5, d: Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) });
    }
  }
  spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  return spots.map(({ x, y }) => ({ x, y }));
}
