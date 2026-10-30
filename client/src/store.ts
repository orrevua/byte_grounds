import { parseMap, type OfficeMap } from '@byte_grounds/shared/map';
import { BUILT_IN_MAPS, builtInMap, builtInRev } from '@byte_grounds/shared/maps';
import { getSupabase, hasSupabase } from './supabase.ts';
import { toMapEdit, type MapEdit } from './edit-ops.ts';

export interface MapSummary {
  id: string;
  name: string;
}

/** Saved maps and each player's last spot per map. */
export interface Store {
  listMaps(): Promise<MapSummary[]>;
  /** A saved map, or the built-in map with that id when it has no up-to-date saved copy. */
  loadMap(id: string): Promise<OfficeMap | null>;
  /** `loadMap` plus `seq`: the last live edit folded into the stored map (0 = none, or no row). */
  loadMapState(id: string): Promise<{ map: OfficeMap | null; seq: number }>;
  /**
   * Replace the stored map; returns its new seq. With Supabase, throws `StaleSaveError` when live
   * edits newer than `expectSeq` exist (merge them and retry); `null` / absent overwrites.
   */
  saveMap(map: OfficeMap, expectSeq?: number | null): Promise<number>;
  deleteMap(id: string): Promise<void>;
  /** Live edits of a map with id > `after`, in id order (none in local dev). */
  loadEdits(mapId: string, after: number): Promise<MapEdit[]>;
  loadPosition(mapId: string, player: string): Promise<{ x: number; y: number } | null>;
  savePosition(mapId: string, player: string, x: number, y: number): Promise<void>;
}

/** A save refused because live edits landed after the ones the editor merged (`bake_map` 'stale'). */
export class StaleSaveError extends Error {
  constructor() {
    super('The map has newer live edits');
    this.name = 'StaleSaveError';
  }
}

/** Live edits are read in pages of this many rows. */
const EDITS_PAGE = 1000;

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
export function toStored(map: OfficeMap): OfficeMap {
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
    return (await this.loadMapState(id)).map;
  }

  /**
   * Without a row (a built-in map never saved, or a deleted map) the seq is the map's latest
   * 'reset': `delete_map` leaves one behind, and the edits before it are gone with the row.
   */
  async loadMapState(id: string): Promise<{ map: OfficeMap | null; seq: number }> {
    const db = await getSupabase();
    const { data, error } = await db.from('maps').select('data, edit_seq').eq('id', id).maybeSingle();
    if (error) throw error;
    if (data) return { map: pickMap(id, data.data), seq: Number(data.edit_seq ?? 0) };
    const reset = await db
      .from('map_edits')
      .select('id')
      .eq('map_id', id)
      .eq('op->>kind', 'reset')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (reset.error) throw reset.error;
    return { map: pickMap(id, null), seq: Number(reset.data?.id ?? 0) };
  }

  /** Through `bake_map` (supabase/live-edits.sql): writes a 'reset' so room clients reload. */
  async saveMap(map: OfficeMap, expectSeq: number | null = null): Promise<number> {
    const db = await getSupabase();
    const { data, error } = await db.rpc('bake_map', {
      p_map: map.id,
      p_name: map.name ?? map.id,
      p_data: toStored(map),
      p_upto: 0,
      p_reset: true,
      p_expect: expectSeq,
    });
    if (error?.code === 'P0001' && error.message === 'stale') throw new StaleSaveError();
    if (error) throw error;
    return Number(data);
  }

  /**
   * Live baking: fold the log up to `upto` into the stored map without a 'reset' (nobody reloads).
   * Only moves the stored seq forward, so several bakers at once are harmless. Editors only (RLS).
   */
  async bakeMap(map: OfficeMap, upto: number): Promise<void> {
    const db = await getSupabase();
    const { error } = await db.rpc('bake_map', {
      p_map: map.id,
      p_name: map.name ?? map.id,
      p_data: toStored(map),
      p_upto: upto,
      p_reset: false,
    });
    if (error) throw error;
  }

  async loadEdits(mapId: string, after: number): Promise<MapEdit[]> {
    const db = await getSupabase();
    const edits: MapEdit[] = [];
    for (let cursor = after; ; ) {
      const { data, error } = await db
        .from('map_edits')
        .select('id, author, op')
        .eq('map_id', mapId)
        .gt('id', cursor)
        .order('id')
        .limit(EDITS_PAGE);
      if (error) throw error;
      const rows = data ?? [];
      for (const row of rows) {
        const e = toMapEdit(row);
        if (e) edits.push(e);
      }
      if (rows.length < EDITS_PAGE) return edits;
      cursor = Number(rows.at(-1)!.id);
    }
  }

  /** Through `delete_map`: also drops the map's live edits and saved player spots. */
  async deleteMap(id: string): Promise<void> {
    const db = await getSupabase();
    const { error } = await db.rpc('delete_map', { p_map: id });
    if (error) throw error;
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
    return (await this.loadMapState(id)).map;
  }

  /** No live edits in local dev: seq is always 0. */
  async loadMapState(id: string): Promise<{ map: OfficeMap | null; seq: number }> {
    return { map: pickMap(id, this.read<OfficeMap>(MAPS_KEY)[id]), seq: 0 };
  }

  async saveMap(map: OfficeMap): Promise<number> {
    this.write(MAPS_KEY, { ...this.read(MAPS_KEY), [map.id]: toStored(map) });
    return 0;
  }

  async deleteMap(id: string): Promise<void> {
    const maps = this.read(MAPS_KEY);
    delete maps[id];
    this.write(MAPS_KEY, maps);
  }

  async loadEdits(): Promise<MapEdit[]> {
    return [];
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
