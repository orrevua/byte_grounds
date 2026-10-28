import { describe, it, expect } from 'vitest';
import { tileAt, isWalkable, OFFICE_MAP, type OfficeMap } from '../src/map.ts';

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

describe('OFFICE_MAP', () => {
  it('has consistent dimensions and a walkable spawn', () => {
    expect(OFFICE_MAP.tiles.length).toBe(OFFICE_MAP.width * OFFICE_MAP.height);
    expect(isWalkable(OFFICE_MAP, OFFICE_MAP.spawn.x, OFFICE_MAP.spawn.y)).toBe(true);
  });

  it('has a solid border wall', () => {
    expect(tileAt(OFFICE_MAP, 0, 0)).toBe(1);
    expect(tileAt(OFFICE_MAP, OFFICE_MAP.width - 1, OFFICE_MAP.height - 1)).toBe(1);
  });
});
