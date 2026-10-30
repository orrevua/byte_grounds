# Admin + Live Building — Spec

**Status:** Draft (rev 2: global build/editor grants, autosave, auto-seats)
**Date:** 2026-10-29
**Related:** `docs/CONTEXT.md`, `docs/HANDOFF.md`, `docs/specs/auto-seats.md`, `docs/specs/decor-rotation.md`,
`docs/specs/object-footprint.md`

## Goal
The owner signs in as **admin** with a real account. Everyone else still joins with just a name.
The admin decides who may change maps: by clicking any avatar, the admin grants or revokes two
**global** permissions per person: **build** (place/remove furniture live in the room, without leaving
it) and **editor** (open the full map editor and save/delete maps). Everyone in the room sees each live
edit, every change is **saved automatically** (live edits and editor changes alike), and **the database
rejects** writes from anyone not permitted.

## Context & Current State (verified)
- **Production transport is Supabase, not the ws server.** `vercel.json:4-5` builds only the client
  (static). `client/src/net.ts:99-103` `createNet()` returns `SupabaseNet` when `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_ANON_KEY` are set. The README says the same ("Deploy (Vercel + Supabase, no server to
  host)", `README.md:32-35`). `server/src/index.ts` is a dev-only relay with no DB and no auth.
  **Design target = Supabase.** In ws/localStorage dev mode building and the permission gate are off
  (see Scope).
- `client/src/supabase.ts:16-21`: one lazy `createClient(url, anonKey, { realtime: { worker: true } })`.
  **No auth is used anywhere today.** All requests run as role `anon`.
- `client/src/net-supabase.ts`: one Realtime channel `byte_grounds:<room>` (`:107`). Presence = roster
  (`track({...PeerState, seq})`, `:272`). Broadcast = positions (`:258`), `bye`, and addressed
  signaling. `toPeer` (`:338-341`) whitelists the `PeerState` fields. Self id is a random UUID per page
  (`:44`); it is **not** a stable identity.
- `supabase/schema.sql:24-32`: `maps` and `player_positions` have one `for all ... using (true) with
  check (true)` policy each. **Anyone with the anon key can overwrite any map today.** Any permission
  design is pointless unless this changes.
- `client/src/store.ts:44-56`: `loadMap` = saved row's `data`, else the built-in (`builtInMap`);
  `saveMap` = `upsert` of the whole row. `player_positions` keyed by lowercased name (`:22-24`).
- `client/src/main.ts:63-161` join screen (name, map select, avatar editor, `Map editor →` link).
  `join()` (`:183-206`) loads the map, then `createNet().connect(...)`, then `startGame` builds `Game`.
- `client/src/game.ts`: `Game` holds `private readonly map: OfficeMap` (`:82`), renders under a camera
  transform (`:354-360`, `camX/camY` are locals, not stored). **No pointer/click handling exists.**
  Bottom button pattern = `seatBtn` (`:103-107`). Remotes are keyed by `PeerId` (`:66`).
- `client/src/editor-model.ts`: `brushCells(x, y, sel, t, mode)` (`:44-63`), `stampDecor(m, x, y, sel,
  mode, t)` (`:71-96`, never unblocks, de-dups identical cells), `eraseDecor` (topmost cell on a tile,
  never unblocks, `:99-108`), `setBlocked` (`:23-26`), `cellBlocks` (`:35-37`), `toggleSeat`
  (`:114-126`). `BlockMode = 'none'|'base'|'all'` (`:32`).
- `client/src/editor.ts`: the decor picker (`renderDecorPicker`) is module-level and bound to editor
  globals (`selection`, `brushT`, `blockMode`). Save is **manual only**: `#save` click → `store.saveMap`
  (`:249-260`); dirtiness = `JSON.stringify(map) !== savedJson` (`:179`); every edit path ends in
  `refreshStatus()` (`:181-183`); undo = stack of full-map JSON snapshots (`:342-360`); leaving with
  unsaved changes triggers `beforeunload` (`:382-384`); switching map asks `confirmDiscard` (`:220-222`).
- **Auto-seats are being implemented now** (`docs/specs/auto-seats.md`, by a concurrent Implementer in
  `client/` and `shared/`). Seats are derived from decor (chairs, sofas, stools, beds) merged with
  authored seats, minus `OfficeMap.noSeats` (auto-seats D4). `Game` caches seats and exposes
  `refreshSeats()`; **contract (auto-seats D6): after applying any edit that changes `decor`, `seats` or
  `noSeats`, call `game.refreshSeats()`.** The editor Seat tool gains a "No seat" override
  (`toggleNoSeat`, auto-seats D7). This spec therefore needs **no manual seat tool**: placing a chair
  live creates its seat on every client. A live "seat override" op is optional (P3-U2).
- `client/src/movement.ts:36-37`: a step into a non-walkable tile is refused; an avatar standing **inside**
  a tile that becomes blocked cannot move at all. Live building can block a tile under someone (P2-U10).
- `@supabase/supabase-js ^2.118.0` (`client/package.json:14`) supports `auth.signInAnonymously()`,
  `auth.signInWithPassword()`, `rpc()`, and `postgres_changes` subscriptions.

## Proposed Design

### D1. Identity: Supabase Auth for everyone, invisible for guests
- **Admin** signs in with **email + password** (`auth.signInWithPassword`). Chosen over magic link: no
  redirect URL / Site URL setup, works on any device, and the admin is one person.
- **Guests** get a Supabase **anonymous sign-in** (`auth.signInAnonymously()`), done silently. No
  email, no password, no UI: they still only type a name. supabase-js keeps the session in localStorage
  (`sb-<ref>-auth-token`) and refreshes it, so the guest keeps the same `auth.uid()` across reloads and
  across pages (Play and `/editor`) **on that browser**.
- **Why not a random guest id in localStorage?** The database cannot verify it. Presence is public, so
  anyone could copy a permitted guest's id and claim it. An anonymous session is a signed JWT, so
  `auth.uid()` in RLS is proof.
- **Admin role is server-side only:** table `public.admins(user_id)` and `public.is_admin()`. Rows are
  added only from the Supabase dashboard (no write policy). The client asks RPCs only to decide which UI
  to show; every write is checked again in Postgres.
- **How others learn who is who:** presence/`PeerState` gains `uid?: string`. It is a **claim**, not
  proof: a guest could put someone else's uid in its presence; the admin would then grant the *real
  owner* of that uid, never the impostor. Harmless for permissions; cosmetic badges are equally
  spoofable (documented).
- Guest trade-offs (accepted): clearing site data, a private window, or a new device = a new uid =
  permissions lost; the admin grants again. Names are not identity: a second "Bob" does **not** inherit
  Bob's grants. The avatar menu shows a short id (`#a1b2`, first 4 hex of the uid) to tell two Bobs
  apart; the editor's "No permission" screen shows the same short id.
