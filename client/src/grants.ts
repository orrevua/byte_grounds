import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase.ts';

/** Global per-person permissions granted by the admin (`public.grants`, `supabase/admin.sql`). */
export type Perm = 'build' | 'editor';
export type GrantChange = { type: 'INSERT' | 'DELETE'; userId: string; perm: Perm };

const PERMS: readonly Perm[] = ['build', 'editor'];

export function grantKey(uid: string, perm: Perm): string {
  return `${uid}:${perm}`;
}

/** Apply one change to a set of `grantKey`s; true if the set changed. */
export function applyGrantChange(set: Set<string>, c: GrantChange): boolean {
  const key = grantKey(c.userId, c.perm);
  if (c.type === 'DELETE') return set.delete(key);
  if (set.has(key)) return false;
  set.add(key);
  return true;
}

/** A `grants` row from a change payload (`new` for INSERT, `old` for DELETE); null if unusable. */
export function toGrantChange(type: GrantChange['type'], row: unknown): GrantChange | null {
  const { user_id, perm } = (row ?? {}) as { user_id?: unknown; perm?: unknown };
  if (typeof user_id !== 'string' || !PERMS.includes(perm as Perm)) return null;
  return { type, userId: user_id, perm: perm as Perm };
}

/** Postgres unique violation: the grant already exists, which is what we wanted. */
const UNIQUE_VIOLATION = '23505';

/**
 * Who holds which permission, kept live: the whole (tiny) table is read on every (re)subscribe,
 * then INSERT / DELETE changes are applied as they come. Writes are admin-only by RLS; a rejected
 * `grant` / `revoke` throws the PostgREST error.
 */
export class GrantsFeed {
  private keys = new Set<string>();
  private readonly listeners: (() => void)[] = [];
  private channel: RealtimeChannel | null = null;
  private stopped = false;

  async start(): Promise<void> {
    this.stopped = false;
    const db = await getSupabase();
    if (this.stopped) return;
    this.channel = db
      .channel('byte_grounds-grants')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'grants' }, (p) =>
        this.apply(toGrantChange('INSERT', p.new)),
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'grants' }, (p) =>
        this.apply(toGrantChange('DELETE', p.old)),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void this.reload();
      });
    await this.reload();
  }

  stop(): void {
    this.stopped = true;
    const channel = this.channel;
    this.channel = null;
    if (channel) void getSupabase().then((db) => db.removeChannel(channel));
  }

  has(uid: string | undefined, perm: Perm): boolean {
    return !!uid && this.keys.has(grantKey(uid, perm));
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  async grant(uid: string, perm: Perm): Promise<void> {
    const db = await getSupabase();
    const { error } = await db.from('grants').insert({ user_id: uid, perm });
    if (error && error.code !== UNIQUE_VIOLATION) throw error;
    this.apply({ type: 'INSERT', userId: uid, perm });
  }

  async revoke(uid: string, perm: Perm): Promise<void> {
    const db = await getSupabase();
    const { error } = await db.from('grants').delete().eq('user_id', uid).eq('perm', perm);
    if (error) throw error;
    this.apply({ type: 'DELETE', userId: uid, perm });
  }

  private apply(c: GrantChange | null): void {
    if (c && applyGrantChange(this.keys, c)) this.notify();
  }

  /** Replace the set with the table's current contents. */
  private async reload(): Promise<void> {
    const db = await getSupabase();
    const { data, error } = await db.from('grants').select('user_id, perm');
    if (error) {
      console.warn('[grants] reload failed:', error);
      return;
    }
    const next = new Set<string>();
    for (const row of data ?? []) {
      const c = toGrantChange('INSERT', row);
      if (c) next.add(grantKey(c.userId, c.perm));
    }
    if (this.stopped || sameSet(next, this.keys)) return;
    this.keys = next;
    this.notify();
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((k) => b.has(k));
}
