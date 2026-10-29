import type { Appearance } from '@byte_grounds/shared/protocol';

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
export const TORSO = ['teal', 'maroon', 'brown'] as const;
export const LEGS = ['teal', 'red', 'white'] as const;

/** Drives the editor's per-category controls generically. */
export const CATEGORIES: { key: keyof Appearance; label: string; options: readonly string[] }[] = [
  { key: 'body', label: 'Body', options: BODY },
  { key: 'hair', label: 'Hair', options: HAIR },
  { key: 'torso', label: 'Shirt', options: TORSO },
  { key: 'legs', label: 'Pants', options: LEGS },
];

/** Ordered bottom→top layer URLs (body, legs, torso, hair) for an appearance. */
export function appearanceToLayers(a: Appearance): string[] {
  const style = a.body === 'male' ? 'longsleeve' : 'tunic';
  const layers = [
    `${LPC}/body/${a.body}_light.png`,
    `${LPC}/legs/${a.legs}_pants_${a.body}.png`,
    `${LPC}/torso/${a.torso}_${style}_${a.body}.png`,
  ];
  if (a.hair !== 'none') layers.push(`${LPC}/hair/${a.hair}_${a.body}.png`);
  return layers;
}

/** The old 6 variants re-expressed as appearances, offered as quick-start presets. */
export const PRESETS: { id: string; label: string; appearance: Appearance }[] = [
  { id: 'm1', label: 'Teal (M)', appearance: { body: 'male', hair: 'brown', torso: 'teal', legs: 'teal' } },
  { id: 'm2', label: 'Maroon (M)', appearance: { body: 'male', hair: 'black', torso: 'maroon', legs: 'red' } },
  { id: 'm3', label: 'Brown (M)', appearance: { body: 'male', hair: 'blonde', torso: 'brown', legs: 'white' } },
  { id: 'f1', label: 'Teal (F)', appearance: { body: 'female', hair: 'brown', torso: 'teal', legs: 'teal' } },
  { id: 'f2', label: 'Maroon (F)', appearance: { body: 'female', hair: 'black', torso: 'maroon', legs: 'red' } },
  { id: 'f3', label: 'Brown (F)', appearance: { body: 'female', hair: 'blonde', torso: 'brown', legs: 'white' } },
];

export const DEFAULT_APPEARANCE: Appearance = PRESETS[0].appearance;

/** The full vendored PNG set (every option combination's layers), deduped. */
export const ALL_LAYER_URLS: string[] = [
  ...new Set(
    BODY.flatMap((body) =>
      HAIR.flatMap((hair) =>
        TORSO.flatMap((torso) =>
          LEGS.flatMap((legs) => appearanceToLayers({ body, hair, torso, legs })),
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
    torso: coerce(o.torso, TORSO, DEFAULT_APPEARANCE.torso),
    legs: coerce(o.legs, LEGS, DEFAULT_APPEARANCE.legs),
  };
}

/** Compact form for localStorage / preset keys: "body.hair.torso.legs". */
export function serializeAppearance(a: Appearance): string {
  return `${a.body}.${a.hair}.${a.torso}.${a.legs}`;
}

/** Parse a serialized form back into a validated Appearance. */
export function parseAppearance(s: string): Appearance {
  const [body, hair, torso, legs] = s.split('.');
  return normalizeAppearance({ body, hair, torso, legs });
}

function pick<T>(options: readonly T[], rand: () => number): T {
  return options[Math.floor(rand() * options.length)];
}

/** Pick a random option per category. Deterministic for a seeded `rand`. */
export function shuffleAppearance(rand: () => number = Math.random): Appearance {
  return {
    body: pick(BODY, rand),
    hair: pick(HAIR, rand),
    torso: pick(TORSO, rand),
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

/** Preload every layer image for the given appearance (idempotent via the cache). */
export function preloadAppearance(a: Appearance): Promise<void> {
  return preloadUrls(appearanceToLayers(a));
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

/** Last frame of the "hurt" row: the character flat on the ground, feet toward the top. */
export const LIE_ROW = 20;
export const LIE_COL = 5;
/** Sitting = the standing frame with the legs hidden (rows below SIT_KEEP), lowered SIT_DROP px. */
export const SIT_KEEP = 46;
export const SIT_DROP = 10;

/** Blit a source region of every loaded layer (all layers share one sheet layout). */
export function drawAppearanceRegion(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  destX: number,
  destY: number,
): void {
  for (const url of appearanceToLayers(a)) {
    const img = cache.get(url);
    if (!img || !img.complete || img.naturalWidth === 0) continue;
    ctx.drawImage(img, sx, sy, sw, sh, destX, destY, sw, sh);
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
  const sx = col * FRAME_SIZE;
  const sy = WALK_ROW[dir] * FRAME_SIZE;
  for (const url of appearanceToLayers(a)) {
    const img = cache.get(url);
    if (!img || !img.complete || img.naturalWidth === 0) continue;
    ctx.drawImage(img, sx, sy, FRAME_SIZE, FRAME_SIZE, destX, destY, FRAME_SIZE, FRAME_SIZE);
  }
}
