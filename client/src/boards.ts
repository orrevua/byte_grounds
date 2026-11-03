import { canonicalSheet, type OfficeMap } from '@byte_grounds/shared/map';

/** Whiteboard pieces: sheet, the piece's top-left cell and its size (cells). */
const WHITEBOARDS: { sheet: string; sx: number; sy: number; w: number; h: number }[] = [
  { sheet: 'byte_grounds_studio_grid', sx: 9, sy: 0, w: 2, h: 2 }, // whiteboard on a stand
  { sheet: 'byte_grounds_office2_grid', sx: 2, sy: 4, w: 2, h: 2 }, // projector screen
];

/** How close (tiles, to a board cell's center) you must stand to use it. */
export const BOARD_REACH = 2.2;

export interface Whiteboard {
  /** `<map id>:<x>,<y>` of the piece's top-left tile: the saved board's key. */
  id: string;
  cells: { x: number; y: number }[];
}

/** Every whiteboard on the map (cells of the same piece grouped by its top-left tile). */
export function boardsIn(m: OfficeMap): Whiteboard[] {
  const byId = new Map<string, Whiteboard>();
  for (const d of m.decor ?? []) {
    const sheet = canonicalSheet(d.sheet);
    const k = WHITEBOARDS.find((b) => b.sheet === sheet && d.sx >= b.sx && d.sx < b.sx + b.w && d.sy >= b.sy && d.sy < b.sy + b.h);
    if (!k || d.rot || d.flipX) continue;
    const id = `${m.id}:${d.x - (d.sx - k.sx)},${d.y - (d.sy - k.sy)}`;
    const b = byId.get(id) ?? { id, cells: [] };
    b.cells.push({ x: d.x, y: d.y });
    byId.set(id, b);
  }
  return [...byId.values()];
}

/** The whiteboard within reach of (x, y) with its nearest cell, if any. */
export function boardNear(boards: readonly Whiteboard[], x: number, y: number): { board: Whiteboard; dist: number } | undefined {
  let best: { board: Whiteboard; dist: number } | undefined;
  for (const board of boards) {
    for (const c of board.cells) {
      const dist = Math.hypot(c.x + 0.5 - x, c.y + 0.5 - y);
      if (dist <= BOARD_REACH && (!best || dist < best.dist)) best = { board, dist };
    }
  }
  return best;
}
