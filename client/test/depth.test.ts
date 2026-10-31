import { describe, it, expect } from 'vitest';
import { avatarAnchorY, decorAnchorY, sortRenderables, type Renderable } from '../src/depth.ts';

describe('anchors', () => {
  it('decor anchors at the cell center, avatar at its feet', () => {
    expect(decorAnchorY({ y: 3 })).toBe(3.5);
    expect(avatarAnchorY({ y: 3.5 })).toBe(3.5);
  });

  it('decor with a base row anchors at that row', () => {
    expect(decorAnchorY({ y: 3, baseDy: 1 })).toBe(4.5);
  });
});

describe('a 2-row desk sorted by its base row', () => {
  const desk = [
    { id: 'top', anchorY: decorAnchorY({ y: 4, baseDy: 1 }), isAvatar: false },
    { id: 'base', anchorY: decorAnchorY({ y: 5 }), isAvatar: false },
  ];
  const order = (feetY: number) =>
    sortRenderables([...desk, { id: 'avatar', anchorY: avatarAnchorY({ y: feetY }), isAvatar: true }]).map(
      (r) => r.id,
    );

  it('an avatar in the row behind is drawn before (under) the whole desk', () => {
    expect(order(4.7)).toEqual(['avatar', 'top', 'base']);
  });

  it('an avatar in front is drawn after (over) the whole desk', () => {
    expect(order(6.2)).toEqual(['top', 'base', 'avatar']);
  });

  it('an avatar seated in front is drawn over the desk', () => {
    expect(order(6.5)).toEqual(['top', 'base', 'avatar']);
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

describe('stackedDecorAnchors', () => {
  it('an item stacked on furniture sorts no earlier than the furniture under it', async () => {
    const { stackedDecorAnchors } = await import('../src/depth.ts');
    const deskTop = { x: 4, y: 5, baseDy: 1 }; // sorts by the desk's base row (6.5)
    const monitor = { x: 4, y: 5 }; // re-placed 1x1: on its own it would sort at 5.5
    const elsewhere = { x: 1, y: 1 };
    expect(stackedDecorAnchors([deskTop, monitor, elsewhere])).toEqual([6.5, 6.5, 1.5]);
    // Order matters: something drawn before the desk isn't lifted.
    expect(stackedDecorAnchors([monitor, deskTop])).toEqual([5.5, 6.5]);
  });

  it('cells that are not liftable (seats behind a desk) keep their own row', async () => {
    const { stackedDecorAnchors } = await import('../src/depth.ts');
    const deskBack = { x: 4, y: 3, baseDy: 3 }; // a desk's back row, sorting at 6.5
    const chair = { x: 4, y: 3, seat: true };
    const phone = { x: 4, y: 3 };
    expect(stackedDecorAnchors([deskBack, chair, phone], (c) => !('seat' in c))).toEqual([6.5, 3.5, 6.5]);
  });
});

describe('avatarAnchorY when lying', () => {
  it('sorts a sleeper past their bed: two rows down when the feet point down', () => {
    expect(avatarAnchorY({ y: 3.5, pose: 'lie', dir: 'down' })).toBeCloseTo(5.7);
    expect(avatarAnchorY({ y: 3.5, pose: 'lie', dir: 'up' })).toBeCloseTo(3.7);
    expect(avatarAnchorY({ y: 3.5, pose: 'sit', dir: 'down' })).toBe(3.5);
  });
});
