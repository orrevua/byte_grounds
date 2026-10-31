import { describe, it, expect } from 'vitest';
import { createBlankMap, isWalkable } from '@byte_grounds/shared/map';
import { builtInMap } from '@byte_grounds/shared/maps';
import { decorLevel, isGroundCell } from '@byte_grounds/shared/ground';
import { brushCells, cellBlocks, eraseDecor, stampDecor } from '../src/editor-model.ts';
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
});
