import { describe, it, expect } from 'vitest';
import { avatarAt, screenToWorld } from '../src/hit.ts';

describe('hit testing', () => {
  const one = new Map([['a', { x: 5, y: 5 }]]); // feet at (160, 160) px

  it('hits inside the sprite box, from the head down to just below the feet', () => {
    expect(avatarAt(one, 160, 160)).toBe('a');
    expect(avatarAt(one, 160 + 14, 160 - 56)).toBe('a');
    expect(avatarAt(one, 160 - 14, 160 + 6)).toBe('a');
  });

  it('misses outside the box', () => {
    expect(avatarAt(one, 160 + 15, 160)).toBeNull();
    expect(avatarAt(one, 160, 160 - 57)).toBeNull();
    expect(avatarAt(one, 160, 160 + 7)).toBeNull();
    expect(avatarAt(new Map(), 160, 160)).toBeNull();
  });

  it('picks the avatar with the nearest feet when boxes overlap', () => {
    const two = new Map([
      ['back', { x: 5, y: 5 }],
      ['front', { x: 5, y: 6 }], // feet at y = 192
    ]);
    expect(avatarAt(two, 160, 150)).toBe('back');
    expect(avatarAt(two, 160, 185)).toBe('front');
  });

  it('maps canvas CSS pixels through the CSS scale and the camera offset', () => {
    expect(screenToWorld(100, 50, 0.5, 300, 40)).toEqual({ px: 500, py: 140 });
    const { px, py } = screenToWorld(80, 70, 2, 120, 100); // world (160, 135)
    expect(avatarAt(one, px, py)).toBe('a');
  });
});
