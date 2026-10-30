-- ByteGrounds live building (Phase 2). Run after admin.sql: Supabase dashboard → SQL Editor →
-- New query → paste → Run. Safe to re-run (and re-run admin.sql first whenever schema.sql is re-run).
--
-- Live edits are an append-only, ordered log: clients insert small edit ops into map_edits (RLS
-- on insert is the one permission check), every client receives the rows through Realtime and
-- applies them in id order with the same code the map editor uses. Stored state of a room =
-- maps.data + the map_edits rows with id > maps.edit_seq. Editors save and delete maps through
-- bake_map / delete_map, which write a 'reset' op so every room client reloads.

-- ---------- Part 1: log table and validation ----------

alter table public.maps add column if not exists edit_seq bigint not null default 0;

-- An integer JSON number in [lo, hi].
create or replace function public.edit_int(v jsonb, lo numeric, hi numeric) returns boolean
  language plpgsql immutable set search_path = public
as $$
declare n numeric;
begin
  if v is null or jsonb_typeof(v) <> 'number' then
    return false;
  end if;
  n := (v #>> '{}')::numeric;
  return n = trunc(n) and n between lo and hi;
end
$$;

-- Whether a jsonb object has exactly these keys.
create or replace function public.edit_keys(op jsonb, allowed text[]) returns boolean
  language sql immutable set search_path = public
as $$
  select (select count(*) from jsonb_object_keys(op)) = cardinality(allowed)
     and not exists (select 1 from jsonb_object_keys(op) k where k <> all (allowed));
$$;

-- Shape and ranges of an edit op; mirrored one-for-one by parseEditOp in client/src/edit-ops.ts.
create or replace function public.valid_edit_op(op jsonb) returns boolean
  language plpgsql immutable set search_path = public
as $$
begin
  if op is null or jsonb_typeof(op) <> 'object' or length(op::text) > 2048
     or jsonb_typeof(op->'kind') is distinct from 'string' then
    return false;
  end if;
  case op->>'kind'
    when 'place' then
      return public.edit_keys(op, array['kind','x','y','sheet','sx','sy','w','h','mode','rot','flipX'])
        and public.edit_int(op->'x', 0, 79) and public.edit_int(op->'y', 0, 79)
        and jsonb_typeof(op->'sheet') = 'string' and (op->>'sheet') ~ '^[a-z0-9_-]{1,48}$'
        and public.edit_int(op->'sx', 0, 63) and public.edit_int(op->'sy', 0, 63)
        and public.edit_int(op->'w', 1, 8) and public.edit_int(op->'h', 1, 8)
        and jsonb_typeof(op->'mode') = 'string' and (op->>'mode') in ('none', 'base', 'all')
        and public.edit_int(op->'rot', 0, 270) and (op->>'rot')::numeric in (0, 90, 180, 270)
        and jsonb_typeof(op->'flipX') = 'boolean';
    when 'remove' then
      return public.edit_keys(op, array['kind','target','place'])
        and public.edit_int(op->'target', 1, 9223372036854775807)
        and jsonb_typeof(op->'place') = 'object' and op->'place'->>'kind' = 'place'
        and public.valid_edit_op(op->'place');
    when 'erase' then
      return public.edit_keys(op, array['kind','x','y'])
        and public.edit_int(op->'x', 0, 79) and public.edit_int(op->'y', 0, 79);
    when 'tile' then
      return public.edit_keys(op, array['kind','x','y','blocked'])
        and public.edit_int(op->'x', 0, 79) and public.edit_int(op->'y', 0, 79)
        and jsonb_typeof(op->'blocked') = 'boolean';
    when 'reset' then
      return public.edit_keys(op, array['kind']);
    else
      return false;
  end case;
end
$$;

grant execute on function public.edit_int(jsonb, numeric, numeric), public.edit_keys(jsonb, text[]),
  public.valid_edit_op(jsonb) to anon, authenticated;

create table if not exists public.map_edits (
  id bigserial primary key,
  map_id text not null,
  author uuid not null default auth.uid() references auth.users on delete cascade,
  op jsonb not null check (public.valid_edit_op(op)),
  created_at timestamptz not null default now()
);

create index if not exists map_edits_map_id_id on public.map_edits (map_id, id);
create index if not exists map_edits_author_created on public.map_edits (author, created_at);

alter table public.map_edits enable row level security;

drop policy if exists "map edits readable" on public.map_edits;
create policy "map edits readable" on public.map_edits
  for select to anon, authenticated using (true);

grant select on public.map_edits to anon, authenticated;

-- Every client receives inserted edits (postgres_changes on map_edits).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'map_edits'
     ) then
    alter publication supabase_realtime add table public.map_edits;
  end if;
end
$$;

-- ---------- Part 2: authorization, ordering, rate limit, RPCs ----------

-- Who may insert an op (the insert policy). 'reset' only comes from bake_map / delete_map, which
-- run as the table owner and so skip this policy. A 'remove' must carry an exact copy of a
-- placement its author made (or the admin), so every client can trust the embedded copy.
create or replace function public.can_apply_edit(p_map text, p_op jsonb) returns boolean
  language plpgsql stable security definer set search_path = public
