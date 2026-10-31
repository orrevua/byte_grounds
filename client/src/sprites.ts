import type { Appearance, Pose } from '@byte_grounds/shared/protocol';

export type Direction = 'up' | 'left' | 'down' | 'right';

/** LPC frame is 64x64 px; sheets are a 13x21 grid of frames. */
export const FRAME_SIZE = 64;
/** Walk cycle uses cols 1-8 (col 0 is the standing/idle frame). */
export const WALK_FRAMES = 8;
/** Per-frame duration → ~10 fps walk cadence. */
export const FRAME_MS = 100;

/** Walk-cycle sheet rows by facing direction. */
export const WALK_ROW: Record<Direction, number> = {
  up: 8,
  left: 9,
  down: 10,
  right: 11,
};

/**
 * Pick a facing from a movement delta. Below epsilon on both axes keeps the
 * previous facing (idle doesn't spin). Otherwise the dominant axis wins; screen
 * y grows downward so dy > 0 is down.
 */
export function directionFromDelta(dx: number, dy: number, prev: Direction): Direction {
  const EPS = 1e-4;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return prev;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

/** Column index into the sheet: cycling cols 1-8 while moving, else col 0 (standing). */
export function walkFrameIndex(animMs: number, moving: boolean): number {
  if (!moving) return 0;
  return 1 + (Math.floor(animMs / FRAME_MS) % WALK_FRAMES);
}

// --- Appearance model (E3a) ---

const LPC = '/sprites/lpc';

/** Per-axis option tables (the literal unions in `Appearance`). */
export const BODY = ['male', 'female'] as const;
export const SKIN = ['light', 'olive', 'tan', 'brown', 'dark', 'orc', 'skeleton'] as const;
/** Creature skins (the only ones that may go without clothes). */
export const CREATURES: readonly Appearance['skin'][] = ['orc', 'skeleton'];
export const HAIR = ['brown', 'black', 'blonde', 'none'] as const;
export const OUTFIT = ['casual', 'business', 'none'] as const;
/** Top colors available per outfit (a torso color only exists for one family). */
export const CASUAL_TORSO = ['teal', 'maroon', 'brown', 'white', 'pink'] as const;
export const BUSINESS_TORSO = ['green', 'pink'] as const; // green = the base LPC formal color; pink = recolor
/** Full torso union (type + normalize): CASUAL_TORSO ∪ BUSINESS_TORSO. */
export const TORSO = ['teal', 'maroon', 'brown', 'white', 'pink', 'green'] as const;
export const LEGS = ['teal', 'red', 'white', 'navy', 'pink'] as const;

/** Top colors offered for a given outfit (business palette; casual otherwise, also for bare). */
export function outfitTorso(outfit: Appearance['outfit']): readonly string[] {
  return outfit === 'business' ? BUSINESS_TORSO : CASUAL_TORSO;
}

/**
 * Body sheets offered for a sex: every skin for both. LPC ships no female skeleton, so
 * `female_skeleton.png` is the (unisex) male skeleton sheet; female clothes and hair fit it.
 */
export function skinsFor(_body: Appearance['body']): readonly Appearance['skin'][] {
  return SKIN;
}

/** Outfits offered for a skin: only creatures may go bare. */
export function outfitsFor(skin: Appearance['skin']): readonly Appearance['outfit'][] {
  return CREATURES.includes(skin) ? OUTFIT : ['casual', 'business'];
}

/** Clamp the cross-axis combos: skin per sex, outfit per skin, top color per outfit. */
export function fitAppearance(a: Appearance): Appearance {
  const skin = skinsFor(a.body).includes(a.skin) ? a.skin : 'light';
  const outfit = outfitsFor(skin).includes(a.outfit) ? a.outfit : 'casual';
  const palette = outfitTorso(outfit);
  const torso = outfit === 'none' || palette.includes(a.torso) ? a.torso : (palette[0] as Appearance['torso']);
  return { ...a, skin, outfit, torso };
}

/** Drives the editor's per-category controls generically. */
export const CATEGORIES: {
  key: keyof Appearance;
  label: string;
  options: readonly string[] | ((a: Appearance) => readonly string[]);
}[] = [
  { key: 'body', label: 'Body', options: BODY },
  { key: 'skin', label: 'Skin', options: (a) => skinsFor(a.body) },
  { key: 'hair', label: 'Hair', options: HAIR },
  { key: 'outfit', label: 'Outfit', options: (a) => outfitsFor(a.skin) },
  { key: 'torso', label: 'Top', options: (a) => outfitTorso(a.outfit) },
  { key: 'legs', label: 'Pants', options: LEGS },
];

/** Resolve a category's options, invoking the function form against the current appearance. */
export function optionsFor(c: (typeof CATEGORIES)[number], a: Appearance): readonly string[] {
  return typeof c.options === 'function' ? c.options(a) : c.options;
}

/**
 * Ordered bottom→top layer URLs (body, legs, torso, hair) for an appearance, after
 * `fitAppearance`; a bare outfit draws no legs or torso. `sit` resolves the same files under the
 * generated `sit/` subtree; `stand`/`lie`/`dance` use the walk sheets.
 */
export function appearanceToLayers(a: Appearance, pose: Pose = 'stand'): string[] {
  const f = fitAppearance(a);
  const root = pose === 'sit' ? `${LPC}/sit` : LPC;
  const layers = [`${root}/body/${f.body}_${f.skin}.png`];
  if (f.outfit !== 'none') {
    const style = f.outfit === 'business' ? 'formal' : f.body === 'male' ? 'longsleeve' : 'tunic';
    layers.push(`${root}/legs/${f.legs}_pants_${f.body}.png`, `${root}/torso/${f.torso}_${style}_${f.body}.png`);
  }
  if (f.hair !== 'none') layers.push(`${root}/hair/${f.hair}_${f.body}.png`);
  return layers;
}

/** Sit-sheet column per facing (one row; written by tools/gen_pose_sheets.py). */
const SIT_COL: Record<Direction, number> = { up: 0, left: 1, down: 2, right: 3 };

/** Frame of the seated pose for a facing within a sit sheet. */
export function sitFrame(dir: Direction): { row: number; col: number } {
  return { row: 0, col: SIT_COL[dir] };
}

// --- Dance (a looping sequence choreographed from the cast / walk / slash rows) ---

export type DanceAnim = 'cast' | 'walk' | 'slash';

/** One dance frame: which animation frame to draw and a whole-pixel sway (dx) / bob (dy, - = up). */
export interface DanceStep {
  anim: DanceAnim;
  dir: Direction;
  col: number;
  dx: number;
  dy: number;
}

/** 8 fps; every dancer derives the step from a shared wall clock, so they stay on the beat. */
export const DANCE_FRAME_MS = 125;

/** LPC universal sheet rows per animation and facing. */
export const ANIM_ROW: Record<DanceAnim, Record<Direction, number>> = {
  cast: { up: 0, left: 1, down: 2, right: 3 },
  walk: WALK_ROW,
  slash: { up: 12, left: 13, down: 14, right: 15 },
};

/** Frames per row of each animation (column bound). */
export const ANIM_FRAMES: Record<DanceAnim, number> = { cast: 7, walk: 9, slash: 6 };

const step = (anim: DanceAnim, dir: Direction, col: number, dx: number, dy: number): DanceStep => ({
  anim,
  dir,
  col,
  dx,
  dy,
});

/**
 * Arm pump, a spin on standing frames, left/right arm swings, arms high, two bouncy steps.
 * Every frame used is drawn in every vendored layer and creature body (checked at author time),
 * so no step needs a walk-frame fallback.
 */
export const DANCE_STEPS: readonly DanceStep[] = [
  step('walk', 'down', 0, 0, 0),
  step('cast', 'down', 2, -1, -1),
  step('cast', 'down', 3, 0, -2),
  step('cast', 'down', 2, 1, -1),
  step('walk', 'right', 0, 1, 0),
  step('walk', 'up', 0, 0, -1),
  step('walk', 'left', 0, -1, 0),
  step('walk', 'down', 0, 0, -1),
  step('slash', 'left', 1, -2, 0),
  step('slash', 'left', 3, -2, -1),
  step('slash', 'right', 1, 2, 0),
  step('slash', 'right', 3, 2, -1),
  step('cast', 'down', 4, 0, -2),
  step('cast', 'down', 5, 0, -1),
  step('walk', 'down', 3, -1, 0),
  step('walk', 'down', 7, 1, -1),
];

export const DANCE_LOOP_MS = DANCE_STEPS.length * DANCE_FRAME_MS;

/** The dance step at a millisecond clock (wraps, negative-safe; non-finite → the first step). */
export function danceStep(ms: number): DanceStep & { row: number } {
  const n = DANCE_STEPS.length;
  const i = Number.isFinite(ms) ? ((Math.floor(ms / DANCE_FRAME_MS) % n) + n) % n : 0;
  const s = DANCE_STEPS[i];
  return { ...s, row: ANIM_ROW[s.anim][s.dir] };
}

/** The old 6 variants re-expressed as appearances plus a few extras, offered as quick-start presets. */
export const PRESETS: { id: string; label: string; appearance: Appearance }[] = [
  { id: 'm1', label: 'Teal (M)', appearance: { body: 'male', hair: 'brown', outfit: 'casual', torso: 'teal', legs: 'teal', skin: 'light' } },
  { id: 'm2', label: 'Maroon (M)', appearance: { body: 'male', hair: 'black', outfit: 'casual', torso: 'maroon', legs: 'red', skin: 'light' } },
  { id: 'm3', label: 'Brown (M)', appearance: { body: 'male', hair: 'blonde', outfit: 'casual', torso: 'brown', legs: 'white', skin: 'light' } },
  { id: 'f1', label: 'Teal (F)', appearance: { body: 'female', hair: 'brown', outfit: 'casual', torso: 'teal', legs: 'teal', skin: 'light' } },
  { id: 'f2', label: 'Maroon (F)', appearance: { body: 'female', hair: 'black', outfit: 'casual', torso: 'maroon', legs: 'red', skin: 'light' } },
  { id: 'f3', label: 'Brown (F)', appearance: { body: 'female', hair: 'blonde', outfit: 'casual', torso: 'brown', legs: 'white', skin: 'light' } },
  { id: 'biz', label: 'Business (M)', appearance: { body: 'male', hair: 'black', outfit: 'business', torso: 'green', legs: 'navy', skin: 'light' } },
  { id: 'pink', label: 'Casual Pink (F)', appearance: { body: 'female', hair: 'blonde', outfit: 'casual', torso: 'pink', legs: 'pink', skin: 'light' } },
  { id: 'orc', label: 'Orc', appearance: { body: 'male', hair: 'none', outfit: 'casual', torso: 'brown', legs: 'teal', skin: 'orc' } },
  { id: 'skel', label: 'Skeleton', appearance: { body: 'male', hair: 'none', outfit: 'none', torso: 'teal', legs: 'teal', skin: 'skeleton' } },
  { id: 'f4', label: 'Olive (F)', appearance: { body: 'female', hair: 'brown', outfit: 'casual', torso: 'white', legs: 'navy', skin: 'olive' } },
  { id: 'f5', label: 'Tan (F)', appearance: { body: 'female', hair: 'black', outfit: 'casual', torso: 'teal', legs: 'white', skin: 'tan' } },
  { id: 'f6', label: 'Dark (F)', appearance: { body: 'female', hair: 'black', outfit: 'casual', torso: 'pink', legs: 'navy', skin: 'dark' } },
  { id: 'fbiz', label: 'Business (F)', appearance: { body: 'female', hair: 'brown', outfit: 'business', torso: 'pink', legs: 'navy', skin: 'brown' } },
  { id: 'm4', label: 'Brown (M)', appearance: { body: 'male', hair: 'black', outfit: 'casual', torso: 'white', legs: 'navy', skin: 'brown' } },
  { id: 'forc', label: 'Orc (F)', appearance: { body: 'female', hair: 'black', outfit: 'casual', torso: 'maroon', legs: 'red', skin: 'orc' } },
  { id: 'fskel', label: 'Skeleton (F)', appearance: { body: 'female', hair: 'blonde', outfit: 'business', torso: 'green', legs: 'navy', skin: 'skeleton' } },
];

export const DEFAULT_APPEARANCE: Appearance = PRESETS[0].appearance;

/** The full vendored PNG set (every real per-outfit combination's stand + sit layers), deduped. */
export const ALL_LAYER_URLS: string[] = [
  ...new Set(
    BODY.flatMap((body) =>
      skinsFor(body).flatMap((skin) =>
        HAIR.flatMap((hair) =>
          LEGS.flatMap((legs) =>
            outfitsFor(skin).flatMap((outfit) =>
              outfitTorso(outfit).flatMap((torso) => {
                const a: Appearance = { body, hair, outfit, torso: torso as Appearance['torso'], legs, skin };
                return [...appearanceToLayers(a), ...appearanceToLayers(a, 'sit')];
              }),
            ),
          ),
        ),
      ),
    ),
  ),
];

// --- Validation / serialization / shuffle (E3b) ---

function coerce<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** Coerce arbitrary input into a valid Appearance; invalid/missing fields → defaults. */
export function normalizeAppearance(x: unknown): Appearance {
  const o = (x ?? {}) as Partial<Record<keyof Appearance, unknown>>;
  return {
    body: coerce(o.body, BODY, DEFAULT_APPEARANCE.body),
    hair: coerce(o.hair, HAIR, DEFAULT_APPEARANCE.hair),
    outfit: coerce(o.outfit, OUTFIT, DEFAULT_APPEARANCE.outfit),
    torso: coerce(o.torso, TORSO, DEFAULT_APPEARANCE.torso),
    legs: coerce(o.legs, LEGS, DEFAULT_APPEARANCE.legs),
    skin: coerce(o.skin, SKIN, DEFAULT_APPEARANCE.skin),
  };
}

/** Compact form for localStorage / preset keys: "body.hair.outfit.torso.legs.skin". */
export function serializeAppearance(a: Appearance): string {
  return `${a.body}.${a.hair}.${a.outfit}.${a.torso}.${a.legs}.${a.skin}`;
}

/**
 * Parse a serialized form back into a validated Appearance. Backward tolerant: a legacy 4-part
 * string (no `outfit`) or 5-part string (no `skin`) still parses — the missing field normalizes to
 * the default.
 */
export function parseAppearance(s: string): Appearance {
  const parts = s.split('.');
  const [body, hair] = parts;
  const [outfit, torso, legs, skin] =
    parts.length >= 5 ? parts.slice(2) : [undefined, parts[2], parts[3]];
  return normalizeAppearance({ body, hair, outfit, torso, legs, skin });
}

function pick<T>(options: readonly T[], rand: () => number): T {
  return options[Math.floor(rand() * options.length)];
}

/**
 * Pick a random option per category, each from the options the earlier picks allow (body → skin →
 * hair → outfit → top → pants), so the result is already `fitAppearance`-stable. Deterministic for
 * a seeded `rand`.
 */
export function shuffleAppearance(rand: () => number = Math.random): Appearance {
  const body = pick(BODY, rand);
  const skin = pick(skinsFor(body), rand);
  const hair = pick(HAIR, rand);
  const outfit = pick(outfitsFor(skin), rand);
  const torso = pick(outfitTorso(outfit), rand) as Appearance['torso'];
  return { body, hair, outfit, torso, legs: pick(LEGS, rand), skin };
}

// --- Image loading / drawing (non-pure, E4) ---

const cache = new Map<string, HTMLImageElement>();

function loadImage(url: string): HTMLImageElement {
  const cached = cache.get(url);
  if (cached) return cached;
  const img = new Image();
  img.src = url;
  cache.set(url, img);
  return img;
}

function preloadUrls(urls: Iterable<string>): Promise<void> {
  const pending = [...new Set(urls)].map(
    (url) =>
      new Promise<void>((resolve) => {
        const img = loadImage(url);
        if (img.complete) return resolve();
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      }),
  );
  return Promise.all(pending).then(() => undefined);
}

/** Preload every stand + sit layer image for the appearance (idempotent via the cache). */
export function preloadAppearance(a: Appearance): Promise<void> {
  return preloadUrls([...appearanceToLayers(a), ...appearanceToLayers(a, 'sit')]);
}

/** Preload the full vendored layer set once (editor init). */
export function preloadAll(): Promise<void> {
  return preloadUrls(ALL_LAYER_URLS);
}

/** True once every layer of the appearance has decoded (drawable without gaps). */
export function appearanceReady(a: Appearance): boolean {
  return appearanceToLayers(a).every((url) => {
    const img = cache.get(url);
    return !!img && img.complete && img.naturalWidth > 0;
  });
}

/**
 * How a lying body is drawn: on its side along a left/right bed, or tucked in face-up under a
 * blanket on an up/down bed (a rotated profile would be wider than a vertical bed).
 */
export function lieMode(dir: Direction): 'side' | 'tucked' {
  return dir === 'left' || dir === 'right' ? 'side' : 'tucked';
}

/**
 * Side-lie (left/right beds): which profile frame to draw and its clockwise rotation so the feet
 * point `dir` and the belly faces the viewer (screen-down). The side is chosen by the source
 * frame, not the angle.
 */
export function lieTransform(dir: Direction): { src: Direction; rot: number } {
  return dir === 'left'
    ? { src: 'right', rot: Math.PI / 2 }
    : { src: 'left', rot: -Math.PI / 2 };
}

/** Px shift from the pillow-tile center along the feet so the head rests on the pillow. */
export const LIE_SHIFT = 8;

/** Head center row and the shoulder cut (rows kept) of a standing up/down frame. */
const TUCK_HEAD_Y = 22;
const TUCK_CROP = 38;
/** Shift of the head toward the feet: at 0 the chin meets the pillow tile's edge, where the blanket starts. */
const HEAD_ON_PILLOW = 0;
/** One slow breath: the sleeper's head and shoulders rise 1px and settle. */
export const BREATH_MS = 3600;

/** 0 or 1 px: the breathing offset at a millisecond clock (out of phase per sleeper via `seed`). */
export function breathOffset(ms: number, seed = 0): number {
  if (!Number.isFinite(ms)) return 0;
  const t = (((ms + seed) % BREATH_MS) + BREATH_MS) % BREATH_MS;
  return t < BREATH_MS / 2 ? 0 : 1;
}

/**
 * Tucked-in lie (up/down beds), in local px around the pillow-tile center with the feet toward
 * +y; draw rotated by `rot`. `down`: the face-on `down` frame. `up`: the back-of-head `up` frame
 * turned π (the head points at the viewer, so the crown shows; an upside-down face reads badly).
 * The head rests on the pillow and only the top `crop` rows (head + shoulders) are drawn: the
 * bed's own blanket cells are drawn back over the body (see `Game.drawBedOver`).
 */
export function tuckLayout(dir: Direction): {
  src: Direction;
  rot: number;
  frameX: number;
  frameY: number;
  crop: number;
} {
  return {
    src: dir === 'up' ? 'up' : 'down',
    rot: dir === 'up' ? Math.PI : 0,
    frameX: -FRAME_SIZE / 2,
    frameY: -TUCK_HEAD_Y + HEAD_ON_PILLOW,
    crop: TUCK_CROP,
  };
}

function blitLayers(
  ctx: CanvasRenderingContext2D,
  urls: string[],
  sx: number,
  sy: number,
  destX: number,
  destY: number,
  h: number = FRAME_SIZE,
): void {
  for (const url of urls) {
    const img = cache.get(url);
    if (!img || !img.complete || img.naturalWidth === 0) continue;
    ctx.drawImage(img, sx, sy, FRAME_SIZE, h, destX, destY, FRAME_SIZE, h);
  }
}

/** Blit the (dir, col) frame of each loaded layer to (destX, destY). Skips unloaded layers. */
export function drawAppearance(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  dir: Direction,
  col: number,
  destX: number,
  destY: number,
): void {
  blitLayers(ctx, appearanceToLayers(a), col * FRAME_SIZE, WALK_ROW[dir] * FRAME_SIZE, destX, destY);
}

/** Blit the seated frame for `dir` of each loaded sit layer to (destX, destY). Skips unloaded layers. */
export function drawSitAppearance(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  dir: Direction,
  destX: number,
  destY: number,
): void {
  const { row, col } = sitFrame(dir);
  blitLayers(ctx, appearanceToLayers(a, 'sit'), col * FRAME_SIZE, row * FRAME_SIZE, destX, destY);
}

/** Blit the dance step at `ms` of each loaded stand layer to (destX, destY), shifted by its sway/bob. */
export function drawDanceAppearance(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  ms: number,
  destX: number,
  destY: number,
): void {
  const { row, col, dx, dy } = danceStep(ms);
  blitLayers(ctx, appearanceToLayers(a), col * FRAME_SIZE, row * FRAME_SIZE, destX + dx, destY + dy);
}

/** Tucked-in lie at local origin (see `tuckLayout`): head + shoulders on the pillow, `breath` px lower. */
export function drawTuckedAppearance(ctx: CanvasRenderingContext2D, a: Appearance, dir: Direction, breath = 0): void {
  const { src, frameX, frameY, crop } = tuckLayout(dir);
  blitLayers(ctx, appearanceToLayers(a), 0, WALK_ROW[src] * FRAME_SIZE, frameX, frameY + breath, crop);
}

/** The face / head box of the standing down-facing frame (frame px), used for chat-balloon avatars. */
export const HEAD_CROP = { x: 18, y: 10, w: 28, h: 26 } as const;

/** Draw the appearance's head (down-facing, standing) scaled into a `w`x`h` box at (destX, destY). */
export function drawHead(ctx: CanvasRenderingContext2D, a: Appearance, destX: number, destY: number, w: number, h: number): void {
  const sy = WALK_ROW.down * FRAME_SIZE + HEAD_CROP.y;
  for (const url of appearanceToLayers(a)) {
    const img = cache.get(url);
    if (!img || !img.complete || img.naturalWidth === 0) continue;
    ctx.drawImage(img, HEAD_CROP.x, sy, HEAD_CROP.w, HEAD_CROP.h, destX, destY, w, h);
  }
}
