import { describe, it, expect } from 'vitest';
import { HOLD_MS, SPEAK_OFF, SPEAK_ON, levelFromRms, nextSpeaking, rmsLevel, smoothLevel } from '../src/voice.ts';

describe('voice activity', () => {
  it('measures RMS', () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0);
    expect(rmsLevel(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('maps RMS to a 0..1 level', () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(0.005)).toBe(0);
    expect(levelFromRms(1)).toBe(1);
    expect(levelFromRms(0.08)).toBeGreaterThan(0.3);
  });

  it('rises fast and falls slowly', () => {
    const up = smoothLevel(0, 1, 40);
    const down = 1 - smoothLevel(1, 0, 40);
    expect(up).toBeGreaterThan(0.5);
    expect(down).toBeLessThan(0.25);
    expect(smoothLevel(0.4, 0.4, 16)).toBeCloseTo(0.4);
  });

  it('starts speaking above the on threshold and holds through short pauses', () => {
    let s = { speaking: false, lastLoud: 0 };
    s = nextSpeaking(s, (SPEAK_ON + SPEAK_OFF) / 2, 0);
    expect(s.speaking).toBe(false); // between thresholds: not enough to start
    s = nextSpeaking(s, SPEAK_ON + 0.01, 100);
    expect(s.speaking).toBe(true);
    s = nextSpeaking(s, 0, 100 + HOLD_MS - 50);
    expect(s.speaking).toBe(true); // a pause between words
    s = nextSpeaking(s, (SPEAK_ON + SPEAK_OFF) / 2, 100 + HOLD_MS + 50);
    expect(s.speaking).toBe(true); // still above the off threshold: keeps going
    s = nextSpeaking(s, 0, 100 + 2 * HOLD_MS + 100);
    expect(s.speaking).toBe(false);
  });
});
