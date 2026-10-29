import type { DecorCell, Facing, Rotation } from '@byte_grounds/shared/map';

/**
 * One of the 8 orientations of a decor piece: mirror horizontally (`flipX`) first, then turn
 * `rot` degrees clockwise. Matches `DecorCell.rot` / `DecorCell.flipX`.
 */
export interface DecorTransform {
  rot: Rotation;
  flipX: boolean;
}

export const IDENTITY: DecorTransform = { rot: 0, flipX: false };

function turn(deg: number): Rotation {
  return (deg % 360) as Rotation;
}

export function rotateCW(t: DecorTransform): DecorTransform {
  return { rot: turn(t.rot + 90), flipX: t.flipX };
}

export function rotateCCW(t: DecorTransform): DecorTransform {
  return { rot: turn(t.rot + 270), flipX: t.flipX };
}

/** Mirror across the screen's vertical axis (left <-> right). */
export function flipH(t: DecorTransform): DecorTransform {
  return { rot: turn(360 - t.rot), flipX: !t.flipX };
}

/** Mirror across the screen's horizontal axis (top <-> bottom) = flipH, then 180°. */
export function flipV(t: DecorTransform): DecorTransform {
  return { rot: turn(540 - t.rot), flipX: !t.flipX };
}

/** Size in tiles of a `w x h` piece once transformed. */
export function footprint(w: number, h: number, t: DecorTransform): { w: number; h: number } {
  return t.rot === 90 || t.rot === 270 ? { w: h, h: w } : { w, h };
}

/** Where source cell (dx, dy) of a `w x h` piece lands inside the transformed footprint. */
export function transformOffset(
  dx: number,
  dy: number,
  w: number,
  h: number,
  t: DecorTransform,
): { dx: number; dy: number } {
  const x = t.flipX ? w - 1 - dx : dx;
  switch (t.rot) {
    case 90:
      return { dx: h - 1 - dy, dy: x };
    case 180:
      return { dx: w - 1 - x, dy: h - 1 - dy };
    case 270:
      return { dx: dy, dy: w - 1 - x };
    default:
      return { dx: x, dy };
  }
}

const CLOCKWISE: readonly Facing[] = ['up', 'right', 'down', 'left'];

/** A facing carried through the transform: mirror swaps left/right, then turn clockwise. */
export function transformFacing(dir: Facing, t: DecorTransform): Facing {
  const mirrored = t.flipX && dir === 'left' ? 'right' : t.flipX && dir === 'right' ? 'left' : dir;
  return CLOCKWISE[(CLOCKWISE.indexOf(mirrored) + t.rot / 90) % 4]!;
}

/** Canonical fields for a DecorCell: {} for identity, else {rot?} / {flipX: true}. */
export function transformFields(t: DecorTransform): Pick<DecorCell, 'rot' | 'flipX'> {
  const fields: Pick<DecorCell, 'rot' | 'flipX'> = {};
  if (t.rot !== 0) fields.rot = t.rot;
  if (t.flipX) fields.flipX = true;
  return fields;
}

/** Editor label, e.g. "Rotation 90° · mirrored" or "No rotation". */
export function describeTransform(t: DecorTransform): string {
  const turned = t.rot === 0 ? 'No rotation' : `Rotation ${t.rot}°`;
  return t.flipX ? `${turned} · mirrored` : turned;
}
