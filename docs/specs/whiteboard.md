# Spec: whiteboards you can draw on

## Goal
Whiteboards in the rooms work: walk up to one, open it full screen (your character drawn big beside
it), draw like in Paint / Excalidraw, organize pages in tabs. Everyone sees the same board live, and
it is still there next time.

## Which pieces are whiteboards
`client/src/whiteboard-model.ts` lists the sheet cells (the studio whiteboard, the office2 projector
screen). A board's id is `<map id>:<x>,<y>` of the piece's top-left tile. Standing within reach, the
action button (F, shared with the drink / snack machines; the nearest wins) says "Open whiteboard".

## Data (`shared/src/board.ts`, pure, tested)
- `BoardState = { tabs: Tab[] }`, `Tab = { id, name, items: Item[] }`.
- `Item = { id, by, kind, color, width, ... }`: `pen` / `marker` (points, flattened ints), `line`,
  `arrow`, `rect`, `ellipse` (x1 y1 x2 y2, `fill` for shapes), `text` (x, y, text, size). Board space
  is a fixed 1600x1000 (scaled to fit the screen).
- `BoardOp`: `add` (tab, item), `remove` (tab, id), `clear` (tab), `tab-add`, `tab-rename`,
  `tab-remove`. `normalizeBoardOp` validates everything that comes from the network (sizes, counts,
  colors, coordinates); `applyBoardOp` is idempotent (an `add` of a known id is ignored), so ops can
  arrive twice or out of a saved snapshot.
- Limits: 12 tabs, 3000 items per tab, 2000 points per stroke, 300-char text.

## Sync and saving
- Live: `{ type: 'board', board, op }` relayed to the room (ws server: same room; Supabase: a
  broadcast event). Every applied op re-renders open views.
- Saved: `Store.loadBoard(id)` / `saveBoard(id, state)`: Supabase table `whiteboards` (id, data jsonb,
  updated_at; `supabase/whiteboards.sql`, readable by everyone, writable by signed-in sessions incl.
  anonymous guests, data under 2 MB); local dev: localStorage. Opening loads the snapshot and applies
  live ops on top; edits save the whole state, debounced 1.5 s (clients that saw the same ops write
  the same state). Without the table the board still syncs live, a note says it can't be saved.

## UI (`client/src/whiteboard.ts`)
Full-screen overlay: header (board name, tabs with add / rename / close, Esc / close button), a tool
bar (pen, marker, eraser, line, arrow, rectangle, ellipse, text; 8 colors; 3 widths; fill toggle for
shapes; undo your last; clear page; export PNG), the board canvas, and a side panel with your
character scaled up (4x, pixelated, idle bob; the arm-raised frame while you draw). The eraser
removes whole items it touches (like Excalidraw). Text: click, type in an inline field, Enter.
Mobile: the side panel shrinks to a strip; touch draws with pointer events.

## Units
1. `shared/src/board.ts` + tests. 2. Protocol message + ws/Supabase relay. 3. Store + SQL + README.
4. `whiteboard.ts` view. 5. Game wiring (detection, F button), i18n, CSS. 6. Verify in the browser.

## Addendum: my sign (2026-11-03)

At a whiteboard, the side panel under your big character has "🪧 Make my sign":

- You enter a text (at most `SIGN_MAX` = 40 characters), pick one of `SIGN_COLORS` and how long to hold it (5, 15, 30 or 60 minutes, or until you put it down).
- The sign rides the status path: `StatusFields.sign = { text, color, until }`, coerced by `normalizeSign`. `signUp(sign, now)` says whether it's still up.
- `render.ts` `drawSign` shows it to everyone:
  - a card at chest height with up to 3 lines of text, and hands on its sides;
  - its cardboard back, behind the body, when facing away;
  - hidden while lying in bed.
- When the time is up, the owner's client clears it.
- Back at a board, the panel shows the sign with "Put it down" and "Change it".
- The panel is hidden on phones for now.
