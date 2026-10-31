import type { OfficeMap } from '@byte_grounds/shared/map';
import type { HeldItem } from '@byte_grounds/shared/protocol';

/** Sheet cells that are drink machines once stamped, and what they give. */
const MACHINES: { sheet: string; sx: number; sy: number; item: Exclude<HeldItem, ''> }[] = [
  { sheet: 'office', sx: 10, sy: 0, item: 'coffee' }, // coffee maker
  { sheet: 'office', sx: 10, sy: 20, item: 'water' }, // water cooler (top)
  { sheet: 'office', sx: 10, sy: 21, item: 'water' }, // water cooler (base)
];

/** How close (tiles, to a machine cell's center) you must stand to use it; counters sit in between. */
export const MACHINE_REACH = 2.2;

/** How long a drink lasts: one of these, at random. */
export const DRINK_MS = [30_000, 60_000, 300_000] as const;

export interface Machine {
  x: number;
  y: number;
  item: Exclude<HeldItem, ''>;
}

/** Every drink machine on the map (one per tile). */
export function machinesIn(m: OfficeMap): Machine[] {
  const byTile = new Map<string, Machine>();
  for (const d of m.decor ?? []) {
    const hit = MACHINES.find((k) => k.sheet === d.sheet && k.sx === d.sx && k.sy === d.sy);
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
