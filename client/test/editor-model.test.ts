import { describe, it, expect } from 'vitest';
import { createBlankMap, isWalkable, parseMap, startPosition, tileAt, tileColor } from '@byte_grounds/shared/map';
import { eraseDecor, paintColor, resizeMap, setBlocked, setSpawn, stampDecor } from '../src/editor-model.ts';

describe('map editing', () => {
  it('a blank map has a wall border and a walkable spawn', () => {
    const m = createBlankMap('My Room', 6, 4);
    expect(m.id).toBe('my-room');
    expect(tileAt(m, 0, 0)).toBe(1);
    expect(tileAt(m, 2, 2)).toBe(0);
    expect(isWalkable(m, m.spawn.x, m.spawn.y)).toBe(true);
  });

  it('paints colors and toggles walkability per tile', () => {
    const m = createBlankMap('a', 5, 5);
    paintColor(m, 2, 2, '#ff0000');
    setBlocked(m, 2, 2, true);
    expect(tileColor(m, 2, 2)).toBe('#ff0000');
    expect(isWalkable(m, 2.5, 2.5)).toBe(false);
    paintColor(m, 99, 99, '#000'); // out of bounds: ignored
    expect(m.colors!.length).toBeLessThanOrEqual(25);
  });

  it('stamps a multi-cell decoration, optionally blocking it, and erases the top one', () => {
    const m = createBlankMap('a', 6, 6);
    stampDecor(m, 1, 1, { sheet: 'furniture', sx: 4, sy: 2, w: 2, h: 1 }, true);
    expect(m.decor).toEqual([
      { x: 1, y: 1, sheet: 'furniture', sx: 4, sy: 2, layer: 'object' },
      { x: 2, y: 1, sheet: 'furniture', sx: 5, sy: 2, layer: 'object' },
    ]);
    expect(isWalkable(m, 2.5, 1.5)).toBe(false);

    stampDecor(m, 1, 1, { sheet: 'furniture', sx: 4, sy: 2, w: 1, h: 1 }, false); // duplicate
    expect(m.decor).toHaveLength(2);
    expect(eraseDecor(m, 2, 1)).toBe(true);
    expect(eraseDecor(m, 2, 1)).toBe(false);
  });

  it('stamps a turned piece on its turned footprint', () => {
    const m = createBlankMap('a', 6, 6);
    stampDecor(m, 1, 1, { sheet: 'furniture', sx: 4, sy: 2, w: 2, h: 1 }, true, { rot: 90, flipX: false });
    expect(m.decor).toEqual([
      { x: 1, y: 1, sheet: 'furniture', sx: 4, sy: 2, layer: 'object', rot: 90 },
      { x: 1, y: 2, sheet: 'furniture', sx: 5, sy: 2, layer: 'object', rot: 90 },
    ]);
    expect(isWalkable(m, 1.5, 1.5)).toBe(false);
    expect(isWalkable(m, 1.5, 2.5)).toBe(false);
    expect(isWalkable(m, 2.5, 1.5)).toBe(true);
    expect(parseMap(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('re-stamping the same cell updates its transform instead of adding one', () => {
    const m = createBlankMap('a', 6, 6);
    const sel = { sheet: 's', sx: 0, sy: 0, w: 1, h: 1 };
    stampDecor(m, 2, 2, sel, false, { rot: 90, flipX: false });
    stampDecor(m, 2, 2, sel, false, { rot: 0, flipX: true });
    expect(m.decor).toEqual([{ x: 2, y: 2, sheet: 's', sx: 0, sy: 0, layer: 'floor', flipX: true }]);
    stampDecor(m, 2, 2, sel, false);
    expect(m.decor).toEqual([{ x: 2, y: 2, sheet: 's', sx: 0, sy: 0, layer: 'floor' }]);
  });

  it('moving the spawn makes that tile walkable', () => {
    const m = createBlankMap('a', 5, 5);
    setSpawn(m, 0, 0); // a border wall
    expect(m.spawn).toEqual({ x: 0.5, y: 0.5 });
    expect(isWalkable(m, 0.5, 0.5)).toBe(true);
  });

  it('resizes keeping content and dropping what falls outside', () => {
    const m = createBlankMap('a', 6, 6);
    paintColor(m, 1, 1, '#123456');
    stampDecor(m, 5, 5, { sheet: 's', sx: 0, sy: 0, w: 1, h: 1 }, false);
    const r = resizeMap(m, 4, 8);
    expect([r.width, r.height, r.tiles.length]).toEqual([4, 8, 32]);
    expect(tileColor(r, 1, 1)).toBe('#123456');
    expect(r.decor).toEqual([]);
    expect(parseMap(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
});

describe('startPosition', () => {
  it('uses the saved spot when walkable, else the spawn', () => {
    const m = createBlankMap('a', 6, 6);
    expect(startPosition(m, { x: 3.2, y: 4.1 })).toEqual({ x: 3.2, y: 4.1 });
    expect(startPosition(m, { x: 0.5, y: 0.5 })).toEqual(m.spawn); // now a wall
    expect(startPosition(m, null)).toEqual(m.spawn);
  });
});

describe('seats', () => {
  it('toggles a seat: add, change facing/kind, remove on the same click', async () => {
    const { toggleSeat } = await import('../src/editor-model.ts');
    const m = createBlankMap('a', 6, 6);
    expect(toggleSeat(m, 2, 2, 'sit', 'down')).toEqual({ x: 2, y: 2, kind: 'sit', dir: 'down' });
    expect(toggleSeat(m, 2, 2, 'lie', 'down')).toEqual({ x: 2, y: 2, kind: 'lie', dir: 'down' });
    expect(m.seats).toHaveLength(1);
    expect(toggleSeat(m, 2, 2, 'lie', 'down')).toBeUndefined();
    expect(m.seats).toEqual([]);
  });

  it('survive save/load and are dropped when resized away', async () => {
    const { toggleSeat } = await import('../src/editor-model.ts');
    const m = createBlankMap('a', 6, 6);
    toggleSeat(m, 1, 1, 'sit', 'left');
    toggleSeat(m, 5, 5, 'lie', 'down');
    expect(parseMap(JSON.parse(JSON.stringify(m)))!.seats).toEqual(m.seats);
    expect(resizeMap(m, 4, 4).seats).toEqual([{ x: 1, y: 1, kind: 'sit', dir: 'left' }]);
  });

  it('parseMap drops malformed seats', () => {
    const m = { ...createBlankMap('a', 4, 4), seats: [{ x: 1, y: 1, kind: 'fly', dir: 'down' }, null] };
    expect(parseMap(m)!.seats).toEqual([]);
  });
});
