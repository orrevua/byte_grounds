-- ByteGrounds tables. Run once: Supabase dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run. On its own this leaves maps writable by anyone with the site (anon key).
-- Then run supabase/admin.sql: it locks map writes to the admin and editor-granted people
-- (re-run admin.sql whenever you re-run this file).

create table if not exists public.maps (
  id text primary key,
  name text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.player_positions (
  map_id text not null,
  player_name text not null, -- lowercased, trimmed display name
  x real not null,
  y real not null,
  updated_at timestamptz not null default now(),
  primary key (map_id, player_name)
);

alter table public.maps enable row level security;
alter table public.player_positions enable row level security;

drop policy if exists "maps open to anon" on public.maps;
create policy "maps open to anon" on public.maps
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "positions open to anon" on public.player_positions;
create policy "positions open to anon" on public.player_positions
  for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.maps, public.player_positions to anon, authenticated;
