import { describe, it, expect } from 'vitest';
import { POSES, normalizePose } from '../src/protocol.ts';

describe('normalizePose', () => {
  it('keeps every known pose', () => {
    for (const p of POSES) expect(normalizePose(p)).toBe(p);
  });

  it('turns unknown, missing or non-string values into stand', () => {
    expect(normalizePose('fly')).toBe('stand');
    expect(normalizePose(undefined)).toBe('stand');
    expect(normalizePose(null)).toBe('stand');
    expect(normalizePose(3)).toBe('stand');
  });
});