- Sign-out of admin: `auth.signOut()`; the next `ensureSession()` creates a fresh anonymous session.

### D2. Permissions: two global grants
- Table `public.grants(user_id uuid references auth.users on delete cascade, perm text not null check
  (perm in ('build','editor')), granted_at timestamptz not null default now(), primary key (user_id,
  perm))`. **Global:** one row per person per permission, valid in every room.
- Helpers (`stable security definer`, `search_path = public`, execute to `anon, authenticated`):
  - `can_build()` = `is_admin() or exists (grant (auth.uid(), 'build'))`
  - `can_edit_maps()` = `is_admin() or exists (grant (auth.uid(), 'editor'))`
  The admin always has both, with no rows. The two are independent: `editor` does not imply `build`
  and vice versa (the menu has two toggles).
- RLS on `grants`: `select` to `anon, authenticated` (true); `insert`/`delete` only `is_admin()`; no
  update.
- **What each permission unlocks (all enforced in Postgres):**

| Action | build | editor | admin |
|---|---|---|---|
| Live `place`, and `remove` of **own** placements | yes | no | yes (remove any) |
| Live `erase` (any decor cell), `tile` (block/unblock) | no | no | yes |
| Open `/editor`, Save (autosave) / Delete maps, `bake_map`, `delete_map`, direct `maps` writes | no | yes | yes |
| Grant / revoke | no | no | yes |

- Live propagation: `grants` is added to the `supabase_realtime` publication. Clients subscribe with
  `postgres_changes` on `grants`, `INSERT` and `DELETE`, **unfiltered** (global). `DELETE` payloads
  carry `old.user_id` and `old.perm` (both are primary-key columns, so they are present without
  `replica identity full`). On every (re)subscribe the client re-reads the whole table (it is tiny).
- The editor page does **not** subscribe: it checks `can_edit_maps()` at load; a revoke mid-session is
  caught by RLS on the next autosave (D6).

### D3. Live edits as an append-only, ordered log in Postgres
Chosen over (a) broadcasting edits on the existing Realtime channel and (b) applying edits in SQL:
- (a) Broadcast cannot be authorized per sender on the public channel. Rejected.
- (b) Porting `stampDecor`/transforms to plpgsql duplicates subtle logic. Rejected.
- **Chosen:** clients `insert` small **edit ops** into `public.map_edits`. **RLS on insert is the single
  enforcement point**, and a `check` constraint validates shape and ranges. Every client receives
  inserted rows via `postgres_changes` and applies them with the **same pure TS functions the editor
  uses**. The op is a *command* (anchor + selection + mode + transform), not a list of cells.
- **Ordering:** total order = `map_edits.id`. Clients apply in id order; a row arriving with an id lower
  than one already applied triggers a rebuild (base map + all ops sorted). Every client converges.
- **Conflicts:** two places on the same tile both apply in id order. A place whose blocking cells land on
  an already blocked tile is a deterministic **no-op** (ghost shows red). A second undo of the same
  placement fails a unique index.

#### Edit ops (JSON in `map_edits.op`)
| kind | shape | who may insert |
|---|---|---|
| `place` | `{kind, x, y, sheet, sx, sy, w, h, mode, rot, flipX}` | `can_build()` |
| `remove` | `{kind, target, place}`: undo of edit `target`; `place` = exact copy of that edit's `op` | `can_build()` **and** (author of `target` **or** admin) |
| `erase` | `{kind, x, y}`: remove the topmost decor cell on the tile | admin |
| `tile` | `{kind, x, y, blocked}`: block / unblock one tile | admin |
| `reset` | `{kind}`: the stored map was replaced (editor save / delete); clients reload | only inside `bake_map` / `delete_map` |
| `seat` (P3-U2, optional) | `{kind, x, y, seatKind: 'sit'\|'lie'\|'none', dir}` | `can_build()` |

Field rules (identical in SQL `valid_edit_op` and TS `parseEditOp`): `x, y` integers `0..79`
(`MAX_MAP_SIZE - 1`, `shared/src/map.ts:57`); `sheet` matches `^[a-z0-9_-]{1,48}$`; `sx, sy` integers
`0..63`; `w, h` integers `1..8`; `mode` in `none|base|all`; `rot` in `0|90|180|270`; `flipX` boolean;
`target` positive integer; whole op `<= 2048` bytes as text. No other keys. (`seat` fields are added
with P3-U2 only.)

#### Applying an op (pure, in TS; same result on every client)
- `place`: `cells = brushCells(x, y, sel, {rot, flipX}, mode)`. If `knownSheet(sheet)` is false
  (`decorImage(sheet) === null`) → no-op. If any in-bounds cell with `cellBlocks(cell, mode)` sits on an
  already blocked tile → no-op. Else `stampDecor(map, x, y, sel, mode, t)`.
- `remove`: recompute `cells` from `op.place`. Remove, for each cell, the **topmost** matching decor cell
  (same `x, y, sheet, sx, sy`). Then for each tile the place blocked, unblock it **unless** another
  remaining decor cell on that tile is `layer: 'object'` with `(baseDy ?? 0) === 0`. The op carries its
  own `place` copy, so it needs no lookup.
- `erase`: `eraseDecor(map, x, y)` (does not unblock). `tile`: `setBlocked(map, x, y, blocked)`.
  Both are no-ops when `x, y` is outside the map (the editor may have resized it, D6).
- `reset`: no-op during replay; received live → full reload (D4).
- **Seats:** decor changes move derived seats. The game calls `game.refreshSeats()` after every batch of
  applied ops, every rebuild and every reset reload (auto-seats D6; it stands a player up whose seat
  vanished). Called on every change rather than per kind: it is O(decor) and keeps the rule simple.

### D4. Persistence (autosave) of live edits, late joiners, baking
- **Every placement and removal is saved the moment it is accepted.** The log *is* the persistence: the
  insert commits durably before anyone (including the sender) sees it. There is no Save step and no
  client debounce. A refresh or a late joiner loads `maps.data` + the unbaked log, so it sees every
  accepted edit.
- `maps` gains `edit_seq bigint not null default 0`: the highest `map_edits.id` already folded into
  `maps.data`. A built-in map with no row has seq 0. **Stored state = `maps.data` + ops with
  `id > edit_seq`**; that pair is always current.
- **Join / load (`LiveMap.start`)**: (1) subscribe to `postgres_changes` INSERT on `map_edits`
  `filter: map_id=eq.<room>` and **buffer**; (2) on `SUBSCRIBED`, load `{data, edit_seq}` (built-in when
  no row); (3) fetch `map_edits where map_id = room and id > edit_seq order by id` in pages of 1000
  (`.range()`); (4) apply them, then the buffer (skip applied ids). On a later `SUBSCRIBED` repeat step
  3 from the last applied id.
