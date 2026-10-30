import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, hasSupabase } from './supabase.ts';

/**
 * Identity (Supabase Auth). The admin signs in with email + password; guests get a silent
 * anonymous session, kept by supabase-js in localStorage, so their `auth.uid()` survives reloads
 * on that browser. Every permission is enforced again by RLS (`supabase/admin.sql`); these
 * checks only pick which UI to show. Without Supabase (local ws dev) there is no identity.
 */

/** A short tag to tell two people with the same name apart: '#' + the uid's first 4 hex chars. */
export function shortId(uid: string): string {
  return `#${uid.slice(0, 4)}`;
}

/** The given client (tests), else the page's client; null in local dev without Supabase. */
async function clientOf(db?: SupabaseClient): Promise<SupabaseClient | null> {
  if (db) return db;
  return hasSupabase ? getSupabase() : null;
}

/** Our uid, signing in anonymously when there is no session yet; null without Supabase or on error. */
export async function ensureSession(db?: SupabaseClient): Promise<string | null> {
  try {
    const c = await clientOf(db);
    if (!c) return null;
    const { data, error } = await c.auth.getSession();
    if (error) throw error;
    if (data.session) return data.session.user.id;
    const anon = await c.auth.signInAnonymously();
    if (anon.error) throw anon.error;
    return anon.data.user?.id ?? null;
  } catch (err) {
    console.warn('[auth] no session:', err);
    return null;
  }
}

/** Replaces the current (anonymous) session with the admin's; throws on a bad login. */
export async function signInAdmin(email: string, password: string): Promise<void> {
  const c = await clientOf();
  if (!c) throw new Error('Supabase is not configured');
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Ends the admin session; the next `ensureSession()` creates a fresh anonymous one. */
export async function signOutAdmin(): Promise<void> {
  const c = await clientOf();
  if (!c) return;
  const { error } = await c.auth.signOut();
  if (error) throw error;
}

async function rpcFlag(fn: string, db?: SupabaseClient): Promise<boolean> {
  try {
    const c = await clientOf(db);
    if (!c) return false;
    const { data, error } = await c.rpc(fn);
    if (error) throw error;
    return data === true;
  } catch (err) {
    console.warn(`[auth] ${fn} failed:`, err);
    return false;
  }
}

export function checkIsAdmin(db?: SupabaseClient): Promise<boolean> {
  return rpcFlag('is_admin', db);
}

export function checkCanEditMaps(db?: SupabaseClient): Promise<boolean> {
  return rpcFlag('can_edit_maps', db);
}

/** The signed-in admin's email; null for guests (anonymous sessions), no session, or no Supabase. */
export async function adminEmail(db?: SupabaseClient): Promise<string | null> {
  const c = await clientOf(db);
  if (!c) return null;
  const { data } = await c.auth.getSession();
  const user = data.session?.user;
  return user && user.is_anonymous !== true ? (user.email ?? null) : null;
}
