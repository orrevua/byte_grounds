import { TILE_SIZE } from '@byte_grounds/shared/protocol';

/**
 * Finds the art object under a point of a decor sheet, so one picker click can select every
 * cell an object covers. Same object rules as `tools/repack_decor.py`: objects are 8-connected
 * regions of solid pixels (alpha >= SOLID_ALPHA; 8 so 1px diagonal outlines stay one piece);
 * translucent drop-shadow pixels go to the nearest solid region they touch (breadth-first from
 * every region at once) so a shadow never bridges two neighbours; a shadow touching no art is its
 * own object (a translucent rug); small detached bits (sparks, steam) join a big object a few px
 * away.
 */

export const SOLID_ALPHA = 200;
const FRAGMENT_PIXELS = 48;
const FRAGMENT_GAP = 3;

/** RGBA pixels, row-major (the shape of canvas `ImageData`). */
export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** An object's full bounding box (shadow included) and its solid core; inclusive pixel bounds. */
export interface ObjectBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  pixels: number;
}

/** Every object of a sheet: a per-pixel label (0 = transparent) and each label's box. */
export interface SheetObjects {
  width: number;
  height: number;
  solid: Uint8Array;
  /** Per-pixel brightness (0..255), to tell a sprite's outline from its fill. */
  luma: Uint8Array;
  label: Int32Array;
  boxes: Map<number, ObjectBox>;
}

/** A rectangle of sheet cells, as a picker selection stores it. */
export interface CellRect {
  sx: number;
  sy: number;
  w: number;
  h: number;
}

/** Breadth-first 8-connected fill over unlabelled `mask` pixels from already-labelled `queue`. */
function flood(mask: Uint8Array, w: number, h: number, label: Int32Array, queue: number[]): void {
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % w;
    const y = (i - x) / w;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
        const j = ny * w + nx;
        if (!label[j] && mask[j]) {
          label[j] = label[i]!;
          queue.push(j);
        }
      }
    }
  }
}

/** Give every still-unlabelled region of `mask` a fresh label; returns the last label used. */
function labelRegions(mask: Uint8Array, w: number, h: number, label: Int32Array, count: number): number {
  for (let i = 0; i < w * h; i++) {
    if (mask[i] && !label[i]) {
      label[i] = ++count;
      flood(mask, w, h, label, [i]);
    }
  }
  return count;
}

/** Transparent pixels between two boxes' full extents (0 when they touch or overlap). */
function gap(a: ObjectBox, b: ObjectBox): number {
  return Math.max(b.x0 - a.x1 - 1, a.x0 - b.x1 - 1, b.y0 - a.y1 - 1, a.y0 - b.y1 - 1, 0);
}

/** Fold small bits into the nearest big object at most FRAGMENT_GAP px away; big ones never merge. */
function absorbFragments(label: Int32Array, boxes: Map<number, ObjectBox>): void {
  const big = [...boxes.values()].filter((b) => b.pixels >= FRAGMENT_PIXELS);
  const remap = new Map<number, ObjectBox>();
  for (const [lab, b] of boxes) {
    if (b.pixels >= FRAGMENT_PIXELS) continue;
    let near: ObjectBox | null = null;
    for (const o of big) if (!near || gap(b, o) < gap(b, near)) near = o;
    if (near && gap(b, near) <= FRAGMENT_GAP) remap.set(lab, near);
  }
  if (remap.size === 0) return;
  const labelOf = new Map([...boxes].map(([lab, b]) => [b, lab]));
  for (const [lab, into] of remap) {
    const b = boxes.get(lab)!;
    boxes.delete(lab);
    into.x0 = Math.min(into.x0, b.x0);
    into.y0 = Math.min(into.y0, b.y0);
    into.x1 = Math.max(into.x1, b.x1);
    into.y1 = Math.max(into.y1, b.y1);
    into.cx0 = Math.min(into.cx0, b.cx0);
    into.cy0 = Math.min(into.cy0, b.cy0);
    into.cx1 = Math.max(into.cx1, b.cx1);
    into.cy1 = Math.max(into.cy1, b.cy1);
    into.pixels += b.pixels;
  }
  for (let i = 0; i < label.length; i++) {
    const into = remap.get(label[i]!);
    if (into) label[i] = labelOf.get(into)!;
  }
}

