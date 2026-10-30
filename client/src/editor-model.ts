import { MAX_MAP_SIZE, type DecorCell, type Facing, type OfficeMap, type Seat, type Tile } from '@byte_grounds/shared/map';
import { IDENTITY, footprint, transformFields, transformOffset, type DecorTransform } from './decor-transform.ts';

/** A rectangle of cells picked from a decor sheet (in 32px cells). */
export interface DecorSelection {
  sheet: string;
  sx: number;
  sy: number;
  w: number;
  h: number;
}

function inBounds(m: OfficeMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < m.width && y < m.height;
}

export function paintColor(m: OfficeMap, x: number, y: number, color: string): void {
  if (!inBounds(m, x, y)) return;
  m.colors ??= [];
  m.colors[y * m.width + x] = color;
}

export function setBlocked(m: OfficeMap, x: number, y: number, blocked: boolean): void {
  if (!inBounds(m, x, y)) return;
  m.tiles[y * m.width + x] = blocked ? 1 : 0;
}

/**
 * How a stamp blocks walking: `none` = floor-layer art (rugs, beds), `base` = only the bottom row
 * of the footprint (desks, shelves: people can walk behind them), `all` = every covered tile.
 */
export type BlockMode = 'none' | 'base' | 'all';

/** Whether stamping `cell` in `mode` makes its tile not walkable. */
export function cellBlocks(cell: DecorCell, mode: BlockMode): boolean {
  return mode === 'all' || (mode === 'base' && (cell.baseDy ?? 0) === 0);
}

/**
 * The cells a brush puts down with the top-left of its transformed footprint on tile (x, y):
 * each source cell moves to its transformed offset and carries the transform. With a `mode`,
 * cells get its layer and, in `base`, the rows down to the footprint's bottom row. No bounds check.
 */
export function brushCells(
  x: number,
  y: number,
  sel: DecorSelection,
  t: DecorTransform,
  mode?: BlockMode,
): DecorCell[] {
  const fh = footprint(sel.w, sel.h, t).h;
  const cells: DecorCell[] = [];
  for (let dy = 0; dy < sel.h; dy++) {
    for (let dx = 0; dx < sel.w; dx++) {
      const o = transformOffset(dx, dy, sel.w, sel.h, t);
      const cell: DecorCell = { x: x + o.dx, y: y + o.dy, sheet: sel.sheet, sx: sel.sx + dx, sy: sel.sy + dy };
      if (mode) cell.layer = mode === 'none' ? 'floor' : 'object';
      if (mode === 'base' && fh - 1 - o.dy > 0) cell.baseDy = fh - 1 - o.dy;
      cells.push({ ...cell, ...transformFields(t) });
    }
  }
  return cells;
}

/**
 * Stamp a sheet selection, turned/mirrored by `t`, with its top-left on tile (x, y), on top of
 * what's there. Tiles blocked by `mode` (see `cellBlocks`) become not walkable; stamping never
 * unblocks. Re-stamping an identical cell on the same tile takes the brush's layer, base row and
 * transform instead of adding a copy.
 */
export function stampDecor(
  m: OfficeMap,
  x: number,
  y: number,
  sel: DecorSelection,
  mode: BlockMode,
  t: DecorTransform = IDENTITY,
): void {
  m.decor ??= [];
  for (const cell of brushCells(x, y, sel, t, mode)) {
    if (!inBounds(m, cell.x, cell.y)) continue;
    const dup = m.decor.find(
      (d) => d.x === cell.x && d.y === cell.y && d.sheet === cell.sheet && d.sx === cell.sx && d.sy === cell.sy,
    );
    if (dup) {
      delete dup.layer;
      delete dup.baseDy;
      delete dup.rot;
      delete dup.flipX;
      Object.assign(dup, cell);
    } else {
      m.decor.push(cell);
    }
    if (cellBlocks(cell, mode)) setBlocked(m, cell.x, cell.y, true);
  }
}

/** Remove the topmost decoration on a tile; true if one was removed. */
export function eraseDecor(m: OfficeMap, x: number, y: number): boolean {
  const decor = m.decor ?? [];
  for (let i = decor.length - 1; i >= 0; i--) {
    if (decor[i]!.x === x && decor[i]!.y === y) {
      decor.splice(i, 1);
      return true;
    }
  }
  return false;
}

/**
 * Mark a tile as a seat/bed spot, or update it if it differs; clicking the same kind and
 * facing again removes it. Returns the seat now on the tile (undefined if removed).
 */
export function toggleSeat(m: OfficeMap, x: number, y: number, kind: Seat['kind'], dir: Facing): Seat | undefined {
  if (!inBounds(m, x, y)) return undefined;
  removeNoSeat(m, x, y);
  m.seats ??= [];
  const i = m.seats.findIndex((st) => st.x === x && st.y === y);
  if (i >= 0 && m.seats[i]!.kind === kind && m.seats[i]!.dir === dir) {
    m.seats.splice(i, 1);
    return undefined;
  }
  const seat: Seat = { x, y, kind, dir };
  if (i >= 0) m.seats[i] = seat;
  else m.seats.push(seat);
  return seat;
}

/** Drop tile (x, y) from `noSeats`, deleting the field once empty; true if it was there. */
function removeNoSeat(m: OfficeMap, x: number, y: number): boolean {
  const i = m.noSeats?.findIndex((t) => t.x === x && t.y === y) ?? -1;
  if (i < 0) return false;
  m.noSeats!.splice(i, 1);
  if (m.noSeats!.length === 0) delete m.noSeats;
  return true;
}

/**
 * Turn the automatic seat on tile (x, y) off, or back on if it was off. Turning it off also
 * removes an authored seat there. Returns true when the tile is now off.
 */
export function toggleNoSeat(m: OfficeMap, x: number, y: number): boolean {
  if (!inBounds(m, x, y) || removeNoSeat(m, x, y)) return false;
  m.seats = (m.seats ?? []).filter((st) => st.x !== x || st.y !== y);
  (m.noSeats ??= []).push({ x, y });
  return true;
}

/** Spawn at the tile's center; it also becomes walkable so players can't spawn in a wall. */
export function setSpawn(m: OfficeMap, x: number, y: number): void {
  if (!inBounds(m, x, y)) return;
  m.spawn = { x: x + 0.5, y: y + 0.5 };
  setBlocked(m, x, y, false);
}

/** Resize keeping the top-left content; new tiles are walkable floor. */
export function resizeMap(m: OfficeMap, width: number, height: number): OfficeMap {
  const w = Math.max(3, Math.min(MAX_MAP_SIZE, Math.round(width)));
  const h = Math.max(3, Math.min(MAX_MAP_SIZE, Math.round(height)));
  const tiles: Tile[] = [];
  const colors: string[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x < m.width && y < m.height;
      tiles.push(inside ? m.tiles[y * m.width + x]! : 0);
      colors.push(inside ? (m.colors?.[y * m.width + x] ?? '') : '');
    }
  }
  const spawn =
    m.spawn.x < w && m.spawn.y < h ? m.spawn : { x: Math.min(1.5, w - 0.5), y: Math.min(1.5, h - 0.5) };
  const { noSeats, ...rest } = m;
  const keptNoSeats = (noSeats ?? []).filter((t) => t.x < w && t.y < h);
  return {
    ...rest,
    width: w,
    height: h,
    tiles,
    colors,
    spawn,
    decor: (m.decor ?? []).filter((d) => d.x < w && d.y < h),
    seats: (m.seats ?? []).filter((st) => st.x < w && st.y < h),
    ...(keptNoSeats.length > 0 ? { noSeats: keptNoSeats } : {}),
  };
}

