/**
 * SheetSpec v1: a text format for pixel-art sheets on the 32px cell grid, shared by Sheet Studio
 * (humans), its `window.sheetStudio` API and `tools/sheet_spec.ts` (agents). Pure: no DOM.
 * See docs/specs/sheet-studio.md for the format.
 */

export const CELL = 32;
export const MAX_CELLS = 32;

/** RGBA pixels, row-major (the shape of canvas ImageData). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type Op =
  | { op: 'rect'; x: number; y: number; w: number; h: number; color?: string; outline?: string }
  | { op: 'ellipse'; x: number; y: number; w: number; h: number; color?: string; outline?: string }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { op: 'pixels'; x: number; y: number; rows: string[] }
  | { op: 'fill'; x: number; y: number; color: string }
  | { op: 'shade'; x: number; y: number; w: number; h: number; amount: number }
  | { op: 'outline'; x: number; y: number; w: number; h: number; color: string }
  | { op: 'copy'; x: number; y: number; w: number; h: number; toX: number; toY: number; flipX?: boolean; flipY?: boolean }
  | { op: 'clear'; x: number; y: number; w: number; h: number };

export interface Piece {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetSpec {
  version: 1;
  name: string;
  cols: number;
  rows: number;
  palette: Record<string, string>;
  ops: Op[];
  pieces?: Piece[];
}

type RGBA = [number, number, number, number];

/** "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa" → RGBA, else null. */
export function parseColor(s: string): RGBA | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  return [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGBA;
}

export function toHex([r, g, b, a]: RGBA): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? '' : hex(a)}`;
}

/** A sheet name usable as an id: lowercase letters, digits and underscores. */
export function sheetSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'sheet'
  );
}

const NUM_FIELDS: Record<Op['op'], string[]> = {
  rect: ['x', 'y', 'w', 'h'],
  ellipse: ['x', 'y', 'w', 'h'],
  line: ['x1', 'y1', 'x2', 'y2'],
  pixels: ['x', 'y'],
  fill: ['x', 'y'],
  shade: ['x', 'y', 'w', 'h', 'amount'],
  outline: ['x', 'y', 'w', 'h'],
  copy: ['x', 'y', 'w', 'h', 'toX', 'toY'],
  clear: ['x', 'y', 'w', 'h'],
};

/** Validate one op; returns readable problems (empty = fine). */
function opErrors(o: unknown, i: number, palette: Record<string, string>): string[] {
  const where = `ops[${i}]`;
  if (!o || typeof o !== 'object') return [`${where}: not an object`];
  const op = o as Record<string, unknown>;
  const kind = op.op as Op['op'];
  if (!(kind in NUM_FIELDS)) return [`${where}: unknown op "${String(op.op)}" (use ${Object.keys(NUM_FIELDS).join(', ')})`];
  const errs: string[] = [];
  for (const f of NUM_FIELDS[kind]) if (typeof op[f] !== 'number' || !Number.isFinite(op[f])) errs.push(`${where} (${kind}): "${f}" must be a number`);
  const color = (f: string, required: boolean) => {
    const v = op[f];
    if (v === undefined) {
      if (required) errs.push(`${where} (${kind}): "${f}" is required`);
      return;
    }
    if (typeof v !== 'string' || (!(v in palette) && !parseColor(v))) errs.push(`${where} (${kind}): "${f}" must be a palette key or #hex color`);
  };
  if (kind === 'rect' || kind === 'ellipse') {
    color('color', false);
    color('outline', false);
    if (op.color === undefined && op.outline === undefined) errs.push(`${where} (${kind}): give "color" and/or "outline"`);
  }
  if (kind === 'line' || kind === 'fill' || kind === 'outline') color('color', true);
  if (kind === 'pixels') {
    if (!Array.isArray(op.rows) || op.rows.some((r) => typeof r !== 'string')) errs.push(`${where} (pixels): "rows" must be an array of strings`);
    else
      for (const [ri, row] of (op.rows as string[]).entries())
        for (const ch of row) if (ch !== '.' && ch !== ' ' && !(ch in palette)) errs.push(`${where} (pixels): row ${ri} uses "${ch}", not in the palette`);
  }
  return errs;
}

