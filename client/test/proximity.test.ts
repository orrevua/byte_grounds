import { describe, it, expect } from 'vitest';
import { distanceTiles, nextProxState } from '../src/proximity.ts';
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
