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
  for (let i = 0; i < w * h; i++) {
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
  return { width: w, height: h, solid, label, boxes };
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
  if (px < 0 || py < 0 || px >= objs.width || py >= objs.height) return null;
  let i = py * objs.width + px;
  if (!objs.label[i]) i = snapInCell(objs, px, py, cell);
  return i < 0 ? null : (objs.boxes.get(objs.label[i]!) ?? null);
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
