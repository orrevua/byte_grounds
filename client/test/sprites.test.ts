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
  SKIN,
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
  lieMode,
  tuckLayout,
  breathOffset,
  BREATH_MS,
  sitFrame,
  fitAppearance,
  skinsFor,
  outfitsFor,
  danceStep,
  DANCE_STEPS,
  DANCE_LOOP_MS,
  ANIM_FRAMES,
} from '../src/sprites.ts';
import type { Direction } from '../src/sprites.ts';
import type { Appearance } from '@byte_grounds/shared/protocol';

const casual = (o: Partial<Appearance>): Appearance =>
  normalizeAppearance({ body: 'male', hair: 'brown', outfit: 'casual', torso: 'teal', legs: 'teal', skin: 'light', ...o });

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

describe('lieMode', () => {
  it('lies on the side along left/right beds and tucks in on up/down beds', () => {
    expect(lieMode('left')).toBe('side');
    expect(lieMode('right')).toBe('side');
    expect(lieMode('up')).toBe('tucked');
    expect(lieMode('down')).toBe('tucked');
  });
});

describe('breathOffset', () => {
  it('rises 1px for half a breath, then settles, looping', () => {
    expect(breathOffset(0)).toBe(0);
    expect(breathOffset(BREATH_MS / 2 + 1)).toBe(1);
    expect(breathOffset(BREATH_MS)).toBe(0);
    expect(breathOffset(-1)).toBe(1);
    expect(breathOffset(Number.NaN)).toBe(0);
  });

  it('shifts the phase by the seed', () => {
    expect(breathOffset(0, BREATH_MS / 2)).toBe(1);
  });
});

