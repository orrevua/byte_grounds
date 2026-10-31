import { describe, it, expect } from 'vitest';
import { createBlankMap, zoneKey } from '@byte_grounds/shared/map';
import { canEnter, hashPassword, lockOn, teleportSpots, unlockKey, zoneByKey } from '../src/meeting-lock.ts';

const hash = 'b'.repeat(64);

describe('meeting room locks', () => {
  it('hashes per room, never returning the password', async () => {
    const a = await hashPassword('1,1,4,4', 'secret');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('secret');
    expect(await hashPassword('1,1,4,4', 'secret')).toBe(a);
    expect(await hashPassword('9,9,4,4', 'secret')).not.toBe(a);
  });

  it('finds the lock on a room from who is present', () => {
    const holders = [
      { id: 'a', lock: null },
      { id: 'b', lock: { zone: 'z1', hash, allow: ['c'] } },
    ];
    expect(lockOn('z1', holders)).toEqual({ owner: 'b', lock: holders[1]!.lock });
    expect(lockOn('z2', holders)).toBeNull();
    expect(lockOn(null, holders)).toBeNull();
  });

  it('lets in the owner, invitees and whoever typed the password', () => {
    const a = { owner: 'b', lock: { zone: 'z1', hash, allow: ['c'] } };
    expect(canEnter(null, 'x', new Set())).toBe(true);
    expect(canEnter(a, 'b', new Set())).toBe(true);
    expect(canEnter(a, 'c', new Set())).toBe(true);
    expect(canEnter(a, 'x', new Set())).toBe(false);
    expect(canEnter(a, 'x', new Set([unlockKey(a)]))).toBe(true);
    // a new lock (other hash) needs the password again
    expect(canEnter({ ...a, lock: { ...a.lock, hash: 'c'.repeat(64) } }, 'x', new Set([unlockKey(a)]))).toBe(false);
  });

  it('teleports to free walkable tiles nearest the room centre', () => {
    const m = { ...createBlankMap('t', 10, 10), zones: [{ name: 'R', x: 2, y: 2, w: 4, h: 4 }] };
    const z = m.zones[0]!;
    m.tiles[4 * 10 + 4] = 1; // a wall tile inside the room
    const spots = teleportSpots(m, z, [{ x: 3.5, y: 3.5 }]);
    expect(spots).toHaveLength(14); // 16 tiles − a wall − a taken one
    expect(spots.slice(0, 2)).toEqual([{ x: 4.5, y: 3.5 }, { x: 3.5, y: 4.5 }]);
    expect(spots.every((s) => s.x > 2 && s.x < 6 && s.y > 2 && s.y < 6)).toBe(true);
    expect(zoneByKey(m, zoneKey(z)!)).toBe(z);
    expect(zoneByKey(m, 'nope')).toBeNull();
  });
});
