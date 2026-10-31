import { describe, it, expect } from 'vitest';
import { findObjectAt, labelObjects, objectAt, objectCells, pickCellsAt, type PixelBuffer } from '../src/decor-objects.ts';

function sheet(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Fill the inclusive pixel rect with an opaque-ish colour of the given alpha. */
function fill(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, alpha = 255): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      buf.data.set([120, 80, 40, alpha], (y * buf.width + x) * 4);
    }
  }
}

describe('decor objects', () => {
  it('finds a single blob and the one cell it sits in', () => {
    const buf = sheet(64, 64);
    fill(buf, 4, 4, 13, 9);
    const obj = findObjectAt(buf, 6, 6)!;
    expect([obj.x0, obj.y0, obj.x1, obj.y1]).toEqual([4, 4, 13, 9]);
    expect(objectCells(obj)).toEqual({ sx: 0, sy: 0, w: 1, h: 1 });
  });

  it('keeps two blobs apart when only a shadow touches both', () => {
    const buf = sheet(64, 32);
    fill(buf, 2, 2, 9, 9);
    fill(buf, 14, 2, 21, 9);
    fill(buf, 10, 2, 13, 9, 100);
    const objs = labelObjects(buf);
    const a = objectAt(objs, 4, 4)!;
    const b = objectAt(objs, 16, 4)!;
    expect(a).not.toBe(b);
    expect([a.cx0, a.cx1, b.cx0, b.cx1]).toEqual([2, 9, 14, 21]);
    expect(a.x1).toBeLessThan(b.x0);
    expect(objectAt(objs, 11, 4)).toBe(a);
    expect(objectAt(objs, 12, 4)).toBe(b);
  });

  it('snaps a click on a transparent pixel to the nearest solid pixel in the cell', () => {
    const buf = sheet(64, 32);
    fill(buf, 20, 20, 27, 27);
    fill(buf, 36, 4, 43, 11);
    const obj = findObjectAt(buf, 2, 2)!;
    expect([obj.x0, obj.y0]).toEqual([20, 20]);
  });

  it('covers every cell of an object spanning 2x2 cells', () => {
    const buf = sheet(128, 96);
    fill(buf, 40, 20, 70, 50);
    const obj = findObjectAt(buf, 60, 45)!;
    expect(objectCells(obj)).toEqual({ sx: 1, sy: 0, w: 2, h: 2 });
  });

  it('does not widen the pick for a shadow spilling past the art', () => {
    const buf = sheet(64, 64);
    fill(buf, 4, 4, 27, 27);
    fill(buf, 4, 28, 27, 35, 80);
    const obj = findObjectAt(buf, 10, 10)!;
    expect(obj.y1).toBe(35);
    expect(objectCells(obj)).toEqual({ sx: 0, sy: 0, w: 1, h: 1 });
  });

  it('returns null for an empty cell or a point off the sheet', () => {
    const buf = sheet(64, 32);
    fill(buf, 4, 4, 13, 13);
    expect(findObjectAt(buf, 40, 10)).toBeNull();
    expect(findObjectAt(buf, -1, 4)).toBeNull();
    expect(findObjectAt(buf, 64, 4)).toBeNull();
  });
});

/** Opaque fill of one colour (luma follows the grey level). */
function paint(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, grey: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buf.data.set([grey, grey, grey, 255], (y * buf.width + x) * 4);
}

/** A cell-filling sprite: a 1px dark outline around a light fill, with a dark detail. */
function sprite(buf: PixelBuffer, cx: number, cy: number): void {
  paint(buf, cx * 32, cy * 32, cx * 32 + 31, cy * 32 + 31, 30);
  paint(buf, cx * 32 + 1, cy * 32 + 1, cx * 32 + 30, cy * 32 + 30, 200);
  paint(buf, cx * 32 + 8, cy * 32 + 6, cx * 32 + 12, cy * 32 + 20, 30);
}

describe('pickCellsAt', () => {
  it('picks one piece out of a row of packed sprites whose outlines touch', () => {
    const buf = sheet(32 * 6, 32);
    for (let i = 0; i < 6; i++) sprite(buf, i, 0);
    const objs = labelObjects(buf);
    expect(objectCells(objectAt(objs, 70, 16)!)).toEqual({ sx: 0, sy: 0, w: 6, h: 1 }); // the old merged pick
    expect(pickCellsAt(objs, 70, 16)).toEqual({ sx: 2, sy: 0, w: 1, h: 1 });
  });

  it('keeps a long continuous piece (a counter) whole', () => {
    const buf = sheet(32 * 6, 32);
    paint(buf, 0, 4, 32 * 6 - 1, 27, 30);
    paint(buf, 1, 5, 32 * 6 - 2, 26, 200);
    expect(pickCellsAt(labelObjects(buf), 70, 16)).toEqual({ sx: 0, sy: 0, w: 6, h: 1 });
  });

  it('leaves small objects exactly as before', () => {
    const buf = sheet(64, 64);
    paint(buf, 4, 4, 50, 40, 120);
    const objs = labelObjects(buf);
    expect(pickCellsAt(objs, 10, 10)).toEqual(objectCells(objectAt(objs, 10, 10)!));
  });
});
