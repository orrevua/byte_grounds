import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  directionFromDelta,
  walkFrameIndex,
  WALK_FRAMES,
  FRAME_MS,
  BODY,
  HAIR,
  OUTFIT,
  TORSO,
  LEGS,
  CASUAL_TORSO,
  BUSINESS_TORSO,
  outfitTorso,
  optionsFor,
  CATEGORIES,
  PRESETS,
  DEFAULT_APPEARANCE,
  ALL_LAYER_URLS,
  appearanceToLayers,
  normalizeAppearance,
  serializeAppearance,
  parseAppearance,
  shuffleAppearance,
  lieTransform,
  sitFrame,
} from '../src/sprites.ts';
import type { Direction } from '../src/sprites.ts';
import type { Appearance } from '@byte_grounds/shared/protocol';

const casual = (o: Partial<Appearance>): Appearance =>
  normalizeAppearance({ body: 'male', hair: 'brown', outfit: 'casual', torso: 'teal', legs: 'teal', ...o });

describe('directionFromDelta', () => {
  it('picks the dominant axis by sign', () => {
    expect(directionFromDelta(1, 0, 'down')).toBe('right');
    expect(directionFromDelta(-1, 0, 'down')).toBe('left');
    expect(directionFromDelta(0, 1, 'down')).toBe('down');
    expect(directionFromDelta(0, -1, 'down')).toBe('up');
  });

  it('breaks ties toward the horizontal axis', () => {
    expect(directionFromDelta(1, 1, 'up')).toBe('right');
    expect(directionFromDelta(-1, -1, 'up')).toBe('left');
  });

  it('lets the larger axis win', () => {
    expect(directionFromDelta(0.3, 1, 'left')).toBe('down');
    expect(directionFromDelta(1, 0.3, 'up')).toBe('right');
  });

  it('keeps the previous facing when idle (below epsilon)', () => {
    const dirs: Direction[] = ['up', 'left', 'down', 'right'];
    for (const d of dirs) {
      expect(directionFromDelta(0, 0, d)).toBe(d);
      expect(directionFromDelta(1e-6, -1e-6, d)).toBe(d);
    }
  });
});

describe('lieTransform', () => {
  it('lays the profile frame on its side, feet toward dir, belly toward the viewer', () => {
    expect(lieTransform('left')).toEqual({ src: 'right', rot: Math.PI / 2 });
    expect(lieTransform('right')).toEqual({ src: 'left', rot: -Math.PI / 2 });
  });

  it('falls back to a horizontal side-lie for up/down', () => {
    expect(lieTransform('up')).toEqual({ src: 'right', rot: Math.PI / 2 });
    expect(lieTransform('down')).toEqual({ src: 'left', rot: -Math.PI / 2 });
  });

  it('rotates the feet (local 0,+28) to the dir side and the belly to screen-down', () => {
    for (const dir of ['left', 'right'] as const) {
      const { src, rot } = lieTransform(dir);
      const rotate = (x: number, y: number) => ({
        x: Math.round(x * Math.cos(rot) - y * Math.sin(rot)) + 0,
        y: Math.round(x * Math.sin(rot) + y * Math.cos(rot)),
      });
      const feet = rotate(0, 28);
      const belly = rotate(src === 'right' ? 1 : -1, 0);
      expect(Math.sign(feet.x)).toBe(dir === 'left' ? -1 : 1);
      expect(belly).toEqual({ x: 0, y: 1 });
    }
  });
});

describe('walkFrameIndex', () => {
  it('returns the standing frame (0) when idle', () => {
    expect(walkFrameIndex(0, false)).toBe(0);
    expect(walkFrameIndex(9999, false)).toBe(0);
  });

  it('cycles through cols 1..8 while moving', () => {
    expect(walkFrameIndex(0, true)).toBe(1);
    expect(walkFrameIndex(FRAME_MS, true)).toBe(2);
    expect(walkFrameIndex(FRAME_MS * (WALK_FRAMES - 1), true)).toBe(WALK_FRAMES);
  });

  it('wraps back to col 1 after the last walk frame', () => {
    expect(walkFrameIndex(FRAME_MS * WALK_FRAMES, true)).toBe(1);
  });
});

