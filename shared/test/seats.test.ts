import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import catalog from '../src/seat-catalog.json' with { type: 'json' };
import type { DecorCell, OfficeMap, Rotation } from '../src/map.ts';
import { buildIndex, derivedSeats, effectiveSeats, isSeatRule, ruleCells, seatSpot } from '../src/seats.ts';

const DECOR_DIR = resolve(import.meta.dirname, '../../client/src/assets/decor');

/** A PNG's size in 32px cells, read from its IHDR chunk. */
function sheetCells(sheet: string): { w: number; h: number } {
  const png = readFileSync(resolve(DECOR_DIR, `${sheet}.png`));
  return { w: Math.floor(png.readUInt32BE(16) / 32), h: Math.floor(png.readUInt32BE(20) / 32) };
}

describe('seat catalog', () => {
  it('has only valid rules, each inside its sheet', () => {
    const outside = catalog.rules.flatMap((r) => {
      if (!isSeatRule(r)) return [r];
      const size = sheetCells(r.sheet);
      return ruleCells(r).some(({ sx, sy }) => sx >= size.w || sy >= size.h) ? [r] : [];
    });
    expect(outside).toEqual([]);
  });

  it('faces chairs and armchairs by column/row parity', () => {
    expect(seatSpot('chairs', 2, 4)).toEqual({ kind: 'sit', dir: 'down' });
    expect(seatSpot('chairs', 3, 4)).toEqual({ kind: 'sit', dir: 'up' });
    expect(seatSpot('chairs', 2, 5)).toEqual({ kind: 'sit', dir: 'right' });
    expect(seatSpot('chairs', 3, 5)).toEqual({ kind: 'sit', dir: 'left' });
    expect(seatSpot('armchairs', 10, 13)?.dir).toBe('right');
  });

  it('faces sofa fronts, backs and sides', () => {
    expect(seatSpot('sofas', 0, 5)).toEqual({ kind: 'sit', dir: 'down' });
    expect(seatSpot('sofas', 1, 20)).toEqual({ kind: 'sit', dir: 'up' });
    expect(seatSpot('sofas', 0, 6)).toEqual({ kind: 'sit', dir: 'right' });
    expect(seatSpot('sofas', 1, 7)).toEqual({ kind: 'sit', dir: 'left' });
  });

  it('gives stools, ottomans and bed pillows a spot', () => {
    expect(seatSpot('bar_stools', 7, 0)).toEqual({ kind: 'sit', dir: 'up' });
    expect(seatSpot('ottomans', 3, 4)).toEqual({ kind: 'sit', dir: 'down' });
    expect(seatSpot('house_inside', 1, 5)).toEqual({ kind: 'lie', dir: 'down' });
    expect(seatSpot('wooden_furniture', 15, 13)).toEqual({ kind: 'lie', dir: 'down' });
  });

  it('has no spot for bed feet or unknown sheets', () => {
    expect(seatSpot('house_inside', 0, 6)).toBeUndefined();
    expect(seatSpot('wooden_furniture', 14, 13)).toBeUndefined();
    expect(seatSpot('nope', 0, 0)).toBeUndefined();
  });
});

describe('buildIndex', () => {
  it('expands strides, lets later rules override, and skips malformed rules', () => {
    const index = buildIndex([
      { sheet: 's', x: 0, y: 0, w: 4, h: 3, step: [2, 2], kind: 'sit', dir: 'down' },
      { sheet: 's', x: 2, y: 2, kind: 'none' },
      { sheet: 's', x: 0, y: 2, kind: 'lie', dir: 'left' },
      { sheet: 's', x: 1, y: 1, kind: 'sit' },
      { sheet: 's', x: 1, y: 0, w: 0, kind: 'sit', dir: 'up' },
    ]);
    expect([...index.keys()].sort()).toEqual(['s:0,0', 's:0,2', 's:2,0']);
    expect(index.get('s:0,2')).toEqual({ kind: 'lie', dir: 'left' });
  });
});

/** The cells the editor stamps for a `w x h` piece at (x, y), as `brushCells` does. */
function stamp(
  sheet: string,
  sx: number,
  sy: number,
  w: number,
  h: number,
  x: number,
  y: number,
  rot: Rotation = 0,
  flipX = false,
): DecorCell[] {
  const cells: DecorCell[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const fx = flipX ? w - 1 - dx : dx;
      const o =
        rot === 90 ? [h - 1 - dy, fx] : rot === 180 ? [w - 1 - fx, h - 1 - dy] : rot === 270 ? [dy, w - 1 - fx] : [fx, dy];
      const cell: DecorCell = { x: x + o[0]!, y: y + o[1]!, sheet, sx: sx + dx, sy: sy + dy };
      if (rot) cell.rot = rot;
      if (flipX) cell.flipX = true;
      cells.push(cell);
    }
  }
  return cells;
}

