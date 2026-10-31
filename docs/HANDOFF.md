# ByteGrounds — HANDOFF

**Last updated:** 2026-10-31 (Sheet Studio)
**Branch:** `master` (user asked: work on master directly, no more PRs)

## Sheet Studio — DONE, COMMITTED + PUSHED (2026-10-31); verified in local mode
Spec: `docs/specs/sheet-studio.md`; guide for humans + agents: `docs/sheet-studio.md`.
- `/sheets` (admin only via `checkIsAdmin`; open in local dev): pixel editor on the 32px grid,
  tools pencil/eraser/fill/line/rect/filled rect/ellipse/eyedropper/select, mirror, undo/redo,
  selection copy/paste/flip/outline/darker/lighter/clear, "Borrow from game art" (decor picker),
  backgrounds (incl. beige floor / purple carpet), 2x preview, PNG + SheetSpec import/export, save.
- SheetSpec v1 (`client/src/sprite-spec.ts`, pure): palette keys + ops (rect, ellipse, line, pixels,
  fill, outline, shade, copy, clear); `bufferToSpec` turns any image into text.
- Agents: `window.sheetStudio` (new/load/apply/spec/png/save/list/open/rename) and
  `node tools/sheet_spec.mts render|dump|check` (no deps; round-trips real sheets exactly).
- Storage: `supabase/sheets.sql` → `decor_sheets` (read all, write `is_admin()`), ids
  `custom_<slug>`; `Store.listSheets/saveSheet/deleteSheet`; local dev = localStorage.
  `decor.ts` `registerSheet` / `loadCustomSheets`: game (before the map) and editor (then
  `picker.refreshSheets()`). Custom sheets have no seat rules.
- Starter art made by an agent with the spec: `docs/sprite-specs/modern_office.json` →
  `client/src/assets/decor/modern_office.png` (CC0, Gather-style: desk + monitor, chairs, bean bags,
  plant, whiteboard, sofa, tree, lamp, bookshelf, floors); seat rules for chairs, bean bags, sofa.
- **Manual step (production):** run `supabase/sheets.sql` in the SQL editor (README step 5).
- Not verified: Supabase mode (saving as the real admin, the gate refusing a guest).

