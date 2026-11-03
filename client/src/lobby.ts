import { countByRoom, toLobbyEntry, type LobbyEntry } from '@byte_grounds/shared/lobby';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, hasSupabase } from './supabase.ts';

/** The Supabase Realtime channel every player in a room is present on (see `SupabaseNet`). */
export const LOBBY_TOPIC = 'byte_grounds:lobby';
/** The ws dev server is polled this often for counts. */
const POLL_MS = 3000;

/** Players per room (map id), kept live. */
export type RoomCounts = Record<string, number>;

/** Lobby entries from a presence state (one entry per key). */
export function lobbyEntries(state: Record<string, unknown[]>): LobbyEntry[] {
  const out: LobbyEntry[] = [];
  for (const [key, metas] of Object.entries(state)) {
    const e = toLobbyEntry(key, metas[0]);
    if (e) out.push(e);
  }
  return out;
}

/** The ws server's HTTP address for the lobby endpoint (ws://host:port → http://host:port/lobby). */
export function lobbyUrl(wsUrl: string): string {
  return `${wsUrl.replace(/^ws/, 'http').replace(/\/+$/, '')}/lobby`;
}

/**
 * Watch how many players are in each room (the join screen). Supabase: lobby presence, without
 * announcing ourselves; ws dev: polls the server. Resolves the stop function, which must finish
 * before the game joins the lobby channel itself.
 */
export function watchRoomCounts(cb: (counts: RoomCounts) => void): () => Promise<void> {
  if (!hasSupabase) {
    const url = lobbyUrl(import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080');
    const poll = (): void =>
      void fetch(url)
        .then((r) => r.json() as Promise<{ counts?: RoomCounts }>)
        .then((d) => cb(d.counts ?? {}))
        .catch(() => {});
    poll();
    const timer = setInterval(poll, POLL_MS);
    return async () => clearInterval(timer);
  }
  let channel: RealtimeChannel | null = null;
  let stopped = false;
  const ready = getSupabase().then((db) => {
    if (stopped) return;
    const ch = (channel = db.channel(LOBBY_TOPIC));
    ch.on('presence', { event: 'sync' }, () => cb(countByRoom(lobbyEntries(ch.presenceState())))).subscribe();
  });
  return async () => {
    stopped = true;
    await ready.catch(() => {});
    if (channel) await getSupabase().then((db) => db.removeChannel(channel!));
  };
}
