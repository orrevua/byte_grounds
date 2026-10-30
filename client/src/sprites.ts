import { TILE_SIZE } from '@byte_grounds/shared/protocol';
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
export const HAIR = ['brown', 'black', 'blonde', 'none'] as const;
export const OUTFIT = ['casual', 'business'] as const;
/** Top colors available per outfit (a torso color only exists for one family). */
export const CASUAL_TORSO = ['teal', 'maroon', 'brown', 'white', 'pink'] as const;
export const BUSINESS_TORSO = ['green', 'pink'] as const; // green = the base LPC formal color; pink = recolor
/** Full torso union (type + normalize): CASUAL_TORSO ∪ BUSINESS_TORSO. */
export const TORSO = ['teal', 'maroon', 'brown', 'white', 'pink', 'green'] as const;
export const LEGS = ['teal', 'red', 'white', 'navy', 'pink'] as const;

/** Top colors offered for a given outfit (casual vs business palette). */
export function outfitTorso(outfit: Appearance['outfit']): readonly string[] {
  return outfit === 'business' ? BUSINESS_TORSO : CASUAL_TORSO;
}

/** Drives the editor's per-category controls generically. */
export const CATEGORIES: {
  key: keyof Appearance;
  label: string;
  options: readonly string[] | ((a: Appearance) => readonly string[]);
}[] = [
  { key: 'body', label: 'Body', options: BODY },
  { key: 'hair', label: 'Hair', options: HAIR },
  { key: 'outfit', label: 'Outfit', options: OUTFIT },
  { key: 'torso', label: 'Top', options: (a) => outfitTorso(a.outfit) },
  { key: 'legs', label: 'Pants', options: LEGS },
];

/** Resolve a category's options, invoking the function form against the current appearance. */
export function optionsFor(c: (typeof CATEGORIES)[number], a: Appearance): readonly string[] {
  return typeof c.options === 'function' ? c.options(a) : c.options;
}

/**
 * Ordered bottom→top layer URLs (body, legs, torso, hair) for an appearance. `sit` resolves the
 * same files under the generated `sit/` subtree; `stand`/`lie`/`dance` use the walk sheets.
 */
