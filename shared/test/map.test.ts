import { describe, it, expect } from 'vitest';
import { tileAt, isWalkable, decorLayer, parseMap, type OfficeMap } from '../src/map.ts';

const m: OfficeMap = {
  id: 'test',
  width: 3,
  height: 2,
  // floor floor wall / wall floor floor
  tiles: [0, 0, 1, 1, 0, 0],
  spawn: { x: 1.5, y: 0.5 },
};

describe('tileAt', () => {
  it('reads row-major tiles', () => {
    expect(tileAt(m, 0, 0)).toBe(0);
    expect(tileAt(m, 2, 0)).toBe(1);
    expect(tileAt(m, 0, 1)).toBe(1);
    expect(tileAt(m, 2, 1)).toBe(0);
  });

  it('treats out-of-bounds as wall', () => {
    expect(tileAt(m, -1, 0)).toBe(1);
    expect(tileAt(m, 0, -1)).toBe(1);
    expect(tileAt(m, 3, 0)).toBe(1);
    expect(tileAt(m, 0, 2)).toBe(1);
  });
});

describe('isWalkable', () => {
  it('floors are walkable, walls are not', () => {
    expect(isWalkable(m, 0.9, 0.1)).toBe(true);
    expect(isWalkable(m, 2.5, 0.5)).toBe(false);
    expect(isWalkable(m, 0.5, 1.5)).toBe(false);
  });

  it('out-of-bounds floats are blocked', () => {
    expect(isWalkable(m, -0.5, 0.5)).toBe(false);
    expect(isWalkable(m, 3.5, 0.5)).toBe(false);
  });
});

describe('parseMap decor layer', () => {
  const base = { id: 'd', width: 2, height: 1, tiles: [0, 1], spawn: { x: 0.5, y: 0.5 } };

  it('keeps a valid layer and strips a junk one', () => {
    const parsed = parseMap({
      ...base,
      decor: [
        { x: 0, y: 0, sheet: 's', sx: 0, sy: 0, layer: 'object' },
        { x: 1, y: 0, sheet: 's', sx: 0, sy: 0, layer: 'bogus' },
        { x: 0, y: 0, sheet: 's', sx: 0, sy: 0 },
      ],
    })!;
    expect(parsed.decor).toEqual([
      { x: 0, y: 0, sheet: 's', sx: 0, sy: 0, layer: 'object' },
      { x: 1, y: 0, sheet: 's', sx: 0, sy: 0 },
      { x: 0, y: 0, sheet: 's', sx: 0, sy: 0 },
    ]);
  });
});

describe('parseMap decor transform', () => {
  const base = { id: 'd', width: 2, height: 1, tiles: [0, 0], spawn: { x: 0.5, y: 0.5 } };
  const cell = { x: 0, y: 0, sheet: 's', sx: 0, sy: 0 };

  it('keeps a valid rotation and flip', () => {
    const parsed = parseMap({
      ...base,
      decor: [
        { ...cell, rot: 90 },
        { ...cell, rot: 180, flipX: true },
        { ...cell, rot: 270 },
        { ...cell, flipX: true },
      ],
    })!;
    expect(parsed.decor).toEqual([
      { ...cell, rot: 90 },
      { ...cell, rot: 180, flipX: true },
      { ...cell, rot: 270 },
      { ...cell, flipX: true },
    ]);
  });

  it('drops default and junk values', () => {
    const parsed = parseMap({
      ...base,
      decor: [
        { ...cell, rot: 0 },
        { ...cell, rot: 45 },
        { ...cell, rot: '90' },
        { ...cell, flipX: false },
        { ...cell, flipX: 'yes' },
      ],
    })!;
    expect(parsed.decor).toEqual([cell, cell, cell, cell, cell]);
  });
});

describe('parseMap decor baseDy', () => {
  const base = { id: 'd', width: 2, height: 2, tiles: [0, 0, 0, 0], spawn: { x: 0.5, y: 0.5 } };
  const cell = { x: 0, y: 0, sheet: 's', sx: 0, sy: 0 };

  it('keeps a positive integer baseDy', () => {
    expect(parseMap({ ...base, decor: [{ ...cell, baseDy: 1 }] })!.decor).toEqual([{ ...cell, baseDy: 1 }]);
  });

  it('strips default and junk values', () => {
    const parsed = parseMap({
      ...base,
      decor: [cell, { ...cell, baseDy: 0 }, { ...cell, baseDy: -1 }, { ...cell, baseDy: 1.5 }, { ...cell, baseDy: '1' }],
    })!;
    expect(parsed.decor).toEqual([cell, cell, cell, cell, cell]);
    expect(parsed.decor!.every((d) => !('baseDy' in d))).toBe(true);
  });
});

describe('parseMap basedOnRev', () => {
  const base = { id: 'd', width: 2, height: 2, tiles: [0, 0, 0, 0], spawn: { x: 0.5, y: 0.5 } };

  it('keeps a positive integer and drops a missing or junk one', () => {
    expect(parseMap({ ...base, basedOnRev: 3 })!.basedOnRev).toBe(3);
    for (const junk of [undefined, 0, -1, 1.5, '2']) {
      expect('basedOnRev' in parseMap({ ...base, basedOnRev: junk })!).toBe(false);
    }
  });
});

describe('decorLayer', () => {
  // tiles: (0,0) floor, (1,0) wall.
  const m: OfficeMap = { id: 'd', width: 2, height: 1, tiles: [0, 1], spawn: { x: 0.5, y: 0.5 } };

  it('uses the explicit layer when set', () => {
    expect(decorLayer(m, { x: 0, y: 0, sheet: 's', sx: 0, sy: 0, layer: 'object' })).toBe('object');
    expect(decorLayer(m, { x: 1, y: 0, sheet: 's', sx: 0, sy: 0, layer: 'floor' })).toBe('floor');
  });

  it('infers object over a wall tile and floor otherwise', () => {
    expect(decorLayer(m, { x: 1, y: 0, sheet: 's', sx: 0, sy: 0 })).toBe('object');
    expect(decorLayer(m, { x: 0, y: 0, sheet: 's', sx: 0, sy: 0 })).toBe('floor');
  });
});

describe('seatsNear', () => {
  it('finds seats in reach, nearest first', async () => {
    const { createBlankMap, seatsNear, seatAt } = await import('../src/map.ts');
    const m = createBlankMap('a', 10, 10);
    m.seats = [
      { x: 5, y: 5, kind: 'sit', dir: 'down' },
      { x: 3, y: 3, kind: 'lie', dir: 'down' },
    ];
    expect(seatsNear(m, 3.5, 4.5, 1.6).map((s) => s.x)).toEqual([3]);
    expect(seatsNear(m, 4.5, 4.5, 1.6).map((s) => s.x)).toEqual([5, 3]);
    expect(seatsNear(m, 8.5, 8.5, 1.6)).toEqual([]);
    expect(seatAt(m, 5, 5)?.kind).toBe('sit');
  });
});
