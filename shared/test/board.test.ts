import { describe, it, expect } from 'vitest';
import {
  MAX_TABS,
  applyBoardOp,
  emptyBoard,
  itemHit,
  normalizeBoard,
  normalizeBoardOp,
  normalizeItem,
  thinPoints,
  type Item,
} from '../src/board.ts';

const pen: Item = { id: 'a1', by: 'Ana', kind: 'pen', color: '#ff0000', width: 4, points: [10, 10, 50, 10, 90, 10] };
const rect: Item = { id: 'r1', by: 'Ana', kind: 'rect', color: '#00aa00', width: 3, x1: 100, y1: 100, x2: 200, y2: 160 };

describe('whiteboard model', () => {
  it('validates items from the network', () => {
    expect(normalizeItem(pen)).toEqual(pen);
    expect(normalizeItem({ ...pen, color: 'red' })).toBeNull();
    expect(normalizeItem({ ...pen, points: [1, 2, 3] })).toBeNull();
    expect(normalizeItem({ ...pen, id: 'bad id!' })).toBeNull();
    expect(normalizeItem({ ...rect, x1: 1e9 })!.x1).toBe(1800); // clamped near the board
    expect(normalizeItem({ id: 't', by: '', kind: 'text', color: '#000000', width: 2, x1: 5, y1: 5, text: '  ' })).toBeNull();
    expect(normalizeItem({ id: 't', by: '', kind: 'text', color: '#000000', width: 2, x1: 5, y1: 5, text: 'hi' })).toMatchObject({ text: 'hi', size: 28 });
    expect(normalizeBoardOp({ kind: 'add', tab: 'main', item: pen })).toEqual({ kind: 'add', tab: 'main', item: pen });
    expect(normalizeBoardOp({ kind: 'nuke' })).toBeNull();
    expect(normalizeBoardOp({ kind: 'tab-add', id: 'p2', name: '' })).toEqual({ kind: 'tab-add', id: 'p2', name: 'Page' });
  });

  it('applies ops idempotently', () => {
    const b = emptyBoard();
    expect(applyBoardOp(b, { kind: 'add', tab: 'main', item: pen })).toBe(true);
    expect(applyBoardOp(b, { kind: 'add', tab: 'main', item: pen })).toBe(false); // arrives twice
    expect(applyBoardOp(b, { kind: 'add', tab: 'main', item: rect })).toBe(true);
    expect(applyBoardOp(b, { kind: 'remove', tab: 'main', id: 'a1' })).toBe(true);
    expect(applyBoardOp(b, { kind: 'remove', tab: 'main', id: 'a1' })).toBe(false);
    expect(b.tabs[0]!.items.map((i) => i.id)).toEqual(['r1']);
    expect(applyBoardOp(b, { kind: 'clear', tab: 'main' })).toBe(true);
    expect(applyBoardOp(b, { kind: 'add', tab: 'nope', item: pen })).toBe(false);
  });

  it('manages tabs, always keeping one', () => {
    const b = emptyBoard();
    expect(applyBoardOp(b, { kind: 'tab-add', id: 'p2', name: 'Ideas' })).toBe(true);
    expect(applyBoardOp(b, { kind: 'tab-rename', tab: 'p2', name: 'Plan' })).toBe(true);
    expect(applyBoardOp(b, { kind: 'tab-remove', tab: 'main' })).toBe(true);
    expect(applyBoardOp(b, { kind: 'tab-remove', tab: 'p2' })).toBe(false); // the last page stays
    expect(b.tabs).toEqual([{ id: 'p2', name: 'Plan', items: [] }]);
    for (let i = 0; i < MAX_TABS + 3; i++) applyBoardOp(b, { kind: 'tab-add', id: `t${i}`, name: 'x' });
    expect(b.tabs).toHaveLength(MAX_TABS);
  });

  it('cleans a stored board', () => {
    expect(normalizeBoard(null)).toEqual(emptyBoard());
    const b = normalizeBoard({ tabs: [{ id: 'main', name: 'A', items: [pen, pen, { junk: 1 }] }, { id: 'main' }] });
    expect(b.tabs).toHaveLength(1);
    expect(b.tabs[0]!.items).toEqual([pen]);
  });

  it('hit-tests items for the eraser', () => {
    expect(itemHit(pen, 50, 12, 4)).toBe(true);
    expect(itemHit(pen, 50, 40, 4)).toBe(false);
    expect(itemHit(rect, 100, 130, 3)).toBe(true); // on the edge
    expect(itemHit(rect, 150, 130, 3)).toBe(false); // inside an unfilled rect
    expect(itemHit({ ...rect, fill: true }, 150, 130, 3)).toBe(true);
    const ell: Item = { ...rect, id: 'e', kind: 'ellipse' };
    expect(itemHit(ell, 100, 130, 3)).toBe(true);
    expect(itemHit(ell, 150, 130, 3)).toBe(false);
  });

  it('thins freehand points', () => {
    expect(thinPoints([0, 0, 0.5, 0.5, 1, 1, 10, 10, 10.4, 10.2, 20, 20])).toEqual([0, 0, 10, 10, 20, 20]);
  });
});