/** Label every object of a sheet; done once per sheet, then `objectAt` is a lookup. */
export function labelObjects(buf: PixelBuffer): SheetObjects {
  const { width: w, height: h, data } = buf;
  const solid = new Uint8Array(w * h);
  const shadow = new Uint8Array(w * h);
  const luma = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    luma[i] = Math.round(0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!);
    const a = data[i * 4 + 3]!;
    if (a >= SOLID_ALPHA) solid[i] = 1;
    else if (a > 0) shadow[i] = 1;
  }
  const label = new Int32Array(w * h);
  const count = labelRegions(solid, w, h, label, 0);
  const seeds: number[] = [];
  for (let i = 0; i < w * h; i++) if (label[i]) seeds.push(i);
  flood(shadow, w, h, label, seeds);
  labelRegions(shadow, w, h, label, count);

  const boxes = new Map<number, ObjectBox>();
  for (let i = 0; i < w * h; i++) {
    const lab = label[i]!;
    if (!lab) continue;
    const x = i % w;
    const y = (i - x) / w;
    let b = boxes.get(lab);
    if (!b) {
      b = { x0: x, y0: y, x1: x, y1: y, cx0: Infinity, cy0: Infinity, cx1: -Infinity, cy1: -Infinity, pixels: 0 };
      boxes.set(lab, b);
    }
    b.x0 = Math.min(b.x0, x);
    b.x1 = Math.max(b.x1, x);
    b.y1 = y;
    b.pixels++;
    if (solid[i]) {
      b.cx0 = Math.min(b.cx0, x);
      b.cy0 = Math.min(b.cy0, y);
      b.cx1 = Math.max(b.cx1, x);
      b.cy1 = y;
    }
  }
  for (const b of boxes.values()) {
    if (b.cx0 === Infinity) Object.assign(b, { cx0: b.x0, cy0: b.y0, cx1: b.x1, cy1: b.y1 });
  }
  absorbFragments(label, boxes);
  return { width: w, height: h, solid, luma, label, boxes };
}