/** Validate untrusted input as a SheetSpec. `errors` empty ⇒ `spec` is usable. */
export function parseSpec(x: unknown): { spec: SheetSpec | null; errors: string[] } {
  if (!x || typeof x !== 'object') return { spec: null, errors: ['spec must be a JSON object'] };
  const o = x as Record<string, unknown>;
  const errors: string[] = [];
  const cols = o.cols;
  const rows = o.rows;
  if (!Number.isInteger(cols) || (cols as number) < 1 || (cols as number) > MAX_CELLS) errors.push(`"cols" must be an integer 1..${MAX_CELLS}`);
  if (!Number.isInteger(rows) || (rows as number) < 1 || (rows as number) > MAX_CELLS) errors.push(`"rows" must be an integer 1..${MAX_CELLS}`);
  const palette: Record<string, string> = {};
  if (o.palette !== undefined) {
    if (!o.palette || typeof o.palette !== 'object') errors.push('"palette" must be an object of 1-char keys to colors');
    else
      for (const [k, v] of Object.entries(o.palette as Record<string, unknown>)) {
        if ([...k].length !== 1 || k === '.' || k === ' ') errors.push(`palette key "${k}" must be one character (not "." or space)`);
        else if (typeof v !== 'string' || !parseColor(v)) errors.push(`palette "${k}": "${String(v)}" is not a #hex color`);
        else palette[k] = v;
      }
  }
  const ops = Array.isArray(o.ops) ? o.ops : o.ops === undefined ? [] : null;
  if (!ops) errors.push('"ops" must be an array');
  else ops.forEach((op, i) => errors.push(...opErrors(op, i, palette)));
  if (errors.length) return { spec: null, errors };
  const pieces = Array.isArray(o.pieces)
    ? (o.pieces as Piece[]).filter((p) => p && typeof p.name === 'string' && [p.x, p.y, p.w, p.h].every(Number.isInteger))
    : undefined;
  return {
    spec: {
      version: 1,
      name: typeof o.name === 'string' && o.name.trim() ? sheetSlug(o.name) : 'sheet',
      cols: cols as number,
      rows: rows as number,
      palette,
      ops: (ops ?? []) as Op[],
      ...(pieces?.length ? { pieces } : {}),
    },
    errors: [],
  };
}

export function blankPixels(cols: number, rows: number): Pixels {
  const width = cols * CELL;
  const height = rows * CELL;
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Render a parsed spec into a fresh sheet. */
export function renderSpec(spec: SheetSpec): Pixels {
  const px = blankPixels(spec.cols, spec.rows);
  applyOps(px, spec.ops, spec.palette);
  return px;
}

/** Apply ops onto existing pixels (in place). Off-sheet pixels are ignored. */
export function applyOps(px: Pixels, ops: readonly Op[], palette: Record<string, string> = {}): void {
  const col = (c: string | undefined): RGBA | null => (c === undefined ? null : parseColor(palette[c] ?? c));
  for (const op of ops) {
    switch (op.op) {
      case 'rect': {
        const fill = col(op.color);
        const line = col(op.outline);
        const [x0, y0, x1, y1] = [Math.round(op.x), Math.round(op.y), Math.round(op.x + op.w) - 1, Math.round(op.y + op.h) - 1];
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const edge = x === x0 || x === x1 || y === y0 || y === y1;
            const c = edge && line ? line : fill;
            if (c) put(px, x, y, c);
          }
        break;
      }
      case 'ellipse': {
        const fill = col(op.color);
        const line = col(op.outline);
        const inside = (x: number, y: number) => {
          const rx = op.w / 2;
          const ry = op.h / 2;
          const dx = (x + 0.5 - (op.x + rx)) / rx;
          const dy = (y + 0.5 - (op.y + ry)) / ry;
          return dx * dx + dy * dy <= 1;
        };
        for (let y = Math.floor(op.y); y < Math.ceil(op.y + op.h); y++)
          for (let x = Math.floor(op.x); x < Math.ceil(op.x + op.w); x++) {
            if (!inside(x, y)) continue;
            const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
            const c = edge && line ? line : fill;
            if (c) put(px, x, y, c);
          }
        break;
      }
      case 'line': {
        const c = col(op.color)!;
        for (const [x, y] of linePoints(op.x1, op.y1, op.x2, op.y2)) put(px, x, y, c);
        break;
      }
      case 'pixels':
        op.rows.forEach((row, dy) =>
          [...row].forEach((ch, dx) => {
            const c = ch === '.' || ch === ' ' ? null : col(ch);
            if (c) put(px, Math.round(op.x) + dx, Math.round(op.y) + dy, c);
          }),
        );
        break;
      case 'fill':
        floodFill(px, Math.round(op.x), Math.round(op.y), col(op.color)!);
        break;
      case 'shade':
        eachIn(px, op, (i) => {
          if (!px.data[i + 3]) return;
          for (let k = 0; k < 3; k++) {
            const v = px.data[i + k]!;
            px.data[i + k] = op.amount < 0 ? v * (1 + op.amount) : v + (255 - v) * op.amount;
          }
        });
        break;
      case 'outline':
        outlineRect(px, op, col(op.color)!);
        break;
      case 'copy':
        copyRect(px, op);
        break;
      case 'clear':
        eachIn(px, op, (i) => px.data.fill(0, i, i + 4));
        break;
    }
  }
}

/** Write a color, alpha-blending translucent colors over what is there. */
export function put(px: Pixels, x: number, y: number, [r, g, b, a]: RGBA): void {
  if (x < 0 || y < 0 || x >= px.width || y >= px.height) return;
  const i = (y * px.width + x) * 4;
  const d = px.data;
  if (a >= 255 || d[i + 3] === 0) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
    return;
  }
  const sa = a / 255;
  const da = d[i + 3]! / 255;
  const oa = sa + da * (1 - sa);
  for (const [k, v] of [r, g, b].entries()) d[i + k] = (v * sa + d[i + k]! * da * (1 - sa)) / oa;
  d[i + 3] = oa * 255;
}

