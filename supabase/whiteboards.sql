-- ByteGrounds whiteboards: what is drawn on the whiteboards in the rooms. Run once:
-- Supabase dashboard → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Everyone reads; any signed-in session (anonymous guests included) writes, like drawing on a real
-- whiteboard. `id` is "<map id>:<x>,<y>" of the whiteboard piece; `data` is the board JSON
-- ({ "tabs": [{ "id", "name", "items": [...] }] }, see shared/src/board.ts), at most ~2 MB.

create table if not exists public.whiteboards (
  id text primary key check (length(id) between 3 and 80),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 2000000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.whiteboards enable row level security;

drop policy if exists "whiteboards readable" on public.whiteboards;
create policy "whiteboards readable" on public.whiteboards
  for select using (true);

drop policy if exists "whiteboards insert by signed-in" on public.whiteboards;
create policy "whiteboards insert by signed-in" on public.whiteboards
  for insert to authenticated with check (true);

drop policy if exists "whiteboards update by signed-in" on public.whiteboards;
create policy "whiteboards update by signed-in" on public.whiteboards
  for update to authenticated using (true) with check (true);

grant select on public.whiteboards to anon, authenticated;
grant insert, update on public.whiteboards to authenticated;
