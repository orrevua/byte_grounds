import { describe, it, expect } from 'vitest';
import { OFFICE_MAP, createBlankMap } from '@byte_grounds/shared/map';
import { LocalStore, playerKey } from '../src/store.ts';

/** Minimal in-memory Storage for the Node test environment. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

describe('LocalStore', () => {
  it('always lists the built-in office and serves it until edited', async () => {
    const store = new LocalStore(memoryStorage());
    expect(await store.listMaps()).toEqual([{ id: 'office', name: 'Office' }]);
    expect(await store.loadMap('office')).toEqual(OFFICE_MAP);
    expect(await store.loadMap('nope')).toBeNull();
  });

  it('saves, lists, loads and deletes maps', async () => {
    const store = new LocalStore(memoryStorage());
    const m = createBlankMap('Café', 5, 4);
    await store.saveMap(m);
    expect((await store.listMaps()).map((x) => x.id)).toEqual(['office', 'cafe']);
    expect(await store.loadMap('cafe')).toEqual(m);
    await store.deleteMap('cafe');
    expect(await store.loadMap('cafe')).toBeNull();
  });

  it('remembers positions per map and per player name, ignoring case/spaces', async () => {
    const store = new LocalStore(memoryStorage());
    await store.savePosition('office', 'Felipe ', 4.5, 6.5);
    expect(await store.loadPosition('office', 'felipe')).toEqual({ x: 4.5, y: 6.5 });
    expect(await store.loadPosition('cafe', 'felipe')).toBeNull();
    expect(playerKey('  FeLiPe ')).toBe('felipe');
  });
});
