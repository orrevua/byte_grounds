export type Tile = 0 | 1; // 0 = floor (walkable), 1 = wall (blocked)

export interface OfficeMap {
  id: string;
  width: number;
  height: number;
  tiles: Tile[]; // row-major, length = width * height
  spawn: { x: number; y: number };
}

/** Tile value at integer tile coords; out-of-bounds reads as wall. */
export function tileAt(m: OfficeMap, tx: number, ty: number): Tile {
  if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return 1;
  return m.tiles[ty * m.width + tx];
}

/** Whether a continuous (float) tile-space position sits on a walkable tile. */
export function isWalkable(m: OfficeMap, x: number, y: number): boolean {
  return tileAt(m, Math.floor(x), Math.floor(y)) === 0;
}

// Hand-authored 20x15 office: solid border wall, a couple of interior blocks.
function buildOffice(): OfficeMap {
  const width = 20;
  const height = 15;
  const tiles: Tile[] = new Array(width * height).fill(0);
  const set = (tx: number, ty: number, v: Tile) => {
    tiles[ty * width + tx] = v;
  };

  // Border walls.
  for (let x = 0; x < width; x++) {
    set(x, 0, 1);
    set(x, height - 1, 1);
  }
  for (let y = 0; y < height; y++) {
    set(0, y, 1);
    set(width - 1, y, 1);
  }

  // Interior furniture/dividers.
  for (let x = 4; x <= 8; x++) set(x, 5, 1); // horizontal divider
  for (let y = 8; y <= 11; y++) set(13, y, 1); // vertical divider
  set(6, 9, 1);
  set(7, 9, 1);
  set(6, 10, 1);
  set(7, 10, 1); // 2x2 block (meeting table)

  return { id: 'office', width, height, tiles, spawn: { x: 2.5, y: 2.5 } };
}

export const OFFICE_MAP: OfficeMap = buildOffice();
