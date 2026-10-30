import { describe, it, expect } from 'vitest';
import { parseEditOp, placeOp, toMapEdit, type PlaceOp } from '../src/edit-ops.ts';

const PLACE: PlaceOp = {
  kind: 'place',
  x: 3,
  y: 4,
  sheet: 'office_grid',
  sx: 1,
  sy: 2,
  w: 2,
  h: 3,
  mode: 'base',
  rot: 90,
  flipX: false,
};

const place = (p: Record<string, unknown>) => parseEditOp({ ...PLACE, ...p });

describe('parseEditOp', () => {
  it('accepts every valid kind', () => {
    expect(parseEditOp(PLACE)).toEqual(PLACE);
    expect(parseEditOp({ kind: 'remove', target: 7, place: PLACE })).toEqual({ kind: 'remove', target: 7, place: PLACE });
    expect(parseEditOp({ kind: 'erase', x: 0, y: 79 })).toEqual({ kind: 'erase', x: 0, y: 79 });
    expect(parseEditOp({ kind: 'tile', x: 1, y: 2, blocked: true })).toEqual({ kind: 'tile', x: 1, y: 2, blocked: true });
    expect(parseEditOp({ kind: 'reset' })).toEqual({ kind: 'reset' });
  });

  it('rejects non-objects and unknown kinds', () => {
    for (const v of [null, undefined, 3, 'place', [], { kind: 'seat' }, {}]) expect(parseEditOp(v)).toBeNull();
  });

  it('checks x, y as integers 0..79', () => {
    expect(place({ x: 79, y: 0 })).not.toBeNull();
    expect(place({ x: 80 })).toBeNull();
    expect(place({ y: -1 })).toBeNull();
    expect(place({ x: 1.5 })).toBeNull();
    expect(place({ x: '1' })).toBeNull();
    expect(parseEditOp({ kind: 'erase', x: 0, y: 80 })).toBeNull();
    expect(parseEditOp({ kind: 'tile', x: 80, y: 0, blocked: false })).toBeNull();
  });

  it('checks the sheet name', () => {
    expect(place({ sheet: 'a-b_9' })).not.toBeNull();
    expect(place({ sheet: 'Office' })).toBeNull();
    expect(place({ sheet: '' })).toBeNull();
    expect(place({ sheet: 'a'.repeat(49) })).toBeNull();
    expect(place({ sheet: 3 })).toBeNull();
  });

  it('checks sx, sy 0..63 and w, h 1..8', () => {
    expect(place({ sx: 63, sy: 0, w: 8, h: 1 })).not.toBeNull();
    expect(place({ sx: 64 })).toBeNull();
    expect(place({ sy: -1 })).toBeNull();
    expect(place({ w: 0 })).toBeNull();
    expect(place({ h: 9 })).toBeNull();
  });

  it('checks mode, rot and flipX', () => {
    expect(place({ mode: 'none', rot: 270, flipX: true })).not.toBeNull();
    expect(place({ mode: 'wall' })).toBeNull();
    expect(place({ rot: 45 })).toBeNull();
    expect(place({ rot: 360 })).toBeNull();
    expect(place({ flipX: 1 })).toBeNull();
  });

  it('checks remove: positive integer target and a valid place copy', () => {
    expect(parseEditOp({ kind: 'remove', target: 0, place: PLACE })).toBeNull();
    expect(parseEditOp({ kind: 'remove', target: 2.5, place: PLACE })).toBeNull();
    expect(parseEditOp({ kind: 'remove', target: 1, place: { ...PLACE, w: 9 } })).toBeNull();
    expect(parseEditOp({ kind: 'remove', target: 1, place: { kind: 'erase', x: 1, y: 1 } })).toBeNull();
    expect(parseEditOp({ kind: 'tile', x: 1, y: 1, blocked: 'yes' })).toBeNull();
  });

  it('rejects missing and extra keys', () => {
    const { flipX: _, ...missing } = PLACE;
    expect(parseEditOp(missing)).toBeNull();
    expect(place({ extra: 1 })).toBeNull();
    expect(parseEditOp({ kind: 'erase', x: 1, y: 1, blocked: true })).toBeNull();
    expect(parseEditOp({ kind: 'reset', x: 1 })).toBeNull();
    expect(parseEditOp({ kind: 'remove', target: 1, place: PLACE, x: 1 })).toBeNull();
  });

  it('rejects an op over 2048 characters', () => {
    expect(parseEditOp({ kind: 'reset', pad: 'x'.repeat(2048) })).toBeNull();
  });
});

describe('placeOp', () => {
  it('builds a place op that parses', () => {
    const op = placeOp(3, 4, { sheet: 'office_grid', sx: 1, sy: 2, w: 2, h: 3 }, 'base', { rot: 90, flipX: false });
    expect(op).toEqual(PLACE);
    expect(parseEditOp(op)).toEqual(PLACE);
  });
});

describe('toMapEdit', () => {
  it('reads a row, accepting a string id (bigint)', () => {
    expect(toMapEdit({ id: '12', author: 'u1', op: PLACE })).toEqual({ id: 12, author: 'u1', op: PLACE });
    expect(toMapEdit({ id: 3, author: 'u1', op: { kind: 'reset' } })).toEqual({ id: 3, author: 'u1', op: { kind: 'reset' } });
  });

  it('rejects a bad id, author or op', () => {
    expect(toMapEdit({ id: 0, author: 'u1', op: PLACE })).toBeNull();
    expect(toMapEdit({ id: 'x', author: 'u1', op: PLACE })).toBeNull();
    expect(toMapEdit({ id: 1, op: PLACE })).toBeNull();
    expect(toMapEdit({ id: 1, author: 'u1', op: { kind: 'nope' } })).toBeNull();
    expect(toMapEdit(null)).toBeNull();
  });
});