as $$
begin
  case p_op->>'kind'
    when 'place' then
      return public.can_build();
    when 'remove' then
      if not public.can_build() or coalesce(p_op->>'target', '') !~ '^[0-9]{1,18}$' then
        return false;
      end if;
      return exists (
        select 1 from public.map_edits e
        where e.id = (p_op->>'target')::bigint and e.map_id = p_map and e.op->>'kind' = 'place'
          and e.op = p_op->'place' and (e.author = auth.uid() or public.is_admin())
      );
    when 'erase', 'tile' then
      return public.is_admin();
    else
      return false;
  end case;
end
$$;

grant execute on function public.can_apply_edit(text, jsonb) to anon, authenticated;

drop policy if exists "map edits insert by builders" on public.map_edits;
create policy "map edits insert by builders" on public.map_edits
  for insert to authenticated
  with check (author = auth.uid() and public.can_apply_edit(map_id, op));

drop policy if exists "map edits delete by admin" on public.map_edits;
create policy "map edits delete by admin" on public.map_edits
  for delete to authenticated using (public.is_admin());

grant insert, delete on public.map_edits to authenticated;
grant usage on sequence public.map_edits_id_seq to authenticated;

-- A placement can be undone once: a second 'remove' of the same target fails with 23505.
create unique index if not exists map_edits_remove_target
  on public.map_edits (map_id, ((op->>'target')::bigint)) where op->>'kind' = 'remove';

-- Ids are drawn after a shared per-map lock, so no edit can get an id below the 'reset' of an
-- editor save running concurrently (bake_map takes the same lock exclusively). Then: at most 20
-- edits per 10 s per person, and at most 2000 unbaked edits per room, except for the admin.
create or replace function public.map_edits_before_insert() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  baked bigint;
begin
  perform pg_advisory_xact_lock_shared(hashtext('map:' || new.map_id));
  new.id := nextval(pg_get_serial_sequence('public.map_edits', 'id'));
  if new.op->>'kind' is distinct from 'reset' and not public.is_admin() then
    if (select count(*) from public.map_edits
        where author = new.author and created_at > now() - interval '10 seconds') >= 20 then
      raise exception 'rate limit' using errcode = 'P0001';
    end if;
    baked := coalesce((select edit_seq from public.maps where id = new.map_id), 0);
    if (select count(*) from (
          select 1 from public.map_edits where map_id = new.map_id and id > baked limit 2001
        ) unbaked) > 2000 then
      raise exception 'edit cap' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists map_edits_before_insert on public.map_edits;
create trigger map_edits_before_insert before insert on public.map_edits
  for each row execute function public.map_edits_before_insert();

-- Store a whole map. Live baking (p_reset false): fold the log up to p_upto into maps.data;
-- only ever moves edit_seq forward, so concurrent bakers are harmless. Editor save (p_reset
-- true): refuse with 'stale' when there are edits after p_expect (the editor merges them and
-- retries; p_expect null = overwrite), else write a 'reset' op and the map. Returns the new seq.
create or replace function public.bake_map(p_map text, p_name text, p_data jsonb, p_upto bigint,
  p_reset boolean default false, p_expect bigint default null) returns bigint
  language plpgsql security definer set search_path = public
as $$
declare
  seq bigint;
begin
  if not public.can_edit_maps() then
    raise exception 'map editor permission required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('map:' || p_map));
  if p_reset and p_expect is not null
     and exists (select 1 from public.map_edits where map_id = p_map and id > p_expect) then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  if p_reset then
    insert into public.map_edits (map_id, author, op)
    values (p_map, auth.uid(), '{"kind":"reset"}'::jsonb)
    returning id into seq;
  else
    seq := p_upto;
  end if;
  insert into public.maps as m (id, name, data, edit_seq, updated_at)
  values (p_map, p_name, p_data, seq, now())
  on conflict (id) do update
    set name = excluded.name, data = excluded.data, edit_seq = excluded.edit_seq,
        updated_at = excluded.updated_at
    where p_reset or m.edit_seq < excluded.edit_seq;
  return seq;
end
$$;

-- Delete a map for everyone: its log, its row and its saved player spots; room clients get a
-- 'reset' and reload (the built-in map with that id, or nothing). Returns the reset's id.
create or replace function public.delete_map(p_map text) returns bigint
  language plpgsql security definer set search_path = public
as $$
declare
  seq bigint;
begin
  if not public.can_edit_maps() then
    raise exception 'map editor permission required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('map:' || p_map));
  delete from public.map_edits where map_id = p_map;
  delete from public.maps where id = p_map;
  delete from public.player_positions where map_id = p_map;
  insert into public.map_edits (map_id, author, op)
  values (p_map, auth.uid(), '{"kind":"reset"}'::jsonb)
  returning id into seq;
  return seq;
end
$$;

revoke execute on function public.bake_map(text, text, jsonb, bigint, boolean, bigint), public.delete_map(text)
  from public, anon;
grant execute on function public.bake_map(text, text, jsonb, bigint, boolean, bigint), public.delete_map(text)
  to authenticated;