/** Integer points of a straight line (Bresenham), both ends included. */
export function linePoints(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  let [x, y] = [Math.round(x1), Math.round(y1)];
  const [tx, ty] = [Math.round(x2), Math.round(y2)];
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  const out: [number, number][] = [];
  for (;;) {
    out.push([x, y]);
    if (x === tx && y === ty) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** 4-way flood fill of the region with the same RGBA as (x, y). */
export function floodFill(px: Pixels, x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= px.width || y >= px.height) return;
  const d = px.data;
  const at = (i: number) => (d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!;
  const start = (y * px.width + x) * 4;
  const target = at(start);
  if (target === ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3])) return;
  const stack = [x, y];
  while (stack.length) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= px.width || cy >= px.height) continue;
    const i = (cy * px.width + cx) * 4;
    if (at(i) !== target) continue;
    d.set(c, i);
    stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
  }
}

function eachIn(px: Pixels, r: { x: number; y: number; w: number; h: number }, f: (i: number, x: number, y: number) => void): void {
  for (let y = Math.max(0, Math.round(r.y)); y < Math.min(px.height, Math.round(r.y + r.h)); y++)
    for (let x = Math.max(0, Math.round(r.x)); x < Math.min(px.width, Math.round(r.x + r.w)); x++) f((y * px.width + x) * 4, x, y);
}

/** A 1px ring of `c` on the transparent pixels (8-way) touching art inside the rect. */
function outlineRect(px: Pixels, r: { x: number; y: number; w: number; h: number }, c: RGBA): void {
  const solid = (x: number, y: number) =>
    x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h && x >= 0 && y >= 0 && x < px.width && y < px.height && px.data[(y * px.width + x) * 4 + 3]! > 0;
  const ring: [number, number][] = [];
  for (let y = Math.round(r.y) - 1; y <= Math.round(r.y + r.h); y++)
    for (let x = Math.round(r.x) - 1; x <= Math.round(r.x + r.w); x++) {
      if (solid(x, y)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) near = solid(x + dx, y + dy);
      if (near) ring.push([x, y]);
    }
  for (const [x, y] of ring) put(px, x, y, c);
}

function copyRect(px: Pixels, op: Extract<Op, { op: 'copy' }>): void {
  const src = new Uint8ClampedArray(px.data);
  const [w, h] = [Math.round(op.w), Math.round(op.h)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.round(op.x) + (op.flipX ? w - 1 - x : x);
      const sy = Math.round(op.y) + (op.flipY ? h - 1 - y : y);
      const tx = Math.round(op.toX) + x;
      const ty = Math.round(op.toY) + y;
      if (sx < 0 || sy < 0 || sx >= px.width || sy >= px.height || tx < 0 || ty < 0 || tx >= px.width || ty >= px.height) continue;
      const si = (sy * px.width + sx) * 4;
      px.data.set(src.subarray(si, si + 4), (ty * px.width + tx) * 4);
    }
}

const KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@$%^&*()-_=+[]{};:,<>/?|~`\'"\\';

/**
 * Any image back to a SheetSpec (so an agent can read a sheet as text): an automatic palette of
 * its colors and one `pixels` op per non-empty cell, so pieces can be edited one by one.
 */
export function bufferToSpec(px: Pixels, name = 'sheet'): SheetSpec {
  const cols = Math.ceil(px.width / CELL);
  const rows = Math.ceil(px.height / CELL);
  const keyOf = new Map<string, string>();
  const palette: Record<string, string> = {};
  const ops: Op[] = [];
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const lines: string[] = [];
      let any = false;
      for (let y = cy * CELL; y < Math.min(px.height, (cy + 1) * CELL); y++) {
        let line = '';
        for (let x = cx * CELL; x < Math.min(px.width, (cx + 1) * CELL); x++) {
          const i = (y * px.width + x) * 4;
          if (!px.data[i + 3]) {
            line += '.';
            continue;
          }
          any = true;
          const hex = toHex([px.data[i]!, px.data[i + 1]!, px.data[i + 2]!, px.data[i + 3]!]);
          let k = keyOf.get(hex);
          if (!k) {
            if (keyOf.size >= KEYS.length) throw new Error(`too many colors for a spec (max ${KEYS.length}); reduce the palette`);
            k = KEYS[keyOf.size]!;
            keyOf.set(hex, k);
            palette[k] = hex;
          }
          line += k;
        }
        lines.push(line.replace(/\.+$/, ''));
      }
      if (!any) continue;
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      ops.push({ op: 'pixels', x: cx * CELL, y: cy * CELL, rows: lines });
    }
  return { version: 1, name: sheetSlug(name), cols, rows, palette, ops };
}
