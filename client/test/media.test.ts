import { describe, it, expect } from 'vitest';
import { CONNECT_RADIUS } from '@byte_grounds/shared/protocol';
import { volumeForDistance } from '../src/media.ts';

describe('volumeForDistance', () => {
  it('is full volume at zero distance', () => {
    expect(volumeForDistance(0)).toBe(1);
  });

  it('is minimum volume at the connect radius', () => {
    expect(volumeForDistance(CONNECT_RADIUS)).toBeCloseTo(0.25);
  });

  it('clamps beyond the connect radius', () => {
    expect(volumeForDistance(CONNECT_RADIUS * 2)).toBeCloseTo(0.25);
    expect(volumeForDistance(-1)).toBe(1);
  });

  it('decreases monotonically with distance', () => {
    expect(volumeForDistance(1)).toBeGreaterThan(volumeForDistance(2));
  });
});
