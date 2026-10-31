# Spec: Portuguese (pt-BR) version

## Goal
Every screen of ByteGrounds (join screen, in-game HUD/chat/meeting/build, map editor, Sheet Studio)
can be shown in English or Brazilian Portuguese, chosen by the player.

## Design
- `client/src/i18n.ts` (pure apart from `localStorage`/`navigator`/`location`):
  - `type Lang = 'en' | 'pt'`; `LANG_KEY = 'byte_grounds.lang'`.
  - `detectLang(saved, navLang)`: a saved `en`/`pt` wins, else `pt` when the browser language starts
    with `pt`, else `en`. `lang` is resolved once at module load.
  - `t(key, vars?)`: the current language's string with `{name}` placeholders filled; falls back to
    English. Keys are the English table's keys (`type MsgKey = keyof typeof en`), and the
    Portuguese table is `Record<MsgKey, string>`, so a missing translation is a type error.
  - `setLang(l)`: saves and reloads the page (all UI is built at startup; a reload is the simplest
    correct re-render). `langSwitch()`: a small `EN | PT` `<select>` element wired to `setLang`.
  - `applyI18n(root)`: fills `[data-i18n]` (text), `[data-i18n-title]`, `[data-i18n-placeholder]`
    in static HTML; sets `document.documentElement.lang`.
- Strings move from the modules into the tables, grouped by key prefix: `join.*`, `axis.*`,
  `preset.*`, `hud.*`, `chat.*`, `meet.*`, `media.*`, `game.*`, `build.*`, `picker.*`, `menu.*`,
  `live.*`, `editor.*`, `studio.*`.
- Language switch: on the join screen (next to the brand), the map editor header and the Sheet
  Studio header.
- Not translated: map names and other user content, chat text, protocol values, console logs,
  thrown internal errors, Sheet Studio's agent-facing JSON keys.

## Units
1. `i18n.ts` + tests (detectLang, interpolation, fallback, every pt string non-empty and with the
   same `{placeholders}` as en).
2. Join screen + presets + editor axis labels.
3. In-game: hud, chat help, meeting, media, minimap, zoom, game buttons/toasts, avatar menu, build
   panel, decor picker, live-map errors.
4. Map editor.
5. Sheet Studio.

## Verify
`npx vitest run`, `cd client && npx tsc --noEmit`, `npm run build`; Playwright pass in `pt` over
join → game → editor → studio with no English left in visible chrome.
