import { describe, it, expect } from 'vitest';
import { DANCE_POSES, isDancePose, normalizePose } from '@byte_grounds/shared/protocol';
import { ANIM_FRAMES, ANIM_ROW, LEG_SPLIT, MAGGOTS_FRAME_MS, MAGGOTS_LOOP_MS, MAGGOTS_STEPS, danceStep, withFallback } from '../src/sprites.ts';

describe('"Maggots for Brains" dance', () => {
  it('is a pose of its own, shared like the classic dance', () => {
    expect(normalizePose('maggots')).toBe('maggots');
    expect(DANCE_POSES).toEqual(['dance', 'maggots']);
    expect(isDancePose('maggots')).toBe(true);
    expect(isDancePose('dance')).toBe(true);
    expect(isDancePose('sit')).toBe(false);
  });

  it('follows the described sections in order', () => {
    const at = (i: number) => danceStep(i * MAGGOTS_FRAME_MS, 'maggots');
    // open arms over legs lifting in turn
    expect(at(0)).toMatchObject({ anim: 'cast', col: 4, legs: { anim: 'walk', col: 3 } });
    expect(at(2)).toMatchObject({ anim: 'cast', col: 4, legs: { anim: 'walk', col: 7 } });
    // both hands up
    expect(at(8)).toMatchObject({ anim: 'cast', col: 5 });
    // hands down one at a time (the second mirrored)
    expect(at(10)).toMatchObject({ anim: 'slash', col: 4 });
    expect(at(11)).toMatchObject({ anim: 'slash', col: 4, flip: true });
    // hand to the heart with the foot tapping
    expect(at(18)).toMatchObject({ anim: 'thrust', col: 2, legs: { anim: 'walk', col: 3 } });
    expect(at(19)).toMatchObject({ anim: 'thrust', col: 2, legs: { anim: 'walk', col: 0 } });
    // hands up, feet kicking front in turn
    expect(at(30)).toMatchObject({ anim: 'cast', col: 5, legs: { anim: 'walk', col: 3 } });
    expect(at(32)).toMatchObject({ anim: 'cast', col: 5, legs: { anim: 'walk', col: 7 } });
  });

  it('loops, faces the viewer and stays inside every animation row', () => {
    expect(MAGGOTS_LOOP_MS).toBe(MAGGOTS_STEPS.length * MAGGOTS_FRAME_MS);
    expect(danceStep(MAGGOTS_LOOP_MS, 'maggots')).toEqual(danceStep(0, 'maggots'));
    for (const s of MAGGOTS_STEPS) {
      expect(s.dir).toBe('down');
      expect(s.col).toBeLessThan(ANIM_FRAMES[s.anim]);
      if (s.legs) expect(s.legs.col).toBeLessThan(ANIM_FRAMES[s.legs.anim]);
      expect(Math.abs(s.dy)).toBeLessThanOrEqual(2);
    }
    expect(LEG_SPLIT).toBeGreaterThan(32);
    expect(LEG_SPLIT).toBeLessThan(64);
  });

  it('the classic dance is unchanged by default', () => {
    expect(danceStep(0)).toEqual(danceStep(0, 'dance'));
  });

  it("swaps the hand-to-heart for hands on the chest in the men's suit (no thrust rows)", () => {
    const heart = danceStep(18 * MAGGOTS_FRAME_MS, 'maggots');
    expect(withFallback(heart, ['/x/torso/navy_formal_male.png'])).toMatchObject({ anim: 'cast', col: 2, row: ANIM_ROW.cast.down });
    expect(withFallback(heart, ['/x/torso/red_tshirt_male.png'])).toEqual(heart);
  });
});
