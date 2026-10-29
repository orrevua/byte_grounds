import { describe, it, expect } from 'vitest';
import { cameraOffset, viewportSize } from '../src/camera.ts';

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
