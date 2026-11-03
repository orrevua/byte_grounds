/**
 * Whiteboards: what is drawn on them and the edits that change it (spec: docs/specs/whiteboard.md).
 * Pure: the same ops turn into the same board on every client, in any order an `add` arrives twice.
 */

/** Board space; views scale it to fit. */
export const BOARD_W = 1600;
export const BOARD_H = 1000;
export const MAX_TABS = 12;
export const MAX_ITEMS = 3000;
export const MAX_POINTS = 2000;
export const MAX_TEXT = 300;

export const ITEM_KINDS = ['pen', 'marker', 'line', 'arrow', 'rect', 'ellipse', 'text'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface Item {
  id: string;
  /** Who drew it (display name; for "undo my last"). */
  by: string;
  kind: ItemKind;
  color: string;
  width: number;
  /** pen / marker: x0, y0, x1, y1, ... */
  points?: number[];
  /** line / arrow / rect / ellipse: the two corners (or ends). text: x1, y1 is the top-left. */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  /** rect / ellipse: filled with a light tint of `color`. */
  fill?: boolean;
  text?: string;
  /** text: font size (board px). */
  size?: number;
}

export interface Tab {
  id: string;
  name: string;
  items: Item[];
}

export interface BoardState {
  tabs: Tab[];
}

export type BoardOp =
  | { kind: 'add'; tab: string; item: Item }
  | { kind: 'remove'; tab: string; id: string }
  | { kind: 'clear'; tab: string }
  | { kind: 'tab-add'; id: string; name: string }
  | { kind: 'tab-rename'; tab: string; name: string }
  | { kind: 'tab-remove'; tab: string };

/** A new board: one empty page. */
export function emptyBoard(): BoardState {
  return { tabs: [{ id: 'main', name: 'Page 1', items: [] }] };
}

// ---------- validation (everything from the network or the store goes through here) ----------

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;
const name = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 30) : fallback;

/** Coerce an item; null when unusable. Coordinates are clamped to the board, a bit outside allowed. */
export function normalizeItem(x: unknown): Item | null {
  const o = (x ?? {}) as Record<string, unknown>;
  if (!isId(o.id) || !ITEM_KINDS.includes(o.kind as ItemKind)) return null;
  const color = typeof o.color === 'string' && COLOR_RE.test(o.color) ? o.color.toLowerCase() : null;
  const width = num(o.width, 1, 60);
  if (!color || width === null) return null;
  const kind = o.kind as ItemKind;
  const by = typeof o.by === 'string' ? o.by.slice(0, 40) : '';
  const X = (v: unknown) => num(v, -200, BOARD_W + 200);
  const Y = (v: unknown) => num(v, -200, BOARD_H + 200);
  const item: Item = { id: o.id, by, kind, color, width };
  if (kind === 'pen' || kind === 'marker') {
    if (!Array.isArray(o.points) || o.points.length < 2 || o.points.length % 2 || o.points.length > MAX_POINTS * 2) return null;
    const pts = o.points.map((v, i) => (i % 2 ? Y(v) : X(v)));
    if (pts.some((v) => v === null)) return null;
    item.points = pts as number[];
    return item;
  }
  const [x1, y1, x2, y2] = [X(o.x1), Y(o.y1), X(o.x2), Y(o.y2)];
  if (x1 === null || y1 === null) return null;
  item.x1 = x1;
  item.y1 = y1;
  if (kind === 'text') {
    const text = typeof o.text === 'string' ? o.text.replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').slice(0, MAX_TEXT) : '';
    if (!text.trim()) return null;
    item.text = text;
    item.size = num(o.size, 10, 120) ?? 28;
    return item;
  }
  if (x2 === null || y2 === null) return null;
  item.x2 = x2;
  item.y2 = y2;
  if ((kind === 'rect' || kind === 'ellipse') && o.fill === true) item.fill = true;
  return item;
}

/** Coerce an op; null when unusable. */
export function normalizeBoardOp(x: unknown): BoardOp | null {
  const o = (x ?? {}) as Record<string, unknown>;
  switch (o.kind) {
    case 'add': {
      const item = normalizeItem(o.item);
      return isId(o.tab) && item ? { kind: 'add', tab: o.tab, item } : null;
    }
    case 'remove':
      return isId(o.tab) && isId(o.id) ? { kind: 'remove', tab: o.tab, id: o.id } : null;
    case 'clear':
      return isId(o.tab) ? { kind: 'clear', tab: o.tab } : null;
    case 'tab-add':
      return isId(o.id) ? { kind: 'tab-add', id: o.id, name: name(o.name, 'Page') } : null;
    case 'tab-rename':
      return isId(o.tab) ? { kind: 'tab-rename', tab: o.tab, name: name(o.name, 'Page') } : null;
    case 'tab-remove':
      return isId(o.tab) ? { kind: 'tab-remove', tab: o.tab } : null;
    default:
      return null;
  }
}

