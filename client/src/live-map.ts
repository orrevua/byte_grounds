import type { RealtimeChannel } from '@supabase/supabase-js';
import { createBlankMap, type DecorCell, type OfficeMap } from '@byte_grounds/shared/map';
import { getSupabase } from './supabase.ts';
import { SupabaseStore } from './store.ts';
import { decorImage, loadDecorSheets } from './decor.ts';
import { toMapEdit, type EditOp, type MapEdit, type PlaceOp } from './edit-ops.ts';
import { EditLog, bakedObjectAt, placeCells, replaceMapContents } from './live-model.ts';
import { cellBlocks } from './editor-model.ts';
import { decorLayer, tileAt } from '@byte_grounds/shared/map';

/** Auto-bake: quiet time after the last edit (+ up to JITTER_MS), and the unbaked edits needed. */
const BAKE_IDLE_MS = 5000;
const BAKE_JITTER_MS = 3000;
const BAKE_MIN_EDITS = 50;
/** Postgres unique violation: this placement was already undone (a double click). */
const UNIQUE_VIOLATION = '23505';
const NO_PERMISSION = '42501';

const knownSheet = (s: string) => decorImage(s) !== null;

/**
 * A piece picked up with the Move tool: a live placement (moved by removing it), or (admin only)
 * an object baked into the stored map (moved by erasing its cells). `op` stamps it where it is now.
 */
export type MoveSource =
  | { kind: 'live'; edit: MapEdit; op: PlaceOp }
  | { kind: 'baked'; cells: DecorCell[]; op: PlaceOp; extra: PlaceOp[] };

/** Why an edit was refused, in words for the builder. */
function editError(err: unknown): string {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  if (code === NO_PERMISSION) return "You can't build anymore";
  if (message === 'rate limit') return 'Slow down: too many edits at once';
  if (message === 'edit cap') return 'Too many unsaved edits: ask the admin or a map editor to drop by';
  return `Couldn't save the edit: ${message ?? String(err)}`;
}

/**
 * The room's map kept live from the edit log (D4): subscribe and buffer, load the stored map +
 * every edit after it, then apply what arrives in id order. A 'reset' received live (an editor
 * saved or deleted the map) reloads it. Own edits show as pending ghosts until their row comes
 * back. Clients allowed to edit maps bake the log into the stored map once it grows.
 */
export class LiveMap {
  private readonly store = new SupabaseStore();
  private log: EditLog | null = null;
  /** True while (re)loading: live edits wait in `buffer`. */
  private loading = false;
  private readonly buffer: MapEdit[] = [];
  /** Serializes loads and catch-ups. */
  private queue: Promise<void> = Promise.resolve();
  private channel: RealtimeChannel | null = null;
  private stopped = false;
  /** Own placements on their way: local key → op, and inserted row id → local key. */
  private readonly sending = new Map<number, PlaceOp>();
  private readonly awaiting = new Map<number, number>();
  private nextKey = 0;
  private bakeTimer: ReturnType<typeof setTimeout> | null = null;
  /** `log.unbaked` at our last bake. */
  private bakedCount = 0;
  private readonly changeCbs: ((resized: boolean) => void)[] = [];
  private readonly errorCbs: ((msg: string) => void)[] = [];

