import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminEmail, checkCanEditMaps, checkIsAdmin, ensureSession, shortId } from '../src/auth.ts';

/** Just the auth/rpc surface `auth.ts` touches. */
function stubClient(opts: {
  session?: { user: { id: string; email?: string; is_anonymous?: boolean } } | null;
  sessionError?: Error;
  anonId?: string;
  anonError?: Error;
  rpc?: { data: unknown; error: Error | null };
}) {
  const signInAnonymously = vi.fn(async () =>
    opts.anonError
      ? { data: { user: null, session: null }, error: opts.anonError }
      : { data: { user: { id: opts.anonId ?? 'anon-uid' }, session: {} }, error: null },
  );
  const rpc = vi.fn(async () => opts.rpc ?? { data: true, error: null });
  const client = {
    auth: {
      getSession: async () => ({ data: { session: opts.session ?? null }, error: opts.sessionError ?? null }),
      signInAnonymously,
    },
    rpc,
  } as unknown as SupabaseClient;
  return { client, signInAnonymously, rpc };
}

describe('auth', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('shortId is # plus the first 4 hex chars', () => {
    expect(shortId('a1b2c3d4-0000-4000-8000-000000000000')).toBe('#a1b2');
  });

  it('ensureSession keeps an existing session without signing in', async () => {
    const s = stubClient({ session: { user: { id: 'u1' } } });
    expect(await ensureSession(s.client)).toBe('u1');
    expect(s.signInAnonymously).not.toHaveBeenCalled();
  });

  it('ensureSession signs in anonymously once when there is no session', async () => {
    const s = stubClient({ session: null, anonId: 'fresh' });
    expect(await ensureSession(s.client)).toBe('fresh');
    expect(s.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('ensureSession returns null instead of throwing on errors', async () => {
    expect(await ensureSession(stubClient({ anonError: new Error('disabled') }).client)).toBeNull();
    expect(await ensureSession(stubClient({ sessionError: new Error('boom') }).client)).toBeNull();
  });

  it('ensureSession is null without Supabase', async () => {
    expect(await ensureSession()).toBeNull();
  });

  it('permission checks are true only for a true rpc result, false on error', async () => {
    const yes = stubClient({ rpc: { data: true, error: null } });
    expect(await checkIsAdmin(yes.client)).toBe(true);
    expect(yes.rpc).toHaveBeenCalledWith('is_admin');
    expect(await checkCanEditMaps(yes.client)).toBe(true);
    expect(yes.rpc).toHaveBeenCalledWith('can_edit_maps');
    expect(await checkIsAdmin(stubClient({ rpc: { data: false, error: null } }).client)).toBe(false);
    expect(await checkCanEditMaps(stubClient({ rpc: { data: null, error: new Error('rls') } }).client)).toBe(false);
  });

  it('adminEmail is the email of a non-anonymous session only', async () => {
    expect(await adminEmail(stubClient({ session: { user: { id: 'a', email: 'me@x.io', is_anonymous: false } } }).client)).toBe(
      'me@x.io',
    );
    expect(await adminEmail(stubClient({ session: { user: { id: 'g', is_anonymous: true } } }).client)).toBeNull();
    expect(await adminEmail(stubClient({ session: null }).client)).toBeNull();
  });
});
