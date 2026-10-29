/**
 * Top-down depth sorting: object-layer decor and avatars share one back-to-front pass,
 * ordered by a screen-row anchor (tile-space Y; larger = lower on screen = nearer the viewer).
 */

/**
 * An object decor cell's anchor is the vertical center of its object's base row (`baseDy` rows
 * down), so every cell of a desk sorts where the desk stands, not where its top row is drawn.
 */
export function decorAnchorY(cell: { y: number; baseDy?: number }): number {
  return cell.y + (cell.baseDy ?? 0) + 0.5;
}

/** An avatar's anchor is its feet point. */
export function avatarAnchorY(a: { y: number }): number {
  return a.y;
}

export interface Renderable {
  anchorY: number;
  isAvatar: boolean;
}

/**
 * Stable back-to-front sort: ascending `anchorY`; on a tie decor draws first so the
 * avatar ends up on top; remaining ties keep input order (self stays after remotes).
 */
export function sortRenderables<T extends Renderable>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      if (a.item.anchorY !== b.item.anchorY) return a.item.anchorY - b.item.anchorY;
      if (a.item.isAvatar !== b.item.isAvatar) return a.item.isAvatar ? 1 : -1;
      return a.i - b.i;
    })
    .map(({ item }) => item);
}
