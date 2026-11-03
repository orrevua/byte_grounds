import { describe, it, expect } from 'vitest';
import { DANCE_POSES, isDancePose, normalizePose } from '@byte_grounds/shared/protocol';
import { ANIM_FRAMES, KNEE, LIFT, MAGGOTS_FRAME_MS, MAGGOTS_LOOP_MS, MAGGOTS_STEPS, danceStep } from '../src/sprites.ts';

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
    // open arms, legs lifting in turn
    expect(at(0)).toMatchObject({ anim: 'cast', col: 4, lift: 'left' });
    expect(at(1).lift).toBeUndefined();
    expect(at(2)).toMatchObject({ anim: 'cast', col: 4, lift: 'right' });
    // both hands up
    expect(at(8)).toMatchObject({ anim: 'cast', col: 5 });
    // hands down one at a time, each held for two steps (the second mirrored)
    expect(at(10)).toMatchObject({ anim: 'slash', col: 4, flip: false });
    expect(at(12)).toMatchObject({ anim: 'slash', col: 4, flip: true });
    // hands to the heart with the foot tapping
    expect(at(20)).toMatchObject({ anim: 'cast', col: 2, lift: 'left' });
    expect(at(21)).toMatchObject({ anim: 'cast', col: 2 });
    // hands up, feet kicking front in turn
    expect(at(32)).toMatchObject({ anim: 'cast', col: 5, lift: 'left' });
    expect(at(34)).toMatchObject({ anim: 'cast', col: 5, lift: 'right' });
  });

  it('loops, faces the viewer and only uses frames every outfit draws (no thrust row)', () => {
    expect(MAGGOTS_LOOP_MS).toBe(MAGGOTS_STEPS.length * MAGGOTS_FRAME_MS);
    expect(danceStep(MAGGOTS_LOOP_MS, 'maggots')).toEqual(danceStep(0, 'maggots'));
    for (const s of MAGGOTS_STEPS) {
      expect(s.dir).toBe('down');
      expect(s.anim).not.toBe('thrust');
      expect(s.col).toBeLessThan(ANIM_FRAMES[s.anim]);
      expect(Math.abs(s.dy)).toBeLessThanOrEqual(2);
    }
    expect(KNEE).toBeGreaterThanOrEqual(52); // below the lowest hand of every body
    expect(LIFT).toBeGreaterThan(2);
  });

  it('the classic dance is unchanged by default', () => {
    expect(danceStep(0)).toEqual(danceStep(0, 'dance'));
  });
});
