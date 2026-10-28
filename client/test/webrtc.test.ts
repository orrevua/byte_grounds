import { describe, it, expect } from 'vitest';
import { isPolite } from '../src/webrtc.ts';

describe('isPolite', () => {
  it('the lexicographically smaller id is polite', () => {
    expect(isPolite('aaa', 'bbb')).toBe(true);
    expect(isPolite('bbb', 'aaa')).toBe(false);
  });

  it('is deterministic and asymmetric for any pair', () => {
    expect(isPolite('peer-1', 'peer-2')).toBe(true);
    expect(isPolite('peer-2', 'peer-1')).toBe(false);
    // the two sides of a pair never agree on who is polite
    expect(isPolite('x', 'y')).not.toBe(isPolite('y', 'x'));
  });

  it('equal ids are not polite (self never connects to self)', () => {
    expect(isPolite('same', 'same')).toBe(false);
  });
});
