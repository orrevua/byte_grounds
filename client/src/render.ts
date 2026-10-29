import { TILE_SIZE } from '@byte_grounds/shared/protocol';
import { decorLayer, tileColor } from '@byte_grounds/shared/map';
import type { DecorCell, OfficeMap } from '@byte_grounds/shared/map';
import { FRAME_SIZE, SIT_DROP, drawAppearance } from './sprites.ts';
import { drawDecorCell } from './decor.ts';
import type { Direction } from './sprites.ts';
import type { Appearance, Pose } from '@byte_grounds/shared/protocol';

/** Drop the 64px frame so the character's feet sit on the tile point. */
const FOOT_OFFSET = 16;

const GRID = '#20242b';

export function mapPixelSize(map: OfficeMap): { w: number; h: number } {
  return { w: map.width * TILE_SIZE, h: map.height * TILE_SIZE };
}

/** Tile-space position → canvas pixel coordinates (shared by draw + overlays). */
export function tileToScreen(x: number, y: number): { px: number; py: number } {
  return { px: x * TILE_SIZE, py: y * TILE_SIZE };
}

export function drawMap(ctx: CanvasRenderingContext2D, map: OfficeMap): void {
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      ctx.fillStyle = tileColor(map, tx, ty);
      ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  drawGrid(ctx, map);
  for (const d of map.decor ?? []) {
    if (decorLayer(map, d) === 'floor') drawDecorCellAt(ctx, d);
  }
}

/** Draw one decor cell at its tile. */
export function drawDecorCellAt(ctx: CanvasRenderingContext2D, cell: DecorCell): void {
  drawDecorCell(ctx, cell.sheet, cell.sx, cell.sy, cell.x * TILE_SIZE, cell.y * TILE_SIZE);
}

/** Draw every object-layer decor cell flat (no depth sort) — used by the editor. */
export function drawObjectDecorFlat(ctx: CanvasRenderingContext2D, map: OfficeMap): void {
  for (const d of map.decor ?? []) {
    if (decorLayer(map, d) === 'object') drawDecorCellAt(ctx, d);
  }
}

/** Faint tile grid (drawn under decorations). */
export function drawGrid(ctx: CanvasRenderingContext2D, map: OfficeMap): void {
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let tx = 0; tx <= map.width; tx++) {
    ctx.beginPath();
    ctx.moveTo(tx * TILE_SIZE, 0);
    ctx.lineTo(tx * TILE_SIZE, map.height * TILE_SIZE);
    ctx.stroke();
  }
  for (let ty = 0; ty <= map.height; ty++) {
    ctx.beginPath();
    ctx.moveTo(0, ty * TILE_SIZE);
    ctx.lineTo(map.width * TILE_SIZE, ty * TILE_SIZE);
    ctx.stroke();
  }
}

/** Draw an avatar (tile-space center) as a colored disc (name label drawn separately). */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  isSelf: boolean,
): void {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const r = TILE_SIZE * 0.38;

  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = isSelf ? 3 : 1.5;
  ctx.strokeStyle = isSelf ? '#ffffff' : '#000000';
  ctx.stroke();
}

/**
 * Draw an appearance sprite feet-anchored and centered on the tile point
 * (x, y) → (x*TILE_SIZE, y*TILE_SIZE). The 64px frame is twice as wide as a
 * 32px tile, so it's centered horizontally and lifted so the feet sit on the point.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  dir: Direction,
  col: number,
  x: number,
  y: number,
): void {
  ctx.imageSmoothingEnabled = false;
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  drawAppearance(ctx, a, dir, col, px - FRAME_SIZE / 2, py - FRAME_SIZE + FOOT_OFFSET);
}

/** Rotation to lay the standing frame flat with its feet pointing `dir` (the frame's feet point down). */
const LIE_ROTATION: Record<Direction, number> = {
  down: 0,
  up: Math.PI,
  left: Math.PI / 2,
  right: -Math.PI / 2,
};
const FEET_VECTOR: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/**
 * Draw an avatar in a pose at tile point (x, y). Sitting: the full standing frame lowered onto
 * the seat (furniture in front hides the legs via depth sort). Lying: the full standing frame
 * rotated so the feet point `dir`, shifted that way so the head rests on the pillow tile.
 */
export function drawPosedSprite(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  pose: Pose,
  dir: Direction,
  col: number,
  x: number,
  y: number,
): void {
  if (pose === 'stand') return drawSprite(ctx, a, dir, col, x, y);
  ctx.imageSmoothingEnabled = false;
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  if (pose === 'sit') {
    drawAppearance(ctx, a, dir, 0, px - FRAME_SIZE / 2, py - FRAME_SIZE + FOOT_OFFSET + SIT_DROP);
    return;
  }
  const feet = FEET_VECTOR[dir];
  ctx.save();
  ctx.translate(px + (feet.dx * TILE_SIZE) / 2, py + (feet.dy * TILE_SIZE) / 2);
  ctx.rotate(LIE_ROTATION[dir]);
  drawAppearance(ctx, a, 'down', 0, -FRAME_SIZE / 2, -FRAME_SIZE / 2);
  ctx.restore();
}

/** Draw a centered name label just above the tile point. */
export function drawNameLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  name: string,
): void {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#e6e8eb';
  ctx.fillText(name, px, py - TILE_SIZE * 0.38 - 2);
}
