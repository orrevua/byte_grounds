import { describe, it, expect } from 'vitest';
import { reconnectDelay } from '../src/net.ts';

describe('reconnectDelay', () => {
  it('grows exponentially from the first attempt', () => {
    expect(reconnectDelay(1)).toBe(500);
    expect(reconnectDelay(2)).toBe(1000);
    expect(reconnectDelay(3)).toBe(2000);
  });

  it('caps at 10s', () => {
    expect(reconnectDelay(10)).toBe(10_000);
    expect(reconnectDelay(100)).toBe(10_000);
  });

  it('is monotonic non-decreasing across attempts', () => {
    for (let n = 1; n < 20; n++) {
      expect(reconnectDelay(n + 1)).toBeGreaterThanOrEqual(reconnectDelay(n));
    }
  });
});
