import { describe, it, expect } from 'vitest';
import { createBlankMap } from '@byte_grounds/shared/map';
import { builtInMap, builtInRev } from '@byte_grounds/shared/maps';
import { LocalStore, playerKey, savedWins } from '../src/store.ts';

const OFFICE = builtInMap('office')!;

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
  it('always lists the built-in maps and serves them until edited', async () => {
    const store = new LocalStore(memoryStorage());
    expect(await store.listMaps()).toEqual([
      { id: 'lounge', name: 'Lounge & Café' },
      { id: 'office', name: 'Office' },
      { id: 'home', name: 'Home' },
    ]);
    expect(await store.loadMap('office')).toEqual(OFFICE);
    expect(await store.loadMap('nope')).toBeNull();
  });

  it('serves a saved copy of a built-in map instead, and the built-in again once deleted', async () => {
    const store = new LocalStore(memoryStorage());
    const edited = { ...createBlankMap('My office', 5, 4), id: 'office' };
    await store.saveMap(edited);
    expect(await store.loadMap('office')).toEqual({ ...edited, basedOnRev: builtInRev('office') });
    expect((await store.listMaps())[1]).toEqual({ id: 'office', name: 'My office' });
    await store.deleteMap('office');
    expect(await store.loadMap('office')).toEqual(OFFICE);
  });

  it('serves the built-in over a stale saved copy (older or no basedOnRev) but keeps the copy', async () => {
    const storage = memoryStorage();
    const stale = { ...createBlankMap('Old office', 5, 4), id: 'office' };
    const older = { ...stale, id: 'home', name: 'Old home', basedOnRev: builtInRev('home') - 1 };
    storage.setItem('byte_grounds.maps', JSON.stringify({ office: stale, home: older }));
    const store = new LocalStore(storage);
    expect(await store.loadMap('office')).toEqual(OFFICE);
    expect(await store.loadMap('home')).toEqual(builtInMap('home'));
    expect((await store.listMaps()).map((m) => m.name)).toEqual(['Lounge & Café', 'Office', 'Home']);
    expect(JSON.parse(storage.getItem('byte_grounds.maps')!).office).toEqual(stale);
  });

  it('decides precedence by revision, and always lets maps without a built-in win', () => {
    const rev = builtInRev('office');
    expect(savedWins('office', undefined)).toBe(false);
    expect(savedWins('office', null)).toBe(false);
    expect(savedWins('office', rev - 1)).toBe(false);
    expect(savedWins('office', rev)).toBe(true);
    expect(savedWins('office', rev + 1)).toBe(true);
    expect(savedWins('cafe', undefined)).toBe(true);
  });

  it('saves, lists, loads and deletes maps', async () => {
    const store = new LocalStore(memoryStorage());
    const m = createBlankMap('Café', 5, 4);
    await store.saveMap(m);
    expect((await store.listMaps()).map((x) => x.id)).toEqual(['lounge', 'office', 'home', 'cafe']);
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
