# Sheet Studio guide (humans and agents)

Sheet Studio (`/sheets`, admin only) draws pixel-art **sheets** on the game's 32px cell grid. A
saved sheet is listed in the map editor's Decoration picker and the live Build panel right away
(id `custom_<name>`). Pieces are placed exactly like the built-in LPC art.

Two ways to make art:

| Who | Where | Result |
| --- | --- | --- |
| Human | `/sheets` in the browser: draw, borrow game art, Save | stored in Supabase (`decor_sheets`), usable at once |
| Agent in the browser | `window.sheetStudio` on `/sheets` (console / automation) | same as above |
| Agent in the repo | `node tools/sheet_spec.mts render spec.json client/src/assets/decor/<name>.png` | a built-in sheet after the next deploy |

All three speak **SheetSpec v1**, a JSON text format.

## Look and conventions
- 32x32 px cells. A piece takes whole cells (a desk 2x2, a chair 1x1, a lamp 1x2). Leave a
  transparent margin of ~2px so pieces don't touch; the picker cuts pieces at transparent gaps.
- 3/4 top-down view, light from the top-left. 1px dark outline (`#2b2d42`), a lighter highlight
  line on top surfaces, a darker band on front faces.
- A soft floor shadow under each piece: a translucent ellipse (`#00000033`) at its base.
- Chairs come facing each way (separate pieces): facing down (seat toward the viewer) and facing
  up (backrest in front). Don't rely on rotating chairs.
- Floor tiles fill the whole cell, edge to edge, so they tile seamlessly.
- See `docs/sprite-specs/modern_office.json` (desk with monitor, office chairs, bean bags,
  plant, whiteboard, sofa, tree, lamp, bookshelf, floors) for a complete example in the
  Gather-like office style.

## SheetSpec v1
```json
{
  "version": 1,
  "name": "my_sheet",
  "cols": 4, "rows": 2,
  "palette": { "k": "#2b2d42", "w": "#f4f4f6", "s": "#00000033" },
  "ops": [
    { "op": "ellipse", "x": 4, "y": 54, "w": 56, "h": 8, "color": "s" },
    { "op": "rect", "x": 2, "y": 14, "w": 60, "h": 26, "color": "w", "outline": "k" }
  ],
  "pieces": [ { "name": "desk", "x": 0, "y": 0, "w": 2, "h": 2 } ],
  "seats": [ { "x": 2, "y": 0, "kind": "sit", "dir": "down" } ]
}
```
- `cols` / `rows`: sheet size in cells, 1..32.
- `palette`: one-character keys to colors (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`). Anywhere a
  color is expected you may use a key or a literal `#hex`. `.` and space are never keys.
- `ops` run in order, in **pixel** coordinates on the sheet (cell `(cx, cy)` starts at
  `(cx*32, cy*32)`). Translucent colors blend over what is below.

| op | fields | does |
| --- | --- | --- |
| `rect` | `x y w h`, `color?`, `outline?` | filled and/or 1px outlined rectangle |
| `ellipse` | `x y w h`, `color?`, `outline?` | filled and/or outlined ellipse in that box |
| `line` | `x1 y1 x2 y2 color` | 1px line, both ends included |
| `pixels` | `x y rows[]` | a pixel block; each row is a string of palette keys, `.` = leave as is |
| `fill` | `x y color` | flood fill (4-way) of the region at that pixel |
| `outline` | `x y w h color` | 1px ring around the art inside the box |
| `shade` | `x y w h amount` | darken (`-1..0`) or lighten (`0..1`) existing pixels |
| `copy` | `x y w h toX toY flipX? flipY?` | copy a block (e.g. mirror a left half to the right) |
| `clear` | `x y w h` | make the box transparent |

`pieces` is optional documentation (cell rects + names); the picker finds pieces on its own.

`seats` makes cells sittable once placed: **cell** coordinates, `kind` `sit` or `lie`, `dir` = the way
the person faces (a bed: where the feet point). Mark the seat cell, usually the cushion, not the
backrest. In the page: Select cells → Seats → Sit / facing → **Mark selected cells** (badges show
on the canvas). Example: `docs/sprite-specs/office_chairs.json` (the screenshot's charcoal swivel
chairs and blue meeting chairs, both facings).

## In the browser: `window.sheetStudio`
```js
sheetStudio.new('cafe_props', 4, 2)
sheetStudio.apply([{ op: 'rect', x: 4, y: 4, w: 24, h: 20, color: '#e8b77a', outline: '#2b2d42' }])
// → [] (or a list of problems)
sheetStudio.load(spec)          // replace the sheet with a SheetSpec → problems[]
sheetStudio.spec()              // the current sheet as a SheetSpec (to read or edit it as text)
sheetStudio.png()               // data URL
await sheetStudio.save()        // → 'custom_cafe_props' (admins only)
sheetStudio.seats([{ x: 0, y: 0, kind: 'sit', dir: 'down' }])   // → problems[]; seats() reads them
await sheetStudio.list(); await sheetStudio.open('custom_cafe_props'); sheetStudio.rename('x')
```
`spec()` turns any sheet into text: an automatic palette and one `pixels` op per used cell, so an
agent can read existing art, change rows, and `load()` it back.

## In the repo: `tools/sheet_spec.mts`
```sh
node tools/sheet_spec.mts check  docs/sprite-specs/my_sheet.json
node tools/sheet_spec.mts render docs/sprite-specs/my_sheet.json client/src/assets/decor/my_sheet.png
node tools/sheet_spec.mts dump   client/src/assets/decor/chairs.png > chairs.json   # read any sheet as text
```
A PNG in `client/src/assets/decor/` is listed in the picker after the next build. Add a row to
`client/src/assets/decor/CREDITS.md` (original art: CC0). To make chairs or sofas sittable, add
rules for the sheet to `shared/src/seat-catalog.json` (see the `modern_office` rules).

## Notes
- Seats of a saved sheet apply everywhere at once (game, editor badges). Repo sheets
  (`tools/sheet_spec.mts render`) still take their seats from `shared/src/seat-catalog.json`.
- Deleting a saved sheet makes pieces already placed with it stop drawing.
- Setup: run `supabase/sheets.sql` once in the Supabase SQL editor (after `admin.sql`).