- **Baking (compaction) keeps `maps.data` itself current** and bounds replay cost. Any client in the
  room whose user has `can_edit_maps()` (admin, or an `editor` grant) bakes after **5 s without new
  edits + 0-3 s random jitter** when **>= 50** unbaked ops are applied:
  `rpc('bake_map', {p_map, p_name, p_data: currentMap, p_upto: lastAppliedId})`. Several bakers at once
  are harmless (the upsert only moves `edit_seq` forward). **Builders do not bake**: `p_data` is a whole
  map, so letting builders bake would hand them editor power. Baking changes nobody's state, so no event
  is needed. Log rows are kept (tiny; `remove` checks read them); only `delete_map` deletes them.
- **Cap without a baker around:** non-admin inserts are refused when the room has more than **2000**
  unbaked ops ("Too many unsaved edits: ask the admin or a map editor to drop by").
- **Own edits:** no optimistic mutation. The sender draws a pending ghost (alpha 0.6) until its row comes
  back (matched by the id from `insert(...).select('id')`), or drops it and shows the error.

### D5. Enforcement: exactly where
All in Postgres: `supabase/admin.sql` (Phase 1) and `supabase/live-edits.sql` (Phase 2). Client checks
are UX only.
- `maps`: `select` to all; `insert`/`update`/`delete` only `can_edit_maps()` (Phase 1: the editor still
  upserts directly). From Phase 2 the client writes through `bake_map` / `delete_map` (`security
  definer`, first statement checks `can_edit_maps()`, raise `42501` otherwise).
- `map_edits`: insert policy `with check (author = auth.uid() and public.can_apply_edit(map_id, op))`;
  table `check (public.valid_edit_op(op))`. `select` to all. No `update`. `delete` only `is_admin()`.
- `can_apply_edit(p_map, p_op)` (`stable security definer`, `search_path = public`):
  - `reset` → false (reset only comes from the RPCs, which run as definer and bypass the policy).
  - `place` → `can_build()`.
  - `remove` → `can_build()` **and** `exists (select 1 from map_edits e where e.id = target and
    e.map_id = p_map and e.op->>'kind' = 'place' and e.op = p_op->'place' and (e.author = auth.uid() or
    is_admin()))`. The copy check applies to the admin too, so every client can trust the embedded copy.
  - `erase`, `tile` → `is_admin()`. Anything else → false.
- Unique index `(map_id, ((op->>'target')::bigint)) where op->>'kind' = 'remove'`; a second attempt
  fails `23505`, which the client ignores.
- **`before insert` trigger `map_edits_before_insert`** (one function, in this order):
  1. `perform pg_advisory_xact_lock_shared(hashtext('map:' || new.map_id))`, then
     `new.id := nextval(pg_get_serial_sequence('public.map_edits', 'id'))`. Ids are thus drawn *after*
     the lock, so no edit can get an id below a concurrent editor save's `reset` (D6).
  2. Unless `is_admin()` or `new.op->>'kind' = 'reset'`: reject (`P0001`, message `rate limit`) when the
     author has >= 20 rows in the last 10 s; reject (`P0001`, message `edit cap`) when the room has > 2000
     rows with `id > maps.edit_seq`.
  Indexes `(author, created_at)` and `(map_id, id)`.
- `author uuid not null default auth.uid()`; RLS requires it to equal `auth.uid()`.

