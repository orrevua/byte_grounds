export type Tile = 0 | 1; // 0 = floor (walkable), 1 = wall (blocked)

/** Clockwise rotation of a decor cell, in degrees. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * One decoration piece: a 32x32 cell (`sx`, `sy`, in cells) of an art sheet in
 * `client/src/assets/decor/<sheet>.png`, drawn on map tile (`x`, `y`) above the floor.
 * Bigger objects (a table) are several cells stamped side by side.
 */
export interface DecorCell {
  x: number;
  y: number;
  sheet: string;
  sx: number;
  sy: number;
  /** Depth layer: `floor` draws under all avatars; `object` depth-sorts against them. */
  layer?: 'floor' | 'object';
  /** Rows from this cell down to its object's base row (where it stands). Absent = 0. */
  baseDy?: number;
  /** Clockwise rotation in degrees, applied after flipX. Absent = 0. */
  rot?: Rotation;
  /** Mirror horizontally (in the cell's own space, before rotating). Absent = false. */
  flipX?: boolean;
}

export type Facing = 'up' | 'down' | 'left' | 'right';

/**
 * A spot players can use: sit on a chair/sofa or lie on a bed. The player snaps to the
 * tile's center facing `dir` (for a bed, the tile with the pillow; `dir` = where the feet point).
 */
export interface Seat {
  x: number;
  y: number;
  kind: 'sit' | 'lie';
  dir: Facing;
}

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];

const CLOCKWISE: readonly Facing[] = ['up', 'right', 'down', 'left'];

/** A facing carried through a decor transform: mirror swaps left/right, then turn clockwise. */
export function transformFacing(dir: Facing, t: { rot: Rotation; flipX: boolean }): Facing {
  const mirrored = t.flipX && dir === 'left' ? 'right' : t.flipX && dir === 'right' ? 'left' : dir;
  return CLOCKWISE[(CLOCKWISE.indexOf(mirrored) + t.rot / 90) % 4]!;
}

export interface OfficeMap {
  id: string;
  name?: string;
  width: number;
  height: number;
  tiles: Tile[]; // row-major, length = width * height
  spawn: { x: number; y: number };
  /** Per-tile floor color (hex), row-major; missing = default floor/wall color. */
  colors?: string[];
  decor?: DecorCell[];
  seats?: Seat[];
  /** Tiles whose automatic (catalog-derived) seat is turned off. Absent = none. */
  noSeats?: { x: number; y: number }[];
  /** A saved copy of a built-in map: the built-in `rev` it was edited from. Absent = stale. */
  basedOnRev?: number;
}

export const DEFAULT_FLOOR_COLOR = '#2a2f37';
export const DEFAULT_WALL_COLOR = '#454d5a';
export const MAX_MAP_SIZE = 80;

/** Tile value at integer tile coords; out-of-bounds reads as wall. */
export function tileAt(m: OfficeMap, tx: number, ty: number): Tile {
  if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return 1;
  return m.tiles[ty * m.width + tx];
}

/** Whether a continuous (float) tile-space position sits on a walkable tile. */
export function isWalkable(m: OfficeMap, x: number, y: number): boolean {
  return tileAt(m, Math.floor(x), Math.floor(y)) === 0;
}

/** The tile's color: its painted color, else the default for floor/wall. */
export function tileColor(m: OfficeMap, tx: number, ty: number): string {
  const c = m.colors?.[ty * m.width + tx];
  if (c) return c;
  return tileAt(m, tx, ty) === 1 ? DEFAULT_WALL_COLOR : DEFAULT_FLOOR_COLOR;
}

/** A map id from a display name: lowercase, dashes, safe for URLs and channel names. */
export function mapIdFromName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'map'
  );
}

/** A new empty map: walkable floor inside a wall border, spawn near the top-left. */
export function createBlankMap(name: string, width: number, height: number): OfficeMap {
  const w = Math.max(3, Math.min(MAX_MAP_SIZE, Math.round(width)));
  const h = Math.max(3, Math.min(MAX_MAP_SIZE, Math.round(height)));
  const tiles: Tile[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) tiles.push(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 1 : 0);
  }
  return { id: mapIdFromName(name), name, width: w, height: h, tiles, spawn: { x: 1.5, y: 1.5 }, colors: [], decor: [], seats: [] };
}

