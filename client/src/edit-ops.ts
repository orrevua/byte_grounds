import type { Rotation } from '@byte_grounds/shared/map';
import type { BlockMode, DecorSelection } from './editor-model.ts';
import type { DecorTransform } from './decor-transform.ts';

/**
 * Live building edits (`public.map_edits.op`, `supabase/live-edits.sql`): small commands every
 * client applies in id order with the editor's own functions (`live-model.ts`).
 */
export type PlaceOp = {
  kind: 'place';
  x: number;
  y: number;
  sheet: string;
  sx: number;
  sy: number;
  w: number;
  h: number;
  mode: BlockMode;
  rot: Rotation;
  flipX: boolean;
};

export type EditOp =
  | PlaceOp
  /** Undo of placement `target`; `place` is an exact copy of that edit's op (checked by RLS). */
  | { kind: 'remove'; target: number; place: PlaceOp }
  | { kind: 'erase'; x: number; y: number }
  | { kind: 'tile'; x: number; y: number; blocked: boolean }
  /** The stored map was replaced (editor save / delete): clients reload it. */
  | { kind: 'reset' };

export interface MapEdit {
  id: number;
  author: string;
  op: EditOp;
}

/** Same limit as the SQL check (`length(op::text) <= 2048`). */
const MAX_OP_LENGTH = 2048;
const SHEET_RE = /^[a-z0-9_-]{1,48}$/;
const MODES: readonly unknown[] = ['none', 'base', 'all'];
const ROTATIONS: readonly unknown[] = [0, 90, 180, 270];

type Obj = Record<string, unknown>;

function hasKeys(o: Obj, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && own.every((k) => keys.includes(k));
}

function int(v: unknown, lo: number, hi: number): v is number {
  return Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
}

const coord = (o: Obj) => int(o.x, 0, 79) && int(o.y, 0, 79);

function parsePlace(o: Obj): PlaceOp | null {
  const ok =
    hasKeys(o, ['kind', 'x', 'y', 'sheet', 'sx', 'sy', 'w', 'h', 'mode', 'rot', 'flipX']) &&
    coord(o) &&
    typeof o.sheet === 'string' &&
    SHEET_RE.test(o.sheet) &&
    int(o.sx, 0, 63) &&
    int(o.sy, 0, 63) &&
    int(o.w, 1, 8) &&
    int(o.h, 1, 8) &&
    MODES.includes(o.mode) &&
    ROTATIONS.includes(o.rot) &&
    typeof o.flipX === 'boolean';
  return ok ? (o as PlaceOp) : null;
}

/** An edit op as stored, or null if it breaks a rule of SQL `valid_edit_op` (which it mirrors). */
export function parseEditOp(v: unknown): EditOp | null {
  if (!v || typeof v !== 'object' || Array.isArray(v) || JSON.stringify(v).length > MAX_OP_LENGTH) return null;
  const o = v as Obj;
  switch (o.kind) {
    case 'place':
      return parsePlace(o);
    case 'remove': {
      const place = o.place && typeof o.place === 'object' && !Array.isArray(o.place) ? (o.place as Obj) : null;
      return hasKeys(o, ['kind', 'target', 'place']) &&
        int(o.target, 1, Number.MAX_SAFE_INTEGER) &&
        place?.kind === 'place' &&
        parsePlace(place)
        ? (o as EditOp)
        : null;
    }
    case 'erase':
      return hasKeys(o, ['kind', 'x', 'y']) && coord(o) ? (o as EditOp) : null;
    case 'tile':
      return hasKeys(o, ['kind', 'x', 'y', 'blocked']) && coord(o) && typeof o.blocked === 'boolean'
        ? (o as EditOp)
        : null;
    case 'reset':
      return hasKeys(o, ['kind']) ? { kind: 'reset' } : null;
    default:
      return null;
  }
}

/** A `map_edits` row (`id, author, op`) as a MapEdit; null if any field is unusable. */
export function toMapEdit(row: unknown): MapEdit | null {
  const { id, author, op } = (row ?? {}) as { id?: unknown; author?: unknown; op?: unknown };
  const n = Number(id);
  const parsed = parseEditOp(op);
  return Number.isSafeInteger(n) && n > 0 && typeof author === 'string' && parsed ? { id: n, author, op: parsed } : null;
}

/** The op that stamps `sel` turned by `t` with its top-left on tile (x, y). */
export function placeOp(x: number, y: number, sel: DecorSelection, mode: BlockMode, t: DecorTransform): PlaceOp {
  return { kind: 'place', x, y, sheet: sel.sheet, sx: sel.sx, sy: sel.sy, w: sel.w, h: sel.h, mode, rot: t.rot, flipX: t.flipX };
}
