import { describe, it, expect } from 'vitest';
import { avatarAnchorY, decorAnchorY, sortRenderables, type Renderable } from '../src/depth.ts';

describe('anchors', () => {
  it('decor anchors at the cell center, avatar at its feet', () => {
    expect(decorAnchorY({ y: 3 })).toBe(3.5);
    expect(avatarAnchorY({ y: 3.5 })).toBe(3.5);
  });
});

describe('sortRenderables', () => {
  const tag = <T extends Renderable>(r: T & { id: string }) => r;

  it('orders ascending by anchorY (back to front)', () => {
    const out = sortRenderables([
      tag({ id: 'b', anchorY: 2, isAvatar: true }),
      tag({ id: 'a', anchorY: 1, isAvatar: true }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('on a tie, decor draws before the avatar (avatar on top)', () => {
    const out = sortRenderables([
      tag({ id: 'avatar', anchorY: 5, isAvatar: true }),
      tag({ id: 'chair', anchorY: 5, isAvatar: false }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['chair', 'avatar']);
  });

  it('decor below (higher anchor) draws last', () => {
    const out = sortRenderables([
      tag({ id: 'avatar', anchorY: 5, isAvatar: true }),
      tag({ id: 'desk', anchorY: 6, isAvatar: false }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['avatar', 'desk']);
  });

  it('keeps input order on a full tie (stable: self after remotes)', () => {
    const out = sortRenderables([
      tag({ id: 'remote', anchorY: 4, isAvatar: true }),
      tag({ id: 'self', anchorY: 4, isAvatar: true }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['remote', 'self']);
  });
});
