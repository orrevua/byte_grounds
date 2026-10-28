import { describe, it, expect } from 'vitest';
import {
  directionFromDelta,
  walkFrameIndex,
  WALK_FRAMES,
  FRAME_MS,
  BODY,
  HAIR,
  TORSO,
  LEGS,
  CATEGORIES,
  PRESETS,
  DEFAULT_APPEARANCE,
  appearanceToLayers,
  normalizeAppearance,
  serializeAppearance,
  parseAppearance,
  shuffleAppearance,
} from '../src/sprites.ts';
import type { Direction } from '../src/sprites.ts';

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
  it('uses a longsleeve shirt for male and a tunic for female', () => {
    const male = appearanceToLayers({ body: 'male', hair: 'brown', torso: 'teal', legs: 'teal' });
    const female = appearanceToLayers({ body: 'female', hair: 'brown', torso: 'teal', legs: 'teal' });
    expect(male.some((u) => u.includes('teal_longsleeve_male'))).toBe(true);
    expect(female.some((u) => u.includes('teal_tunic_female'))).toBe(true);
  });

  it("omits the hair layer when hair is 'none'", () => {
    const withHair = appearanceToLayers({ body: 'male', hair: 'brown', torso: 'teal', legs: 'teal' });
    const noHair = appearanceToLayers({ body: 'male', hair: 'none', torso: 'teal', legs: 'teal' });
    expect(withHair.some((u) => u.includes('/hair/'))).toBe(true);
    expect(noHair.some((u) => u.includes('/hair/'))).toBe(false);
    expect(noHair.length).toBe(withHair.length - 1);
  });

  it('selects sex-specific body and legs files', () => {
    const layers = appearanceToLayers({ body: 'female', hair: 'black', torso: 'maroon', legs: 'red' });
    expect(layers).toContain('/sprites/lpc/body/female_light.png');
    expect(layers).toContain('/sprites/lpc/legs/red_pants_female.png');
  });

  it('serves every layer from /sprites/', () => {
    for (const body of BODY)
      for (const hair of HAIR)
        for (const torso of TORSO)
          for (const legs of LEGS)
            for (const url of appearanceToLayers({ body, hair, torso, legs }))
              expect(url.startsWith('/sprites/')).toBe(true);
  });
});

describe('normalizeAppearance', () => {
  it('coerces invalid / missing fields to defaults', () => {
    expect(normalizeAppearance({})).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance('garbage')).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ body: 'alien', hair: 'green', torso: 'x', legs: 'y' })).toEqual(
      DEFAULT_APPEARANCE,
    );
  });

  it('keeps valid fields', () => {
    const a = { body: 'female', hair: 'none', torso: 'brown', legs: 'white' } as const;
    expect(normalizeAppearance(a)).toEqual(a);
  });
});

describe('serialize / parse round-trip', () => {
  it('round-trips every preset', () => {
    for (const p of PRESETS) {
      expect(parseAppearance(serializeAppearance(p.appearance))).toEqual(p.appearance);
    }
  });

  it('parses garbage to the default appearance', () => {
    expect(parseAppearance('not-valid')).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('shuffleAppearance', () => {
  it('is deterministic for a seeded rand and yields valid options', () => {
    const seq = [0.1, 0.9, 0.5, 0.99];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    const a = shuffleAppearance(rand);
    i = 0;
    const b = shuffleAppearance(rand);
    expect(a).toEqual(b);
    expect(normalizeAppearance(a)).toEqual(a);
  });

  it('respects rand bounds (0 → first option, →1 → last option)', () => {
    const zero = shuffleAppearance(() => 0);
    expect(zero).toEqual({ body: BODY[0], hair: HAIR[0], torso: TORSO[0], legs: LEGS[0] });
    const high = shuffleAppearance(() => 0.999999);
    expect(high).toEqual({
      body: BODY[BODY.length - 1],
      hair: HAIR[HAIR.length - 1],
      torso: TORSO[TORSO.length - 1],
      legs: LEGS[LEGS.length - 1],
    });
  });
});

describe('PRESETS / DEFAULT_APPEARANCE integrity', () => {
  it('has 6 presets with unique, non-empty ids', () => {
    expect(PRESETS.length).toBe(6);
    const ids = PRESETS.map((p) => p.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset appearance normalizes to itself', () => {
    for (const p of PRESETS) expect(normalizeAppearance(p.appearance)).toEqual(p.appearance);
  });

  it('DEFAULT_APPEARANCE is the first preset and is valid', () => {
    expect(DEFAULT_APPEARANCE).toEqual(PRESETS[0].appearance);
    expect(normalizeAppearance(DEFAULT_APPEARANCE)).toEqual(DEFAULT_APPEARANCE);
  });

  it('CATEGORIES covers every editable axis', () => {
    expect(CATEGORIES.map((c) => c.key).sort()).toEqual(['body', 'hair', 'legs', 'torso']);
  });
});
