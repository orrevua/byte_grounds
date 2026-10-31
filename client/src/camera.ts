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

/** Map zoom levels (CSS-free: the canvas draws the world this many times bigger). */
export const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3] as const;

/** The next zoom level in or out from `z` (snapping an off-step value to the nearest step first). */
export function stepZoom(z: number, dir: 1 | -1): number {
  let i = 0;
  for (let k = 0; k < ZOOM_STEPS.length; k++) if (Math.abs(ZOOM_STEPS[k]! - z) < Math.abs(ZOOM_STEPS[i]! - z)) i = k;
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))]!;
}

/** A zoom level from storage or a pinch, clamped to the supported range. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1]!, Math.max(ZOOM_STEPS[0]!, z));
}
