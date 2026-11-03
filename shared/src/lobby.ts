/**
 * Who is online where, and who may join (one instance per name, or per account).
 * Used by the ws server at `join` and by the Supabase client against lobby presence.
 */

/** One online player: their connection id, name, auth uid (if signed in) and room (map id). */
export interface LobbyEntry {
  id: string;
  name: string;
  uid?: string;
  room: string;
}

/** Names compare trimmed and case-insensitive ("Ana" and " ana" are the same person). */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** How many players are in each room. */
export function countByRoom(entries: readonly LobbyEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.room] = (counts[e.room] ?? 0) + 1;
  return counts;
}

/**
 * Admission for a new join: the same account (uid) elsewhere is replaced (`kick` = those ids;
 * newest wins); the same name used by anyone else (another account, or no account) is `taken`.
 */
export function admission(entries: readonly LobbyEntry[], name: string, uid?: string): { taken: boolean; kick: string[] } {
  const key = nameKey(name);
  const kick = uid ? entries.filter((e) => e.uid === uid).map((e) => e.id) : [];
  const taken = entries.some((e) => !kick.includes(e.id) && nameKey(e.name) === key);
  return { taken, kick };
}

/** A lobby entry from untrusted data (presence meta); null if unusable. */
export function toLobbyEntry(id: string, raw: unknown): LobbyEntry | null {
  const { name, uid, room } = (raw ?? {}) as { name?: unknown; uid?: unknown; room?: unknown };
  if (typeof name !== 'string' || typeof room !== 'string' || !name.trim()) return null;
  return { id, name, room, ...(typeof uid === 'string' && uid ? { uid } : {}) };
}