/** Validate map JSON from storage; null if it isn't a usable map. */
export function parseMap(data: unknown): OfficeMap | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Partial<OfficeMap>;
  const { id, width, height, tiles, spawn } = m;
  if (typeof id !== 'string' || !id) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width! < 1 || height! < 1 || width! > MAX_MAP_SIZE || height! > MAX_MAP_SIZE) return null;
  if (!Array.isArray(tiles) || tiles.length !== width! * height!) return null;
  if (!spawn || !Number.isFinite(spawn.x) || !Number.isFinite(spawn.y)) return null;
  return {
    id,
    name: typeof m.name === 'string' ? m.name : id,
    width: width!,
    height: height!,
    tiles: tiles.map((t) => (t === 1 ? 1 : 0)),
    spawn: { x: spawn.x, y: spawn.y },
    colors: Array.isArray(m.colors) ? m.colors.map((c) => (typeof c === 'string' ? c : '')) : [],
    decor: Array.isArray(m.decor)
      ? m.decor
          .filter(
            (d): d is DecorCell =>
              !!d && typeof d.sheet === 'string' && [d.x, d.y, d.sx, d.sy].every(Number.isInteger),
          )
          .map((d) => {
            const cell: DecorCell = { x: d.x, y: d.y, sheet: d.sheet, sx: d.sx, sy: d.sy };
            if (d.layer === 'floor' || d.layer === 'object') cell.layer = d.layer;
            if (Number.isInteger(d.baseDy) && d.baseDy! > 0 && d.baseDy! < MAX_MAP_SIZE) cell.baseDy = d.baseDy;
            if (d.rot === 90 || d.rot === 180 || d.rot === 270) cell.rot = d.rot;
            if (d.flipX === true) cell.flipX = true;
            return cell;
          })
      : [],
    seats: Array.isArray(m.seats)
      ? m.seats.filter(
          (st): st is Seat =>
            !!st &&
            Number.isInteger(st.x) &&
            Number.isInteger(st.y) &&
            (st.kind === 'sit' || st.kind === 'lie') &&
            FACINGS.includes(st.dir),
        )
      : [],
    ...parseNoSeats(m.noSeats),
    ...(Number.isInteger(m.basedOnRev) && m.basedOnRev! > 0 ? { basedOnRev: m.basedOnRev } : {}),
  };
}

/** `{noSeats}` with the valid integer tiles, or `{}` when there are none (canonical: field absent). */
function parseNoSeats(data: unknown): Pick<OfficeMap, 'noSeats'> {
  if (!Array.isArray(data)) return {};
  const noSeats = data
    .filter(
      (t): t is { x: number; y: number } => !!t && typeof t === 'object' && Number.isInteger(t.x) && Number.isInteger(t.y),
    )
    .map(({ x, y }) => ({ x, y }));
  return noSeats.length > 0 ? { noSeats } : {};
}

/**
 * The depth layer of a decor cell: its explicit `layer` if set, else inferred from the tile
 * under it — a wall tile (solid furniture) is an `object` (occludes avatars), anything else `floor`.
 */
export function decorLayer(m: OfficeMap, cell: DecorCell): 'floor' | 'object' {
  return cell.layer ?? (tileAt(m, cell.x, cell.y) === 1 ? 'object' : 'floor');
}

/** Where a returning player starts: their saved spot if it's still walkable, else spawn. */
export function startPosition(m: OfficeMap, saved: { x: number; y: number } | null): { x: number; y: number } {
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && isWalkable(m, saved.x, saved.y)) {
    return { x: saved.x, y: saved.y };
  }
  return { ...m.spawn };
}

/** The seat on tile (x, y), if any. */
export function seatAt(m: OfficeMap, x: number, y: number): Seat | undefined {
  return m.seats?.find((st) => st.x === x && st.y === y);
}

/** Seats within `reach` tiles of (x, y), nearest first (distance to the seat's center). */
export function seatsNear(m: OfficeMap, x: number, y: number, reach: number): Seat[] {
  return seatsNearIn(m.seats ?? [], x, y, reach);
}

/** Seats of `seats` within `reach` tiles of (x, y), nearest first (distance to the seat's center). */
export function seatsNearIn(seats: readonly Seat[], x: number, y: number, reach: number): Seat[] {
  return seats
    .map((st) => ({ st, d: Math.hypot(st.x + 0.5 - x, st.y + 0.5 - y) }))
    .filter(({ d }) => d <= reach)
    .sort((a, b) => a.d - b.d)
    .map(({ st }) => st);
}
