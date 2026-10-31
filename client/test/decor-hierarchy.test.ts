import { describe, it, expect } from 'vitest';
import { createBlankMap, isWalkable } from '@byte_grounds/shared/map';
import { builtInMap } from '@byte_grounds/shared/maps';
import { decorLevel, isGroundCell } from '@byte_grounds/shared/ground';
import { brushCells, cellBlocks, eraseDecor, setBlocked, stampDecor } from '../src/editor-model.ts';
import { EditLog, refusedByWall } from '../src/live-model.ts';
import type { EditOp, MapEdit } from '../src/edit-ops.ts';
import { IDENTITY } from '../src/decor-transform.ts';

const oak = { sheet: 'gemini_floors', sx: 0, sy: 0, w: 1, h: 1 };
const grey = { sheet: 'gemini_floors', sx: 6, sy: 0, w: 1, h: 1 };
const chair = { sheet: 'chairs', sx: 0, sy: 0, w: 1, h: 1 };
const art = (m: { decor?: { x: number; y: number; sheet: string; sx: number }[] }, x: number, y: number) =>
  (m.decor ?? []).filter((d) => d.x === x && d.y === y).map((d) => `${d.sheet}:${d.sx}`);

describe('decor hierarchy', () => {
  it('knows ground (floor / wall tiles) from furniture', () => {
    expect(isGroundCell(oak)).toBe(true);
    expect(decorLevel(chair)).toBe('furniture');
    expect(isGroundCell({ sheet: 'nope', sx: 0, sy: 0 })).toBe(false);
  });

  it('a new floor over a chair on a floor replaces only the floor, under the chair', () => {
    const m = createBlankMap('t', 6, 6);
    stampDecor(m, 2, 2, oak, 'none');
    stampDecor(m, 2, 2, chair, 'none');
    stampDecor(m, 2, 2, grey, 'base');
    expect(art(m, 2, 2)).toEqual(['gemini_floors:6', 'chairs:0']);
    expect(m.decor!.find((d) => d.sheet === 'gemini_floors')!.layer).toBe('floor');
  });

  it('a floor on a tile with only furniture goes under it', () => {
    const m = createBlankMap('t', 6, 6);
    stampDecor(m, 3, 3, chair, 'none');
    stampDecor(m, 3, 3, oak, 'none');
    expect(art(m, 3, 3)).toEqual(['gemini_floors:0', 'chairs:0']);
  });

  it('furniture still stacks on furniture', () => {
    const m = createBlankMap('t', 6, 6);
    stampDecor(m, 1, 1, chair, 'none');
    stampDecor(m, 1, 1, { sheet: 'office', sx: 9, sy: 0, w: 1, h: 1 }, 'none');
    expect(art(m, 1, 1)).toEqual(['chairs:0', 'office:9']);
  });

  it('live placement keeps the old floor under the new one, so removing it shows the old again', () => {
    const m = createBlankMap('t', 6, 6);
    stampDecor(m, 2, 2, oak, 'none');
    stampDecor(m, 2, 2, chair, 'none');
    stampDecor(m, 2, 2, grey, 'none', IDENTITY, { keepGround: true });
    expect(art(m, 2, 2)).toEqual(['gemini_floors:0', 'gemini_floors:6', 'chairs:0']);
    stampDecor(m, 2, 2, grey, 'none', IDENTITY, { keepGround: true }); // the same floor again: no copy
    expect(art(m, 2, 2)).toEqual(['gemini_floors:0', 'gemini_floors:6', 'chairs:0']);
    expect(eraseDecor(m, 2, 2)).toBe(true); // erase takes the furniture first
    expect(art(m, 2, 2)).toEqual(['gemini_floors:0', 'gemini_floors:6']);
  });

  it('floors lie on the floor layer and only block with Whole piece', () => {
    const [cell] = brushCells(0, 0, oak, IDENTITY, 'base');
    expect(cell!.layer).toBe('floor');
    expect(cell!.baseDy).toBeUndefined();
    expect(cellBlocks(cell!, 'base')).toBe(false);
    expect(cellBlocks(cell!, 'all')).toBe(true);
    const m = createBlankMap('t', 6, 6);
    stampDecor(m, 2, 2, oak, 'base');
    expect(isWalkable(m, 2.5, 2.5)).toBe(true);
    const [c] = brushCells(0, 0, chair, IDENTITY, 'base');
    expect(cellBlocks(c!, 'base')).toBe(true);
  });

  it("covers the built-in maps' floor tiles (only partial trims stay furniture)", () => {
    let floors = 0;
    let ground = 0;
    for (const id of ['lounge', 'office', 'home', 'studio']) {
      for (const d of builtInMap(id)!.decor ?? []) {
        if (d.layer !== 'floor' || !['interior_tiles', 'house_inside', 'gemini_floors'].includes(d.sheet)) continue;
        floors++;
        if (isGroundCell(d)) ground++;
      }
    }
    expect(floors).toBeGreaterThan(3000);
    expect(ground / floors).toBeGreaterThan(0.97);
  });

  it('erases the furniture or the floor, as asked; by default the furniture first', () => {
    const m = createBlankMap('t', 6, 6);
    stampDecor(m, 2, 2, oak, 'none');
    stampDecor(m, 2, 2, chair, 'all');
    expect(isWalkable(m, 2.5, 2.5)).toBe(false);
    expect(eraseDecor(m, 2, 2, 'ground')).toBe(true);
    expect(art(m, 2, 2)).toEqual(['chairs:0']);
    expect(isWalkable(m, 2.5, 2.5)).toBe(false); // the chair still blocks
    stampDecor(m, 2, 2, oak, 'none');
    expect(eraseDecor(m, 2, 2)).toBe(true); // furniture first
    expect(art(m, 2, 2)).toEqual(['gemini_floors:0']);
    expect(isWalkable(m, 2.5, 2.5)).toBe(true); // its last object left: walkable again
    expect(eraseDecor(m, 2, 2, 'furniture')).toBe(false);
  });

  it('never refuses a floor on a wall; refuses blocking furniture there', () => {
    const m = createBlankMap('t', 6, 6);
    setBlocked(m, 3, 3, true);
    const [floor] = brushCells(3, 3, oak, IDENTITY, 'all');
    const [seat] = brushCells(3, 3, chair, IDENTITY, 'base');
    expect(refusedByWall(m, floor!, 'all')).toBe(false);
    expect(refusedByWall(m, seat!, 'base')).toBe(true);
  });

  it('live erase finds the latest placement of the chosen level', () => {
    const place = (sel: typeof oak): EditOp => ({ kind: 'place', x: 2, y: 2, ...sel, mode: 'none', rot: 0, flipX: false });
    const edit = (id: number, op: EditOp): MapEdit => ({ id, author: 'u1', op });
    const log = new EditLog(createBlankMap('t', 6, 6), 0, () => true);
    log.add(edit(1, place(chair)));
    log.add(edit(2, place(oak)));
    expect(log.placementAt(2, 2)!.id).toBe(2);
    expect(log.placementAt(2, 2, 'furniture')!.id).toBe(1);
    expect(log.placementAt(2, 2, 'ground')!.id).toBe(2);
  });
});
