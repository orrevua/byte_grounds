import { MAX_MAP_SIZE, type Facing, type OfficeMap, type Seat, type Tile } from '@byte_grounds/shared/map';

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
 * Stamp a sheet selection with its top-left on tile (x, y), on top of what's there.
 * `block` also marks the covered tiles as not walkable (tables, shelves...).
 */
export function stampDecor(m: OfficeMap, x: number, y: number, sel: DecorSelection, block: boolean): void {
  m.decor ??= [];
  for (let dy = 0; dy < sel.h; dy++) {
    for (let dx = 0; dx < sel.w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!inBounds(m, tx, ty)) continue;
      const cell = { x: tx, y: ty, sheet: sel.sheet, sx: sel.sx + dx, sy: sel.sy + dy };
      const dup = m.decor.some(
        (d) => d.x === tx && d.y === ty && d.sheet === cell.sheet && d.sx === cell.sx && d.sy === cell.sy,
      );
      if (!dup) m.decor.push(cell);
      if (block) setBlocked(m, tx, ty, true);
    }
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
  return {
    ...m,
    width: w,
    height: h,
    tiles,
    colors,
    spawn,
    decor: (m.decor ?? []).filter((d) => d.x < w && d.y < h),
    seats: (m.seats ?? []).filter((st) => st.x < w && st.y < h),
  };
}