## 2026-10-31 batch — DONE, COMMITTED + PUSHED on master; verified in local ws mode (Playwright, fake media)
- **Meeting rooms** (`docs/specs/meeting-rooms.md`): `OfficeMap.zones` (`Zone {name,x,y,w,h}`; absent =
  never set; a saved built-in copy without zones inherits the built-in's that fit, `pickMap`). Office
  ships one (x 32–46, y 1–12). Same room = connected at full volume at any distance; rooms are closed
  to outsiders (`nextLinkState`). Share screen only inside a room (leaving stops it). Pill
  "<room> · Open meeting view" → `meeting.ts` Google Meet-style overlay (grid / presentation layout,
  mic, cam, present, red leave = `stepOutOf`, Back to map / Esc). Editor tool **Meeting room** (drag =
  add + name, click inside = remove). Lounge has **no** room: add one in the editor.
- **Picker** (`decor-objects.ts` `pickCellsAt`): objects > 4 cells per side (packed sheets: chairs
  columns, armchairs, formal sofas, thrones, counters, beds) are cut at outline seams, then at the
  repeat period of colour variants (not when the colours repeat too = one long counter).
- **Beds:** `tools/gen_bed_seats.py` finds every blanket in `beds_grid` / `beds_single_grid` by its
  white hem and adds `fallback` lie spots on its head row; `derivedSeats` drops one when a pillow spot
  is right at its head.
- **Lying:** no more cream blanket sprite (`blanket.png`, `gen_blanket.py` deleted). Head + shoulders
  on the pillow (`HEAD_ON_PILLOW = 0`), sleepers sort past their bed (`avatarAnchorY`), and
  `Game.drawBedOver` redraws the bed's cells toward the feet over the body; 1px breathing.
- **Zoom:** wheel / + - / buttons (`#zoom-ctl`) / pinch, 100–300% (`ZOOM_STEPS`), remembered
  (`byte_grounds.zoom`); Ctrl+wheel and Ctrl+/- redirected; viewport meta `user-scalable=no`; the HUD
  is DOM so it never scales.
- **Drinks** (`dispensers.ts`): office coffee maker `office(10,0)`, water cooler `office(10,20|21)`
  (Lounge has 4 coffee makers, Office both). F / button → cup for 30 s, 1 min or 5 min (random);
  `item` in the status fields (synced). Drawn by the hand (`cupRest`), hidden facing away / lying /
  dancing; every 7 s a sip (`sipStep`: bow row 18 cols 4→6→4 facing down, thrust rows 5/7 col 7
  sideways). The male business suit lacks those rows (`hasArmFrames`) → cup lifts without the arm.
- **[ADM] tag:** `admin` flag in join/presence (from `checkIsAdmin()`), yellow `[ADM]` before the
  name. Cosmetic only; a modified client could fake the tag, but RLS still decides real powers.
- Tests: 328 green; client typecheck + build green.
- **Not verified:** Supabase mode (production Realtime), phones (pinch, layout), the [ADM] tag on
  screen (needs a real admin sign-in), a 3rd peer walking into a meeting mid-share.

## Social HUD + wardrobe — DONE, COMMITTED on master (2026-10-30); manual multi-browser checks partly done
Spec: `docs/specs/social-hud.md`.
- **Protocol:** `status` / `busy` / `sharing` on `PeerState` + `JoinMsg`; `StatusMsg` → `peer-status`;
  `ChatMsg` → `chat` relay (`from`, `name`, `text`, `at`). `normalizeStatus` (80) / `normalizeChat` (300)
  / `normalizeStatusFields`. ws server + `Room.updateStatus`; `SupabaseNet` broadcast events `status`
  and `chat`, status kept in presence (late joiners), de-duplicated `peer-status`.
- **HUD** (`hud.ts`, top-left): `← Leave` (saves position, then `location.reload()` = join screen),
  status pill (click to edit; daily: `byte_grounds.status` = `{ text, day }`, resets next day,
  `chat.ts`), `Busy` (or `/busy`, `/afk`; walking ends it), `Chat` + unread count; panel with log +
  input; `/status <text>`, `/help`. Enter focuses chat; `Keyboard` ignores keys typed in inputs.
- **Render:** names above heads (`labelLift`), status line, animated zzZ; Habbo-style chat balloons
  with the speaker's face (`drawHead` / `HEAD_CROP` in `sprites.ts`) that stack and rise.
- **Screen share:** `MediaManager` "Share screen" (`getDisplayMedia`; hidden where unsupported); the
  screen replaces the camera on the same video sender; `WebrtcMesh` remembers the outgoing video for
  links made later. `ScreenStage` (top centre, Minimize/Show) shows the nearest connected presenter;
  their bubble hides meanwhile (audio stays). Video bubbles now float 64 px up (clear the tags).
- **Wardrobe:** skins `light, olive, tan, brown, dark, orc, skeleton` for both sexes (upstream
  `tanned2, tanned, dark, dark2`); `female_skeleton.png` = copy of the male skeleton (female clothes
  fit); 7 new presets (17 total) incl. Orc (F), Skeleton (F), Business (F). Sit sheets regenerated.
- Tests: 300 green; client typecheck + build green.
- **Verified in a browser** (local ws mode, two Chrome contexts via Playwright, fake media): status,
  busy zzZ, chat log both ways + balloons with faces, WASD typed in chat doesn't move, screen share
  → the other side's stage "Ana is presenting", Leave → join screen, no console errors.
- **Not verified:** Supabase mode (production Realtime), phones, a third peer walking up mid-share.

## Admin + live building — Phase 2 (P2-U1..U16) code DONE and WIRED (2026-10-30); P2-U17 manual checks pending
Spec: `docs/specs/admin-live-building.md` (rev 2), Phase 2.
- Commit `3373787` ("early phase2") had U1–U16 written (`supabase/live-edits.sql`, `edit-ops.ts`,
  `live-model.ts`, `Store.loadMapState` / `loadEdits` / `bakeMap` / `StaleSaveError`, `live-map.ts` with
  auto-bake, `decor-picker.ts`, movement escape, `build-panel.ts`, `Game.attachLive` + build mode,
  store save/delete through `bake_map` / `delete_map`, `mergeLiveEdits`, editor merge-before-save +
  conflict UI) but **nothing created the `LiveMap`**: no Build button, no live edits.
- **Fixed (2026-10-30):** `main.ts` `startGame()` now, when the player has a uid, creates
  `new LiveMap(map, map.id, uid, { isAdmin, canBake: () => isAdmin || feed.has(uid, 'editor') })`
  on the same `map` object the game draws, `game.attachLive(live)` **before** `live.start()`.
  `Game.stop()` stops it. Without a uid (local ws dev, or anonymous sign-in failing) there is no live
  map and no Build button.
- Avatar menu: a remote without a uid now says "Can't grant: this player isn't signed in. Check that
  anonymous sign-ins are on in Supabase (Authentication → Sign In / Providers), then have them
  reload." (was "they need to reload", which hid the usual cause: anonymous sign-ins off.)
- Tests: `client/test/live-map.test.ts` (+2, fake Supabase: load stored map + later edits into the
  game's map object, live INSERT applied, `send` inserts a `map_edits` row). `npm test` 270 green;
  client typecheck + build green; local ws play smoke-tested (no errors, no Build button).

### Manual user steps for Phase 2 (production Supabase, after the Phase 1 steps below)
1. Phase 1 steps 1–5 below must be done, **especially step 1 (anonymous sign-ins)**: without it no
   guest gets a uid, so nobody can be granted anything and only the admin can build.
2. SQL Editor → New query → paste all of `supabase/live-edits.sql` → Run (idempotent).
3. Database → Publications → `supabase_realtime` lists `map_edits`. If not:
   `alter publication supabase_realtime add table public.map_edits;`
4. Deploy (merge/push so Vercel redeploys; no new env vars). Everyone reloads once.

### P2-U17 — Manual checklist (not exercised here; needs the real Supabase)
The 14 items under "Manual checklists → P2" in the spec. Shortest useful pass: admin + one guest
window. (1) admin grants the guest "Allow building" → guest sees **Build**; (2) guest places a
desk → both windows show it, it blocks walking; (4) guest Undo → gone everywhere; (7) refresh → still
there; (11) editor tab open on the room + a live placement + an editor change → both survive.

 (P1-U1..U10) code DONE, COMMITTED (2026-10-29); P1-U11 manual checks pending
Spec: `docs/specs/admin-live-building.md` (rev 2). Phase 2: see the section above.
- **P1-U1** `supabase/admin.sql` (new, idempotent): `admins`, `grants(user_id, perm in build|editor)`,
  `is_admin()` / `can_build()` / `can_edit_maps()` (stable security definer), RLS (grants: read all,
  insert/delete admin only; maps: read all, insert/update/delete `can_edit_maps()`; drops
  "maps open to anon"), `grants` added to `supabase_realtime` (guarded). `schema.sql` header and README
  deploy step 4 point to it. **`schema.sql` re-creates the open maps policy: re-run `admin.sql` after it.**
- **P1-U2** `client/src/auth.ts`: `shortId`, `ensureSession` (getSession, else silent
  `signInAnonymously`; null + warn on error), `signInAdmin`, `signOutAdmin`, `checkIsAdmin`,
  `checkCanEditMaps` (rpc, false on error), `adminEmail` (non-anonymous session only). Optional client
  param for tests (`adminEmail` too).
- **P1-U3** `uid?` on `JoinMsg` / `PeerState`; `SupabaseNet` puts it in presence, `toPeer` keeps it
  (only when a string); ws server copies it.
- **P1-U4** Join screen (Supabase only): "Admin login" link → email + password form + error line;
  signed in: "Admin: <email> · Sign out". `join()` runs `ensureSession()` with the map load, then
  `checkIsAdmin()`; `SelfInfo` gains `uid?`, `isAdmin`; uid goes into `net.connect`.
- **P1-U5** `client/src/grants.ts`: `GrantsFeed` on channel `byte_grounds-grants` (INSERT/DELETE on
  `public.grants`, unfiltered), full re-read on every SUBSCRIBED; `grant` ignores `23505`; both apply the
  change locally on success. Pure `applyGrantChange`, `toGrantChange`.
- **P1-U6** `client/src/hit.ts` (`screenToWorld`, `avatarAt`); `Game` keeps `camX/camY/scale` from
  `render()`, canvas `pointerdown` → `onAvatarClick(id, clientX, clientY)` (remotes only).
- **P1-U7** `client/src/avatar-menu.ts`: admin popup `<name> #a1b2` + "Allow building: on/off" and
  "Allow map editor: on/off"; no uid → "Can't grant: this player isn't signed in…" (anonymous sign-ins off, or an old tab); inline errors; closes on
  outside click / Esc. `Game.attachGrants(feed)` (menu only for the admin); `main.ts` starts the feed
  when the player has a uid. `RemoteAvatar.uid`.
- **P1-U8** Editor gate (Supabase only): overlay "Checking permission…" → `ensureSession()` →
  `checkCanEditMaps()` → editor, or "No permission" with the short id + "← Back to Play". Module flag
  `canSave` (true in local dev).
- **P1-U9** `client/src/autosave.ts`: pure scheduler (debounce, one save in flight and re-save of
  changes made during it, retry timer, denial stops automatic retries, `flush()` → true when clean).
- **P1-U10** Editor autosave (1.5 s / retry 15 s): `refreshStatus()` → `autosave.changed()` when
  `canSave`; status "Unsaved changes" → "Saving…" → "Saved · id"; "Save failed — Retry" (click =
  flush, error in the tooltip); `42501` → "Save failed: you no longer have editor permission". Save
  button = flush; flush on `visibilitychange: hidden` / `pagehide`; `beforeunload` warns while dirty or
  saving; map select / New flush first and only ask to discard if that failed; Delete flushes first so a
  pending save can't recreate the map. The save snapshots the JSON before the request, so edits made
  during it stay dirty. Map list is refreshed only when the id/name is new.
- Read-only check of production (public endpoints, anon key): `/auth/v1/settings` shows
  `anonymous_users: false` (step 1 below is required) and `grants` does not exist yet (step 3).
- Tests: auth (+7), grants (+4), hit (+4), autosave (+7), net-supabase (+1). `npm test` 235 green;
  client typecheck + `npm run build` green.

### Manual user steps (Supabase dashboard of the production project, in this order, BEFORE the Phase 1 deploy goes live)
1. **Enable anonymous sign-ins:** Authentication → Sign In / Providers (older dashboards:
   Authentication → Providers / Settings) → turn on **Allow anonymous sign-ins** → Save. Optional:
   Authentication → Rate Limits → keep "anonymous sign-ins" low (default 30/h per IP).
2. **Create the admin user:** Authentication → Users → **Add user → Create new user** → your email and a
   strong password → tick **Auto Confirm User** → Create.
3. **Run the SQL:** SQL Editor → New query → paste all of `supabase/admin.sql` → Run (schema.sql has
   already been run in production).
4. **Make yourself admin:** SQL Editor →
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = '<your-admin-email>'
   on conflict do nothing;
   select * from public.admins;  -- expect one row
   ```
5. **Check Realtime:** Database → Publications → `supabase_realtime` lists `grants`. If not:
   `alter publication supabase_realtime add table public.grants;`
6. **Deploy:** merge/push so Vercel redeploys (no new env vars).
7. Optional SQL: `select user_id, perm, granted_at from public.grants order by granted_at;` (who has
   what), `delete from public.grants where user_id = '<uid>';` (revoke one person).
- Note: production has email sign-ups open (`disable_signup: false`). Someone could create an email
  account via the API; it gets no powers (RLS), but the join screen would label it "Admin: <email>".
  Turning off sign-ups would also block anonymous sign-ins, so leave it unless that matters.

### P1-U11 — Manual checklist (normal + private window + a third browser/profile; NOT exercised here)
1. Guest window: join by name as before; no login asked. Reload: same.
2. Admin window: Admin login with a wrong password → error; right password → "Admin: <email>". Join.
3. Admin clicks the guest's avatar → menu shows name + `#xxxx`, "Allow building: off" and "Allow map
   editor: off". Turn the editor one on; reopen → on. `select * from public.grants;` shows
   `(uid, editor)`. Turn "Allow building" on and off → the row appears and disappears.
4. Guest-token direct insert into `grants` fails with `42501` (console snippet in the spec, checklist
   P1 item 4), or skip.
5. Editor-granted guest opens `/editor` in the same browser: the editor works. The third (ungranted)
   browser opens `/editor`: "No permission" with its `#id`.
6. Autosave (granted guest or admin): change something → "Unsaved changes" → "Saving…" → "Saved"
   within ~2 s; reload → the change is there. Change and close the tab within a second → the browser
   warns, or the change is saved on reopening. Manual Save still works.
7. Admin turns "Allow map editor" off while the guest's editor is open: the guest's next change shows
   "Save failed: you no longer have editor permission"; reload → "No permission".
8. Admin signs out → becomes a guest; avatar clicks no longer open the menu (after re-joining);
   `/editor` shows "No permission".
9. Local dev without Supabase (`npm run dev`, no `client/.env.local`): no Admin login link, editor opens
   without the gate and autosaves to localStorage.

## Dance & creatures — U1–U9 code DONE, COMMITTED (2026-10-29); U9 manual checks pending
Spec: `docs/specs/dance-and-creatures.md`.
- **U1 recon (GitHub API, master):** `body/male/` has `orc.png`, `red_orc.png`, `skeleton.png`;
  `body/female/` has `orc.png`, `red_orc.png` and **no skeleton**. All 832x1344; the vendored
  `male_light.png` is byte-identical to upstream. Coverage: every vendored layer + the 3 creature
  bodies has pixels at every dance step's frame, so **no step uses its fallback**. Registration:
  feet and width match the human bodies at rows 8-11 col 0 (only the orc head top differs, by head
  shape). `skinsFor`: male → light/orc/skeleton, female → light/orc (spec default).
- **U2** `lpc/body/{male_orc,female_orc,male_skeleton}.png` (verbatim) + their sit sheets
  (regeneration left the other 32 byte-identical); `gen_pose_sheets.py` preview combos
  `orc_male`, `skeleton`; CREDITS.md "Creature bodies" (Marcel van de Steeg / Stephen Challener
  for orc, Johannes Sjölund for the skeleton animations).
- **U3** `shared/src/protocol.ts` `POSES`, `Pose` derived, `normalizePose`.
- **U4** `sprites.ts` dance model: `DANCE_STEPS` (16 steps x 125 ms = 2 s), `ANIM_ROW`,
  `ANIM_FRAMES`, `danceStep(ms)`, `drawDanceAppearance`.
- **U5** `render.ts` dance branch (`nowMs`); `game.ts` passes `Date.now()` (shared beat) and
  normalizes remote poses.
- **U6** `game.ts` Q / `#dance-btn` (`Dance (Q)` / `Stop dancing (Q)`), hidden while seated; seat
  button hidden and E ignored while dancing; movement ends the dance; only sit/lie remotes lock a
  seat. E and Q are also ignored while a `<select>` has focus.
- **U7/U8** `Appearance.skin` (light/orc/skeleton) + `outfit: 'none'` (creatures only);
  `skinsFor`, `outfitsFor`, `fitAppearance` (used by `appearanceToLayers` and the editor);
  Skin category; presets `orc`, `skel` (10 total); 6-part serialization (`skin` last; 4/5-part
  legacy strings parse as light); shuffle body → skin → hair → outfit → top → pants.
- **U9 code** `main.ts` `setAppearance` (fitAppearance after every arrow/shuffle/preset and on
  load; Skin → skeleton also sets hair/outfit none; Top/Pants rows get `disabled` when bare);
  `index.html` `.axis.disabled`.
- Author-time previews (session scratchpad, not committed): `creatures_preview.png`,
  `dance_preview.png`. They look right: no layer drops out on any dance step.
- Tests: protocol (+2), room (+1), net-supabase (+1), sprites (+19, literals updated).
  `npm test` 212 green; client typecheck + build green.

### U9 — Manual checks (browser, two tabs; NOT exercised here)
1. Editor: Skin row cycles Light → Orc → Skeleton for male, Light → Orc for female; switching a
   male skeleton to female falls back to Light. Choosing Skeleton makes it bald and bare; Top/Pants
   dim; Outfit can go back to casual/business (clothes fit the skeleton). Orc and Skeleton presets
   work. Reload restores the creature.
2. In world: orc and skeleton walk in 4 directions with clothes/hair aligned; sit on a chair
   (profile + front), lie on a left/right bed and an up/down bed (tucked).
3. Press Q: the avatar dances (arm pump, spin, swings, arms up, steps), crisp, small bob/sway,
   name label steady. Button shows "Stop dancing (Q)". Q again or WASD stops it.
4. While dancing, no seat button and E does nothing; while seated, no dance button and Q does
   nothing.
5. Second tab sees the dance; two dancers in two tabs move on the same beat. Stop → the other tab
   sees standing/walking again. A dancer on a chair tile does not block sitting there.
6. Dance in every outfit (casual M/F, business M/F, bare skeleton, clothed orc): no layer pops out.
7. Phone: dance button sits above the seat button, clear of the touchpad and media controls.

## Auto seats — U1–U11 DONE, COMMITTED (2026-10-29); U12 manual checks pending
Spec: `docs/specs/auto-seats.md`. Any stamped chair/armchair/sofa/stool/bench/throne/bed cell is a
seat at once (Sit / Lie down with E); authored seats are overrides; "No seat" turns one off.
- **U1** `shared/src/map.ts`: `transformFacing` moved here (client `decor-transform.ts` re-exports
  it); `OfficeMap.noSeats?` (parseMap keeps integer tiles, omits the field when empty);
  `seatsNearIn(seats, …)`, `seatsNear` delegates.
- **U2/U3** `shared/src/seats.ts` (`@byte_grounds/shared/seats`) + `shared/src/seat-catalog.json`
  (hand-edited rules: rect + stride, later rules win, `none` removes): `seatSpot`, `buildIndex`,
  `derivedSeats` (one per tile, last seat cell wins, dir turned by the cell transform),
  `effectiveSeats` (authored first, then derived on other tiles not in `noSeats`).
- **U4** `maps.test.ts`: reachability + exact counts over `effectiveSeats` (76/78/32).
- **U8** `game.ts`: `seats` cache, `refreshSeats()` (stands up if our seat vanished; **the
  realtime-building work must call it after applying decor/seats/noSeats edits**), `position`
  returns the stand spot while seated.
- **U9/U10** `editor-model.ts` `toggleNoSeat`, `toggleSeat` clears `noSeats`, `resizeMap` filters
  it; `editor.ts` draws authored = filled badge, automatic = outlined ring, off = grey ×; Seat
  kind select gains "No seat (turn off automatic)".
- **U11** `tools/build_maps.py` derives seats from the catalog and writes only overrides (office 0,
  lounge 1, home 1; empty array written as `[]`). Decor/tiles/revs unchanged.
- **U5** `tools/preview_seats.py --out DIR [sheets] [--scale N]`: sheet + labelled grid + arrows
  (orange sit, purple lie). Use it before committing catalog edits.
- **Catalog coverage:** tier A chairs, armchairs, sofas, bar_stools (up), ottomans (down);
  tier B beds: beds_grid + beds_single_grid pillow pieces (side told apart by the frame strip;
  every pillow-piece cell, so single beds get 2 spots half a tile off-centre), upholstery whole
  beds + bunk, house_inside 3 beds, wooden_furniture 3 beds + modular pillows + bunk; tier B
  seating: thrones (lower cell), sofas_formal, upholstery chairs/armchairs/sofas/poufs/high chair,
  wooden_furniture chair block (12-15 x 15-22), house_inside chairs, tavern_furniture_grid chairs
  and stools (angled chairs mapped to left/right; tables, crates, railings, angled benches left
  out). Not covered (spec): pre-repack originals (`beds`, `beds_single`, `tavern_furniture`).
- Tests: map (+3), seats (+21), maps (+3), editor-model (+3). `npm test` 189 green; client
  typecheck + build green.

### U12 — Manual checks (browser, NOT exercised here)
1. Editor: stamp a chair: an outlined badge appears at once; press R before stamping: the outlined
   arrow is turned. Stamp a sofa: two outlined badges.
2. Seat tool "No seat" on an automatic seat: grey ×; the game no longer offers it. Seat tool
   Sit/Lie click on it: filled badge with the chosen facing (× gone).
3. Save, join: "Sit (E)" near the stamped chair; a rotated chair faces the turned way; lie on both
   halves of a double bed (house_inside, beds_grid pieces), and on a single bed.
4. Reload while seated: you come back next to the seat, not at spawn.
5. Built-in maps: every chair, stool, sofa, armchair, piano ottoman and bed still works as before
   (piano ottomans face up).
6. Two tabs: the other tab sees you seated on an automatic seat; a seat in use is not offered.
7. An old saved map gains automatic seats on its chairs/beds and keeps its authored ones.
8. Spot-check new sheets in game: a throne, a formal sofa side view, a tavern chair, a bunk bed.


## Default map = Lounge & Café; built-in revisions vs saved copies — DONE, COMMITTED (2026-10-29)
User report: "the office was not redone, didn't change". **Cause (verified):** production Supabase
(`uxfircvmukgjosfdkxgw`, read with the public anon key from the deployed bundle at
byte-grounds.vercel.app) has one `maps` row, `office` "Office", saved 2026-10-29 14:01 UTC: the
old hand-built 20x15 office (300 tiles, 38 decor cells, no `basedOnRev`). The store served a saved
copy over the built-in, so it hid the new 48x32 office. The deployed bundle (built 16:02 UTC) does
contain the new maps, so it was not a stale build; no server-side map exists (the ws server only
uses the default map's spawn as a fallback position).
- **Revisions:** `tools/build_maps.py` writes `"rev"` into each `shared/src/maps/<id>.json`
  (MapBuilder arg after the name; all 1 now). Bump it whenever a layout changes.
  `shared/src/maps.ts` `builtInRev(id)` (0 = not a built-in).
- **`OfficeMap.basedOnRev?`** (`shared/src/map.ts`): kept by `parseMap` only as a positive integer;
  missing = stale. `store.saveMap` stamps it (`toStored`) when the id has a built-in.
- **Precedence** (`client/src/store.ts` `savedWins(id, basedOnRev)`): a saved map wins if there is no
  built-in with its id, or if `basedOnRev >= builtInRev(id)`; otherwise the built-in is listed and
  loaded. Stale copies are not deleted (the old office row is still in Supabase); the editor's
  Delete still removes the stored row. Supabase `listMaps` selects `basedOnRev:data->basedOnRev`
  (checked against the live REST API); no schema change.
- **Default map:** `BUILT_IN_MAPS` order is lounge, office, home; `DEFAULT_MAP` (= lounge) replaces
  `OFFICE_MAP` in `main.ts` (placeholder option + load fallback), `net-supabase.ts` and
  `server/src/index.ts` (spawn fallback), editor boot (`?map=` absent). `DEFAULT_ROOM` = `'lounge'`
  (test asserts it equals `DEFAULT_MAP.id`). The join screen still preselects the map the player
  last joined (`byte_grounds.map` in localStorage), so returning players who used the office see it
  preselected; new players get the lounge.
- Tests: maps (+1 rev, default order), map parse basedOnRev (+1), store stale precedence (+1) and
  `savedWins` (+1). `npm test` 159 green; client typecheck + build green.
- `docs/CONTEXT.md` → Maps → "Store precedence" still describes the old rule (saved always wins);
  left for the Architect to update.

### Manual checks (browser, NOT exercised here)
1. After deploy: the join screen lists Lounge & Café, Office, Home; Office opens the new 48x32 map.
2. Editor: open Office, change a tile, Save, reload: the edit sticks (row now has `basedOnRev: 1`).
3. Fresh profile (no localStorage): the lounge is preselected; the editor opens the lounge.

## Built-in maps + scrolling camera — DONE, COMMITTED (2026-10-29)
Creative content task (no spec). Three furnished maps ship with the app; see `docs/CONTEXT.md` → Maps.
- **Data:** `shared/src/maps/{office,lounge,home}.json`, generated by `python tools/build_maps.py`
  (catalog of whole sheet objects + layout code; refuses overlaps, blocked spawn, unreachable rooms
  or seats). Do not hand-edit the JSON: change the layout code and rerun.
- **Module:** `shared/src/maps.ts` (`@byte_grounds/shared/maps`): `BUILT_IN_MAPS`, `OFFICE_MAP`,
  `builtInMap(id)`. The old hand-built 20x15 office and `OFFICE_MAP` left `map.ts`; server,
  `net-supabase.ts`, `main.ts` import `OFFICE_MAP` from the new module. `tsconfig.base.json` gained
  `resolveJsonModule`; the JSON is imported `with { type: 'json' }` (works in Vite, Vitest and Node 24).
- **Store:** built-ins always listed first, then other saved maps; a saved map with a built-in's id
  wins (an already-edited office is NOT overwritten); deleting it brings the built-in back.
- **Sizes:** office 48x32 (76 seats), lounge 44x30 (78 seats), home 40x30 (32 seats incl. 4 beds).
- **Camera:** `client/src/camera.ts` (`viewportSize`, `cameraOffset`); `game.ts` sizes the canvas to
  `min(map, window)` on resize and draws under `setTransform(-camX, -camY)`; bubbles subtract the
  camera. Small maps that fit don't scroll (on phones they now scroll at 1:1 instead of shrinking).
- Tests: `shared/test/maps.test.ts` (+13), `client/test/camera.test.ts` (+4), store (+1), removed
  the old OFFICE_MAP tests (-2). `npm test` 155 green; client typecheck + build green.

### Manual checks (browser, NOT exercised here)
1. Join screen lists Office, Lounge & Café, Home (plus any saved maps). Join each.
2. Walk around a big map: the view follows you and stops at the map edges; depth sort still right
   (walk behind a desk row / sofa); names stay above avatars.
3. Two tabs near each other: the video bubble sits over the other avatar while scrolling.
4. Sit at a north-side desk chair (tucked under the desk): the desk covers the legs. Sit on a bar
   stool, a sofa, an armchair; lie on the double bed and on a single bed.
5. Resize the window: canvas refits; a 20x15 saved map still shows whole on a big screen.
6. (Superseded: a stale saved `office` row no longer hides the new office; see above.)

**Next:** run the manual checks above; tweak layouts in `tools/build_maps.py` if anything looks off.

## Object footprint (base row blocks, base row sorts) — U1–U4 DONE, COMMITTED (2026-10-29)
Spec: `docs/specs/object-footprint.md`. A 3x2 desk now blocks only its bottom row and the whole
desk depth-sorts by that row, so an avatar in the row behind is hidden behind it.
- **U1** `shared/src/map.ts`: `DecorCell.baseDy?` (rows down to the object's base row; absent = 0).
  `parseMap` keeps it only as an integer in `1..MAX_MAP_SIZE-1`.
- **U2** `client/src/depth.ts`: `decorAnchorY = y + (baseDy ?? 0) + 0.5`. `game.ts` unchanged.
- **U3** `client/src/editor-model.ts`: `BlockMode = 'none' | 'base' | 'all'`, `cellBlocks(cell, mode)`.
  `brushCells(..., mode?)` writes `layer` and, in `base`, `baseDy = footprint(w,h,t).h - 1 - o.dy`
  (omitted when 0). `stampDecor(m, x, y, sel, mode, t)` blocks per `cellBlocks`, never unblocks; a
  duplicate re-stamp now replaces `layer`, `baseDy` and transform. `all` = old `true`, `none` = old
  `false` (byte-identical output).
- **U4** `client/src/editor.ts`: "Block" select `#block-decor` (Base row [default] / Whole piece /
  Nothing), ghost tints only the blocking cells red, hint line under it.
- Tests: map baseDy parse (+2), depth desk sort (+4), editor-model block modes (+4).
  `npm test` 139 green; client typecheck + build green.

### U5 — Manual checks (browser, NOT exercised here)
1. Pick the 3x2 desk with Block = Base row. The ghost is red only on the bottom row. Stamp it: only
   the bottom row shows a red X.
2. In game, walk into the row behind the desk. The avatar is hidden behind the desktop (head shows
   above if the sprite is taller). Walk in front of it: the avatar draws over the drawers.
3. Put a chair in the row behind the desk facing down with a Sit seat, then sit. The desk covers the
   legs. A chair in front facing up draws over the desk.
4. Whole piece blocks all 6 tiles, as before. Nothing gives no X and draws under avatars.
5. Press R on the desk (footprint 2x3) with Base row: only the bottom row is red. Whole piece blocks
   all of it.
6. An old saved map looks and blocks the same. Re-stamping a desk on its own anchor with Base row,
   then using Walk on its top row, converts it.
7. Save, reload, open in game: `baseDy` persists.

**Next unit:** run the 7 manual checks above in the browser (`npm run dev`) and record results;
fix anything they surface. Optional later (spec Open Questions): a "Base: 2 rows" 4th mode for deep
tables (`cellBlocks` would compare `baseDy < 2`; no model change).

## Picker click selects the whole object — DONE, COMMITTED (2026-10-29)
User ask: clicking one cell of a multi-cell piece (office tables 36-61 px tall, beds, sofas) picked
"half a table"; a click should pick every cell the object covers.
- `client/src/decor-objects.ts` (pure): `labelObjects(buf)` labels a sheet's objects once with the
  `tools/repack_decor.py` rules — 8-connected solid regions (alpha >= 200; 8 so 1px diagonal
  outlines stay one piece, and so picker objects match the repacker's), translucent shadow pixels
  given breadth-first from all regions at once (never bridge two neighbours), lone shadows are
  their own object (rugs), bits < 48 px within 3 px join a big object. `objectAt(objs, px, py)`
  looks up the object; a transparent pixel snaps to the nearest solid pixel in the clicked cell
  (shadow pixel only if the cell has no solid), null for an empty cell / off-sheet.
  `findObjectAt(buf, px, py)` = both in one call. `objectCells(box)` = covering cell rect.
- Choice: the cell rect covers the object's **solid core**, not shadow spill (as in the repacker,
  where spill never sizes a block) — a 1px shadow tail would otherwise drag in a neighbour's cell
  row. The returned box still has the full extent (x0..y1) alongside the core (cx0..cy1).
- `decor.ts`: `TILE_SHEETS` (interior, interior_tiles, castle, stairs, house_inside: seamless
  wall/floor sets, click = single cell); `decorObjects(sheet)` draws the loaded image to an
  offscreen canvas, `getImageData`, labels and caches per sheet (~30 ms for office 512x768).
- `editor.ts` picker: plain click = `objectCells` of the object under the cursor (falls back to the
  clicked cell when empty / tile sheet / not loaded); Alt+click = the single cell; once the pointer
  leaves the pressed cell it is a drag and picks exactly the dragged rect (unchanged manual
  override). Hover draws a dashed white outline of what a click would pick. Selection is the same
  `DecorSelection` rect, so rotation/flip brush and stamping are untouched.
- `client/test/decor-objects.test.ts` (+6). `npm test` 129 green; client typecheck + build green.
- Manual (browser, NOT exercised here): office sheet, hover a table -> whole table outlined, click
  -> 2x2/1x2 selection, stamps whole; drag still picks any rect; Alt+click picks one cell;
  interior/castle click picks one cell; R/F on a picked table turns the whole block.

## Decor grid repack — DONE, COMMITTED b9ee9d3 (2026-10-29)
Bug: in several sheets objects straddle 32px cell lines (one cell = half a chair) or share a cell.
- `tools/repack_decor.py` (Pillow, author-time). Objects = 8-connected regions of solid pixels
  (alpha >= 200); translucent shadow pixels (LPC uses alpha 45-153) join the object they touch
  instead of bridging neighbours (they were gluing whole table rows together) and never size a
  block (spill is clipped). Small bits < 48 px within 3 px of a big object join it (sparks,
  steam); pure-shadow objects (translucent rugs) are kept. Gap/bbox-proximity merging was tried
  and dropped: these sheets pack items 0-2 px apart, so any gap merge glued neighbours.
- "Moved" = core covers more cells than ceil(size/32) needs, or its solid pixels share a cell
  with another object. Moved objects get the minimal block, centred + bottom-aligned; the rest keep
  their source in-cell offset (modular pieces still line up). Blocks are shelf-packed in source
  reading order, 8-12 cells wide. 1:1 pixels; verified no solid pixel lost in any repack.
- `--analyze` reports every sheet; `--preview DIR` writes `<name>_before_after.png` (source with
  yellow = moved / cyan = kept outlines | repack, 2x on a red grid), or `<name>_check.png` with
  `--analyze`.
- Repacked (new `<name>_grid.png`, originals untouched): beds (90 objects / 35 moved), beds_single
  (56/28), bookshelf-brown + -green (2/2 each), drawer_shelf-brown + -green (2/2 each), cabinets
  (9/3), plants (4/1), tables_stools (8/1), tavern_decor (368/60), tavern_furniture (70/17),
  tavern_kitchen (64/14).
- Left alone: tile/modular sets interior, interior_tiles, castle, stairs, house_inside (wall/floor
  pieces meant to join across cells); wooden_furniture (its "moved" hits are modular bed
  rails/posts sharing cells by design; only ~4 real straddlers); office (1/111, a copier), tables
  (0/14), upholstery (3/68), every other Base Object Kit sheet (0 moved).
- Office tables (the user's example) are already on whole cells: each is 36-61 px tall, so it
  needs a 1x2 / 2x2 pick and can never fit one cell. A repack cannot fix "one click = half a
  table"; a picker that expands a click to the object's cells does (done, see above).
- Known limits: touching items stay one object (tavern_furniture chair pairs in a column, the
  table cluster beside the long table; cabinets; tables_stools big table + bar). Kept as a block.
- `decor.ts`: `DECOR_SHEETS` hides any sheet that has a `<name>_grid` sibling; `SHEET_URLS`
  still has it, so old maps draw. `client/test/decor.test.ts` (+2): every sheet PNG is whole
  32px cells; picker = all sheets minus repacked originals. CREDITS.md + README.md updated.
- `npm test` 123 green; client typecheck + build green.

## Decor rotation & flip — U1–U8 DONE, COMMITTED (2026-10-29)
Spec: `docs/specs/decor-rotation.md`. `npm test` → **121 green** (106 +2 shared parseMap transform,
+11 decor-transform, +2 editor-model); `npm run typecheck --workspace client` + `npm run build` green.
- **U1** `shared/src/map.ts`: `Rotation = 0|90|180|270`; `DecorCell.rot?` / `flipX?` (canonical:
  `parseMap` keeps only `rot` 90/180/270 and `flipX === true`; identity cells serialize as before).
- **U2–3** `client/src/decor-transform.ts` (new, pure): `DecorTransform {rot, flipX}`, `IDENTITY`,
  `rotateCW/CCW`, `flipH/V`, `footprint`, `transformOffset`, `transformFacing`, `transformFields`,
  `describeTransform`.
- **U4** `editor-model.ts`: `brushCells(x, y, sel, t, layer?)` (target tile = anchor + transformed
  offset; source `sx+dx, sy+dy`); `stampDecor(..., t = IDENTITY)`; re-stamping an identical cell on
  the same tile replaces its `rot`/`flipX` instead of adding a cell.
- **U5** `decor.ts` `drawDecorCell(..., rot = 0, flipX = false)`: identity = the old single
  `drawImage`; otherwise save / smoothing off / translate to the tile centre / rotate / scale(-1,1) /
  draw / restore. `render.ts` `drawDecorCellAt` passes `cell.rot ?? 0, cell.flipX === true` (all
  floor/object/editor/game decor paths go through it). The tucked-lie code draws only the body +
  blanket sprite, never bed decor cells, so rotated beds need nothing more.
- **U6–8** `editor.ts`: `brushT` state (persists across piece picks; not an undo/dirty edit);
  R / Shift+R / F / V (ignored in input/select/textarea or with Ctrl/Meta/Alt); toolbar ⟲ ⟳ ⇋ ⇵ +
  Reset + label + hint; ghost preview at alpha 0.6 with the transformed-footprint outline; in the
  Seat tool the same keys turn `seatDir` via `transformFacing` and sync `#seat-dir`.
- Visual math check (no browser): `scratchpad/rotation_preview.py` → `scratchpad/rotation_preview.png`
  (house_inside 2x3 framed bed, beds_single 1x2, decorative banner; 8 orientations, 4× nearest).
  Correct turns/flips, crisp, no seams between cells; a rotated bed shows its headboard sideways (LPC
  3/4 art, expected per spec §1).

### Decor rotation — U9 manual checklist (browser, NOT exercised here)
1. Pick a 2-tile bed (or the 2x3 framed bed in `house_inside`), press R: the ghost turns into the
   rotated footprint; click stamps it exactly there; Shift+R turns it back.
2. F mirrors a rug/table, V mirrors vertically; R ×4 and F ×2 return to the original (label reads
   "No rotation").
3. Zoom 2: pixels stay crisp (no blur, no 1px seams between rotated cells).
4. "Block tiles" ON → a rotated table occludes avatars correctly in game; OFF → a rotated rug stays
   under avatars.
5. Vertical bed + Lie seat whose arrow was turned with R in the Seat tool (down/up) → lying/tucked
   works like a native vertical bed.
6. Save, reload the editor, open in game: transforms persist; an old map looks unchanged.
7. Typing R/F/V in the map-name field (or with a dropdown focused) does not change the brush.

## Tucked-in lie on up/down beds — DONE, UNCOMMITTED (2026-10-29)
Bug fix (no spec): on up/down beds the rotated side-lie profile was horizontal and overhung the
vertical bed. Branch `claude/nifty-archimedes-e4o1ce`, on top of 8699218; **not committed —
awaiting review of `scratchpad/poses/preview_lie_v2.png`**. `npm test` → **106 green** (103 −1
obsolete up/down fallback test +4: lieMode, tuckLayout ×2, blanket PNG size); typecheck + build green.
- `sprites.ts`: pure `lieMode(dir)` (`left/right` → `side`, unchanged; `up/down` → `tucked`) and
  `tuckLayout(dir)` (local px around the pillow-tile center, feet toward +y, drawn rotated by
  `rot`): standing frame col 0 with the head center (row 22) 2px above the pillow center, only
  the top 38 rows drawn (head + shoulders), blanket `{x:-13,y:11,w:26,h:35}` = one tile minus a
  3px inset per side, from the shoulders to 2px inside the foot end of the 2-tile bed.
  `drawTuckedAppearance` blits the cropped frame then the blanket (same renderable → blanket is
  always on top of its own body; depth sort/name pass untouched). `blitLayers` got an optional
  source height. `preloadAppearance` also preloads `BLANKET_URL`.
- Frame choice: `down` bed → face-on `down` frame, upright. `up` bed (head toward the viewer) →
  back-of-head `up` frame turned π (crown on the pillow, shoulders toward the blanket). The
  physically "correct" upside-down face (down frame turned π) was previewed and read as a
  bearded blob, so it was rejected.
- `render.ts` lie branch: `tucked` → translate to the tile point, rotate `tuckLayout(dir).rot`,
  `drawTuckedAppearance`; `side` path is byte-for-byte the previous code.
- Blanket art: `tools/gen_blanket.py` (Pillow) → `client/public/sprites/blanket.png` (26×35,
  linen fill, dark rounded outline, white folded hem across the chest, side/foot shading, quilt
  seams). Original art, CC0 (`client/public/sprites/CREDITS.md`). If the blanket rect changes,
  update `W, H` in the script (a test asserts the PNG IHDR size equals `tuckLayout().blanket`).
- Weaknesses: one neutral blanket colour regardless of the bed's own colour; layout assumes a
  2-tile bed with the seat on the pillow tile's center (real `beds_single` art is ~44px wide and
  its pillow sits low in the tile, so the head may land a few px above the pillow); shoulders
  poke ~1px past the blanket sides (intentional, reads as arms); manual in-browser check pending.

## Sit & side-lie poses — UNITS 1–3, 5–11 DONE, UNCOMMITTED (2026-10-29)
Spec: `docs/specs/sit-lie-poses.md`. Branch `claude/nifty-archimedes-e4o1ce`. **Not committed /
not pushed — awaiting the user's review of the preview PNGs.** `npm test` → **103 green** (was 96:
+3 lieTransform, +4 sit layers/frame); `npm run typecheck --workspace client` + `npm run build` green.
- **U1–3 side-lie:** `sprites.ts` pure `lieTransform(dir)` (left/up → `right` frame +π/2; right/down →
  `left` frame −π/2; side picked by source frame, belly toward viewer) + `LIE_SHIFT = 8`.
  `render.ts` lie branch draws the profile frame rotated, shifted `LIE_SHIFT` along `dir`;
  `LIE_ROTATION` + `down`-frame draw removed. Tests lock the table + feet/belly vectors.
- **U5 recon:** sanderfrenken generator has `sit` rows for body + pants (extended 832×2944 sheets,
  body is headless there), but longsleeve/tunic/vest/sash-dress are plain 832×1344 (no sit) and our
  formal/pink/navy are our own derivatives → no complete drop-in set. Synthesis kept.
- **U6–8 sit sheets:** `tools/gen_pose_sheets.py` (Pillow; `--preview OUT_DIR`). Profile bend for
  left/right (torso kept, lowered `SEAT_DROP`; front-leg thigh band rotated 90°, stretched,
  knee/underside outlined; front lower leg hung under the knee), row-cut squash for up/down.
  Final constants: `HIP_Y=48 KNEE_Y=56 SHIN_Y=52 THIGH_X0,X1=33,39 SHIN_X0=31 THIGH_LEN=16
  THIGH_AT=(28,47) SHIN_DX=6 SEAT_DROP=4 SQUASH_Y0,Y1=46,52`. Generated 32 sheets (256×64, cols
  up/left/down/right) under `client/public/sprites/lpc/sit/{body,legs,torso,hair}/`;
  `client/public/sprites/CREDITS.md` entry (CC-BY-SA 3.0 derivatives, original authors kept).
- **U9–11 compose:** `appearanceToLayers(a, pose='stand')` (sit → `sit/` subtree), `sitFrame(dir)`,
  `ALL_LAYER_URLS` + `preloadAppearance` include sit layers; `drawSitAppearance` (shared
  `blitLayers`); render sit branch feet-anchored like standing; `SIT_DROP` removed.
- Previews (session scratchpad, 4× nearest): `scratchpad/poses/preview_{sit,lie,stand}.png`.
- Known weaknesses: up/down sit is a squash (reads as short legs, not a clear bend); up/down lie
  was the horizontal fallback (fixed: tucked-in lie, see above); female formal dress turns into a
  white "hem blob" at the feet in profile sit; lie uses the walk-idle stride (legs slightly apart);
  `appearanceReady` still only checks stand layers (sit layers preload together, so a gap is unlikely).
- **Pending:** U4 + U12 manual two-tab checks; user preview approval; commit.

## Furniture depth + pose fix — UNITS 1–7 DONE (2026-10-28)
Spec: `docs/specs/furniture-depth-pose-fix.md`. All 7 units implemented, committed, and pushed to
`claude/nifty-archimedes-e4o1ce`. `npm test` → **96 tests green** (was 88: +4 depth, +4 shared
layer/parseMap); `npm run typecheck --workspace client` + `npm run build` green. No protocol/network
change; existing maps render via `decorLayer` inference (no re-tag/migration).

What shipped:
- **U1** `shared/src/map.ts`: `DecorCell.layer?: 'floor'|'object'`; `parseMap` keeps a valid layer,
  strips junk (+ shared test).
- **U2** `shared/src/map.ts`: pure `decorLayer(map, cell)` = `cell.layer ?? (tileAt==1?'object':'floor')`
  (+ shared test).
- **U3** `client/src/depth.ts` (new) + `client/test/depth.test.ts`: `decorAnchorY` (`y+0.5`),
  `avatarAnchorY` (`y`), stable `sortRenderables` (anchor asc; tie → decor before avatar).
- **U4** `client/src/render.ts`: `drawMap` draws tiles+grid+**floor** decor only; new
  `drawDecorCellAt` + `drawObjectDecorFlat`.
- **U5** `client/src/render.ts`+`sprites.ts`: full-body **sit** (standing frame, col 0, lowered
  `SIT_DROP`, no crop) and **lie** (standing `down` frame rotated to point `dir`, half-tile shift).
  Removed dead `SIT_KEEP`/`LIE_COL`/`LIE_ROW` and now-unused `drawAppearanceRegion`. **[M]**
  - Lie rotation chosen: `down:0, up:π, left:+π/2, right:-π/2` (standing feet point south). The
    left/right sign is a visual guess — **flip left/right if a body lies head-first** (see checklist).
- **U6** `client/src/game.ts` `render()`: merged y-sorted pass over object-decor + all avatars
  (remotes + self), `sortRenderables`, draw back-to-front (prox ring then sprite); **final pass**
  draws all name labels + places/volumes bubbles so furniture never covers names/bubbles. Added a
  shared `Avatar` interface (self + `RemoteAvatar extends Avatar`); `drawAvatar` no longer draws the
  name (names are the top pass). **[M]**
- **U7** `client/src/editor-model.ts`: `stampDecor` writes `layer: block?'object':'floor'`;
  `editor.ts` `draw()` calls `drawObjectDecorFlat` after `drawMap`; `editor-model.test.ts`
  expectations updated (block=true cells → `layer:'object'`).

### Two-tab / browser manual checklist (units 5, 6, 7 — NOT exercised here)
1. Sit on a **plain chair** (no desk in front) → full body with **feet visible**, settled on the seat.
2. Sit on a chair with a **desk one tile below (in front, facing down)** → desk draws **over** the
   legs/feet (reads as sitting at the desk); chair stays behind.
3. Walk a standing avatar **behind** a desk/table (row above) → occluded; **in front** (row below) →
   draws over it.
4. **Lie on a bed** → whole body incl. **feet**, flat, feet pointing the seat `dir`; bed stays under.
   **If the body lies head-first, flip the left/right rotation sign** in `render.ts` `LIE_ROTATION`.
5. Second tab: a remote seated/lying/occluded avatar renders identically; **name labels never covered**
   by furniture; proximity rings + video bubbles still track.
6. Editor: all furniture still shows; stamp with "Block tiles under it" ON → occludes (object), OFF →
   stays under (floor).
7. An **existing saved map** (no `layer` fields) still renders: solid tables now occlude seated
   avatars; rugs/beds stay under (inference check).

## Project rename (2026-10-28)
Renamed in-place from "business_city" to **ByteGrounds** (top-level folder path unchanged:
`C:/Users/felip/repositories/business_city`). Display/product name → `ByteGrounds`; identifiers
→ `byte_grounds`; npm scope `@bc/*` → `@byte_grounds/*` (root + shared/server/client `package.json`
names, `@byte_grounds/shared` dependency, all `@byte_grounds/shared/{protocol,map}` imports, and the
`exports` subpaths — unchanged, still `./protocol`/`./map`). No tsconfig `paths` or vite aliases
existed; resolution is via workspace symlinks + the `exports` map, both regenerated by `npm install`.
localStorage key `bc.appearance` → `byte_grounds.appearance` (pre-release, no migration kept).
`docs/specs/business-city-mvp.md` → `docs/specs/byte-grounds-mvp.md` (git mv). Intentionally kept:
the literal folder path and dir-tree root `business_city/` in `byte-grounds-mvp.md` (folder not
renamed). After rename: `npm install`, `npm run build`, `npm run typecheck --workspace client`, and
`npm test` (52 tests) all green.

## Decor sheets fetched (2026-10-28) — AWAIT LICENSE REVIEW + COMMIT
Fetched LPC-style office/home furniture tile sheets from OpenGameArt into
`client/src/assets/decor/` (uncommitted). **Do not commit until the orchestrator reviews licenses.**
New files + their packs/authors/licenses are in `client/src/assets/decor/CREDITS.md`:
- `office.png` — assembled from "[LPC Revised] The Office" item sprites (Eliza Wyatt / Death's
  Darling, + Lanea Zimmerman / Sharm). OGA-BY 3.0 (page also lists CC-BY-SA 3.0).
- `tables_stools.png` — "Tables & Stools" by Jordan Irwin (AntumDeluge). CC-BY 3.0 / OGA-BY 3.0.
- `interior_tiles.png` — "Interior Tiles" by Connor Sherson. CC-BY-SA 3.0 / GPL 3.0.
Skipped: **LPC House Insides** (both PNGs byte-identical to existing `house_inside.png`);
**[LPC] Simple Modern Furniture** (all PNGs non-32-multiple dimensions — fail the 32px grid rule).
Fetched pack-page HTML saved for license re-check in the session scratchpad under `scratchpad/`
(`page-*.html`). `npm test` → 77 tests green; `npm run build` green (after `npm install` pulled the
previously-missing `@supabase/supabase-js`).

### More decor sheets fetched (2026-10-28, 2nd pass) — AWAIT LICENSE REVIEW + COMMIT
Added **24 new sheets** (uncommitted) to `client/src/assets/decor/`, all with CREDITS.md entries.
**Do not commit until the orchestrator reviews licenses.** Packs + licenses (all CC-BY-SA / CC-BY / CC0):
- **[LPC Revised] Base Object Kit!** (Eliza Wyatt, Lanea Zimmerman/Sharm, bluecarrot16, Hyptosis;
  CC-BY-SA 3.0 / CC-BY 3.0 / CC0) → `chairs.png`, `armchairs.png`, `bar_stools.png`, `ottomans.png`,
  `sofas.png`, `sofas_formal.png`, `thrones.png`, `beds.png`, `beds_single.png`, `tables.png`,
  `countertops.png`, `decorative_furniture.png` (rugs + clocks), `cabinets.png`, `chests.png`,
  `lamps.png`, `curtains.png`, `pillows.png`, `flowers.png`, `plants.png`, `paintings.png`.
- **[LPC] Wooden Furniture** (bluecarrot16, Baŝto, Lanea Zimmerman/Sharm, William Thompson,
  Tuomo Untinen/Reemax, Janna/Lilius/Jannax; CC-BY-SA 3.0 / 4.0 / GPL 3.0) → `wooden_furniture.png`.
- **[LPC] Tavern** (bluecarrot16, Lanea Zimmerman/Sharm, William.Thompsonj, Jetrel, DCSS Contributors,
  Reemax, Hyptosis, Daniel Eddeland/Daneeklu, BenCreating, Evert, tapatilorenzo; CC-BY-SA 3.0) →
  `tavern_furniture.png`, `tavern_kitchen.png`, `tavern_decor.png`.
Skipped: **RPG Indoor Tileset Expansion 1** (176x192 — not a 32 multiple); **[LPC] Simple Modern
Furniture** (individual sprites, non-32 dims); **[LPC] House Insides** (byte-identical to existing
`house_inside.png`); **Home Objects** (small 192x192, overlaps existing wood sheets). Pack-page HTML
+ pack credits saved in the session scratchpad (`pages/*.html`, `ex/**/Credits*.txt`). `npm test` →
77 tests green; `npm run build` green.

## Avatar-wardrobe progress (W1-W9) — AWAIT LICENSE REVIEW + COMMIT
Implementing `docs/specs/avatar-wardrobe.md` (expanded clothing: outfit axis, more colors,
pink, business/formal). **Do not commit until the orchestrator reviews the new clothing licenses.**
Real LPC assets forced documented deviations from the spec's assumed layout (see CREDITS + report):
no single formal sheet (male formal composited from shirt+vest+tie), no female formal (composited
from underdress+sash dress), formal base color is **green** not navy, and LPC has no navy/pink
pants (recolored from white). Credit sources saved in session scratchpad (`W-credit-sources.md`,
`AUTHORS.txt`, `tree.json`).
- **W1 done** — fetched casual sheets: `torso/white_longsleeve_male.png` (LPC base),
  `torso/white_tunic_female.png` (JaidynReiman). (navy pants unavailable in LPC -> deferred to W3 recolor.)
- **W2 done** — composited business torsos: `torso/green_formal_male.png` (Thane Brimhall formal set),
  `torso/green_formal_female.png` (Sharm underdress + Thane Brimhall sash dress).
- **W3 done** — PIL recolors (CC-BY-SA derivatives): `torso/pink_{longsleeve_male,tunic_female,
  formal_male,formal_female}.png`, `legs/{navy,pink}_pants_{male,female}.png`. All 12 new PNGs
  832x1344, valid signature, alpha preserved.
- **W4 done** — `client/public/sprites/CREDITS.md`: added fetched/composite/recolor tables with
  per-layer authors + share-alike derivative notes.
- **W5 done** — `shared/src/protocol.ts`: `Appearance` gained `outfit:'casual'|'business'`; `torso`
  widened to `teal|maroon|brown|white|pink|green`, `legs` to `teal|red|white|navy|pink`.
  `server/test/room.test.ts` + `client/test/net-supabase.test.ts` fixtures gained `outfit:'casual'`.
- **W6 done** — `client/src/sprites.ts`: `OUTFIT`, `CASUAL_TORSO`, `BUSINESS_TORSO=['green','pink']`,
  widened `TORSO`/`LEGS`, `outfitTorso`, `optionsFor`; `CATEGORIES` widened (+Outfit, functional Top
  options); `appearanceToLayers` outfit branch (business→`formal`) + torso clamp to the outfit palette;
  `ALL_LAYER_URLS` rebuilt from real per-outfit palettes; 6 presets gained `outfit:'casual'` + 2 new
  presets `biz` (green/navy business M) and `pink` (casual pink F).
- **W7 done** — `sprites.ts`: `normalizeAppearance` coerces `outfit`; 5-part `serializeAppearance`
  (`body.hair.outfit.torso.legs`); `parseAppearance` tolerant of legacy 4-part strings; outfit-aware
  `shuffleAppearance` (picks outfit first, torso from that palette).
- **W8 done** — `client/test/sprites.test.ts`: outfit/formal/clamp/pink cases, legacy parse,
  shuffle-in-palette, 8-preset integrity, `ALL_LAYER_URLS` real-file existence + new-layer coverage +
  no-invented-combos. Suite 77→88 tests green; client typecheck + `npm run build` green.
- **W9 done [M]** — `client/src/main.ts`: cycling loop resolves options via `optionsFor(cat,
  appearance)`; changing Outfit clamps `torso` into the new palette before redraw. Needs two-tab
  browser verification (checklist below).

### Avatar-wardrobe real-asset notes (vs spec)
- Business base color token is **green** (not navy): BUSINESS_TORSO=['green','pink'], biz preset
  torso:'green'. Navy survives as a legs/pants color (recolored). navy_formal_* renamed green_formal_*.
- Counts: 2 fetched verbatim, 2 composited, 8 recolored (6 pink + 2 navy pants) — differs from the
  spec's assumed 6/6 split because LPC lacks single formal sheets, female formal, and navy/pink pants.

### Avatar-wardrobe W9 two-tab manual checklist
1. Join screen shows an **Outfit** row; cycling it swaps casual↔business garment in the preview.
2. **Top** arrows cycle the outfit's colors (casual: teal/maroon/brown/white/pink; business:
   green/pink); switching outfit clamps an out-of-palette color (no broken/empty preview).
3. **Pants** arrows include navy + pink.
4. **Business (M)** and **Casual Pink (F)** presets set the expected looks.
5. Shuffle produces valid combos only (no 404s in the network tab); business shows the formal
   garment; pink renders.
6. A second tab building a pink/business character renders it correctly in the first tab.

## What this is
A minimal Gather-like virtual office: 2D top-down tile map, WASD avatars moving in real time, proximity-based WebRTC audio/video for a handful of friends (2–8). Personal use, not production.

## Current state
Units **1–22 implemented** (Phases 0–7: setup, shared protocol + map, server, client core, multiplayer, proximity, full WebRTC mesh, polish). Everything compiles and all pure-logic tests pass. **MVP feature-complete** — only two-tab/media manual verification remains.

New addendum spec **`docs/specs/avatar-art.md`** (avatar pixel art, units A1–A8) is drafted and ready to implement — it replaces the colored-shape avatars with animated LPC pixel sprites.

- **Builds green:** `npm run build` (shared `tsc --noEmit`, server `tsc --noEmit`, client `vite build`) and `npm run typecheck --workspace client` all pass.
- **Tests green:** `npm test` → 31 tests across 7 files (map parsing/bounds, Room state, movement collision, proximity hysteresis, politeness, reconnect backoff, distance volume).
- **Server smoke-tested** live with two scripted ws clients: `welcome`, `presence-snapshot`, `peer-joined`, `peer-moved`, `peer-left` all relay correctly.
- **Units 12–20 need two-tab + camera/mic manual verification** (see checklist below) — all [M] work is implemented and compiling but could not be exercised in a browser here.

### How to run
```bash
npm install
npm run dev
```
- Client (Vite dev): http://localhost:5173
- Server (ws): ws://localhost:8080
- Client reads server URL from `VITE_WS_URL` (default `ws://localhost:8080`).

## Architecture notes (locked in during implementation)
- **No server build step.** Node 24 runs `server/src/index.ts` directly via native TS type
  stripping (`node --watch src/index.ts`). `@byte_grounds/shared` is consumed as `.ts` source by both
  Node (verified: node_modules workspace `.ts` imports strip fine) and Vite.
- **tsconfig.base.json** is `noEmit` + `allowImportingTsExtensions` + `verbatimModuleSyntax`;
  shared/server build scripts are `tsc --noEmit` (typecheck only), client build is `vite build`.
- All relative imports use explicit `.ts` extensions (required by Node native TS + allowed by tsc).
- `@byte_grounds/shared` exposes subpaths `@byte_grounds/shared/protocol` and `@byte_grounds/shared/map` via its `exports` map.
- Dependencies pinned via package-lock: `ws` + `@types/ws` (server), `concurrently` (root),
  `typescript` + `vite` + `vitest` + `@types/node` (dev). No others added.

## Phase 4-6 progress (units 12-20)
- **12 done** — Position broadcast (`game.ts`: ~12 Hz tick, send only on change) + remote avatars (`game.ts` `handleMessage` for presence-snapshot/peer-joined/peer-moved/peer-left; draws remotes). `main.ts` threads `net`+`selfId` into `Game` and forwards non-welcome messages. Build green.

- **13 done** — Remote interpolation (`game.ts`): remotes carry `tx/ty` targets; `peer-moved` sets target; each frame exponential-smooths `x,y` toward target (`INTERP_RATE=12`). Build green.
- **14 done** — `client/src/proximity.ts` (`distanceTiles`, `nextProxState` hysteresis 4/5) + `client/test/proximity.test.ts` (6 tests). Build + test green (21 tests total).

- **15 done** — Proximity visual wiring (`game.ts`): per-peer `ProxState` map updated each frame via `nextProxState`; `near` peers get a green ring (`drawRing`); `prox` entry cleared on `peer-left`. No media yet. Build green.

- **16 done** — `client/src/media.ts` `MediaManager`: lazy cached `acquire()` (getUserMedia video+audio), muted mirrored corner preview, Mic/Cam toggle buttons (`track.enabled`), denial notice fallback. Not yet wired into Game (wired in unit 19). Build + client typecheck green.
- **17 done** — `client/src/webrtc.ts`: `isPolite` (self < other) + `PeerLink` class — builds `RTCPeerConnection` with Google STUN, adds local tracks, forwards `onicecandidate`→`sendIce` and `ontrack`→`onTrack`, `close()`. `client/test/webrtc.test.ts` (3 tests). Test green (24 total).
- **18 done** — `client/src/webrtc.ts` `PeerLink`: perfect-negotiation handlers — `onnegotiationneeded` (makingOffer guard), `onDescription` (polite rollback / impolite ignore on glare), `onIce` (swallow errors while ignoring an offer). net.ts needed no change (it already relays signaling verbatim). Typecheck green.
- **19 done** — `client/src/webrtc.ts` `WebrtcMesh` (connect/disconnect/handleSignal/closeAll, in-flight de-dup) + `game.ts` wiring: proximity far→near calls `mesh.connect`, near→far / peer-left calls `mesh.disconnect`; offer/answer/ice routed to `mesh.handleSignal`; media acquired lazily via `MediaManager`. Build + typecheck green.
- **20 done** — `client/src/media.ts` `VideoBubbles` (per-peer `<video>` overlay layer, add/place/remove; `BUBBLE_W/H`) + `render.ts` `tileToScreen` + `game.ts`: `ontrack`→`bubbles.add`, teardown→`bubbles.remove`, bubble repositioned over each remote avatar every frame. Build + typecheck + 24 tests green.

## Units completed
1. Repo + workspaces scaffold — root `package.json` (workspaces + scripts), `tsconfig.base.json`, per-workspace `package.json`/`tsconfig.json`, `.gitignore`, git init.
2. Vite client shell — `client/index.html`, `vite.config.ts`, `src/main.ts`, `src/vite-env.d.ts`.
3. Protocol types + constants — `shared/src/protocol.ts`.
4. Map model + sample 20×15 office — `shared/src/map.ts` (+ `test/map.test.ts`).
5. Room state — `server/src/room.ts` (+ `test/room.test.ts`).
6. [M] ws server connect + join + presence — `server/src/index.ts`.
7. [M] ws server position + signaling relay — `server/src/index.ts` (same file).
8. Typed WS client — `client/src/net.ts`.
9. Join screen — `client/src/main.ts`.
10. Canvas + map render — `client/src/render.ts`, `client/src/game.ts`.
11. [M] Input + local movement + collision — `client/src/input.ts`, `client/src/movement.ts` (+ `test/movement.test.ts`); movement integrated into `game.ts`.

## Awaiting manual two-tab verification ([M] units 12–20)
All implemented, compile, and pass unit tests, but need a human with two browser tabs on
machines/profiles with a camera + mic. Use Chrome/Edge. `chrome://webrtc-internals` helps confirm
peer-connection state. **Run `npm run dev`**, open http://localhost:5173 in two tabs.

### Two-tab manual test checklist (units 12–20)
1. **Join (both tabs):** enter different names + colors, click "Join office". Both avatars render on
   the map in both tabs. *(units 9–12)*
2. **Movement sync (12):** move with WASD/arrows in tab A — tab A's avatar moves and tab B sees it
   move. Do the reverse in tab B.
3. **Interpolation (13):** remote motion in the other tab is smooth (no 12 Hz stutter) at 60 fps.
4. **Walls (11):** avatars are blocked by wall tiles in both tabs.
5. **Proximity ring (15):** walk the two avatars within ~4 tiles — a green ring appears around the
   remote avatar in each tab. Loiter at ~4.5 tiles — ring state should NOT flap. Walk ≥5 tiles apart
   — ring disappears.
6. **Media permission + preview (16):** on first time the avatars come within 4 tiles, the browser
   prompts for camera/mic. **Allow it.** A muted mirrored self-preview appears bottom-left with
   "Mic: on" / "Cam: on" buttons. (If you Deny, a red notice shows and you can still move/see others.)
7. **WebRTC connect + video bubbles (17–20):** within 4 tiles, after allowing media, a video bubble
   showing the OTHER person's camera appears floating above their avatar in each tab, and their audio
   is audible. The bubble follows their avatar as they move. (Confirm `connected` in
   `chrome://webrtc-internals` if a bubble is black.)
8. **Toggles (16):** click "Mic: off" — other tab stops hearing you (bubble video still shows).
   Click "Cam: off" — other tab's bubble of you goes black/frozen. Toggling back restores both.
9. **Disconnect on distance (19–20):** walk ≥5 tiles apart — the video bubbles disappear and the
   peer connection tears down (ring gone too). Walk back within 4 — it reconnects.
10. **Peer leave (7/19):** close one tab — in the surviving tab that avatar, its ring, and its video
    bubble all vanish.
11. **Status banner (21):** on load an amber "Connecting…" banner flashes, then clears once joined.
12. **Auto-reconnect (21) [needs two tabs]:** with both tabs joined and connected, stop the server
    (Ctrl-C the `npm run dev` server, or kill the ws process) — both tabs show amber "Reconnecting…".
    Restart the server (`npm run dev:server`) within ~a few attempts — each tab re-joins (new peerId),
    the banner clears, avatars reappear in both tabs, and proximity/video re-establishes on approach.
    Leave the server down past 5 attempts (~20s) — banner goes red "Disconnected — reload to retry".
13. **Distance volume (22):** with two connected peers, walk them from ~1 tile apart to ~4 tiles apart
    — the remote audio should audibly fade (gain 1.0 → ~0.25) and swell back as they close in. (Needs
    working mic/audio on both ends; verify with headphones to avoid feedback.)

### Notes / caveats for the tester
- Two tabs in the **same** browser profile may share one camera; use two profiles/devices or a
  virtual camera if the second bubble is black.
- STUN-only (no TURN): on symmetric NAT across different networks the PC may never reach `connected`
  (bubble stays black). On localhost/LAN it should connect fine. Documented spec caveat.
- Glare: both peers fire `negotiationneeded` on connect; perfect-negotiation (polite rollback /
  impolite ignore) should prevent console errors — watch the console for `InvalidState`/glare errors.

## Phase 7 progress (units 21-22)
- **21 done** — Status banner + auto-reconnect + edge cleanup.
  - `net.ts`: `NetClient` now stores join params + handlers, auto-reconnects on unexpected
    close with exponential backoff (`reconnectDelay(n)` = 500ms·2^(n-1), capped 10s, up to
    `MAX_RECONNECTS=5`), re-sends `join` on every reopen, and reports a `NetStatus`
    (`connecting`/`open`/`reconnecting`/`closed`) via `onStatus`. `close()` sets an intentional
    flag + clears the pending timer so a deliberate close never triggers reconnect.
  - `main.ts`: owns a fixed top `#net-banner` wired to `onStatus` (hidden when open; amber
    "Connecting…"/"Reconnecting…", red "Disconnected — reload to retry"). On a *second* `welcome`
    (reconnect) it calls `game.onReconnect(newSelfId)` instead of recreating the Game.
  - `game.ts`: `onReconnect(selfId)` adopts the fresh id, `mesh.closeAll()` + `mesh.setSelfId()`,
    clears `remotes`/`prox`, resets `sentX/sentY` so position re-broadcasts. Remotes re-arrive via
    the new presence snapshot; bubbles are torn down through the mesh `onClosed` callback.
  - `webrtc.ts`: `WebrtcMesh.setSelfId()` (selfId no longer readonly) so post-reconnect links get
    correct politeness.
  - Abrupt peer-leave cleanup was already robust (unit 7 server `peer-left` + `game.handleMessage`
    teardown of avatar/prox/mesh/bubble) — unchanged.
  - `index.html`: banner CSS. Tests: `client/test/net.test.ts` (3) for `reconnectDelay`.
- **22 done** (small + clean, so implemented) — Distance-based volume.
  - `media.ts`: pure `volumeForDistance(dist)` maps `[0, CONNECT_RADIUS]` → gain `[1.0 … 0.25]`
    (clamped); `VideoBubbles.setVolume(peerId, v)` sets the element volume.
  - `game.ts`: render loop sets each *near* peer's bubble volume from its current tile distance.
  - Tests: `client/test/media.test.ts` (4) for `volumeForDistance`.

## Avatar-art addendum progress (units A1–A8)
- **A1 done** — Vendored LPC assets under `client/public/sprites/` (served at `/sprites/...`).
  Discovered real folder paths via GitHub API first (guessed paths 404). All PNGs verified:
  valid signature, 832×1344, 64-grid.
  - `lpc/body/`: `male_light.png`, `female_light.png` (from `body/{male,female}/light.png`)
  - `lpc/legs/`: `{teal,red,white}_pants_male.png`, `{teal,red,white}_pants_female.png`
    (from `legs/pants/{male,female}/`)
  - `lpc/torso/`: `{teal,maroon,brown}_longsleeve_male.png` (from `torso/shirts/longsleeve/male/`),
    `{teal,maroon,brown}_tunic_female.png` (from `torso/tunics/female/`)
  - `lpc/hair/`: `{brown,black,blonde}_male.png` (from `hair/male/plain/`),
    `{brown,black,blonde}_female.png` (from `hair/female/plain/`)
  - `LICENSE/`: `cc-by-sa-3.0.txt`, `gpl-3.0.txt`, `AUTHORS.txt`; plus `CREDITS.md`.

- **A2 done** — `client/src/sprites.ts` pure half: `Direction`, `FRAME_SIZE`, `WALK_FRAMES`,
  `FRAME_MS`, `WALK_ROW`, `directionFromDelta` (dominant axis, ties→horizontal, idle keeps prev),
  `walkFrameIndex` (idle=0, cols 1-8 cycle), `Variant`, `VARIANTS` (6: m1-m3, f1-f3),
  `DEFAULT_VARIANT='m1'`. Build + typecheck green.
- **A3 done** — `client/test/sprites.test.ts` (11 tests): direction axes/signs/ties/idle,
  walkFrameIndex idle/cycle/wrap, variant integrity (unique ids, non-empty layers, `/sprites/`
  URLs, default is real). `npm test` → 42 tests green.

- **A4 done** — `shared/src/protocol.ts`: added `variant: string` to `PeerState` (after `color`)
  and `JoinMsg` (after `color`). As the spec expects, this surfaced the construct sites to fix.
- **A5 done** — `server/src/index.ts:50`: copies `variant: msg.variant` into the join `PeerState`;
  `server/test/room.test.ts:5`: literal updated with `variant: 'm1'`. Shared + server typecheck +
  42 tests green. NOTE: **client typecheck is intentionally red until A7** — `main.ts` constructs
  `JoinMsg` (`net.connect({ name, color })`) without `variant`; the variant picker in A7 fixes it.

- **A6 done** — Loader half of `client/src/sprites.ts`: URL-keyed `Image` cache, `preloadVariants`
  (idempotent, resolves on load/error), `variantReady`, `drawVariant` (blits (dir,col) frame of each
  loaded layer; skips unloaded; unknown id → default variant). `client/src/render.ts`: `drawSprite`
  (feet-anchored `destX=px-32`, `destY=py-64+FOOT_OFFSET`, `FOOT_OFFSET=16`, sets
  `imageSmoothingEnabled=false`) + `drawNameLabel` (extracted; `drawAvatar` now reuses it and stays
  as disc fallback). A6 code compiles clean; only remaining client error is the expected main.ts
  one (fixed in A7).

- **A7 done** — `client/src/main.ts`: replaced the `<input type=color>` with a 3-col variant grid
  (one button per `VARIANTS` entry, each a 64x64 `<canvas>` showing the standing frame via
  `preloadVariants`→`drawVariant(dir='down', col=0)`); clicking selects + highlights; default =
  `DEFAULT_VARIANT`. `join()`/`startGame()` thread the selected `variant` into `net.connect` and
  `Game`; a fixed `DEFAULT_COLOR='#4f8cff'` fills the still-required `color`. `client/index.html`:
  CSS for `.variant`/`#variants`/`.selected`/pixelated thumbnails. Also added `variant` to
  `SelfInfo` + the self object in `game.ts` (needed for the constructor to accept it; A8 consumes
  it). Full build (shared+server+client) green again; 42 tests green.

- **A8 done** — `client/src/game.ts`: `RemoteAvatar` + self gained `variant/dir/animMs/moving`;
  `makeRemote(PeerState)` builds remotes from presence (stores `variant`); `preloadVariants` called
  in `start()` (self) and on `presence-snapshot`/`peer-joined` (peers). New `animate(a, dx, dy, dt)`
  sets `moving` (per-frame delta > `MOVE_EPS=1e-3`), `dir` via `directionFromDelta`, and
  accumulates/resets `animMs`; applied to self (post-`stepMovement` delta) and each remote
  (post-interpolation delta). `drawCharacter(...)` replaces the two `drawAvatar` calls: draws
  `drawSprite` + `drawNameLabel` when `variantReady`, else falls back to the `drawAvatar` disc.
  Proximity ring, bubbles, volume unchanged. Full build + 42 tests green.

## Avatar-art status
**All units A1–A8 implemented.** Pure logic (A2–A5) covered by `npm test` (42) + typecheck/build.
A6–A8 are rendering/UI and need two-tab [M] browser verification (checklist below) — not exercised
in a browser here (`npm run dev` intentionally not started). Do not commit (per instructions).

### Avatar-art two-tab manual checklist (A6–A8)
1. **A7 picker:** join screen shows a 3x2 grid of 6 pixel characters (m1-m3, f1-f3), each a
   standing frame; clicking highlights the selection (blue border); default is the first (m1).
2. **A6 feet-anchored + crisp:** after joining, your character is a pixel sprite standing with its
   feet on the tile point (not floating/sunk); art is crisp, not blurred (imageSmoothing off).
   Tune `FOOT_OFFSET` (render.ts, currently 16) if feet sit slightly off.
3. **A8 self walk:** WASD/arrows animate your character through the 8-frame walk cycle and it faces
   the movement direction (up/left/down/right); stopping shows the standing frame; walls stop both
   motion and animation.
4. **A8 remote walk:** in a second tab join as a *different* variant; each tab shows the other's
   chosen character animating from its interpolated motion in the correct direction; idle = standing.
5. **Regressions intact:** name labels above sprites, green proximity ring within 4 tiles, and
   video bubbles over avatars all still work; disc fallback shows only in the brief moment before a
   variant's PNGs finish loading.

## Avatar-editor addendum progress (E1–E9) — ALL DONE
Replaces the fixed 6-variant picker with a join-screen avatar editor. Full build + typecheck +
all 52 tests green. E7–E9 are implemented but need two-tab [M] browser verification.

- **E1** `shared/src/protocol.ts` — added `Appearance` interface; replaced `variant: string`
  with `appearance: Appearance` in `PeerState` and `JoinMsg`.
- **E2** `server/src/index.ts` — join `PeerState` now copies `appearance: msg.appearance`;
  `server/test/room.test.ts` literal updated to an `appearance` object.
- **E3a/E3b/E4** `client/src/sprites.ts` — appearance-driven rewrite: `BODY/HAIR/TORSO/LEGS`,
  `CATEGORIES`, `appearanceToLayers` (male→longsleeve, female→tunic, `hair:'none'` omits hair),
  `PRESETS` (old 6), `DEFAULT_APPEARANCE` (=PRESETS[0]), `ALL_LAYER_URLS`; `normalizeAppearance`
  (coerce invalid→default), `serializeAppearance`/`parseAppearance` ("body.hair.torso.legs"),
  `shuffleAppearance(rand?)`; loader `preloadAppearance`/`preloadAll`/`appearanceReady`/
  `drawAppearance` (reuse URL-keyed cache). Removed dead `Variant`/`VARIANTS`/`DEFAULT_VARIANT`/
  `drawVariant`/`variantReady`/`preloadVariants`.
- **E5** `client/test/sprites.test.ts` — kept direction/frame cases; added appearanceToLayers
  rules, normalize invalid→default, serialize↔parse round-trip, seeded-shuffle determinism +
  bounds, PRESETS/DEFAULT/CATEGORIES integrity. 21 sprite tests (52 total).
- **E6** `client/src/render.ts` — `drawSprite` now takes `Appearance` and calls `drawAppearance`;
  anchor math unchanged.
- **E7** `client/src/game.ts` — `SelfInfo` + self + `RemoteAvatar` store `appearance`;
  `makeRemote` runs `normalizeAppearance(p.appearance)`; `preloadAppearance` on start /
  presence-snapshot / peer-joined (peers normalized before preload); `drawCharacter` uses
  `appearanceReady` + `drawSprite(ctx, appearance, ...)`; disc fallback intact. **[M]**
- **E8a/E8b** `client/src/main.ts` + `client/index.html` — join-screen editor: 96px live preview
  canvas drawing the standing frame via `drawAppearance`, `preloadAll()` then initial `redraw()`;
  per-`CATEGORIES` prev/next arrow cycling (wrap) → update appearance + redraw; Shuffle button;
  6 preset quick-start buttons. `join`/`startGame` thread `appearance`. CSS for editor/axes/
  presets/preview. **[M]**
- **E9** `client/src/main.ts` — localStorage `byte_grounds.appearance`: load via `parseAppearance` on editor
  init (fallback default), save via `serializeAppearance` on join. **[M]**
- **E0** skipped (optional author-time extra assets), per instructions.

### Avatar-editor two-tab manual checklist (E7–E9)
1. **E8a live preview:** join screen shows a 96px preview of the default (or last-saved) character
   standing, crisp (pixelated), facing down.
2. **E8b controls:** prev/next arrows on Body/Hair/Shirt/Pants cycle options (wrap-around) and the
   preview updates instantly; Shuffle randomizes all four axes; each of the 6 preset buttons sets a
   known look. `hair:'none'` shows a bald character.
3. **E7 self render:** after Join, your avatar in-world matches the character you built; walks/faces
   correctly; name label + proximity ring + video bubbles still work; disc only shows pre-load.
4. **E7 remote render:** a second tab building a different appearance renders that exact character in
   the first tab (and vice versa); garbage/unknown fields normalize to defaults (no 404s).
5. **E9 persistence:** reload the page → the editor restores your last-used appearance.

**Representation change:** the single `variant: string` is replaced (pre-release, clean break)
by a structured `appearance: Appearance` object in `JoinMsg` + `PeerState`:
`{ body:'male'|'female'; hair:'brown'|'black'|'blonde'|'none'; torso:'teal'|'maroon'|'brown';
legs:'teal'|'red'|'white' }`. `body` doubles as the style selector (male→longsleeve shirt,
female→tunic) and picks the sex-specific legs/hair file, so the 4 axes map onto the already-
vendored layers exactly (2×4×3×3 = 72 combos, **no new assets**). `sprites.ts` becomes
appearance-driven (`appearanceToLayers`, `normalizeAppearance`, `serialize/parseAppearance`,
`shuffleAppearance`, `CATEGORIES`, `PRESETS` = old 6, `DEFAULT_APPEARANCE`, `preloadAppearance`,
`drawAppearance`), reusing the existing URL-keyed image cache.

Units E1–E9 (+ optional E0), ~50 LOC each, dependency-ordered:
- **E1** protocol: add `Appearance`, swap `variant`→`appearance` in `JoinMsg`/`PeerState`.
- **E2** server copies `appearance`; fix `room.test.ts` literal.
- **E3a** sprites: option arrays, `CATEGORIES`, `appearanceToLayers`, `PRESETS`, defaults.
- **E3b** sprites: normalize / serialize / parse / shuffle.
- **E4** sprites: appearance loader (`drawAppearance`/`preloadAppearance`/`preloadAll`/
  `appearanceReady`); remove dead `variant`-era exports.
- **E5** rewrite `sprites.test.ts` (keep dir/frame cases; add appearance cases).
- **E6** `render.ts` `drawSprite` takes `Appearance`.
- **E7** `game.ts` appearance integration. **(MANUAL)**
- **E8a** editor scaffold + live preview. **(MANUAL)**
- **E8b** category controls + shuffle + presets. **(MANUAL)**
- **E9** optional localStorage persistence. **(MANUAL)**
- **E0** optional author-time extra LPC assets (skip unless requested).

E1–E6 are covered by `npm test` + typecheck; E7–E9 need two-tab [M] verification. Expect the
**client** typecheck to be intentionally red between E6 and E7 (drawSprite signature change),
mirroring the avatar-art rollout; `shared`+`server` stay green from E2 on. **Do not touch
`client/src/media.ts`** — the self-camera-preview bug is being fixed concurrently there.
Delegate one unit at a time to the Implementer; Architect reviews each before the next.

## Previously completed: Avatar-art addendum (A1–A8)
Avatar-art addendum complete (now superseded on the join screen by the avatar-editor above, which
replaces the fixed `variant` with a structured `appearance`). Remaining: two-tab manual
verification (MVP units 12–22 checklist above + avatar-art A6–A8 checklist); optional Architect
`/code-review` before the first commit. Units A1–A8, ~50 LOC each, dependency-ordered. A1 was an
author-time asset task (list the real `legs/torso/hair` filenames via the GitHub API before
downloading — guessed paths 404). A2–A5 are covered by `npm test`/typecheck; A6–A8 need two-tab
[M] verification. Source is `jrconway3/Universal-LPC-spritesheet` (CC-BY-SA 3.0 / GPL 3.0 —
license files + CREDITS.md vendored). Do **not** use Habbo/Gather proprietary art.

Delegate one unit at a time to the Implementer; Architect reviews each before the next.

## Other remaining work
- Units 12–22 still need the two-tab + camera/mic manual verification checklist above.
- Optional Architect `/code-review` pass before the first real commit.

### Wiring reference (as built in 12–20)
- `main.ts` threads `net` + `selfId` into `Game` and forwards every non-`welcome` message to
  `game.handleMessage`.
- `Game` owns `MediaManager`, `VideoBubbles`, and `WebrtcMesh`; proximity transitions in
  `updateProximity` drive `mesh.connect`/`mesh.disconnect`; signaling is routed via `mesh.handleSignal`.
- `webrtc.ts` holds `isPolite`, `PeerLink` (perfect negotiation), and `WebrtcMesh` (lifecycle).

## Open questions / assumptions (unchanged)
- Camera: whole-map fixed view (small office). Revisit if map grows.
- Reconnect issues a fresh `peerId` (no session resumption) — assumed acceptable.
- No video-bubble cap at 8 peers — assumed fine.
- No commits made yet beyond the initial `git init` staging — nothing committed; commit when asked.
