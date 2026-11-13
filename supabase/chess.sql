-- ByteGrounds chess tables: the game in progress at each chess table, and every finished match.
-- Run once: Supabase dashboard → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Everyone reads; any signed-in session (anonymous guests included) writes, like the whiteboards.
-- `id` of a table is "<map id>:<x>,<y>" of the chess table piece; `data` is the game JSON
-- (see shared/src/chess.ts `ChessGame`). Matches are only ever added, never changed.

create table if not exists public.chess_tables (
  id text primary key check (length(id) between 3 and 80),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 50000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.chess_matches (
  id text primary key check (length(id) between 1 and 40),
  table_id text not null check (length(table_id) between 3 and 80),
  white text not null check (length(white) <= 40),
  black text not null check (length(black) <= 40),
  winner text check (winner in ('w', 'b')),
  reason text not null check (reason in ('checkmate', 'resign', 'stalemate', 'agreement', 'fifty', 'repetition', 'material', 'abandon')),
  moves text[] not null check (cardinality(moves) <= 600),
  ended_at timestamptz not null default now(),
  saved_by uuid default auth.uid()
);

create index if not exists chess_matches_table_ended on public.chess_matches (table_id, ended_at desc);

alter table public.chess_tables enable row level security;
alter table public.chess_matches enable row level security;

drop policy if exists "chess tables readable" on public.chess_tables;
create policy "chess tables readable" on public.chess_tables
  for select using (true);

drop policy if exists "chess tables insert by signed-in" on public.chess_tables;
create policy "chess tables insert by signed-in" on public.chess_tables
  for insert to authenticated with check (true);

drop policy if exists "chess tables update by signed-in" on public.chess_tables;
create policy "chess tables update by signed-in" on public.chess_tables
  for update to authenticated using (true) with check (true);

drop policy if exists "chess matches readable" on public.chess_matches;
create policy "chess matches readable" on public.chess_matches
  for select using (true);

drop policy if exists "chess matches insert by signed-in" on public.chess_matches;
create policy "chess matches insert by signed-in" on public.chess_matches
  for insert to authenticated with check (true);

grant select on public.chess_tables, public.chess_matches to anon, authenticated;
grant insert, update on public.chess_tables to authenticated;
grant insert on public.chess_matches to authenticated;
