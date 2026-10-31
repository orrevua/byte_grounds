import catalog from './seat-catalog.json' with { type: 'json' };
import { transformFacing, type Facing, type OfficeMap, type Seat } from './map.ts';

/** What a sheet cell offers once stamped: sit or lie, facing `dir` (untransformed). */
export interface SeatSpot {
  kind: Seat['kind'];
  dir: Facing;
  /** A blanket's head row (tools/gen_bed_seats.py): only used when no pillow spot is at its head. */
  fallback?: true;
}

/**
 * One rule of `seat-catalog.json`: the cells `(x + i*step[0], y + j*step[1])` inside the
 * `w x h` rect of `sheet` get `kind`/`dir`; `none` removes cells. Later rules win.
 */
export interface SeatRule {
  sheet: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  step?: [number, number];
  kind: Seat['kind'] | 'none';
  dir?: Facing;
  fallback?: boolean;
}

const FACINGS: readonly unknown[] = ['up', 'down', 'left', 'right'];

function isCount(v: unknown): boolean {
  return Number.isInteger(v) && (v as number) >= 1;
}

export function isSeatRule(r: unknown): r is SeatRule {
  if (!r || typeof r !== 'object') return false;
  const { sheet, x, y, w, h, step, kind, dir } = r as Partial<Record<keyof SeatRule, unknown>>;
  if (typeof sheet !== 'string' || !sheet) return false;
  if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0) return false;
  if ((w !== undefined && !isCount(w)) || (h !== undefined && !isCount(h))) return false;
  if (step !== undefined && !(Array.isArray(step) && step.length === 2 && step.every(isCount))) return false;
  if (kind === 'none') return true;
  return (kind === 'sit' || kind === 'lie') && FACINGS.includes(dir);
}

function cellKey(sheet: string, sx: number, sy: number): string {
  return `${sheet}:${sx},${sy}`;
}

/** Every cell a rule covers. */
export function ruleCells(r: SeatRule): { sx: number; sy: number }[] {
  const [stepX, stepY] = r.step ?? [1, 1];
  const cells: { sx: number; sy: number }[] = [];
  for (let j = 0; j * stepY < (r.h ?? 1); j++) {
    for (let i = 0; i * stepX < (r.w ?? 1); i++) cells.push({ sx: r.x + i * stepX, sy: r.y + j * stepY });
  }
  return cells;
}

/** The cell -> spot lookup for `rules` (malformed rules skipped, later rules override). */
export function buildIndex(rules: readonly unknown[]): Map<string, SeatSpot> {
  const index = new Map<string, SeatSpot>();
  for (const r of rules) {
    if (!isSeatRule(r)) continue;
    for (const { sx, sy } of ruleCells(r)) {
      const key = cellKey(r.sheet, sx, sy);
      if (r.kind === 'none') index.delete(key);
      else index.set(key, { kind: r.kind, dir: r.dir!, ...(r.fallback === true ? { fallback: true as const } : {}) });
    }
  }
  return index;
}

const INDEX = buildIndex(catalog.rules);

/** A seat marked on one cell of a runtime sheet (Sheet Studio): which way the person faces. */
export interface SeatMark {
  x: number;
  y: number;
  kind: Seat['kind'];
  dir: Facing;
}

/** Coerce untrusted seat marks (bad entries dropped). */
export function normalizeSeatMarks(x: unknown): SeatMark[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((m) => {
    const o = (m ?? {}) as Partial<Record<keyof SeatMark, unknown>>;
    if (!Number.isInteger(o.x) || !Number.isInteger(o.y) || (o.x as number) < 0 || (o.y as number) < 0) return [];
    if ((o.kind !== 'sit' && o.kind !== 'lie') || !FACINGS.includes(o.dir)) return [];
    return [{ x: o.x as number, y: o.y as number, kind: o.kind, dir: o.dir as Facing }];
  });
}

/**
 * Seat cells of a sheet added at runtime (a Sheet Studio sheet): replaces any earlier marks of
 * that sheet, so a re-saved sheet's seats are exactly its current ones.
 */
export function registerSeatMarks(sheet: string, marks: readonly SeatMark[]): void {
  const prefix = `${sheet}:`;
  for (const key of [...INDEX.keys()]) if (key.startsWith(prefix)) INDEX.delete(key);
  for (const m of normalizeSeatMarks(marks)) INDEX.set(cellKey(sheet, m.x, m.y), { kind: m.kind, dir: m.dir });
}

/** The seat a stamped `(sheet, sx, sy)` cell offers, if any. */
export function seatSpot(sheet: string, sx: number, sy: number): SeatSpot | undefined {
  return INDEX.get(cellKey(sheet, sx, sy));
}

/**
 * Seats offered by the map's decor: one per tile whose cell is in the catalog, facing turned by
 * the cell's transform. On a tile with several seat cells the last one (drawn on top) wins.
 */
export function derivedSeats(m: OfficeMap): Seat[] {
  const byTile = new Map<string, { seat: Seat; fallback: boolean }>();
  for (const cell of m.decor ?? []) {
    const spot = seatSpot(cell.sheet, cell.sx, cell.sy);
    if (!spot) continue;
    const dir = transformFacing(spot.dir, { rot: cell.rot ?? 0, flipX: cell.flipX === true });
    byTile.set(`${cell.x},${cell.y}`, { seat: { x: cell.x, y: cell.y, kind: spot.kind, dir }, fallback: spot.fallback === true });
  }
  // A blanket's spot gives way to a pillow spot right at its head (pillow + blanket = one bed,
  // head on the pillow); a blanket on its own keeps it.
  const out: Seat[] = [];
  for (const { seat, fallback } of byTile.values()) {
    if (fallback) {
      const v = STEP[seat.dir];
      const head = byTile.get(`${seat.x - v.dx},${seat.y - v.dy}`);
      if (head && !head.fallback && head.seat.kind === 'lie') continue;
    }
    out.push(seat);
  }
  return out;
}

const STEP: Record<Facing, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** The seats players can use: authored seats, then derived ones on other tiles not in `noSeats`. */
export function effectiveSeats(m: OfficeMap): Seat[] {
  const taken = new Set([...(m.seats ?? []), ...(m.noSeats ?? [])].map(({ x, y }) => `${x},${y}`));
  return [...(m.seats ?? []), ...derivedSeats(m).filter(({ x, y }) => !taken.has(`${x},${y}`))];
}
