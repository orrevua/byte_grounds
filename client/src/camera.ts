/**
 * Scroll offset (whole px) along one axis: the window of `view` px centred on `focus`, kept
 * inside a `world` px wide map. A map that fits the window doesn't scroll.
 */
export function cameraOffset(focus: number, view: number, world: number): number {
  if (world <= view) return 0;
  return Math.round(Math.min(Math.max(focus - view / 2, 0), world - view));
}

/** Canvas size for a map in a window: the whole map when it fits, else the window. */
export function viewportSize(
  world: { w: number; h: number },
  win: { w: number; h: number },
): { w: number; h: number } {
  return { w: Math.min(world.w, Math.max(1, Math.floor(win.w))), h: Math.min(world.h, Math.max(1, Math.floor(win.h))) };
}
