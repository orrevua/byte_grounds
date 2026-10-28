import { describe, it, expect } from 'vitest';
import { CONNECT_RADIUS } from '@byte_grounds/shared/protocol';
import { BUBBLE_H, BUBBLE_W, bubblePosition, volumeForDistance } from '../src/media.ts';

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

describe('bubblePosition', () => {
  it('floats above the avatar when there is room', () => {
    const { left, top } = bubblePosition(300, 300, 0, 0, 1000);
    expect(top).toBeLessThan(300 - BUBBLE_H);
    expect(left).toBe(300 - BUBBLE_W / 2);
  });

  it('drops below the avatar near the top of the screen', () => {
    expect(bubblePosition(300, 40, 0, 0, 1000).top).toBeGreaterThan(40);
  });

  it('accounts for the layer being scrolled up past the viewport', () => {
    // Room above inside the layer, but the layer starts 200px above the viewport.
    expect(bubblePosition(300, 250, 0, -200, 1000).top).toBeGreaterThan(250);
  });

  it('stays inside the viewport horizontally', () => {
    expect(bubblePosition(10, 300, 0, 0, 1000).left).toBeGreaterThanOrEqual(0);
    const { left } = bubblePosition(990, 300, 0, 0, 1000);
    expect(left + BUBBLE_W).toBeLessThanOrEqual(1000);
  });
});
