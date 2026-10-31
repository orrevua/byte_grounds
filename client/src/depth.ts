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

/**
 * Anchors for object cells in draw order: each is its own `decorAnchorY`, but a liftable cell is
 * never earlier than an object cell below it on the same tile, so a monitor stacked on a desk's
 * top row sorts with the desk (by its base row) and stays on top of it instead of under it.
 * Seats are not liftable: a chair on a desk's back row stands *behind* the desk, which should
 * keep covering it.
 */
export function stackedDecorAnchors<T extends { x: number; y: number; baseDy?: number }>(
  cells: readonly T[],
  liftable: (c: T) => boolean = () => true,
): number[] {
  const floorOf = new Map<string, number>();
  return cells.map((c) => {
    const own = decorAnchorY(c);
    if (!liftable(c)) return own;
    const key = `${c.x},${c.y}`;
    const anchor = Math.max(own, floorOf.get(key) ?? -Infinity);
    floorOf.set(key, anchor);
    return anchor;
  });
}

/**
 * An avatar's anchor is its feet point. Someone lying in bed sorts just past the bed's base row
 * (beds are up to 3 tiles long; with the feet pointing down that row is 2 tiles further), so the
 * whole bed draws first and the head stays on the pillow; the blanket is then drawn back over the
 * body (`Game.drawBedOver`).
 */
export function avatarAnchorY(a: { y: number; pose?: string; dir?: string }): number {
  if (a.pose !== 'lie') return a.y;
  return a.y + (a.dir === 'down' ? LIE_DOWN_LIFT : LIE_LIFT);
}

const LIE_DOWN_LIFT = 2.2;
const LIE_LIFT = 0.2;

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
