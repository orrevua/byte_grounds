import { describe, it, expect } from 'vitest';
import { createBlankMap, isWalkable, type OfficeMap } from '@byte_grounds/shared/map';
import { setBlocked, stampDecor } from '../src/editor-model.ts';
import { placeOp, type EditOp, type MapEdit, type PlaceOp } from '../src/edit-ops.ts';
import { EditLog, applyEdit, blockedByWall, mergeLiveEdits, replaceMapContents } from '../src/live-model.ts';

const known = () => true;
const DESK = { sheet: 'office_grid', sx: 2, sy: 1, w: 2, h: 2 };
const NONE = { rot: 0, flipX: false } as const;

function room(): OfficeMap {
  return createBlankMap('Room', 10, 8);
}

const desk = (x: number, y: number, mode: PlaceOp['mode'] = 'base', t: { rot: 0 | 90 | 180 | 270; flipX: boolean } = NONE) =>
  placeOp(x, y, DESK, mode, t);

const edit = (id: number, op: EditOp, author = 'u1'): MapEdit => ({ id, author, op });

describe('applyEdit: place / erase / tile', () => {
  it('a place equals stampDecor', () => {
    const m = room();
    const expected = room();
    stampDecor(expected, 3, 2, DESK, 'base', { rot: 90, flipX: true });
    expect(applyEdit(m, desk(3, 2, 'base', { rot: 90, flipX: true }), known)).toBe(true);
    expect(m).toEqual(expected);
  });

  it('a place whose blocking cells land on a blocked tile is a no-op', () => {
    const m = room();
    setBlocked(m, 4, 3, true);
    const before = structuredClone(m);
    expect(applyEdit(m, desk(3, 2), known)).toBe(false);
    expect(m).toEqual(before);
    // The top row doesn't block in 'base' mode, so a blocked tile under it is fine.
    expect(applyEdit(m, desk(3, 3), known)).toBe(true);
    expect(applyEdit(m, desk(4, 2, 'none'), known)).toBe(true);
  });

  it('a chair can tuck into a tile blocked by furniture (a desk front row), not into a wall', () => {
    const m = room();
    expect(applyEdit(m, desk(3, 2), known)).toBe(true); // 2x2 desk; its base row (y 3) blocks
    expect(blockedByWall(m, 4, 3)).toBe(false);
    const chair = placeOp(4, 3, { sheet: 'office_grid', sx: 0, sy: 0, w: 1, h: 1 }, 'base', NONE);
    expect(applyEdit(m, chair, known)).toBe(true);
    // Stamped after the desk on the same tile, so it draws in front of it.
    const onTile = m.decor!.filter((d) => d.x === 4 && d.y === 3);
    expect(onTile.at(-1)).toMatchObject({ sheet: 'office_grid', sx: 0, sy: 0 });
    // A plain wall still refuses it.
    setBlocked(m, 8, 6, true);
    expect(blockedByWall(m, 8, 6)).toBe(true);
    expect(applyEdit(m, placeOp(8, 6, { sheet: 'office_grid', sx: 0, sy: 0, w: 1, h: 1 }, 'base', NONE), known)).toBe(false);
  });

  it('an unknown sheet or a piece fully outside the map is a no-op', () => {
    const m = room();
    expect(applyEdit(m, desk(3, 2), (s) => s !== 'office_grid')).toBe(false);
    expect(applyEdit(m, desk(20, 20), known)).toBe(false);
    expect(m).toEqual(room());
  });

  it('erase and tile delegate, out of bounds is a no-op', () => {
    const m = room();
    applyEdit(m, desk(3, 2), known);
    const cells = m.decor!.length;
    expect(applyEdit(m, { kind: 'erase', x: 3, y: 2 }, known)).toBe(true);
    expect(m.decor).toHaveLength(cells - 1);
    expect(applyEdit(m, { kind: 'erase', x: 9, y: 7 }, known)).toBe(false);
    expect(applyEdit(m, { kind: 'tile', x: 5, y: 5, blocked: true }, known)).toBe(true);
    expect(isWalkable(m, 5.5, 5.5)).toBe(false);
    expect(applyEdit(m, { kind: 'tile', x: 5, y: 5, blocked: true }, known)).toBe(false);
    expect(applyEdit(m, { kind: 'tile', x: 5, y: 5, blocked: false }, known)).toBe(true);
    expect(applyEdit(m, { kind: 'tile', x: 40, y: 2, blocked: true }, known)).toBe(false);
    expect(applyEdit(m, { kind: 'erase', x: 40, y: 2 }, known)).toBe(false);
    expect(applyEdit(m, { kind: 'reset' }, known)).toBe(false);
  });
});

describe('applyEdit: remove', () => {
  for (const [mode, t] of [
    ['base', NONE],
    ['all', NONE],
    ['none', NONE],
    ['base', { rot: 90, flipX: true }],
  ] as const) {
    it(`place then remove restores the map (${mode}, rot ${t.rot})`, () => {
      const m = room();
      const before = structuredClone(m);
      const op = desk(3, 2, mode, t);
      applyEdit(m, op, known);
      expect(m).not.toEqual(before);
      expect(applyEdit(m, { kind: 'remove', target: 1, place: op }, known)).toBe(true);
      expect(m).toEqual(before);
    });
  }

  it('keeps a tile blocked while another object still stands on it', () => {
    const m = room();
    const a = desk(3, 2, 'all');
    applyEdit(m, a, known);
    stampDecor(m, 3, 3, { sheet: 'other', sx: 0, sy: 0, w: 1, h: 1 }, 'base');
    applyEdit(m, { kind: 'remove', target: 1, place: a }, known);
    expect(isWalkable(m, 3.5, 3.5)).toBe(false);
    expect(isWalkable(m, 4.5, 3.5)).toBe(true);
    expect(isWalkable(m, 3.5, 2.5)).toBe(true);
  });

  it('removing twice, or removing a placement that never took effect, changes nothing', () => {
    const m = room();
    const op = desk(3, 2);
    applyEdit(m, op, known);
    applyEdit(m, { kind: 'remove', target: 1, place: op }, known);
    const after = structuredClone(m);
    expect(applyEdit(m, { kind: 'remove', target: 1, place: op }, known)).toBe(false);
    expect(m).toEqual(after);
    // A place over a wall was a no-op: its remove must not unblock the wall.
    expect(applyEdit(m, { kind: 'remove', target: 2, place: desk(0, 0) }, known)).toBe(false);
    expect(isWalkable(m, 0.5, 1.5)).toBe(false);
  });
});