/** Labelled pixel in the `cell`-sized cell holding (px, py) nearest to it, solid ones first. */
function snapInCell(objs: SheetObjects, px: number, py: number, cell: number): number {
  const x0 = Math.floor(px / cell) * cell;
  const y0 = Math.floor(py / cell) * cell;
  let best = -1;
  let bestScore = Infinity;
  for (let y = y0; y < Math.min(y0 + cell, objs.height); y++) {
    for (let x = x0; x < Math.min(x0 + cell, objs.width); x++) {
      const i = y * objs.width + x;
      if (!objs.label[i]) continue;
      // A shadow pixel only wins when the cell holds no solid pixel at all.
      const score = (x - px) ** 2 + (y - py) ** 2 + (objs.solid[i] ? 0 : 1e9);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best;
}

/**
 * The object under sheet pixel (px, py). A click on a transparent pixel snaps to the nearest
 * solid pixel in the same cell; null when that cell is empty or the point is off the sheet.
 */
export function objectAt(objs: SheetObjects, px: number, py: number, cell = TILE_SIZE): ObjectBox | null {
  const i = pixelUnder(objs, px, py, cell);
  return i < 0 ? null : (objs.boxes.get(objs.label[i]!) ?? null);
}

/** The labelled pixel a click at (px, py) lands on (snapped within its cell), or -1. */
function pixelUnder(objs: SheetObjects, px: number, py: number, cell: number): number {
  if (px < 0 || py < 0 || px >= objs.width || py >= objs.height) return -1;
  const i = py * objs.width + px;
  return objs.label[i] ? i : snapInCell(objs, px, py, cell);
}

/** `objectAt` straight from pixels; label once with `labelObjects` when querying repeatedly. */
export function findObjectAt(buf: PixelBuffer, px: number, py: number, cell = TILE_SIZE): ObjectBox | null {
  return objectAt(labelObjects(buf), px, py, cell);
}

/**
 * The cells covering an object's solid core. A shadow spilling past the core does not widen the
 * pick (as in the repacker, where spill never sizes a block), so a stray shadow tail never drags
 * in a neighbour's cell.
 */
export function objectCells(b: ObjectBox, cell = TILE_SIZE): CellRect {
  const sx = Math.floor(b.cx0 / cell);
  const sy = Math.floor(b.cy0 / cell);
  return { sx, sy, w: Math.floor(b.cx1 / cell) - sx + 1, h: Math.floor(b.cy1 / cell) - sy + 1 };
}

/**
 * Objects bigger than this (cells per side) are usually several pieces packed edge to edge in the
 * sheet (a row of armchairs, sofas or counters whose outlines touch), merged by the pixel flood.
 */
export const MAX_OBJECT_SPAN = 4;
/** A pixel is its sprite's outline when the pixel just inside is this much brighter (or empty). */
const OUTLINE_STEP = 12;
/** Cells join when the art runs on across at least this share of the shared edge, both sides. */
const MIN_CONTINUITY = 0.5;
/** ...and when fewer than this share of the contacts are two outlines touching. */
const MAX_SEAM_SHARE = 0.6;

/**
 * Whether two neighbouring cells hold one piece (true) or two packed pieces that merely touch
 * (false). `b` is right of `a`, or below it when `vertical`. Only pixels of `lab` count.
 */
export function cellsJoined(objs: SheetObjects, lab: number, ax: number, ay: number, vertical: boolean, cell = TILE_SIZE): boolean {
  const { width: w, height: h, solid, luma, label } = objs;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1);
  const own = (i: number) => i >= 0 && label[i] === lab && solid[i] === 1;
  /** Pixel i is an edge of its sprite: the pixel just inside (j) is empty or clearly brighter. */
  const outline = (i: number, j: number) => !own(j) || luma[i]! + OUTLINE_STEP <= luma[j]!;
  let aEdge = 0;
  let bEdge = 0;
  let joints = 0;
  let seams = 0;
  const aHit = new Set<number>();
  const bHit = new Set<number>();
  for (let k = 0; k < cell; k++) {
    // a = the last pixel row/column of cell A on the boundary, b = the first of cell B.
    const [x, y] = vertical ? [ax * cell + k, (ay + 1) * cell - 1] : [(ax + 1) * cell - 1, ay * cell + k];
    const a = at(x, y);
    const bx = vertical ? x : x + 1;
    const by = vertical ? y + 1 : y;
    if (own(a)) aEdge++;
    if (own(at(bx, by))) bEdge++;
    if (!own(a)) continue;
    for (let d = -1; d <= 1; d++) {
      const b = vertical ? at(bx + d, by) : at(bx, by + d);
      if (!own(b)) continue;
      joints++;
      aHit.add(a);
      bHit.add(b);
      const aIn = vertical ? at(x, y - 1) : at(x - 1, y);
      const bIn = vertical ? b + w : b + 1;
      if (outline(a, aIn) && outline(b, bIn < w * h ? bIn : -1)) seams++;
    }
  }
  if (joints === 0) return false;
  const continuity = Math.min(aHit.size / Math.max(1, aEdge), bHit.size / Math.max(1, bEdge));
  return continuity >= MIN_CONTINUITY && seams / joints < MAX_SEAM_SHARE;
}

/**
 * The cells a click at sheet pixel (px, py) picks: the whole object under it, except that an
 * oversized object (several packed pieces whose outlines touch) is cut at those seams and only
 * the piece holding the click is picked. Null on an empty cell.
 */
export function pickCellsAt(objs: SheetObjects, px: number, py: number, cell = TILE_SIZE): CellRect | null {
  const i = pixelUnder(objs, px, py, cell);
  if (i < 0) return null;
  const lab = objs.label[i]!;
  const box = objs.boxes.get(lab);
  if (!box) return null;
  const rect = objectCells(box, cell);
  if (rect.w <= MAX_OBJECT_SPAN && rect.h <= MAX_OBJECT_SPAN) return rect;
  // Flood the object's cells from the clicked one, crossing only joined boundaries.
  const hasArt = (cx: number, cy: number) => {
    for (let y = cy * cell; y < Math.min((cy + 1) * cell, objs.height); y++) {
      for (let x = cx * cell; x < Math.min((cx + 1) * cell, objs.width); x++) {
        const j = y * objs.width + x;
        if (objs.label[j] === lab && objs.solid[j]) return true;
      }
    }
    return false;
  };
  const x0 = i % objs.width;
  const start = { x: Math.floor(x0 / cell), y: Math.floor((i - x0) / objs.width / cell) };
  const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
  const seen = new Set([key(start)]);
  const queue = [start];
  let [minX, minY, maxX, maxY] = [start.x, start.y, start.x, start.y];
  while (queue.length) {
    const c = queue.shift()!;
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
    const steps: [number, number, boolean][] = [
      [c.x + 1, c.y, cellsJoined(objs, lab, c.x, c.y, false, cell)],
      [c.x - 1, c.y, c.x > 0 && cellsJoined(objs, lab, c.x - 1, c.y, false, cell)],
      [c.x, c.y + 1, cellsJoined(objs, lab, c.x, c.y, true, cell)],
      [c.x, c.y - 1, c.y > 0 && cellsJoined(objs, lab, c.x, c.y - 1, true, cell)],
    ];
    for (const [nx, ny, ok] of steps) {
      const n = { x: nx, y: ny };
      if (!ok || seen.has(key(n)) || nx < rect.sx || ny < rect.sy || nx >= rect.sx + rect.w || ny >= rect.sy + rect.h) continue;
      if (!hasArt(nx, ny)) continue;
      seen.add(key(n));
      queue.push(n);
    }
  }
  let piece: CellRect = { sx: minX, sy: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  // Still too big: color variants of one piece side by side (sofas, thrones) share an outline
  // colour, so no seam shows. Their shapes repeat, though: cut at the repeat period.
  if (piece.w > MAX_OBJECT_SPAN) piece = splitByPeriod(objs, lab, piece, start, false, cell);
  if (piece.h > MAX_OBJECT_SPAN) piece = splitByPeriod(objs, lab, piece, start, true, cell);
  return piece;
}

/** Mean brightness difference under which two repeats count as the same colours. */
const SAME_COLOR_LUMA = 10;

/** Whether the object's pixels in `rect` keep their colours when shifted `shift` px along x (or y). */
function sameColorsAt(objs: SheetObjects, lab: number, rect: CellRect, shift: number, vertical: boolean, cell: number): boolean {
  const idx = (x: number, y: number) => {
    if (x >= objs.width || y >= objs.height) return -1;
    const i = y * objs.width + x;
    return objs.label[i] === lab && objs.solid[i] === 1 ? i : -1;
  };
  let sum = 0;
  let n = 0;
  for (let y = 0; y < rect.h * cell - (vertical ? shift : 0); y++) {
    for (let x = 0; x < rect.w * cell - (vertical ? 0 : shift); x++) {
      const px = rect.sx * cell + x;
      const py = rect.sy * cell + y;
      const a = idx(px, py);
      const b = vertical ? idx(px, py + shift) : idx(px + shift, py);
      if (a < 0 || b < 0) continue;
      sum += Math.abs(objs.luma[a]! - objs.luma[b]!);
      n++;
    }
  }
  return n > 0 && sum / n < SAME_COLOR_LUMA;
}

/** Share of differing pixels allowed between two repeats of one shape. */
const PERIOD_TOLERANCE = 0.05;

/**
 * The strip of `rect` holding cell `at`, cut every `p` cells along x (or y when `vertical`) where
 * `p` is the smallest period at which the object's solid mask repeats; `rect` unchanged if none.
 */
function splitByPeriod(
  objs: SheetObjects,
  lab: number,
  rect: CellRect,
  at: { x: number; y: number },
  vertical: boolean,
  cell: number,
): CellRect {
  const len = vertical ? rect.h : rect.w;
  const on = (x: number, y: number) => {
    if (x >= objs.width || y >= objs.height) return false;
    const i = y * objs.width + x;
    return objs.label[i] === lab && objs.solid[i] === 1;
  };
  const px0 = rect.sx * cell;
  const py0 = rect.sy * cell;
  const pw = rect.w * cell;
  const ph = rect.h * cell;
  for (let p = 1; p <= len / 2; p++) {
    if (len % p) continue;
    const step = p * cell;
    let diff = 0;
    let total = 0;
    for (let y = 0; y < (vertical ? ph - step : ph); y++) {
      for (let x = 0; x < (vertical ? pw : pw - step); x++) {
        const a = on(px0 + x, py0 + y);
        const b = vertical ? on(px0 + x, py0 + y + step) : on(px0 + x + step, py0 + y);
        if (a || b) total++;
        if (a !== b) diff++;
      }
    }
    if (total === 0 || diff / total > PERIOD_TOLERANCE) continue;
    // Same shape in the same colours is one long tileable piece (a counter, a rug edge), not a
    // row of colour variants: keep it whole.
    if (sameColorsAt(objs, lab, rect, step, vertical, cell)) return rect;
    if (vertical) {
      const k = Math.floor((at.y - rect.sy) / p);
      return { ...rect, sy: rect.sy + k * p, h: p };
    }
    const k = Math.floor((at.x - rect.sx) / p);
    return { ...rect, sx: rect.sx + k * p, w: p };
  }
  return rect;
}