function mapWith(decor: DecorCell[], extra: Partial<OfficeMap> = {}): OfficeMap {
  return { id: 't', width: 10, height: 10, tiles: Array(100).fill(0), spawn: { x: 0.5, y: 0.5 }, decor, ...extra };
}

describe('derivedSeats', () => {
  it('turns the facing with the cell transform', () => {
    const left = [{ x: 3, y: 3, kind: 'sit', dir: 'left' }];
    expect(derivedSeats(mapWith(stamp('chairs', 0, 0, 1, 1, 3, 3, 90)))).toEqual(left);
    expect(derivedSeats(mapWith(stamp('chairs', 0, 1, 1, 1, 3, 3, 0, true)))).toEqual(left);
  });

  it('gives a sofa one seat per cell, front and side', () => {
    expect(derivedSeats(mapWith(stamp('sofas', 0, 5, 2, 1, 2, 2)))).toEqual([
      { x: 2, y: 2, kind: 'sit', dir: 'down' },
      { x: 3, y: 2, kind: 'sit', dir: 'down' },
    ]);
    expect(derivedSeats(mapWith(stamp('sofas', 1, 6, 1, 2, 2, 2)))).toEqual([
      { x: 2, y: 2, kind: 'sit', dir: 'left' },
      { x: 2, y: 3, kind: 'sit', dir: 'left' },
    ]);
  });

  it('lies only on the pillow row of a double bed, also rotated', () => {
    expect(derivedSeats(mapWith(stamp('house_inside', 0, 5, 2, 3, 4, 4)))).toEqual([
      { x: 4, y: 4, kind: 'lie', dir: 'down' },
      { x: 5, y: 4, kind: 'lie', dir: 'down' },
    ]);
    expect(derivedSeats(mapWith(stamp('house_inside', 0, 5, 2, 3, 4, 4, 90)))).toEqual([
      { x: 6, y: 4, kind: 'lie', dir: 'left' },
      { x: 6, y: 5, kind: 'lie', dir: 'left' },
    ]);
  });

  it('loses the seat of an erased sofa cell', () => {
    const halfSofa = stamp('sofas', 0, 5, 2, 1, 2, 2).slice(1);
    expect(derivedSeats(mapWith(halfSofa))).toEqual([{ x: 3, y: 2, kind: 'sit', dir: 'down' }]);
  });

  it('keeps the last seat cell on a tile and ignores non-seat cells there', () => {
    const chairUp = { x: 1, y: 1, sheet: 'chairs', sx: 1, sy: 0 };
    const chairDown = { x: 1, y: 1, sheet: 'chairs', sx: 0, sy: 0 };
    const desk = { x: 1, y: 1, sheet: 'office', sx: 10, sy: 8 };
    expect(derivedSeats(mapWith([chairUp, chairDown]))).toEqual([{ x: 1, y: 1, kind: 'sit', dir: 'down' }]);
    expect(derivedSeats(mapWith([chairUp, desk]))).toEqual([{ x: 1, y: 1, kind: 'sit', dir: 'up' }]);
  });
});

describe('effectiveSeats', () => {
  const sofa = stamp('sofas', 0, 5, 2, 1, 2, 2);

  it('lets an authored seat override the derived one on its tile', () => {
    const m = mapWith(sofa, { seats: [{ x: 2, y: 2, kind: 'sit', dir: 'up' }] });
    expect(effectiveSeats(m)).toEqual([
      { x: 2, y: 2, kind: 'sit', dir: 'up' },
      { x: 3, y: 2, kind: 'sit', dir: 'down' },
    ]);
  });

  it('suppresses derived seats in noSeats but never authored ones', () => {
    const m = mapWith(sofa, {
      seats: [{ x: 5, y: 5, kind: 'lie', dir: 'down' }],
      noSeats: [{ x: 3, y: 2 }, { x: 5, y: 5 }],
    });
    expect(effectiveSeats(m)).toEqual([
      { x: 5, y: 5, kind: 'lie', dir: 'down' },
      { x: 2, y: 2, kind: 'sit', dir: 'down' },
    ]);
  });
});