describe('EditLog', () => {
  const ops: MapEdit[] = [
    edit(11, desk(1, 1)),
    edit(12, desk(5, 1), 'u2'),
    edit(13, { kind: 'tile', x: 7, y: 6, blocked: true }, 'admin'),
    edit(14, { kind: 'remove', target: 11, place: desk(1, 1) }),
    edit(15, desk(3, 4)),
    edit(16, { kind: 'erase', x: 5, y: 1 }, 'admin'),
  ];

  it('in-order and shuffled arrival give the same map', () => {
    const a = new EditLog(room(), 10, known);
    for (const e of ops) expect(a.add(e)).toBe('applied');
    const b = new EditLog(room(), 10, known);
    const results = [3, 0, 5, 1, 4, 2].map((i) => b.add(ops[i]!));
    expect(results).toContain('rebuilt');
    expect(b.map).toEqual(a.map);
    expect(b.lastId).toBe(16);
    expect(b.unbaked).toBe(6);
  });

  it('ignores duplicates and ids already baked', () => {
    const log = new EditLog(room(), 10, known);
    expect(log.add(edit(10, desk(1, 1)))).toBe('duplicate');
    expect(log.add(ops[0]!)).toBe('applied');
    expect(log.add(ops[0]!)).toBe('duplicate');
    expect(log.lastId).toBe(11);
    expect(log.unbaked).toBe(1);
    expect([log.has(9), log.has(11), log.has(12)]).toEqual([true, true, false]);
    expect(new EditLog(room(), 10, known).lastId).toBe(10);
  });

  it('finds the own last placement still standing, skipping removed and others', () => {
    const log = new EditLog(room(), 10, known);
    for (const e of ops.slice(0, 4)) log.add(e);
    expect(log.lastOwnPlacement('u1')).toBeNull();
    log.add(ops[4]!);
    expect(log.lastOwnPlacement('u1')?.id).toBe(15);
    expect(log.lastOwnPlacement('u2')?.id).toBe(12);
    expect(log.lastOwnPlacement('nobody')).toBeNull();
  });

  it('finds the placement covering a tile', () => {
    const log = new EditLog(room(), 10, known);
    for (const e of ops.slice(0, 5)) log.add(e);
    expect(log.placementAt(6, 2)?.id).toBe(12);
    expect(log.placementAt(4, 5)?.id).toBe(15);
    expect(log.placementAt(1, 1)).toBeNull();
    expect(log.placementAt(8, 6)).toBeNull();
  });

  it('keeps its map object across rebuilds', () => {
    const log = new EditLog(room(), 0, known);
    const map = log.map;
    log.add(edit(2, desk(1, 1)));
    log.add(edit(1, desk(5, 1)));
    expect(log.map).toBe(map);
  });
});

describe('replaceMapContents', () => {
  it('copies fields into the same object and drops the missing ones', () => {
    const target: OfficeMap = { ...room(), noSeats: [{ x: 1, y: 1 }] };
    const source = createBlankMap('Other', 4, 3);
    replaceMapContents(target, source);
    expect(target).toEqual(source);
    expect('noSeats' in target).toBe(false);
  });
});

describe('mergeLiveEdits', () => {
  it('applies in id order to the map and every snapshot', () => {
    const m = room();
    setBlocked(m, 8, 1, true);
    const snaps = [JSON.stringify(room()), JSON.stringify(m)];
    const edits = [edit(21, { kind: 'remove', target: 20, place: desk(1, 1) }), edit(20, desk(1, 1)), edit(22, desk(5, 4))];
    const direct = structuredClone(m);
    for (const e of [edits[1]!, edits[0]!, edits[2]!]) applyEdit(direct, e.op, known);
    expect(mergeLiveEdits(m, snaps, edits, known)).toEqual({ merged: 3, lastId: 22, conflict: false });
    expect(m).toEqual(direct);
    const snap1 = room();
    applyEdit(snap1, desk(5, 4), known);
    expect(JSON.parse(snaps[0]!)).toEqual(snap1);
    expect(JSON.parse(snaps[1]!)).toEqual(direct);
  });

  it('stops at a reset with a conflict', () => {
    const m = room();
    const snaps = [JSON.stringify(m)];
    const r = mergeLiveEdits(m, snaps, [edit(30, desk(1, 1)), edit(31, { kind: 'reset' }), edit(32, desk(5, 4))], known);
    expect(r).toEqual({ merged: 1, lastId: 30, conflict: true });
    expect(m.decor).toHaveLength(4);
    expect(JSON.parse(snaps[0]!).decor).toHaveLength(4);
  });

  it('an empty list merges nothing', () => {
    const m = room();
    const snaps = [JSON.stringify(m)];
    expect(mergeLiveEdits(m, snaps, [], known)).toEqual({ merged: 0, lastId: 0, conflict: false });
    expect(m).toEqual(room());
  });
});
