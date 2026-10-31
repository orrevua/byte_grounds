import { describe, it, expect } from 'vitest';
import { distanceTiles, nextLinkState, nextProxState } from '../src/proximity.ts';
import { CONNECT_RADIUS, DISCONNECT_RADIUS } from '@byte_grounds/shared/protocol';

describe('distanceTiles', () => {
  it('computes Euclidean distance', () => {
    expect(distanceTiles({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distanceTiles({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });
});

describe('nextProxState', () => {
  it('far -> near when within the connect radius', () => {
    expect(nextProxState('far', CONNECT_RADIUS - 0.1)).toBe('near');
    expect(nextProxState('far', CONNECT_RADIUS)).toBe('near');
  });

  it('far stays far just beyond the connect radius', () => {
    expect(nextProxState('far', CONNECT_RADIUS + 0.1)).toBe('far');
  });

  it('near -> far only at/over the disconnect radius', () => {
    expect(nextProxState('near', DISCONNECT_RADIUS)).toBe('far');
    expect(nextProxState('near', DISCONNECT_RADIUS + 1)).toBe('far');
  });

  it('holds state inside the hysteresis band (4..5)', () => {
    const mid = (CONNECT_RADIUS + DISCONNECT_RADIUS) / 2;
    expect(nextProxState('far', mid)).toBe('far');
    expect(nextProxState('near', mid)).toBe('near');
  });

  it('does not flap while loitering at the band edges', () => {
    // just inside disconnect radius stays near; just outside connect radius stays far
    expect(nextProxState('near', DISCONNECT_RADIUS - 0.01)).toBe('near');
    expect(nextProxState('far', CONNECT_RADIUS + 0.01)).toBe('far');
  });
});

describe('nextLinkState (meeting rooms)', () => {
  it('connects everyone in the same room at any distance', () => {
    expect(nextLinkState('far', 30, 'a', 'a')).toBe('near');
  });

  it('keeps a room closed to people outside it, even next to the wall', () => {
    expect(nextLinkState('near', 1, 'a', null)).toBe('far');
    expect(nextLinkState('near', 1, null, 'a')).toBe('far');
    expect(nextLinkState('near', 1, 'a', 'b')).toBe('far');
  });

  it('falls back to distance outside rooms', () => {
    expect(nextLinkState('far', CONNECT_RADIUS, null, null)).toBe('near');
    expect(nextLinkState('near', DISCONNECT_RADIUS, null, null)).toBe('far');
  });
});