describe('appearanceToLayers', () => {
  it('casual uses a longsleeve shirt for male and a tunic for female', () => {
    const male = appearanceToLayers(casual({ body: 'male' }));
    const female = appearanceToLayers(casual({ body: 'female' }));
    expect(male.some((u) => u.includes('teal_longsleeve_male'))).toBe(true);
    expect(female.some((u) => u.includes('teal_tunic_female'))).toBe(true);
  });

  it('business uses the formal garment for both sexes', () => {
    const male = appearanceToLayers(casual({ body: 'male', outfit: 'business', torso: 'green' }));
    const female = appearanceToLayers(casual({ body: 'female', outfit: 'business', torso: 'green' }));
    expect(male.some((u) => u.includes('green_formal_male'))).toBe(true);
    expect(female.some((u) => u.includes('green_formal_female'))).toBe(true);
  });

  it('clamps an out-of-palette torso color into the current outfit', () => {
    // teal is a casual color; business must fall back to BUSINESS_TORSO[0] (green), not 404.
    const biz = appearanceToLayers(casual({ outfit: 'business', torso: 'teal' }));
    expect(biz.some((u) => u.includes('green_formal_male'))).toBe(true);
    expect(biz.some((u) => u.includes('teal_formal'))).toBe(false);
    // green is a business color; casual must fall back to CASUAL_TORSO[0] (teal).
    const cas = appearanceToLayers(casual({ outfit: 'casual', torso: 'green' }));
    expect(cas.some((u) => u.includes('teal_longsleeve_male'))).toBe(true);
    expect(cas.some((u) => u.includes('green_longsleeve'))).toBe(false);
  });

  it("omits the hair layer when hair is 'none'", () => {
    const withHair = appearanceToLayers(casual({ hair: 'brown' }));
    const noHair = appearanceToLayers(casual({ hair: 'none' }));
    expect(withHair.some((u) => u.includes('/hair/'))).toBe(true);
    expect(noHair.some((u) => u.includes('/hair/'))).toBe(false);
    expect(noHair.length).toBe(withHair.length - 1);
  });

  it('selects sex-specific body and legs files (incl. pink pants)', () => {
    const layers = appearanceToLayers(casual({ body: 'female', torso: 'maroon', legs: 'pink' }));
    expect(layers).toContain('/sprites/lpc/body/female_light.png');
    expect(layers).toContain('/sprites/lpc/legs/pink_pants_female.png');
  });

  it('serves every valid combination from /sprites/', () => {
    for (const body of BODY)
      for (const hair of HAIR)
        for (const outfit of OUTFIT)
          for (const torso of outfitTorso(outfit))
            for (const legs of LEGS)
              for (const url of appearanceToLayers(casual({ body, hair, outfit, torso, legs } as Partial<Appearance>)))
                expect(url.startsWith('/sprites/')).toBe(true);
  });
});

describe('normalizeAppearance', () => {
  it('coerces invalid / missing fields to defaults', () => {
    expect(normalizeAppearance({})).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance('garbage')).toEqual(DEFAULT_APPEARANCE);
    expect(
      normalizeAppearance({ body: 'alien', hair: 'green', outfit: 'party', torso: 'x', legs: 'y' }),
    ).toEqual(DEFAULT_APPEARANCE);
  });

  it('coerces an unknown outfit to the default', () => {
    expect(normalizeAppearance({ outfit: 'nope' }).outfit).toBe(DEFAULT_APPEARANCE.outfit);
  });

  it('keeps valid fields (incl. outfit and widened colors)', () => {
    const a: Appearance = { body: 'female', hair: 'none', outfit: 'business', torso: 'green', legs: 'navy' };
    expect(normalizeAppearance(a)).toEqual(a);
  });
});

