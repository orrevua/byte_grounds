import catalog from './seat-catalog.json' with { type: 'json' };
import { transformFacing, type Facing, type OfficeMap, type Seat } from './map.ts';

/** What a sheet cell offers once stamped: sit or lie, facing `dir` (untransformed). */
export interface SeatSpot {
  kind: Seat['kind'];
  dir: Facing;
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
      else index.set(key, { kind: r.kind, dir: r.dir! });
    }
  }
  return index;
}

const INDEX = buildIndex(catalog.rules);

/** The seat a stamped `(sheet, sx, sy)` cell offers, if any. */
export function seatSpot(sheet: string, sx: number, sy: number): SeatSpot | undefined {
  return INDEX.get(cellKey(sheet, sx, sy));
}

/**
 * Seats offered by the map's decor: one per tile whose cell is in the catalog, facing turned by
 * the cell's transform. On a tile with several seat cells the last one (drawn on top) wins.
 */
export function derivedSeats(m: OfficeMap): Seat[] {
  const byTile = new Map<string, Seat>();
  for (const cell of m.decor ?? []) {
    const spot = seatSpot(cell.sheet, cell.sx, cell.sy);
    if (!spot) continue;
    const dir = transformFacing(spot.dir, { rot: cell.rot ?? 0, flipX: cell.flipX === true });
    byTile.set(`${cell.x},${cell.y}`, { x: cell.x, y: cell.y, kind: spot.kind, dir });
  }
  return [...byTile.values()];
}

/** The seats players can use: authored seats, then derived ones on other tiles not in `noSeats`. */
export function effectiveSeats(m: OfficeMap): Seat[] {
  const taken = new Set([...(m.seats ?? []), ...(m.noSeats ?? [])].map(({ x, y }) => `${x},${y}`));
  return [...(m.seats ?? []), ...derivedSeats(m).filter(({ x, y }) => !taken.has(`${x},${y}`))];
}
