import { tileAt, type DecorCell, type OfficeMap } from '@byte_grounds/shared/map';
import { brushCells, cellBlocks, eraseDecor, setBlocked, stampDecor } from './editor-model.ts';
import type { EditOp, MapEdit, PlaceOp } from './edit-ops.ts';

/** Applying live edits (D3): pure, so every client turns the same log into the same map. */

function inBounds(m: OfficeMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < m.width && y < m.height;
}

/** The cells a place op stamps (no bounds check), carrying its layer / base row / transform. */
export function placeCells(op: PlaceOp): DecorCell[] {
  return brushCells(op.x, op.y, op, { rot: op.rot, flipX: op.flipX }, op.mode);
}

function applyPlace(m: OfficeMap, op: PlaceOp, knownSheet: (s: string) => boolean): boolean {
  if (!knownSheet(op.sheet)) return false;
  const cells = placeCells(op).filter((c) => inBounds(m, c.x, c.y));
  if (cells.length === 0) return false;
  if (cells.some((c) => cellBlocks(c, op.mode) && tileAt(m, c.x, c.y) === 1)) return false;
  stampDecor(m, op.x, op.y, op, op.mode, { rot: op.rot, flipX: op.flipX });
  return true;
}

/**
 * Undo a placement: drop the topmost matching decor cell for each of its cells, then unblock the
 * tiles it blocked where a cell was removed, unless another object still stands on that tile.
 * A placement that never took effect removes nothing, so it can't unblock a wall.
 */
function applyRemove(m: OfficeMap, place: PlaceOp): boolean {
  const decor = m.decor ?? [];
  const cleared: DecorCell[] = [];
  for (const cell of placeCells(place)) {
    for (let i = decor.length - 1; i >= 0; i--) {
      const d = decor[i]!;
      if (d.x === cell.x && d.y === cell.y && d.sheet === cell.sheet && d.sx === cell.sx && d.sy === cell.sy) {
        decor.splice(i, 1);
        cleared.push(cell);
        break;
      }
    }
  }
  for (const cell of cleared) {
    if (!cellBlocks(cell, place.mode)) continue;
    const covered = decor.some((d) => d.x === cell.x && d.y === cell.y && d.layer === 'object' && (d.baseDy ?? 0) === 0);
    if (!covered) setBlocked(m, cell.x, cell.y, false);
  }
  return cleared.length > 0;
}

/** Apply one op to `m` in place; true if it changed the map. Out-of-bounds and unknown sheets are no-ops. */
export function applyEdit(m: OfficeMap, op: EditOp, knownSheet: (s: string) => boolean): boolean {
  switch (op.kind) {
    case 'place':
      return applyPlace(m, op, knownSheet);
    case 'remove':
      return applyRemove(m, op.place);
    case 'erase':
      return inBounds(m, op.x, op.y) && eraseDecor(m, op.x, op.y);
    case 'tile':
      if (!inBounds(m, op.x, op.y) || (tileAt(m, op.x, op.y) === 1) === op.blocked) return false;
      setBlocked(m, op.x, op.y, op.blocked);
      return true;
    case 'reset':
      return false;
  }
}

/** Make `target` hold `source`'s fields (same object, so holders of `target` see the new map). */
export function replaceMapContents(target: OfficeMap, source: OfficeMap): void {
  for (const k of Object.keys(target)) {
    if (!(k in source)) delete (target as unknown as Record<string, unknown>)[k];
  }
  Object.assign(target, source);
}

/**
 * The room's map = base (as stored, folded up to `baseSeq`) + the log after it, applied in id
 * order. An edit arriving out of order (commit reordering) rebuilds from the base.
 */
export class EditLog {
  readonly map: OfficeMap;
  private readonly edits: MapEdit[] = [];
  /** Places that took effect and haven't been removed. */
  private readonly live = new Set<number>();

  constructor(
    private readonly base: OfficeMap,
    private readonly baseSeq: number,
    private readonly knownSheet: (s: string) => boolean,
  ) {
    this.map = structuredClone(base);
  }

  get lastId(): number {
    return this.edits.at(-1)?.id ?? this.baseSeq;
  }

  /** Applied edits not yet folded into the stored map. */
  get unbaked(): number {
    return this.edits.length;
  }

  /** Whether edit `id` is already part of the map (baked into the base, or applied). */
  has(id: number): boolean {
    return id <= this.baseSeq || this.edits.some((x) => x.id === id);
  }

  add(e: MapEdit): 'applied' | 'rebuilt' | 'duplicate' {
    if (this.has(e.id)) return 'duplicate';
    if (e.id > this.lastId) {
      this.edits.push(e);
      this.apply(e);
      return 'applied';
    }
    this.edits.push(e);
    this.edits.sort((a, b) => a.id - b.id);
    replaceMapContents(this.map, structuredClone(this.base));
    this.live.clear();
    for (const x of this.edits) this.apply(x);
    return 'rebuilt';
  }

  /** `uid`'s latest placement still standing (what "Undo my last" removes). */
  lastOwnPlacement(uid: string): MapEdit | null {
    return this.latestLive((e) => e.author === uid);
  }

  /** The latest placement still standing that covers tile (x, y). */
  placementAt(x: number, y: number): MapEdit | null {
    return this.latestLive((e) => placeCells(e.op as PlaceOp).some((c) => c.x === x && c.y === y));
  }

  private latestLive(match: (e: MapEdit) => boolean): MapEdit | null {
    for (let i = this.edits.length - 1; i >= 0; i--) {
      const e = this.edits[i]!;
      if (this.live.has(e.id) && match(e)) return e;
    }
    return null;
  }

  private apply(e: MapEdit): void {
    const changed = applyEdit(this.map, e.op, this.knownSheet);
    if (e.op.kind === 'place' && changed) this.live.add(e.id);
    if (e.op.kind === 'remove') this.live.delete(e.op.target);
  }
}

export type MergeResult = { merged: number; lastId: number; conflict: boolean };

/**
 * Fold live edits into an editor's map and into every undo snapshot (JSON strings, rewritten in
 * place), in id order, so undo never reverts someone else's edit. Stops at a `reset` (another
 * editor replaced the map): `conflict`, and nothing after it is applied.
 */
export function mergeLiveEdits(
  map: OfficeMap,
  snapshots: string[],
  edits: MapEdit[],
  knownSheet: (s: string) => boolean,
): MergeResult {
  const sorted = [...edits].sort((a, b) => a.id - b.id);
  const reset = sorted.findIndex((e) => e.op.kind === 'reset');
  const ops = reset < 0 ? sorted : sorted.slice(0, reset);
  for (const e of ops) applyEdit(map, e.op, knownSheet);
  if (ops.length > 0) {
    snapshots.forEach((json, i) => {
      const snap = JSON.parse(json) as OfficeMap;
      for (const e of ops) applyEdit(snap, e.op, knownSheet);
      snapshots[i] = JSON.stringify(snap);
    });
  }
  return { merged: ops.length, lastId: ops.at(-1)?.id ?? 0, conflict: reset >= 0 };
}
