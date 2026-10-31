-- ByteGrounds Sheet Studio: custom decoration sheets drawn on /sheets. Run after admin.sql:
-- Supabase dashboard → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Everyone reads (the game draws these sheets); only admins (public.is_admin(), admin.sql) write.
-- The image is a PNG data URL ("data:image/png;base64,..."), at most 32x32 cells of 32px.

create table if not exists public.decor_sheets (
  id text primary key check (id ~ '^custom_[a-z0-9_]{1,40}$'),
  name text not null,
  png text not null check (png like 'data:image/png;base64,%' and length(png) < 3000000),
  cols int not null check (cols between 1 and 32),
  rows int not null check (rows between 1 and 32),
  seats jsonb not null default '[]',  -- sittable cells: [{ "x", "y", "kind": "sit"|"lie", "dir" }]
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- Tables made before seats existed.
alter table public.decor_sheets add column if not exists seats jsonb not null default '[]';

alter table public.decor_sheets enable row level security;

drop policy if exists "decor sheets readable" on public.decor_sheets;
create policy "decor sheets readable" on public.decor_sheets
  for select using (true);

drop policy if exists "decor sheets insert by admin" on public.decor_sheets;
create policy "decor sheets insert by admin" on public.decor_sheets
  for insert with check (public.is_admin());

drop policy if exists "decor sheets update by admin" on public.decor_sheets;
create policy "decor sheets update by admin" on public.decor_sheets
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "decor sheets delete by admin" on public.decor_sheets;
create policy "decor sheets delete by admin" on public.decor_sheets
  for delete using (public.is_admin());