  constructor(
    private readonly target: OfficeMap,
    private readonly room: string,
    private readonly uid: string,
    private readonly opts: { isAdmin: boolean; canBake(): boolean },
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    const db = await getSupabase();
    if (this.stopped) return;
    this.channel = db
      .channel(`byte_grounds-edits:${this.room}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'map_edits', filter: `map_id=eq.${this.room}` },
        (p) => this.receive(toMapEdit(p.new)),
      )
      .subscribe((status) => {
        // First time: load everything; after a reconnect: fetch what we missed.
        if (status === 'SUBSCRIBED') this.enqueue(() => (this.log ? this.catchUp() : this.reload()));
      });
  }

  stop(): void {
    this.stopped = true;
    if (this.bakeTimer) clearTimeout(this.bakeTimer);
    const channel = this.channel;
    this.channel = null;
    if (channel) void getSupabase().then((db) => db.removeChannel(channel));
  }

  /** Cells of own placements not confirmed yet (drawn as ghosts). */
  get pending(): DecorCell[] {
    return [...this.sending.values()].flatMap(placeCells);
  }

  onChange(cb: (resized: boolean) => void): void {
    this.changeCbs.push(cb);
  }

  onError(cb: (msg: string) => void): void {
    this.errorCbs.push(cb);
  }

  /** Insert an edit; the database decides (RLS). A refusal drops its ghost and reports why; false then. */
  async send(op: EditOp): Promise<boolean> {
    const key = this.nextKey++;
    if (op.kind === 'place') this.sending.set(key, op);
    try {
      const db = await getSupabase();
      const { data, error } = await db.from('map_edits').insert({ map_id: this.room, op }).select('id').single();
      if (error) throw error;
      const id = Number((data as { id: unknown }).id);
      if (this.log?.has(id)) this.sending.delete(key);
      else this.awaiting.set(id, key);
      return true;
    } catch (err) {
      this.sending.delete(key);
      if ((err as { code?: string })?.code !== UNIQUE_VIOLATION) this.emitError(editError(err));
      return false;
    }
  }

  /**
   * The piece the Move tool picks up at tile (x, y), or why it can't: builders move their own
   * live placements, the admin any placement and the map's own furniture.
   */
  pickUp(x: number, y: number): MoveSource | string {
    const log = this.log;
    if (!log) return 'The room is still loading';
    const e = log.placementAt(x, y);
    if (e) {
      if (e.author !== this.uid && !this.opts.isAdmin) return "Only the admin can move other people's pieces";
      return { kind: 'live', edit: e, op: e.op as PlaceOp };
    }
    if (!this.opts.isAdmin) return 'Nothing of yours to move here';
    const obj = bakedObjectAt(log.map, x, y);
    return obj ? { kind: 'baked', ...obj } : 'Nothing to move here';
  }

  /**
   * Move a picked-up piece so its top-left lands on tile (x, y). Live: place the copy, then
   * remove the original (a refused place leaves the original alone). Baked: erase its cells,
   * place the copy, then free the tiles only it was blocking.
   */
  async moveTo(src: MoveSource, x: number, y: number): Promise<void> {
    if (src.op.x === x && src.op.y === y) return;
    const op: PlaceOp = { ...src.op, x, y };
    if (src.kind === 'live') {
      if (await this.send(op)) await this.remove(src.edit);
      return;
    }
    const map = this.log?.map ?? this.target;
    const moved = new Set(src.cells);
    const dx = x - src.op.x;
    const dy = y - src.op.y;
    const extra = src.extra.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
    const newBlocking = new Set(
      [op, ...extra].flatMap((o) => placeCells(o).filter((c) => cellBlocks(c, o.mode))).map((c) => `${c.x},${c.y}`),
    );
    const freed = src.cells.filter(
      (c) =>
        tileAt(map, c.x, c.y) === 1 &&
        !newBlocking.has(`${c.x},${c.y}`) &&
        !(map.decor ?? []).some((d) => !moved.has(d) && d.x === c.x && d.y === c.y && decorLayer(map, d) === 'object'),
    );
    // 'erase' drops a tile's top cell; the moved cells are the top ones on their tiles, so one
    // erase per moved cell takes exactly them.
    for (const c of src.cells) await this.send({ kind: 'erase', x: c.x, y: c.y });
    for (const o of [op, ...extra]) await this.send(o);
    for (const c of freed) await this.send({ kind: 'tile', x: c.x, y: c.y, blocked: false });
  }

  /** Undo our latest placement still standing. */
  async undoOwn(): Promise<void> {
    const e = this.log?.lastOwnPlacement(this.uid);
    if (!e) return this.emitError('Nothing of yours to undo');
    await this.remove(e);
  }

  /** Remove the live placement covering tile (x, y); with none there, the admin erases the top cell. */
  async removeAt(x: number, y: number): Promise<void> {
    const e = this.log?.placementAt(x, y);
    if (e) await this.remove(e);
    else if (this.opts.isAdmin) await this.send({ kind: 'erase', x, y });
  }

  private remove(e: MapEdit): Promise<boolean> {
    return this.send({ kind: 'remove', target: e.id, place: e.op as PlaceOp });
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((err) => {
      console.warn('[live] load failed:', err);
      this.emitError("Couldn't load the latest room changes: reload the page");
    });
  }

  private receive(e: MapEdit | null): void {
    if (!e || this.stopped) return;
    if (!this.log || this.loading) this.buffer.push(e);
    else this.addEdits([e], true);
  }

  /** Load the stored map and every edit after it, then what arrived meanwhile. */
  private async reload(): Promise<void> {
    this.loading = true;
    try {
      const { map, seq } = await this.store.loadMapState(this.room);
      const edits = await this.store.loadEdits(this.room, seq);
      if (this.stopped) return;
      const base = map ? structuredClone(map) : { ...createBlankMap(this.room, 20, 15), id: this.room };
      this.log = new EditLog(base, seq, knownSheet);
      this.bakedCount = 0;
      void loadDecorSheets((base.decor ?? []).map((d) => d.sheet));
      this.addEdits(edits, false, true);
    } finally {
      this.loading = false;
      if (this.log) this.addEdits(this.buffer.splice(0), true);
    }
  }

  /** After a reconnect: the edits we missed (a missed 'reset' reloads). */
  private async catchUp(): Promise<void> {
    const edits = await this.store.loadEdits(this.room, this.log!.lastId);
    if (!this.stopped) this.addEdits(edits, true);
  }

  /**
   * Apply edits to the log and mirror the result into the game's map. `live`: a 'reset' among them
   * means the stored map was replaced since we loaded it, so reload; replayed resets are no-ops.
   */
  private addEdits(edits: MapEdit[], live: boolean, force = false): void {
    const log = this.log!;
    let changed = force;
    let reset = false;
    for (const e of edits) {
      const result = log.add(e);
      const key = this.awaiting.get(e.id);
      if (key !== undefined) {
        this.awaiting.delete(e.id);
        this.sending.delete(key);
      }
      if (result === 'duplicate') continue;
      if (e.op.kind === 'reset') reset ||= live;
      else changed = true;
      if (e.op.kind === 'place') void loadDecorSheets([e.op.sheet]);
    }
    if (changed) {
      const resized = this.target.width !== log.map.width || this.target.height !== log.map.height;
      replaceMapContents(this.target, log.map);
      for (const cb of this.changeCbs) cb(resized);
      this.scheduleBake();
    }
    if (reset) this.enqueue(() => this.reload());
  }

  /** Bake after a quiet spell (jittered so several bakers rarely collide) once enough edits piled up. */
  private scheduleBake(): void {
    if (!this.opts.canBake()) return;
    if (this.bakeTimer) clearTimeout(this.bakeTimer);
    this.bakeTimer = setTimeout(() => void this.bake(), BAKE_IDLE_MS + Math.random() * BAKE_JITTER_MS);
  }

  private async bake(): Promise<void> {
    this.bakeTimer = null;
    const log = this.log;
    if (!log || this.loading || this.stopped || !this.opts.canBake() || log.unbaked - this.bakedCount < BAKE_MIN_EDITS) {
      return;
    }
    const count = log.unbaked;
    try {
      await this.store.bakeMap(structuredClone(log.map), log.lastId);
      if (this.log === log) this.bakedCount = count;
    } catch (err) {
      console.warn('[live] bake failed:', err);
    }
  }

  private emitError(msg: string): void {
    for (const cb of this.errorCbs) cb(msg);
  }
}