describe('serialize / parse round-trip', () => {
  it('round-trips every preset (5-part)', () => {
    for (const p of PRESETS) {
      expect(serializeAppearance(p.appearance).split('.')).toHaveLength(5);
      expect(parseAppearance(serializeAppearance(p.appearance))).toEqual(p.appearance);
    }
  });

  it('parses a legacy 4-part string (no outfit) → outfit defaults to casual', () => {
    const legacy = parseAppearance('female.black.maroon.red');
    expect(legacy).toEqual({ body: 'female', hair: 'black', outfit: 'casual', torso: 'maroon', legs: 'red' });
  });

  it('parses garbage to the default appearance', () => {
    expect(parseAppearance('not-valid')).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('shuffleAppearance', () => {
  it('is deterministic for a seeded rand and yields valid options', () => {
    const seq = [0.1, 0.9, 0.5, 0.99, 0.3];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    const a = shuffleAppearance(rand);
    i = 0;
    const b = shuffleAppearance(rand);
    expect(a).toEqual(b);
    expect(normalizeAppearance(a)).toEqual(a);
  });

  it('always picks a torso color within the chosen outfit palette', () => {
    let i = 0;
    const rand = () => [0.05, 0.37, 0.61, 0.83, 0.12, 0.95, 0.5, 0.2][i++ % 8];
    for (let n = 0; n < 40; n++) {
      const a = shuffleAppearance(rand);
      expect(outfitTorso(a.outfit)).toContain(a.torso);
    }
  });

  it('respects rand bounds (0 → first option, →1 → last option)', () => {
    expect(shuffleAppearance(() => 0)).toEqual({
      body: BODY[0], hair: HAIR[0], outfit: OUTFIT[0], torso: CASUAL_TORSO[0], legs: LEGS[0],
    });
    expect(shuffleAppearance(() => 0.999999)).toEqual({
      body: BODY[BODY.length - 1],
      hair: HAIR[HAIR.length - 1],
      outfit: OUTFIT[OUTFIT.length - 1],
      torso: BUSINESS_TORSO[BUSINESS_TORSO.length - 1],
      legs: LEGS[LEGS.length - 1],
    });
  });
});

describe('PRESETS / DEFAULT_APPEARANCE integrity', () => {
  it('has 8 presets with unique, non-empty ids', () => {
    expect(PRESETS.length).toBe(8);
    const ids = PRESETS.map((p) => p.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the Business and Casual Pink presets', () => {
    const biz = PRESETS.find((p) => p.id === 'biz');
    const pink = PRESETS.find((p) => p.id === 'pink');
    expect(biz?.appearance).toMatchObject({ outfit: 'business', torso: 'green', legs: 'navy' });
    expect(pink?.appearance).toMatchObject({ outfit: 'casual', torso: 'pink', legs: 'pink' });
  });

  it('every preset appearance normalizes to itself', () => {
    for (const p of PRESETS) expect(normalizeAppearance(p.appearance)).toEqual(p.appearance);
  });

  it('DEFAULT_APPEARANCE is the first preset and is valid', () => {
    expect(DEFAULT_APPEARANCE).toEqual(PRESETS[0].appearance);
    expect(normalizeAppearance(DEFAULT_APPEARANCE)).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('CATEGORIES / options', () => {
  it('covers every editable axis (incl. outfit)', () => {
    expect(CATEGORIES.map((c) => c.key).sort()).toEqual(['body', 'hair', 'legs', 'outfit', 'torso']);
  });

  it('resolves the Top options from the current outfit', () => {
    const top = CATEGORIES.find((c) => c.key === 'torso')!;
    expect(optionsFor(top, casual({ outfit: 'casual' }))).toEqual(CASUAL_TORSO);
    expect(optionsFor(top, casual({ outfit: 'business' }))).toEqual(BUSINESS_TORSO);
    const body = CATEGORIES.find((c) => c.key === 'body')!;
    expect(optionsFor(body, casual({}))).toEqual(BODY);
  });

  it('TORSO union is CASUAL_TORSO ∪ BUSINESS_TORSO', () => {
    expect(new Set(TORSO)).toEqual(new Set([...CASUAL_TORSO, ...BUSINESS_TORSO]));
  });
});

describe('sit pose layers', () => {
  it('keeps the walk-sheet URLs for stand (default) and lie', () => {
    const a = casual({});
    expect(appearanceToLayers(a, 'stand')).toEqual(appearanceToLayers(a));
    expect(appearanceToLayers(a, 'lie')).toEqual(appearanceToLayers(a));
  });

  it('resolves the same files under the sit/ subtree for sit', () => {
    for (const a of PRESETS.map((p) => p.appearance)) {
      const sit = appearanceToLayers(a, 'sit');
      expect(sit).toEqual(appearanceToLayers(a).map((u) => u.replace('/sprites/lpc/', '/sprites/lpc/sit/')));
    }
  });

  it('pins the sit-sheet frame per facing (one row: up, left, down, right)', () => {
    expect(sitFrame('up')).toEqual({ row: 0, col: 0 });
    expect(sitFrame('left')).toEqual({ row: 0, col: 1 });
    expect(sitFrame('down')).toEqual({ row: 0, col: 2 });
    expect(sitFrame('right')).toEqual({ row: 0, col: 3 });
  });

  it('includes every sit layer in ALL_LAYER_URLS', () => {
    for (const a of PRESETS.map((p) => p.appearance)) {
      for (const url of appearanceToLayers(a, 'sit')) expect(ALL_LAYER_URLS).toContain(url);
    }
  });
});

describe('ALL_LAYER_URLS', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pub = resolve(here, '../public');

  it('lists only real vendored files', () => {
    for (const url of ALL_LAYER_URLS) {
      expect(existsSync(resolve(pub, url.replace(/^\//, '')))).toBe(true);
    }
  });

  it('covers every new wardrobe layer', () => {
    const expected = [
      '/sprites/lpc/torso/white_longsleeve_male.png',
      '/sprites/lpc/torso/white_tunic_female.png',
      '/sprites/lpc/torso/pink_longsleeve_male.png',
      '/sprites/lpc/torso/pink_tunic_female.png',
      '/sprites/lpc/torso/green_formal_male.png',
      '/sprites/lpc/torso/green_formal_female.png',
      '/sprites/lpc/torso/pink_formal_male.png',
      '/sprites/lpc/torso/pink_formal_female.png',
      '/sprites/lpc/legs/navy_pants_male.png',
      '/sprites/lpc/legs/navy_pants_female.png',
      '/sprites/lpc/legs/pink_pants_male.png',
      '/sprites/lpc/legs/pink_pants_female.png',
    ];
    for (const url of expected) expect(ALL_LAYER_URLS).toContain(url);
  });

  it('never invents impossible garment/color combos', () => {
    const joined = ALL_LAYER_URLS.join('\n');
    for (const bad of ['teal_formal', 'maroon_formal', 'white_formal', 'green_longsleeve', 'green_tunic']) {
      expect(joined.includes(bad)).toBe(false);
    }
  });
});