/** Coerce a stored board; anything malformed is dropped (an unusable board → a new one). */
export function normalizeBoard(x: unknown): BoardState {
  const tabs = Array.isArray((x as BoardState | null)?.tabs) ? (x as BoardState).tabs : [];
  const out: Tab[] = [];
  for (const t of tabs.slice(0, MAX_TABS)) {
    if (!isId(t?.id) || out.some((o) => o.id === t.id)) continue;
    const items: Item[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(t.items) ? t.items.slice(0, MAX_ITEMS) : []) {
      const item = normalizeItem(raw);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
    out.push({ id: t.id, name: name(t.name, 'Page'), items });
  }
  return out.length ? { tabs: out } : emptyBoard();
}

// ---------- applying ----------

/** Apply an op in place; true if the board changed. Idempotent: a repeated op changes nothing. */
export function applyBoardOp(b: BoardState, op: BoardOp): boolean {
  const tab = 'tab' in op ? b.tabs.find((t) => t.id === op.tab) : undefined;
  switch (op.kind) {
    case 'add':
      if (!tab || tab.items.length >= MAX_ITEMS || tab.items.some((i) => i.id === op.item.id)) return false;
      tab.items.push(op.item);
      return true;
    case 'remove': {
      const i = tab ? tab.items.findIndex((it) => it.id === op.id) : -1;
      if (!tab || i < 0) return false;
      tab.items.splice(i, 1);
      return true;
    }
    case 'clear':
      if (!tab || tab.items.length === 0) return false;
      tab.items = [];
      return true;
    case 'tab-add':
      if (b.tabs.length >= MAX_TABS || b.tabs.some((t) => t.id === op.id)) return false;
      b.tabs.push({ id: op.id, name: op.name, items: [] });
      return true;
    case 'tab-rename':
      if (!tab || tab.name === op.name) return false;
      tab.name = op.name;
      return true;
    case 'tab-remove':
      if (!tab || b.tabs.length <= 1) return false; // a board always keeps one page
      b.tabs = b.tabs.filter((t) => t !== tab);
      return true;
  }
}

/** A short random id for items and tabs. */
export function newBoardId(): string {
  return Math.random().toString(36).slice(2, 12);
}

// ---------- geometry (shared by drawing and the eraser) ----------

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether the point (px, py) is within `r` of the item's drawn shape (the eraser's hit test). */
export function itemHit(it: Item, px: number, py: number, r: number): boolean {
  const reach = r + it.width / 2;
  if (it.points) {
    const p = it.points;
    if (p.length === 2) return Math.hypot(px - p[0]!, py - p[1]!) <= reach;
    for (let i = 2; i < p.length; i += 2) {
      if (distToSegment(px, py, p[i - 2]!, p[i - 1]!, p[i]!, p[i + 1]!) <= reach) return true;
    }
    return false;
  }
  const { x1 = 0, y1 = 0, x2 = x1, y2 = y1 } = it;
  if (it.kind === 'text') {
    const size = it.size ?? 28;
    const w = (it.text?.length ?? 0) * size * 0.55;
    return px >= x1 - r && px <= x1 + w + r && py >= y1 - r && py <= y1 + size * 1.2 + r;
  }
  if (it.kind === 'line' || it.kind === 'arrow') return distToSegment(px, py, x1, y1, x2, y2) <= reach;
  const [l, rgt, t, btm] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
  if (it.kind === 'rect') {
    const inside = px >= l - reach && px <= rgt + reach && py >= t - reach && py <= btm + reach;
    if (!inside) return false;
    if (it.fill) return true;
    return px <= l + reach || px >= rgt - reach || py <= t + reach || py >= btm - reach;
  }
  // ellipse
  const cx = (l + rgt) / 2;
  const cy = (t + btm) / 2;
  const rx = Math.max(1, (rgt - l) / 2);
  const ry = Math.max(1, (btm - t) / 2);
  const d = Math.hypot((px - cx) / rx, (py - cy) / ry);
  return it.fill ? d <= 1 + reach / Math.min(rx, ry) : Math.abs(d - 1) * Math.min(rx, ry) <= reach;
}

/** Drop points closer than `min` to the previous kept one (keeps freehand strokes small on the wire). */
export function thinPoints(points: number[], min = 2): number[] {
  if (points.length <= 4) return points.map(Math.round);
  const out = [Math.round(points[0]!), Math.round(points[1]!)];
  for (let i = 2; i < points.length - 2; i += 2) {
    if (Math.hypot(points[i]! - out[out.length - 2]!, points[i + 1]! - out[out.length - 1]!) >= min) {
      out.push(Math.round(points[i]!), Math.round(points[i + 1]!));
    }
  }
  out.push(Math.round(points[points.length - 2]!), Math.round(points[points.length - 1]!));
  return out.slice(0, MAX_POINTS * 2);
}
