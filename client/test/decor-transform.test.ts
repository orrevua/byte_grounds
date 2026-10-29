import { describe, it, expect } from 'vitest';
import type { Facing } from '@byte_grounds/shared/map';
import {
  IDENTITY,
  describeTransform,
  flipH,
  flipV,
  footprint,
  rotateCCW,
  rotateCW,
  transformFacing,
  transformFields,
  transformOffset,
  type DecorTransform,
} from '../src/decor-transform.ts';

const ALL: DecorTransform[] = [0, 90, 180, 270].flatMap((rot) =>
  [false, true].map((flipX) => ({ rot, flipX }) as DecorTransform),
);

describe('transform composition', () => {
  it('four clockwise turns and a turn back are the identity', () => {
    expect(rotateCW(rotateCW(rotateCW(rotateCW(IDENTITY))))).toEqual(IDENTITY);
    for (const t of ALL) expect(rotateCCW(rotateCW(t))).toEqual(t);
  });

  it('flipping twice is the identity', () => {
    for (const t of ALL) {
      expect(flipH(flipH(t))).toEqual(t);
      expect(flipV(flipV(t))).toEqual(t);
    }
  });

  it('flipH then flipV is a 180° turn', () => {
    expect(flipV(flipH(IDENTITY))).toEqual({ rot: 180, flipX: false });
  });

  it('reaches all 8 orientations', () => {
    const seen = new Set<string>();
    for (const a of [IDENTITY, flipH(IDENTITY)]) {
      let t = a;
      for (let i = 0; i < 4; i++, t = rotateCW(t)) seen.add(`${t.rot}/${t.flipX}`);
    }
    expect(seen.size).toBe(8);
  });
});

describe('footprint + transformOffset', () => {
  it('a 2x1 piece turned 90° becomes 1x2, west cell going north', () => {
    const t = rotateCW(IDENTITY);
    expect(footprint(2, 1, t)).toEqual({ w: 1, h: 2 });
    expect(transformOffset(0, 0, 2, 1, t)).toEqual({ dx: 0, dy: 0 });
    expect(transformOffset(1, 0, 2, 1, t)).toEqual({ dx: 0, dy: 1 });
  });

  it('every transform maps a 2x3 piece onto distinct tiles of its footprint', () => {
    for (const t of ALL) {
      const fp = footprint(2, 3, t);
      const tiles = new Set<string>();
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const o = transformOffset(dx, dy, 2, 3, t);
          expect(o.dx).toBeGreaterThanOrEqual(0);
          expect(o.dy).toBeGreaterThanOrEqual(0);
          expect(o.dx).toBeLessThan(fp.w);
          expect(o.dy).toBeLessThan(fp.h);
          tiles.add(`${o.dx},${o.dy}`);
        }
      }
      expect(tiles.size).toBe(6);
    }
  });

  it('a horizontal flip reverses a 3x1 row', () => {
    const t = flipH(IDENTITY);
    expect([0, 1, 2].map((dx) => transformOffset(dx, 0, 3, 1, t).dx)).toEqual([2, 1, 0]);
  });
});

describe('transformFacing', () => {
  it('a 90° turn maps up -> right -> down -> left -> up', () => {
    const t = rotateCW(IDENTITY);
    expect(transformFacing('up', t)).toBe('right');
    expect(transformFacing('right', t)).toBe('down');
    expect(transformFacing('down', t)).toBe('left');
    expect(transformFacing('left', t)).toBe('up');
  });

  it('flipH swaps left/right only, flipV swaps up/down only', () => {
    const h = flipH(IDENTITY);
    const v = flipV(IDENTITY);
    const dirs: Facing[] = ['up', 'down', 'left', 'right'];
    expect(dirs.map((d) => transformFacing(d, h))).toEqual([
      'up',
      'down',
      'right',
      'left',
    ]);
    expect(dirs.map((d) => transformFacing(d, v))).toEqual([
      'down',
      'up',
      'left',
      'right',
    ]);
  });
});

describe('transformFields + describeTransform', () => {
  it('omits defaults', () => {
    expect(transformFields(IDENTITY)).toEqual({});
    expect(transformFields({ rot: 0, flipX: true })).toEqual({ flipX: true });
    expect(transformFields({ rot: 270, flipX: false })).toEqual({ rot: 270 });
    expect(transformFields({ rot: 90, flipX: true })).toEqual({ rot: 90, flipX: true });
  });

  it('labels the transform', () => {
    expect(describeTransform(IDENTITY)).toBe('No rotation');
    expect(describeTransform({ rot: 90, flipX: true })).toBe('Rotation 90° · mirrored');
  });
});
