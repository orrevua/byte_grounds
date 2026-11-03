import { canonicalSheet, type OfficeMap } from '@byte_grounds/shared/map';
import { SNACKS, type Snack } from '@byte_grounds/shared/protocol';

/** What a machine gives: a coffee, a water, or a snack (a random one each time). */
export type MachineKind = 'coffee' | 'water' | 'snack';

/** Sheet cells that are drink machines once stamped, and what they give. */
const MACHINES: { sheet: string; sx: number; sy: number; item: MachineKind }[] = [
  { sheet: 'office', sx: 10, sy: 0, item: 'coffee' }, // coffee maker
  { sheet: 'office', sx: 10, sy: 20, item: 'water' }, // water cooler (top)
  { sheet: 'office', sx: 10, sy: 21, item: 'water' }, // water cooler (base)
  { sheet: 'byte_grounds_studio_grid', sx: 0, sy: 4, item: 'coffee' }, // Gemini coffee bar (machine)
  { sheet: 'byte_grounds_studio_grid', sx: 1, sy: 4, item: 'coffee' },
  { sheet: 'byte_grounds_studio_grid', sx: 4, sy: 2, item: 'water' }, // Gemini water cooler
  { sheet: 'byte_grounds_studio_grid', sx: 4, sy: 3, item: 'water' },
  { sheet: 'byte_grounds_office2_grid', sx: 9, sy: 4, item: 'water' }, // Gemini water dispenser
  { sheet: 'byte_grounds_office2_grid', sx: 9, sy: 5, item: 'water' },
  { sheet: 'byte_grounds_cafe_grid', sx: 0, sy: 0, item: 'coffee' }, // café counter (espresso machine)
  { sheet: 'byte_grounds_cafe_grid', sx: 1, sy: 0, item: 'coffee' },
  { sheet: 'byte_grounds_cafe_grid', sx: 0, sy: 1, item: 'coffee' },
  { sheet: 'byte_grounds_cafe_grid', sx: 1, sy: 1, item: 'coffee' },
  { sheet: 'byte_grounds_cafe_grid', sx: 4, sy: 3, item: 'water' }, // café water cooler
  { sheet: 'byte_grounds_cafe_grid', sx: 4, sy: 4, item: 'water' },
  // Snack sellers: the Gemini vending machine and the café pastry case.
  ...[0, 1].flatMap((dx) => [2, 3].map((sy) => ({ sheet: 'byte_grounds_studio_grid', sx: 5 + dx, sy, item: 'snack' as const }))),
  ...[0, 1, 2].flatMap((dx) => [0, 1].map((sy) => ({ sheet: 'byte_grounds_cafe_grid', sx: 5 + dx, sy, item: 'snack' as const }))),
];

/** How close (tiles, to a machine cell's center) you must stand to use it; counters sit in between. */
export const MACHINE_REACH = 2.2;

/** How long a drink lasts: one of these, at random. */
export const DRINK_MS = [30_000, 60_000, 300_000] as const;

export interface Machine {
  x: number;
  y: number;
  item: MachineKind;
}

/** The snack a seller hands out for a random number in [0, 1). */
export function snackFor(rand: number): Snack {
  return SNACKS[Math.min(SNACKS.length - 1, Math.floor(rand * SNACKS.length))]!;
}

/** Every drink machine and snack seller on the map (one per tile). */
export function machinesIn(m: OfficeMap): Machine[] {
  const byTile = new Map<string, Machine>();
  for (const d of m.decor ?? []) {
    const sheet = canonicalSheet(d.sheet);
    const hit = MACHINES.find((k) => k.sheet === sheet && k.sx === d.sx && k.sy === d.sy);
    if (hit) byTile.set(`${d.x},${d.y}`, { x: d.x, y: d.y, item: hit.item });
  }
  return [...byTile.values()];
}

/** The nearest machine within reach of (x, y), if any. */
export function machineNear(machines: readonly Machine[], x: number, y: number): Machine | undefined {
  let best: Machine | undefined;
  let bestD = MACHINE_REACH;
  for (const k of machines) {
    const d = Math.hypot(k.x + 0.5 - x, k.y + 0.5 - y);
    if (d <= bestD) {
      best = k;
      bestD = d;
    }
  }
  return best;
}

/** A drink's duration for a random number in [0, 1). */
export function drinkDuration(rand: number): number {
  return DRINK_MS[Math.min(DRINK_MS.length - 1, Math.floor(rand * DRINK_MS.length))]!;
}

/** "30 s", "1 min", "5 min". */
export function formatDuration(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}
