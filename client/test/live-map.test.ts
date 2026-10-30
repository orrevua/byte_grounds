import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBlankMap, tileAt, type OfficeMap } from '@byte_grounds/shared/map';
import type { MapEdit } from '../src/edit-ops.ts';

/** One fake Realtime channel: captures the INSERT handler and reports SUBSCRIBED. */
let insert: ((p: { new: unknown }) => void) | null = null;
const inserted: unknown[] = [];

vi.mock('../src/supabase.ts', () => ({
  hasSupabase: true,
  getSupabase: async () => ({
    channel: () => {
      const ch = {
        on: (_t: string, _f: unknown, cb: (p: { new: unknown }) => void) => {
          insert = cb;
          return ch;
        },
        subscribe: (cb: (s: string) => void) => {
          queueMicrotask(() => cb('SUBSCRIBED'));
          return ch;
        },
      };
      return ch;
    },
    removeChannel: async () => {},
    from: () => ({
      insert: (row: unknown) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 99 }, error: null }) }) };
      },
    }),
  }),
}));

// No browser Image in Node: every sheet counts as known and loads instantly.
vi.mock('../src/decor.ts', () => ({
  decorImage: () => ({}),
  loadDecorSheets: async () => {},
}));

const { LiveMap } = await import('../src/live-map.ts');
const { SupabaseStore } = await import('../src/store.ts');

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('LiveMap wiring (fake Supabase)', () => {
  let stored: OfficeMap;
  let edits: MapEdit[];

  beforeEach(() => {
    insert = null;
    inserted.length = 0;
    stored = createBlankMap('room', 6, 6);
    edits = [{ id: 4, author: 'u2', op: { kind: 'tile', x: 2, y: 2, blocked: true } }];
    vi.spyOn(SupabaseStore.prototype, 'loadMapState').mockImplementation(async () => ({
      map: structuredClone(stored),
      seq: 3,
    }));
    vi.spyOn(SupabaseStore.prototype, 'loadEdits').mockImplementation(async (_m, after) =>
      edits.filter((e) => e.id > after),
    );
  });

  it('loads the stored map plus later edits into the game map, then applies live inserts', async () => {
    const target = createBlankMap('room', 6, 6); // the object the game draws
    const live = new LiveMap(target, 'room', 'u1', { isAdmin: false, canBake: () => false });
    const changes: boolean[] = [];
    live.onChange((resized) => changes.push(resized));
    await live.start();
    await flush();
    await flush();

    expect(tileAt(target, 2, 2)).toBe(1); // edit 4 applied on top of the stored map
    expect(changes).toEqual([false]);

    insert!({ new: { id: 5, author: 'u2', op: { kind: 'tile', x: 3, y: 3, blocked: true } } });
    expect(tileAt(target, 3, 3)).toBe(1);
    expect(changes).toEqual([false, false]);
    live.stop();
  });

  it('Move: a builder moves their own live placement (place copy, then remove original)', async () => {
    const piece = { kind: 'place', x: 1, y: 1, sheet: 'office_grid', sx: 0, sy: 0, w: 1, h: 1, mode: 'base', rot: 0, flipX: false } as const;
    edits = [{ id: 4, author: 'u1', op: piece }];
    const target = createBlankMap('room', 6, 6);
    const live = new LiveMap(target, 'room', 'u1', { isAdmin: false, canBake: () => false });
    await live.start();
    await flush();
    await flush();
    const src = live.pickUp(1, 1);
    expect(typeof src).toBe('object');
    await live.moveTo(src as Exclude<typeof src, string>, 3, 2);
    expect(inserted.map((r) => (r as { op: { kind: string } }).op.kind)).toEqual(['place', 'remove']);
    expect((inserted[0] as { op: { x: number; y: number } }).op).toMatchObject({ x: 3, y: 2 });
    expect((inserted[1] as { op: { target: number } }).op.target).toBe(4);
    live.stop();
  });

  it("Move: a builder can't pick up someone else's piece or the map's own furniture", async () => {
    const piece = { kind: 'place', x: 1, y: 1, sheet: 'office_grid', sx: 0, sy: 0, w: 1, h: 1, mode: 'base', rot: 0, flipX: false } as const;
    edits = [{ id: 4, author: 'u2', op: piece }];
    stored.decor = [{ x: 4, y: 4, sheet: 'office_grid', sx: 1, sy: 1, layer: 'object' }];
    const target = createBlankMap('room', 6, 6);
    const live = new LiveMap(target, 'room', 'u1', { isAdmin: false, canBake: () => false });
    await live.start();
    await flush();
    await flush();
    expect(typeof live.pickUp(1, 1)).toBe('string');
    expect(typeof live.pickUp(4, 4)).toBe('string');
    live.stop();
  });

  it('Move: the admin moves baked furniture (erase, place, free the old tile)', async () => {
    stored.decor = [{ x: 4, y: 4, sheet: 'office_grid', sx: 1, sy: 1, layer: 'object' }];
    stored.tiles[4 * stored.width + 4] = 1;
    edits = [];
    const target = createBlankMap('room', 6, 6);
    const live = new LiveMap(target, 'room', 'admin', { isAdmin: true, canBake: () => false });
    await live.start();
    await flush();
    await flush();
    const src = live.pickUp(4, 4);
    expect(src).toMatchObject({ kind: 'baked' });
    await live.moveTo(src as Exclude<typeof src, string>, 2, 2);
    expect(inserted.map((r) => (r as { op: unknown }).op)).toEqual([
      { kind: 'erase', x: 4, y: 4 },
      { kind: 'place', x: 2, y: 2, sheet: 'office_grid', sx: 1, sy: 1, w: 1, h: 1, mode: 'base', rot: 0, flipX: false },
      { kind: 'tile', x: 4, y: 4, blocked: false },
    ]);
    live.stop();
  });

  it('sends edits as map_edits rows for the room', async () => {
    const target = createBlankMap('room', 6, 6);
    const live = new LiveMap(target, 'room', 'u1', { isAdmin: true, canBake: () => false });
    await live.start();
    await flush();
    await live.send({ kind: 'tile', x: 1, y: 1, blocked: false });
    expect(inserted).toEqual([{ map_id: 'room', op: { kind: 'tile', x: 1, y: 1, blocked: false } }]);
    live.stop();
  });
});
