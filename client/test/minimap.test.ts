import { describe, it, expect } from 'vitest';
import { minimapScale, minimapToWorld } from '../src/minimap.ts';

describe('minimap geometry', () => {
  it('fits the map inside the box, keeping its aspect', () => {
    expect(minimapScale({ w: 1536, h: 1024 }, { w: 200, h: 150 })).toBeCloseTo(200 / 1536);
    expect(minimapScale({ w: 640, h: 960 }, { w: 200, h: 150 })).toBeCloseTo(150 / 960);
  });

  it('maps a click back to the world point, clamped to the map', () => {
    const world = { w: 1536, h: 1024 };
    const s = minimapScale(world, { w: 200, h: 150 });
    expect(minimapToWorld(100, 50, s, world)).toEqual({ px: 100 / s, py: 50 / s });
    expect(minimapToWorld(-5, 999, s, world)).toEqual({ px: 0, py: 1024 });
  });
});
