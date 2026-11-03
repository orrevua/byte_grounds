# Spec: Gemini refresh (everyday furniture only, new pastel sheets, rooms rebuilt, Office default)

## Goals
1. The pickers (map editor, Build panel, Sheet Studio's borrow panel) offer only everyday furniture,
   plants and flowers: castle / medieval / tavern sheets are hidden (they still load and draw where a
   map already uses them).
2. More furniture in the Gemini style (cozy, cartoonish, pastel top-down 3/4 pixel art), made with
   the Gemini MCP and converted like the earlier Gemini sheets.
3. The built-in rooms (Office, Lounge & Café, Home) rebuilt with Gemini art only.
4. Office is the default room on the join screen.

## 1. Picker listing
`client/src/decor.ts` `HIDDEN_SHEETS`: castle, thrones, tavern_decor, tavern_furniture,
tavern_kitchen, chests, wooden_furniture, upholstery, stairs, sofas_formal, paintings, interior
(+ their `_grid` repacks). `DECOR_SHEETS` drops them and lists the Gemini sheets first.

## 2. New sheets (Gemini MCP → `tools/pixelate_image.py --scale 3.54` → `tools/repack_decor.py`)
Prompts ask for an asset sheet (flat background, wide gaps, no chairs touching tables), front-facing
3/4 camera, the reference `art/gemini/studio_furniture.png` + the office pack JPG for style.
- `gemini_living`: pastel sofas (facing down and up), armchairs (down, up), coffee tables, side
  tables, rugs, TV console, floor lamps, bookshelves, sideboard.
- `gemini_plants`: potted plants (small to tall), flower vases, hanging/planter boxes, cacti,
  succulents, flower beds, small trees in pots.
- `gemini_cafe`: café counter with espresso machine, pastry display, bar stools, round café tables,
  café chairs (down, up), menu board, fridge, coffee bags shelf.
Seat rules for every new chair / sofa / stool / bed go in `shared/src/seat-catalog.json`; the drink
machines (`client/src/dispensers.ts`) learn the new espresso machine / water cooler cells.

## 3. Rooms
`tools/build_maps.py` gets catalog entries for the Gemini sheets (studio, office2, building,
home, lounge, office, and the new ones) and rebuilds `office`, `lounge`, `home` with Gemini floors,
walls, doors/windows and furniture; zones and drink machines kept (Office has a meeting room and
coffee + water; the Lounge has coffee). Revs bumped to 2: copies saved from rev 1 stop hiding them
(their rows stay in Supabase; the editor's Delete removes them).

## 4. Default room
`DEFAULT_MAP` / `DEFAULT_ROOM` = office (first in `BUILT_IN_MAPS`); the join screen always
preselects it.

## Verify
vitest (maps rules, dispensers, seats), tsc, build; editor screenshots of each rebuilt map; a walk
through the game.
