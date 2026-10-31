# Sheet Studio: an admin sprite & tile sheet creator for humans and agents

**Date:** 2026-10-31 · **Branch:** `master`

## Goal
An admin-only page (`/sheets`) to draw pixel-art sheets on the 32px LPC cell grid (furniture like
the Gather-style office in `Captura de tela.png`: white desks with monitors, office chairs, plants,
bean bags, whiteboards, carpets), save them, and place their pieces in the map editor and the live
Build panel. Agents get the same power through a text format (**SheetSpec**) usable from the page,
from the browser console, and from a CLI that writes repo assets.

## SheetSpec v1 (the shared format)
```jsonc
{
  "version": 1,
  "name": "modern_office",          // id-safe; becomes the sheet id
  "cols": 8, "rows": 4,             // size in 32px cells (max 32 x 32)
  "palette": { "k": "#1b1f26", "w": "#f4f4f2" },  // 1-char keys; colors "#rgb[a]" / "#rrggbb[aa]"
  "ops": [                          // applied in order, pixel coordinates on the sheet
    { "op": "rect", "x": 2, "y": 4, "w": 28, "h": 12, "color": "w", "outline": "k" },
    { "op": "ellipse", "x": 0, "y": 0, "w": 16, "h": 10, "color": "#5fa04e", "outline": "k" },
    { "op": "line", "x1": 0, "y1": 0, "x2": 10, "y2": 4, "color": "k" },
    { "op": "pixels", "x": 0, "y": 0, "rows": ["..kk..", ".kwwk."] },  // '.' or ' ' = skip
    { "op": "fill", "x": 5, "y": 5, "color": "w" },                    // flood fill (4-way)
    { "op": "shade", "x": 0, "y": 0, "w": 32, "h": 4, "amount": -0.2 }, // darken (<0) / lighten
    { "op": "outline", "x": 0, "y": 0, "w": 64, "h": 64, "color": "k" },// ring around art
    { "op": "copy", "x": 0, "y": 0, "w": 32, "h": 32, "toX": 32, "toY": 0, "flipX": true },
    { "op": "clear", "x": 0, "y": 0, "w": 32, "h": 32 }
  ],
  "pieces": [ { "name": "desk", "x": 0, "y": 0, "w": 2, "h": 2 } ]  // optional, cells; documentation
}
```
`client/src/sprite-spec.ts` (pure, no DOM): `parseSpec` (validation with readable errors),
`renderSpec` (RGBA buffer), `applyOps` (onto an existing buffer), `bufferToSpec` (any image back to
text: auto palette + one `pixels` op per non-empty row band), `parseColor`.

## Page (`client/sheets.html`, `src/sheet-studio.ts`)
- Gate: Supabase → `ensureSession` + `checkIsAdmin`, else "Admins only". Local dev: open.
- Tools: pencil, eraser, fill, line, rectangle, filled rectangle, ellipse, eyedropper, select (cell
  rect). Mirror-X drawing. Undo/redo (Ctrl+Z / Ctrl+Y). Zoom 4–16x, cell grid + pixel grid.
- Color: picker + alpha, palette tuned to the Gather look, recent colors.
- Selection actions: copy / paste (at the hovered cell), flip, outline, shade, clear.
- "Borrow from game art": the existing decor picker; paste the picked cells into the sheet.
- Background: dark / checker / beige floor / purple carpet, and a 2x preview of the selection.
- New / Load PNG / Import spec / Export PNG / Export spec / Save / Delete; list of saved sheets.
- `window.sheetStudio`: `new(name, cols, rows)`, `load(spec)`, `apply(ops)`, `spec()`, `png()`,
  `save()`, `list()`, `open(id)` — documented on the page ("Agent API") and in
  `docs/sheet-studio.md`.

## Storage
`supabase/sheets.sql` (idempotent): `public.decor_sheets(id text pk, name text, png text (data
URL), cols int, rows int, updated_at, updated_by uuid default auth.uid())`; RLS read all, write
`is_admin()`. `Store.listSheets / saveSheet / deleteSheet`; LocalStore uses localStorage.
Saved sheets get the id `custom_<name>`.

## Integration
`decor.ts` `registerSheet(id, url)` (adds to the picker list; replaces the image on update) and
`loadCustomSheets(store)`. The game registers custom sheets before loading the map; the editor
before opening a map, then refreshes its picker (`mountDecorPicker(...).refreshSheets()`).
Custom sheets have no seat rules (documented).

## Agents offline
`tools/sheet_spec.mts` (Node, no deps): `render spec.json out.png` and `dump in.png > spec.json`
(PNG decoder for 8-bit RGBA/RGB/gray/palette). Starter art made this way:
`docs/sprite-specs/modern_office.json` → `client/src/assets/decor/modern_office.png` (CC0), with
seat rules for its chairs.

## Units
1. sprite-spec.ts + tests. 2. Storage (SQL, store) + decor registry. 3. Page. 4. Game/editor
integration + links. 5. CLI + docs. 6. Starter sheet.
