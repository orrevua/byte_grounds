import { describe, it, expect } from 'vitest';
import { cameraOffset, clampZoom, stepZoom, viewportSize } from '../src/camera.ts';

describe('cameraOffset', () => {
  it('does not scroll a map that fits', () => {
    expect(cameraOffset(300, 800, 640)).toBe(0);
    expect(cameraOffset(300, 640, 640)).toBe(0);
  });

  it('centres the focus, clamped to the map edges', () => {
    expect(cameraOffset(1000, 800, 1536)).toBe(600);
    expect(cameraOffset(100, 800, 1536)).toBe(0);
    expect(cameraOffset(1500, 800, 1536)).toBe(736);
  });

  it('snaps to whole pixels', () => {
    expect(cameraOffset(1000.4, 801, 1536)).toBe(600);
  });
});

describe('viewportSize', () => {
  it('is the map when it fits, else the window', () => {
    expect(viewportSize({ w: 640, h: 480 }, { w: 1280, h: 720 })).toEqual({ w: 640, h: 480 });
    expect(viewportSize({ w: 1536, h: 1024 }, { w: 1280.6, h: 720 })).toEqual({ w: 1280, h: 720 });
  });
});

describe('zoom', () => {
  it('steps through the levels and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(2, -1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(1);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(1.9, 1)).toBe(2.5); // snaps to 2 first
  });

  it('clamps stored or pinched values', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(9)).toBe(3);
    expect(clampZoom(1.7)).toBe(1.7);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});
