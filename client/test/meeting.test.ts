import { describe, it, expect } from 'vitest';
import { avatarColor, gridColumns } from '../src/meeting.ts';

describe('meeting view layout', () => {
  it('picks Meet-like grid columns', () => {
    expect([1, 2, 3, 4, 5, 9, 10].map(gridColumns)).toEqual([1, 2, 2, 2, 3, 3, 4]);
  });

  it('gives each name a stable color', () => {
    expect(avatarColor('Ana')).toBe(avatarColor('Ana'));
    expect(avatarColor('Ana')).toMatch(/^hsl\(\d+, 45%, 42%\)$/);
  });
});
