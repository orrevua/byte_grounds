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