### D6. Map editor: permission gate and autosave
- **Gate:** when `hasSupabase`, the editor page shows a full-screen overlay "Checking permission…",
  runs `ensureSession()` then `checkCanEditMaps()`. Allowed → overlay removed, editor works. Not allowed
  (or no session) → overlay becomes **"No permission"**: "You can't edit maps. Ask the admin to allow the
  map editor for you (your id: #a1b2), then reload. The admin signs in on the Play page." + a
  "← Back to Play" link. Autosave is never armed while the overlay is up. Without Supabase (local dev)
  the editor works as today (LocalStore).
- **Autosave replaces manual-only Save.** Pure scheduler `client/src/autosave.ts`:
  - every editor change (the existing `refreshStatus()` call sites, i.e. paint, stamp, erase, seat,
    resize, rename, undo) calls `autosave.changed()`; when `isDirty()` it (re)starts a **1500 ms**
    debounce;
  - one save in flight at a time; a change during a save marks it to run again right after;
  - **flush immediately** on `visibilitychange` → `hidden` and `pagehide` (best effort: the request may
    not finish if the tab is killed); `beforeunload` still warns while dirty or saving;
  - manual **Save** button kept as a fallback = `flush()`; switching map / New map first `await flush()`
    and only asks `confirmDiscard` if that save failed;
  - status line (reuses `#status`): "Unsaved changes" (debouncing) → "Saving…" → "Saved · id "x"";
    failure → "Save failed — Retry" (clickable = `flush()`); automatic retry after 15 s and on the next
    change. A `42501` failure shows "Save failed: you no longer have editor permission" and stops
    automatic retries.
  - Delete stays manual with its confirm.
  - Note: with autosave, a change to a built-in map creates its saved row right away (as a manual Save
    did); opening a map without changing it saves nothing.
- **Phase 1 save path:** `store.saveMap(map)` (direct upsert, now RLS-gated). Two editors on one map =
  last write wins, as today; there are no live edits yet.
- **Phase 2 save path and conflicts with live edits: merge, then save atomically.** Decision: **merge**
  (not warn). Live builders keep working while someone has the editor open; silently overwriting them
  (or nagging on every autosave) is worse than folding their edits in. The editor remembers `loadedSeq`
  (`edit_seq` it loaded, then the seq returned by each save). Each save:
  1. fetch `map_edits where map_id = map.id and id > loadedSeq order by id` (paged);
  2. if any of them is a `reset` → **conflict** (another editor saved or deleted this map): stop
     autosave, status "This map was changed in another editor — Reload | Overwrite". Reload = reopen the
     map (local unsaved changes lost, confirmed). Overwrite = save with `p_expect = null`;
  3. else apply the ops with `applyEdit` on top of the editor's map **and on every undo snapshot** (so
     Ctrl+Z never reverts a builder's edit), redraw, `loadDecorSheets` for new sheets;
  4. `rpc('bake_map', {p_map, p_name, p_data: map, p_upto: 0, p_reset: true, p_expect: highestFetchedId
     ?? loadedSeq})`. Inside, under `pg_advisory_xact_lock(hashtext('map:' || p_map))`, it raises
     `P0001 'stale'` if any `map_edits` row for the map has `id > p_expect`; otherwise inserts `reset`
     and writes `maps`. The lock + id-after-lock trigger (D5) make the check exact;
  5. on `stale`: repeat from 1 (max 3 times, then show "Save failed — Retry").
  The resulting `reset` makes every room client reload the saved map, which already contains the merged
  live edits. Live ops merged onto a resized editor map follow the same in-bounds rules (D3).
- Editor Delete (Phase 2): `rpc('delete_map', {p_map})`; room clients get a `reset` and reload (built-in
  or empty).

## Scope
- **In scope:** admin email+password login; silent anonymous sessions for guests; `admins`, `grants`,
  `map_edits` tables + RLS + RPCs; global `build` and `editor` permissions granted from the admin avatar
  menu; locking `maps` writes to admin/editor; editor permission gate; editor autosave with live-edit
  merge; live build mode (decor picker reused, whole-object click, R/F/V transforms, BlockMode, ghost);
  per-user undo of own placement; admin erase / block / unblock; baking by admin or editor clients;
  `refreshSeats()` after live edits; movement escape from a newly blocked tile.
- **Out of scope (explicitly):** building and the permission gate in ws/localStorage dev mode (no auth;
  the Build button, admin link and gate are inactive when `hasSupabase` is false,
  `client/src/supabase.ts:7`); securing the Realtime broadcast channel (positions/signaling stay
  spoofable; private channels are a future item); painting floor colors, resizing, spawn moves in live
  mode (editor only); per-room grants; multiple-admins management UI (more admins = more SQL rows);
  live editor co-editing (two editors merge only through `reset` conflicts).

## Interfaces / Models / Endpoints

### SQL (Supabase)
`supabase/admin.sql` (Phase 1, idempotent, run after `schema.sql`):
```
admins(user_id uuid primary key references auth.users on delete cascade)
  RLS: select to anon, authenticated using (true); no write policies.
grants(user_id uuid not null references auth.users on delete cascade,
       perm text not null check (perm in ('build','editor')),
       granted_at timestamptz not null default now(), primary key (user_id, perm))
  RLS: select to anon, authenticated (true); insert/delete to authenticated with is_admin().
functions (stable, security definer, set search_path = public; grant execute to anon, authenticated):
  is_admin() returns boolean; can_build() returns boolean; can_edit_maps() returns boolean
maps policies: drop "maps open to anon"; create select (true) to anon, authenticated;
               insert/update/delete to authenticated with can_edit_maps().
publication supabase_realtime: add grants (guarded with a DO block on pg_publication_tables).
```
`supabase/live-edits.sql` (Phase 2, idempotent):
```
alter table maps add column if not exists edit_seq bigint not null default 0;
map_edits(id bigserial primary key, map_id text not null,
          author uuid not null default auth.uid() references auth.users on delete cascade,
          op jsonb not null check (valid_edit_op(op)), created_at timestamptz not null default now())
functions: valid_edit_op(jsonb) immutable; can_apply_edit(text, jsonb);
           map_edits_before_insert() trigger fn (lock + id + rate limit + cap, D5);
           bake_map(p_map text, p_name text, p_data jsonb, p_upto bigint,
                    p_reset boolean default false, p_expect bigint default null) returns bigint;
           delete_map(p_map text) returns bigint
indexes: (map_id, id); (author, created_at); unique remove-target partial index
publication supabase_realtime: add map_edits (guarded).
```
`bake_map` contract: `can_edit_maps()` else `42501` → `pg_advisory_xact_lock(hashtext('map:'||p_map))`
→ if `p_reset and p_expect is not null and exists (map_edits where map_id = p_map and id > p_expect)`
raise `P0001 'stale'` → if `p_reset` insert `{"kind":"reset"}` (author = caller) and seq = its id, else
seq = `p_upto` → `insert into maps(id, name, data, edit_seq, updated_at) ... on conflict (id) do update
... where p_reset or maps.edit_seq < excluded.edit_seq` → return seq.
`delete_map` contract: `can_edit_maps()` else `42501` → same lock → delete the map's `map_edits`, the
`maps` row, its `player_positions` → insert reset → return its id.

### Client modules
```ts
// client/src/auth.ts (new)
export function shortId(uid: string): string;                       // '#' + first 4 hex chars
export async function ensureSession(db?: SupabaseClient): Promise<string | null>; // uid; anon sign-in if none; null if !hasSupabase or error
export async function signInAdmin(email: string, password: string): Promise<void>; // throws on bad login
export async function signOutAdmin(): Promise<void>;
export async function checkIsAdmin(db?: SupabaseClient): Promise<boolean>;      // rpc('is_admin'); false on error
export async function checkCanEditMaps(db?: SupabaseClient): Promise<boolean>;  // rpc('can_edit_maps'); false on error
export async function adminEmail(): Promise<string | null>;         // non-anonymous session email, else null

// shared/src/protocol.ts (changed)
JoinMsg.uid?: string;  PeerState.uid?: string;   // Supabase auth uid; optional (ws dev mode has none)

// client/src/grants.ts (new)
export type Perm = 'build' | 'editor';
export type GrantChange = { type: 'INSERT' | 'DELETE'; userId: string; perm: Perm };
export function grantKey(uid: string, perm: Perm): string;          // `${uid}:${perm}`
export function applyGrantChange(set: Set<string>, c: GrantChange): boolean; // pure; true if changed
export class GrantsFeed {
  start(): Promise<void>; stop(): void;                             // channel 'byte_grounds-grants'
  has(uid: string | undefined, perm: Perm): boolean;
  onChange(cb: () => void): void;
  grant(uid: string, perm: Perm): Promise<void>; revoke(uid: string, perm: Perm): Promise<void>; // throw on RLS error
  // P3-U3: list(): { userId: string; perms: Perm[] }[]; revokeAll(uid?: string): Promise<void>;
}

// client/src/hit.ts (new, pure)
export function screenToWorld(cx: number, cy: number, scale: number, camX: number, camY: number): { px: number; py: number };
export function avatarAt<T extends { x: number; y: number }>(avs: Iterable<[string, T]>, px: number, py: number): string | null;
  // hit box per avatar: |px - x*32| <= 14 and y*32 - 56 <= py <= y*32 + 6; nearest feet wins

// client/src/autosave.ts (new, pure; timers injectable for tests)
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'failed' | 'denied';
export interface AutosaveOpts { delayMs: number; retryMs: number; isDirty(): boolean;
  save(): Promise<void>; onStatus(s: SaveStatus, err?: unknown): void;
  isDenied?(err: unknown): boolean; }                               // true → 'denied', no auto-retry
export function createAutosave(o: AutosaveOpts): { changed(): void; flush(): Promise<boolean>; dispose(): void };
  // flush resolves true when the map is clean afterwards

// client/src/edit-ops.ts (new, pure)
export type PlaceOp = { kind: 'place'; x: number; y: number; sheet: string; sx: number; sy: number;
                        w: number; h: number; mode: BlockMode; rot: Rotation; flipX: boolean };
export type EditOp = PlaceOp
  | { kind: 'remove'; target: number; place: PlaceOp }
  | { kind: 'erase'; x: number; y: number }
  | { kind: 'tile'; x: number; y: number; blocked: boolean }
  | { kind: 'reset' };                                // P3-U2 may add 'seat'
export interface MapEdit { id: number; author: string; op: EditOp }
export function parseEditOp(v: unknown): EditOp | null;     // mirror of SQL valid_edit_op
export function placeOp(x: number, y: number, sel: DecorSelection, mode: BlockMode, t: DecorTransform): PlaceOp;

// client/src/live-model.ts (new, pure)
export function applyEdit(m: OfficeMap, op: EditOp, knownSheet: (s: string) => boolean): boolean; // true if changed
export class EditLog {
  constructor(base: OfficeMap, baseSeq: number, knownSheet: (s: string) => boolean);
  readonly map: OfficeMap; readonly lastId: number; readonly unbaked: number;
  add(e: MapEdit): 'applied' | 'rebuilt' | 'duplicate';
  lastOwnPlacement(uid: string): MapEdit | null;
  placementAt(x: number, y: number): MapEdit | null;
}
export function replaceMapContents(target: OfficeMap, source: OfficeMap): void;
export type MergeResult = { merged: number; lastId: number; conflict: boolean }; // conflict = a reset was seen
export function mergeLiveEdits(map: OfficeMap, snapshots: string[], edits: MapEdit[],
  knownSheet: (s: string) => boolean): MergeResult;   // applies in id order to map + each JSON snapshot (rewritten in place); stops at a reset

// client/src/store.ts (changed)
Store.loadMapState(id: string): Promise<{ map: OfficeMap | null; seq: number }>;  // loadMap delegates
Store.saveMap(map: OfficeMap, expectSeq?: number | null): Promise<number>;        // Phase 2: returns new seq; LocalStore returns 0
export class StaleSaveError extends Error {}                                       // thrown on P0001 'stale'

// client/src/live-map.ts (new)
export class LiveMap {
  constructor(target: OfficeMap, room: string, uid: string, opts: { isAdmin: boolean; canBake(): boolean });
  start(): Promise<void>; stop(): void;
  send(op: EditOp): Promise<void>; readonly pending: DecorCell[];
  undoOwn(): Promise<void>; removeAt(x: number, y: number): Promise<void>;
  onChange(cb: (resized: boolean) => void): void; onError(cb: (msg: string) => void): void;
}

// client/src/decor-picker.ts (new; moved out of editor.ts)
export interface PickerState { selection: DecorSelection | null; mode: BlockMode; t: DecorTransform }
export function mountDecorPicker(el: HTMLElement, onChange: (s: PickerState) => void): {
  state(): PickerState; setTransform(t: DecorTransform): void; };
```

## Impact Analysis
- **Breaking (intended):** after `supabase/admin.sql` runs, only the admin and `editor`-granted people
  can save/delete maps; others see "No permission" in `/editor` (today anyone can save). Required,
  otherwise anyone could bypass permissions by saving a whole map.
- **Behaviour change:** editor saves automatically (D6). Opening a map and clicking around without
  changes saves nothing; any change is saved ~1.5 s later.
- **Rollout order:** enable anonymous sign-ins and run `admin.sql` **before** deploying Phase 1. Old
  clients keep playing (reads open, `player_positions` unchanged) but their editor saves fail. Phase 2:
  run `live-edits.sql` before deploying Phase 2. `bake_map` keeps a default for every new parameter.
- **Concurrent work:** auto-seats (in progress) touches `client/src/editor.ts`, `editor-model.ts`,
  `game.ts`, `shared/src/map.ts`. P1-U8, P1-U10 and P2-U9 edit `editor.ts`; P1-U6/U7 edit `game.ts`:
  rebase on the auto-seats commits first. **Phase 2 requires auto-seats merged** (`Game.refreshSeats`).
- **Existing data:** none migrated. `edit_seq` defaults to 0; built-in maps get no row until the first
  bake or editor save.
- **Tests:** `client/test/net-supabase.test.ts` gains `uid` passthrough; new tests for `auth`
  (`shortId`, `ensureSession` with a stub client), `grants.applyGrantChange`, `hit`, `autosave` (fake
  timers), `edit-ops`, `live-model` (incl. `mergeLiveEdits`), `store.loadMapState` (LocalStore),
  `movement` escape. `editor-model` and `decor-objects` tests unchanged.
- **Layers:** `shared/protocol` (2 optional fields), client net/store/game/main/editor, new client
  modules, SQL. `server/` only copies `uid` (P1-U3).
- **Realtime quota:** edits are human-paced and rate limited (<= 2/s per user); the grants feed is one
  global channel with rare events.
- **Security:** anon key stays public by design; every protection is RLS/definer functions; `service_role`
  is never shipped. Anonymous sign-ins can be abused to mint users: Supabase rate-limits them per IP
  (Auth → Rate Limits); CAPTCHA optional. An `editor` grant is powerful (can rewrite or delete any map,
  wiping live edits through `reset`): grant it only to trusted people. Builders cannot bake. Decor
  references: the DB checks shape and ranges; an unknown sheet is a no-op on every client.
- **Failure modes:** insert rejected (no grant / revoked / rate limit / cap) → pending ghost dropped,
  toast with the reason. Realtime drop → catch-up on rejoin. Commit reordering → rebuild. Revoked while
  the build panel is open → panel closes on the grant event; in-flight inserts fail RLS. Editor revoked
  mid-session → next autosave `42501` → "no longer have editor permission". Editor save racing live edits
  → `stale` → re-merge (max 3). Two editors → `reset` conflict → Reload / Overwrite. Tab closed during
  the 1.5 s debounce → hidden/pagehide flush (best effort) plus the `beforeunload` warning.
  `ensureSession` failure → join still works, Build never offered, editor shows "No permission".
- **Performance:** replay of <= 2000 small ops is a few ms; merge into undo snapshots parses each
  snapshot once per save that has live edits (UNDO_LIMIT snapshots), acceptable for an editor.

## Implementation Units
Markers: **[M]** manual multi-browser check; **[USER]** user acts in the Supabase dashboard (see "Manual
user steps"). Run `npm test` + `npm run typecheck --workspace client` after every unit.

### Phase 1 — Admin login, global grants, editor gate, editor autosave
1. **P1-U1 SQL: admins, grants, helpers, maps lock** — files: `supabase/admin.sql` (new),
   `supabase/schema.sql` (header comment pointing to it), `README.md` (one step in the deploy list) —
   change: exactly "Interfaces → SQL → admin.sql"; idempotent (`create table if not exists`, `drop
   policy if exists` before each `create policy`, `create or replace function`, publication add guarded
   by `pg_publication_tables`). — acceptance: file reads cleanly; every statement re-runnable; perm check
   constraint allows only `build`/`editor`; no client change. **[USER]** runs it (steps 1-4).
2. **P1-U2 `auth.ts`** — files: `client/src/auth.ts` (new), `client/test/auth.test.ts` (new) — change:
   the functions in Interfaces. `ensureSession`: `getSession()`; if none, `signInAnonymously()`; return
   `session.user.id`; null + `console.warn` (never throw) on error or `!hasSupabase`. `checkIsAdmin` /
   `checkCanEditMaps`: `rpc(...)`, `data === true`, false on error. `adminEmail`: email if
   `user.is_anonymous !== true`. Optional client param, default `getSupabase()`. — acceptance: stub-client
   tests: existing session → no anon call; no session → one anon sign-in; error → null; rpc error →
   false; `shortId('a1b2c3...') === '#a1b2'`.
3. **P1-U3 `uid` in presence** — files: `shared/src/protocol.ts`, `client/src/net-supabase.ts`
   (`connect` copies `join.uid` into `self`; `toPeer` keeps `uid`), `server/src/index.ts:69-76` (copy
   `uid: msg.uid`), `client/test/net-supabase.test.ts` — acceptance: a peer with `uid` keeps it through
   `toPeer`/`peer-joined`; one without stays without.
4. **P1-U4 Join screen admin login** — files: `client/src/main.ts`, `client/index.html` (CSS) — change:
   under Join, when `hasSupabase`: link "Admin login" → inline email + password + "Sign in" + error line;
   signed in: "Admin: <email> · Sign out". On load `adminEmail()` picks the state. In `join()` before
   `createNet()`: `uid = await ensureSession()`, `isAdmin = uid ? await checkIsAdmin() : false`; pass `uid`
   to `net.connect`; `SelfInfo` gains `uid?: string; isAdmin: boolean`. — acceptance: typecheck; **[M]**
   sign in/out, wrong password error, guests unchanged apart from the link.
5. **P1-U5 `GrantsFeed` (global)** — files: `client/src/grants.ts` (new), `client/test/grants.test.ts`
   (new) — change: as Interfaces. `start()`: channel `byte_grounds-grants`, `postgres_changes` INSERT and
   DELETE on `public.grants`, no filter; map payload (`new` / `old`) to `GrantChange`, ignore unknown
   `perm`; on every `SUBSCRIBED` re-select `user_id, perm from grants` and replace the set; notify
   `onChange` when it changes. `grant` = insert `{user_id, perm}`; `revoke` = delete `eq user_id, eq
   perm`; throw the PostgREST error. — acceptance: `applyGrantChange` tests: insert adds, duplicate insert
   → false, delete removes, delete of absent → false, same uid with the other perm is independent.
6. **P1-U6 Pointer → avatar hit test** — files: `client/src/hit.ts` (new), `client/test/hit.test.ts`
   (new), `client/src/game.ts` (store `camX`, `camY`, `scale` as fields in `render()`; canvas
   `pointerdown` → `screenToWorld` → `avatarAt` over `remotes`; listener removed in `stop()`) — change:
   `Game` gets `onAvatarClick: ((id: PeerId, clientX: number, clientY: number) => void) | null`. No visible
   behaviour. — acceptance: hit tests (inside, outside, nearest of two, camera offset + CSS scale).
7. **P1-U7 Admin avatar menu (two toggles)** — files: `client/src/avatar-menu.ts` (new),
   `client/src/game.ts` (`attachGrants(feed)`; when `self.isAdmin`, `onAvatarClick` opens the menu),
   `client/src/main.ts` (after `startGame`, when `uid` is set: `new GrantsFeed()` → `start()` →
   `game.attachGrants`), `client/index.html` (CSS) — change: small box at the click point: `<name> #a1b2`,
   two toggle buttons **"Allow building"** and **"Allow map editor"**, each showing on/off from
   `feed.has(uid, perm)` and calling `grant`/`revoke`; re-renders on `feed.onChange`; closes on outside
   click / Esc. Remote without `uid` → "Can't grant: this player isn't signed in…" (anonymous sign-ins off, or an old tab). Errors inline. `RemoteAvatar`
   keeps `uid`. (Building itself arrives in Phase 2; the grant is stored now.) — acceptance: typecheck;
   **[M]** checklist P1.
8. **P1-U8 Editor permission gate** — files: `client/src/editor.ts`, `client/editor.html` (CSS for the
   overlay) — change: D6 "Gate": overlay "Checking permission…" → `ensureSession()` →
   `checkCanEditMaps()` → remove overlay, or show "No permission" with `shortId(uid)` and "← Back to
   Play"; expose a module flag `canSave` read by P1-U10. Skipped when `!hasSupabase`. — acceptance:
   **[M]** ungranted window sees "No permission" with its id; admin and an editor-granted guest get the
   editor; a forced `store.saveMap` from the console as an ungranted guest gets an RLS error.
9. **P1-U9 `autosave.ts`** — files: `client/src/autosave.ts` (new), `client/test/autosave.test.ts`
   (new) — change: `createAutosave` per Interfaces and D6 (debounce, single flight + rerun, retry timer,
   denied stops retries, `flush` bypasses the debounce). — acceptance: fake-timer tests: 3 quick changes
   → 1 save after `delayMs`; change during a save → exactly one more save; clean → no save; failure →
   `failed` then retry after `retryMs`; denied → no retry; `flush()` saves at once and resolves true.
10. **P1-U10 Editor autosave wiring** — files: `client/src/editor.ts`, `client/editor.html` (status
    style for the Retry link) — change: create the autosave (`delayMs 1500`, `retryMs 15000`, `isDirty =
    dirty`, `save` = the existing save body (`store.saveMap` → `savedJson` → `refreshMaps` →
    `replaceState`), `isDenied` = code `42501`); call `changed()` from `refreshStatus()`; status texts
    per D6; Save button → `flush()`; `visibilitychange`/`pagehide` → `flush()`; map select / New →
    `await flush()` then `confirmDiscard` only if it returned false; armed only when `canSave`
    (or `!hasSupabase`). — acceptance: **[M]** checklist P1 items 6-7.
11. **P1-U11 Phase 1 manual check** — **[M][USER]** checklist P1; Implementer records results in HANDOFF.

### Phase 2 — Live build mode, log, merge-on-save, baking (requires auto-seats merged)
12. **P2-U1 SQL part 1: log table and validation** — files: `supabase/live-edits.sql` (new) — change:
    `edit_seq` column, `valid_edit_op`, `map_edits` table + check + indexes + select policy, publication.
    — acceptance: rules match D3 one-for-one. **[USER]** runs the file after P2-U2.
13. **P2-U2 SQL part 2: authorization, trigger, RPCs** — files: `supabase/live-edits.sql` — change:
    `can_apply_edit`, insert policy, admin delete policy, unique remove index,
    `map_edits_before_insert` (lock + id + rate + cap, D5), `bake_map` (with `p_expect`/`stale`),
    `delete_map`, `grant execute ... to authenticated`. — acceptance: matches D5 and the contracts in
    Interfaces; **[USER]** runs the file (step 5).
14. **P2-U3 `edit-ops.ts`** — files: `client/src/edit-ops.ts` (new), `client/test/edit-ops.test.ts`
    (new) — change: types + `parseEditOp` + `placeOp`. — acceptance: one pass and one fail case per field
    rule; extra keys rejected.
15. **P2-U4 `applyEdit`: place / erase / tile** — files: `client/src/live-model.ts` (new),
    `client/test/live-model.test.ts` (new) — change: D3 minus `remove`; erase/tile out of bounds →
    false. — acceptance: place equals `stampDecor` output; place onto a blocked tile → false, map
    untouched; unknown sheet → false; erase/tile delegate; out-of-bounds tile → false.
16. **P2-U5 `applyEdit`: remove** — files: same — change: D3 `remove`. — acceptance: place then remove
    restores the exact prior map for `base`, `all`, `none` and a rotated piece; a tile still covered by
    another object stays blocked; removing twice is harmless.
17. **P2-U6 `EditLog` + `replaceMapContents`** — files: same — change: as Interfaces; ids `<= baseSeq`
    and duplicates ignored; out-of-order → rebuild from `structuredClone(base)`; `unbaked` = applied
    count. — acceptance: in-order vs shuffled arrival deep-equal; `lastOwnPlacement` skips removed and
    others' edits; `placementAt` finds the covering edit.
18. **P2-U7 `Store.loadMapState`** — files: `client/src/store.ts`, `client/test/store.test.ts` — change:
    Supabase selects `data, edit_seq`; LocalStore seq 0; `loadMap` delegates. — acceptance: LocalStore
    tests (saved, built-in, missing) + existing store tests green.
19. **P2-U8 `LiveMap`** — files: `client/src/live-map.ts` (new) — change: D4 join flow, catch-up on
    re-`SUBSCRIBED`, `send` with pending ghosts, live `reset` → reload + `onChange(resized)`,
    `loadDecorSheets` for new sheets, friendly messages for `42501` ("You can't build anymore"),
    `rate limit`, `edit cap`, `23505` ignored. Channel `byte_grounds-edits:<room>`. `knownSheet = (s) =>
    decorImage(s) !== null`. — acceptance: typecheck; behaviour in P2-U17 [M]. (Split "load/apply" and
    "send/pending" if > ~60 LOC.)
20. **P2-U9 Extract the decor picker** — files: `client/src/decor-picker.ts` (new), `client/src/editor.ts`
    — change: move `renderDecorPicker`, its hint, Block select and transform buttons into
    `mountDecorPicker`; editor syncs `selection`/`blockMode`/`brushT` via `onChange`, R/F/V calls
    `setTransform`. **Move-only; may exceed 50 LOC, no behaviour change.** — acceptance: typecheck +
    build; **[M]** editor picker, whole-object click, Alt+click, drag, R/F/V, Block select unchanged.
21. **P2-U10 Movement escape** — files: `client/src/movement.ts`, `client/test/movement.test.ts` —
    change: if the current tile is not walkable, allow the step. — acceptance: "inside a blocked tile,
    moving works"; wall tests unchanged.
22. **P2-U11 Build panel** — files: `client/src/build-panel.ts` (new), `client/index.html` (CSS) —
    change: right drawer (bottom sheet when narrow) with `mountDecorPicker`, "Undo my last", and for the
    admin a tool row Place / Erase / Block / Walk; R / Shift+R / F / V while open (same input guards as
    the editor's key handler). Exposes `state()`, `tool`, `onUndo`, `open/close`. — acceptance:
    typecheck; visual check in P2-U12.
23. **P2-U12 Game build mode** — files: `client/src/game.ts`, `client/src/main.ts` — change:
    `attachLive(live)`; "Build" button next to `seatBtn`, shown iff `self.isAdmin || grants.has(self.uid,
    'build')`, re-evaluated on grant changes (revoked → close panel). While open: pointer world tile,
    ghost (`brushCells`, alpha 0.6, red on blocking cells over blocked tiles), `live.pending`; click →
    Place `send(placeOp(...))`; Erase → `removeAt` if a live placement covers the tile else `erase`;
    Block/Walk → `tile`. Ctrl+Z / Undo → `undoOwn()`. Avatar menu only when the panel is closed.
    `live.onChange(resized)` → `game.refreshSeats()` always, `fitCanvas()` when resized. `main.ts`:
    create and `start()` `LiveMap` when `uid` is set, `canBake = () => isAdmin || grants.has(uid,
    'editor')`. — acceptance: **[M]** checklist P2.
24. **P2-U13 Store save/delete via RPC** — files: `client/src/store.ts`, `client/test/store.test.ts` —
    change: Supabase `saveMap(map, expectSeq)` → `rpc('bake_map', {p_map, p_name, p_data, p_upto: 0,
    p_reset: true, p_expect: expectSeq ?? null})`, returns the seq; `P0001`/`stale` → `StaleSaveError`;
    `deleteMap` → `rpc('delete_map')`; LocalStore returns 0. — acceptance: LocalStore tests green;
    typecheck.
25. **P2-U14 `mergeLiveEdits`** — files: `client/src/live-model.ts`, `client/test/live-model.test.ts` —
    change: as Interfaces (apply in id order to map and every snapshot string; stop with `conflict` at a
    `reset`). — acceptance: merged map equals applying the ops directly; snapshots get the same ops; a
    reset sets `conflict` and applies nothing after it; empty list → `merged 0`.
26. **P2-U15 Editor merge-before-save + conflict UI** — files: `client/src/editor.ts` — change: keep
    `loadedSeq` (from `loadMapState`, then each save's return); the autosave `save` runs D6 steps 1-5
    (paged fetch → `mergeLiveEdits(map, undo, ...)` → redraw → `saveMap(map, lastId)` → on
    `StaleSaveError` retry up to 3); conflict → stop autosave, status "changed in another editor —
    Reload | Overwrite"; Delete uses `deleteMap`. — acceptance: **[M]** checklist P2 items 11-13.
27. **P2-U16 Live auto-bake** — files: `client/src/live-map.ts` — change: when `canBake()`: after each
    applied op restart a 5 s + `random()*3` s timer; on fire, if `unbaked >= 50`,
    `rpc('bake_map', {..., p_upto: lastId, p_reset: false})`; errors logged only. — acceptance: **[M]**
    checklist P2 item 10.
28. **P2-U17 Phase 2 manual check** — **[M][USER]** checklist P2.

### Phase 3 — Polish
29. **P3-U1 Badges** — `game.ts` name pass: hammer after names with a `build` grant, pencil after
    `editor`, crown after admins (admins list read once at join). Cosmetic. [M]
30. **P3-U2 Seat override op (optional)** — `seat` op `{x, y, seatKind: 'sit'|'lie'|'none', dir}`:
    `none` → `toggleNoSeat`, else `toggleSeat` (auto-seats D7); add to `valid_edit_op`, `can_apply_edit`
    (`can_build()`), `parseEditOp`, `applyEdit`; Seat tool in the build panel. Only if the user asks; the
    derived seats already cover live-placed chairs. [M]
31. **P3-U3 Permissions list** — admin section in the build panel: everyone with any grant (online or
    not: short id, name if online, a build and an editor toggle), per-row "Revoke all" and a global
    "Revoke everyone" (confirm). Adds `GrantsFeed.list()` / `revokeAll(uid?)` (delete by `user_id`, or
    `in('perm', ['build','editor'])` for everyone). [M]
32. **P3-U4 Feedback** — toasts for rejected edits and for "You can build now" / "Building turned off" /
    "You can use the map editor now" when your own grants change. [M]

## Manual user steps (exact)
Supabase dashboard of the production project.
1. **Enable anonymous sign-ins** (before deploying Phase 1): Authentication → Sign In / Providers
   (older dashboards: Authentication → Providers / Settings) → turn on **Allow anonymous sign-ins** →
   Save. Optional: Authentication → Rate Limits → keep "anonymous sign-ins per hour" low (default 30/IP).
2. **Create the admin user:** Authentication → Users → **Add user → Create new user** → your email and a
   strong password → tick **Auto Confirm User** → Create.
3. **Run Phase 1 SQL:** SQL Editor → New query → paste `supabase/admin.sql` → Run (after `schema.sql`).
4. **Make yourself admin:** SQL Editor → run
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = '<your-admin-email>'
   on conflict do nothing;
   select * from public.admins;  -- expect one row
   ```
5. **Phase 2 SQL** (when Phase 2 ships): SQL Editor → paste `supabase/live-edits.sql` → Run.
6. **Verify Realtime publication:** Database → Publications → `supabase_realtime` lists `grants` (Phase
   1) and `map_edits` (Phase 2). If not:
   ```sql
   alter publication supabase_realtime add table public.grants;     -- Phase 1
   alter publication supabase_realtime add table public.map_edits;  -- Phase 2
   ```
7. **Redeploy on Vercel** after each phase (no new env vars). For local testing put the two Supabase vars
   in `client/.env.local` (ws-only dev mode disables building and the gate).
8. **Useful SQL (optional):**
   ```sql
   select g.user_id, g.perm, g.granted_at from public.grants g order by g.granted_at;  -- who has what
   delete from public.grants where user_id = '<uid>';                                  -- revoke one person
   delete from public.grants;                                                          -- revoke everyone
   ```
   Granting is normally done from the avatar menu; the SQL editor runs as `postgres`, so a manual
   `insert into public.grants (user_id, perm) values ('<uid>', 'editor') on conflict do nothing;` also works.
9. Optional cleanup later: anonymous users pile up in Authentication → Users. Deleting one also deletes
   its grants and log authorship (cascade). Don't delete recent ones.

## Manual checklists
**P1 (normal + private window, plus a third browser/profile; Supabase configured):**
1. Guest window: join by name as before; no login asked. Reload: same.
2. Admin window: Admin login with a wrong password → error; right password → "Admin: <email>". Join.
3. Admin clicks the guest's avatar → menu shows name + `#xxxx` + "Allow building" and "Allow map
   editor", both off. Turn on "Allow map editor"; reopen → on. `select * from public.grants;` shows
   `(uid, editor)`. Turn on and off "Allow building" → the row appears and disappears.
4. **With a guest token, a direct insert into grants fails** (test from the browser console, or skip). In
   the guest window's console (fill in the two values from `client/.env.local`):
   ```js
   const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
   const c = createClient('<SUPABASE_URL>', '<ANON_KEY>', { auth: { persistSession: false } });
   const { data } = await c.auth.signInAnonymously();
   (await c.from('grants').insert({ user_id: data.user.id, perm: 'editor' })).error;
   ```
   Expect an error with code `42501` (row-level security). (`persistSession: false` keeps the page's own
   session untouched.)
5. Editor-granted guest opens `/editor` in the same browser: the editor works. The third (ungranted)
   browser opens `/editor`: "No permission" with its `#id`.
6. Autosave (granted guest or admin): make a change → status "Unsaved changes" → "Saving…" → "Saved"
   within ~2 s; reload → the change is there. Make a change and close the tab within a second → the
   browser warns, or on reopening the change is saved. Manual Save still works.
7. Admin turns "Allow map editor" off while the guest's editor is open: the guest's next change shows
   "Save failed: you no longer have editor permission"; reload → "No permission".
8. Admin signs out → becomes a guest; avatar clicks no longer open the menu; `/editor` shows "No
   permission".

**P2:**
1. A `build`-granted guest sees a **Build** button; an ungranted window doesn't; an editor-only guest
   doesn't.
2. Guest picks a desk (whole-object click), presses R, places it: all windows show it within ~0.5 s; the
   base row blocks walking everywhere.
3. Place a piece over a wall/blocked tile: ghost is red; clicking does nothing anywhere.
4. Guest presses Undo: the desk disappears everywhere and its tiles are walkable again.
5. Admin erases a guest-placed table with one click; erases a built-in decor cell; blocks and unblocks a
   tile.
6. Admin revokes "Allow building" while the guest's panel is open: panel closes, Build button
   disappears; a click in flight fails with "You can't build anymore".
7. **Autosave of live edits:** place three items, then immediately refresh the placing window: all three
   are there. A late joiner sees them too.
8. Place a chair: everyone gets an automatic seat there (E to sit). Remove a chair someone sits on: they
   stand up. Place a piece on a standing avatar: it can still walk out.
9. Spam-click placing: after ~20 in 10 s a "slow down" message appears, nothing breaks.
10. **Baking without the admin:** admin offline, an editor-granted user in the room, a builder places
    >= 50 items, wait ~10 s → `select edit_seq from public.maps where id = '<room>';` has moved up.
11. **Editor merge:** the editor tab has the room's map open; in the game a builder places a desk; then
    change something in the editor → after autosave the desk is still in the room (and now visible in
    the editor), and the editor change appears in the room in place.
12. Editor Ctrl+Z right after a merge: undoes the editor's own change only; the builder's desk stays.
13. **Two editors** on the same map: A saves, then B makes a change → B shows "changed in another
    editor — Reload | Overwrite"; Overwrite saves B's version; Reload shows A's.
14. Editor Delete while a guest is in the room: the guest's map reloads in place (built-in or empty).

## Open Questions (defaults chosen; change only if the user objects)
1. **Can builders erase others' pieces?** Default no: only their own (undo); the admin erases anything.
2. **Do editor-granted users get admin erase/block tools in live mode?** Default no (admin only); they
   can do it in the editor, which merges and saves.
3. **Thresholds:** bake at >= 50 ops after 5 s idle (+0-3 s jitter), cap 2000, rate 20 per 10 s, editor
   autosave 1.5 s debounce / 15 s retry, 3 stale retries: tunable constants.
4. **Editor conflict default** is merge for live edits and Reload/Overwrite for another editor's save.
   True co-editing between two editors is out of scope.
