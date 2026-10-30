-- ByteGrounds admin + permissions (Phase 1). Run after schema.sql: Supabase dashboard → SQL
-- Editor → New query → paste → Run. Safe to re-run (re-run it too whenever schema.sql is re-run,
-- since schema.sql reopens map writes to everyone).
--
-- Everyone gets a Supabase Auth session: the admin signs in with email + password, guests get a
-- silent anonymous sign-in. The admin grants two global permissions per person:
--   build  = place / remove furniture live in a room (Phase 2)
--   editor = open the map editor and save / delete maps
-- Admins are added only here, by hand (see README):
--   insert into public.admins (user_id) select id from auth.users where email = '<email>' on conflict do nothing;

create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);

create table if not exists public.grants (
  user_id uuid not null references auth.users on delete cascade,
  perm text not null check (perm in ('build', 'editor')),
  granted_at timestamptz not null default now(),
  primary key (user_id, perm)
);

alter table public.admins enable row level security;
alter table public.grants enable row level security;

-- Helpers: security definer so they can read admins/grants whatever the caller's policies are.
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.can_build() returns boolean
  language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or exists (select 1 from public.grants where user_id = auth.uid() and perm = 'build');
$$;

create or replace function public.can_edit_maps() returns boolean
  language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or exists (select 1 from public.grants where user_id = auth.uid() and perm = 'editor');
$$;

grant execute on function public.is_admin(), public.can_build(), public.can_edit_maps() to anon, authenticated;

-- admins: readable by all, written only from the dashboard (no write policies).
drop policy if exists "admins readable" on public.admins;
create policy "admins readable" on public.admins
  for select to anon, authenticated using (true);

-- grants: readable by all (the client shows toggles); only an admin inserts / deletes; no update.
drop policy if exists "grants readable" on public.grants;
create policy "grants readable" on public.grants
  for select to anon, authenticated using (true);

drop policy if exists "grants insert by admin" on public.grants;
create policy "grants insert by admin" on public.grants
  for insert to authenticated with check (public.is_admin());

drop policy if exists "grants delete by admin" on public.grants;
create policy "grants delete by admin" on public.grants
  for delete to authenticated using (public.is_admin());

grant select on public.admins, public.grants to anon, authenticated;
grant insert, delete on public.grants to authenticated;

-- maps: readable by all; written only by the admin and editor-granted people.
drop policy if exists "maps open to anon" on public.maps;

drop policy if exists "maps readable" on public.maps;
create policy "maps readable" on public.maps
  for select to anon, authenticated using (true);

drop policy if exists "maps insert by editors" on public.maps;
create policy "maps insert by editors" on public.maps
  for insert to authenticated with check (public.can_edit_maps());

drop policy if exists "maps update by editors" on public.maps;
create policy "maps update by editors" on public.maps
  for update to authenticated using (public.can_edit_maps()) with check (public.can_edit_maps());

drop policy if exists "maps delete by editors" on public.maps;
create policy "maps delete by editors" on public.maps
  for delete to authenticated using (public.can_edit_maps());

-- Live grant changes reach every client (postgres_changes on grants).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'grants'
     ) then
    alter publication supabase_realtime add table public.grants;
  end if;
end
$$;
