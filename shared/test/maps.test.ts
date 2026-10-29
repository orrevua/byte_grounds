import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isWalkable, parseMap, tileAt, type OfficeMap } from '../src/map.ts';
import { BUILT_IN_MAPS, DEFAULT_MAP, builtInMap, builtInRev } from '../src/maps.ts';
import { DEFAULT_ROOM } from '../src/protocol.ts';

const DECOR_DIR = resolve(import.meta.dirname, '../../client/src/assets/decor');

/** A PNG's size in 32px cells, read from its IHDR chunk; null when the sheet is missing. */
function sheetCells(sheet: string): { w: number; h: number } | null {
  try {
    const png = readFileSync(resolve(DECOR_DIR, `${sheet}.png`));
    return { w: Math.floor(png.readUInt32BE(16) / 32), h: Math.floor(png.readUInt32BE(20) / 32) };
  } catch {
    return null;
  }
}

/** Walkable tiles reachable from spawn, 4-connected. */
function reachable(m: OfficeMap): Set<string> {
  const start = [Math.floor(m.spawn.x), Math.floor(m.spawn.y)] as const;
  const seen = new Set([start.join()]);
  const queue: (readonly [number, number])[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]!;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (tileAt(m, nx, ny) === 0 && !seen.has(`${nx},${ny}`)) {
        seen.add(`${nx},${ny}`);
        queue.push([nx, ny]);
      }
    }
  }
  return seen;
}

describe('built-in maps', () => {
  it('ships the lounge (the default), office and home with unique ids', () => {
    expect(BUILT_IN_MAPS.map((m) => m.id)).toEqual(['lounge', 'office', 'home']);
    expect(DEFAULT_MAP.id).toBe('lounge');
    expect(DEFAULT_ROOM).toBe(DEFAULT_MAP.id);
    expect(builtInMap('home')?.name).toBe('Home');
    expect(builtInMap('nope')).toBeNull();
  });

  it('gives every built-in a revision, and none to other ids', () => {
    for (const m of BUILT_IN_MAPS) expect(builtInRev(m.id)).toBeGreaterThanOrEqual(1);
    expect(builtInRev('nope')).toBe(0);
  });

  for (const m of BUILT_IN_MAPS) {
    describe(m.id, () => {
      it('survives a parseMap round trip unchanged', () => {
        expect(parseMap(JSON.parse(JSON.stringify(m)))).toEqual(m);
      });

      it('has a solid border and a walkable spawn', () => {
        for (let x = 0; x < m.width; x++) expect(tileAt(m, x, 0) + tileAt(m, x, m.height - 1)).toBe(2);
        for (let y = 0; y < m.height; y++) expect(tileAt(m, 0, y) + tileAt(m, m.width - 1, y)).toBe(2);
        expect(isWalkable(m, m.spawn.x, m.spawn.y)).toBe(true);
      });

      it('lets every seat be reached from spawn', () => {
        const seen = reachable(m);
        const unreachable = (m.seats ?? []).filter(
          ({ x, y }) => ![[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].some((p) => seen.has(p.join())),
        );
        expect(m.seats!.length).toBeGreaterThan(0);
        expect(unreachable).toEqual([]);
      });

      it('only references existing decor sheets and cells', () => {
        const sizes = new Map<string, { w: number; h: number } | null>();
        const bad = (m.decor ?? []).filter((d) => {
          if (!sizes.has(d.sheet)) sizes.set(d.sheet, sheetCells(d.sheet));
          const size = sizes.get(d.sheet);
          return !size || d.sx >= size.w || d.sy >= size.h;
        });
        expect(bad).toEqual([]);
      });
    });
  }
});
