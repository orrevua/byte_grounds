import { parseMap, type OfficeMap } from '@byte_grounds/shared/map';
import { BUILT_IN_MAPS, builtInMap, builtInRev } from '@byte_grounds/shared/maps';
import { getSupabase, hasSupabase } from './supabase.ts';

export interface MapSummary {
  id: string;
  name: string;
}

/** Saved maps and each player's last spot per map. */
export interface Store {
  listMaps(): Promise<MapSummary[]>;
  /** A saved map, or the built-in map with that id when it has no up-to-date saved copy. */
  loadMap(id: string): Promise<OfficeMap | null>;
  saveMap(map: OfficeMap): Promise<void>;
  deleteMap(id: string): Promise<void>;
  loadPosition(mapId: string, player: string): Promise<{ x: number; y: number } | null>;
  savePosition(mapId: string, player: string, x: number, y: number): Promise<void>;
}

/** Positions are keyed by display name (no login), case- and space-insensitive. */
export function playerKey(name: string): string {
  return name.trim().toLowerCase();
}

/** A stored map's list entry; `basedOnRev` as saved in its data (see `savedWins`). */
interface SavedSummary extends MapSummary {
  basedOnRev?: number | null;
}

/**
 * Whether a saved map is served instead of the built-in with its id: always when there is no
 * built-in, else only if it was edited from the built-in's current revision. A copy saved from
 * an older revision (or before revisions existed) is stale: it stays stored but no longer hides
 * the new built-in.
 */
export function savedWins(id: string, basedOnRev: number | null | undefined): boolean {
  return !builtInMap(id) || (basedOnRev ?? 0) >= builtInRev(id);
}

/** The map served for `id` given its stored data (if any). */
function pickMap(id: string, saved: unknown): OfficeMap | null {
  const map = parseMap(saved);
  return map && savedWins(id, map.basedOnRev) ? map : builtInMap(id);
}

/** What gets stored: a copy of a built-in map records the revision it was edited from. */
function toStored(map: OfficeMap): OfficeMap {
  const rev = builtInRev(map.id);
  return rev ? { ...map, basedOnRev: rev } : map;
}

/**
 * Built-in maps are always listed first, even before anyone saves a map (an up-to-date saved
 * copy of one keeps its place under its saved name), then every other saved map.
 */
function withBuiltIn(saved: SavedSummary[]): MapSummary[] {
  const maps = saved.filter((m) => savedWins(m.id, m.basedOnRev)).map(({ id, name }) => ({ id, name }));
  const builtIns = BUILT_IN_MAPS.map((b) => maps.find((m) => m.id === b.id) ?? { id: b.id, name: b.name ?? b.id });
  return [...builtIns, ...maps.filter((m) => !builtInMap(m.id))];
}

/** Supabase tables from `supabase/schema.sql`. */
export class SupabaseStore implements Store {
  async listMaps(): Promise<MapSummary[]> {
    const db = await getSupabase();
    const { data, error } = await db.from('maps').select('id, name, basedOnRev:data->basedOnRev').order('name');
    if (error) throw error;
    return withBuiltIn((data ?? []) as SavedSummary[]);
  }

  async loadMap(id: string): Promise<OfficeMap | null> {
    const db = await getSupabase();
    const { data, error } = await db.from('maps').select('data').eq('id', id).maybeSingle();
    if (error) throw error;
    return pickMap(id, data?.data);
  }

  async saveMap(map: OfficeMap): Promise<void> {
    const db = await getSupabase();
    const row = { id: map.id, name: map.name ?? map.id, data: toStored(map), updated_at: new Date().toISOString() };
    const { error } = await db.from('maps').upsert(row);
    if (error) throw error;
  }

  async deleteMap(id: string): Promise<void> {
    const db = await getSupabase();
    const { error } = await db.from('maps').delete().eq('id', id);
    if (error) throw error;
    await db.from('player_positions').delete().eq('map_id', id);
  }

  async loadPosition(mapId: string, player: string): Promise<{ x: number; y: number } | null> {
    const db = await getSupabase();
    const { data, error } = await db
      .from('player_positions')
      .select('x, y')
      .eq('map_id', mapId)
      .eq('player_name', playerKey(player))
      .maybeSingle();
    if (error) throw error;
    return data ? { x: data.x as number, y: data.y as number } : null;
  }

  async savePosition(mapId: string, player: string, x: number, y: number): Promise<void> {
    const db = await getSupabase();
    const { error } = await db.from('player_positions').upsert({
      map_id: mapId,
      player_name: playerKey(player),
      x,
      y,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }
}

const MAPS_KEY = 'byte_grounds.maps';
const POS_KEY = 'byte_grounds.positions';

/** Browser-only fallback for local dev without Supabase (localStorage). */
export class LocalStore implements Store {
  constructor(private readonly storage: Storage = localStorage) {}

  private read<T>(key: string): Record<string, T> {
    try {
      return JSON.parse(this.storage.getItem(key) ?? '{}') as Record<string, T>;
    } catch {
      return {};
    }
  }

  private write(key: string, value: unknown): void {
    this.storage.setItem(key, JSON.stringify(value));
  }

  async listMaps(): Promise<MapSummary[]> {
    const maps = Object.values(this.read<OfficeMap>(MAPS_KEY));
    return withBuiltIn(
      maps
        .map((m) => ({ id: m.id, name: m.name ?? m.id, basedOnRev: m.basedOnRev }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async loadMap(id: string): Promise<OfficeMap | null> {
    return pickMap(id, this.read<OfficeMap>(MAPS_KEY)[id]);
  }

  async saveMap(map: OfficeMap): Promise<void> {
    this.write(MAPS_KEY, { ...this.read(MAPS_KEY), [map.id]: toStored(map) });
  }

  async deleteMap(id: string): Promise<void> {
    const maps = this.read(MAPS_KEY);
    delete maps[id];
    this.write(MAPS_KEY, maps);
  }

  async loadPosition(mapId: string, player: string): Promise<{ x: number; y: number } | null> {
    return this.read<{ x: number; y: number }>(POS_KEY)[`${mapId}/${playerKey(player)}`] ?? null;
  }

  async savePosition(mapId: string, player: string, x: number, y: number): Promise<void> {
    this.write(POS_KEY, { ...this.read(POS_KEY), [`${mapId}/${playerKey(player)}`]: { x, y } });
  }
}

export function createStore(): Store {
  return hasSupabase ? new SupabaseStore() : new LocalStore();
}
