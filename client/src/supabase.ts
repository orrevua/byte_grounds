import type { SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when the build has Supabase settings (production); false = local ws dev. */
export const hasSupabase = !!(URL && KEY);

let client: Promise<SupabaseClient> | null = null;

/**
 * The one Supabase client for the page (Realtime + database). Loaded lazily so the ws-only
 * dev build doesn't pay for the bundle. `worker`: Realtime heartbeats run in a Web Worker,
 * so background tabs / locked phones (whose timers get throttled) aren't dropped.
 */
export function getSupabase(url = URL!, key = KEY!): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key, { realtime: { worker: true } }),
  );
  return client;
}
