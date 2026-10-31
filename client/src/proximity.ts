import { CONNECT_RADIUS, DISCONNECT_RADIUS } from '@byte_grounds/shared/protocol';
import type { Position } from '@byte_grounds/shared/protocol';

export type ProxState = 'far' | 'near';

/** Euclidean distance between two tile-space positions. */
export function distanceTiles(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Hysteresis step: become `near` only at/under CONNECT_RADIUS, become `far`
 * only at/over DISCONNECT_RADIUS; the band between keeps the previous state.
 */
export function nextProxState(prev: ProxState, dist: number): ProxState {
  if (prev === 'far') return dist <= CONNECT_RADIUS ? 'near' : 'far';
  return dist >= DISCONNECT_RADIUS ? 'far' : 'near';
}

/**
 * Call state with meeting rooms (zone keys, null = not in a room): everyone in the same room is
 * connected whatever the distance; a room is closed to anyone outside it; outside rooms the
 * distance hysteresis applies.
 */
export function nextLinkState(prev: ProxState, dist: number, myZone: string | null, theirZone: string | null): ProxState {
  if (myZone !== null || theirZone !== null) return myZone === theirZone ? 'near' : 'far';
  return nextProxState(prev, dist);
}