describe('tuckLayout', () => {
  it('shows the face on a down bed and the crown (back frame turned π) on an up bed', () => {
    expect(tuckLayout('down')).toMatchObject({ src: 'down', rot: 0 });
    expect(tuckLayout('up')).toMatchObject({ src: 'up', rot: Math.PI });
  });

  it('rests the head on the pillow, a little past the tile center, and keeps head + shoulders only', () => {
    for (const dir of ['up', 'down'] as const) {
      const { frameX, frameY, crop } = tuckLayout(dir);
      expect(frameX).toBe(-32);
      expect(frameY + 22).toBe(0); // the chin lands on the pillow tile's edge
      expect(crop).toBe(38);
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
      for (const skin of skinsFor(body))
        for (const hair of HAIR)
          for (const outfit of outfitsFor(skin))
            for (const torso of outfitTorso(outfit))
              for (const legs of LEGS)
                for (const url of appearanceToLayers(casual({ body, skin, hair, outfit, torso, legs } as Partial<Appearance>)))
                  expect(url.startsWith('/sprites/')).toBe(true);
  });

  it('draws the creature body sheet under the usual clothes and hair', () => {
    expect(appearanceToLayers(casual({ skin: 'orc' }))).toEqual([
      '/sprites/lpc/body/male_orc.png',
      '/sprites/lpc/legs/teal_pants_male.png',
      '/sprites/lpc/torso/teal_longsleeve_male.png',
      '/sprites/lpc/hair/brown_male.png',
    ]);
    expect(appearanceToLayers(casual({ body: 'female', skin: 'orc' }))[0]).toBe('/sprites/lpc/body/female_orc.png');
    expect(appearanceToLayers(casual({ skin: 'skeleton' }), 'sit')[0]).toBe('/sprites/lpc/sit/body/male_skeleton.png');
  });

  it('a bare creature draws only its body (and hair)', () => {
    expect(appearanceToLayers(casual({ skin: 'skeleton', outfit: 'none', hair: 'none' }))).toEqual([
      '/sprites/lpc/body/male_skeleton.png',
    ]);
    expect(appearanceToLayers(casual({ skin: 'orc', outfit: 'none' }))).toEqual([
      '/sprites/lpc/body/male_orc.png',
      '/sprites/lpc/hair/brown_male.png',
    ]);
  });

  it('a female skeleton wears female clothes and hair over its own sheet', () => {
    expect(appearanceToLayers(casual({ body: 'female', skin: 'skeleton' }))).toEqual([
      '/sprites/lpc/body/female_skeleton.png',
      '/sprites/lpc/legs/teal_pants_female.png',
      '/sprites/lpc/torso/teal_tunic_female.png',
      '/sprites/lpc/hair/brown_female.png',
    ]);
  });

  it('draws the human skin tones for both sexes', () => {
    for (const skin of ['olive', 'tan', 'brown', 'dark'] as const) {
      expect(appearanceToLayers(casual({ skin }))[0]).toBe(`/sprites/lpc/body/male_${skin}.png`);
      expect(appearanceToLayers(casual({ body: 'female', skin }), 'sit')[0]).toBe(`/sprites/lpc/sit/body/female_${skin}.png`);
    }
  });
});

describe('fitAppearance', () => {
  it('offers every skin to both sexes, and bare outfits to creatures only', () => {
    expect(skinsFor('male')).toEqual(SKIN);
    expect(skinsFor('female')).toEqual(SKIN);
    expect(outfitsFor('light')).toEqual(['casual', 'business']);
    expect(outfitsFor('dark')).toEqual(['casual', 'business']);
    expect(outfitsFor('skeleton')).toEqual(OUTFIT);
  });

  it('clamps outfit per skin, then top per outfit', () => {
    expect(fitAppearance(casual({ body: 'female', skin: 'skeleton' })).skin).toBe('skeleton');
    expect(fitAppearance(casual({ outfit: 'none' })).outfit).toBe('casual');
    expect(fitAppearance(casual({ skin: 'tan', outfit: 'none', torso: 'green' }))).toMatchObject({
      skin: 'tan',
      outfit: 'casual',
      torso: 'teal',
    });
    expect(fitAppearance(casual({ outfit: 'business', torso: 'teal' })).torso).toBe('green');
  });

  it('keeps a bare creature and its stored colors untouched', () => {
    const skel = casual({ skin: 'skeleton', outfit: 'none', torso: 'green' });
    expect(fitAppearance(skel)).toEqual(skel);
  });

  it('leaves every preset unchanged', () => {
    for (const p of PRESETS) expect(fitAppearance(p.appearance)).toEqual(p.appearance);
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
    const a: Appearance = { body: 'female', hair: 'none', outfit: 'business', torso: 'green', legs: 'navy', skin: 'orc' };
    expect(normalizeAppearance(a)).toEqual(a);
  });

  it('coerces a missing or unknown skin to light', () => {
    expect(normalizeAppearance({ body: 'male' }).skin).toBe('light');
    expect(normalizeAppearance({ skin: 'alien' }).skin).toBe('light');
  });
});

describe('serialize / parse round-trip', () => {
  it('round-trips every preset (6-part)', () => {
    for (const p of PRESETS) {
      expect(serializeAppearance(p.appearance).split('.')).toHaveLength(6);
      expect(parseAppearance(serializeAppearance(p.appearance))).toEqual(p.appearance);
    }
  });

  it('round-trips a bare skeleton', () => {
    const s = 'male.none.none.teal.teal.skeleton';
    expect(serializeAppearance(parseAppearance(s))).toBe(s);
  });

  it('parses a legacy 4-part string (no outfit) → outfit defaults to casual', () => {
    const legacy = parseAppearance('female.black.maroon.red');
    expect(legacy).toEqual({ body: 'female', hair: 'black', outfit: 'casual', torso: 'maroon', legs: 'red', skin: 'light' });
  });

  it('parses a legacy 5-part string (no skin) → light skin', () => {
    expect(parseAppearance('male.black.business.green.navy')).toEqual({
      body: 'male', hair: 'black', outfit: 'business', torso: 'green', legs: 'navy', skin: 'light',
    });
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

  it('always yields a fitAppearance-stable appearance', () => {
    let i = 0;
    const rand = () => [0.05, 0.37, 0.61, 0.83, 0.12, 0.95, 0.5, 0.2, 0.7][i++ % 9];
    for (let n = 0; n < 60; n++) {
      const a = shuffleAppearance(rand);
      expect(fitAppearance(a)).toEqual(a);
      expect(outfitTorso(a.outfit)).toContain(a.torso);
    }
  });

  it('respects rand bounds (0 → first option, →1 → last option)', () => {
    expect(shuffleAppearance(() => 0)).toEqual({
      body: BODY[0], hair: HAIR[0], outfit: OUTFIT[0], torso: CASUAL_TORSO[0], legs: LEGS[0], skin: SKIN[0],
    });
    expect(shuffleAppearance(() => 0.999999)).toEqual({
      body: 'female',
      hair: HAIR[HAIR.length - 1],
      outfit: 'none',
      torso: CASUAL_TORSO[CASUAL_TORSO.length - 1],
      legs: LEGS[LEGS.length - 1],
      skin: 'skeleton',
    });
  });
});

describe('PRESETS / DEFAULT_APPEARANCE integrity', () => {
  it('has 17 presets with unique, non-empty ids', () => {
    expect(PRESETS.length).toBe(17);
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

  it('includes the Orc and bare Skeleton presets', () => {
    expect(PRESETS.find((p) => p.id === 'orc')?.appearance).toMatchObject({ skin: 'orc', outfit: 'casual' });
    expect(PRESETS.find((p) => p.id === 'skel')?.appearance).toMatchObject({ skin: 'skeleton', outfit: 'none', hair: 'none' });
  });

  it('includes female orc and skeleton presets in female clothes', () => {
    expect(PRESETS.find((p) => p.id === 'forc')?.appearance).toMatchObject({ body: 'female', skin: 'orc', outfit: 'casual' });
    expect(PRESETS.find((p) => p.id === 'fskel')?.appearance).toMatchObject({ body: 'female', skin: 'skeleton', outfit: 'business' });
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
    expect(CATEGORIES.map((c) => c.key)).toEqual(['body', 'skin', 'hair', 'outfit', 'torso', 'legs']);
  });

  it('resolves the Skin options from the body and the Outfit options from the skin', () => {
    const skin = CATEGORIES.find((c) => c.key === 'skin')!;
    const outfit = CATEGORIES.find((c) => c.key === 'outfit')!;
    expect(optionsFor(skin, casual({ body: 'female' }))).toEqual(SKIN);
    expect(optionsFor(outfit, casual({}))).toEqual(['casual', 'business']);
    expect(optionsFor(outfit, casual({ skin: 'orc' }))).toEqual(OUTFIT);
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

  it('covers the creature stand and sit bodies', () => {
    for (const name of ['male_orc', 'female_orc', 'male_skeleton', 'female_skeleton', 'female_dark', 'male_olive']) {
      expect(ALL_LAYER_URLS).toContain(`/sprites/lpc/body/${name}.png`);
      expect(ALL_LAYER_URLS).toContain(`/sprites/lpc/sit/body/${name}.png`);
    }
  });

  it('never invents impossible garment/color combos', () => {
    const joined = ALL_LAYER_URLS.join('\n');
    for (const bad of ['teal_formal', 'maroon_formal', 'white_formal', 'green_longsleeve', 'green_tunic']) {
      expect(joined.includes(bad)).toBe(false);
    }
  });
});

describe('danceStep', () => {
  it('starts on the standing frame and holds it for one frame duration', () => {
    expect(danceStep(0)).toMatchObject({ anim: 'walk', dir: 'down', row: 10, col: 0, dx: 0, dy: 0 });
    expect(danceStep(124)).toMatchObject({ row: 10, col: 0 });
  });

  it('advances every 125 ms', () => {
    expect(danceStep(125)).toMatchObject({ anim: 'cast', row: 2, col: 2, dx: -1, dy: -1 });
  });

  it('loops every 2 s and wraps negative clocks backwards', () => {
    expect(DANCE_LOOP_MS).toBe(2000);
    expect(danceStep(2000)).toEqual(danceStep(0));
    expect(danceStep(-125)).toEqual(danceStep(15 * 125));
  });

  it('falls back to the first step for a non-finite clock', () => {
    expect(danceStep(NaN)).toEqual(danceStep(0));
    expect(danceStep(Infinity)).toEqual(danceStep(0));
  });

  it('keeps every step inside its animation row and the small sway/bob range', () => {
    expect(DANCE_STEPS).toHaveLength(16);
    DANCE_STEPS.forEach((_, i) => {
      const s = danceStep(i * 125);
      expect(s.col).toBeLessThan(ANIM_FRAMES[s.anim]);
      expect(s.row).toBeLessThan(21);
      expect(Math.abs(s.dx)).toBeLessThanOrEqual(2);
      expect(s.dy).toBeLessThanOrEqual(0);
      expect(s.dy).toBeGreaterThanOrEqual(-2);
    });
  });

  it('draws the stand layers', () => {
    const a = casual({ outfit: 'business', torso: 'pink' });
    expect(appearanceToLayers(a, 'dance')).toEqual(appearanceToLayers(a));
  });
});
