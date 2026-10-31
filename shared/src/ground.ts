import catalog from './ground-cells.json' with { type: 'json' };

/**
 * The decor hierarchy: `ground` (floor and wall tiles, from `ground-cells.json`, written by
 * tools/gen_ground_cells.py) under `furniture` (everything else). A tile has at most one ground
 * cell in effect; placing another replaces it and goes under the furniture, while furniture
 * stacks (a computer on a desk).
 */
export type DecorLevel = 'ground' | 'furniture';

const GROUND = new Map<string, ReadonlySet<string>>(
  Object.entries(catalog as Record<string, string[]>).map(([sheet, cells]) => [sheet, new Set(cells)]),
);

export function isGroundCell(c: { sheet: string; sx: number; sy: number }): boolean {
  return GROUND.get(c.sheet)?.has(`${c.sx},${c.sy}`) ?? false;
}

export function decorLevel(c: { sheet: string; sx: number; sy: number }): DecorLevel {
  return isGroundCell(c) ? 'ground' : 'furniture';
}
