# Knighthood

The admin can knight anyone from the avatar menu. A knight wears a gold crown and a red cape that everyone sees. Knighthood gives no extra powers.

- **Data:** a third global permission, `knight`, in `public.grants` (`supabase/admin.sql`; the perm check is widened, and re-running the file is safe). RLS and the live `postgres_changes` feed stay as they are, so it reaches every client right away.
- **Client:**
  - `Perm` gets `'knight'` (grants.ts).
  - Avatar menu: a "Knighted (crown + cape)" toggle for the admin.
  - game.ts `isKnight(uidOf(a))` draws `drawCape(..., 'back')` before the sprite, `'front'` after it (only when facing away), and `drawCrown` last, after a backrest is redrawn.
  - Tags get `crown` (+5 px lift).
- **Render** (render.ts): flat pixel shapes in frame space (`frameOrigin` follows `SIT_LIFT`). Dance poses use the front view. Hidden while lying in bed.
- **Dev ws mode:** there are no grants there, so nobody can be knighted.