export function appearanceToLayers(a: Appearance, pose: Pose = 'stand'): string[] {
  const root = pose === 'sit' ? `${LPC}/sit` : LPC;
  const style = a.outfit === 'business' ? 'formal' : a.body === 'male' ? 'longsleeve' : 'tunic';
  const palette = outfitTorso(a.outfit);
  const topColor = palette.includes(a.torso) ? a.torso : palette[0];
  const layers = [
    `${root}/body/${a.body}_light.png`,
    `${root}/legs/${a.legs}_pants_${a.body}.png`,
    `${root}/torso/${topColor}_${style}_${a.body}.png`,
  ];
  if (a.hair !== 'none') layers.push(`${root}/hair/${a.hair}_${a.body}.png`);
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

/** The old 6 variants re-expressed as appearances, offered as quick-start presets. */
export const PRESETS: { id: string; label: string; appearance: Appearance }[] = [
  { id: 'm1', label: 'Teal (M)', appearance: { body: 'male', hair: 'brown', outfit: 'casual', torso: 'teal', legs: 'teal' } },
  { id: 'm2', label: 'Maroon (M)', appearance: { body: 'male', hair: 'black', outfit: 'casual', torso: 'maroon', legs: 'red' } },
  { id: 'm3', label: 'Brown (M)', appearance: { body: 'male', hair: 'blonde', outfit: 'casual', torso: 'brown', legs: 'white' } },
  { id: 'f1', label: 'Teal (F)', appearance: { body: 'female', hair: 'brown', outfit: 'casual', torso: 'teal', legs: 'teal' } },
  { id: 'f2', label: 'Maroon (F)', appearance: { body: 'female', hair: 'black', outfit: 'casual', torso: 'maroon', legs: 'red' } },
  { id: 'f3', label: 'Brown (F)', appearance: { body: 'female', hair: 'blonde', outfit: 'casual', torso: 'brown', legs: 'white' } },
  { id: 'biz', label: 'Business (M)', appearance: { body: 'male', hair: 'black', outfit: 'business', torso: 'green', legs: 'navy' } },
  { id: 'pink', label: 'Casual Pink (F)', appearance: { body: 'female', hair: 'blonde', outfit: 'casual', torso: 'pink', legs: 'pink' } },
];

export const DEFAULT_APPEARANCE: Appearance = PRESETS[0].appearance;

/** The full vendored PNG set (every real per-outfit combination's stand + sit layers), deduped. */
export const ALL_LAYER_URLS: string[] = [
  ...new Set(
    BODY.flatMap((body) =>
      HAIR.flatMap((hair) =>
        LEGS.flatMap((legs) =>
          OUTFIT.flatMap((outfit) =>
            outfitTorso(outfit).flatMap((torso) => {
              const a: Appearance = { body, hair, outfit, torso: torso as Appearance['torso'], legs };
              return [...appearanceToLayers(a), ...appearanceToLayers(a, 'sit')];
            }),
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
  };
}

/** Compact form for localStorage / preset keys: "body.hair.outfit.torso.legs". */
export function serializeAppearance(a: Appearance): string {
  return `${a.body}.${a.hair}.${a.outfit}.${a.torso}.${a.legs}`;
}

/**
 * Parse a serialized form back into a validated Appearance. Backward tolerant:
 * a legacy 4-part string (no `outfit`) still parses — `outfit` normalizes to the default.
 */
export function parseAppearance(s: string): Appearance {
  const parts = s.split('.');
  const [body, hair] = parts;
  const [outfit, torso, legs] =
    parts.length >= 5 ? parts.slice(2) : [undefined, parts[2], parts[3]];
  return normalizeAppearance({ body, hair, outfit, torso, legs });
}

function pick<T>(options: readonly T[], rand: () => number): T {
  return options[Math.floor(rand() * options.length)];
}

/** Pick a random option per category. Deterministic for a seeded `rand`. */
export function shuffleAppearance(rand: () => number = Math.random): Appearance {
  const outfit = pick(OUTFIT, rand);
  return {
    body: pick(BODY, rand),
    hair: pick(HAIR, rand),
    outfit,
    torso: pick(outfitTorso(outfit), rand) as Appearance['torso'],
    legs: pick(LEGS, rand),
  };
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

/** Preload every stand + sit layer image (and the bed blanket) for the appearance (idempotent via the cache). */
export function preloadAppearance(a: Appearance): Promise<void> {
  return preloadUrls([...appearanceToLayers(a), ...appearanceToLayers(a, 'sit'), BLANKET_URL]);
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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Original-art blanket (tools/gen_blanket.py); its size matches `tuckLayout().blanket`. */
export const BLANKET_URL = '/sprites/blanket.png';
/** Head center row and the shoulder cut (rows kept) of a standing up/down frame. */
const TUCK_HEAD_Y = 22;
const TUCK_CROP = 38;
/** Blanket: one tile wide minus a 3px inset per side, from the shoulders to the bed's foot end. */
const BLANKET_INSET = 3;
const BLANKET_TOP = 11;

/**
 * Tucked-in lie (up/down beds), in local px around the pillow-tile center with the feet toward
 * +y; draw rotated by `rot`. `down`: the face-on `down` frame. `up`: the back-of-head `up` frame
 * turned π (the head points at the viewer, so the crown shows; an upside-down face reads badly).
 * The head sits on the pillow, only the top `crop` rows (head + shoulders) are drawn, and the
 * blanket covers the rest of the 2-tile bed.
 */
export function tuckLayout(dir: Direction): {
  src: Direction;
  rot: number;
  frameX: number;
  frameY: number;
  crop: number;
  blanket: Rect;
} {
  const bottom = TILE_SIZE * 1.5 - 2; // foot end of the 2-tile bed, inside its outline
  return {
    src: dir === 'up' ? 'up' : 'down',
    rot: dir === 'up' ? Math.PI : 0,
    frameX: -FRAME_SIZE / 2,
    frameY: -TUCK_HEAD_Y - 2,
    crop: TUCK_CROP,
    blanket: {
      x: -TILE_SIZE / 2 + BLANKET_INSET,
      y: BLANKET_TOP,
      w: TILE_SIZE - 2 * BLANKET_INSET,
      h: bottom - BLANKET_TOP,
    },
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

/** Tucked-in lie at local origin (see `tuckLayout`): head + shoulders, then the blanket over the body. */
export function drawTuckedAppearance(ctx: CanvasRenderingContext2D, a: Appearance, dir: Direction): void {
  const { src, frameX, frameY, crop, blanket } = tuckLayout(dir);
  blitLayers(ctx, appearanceToLayers(a), 0, WALK_ROW[src] * FRAME_SIZE, frameX, frameY, crop);
  const img = loadImage(BLANKET_URL);
  if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, blanket.x, blanket.y, blanket.w, blanket.h);
}
