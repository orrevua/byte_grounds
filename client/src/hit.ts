import { TILE_SIZE } from '@byte_grounds/shared/protocol';

/** Half the clickable width of an avatar, and how far above / below its feet it reaches (world px). */
const HALF_W = 14;
const ABOVE = 56;
const BELOW = 6;

/**
 * A point on the canvas (CSS px from its top-left) in world pixels: the canvas is CSS-scaled by
 * `scale` and its view scrolled by the camera offset.
 */
export function screenToWorld(cx: number, cy: number, scale: number, camX: number, camY: number): { px: number; py: number } {
  return { px: cx / scale + camX, py: cy / scale + camY };
}

/** The avatar whose sprite box contains the point; the one with the nearest feet when several do. */
export function avatarAt<T extends { x: number; y: number }>(avs: Iterable<[string, T]>, px: number, py: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [id, a] of avs) {
    const fx = a.x * TILE_SIZE;
    const fy = a.y * TILE_SIZE;
    if (Math.abs(px - fx) > HALF_W || py < fy - ABOVE || py > fy + BELOW) continue;
    const d = Math.hypot(px - fx, py - fy);
    if (d < bestDist) {
      best = id;
      bestDist = d;
    }
  }
  return best;
}
