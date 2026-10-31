import { TILE_SIZE } from '@byte_grounds/shared/protocol';
import { decorLayer, tileColor } from '@byte_grounds/shared/map';
import type { DecorCell, OfficeMap } from '@byte_grounds/shared/map';
import {
  FRAME_SIZE,
  drawHead,
  LIE_SHIFT,
  drawAppearance,
  drawDanceAppearance,
  drawSitAppearance,
  drawTuckedAppearance,
  lieMode,
  lieTransform,
  tuckLayout,
} from './sprites.ts';
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
  drawDecorCell(ctx, cell.sheet, cell.sx, cell.sy, cell.x * TILE_SIZE, cell.y * TILE_SIZE, cell.rot ?? 0, cell.flipX === true);
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

const FEET_VECTOR: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/**
 * Draw an avatar in a pose at tile point (x, y). Sitting: the bent-leg sit frame, feet-anchored
 * like standing (furniture in front hides the legs via depth sort). Lying on a left/right bed: the
 * profile frame rotated onto its side (`lieTransform`), shifted along `dir` so the head rests on
 * the pillow. On an up/down bed: tucked in, head on the pillow and a blanket over the body.
 * Dancing: the dance step at `nowMs` (a wall clock, so every screen is on the same beat).
 */
export function drawPosedSprite(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  pose: Pose,
  dir: Direction,
  col: number,
  x: number,
  y: number,
  nowMs = 0,
): void {
  if (pose === 'stand') return drawSprite(ctx, a, dir, col, x, y);
  ctx.imageSmoothingEnabled = false;
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  if (pose === 'sit') {
    drawSitAppearance(ctx, a, dir, px - FRAME_SIZE / 2, py - FRAME_SIZE + FOOT_OFFSET);
    return;
  }
  if (pose === 'dance') {
    drawDanceAppearance(ctx, a, nowMs, px - FRAME_SIZE / 2, py - FRAME_SIZE + FOOT_OFFSET);
    return;
  }
  if (lieMode(dir) === 'tucked') {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(tuckLayout(dir).rot);
    drawTuckedAppearance(ctx, a, dir);
    ctx.restore();
    return;
  }
  const feet = FEET_VECTOR[dir];
  const { src, rot } = lieTransform(dir);
  ctx.save();
  ctx.translate(px + feet.dx * LIE_SHIFT, py + feet.dy * LIE_SHIFT);
  ctx.rotate(rot);
  drawAppearance(ctx, a, src, 0, -FRAME_SIZE / 2, -FRAME_SIZE / 2);
  ctx.restore();
}

/** How far above the tile point (world px) the name's baseline sits: just over the head, per pose. */
export function labelLift(pose: Pose): number {
  return pose === 'lie' ? 26 : pose === 'sit' ? 34 : 38;
}

/** What is drawn over an avatar, stacked upward from above its head. */
export interface AvatarTags {
  name: string;
  status?: string;
  busy?: boolean;
}

const NAME_FONT = '600 12px system-ui, sans-serif';
const STATUS_FONT = 'italic 10px system-ui, sans-serif';
const BALLOON_FONT = '12px system-ui, sans-serif';
const BALLOON_NAME_FONT = 'bold 12px system-ui, sans-serif';
const BALLOON_TEXT_W = 220;
const BALLOON_LINES = 3;
const BALLOON_LINE_H = 15;
/** Face box at the balloon's left edge. */
const FACE_W = 26;
const FACE_H = 24;
const ZZZ_MS = 1800;

/** Text with a dark outline, so it reads over any floor or furniture. */
function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string): void {
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(10, 12, 16, 0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/**
 * Greedy word wrap to `maxW` px, at most `maxLines` lines (the last one ellipsized). The first line
 * has `indent` px less room (e.g. for a bold name drawn before it).
 */
export function wrapText(
  measure: (s: string) => number,
  text: string,
  maxW: number,
  maxLines: number,
  indent = 0,
): string[] {
  const room = (i: number) => maxW - (i === 0 ? indent : 0);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= room(lines.length) || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const out = lines.slice(0, maxLines).map((l, i) => {
    while (measure(l) > room(i) && l.length > 1) l = l.slice(0, -1);
    return l;
  });
  if (lines.length > maxLines || out.some((l, i) => l !== lines[i])) {
    const i = out.length - 1;
    let last = out[i]!;
    while (measure(`${last}…`) > room(i) && last.length > 1) last = last.slice(0, -1);
    out[i] = `${last}…`;
  }
  return out;
}

/** Name, status line and busy zzZ over an avatar at tile point (x, y). Returns the y above them all. */
export function drawAvatarTags(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pose: Pose,
  tags: AvatarTags,
  nowMs: number,
): number {
  const px = x * TILE_SIZE;
  let top = y * TILE_SIZE - labelLift(pose);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = NAME_FONT;
  outlinedText(ctx, tags.name, px, top, '#e6e8eb');
  top -= 13;
  if (tags.status) {
    ctx.font = STATUS_FONT;
    outlinedText(ctx, tags.status, px, top, '#9fd0ff');
    top -= 11;
  }
  if (tags.busy) {
    drawZzz(ctx, px, top, nowMs);
    top -= 18;
  }
  return top;
}

/** Where a new chat balloon's tail points (world px): just above the sender's tags. */
export function tagsTop(y: number, pose: Pose, tags: AvatarTags): number {
  return y * TILE_SIZE - labelLift(pose) - 13 - (tags.status ? 11 : 0) - (tags.busy ? 18 : 0);
}

/** Three letters (z z Z) drifting up and to the right, fading out, on a loop. */
function drawZzz(ctx: CanvasRenderingContext2D, px: number, bottom: number, nowMs: number): void {
  ctx.save();
  ctx.textAlign = 'left';
  for (let i = 0; i < 3; i++) {
    const phase = (((nowMs / ZZZ_MS + i / 3) % 1) + 1) % 1;
    ctx.globalAlpha = Math.min(1, (1 - phase) * 1.6);
    ctx.font = `bold ${8 + Math.round(phase * 6)}px system-ui, sans-serif`;
    outlinedText(ctx, i === 2 ? 'Z' : 'z', px - 4 + phase * 14, bottom + 4 - phase * 18, '#c9d6ff');
  }
  ctx.restore();
}

/** A chat balloon's height (world px) for a line of text, so older balloons can make room. */
export function balloonHeight(ctx: CanvasRenderingContext2D, name: string, text: string): number {
  return balloonLayout(ctx, name, text).h;
}

function balloonLayout(ctx: CanvasRenderingContext2D, name: string, text: string): { lines: string[]; w: number; h: number; nameW: number } {
  ctx.font = BALLOON_NAME_FONT;
  const nameW = ctx.measureText(`${name}: `).width;
  ctx.font = BALLOON_FONT;
  // The first line starts after the bold name.
  const lines = wrapText((t) => ctx.measureText(t).width, text, BALLOON_TEXT_W, BALLOON_LINES, nameW);
  const widths = lines.map((l, i) => ctx.measureText(l).width + (i === 0 ? nameW : 0));
  const textW = Math.max(...widths);
  const h = Math.max(FACE_H + 6, lines.length * BALLOON_LINE_H + 10);
  return { lines, w: FACE_W + 10 + textW + 10, h, nameW };
}

/**
 * Habbo-style chat balloon: white rounded box with the speaker's face at its left edge, then
 * "name: message"; a small tail under it at `cx`. `bottom` is the tail tip (world px).
 */
export function drawChatBalloon(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  name: string,
  text: string,
  cx: number,
  bottom: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const { lines, w, h, nameW } = balloonLayout(ctx, name, text);
  const tailH = 5;
  const left = Math.round(cx - FACE_W / 2 - 8);
  const top = Math.round(bottom - tailH - h);
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, 8);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1b1f26';
  ctx.stroke();
  // Tail under the face, pointing at the speaker.
  ctx.beginPath();
  ctx.moveTo(cx - 5, top + h - 1);
  ctx.lineTo(cx, bottom);
  ctx.lineTo(cx + 5, top + h - 1);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 5, top + h);
  ctx.lineTo(cx, bottom);
  ctx.lineTo(cx + 5, top + h);
  ctx.stroke();
  // Face, in a soft circle at the left edge.
  const fx = left + 5;
  const fy = top + Math.round((h - FACE_H) / 2);
  ctx.fillStyle = '#dfe7f5';
  ctx.beginPath();
  ctx.roundRect(fx - 1, fy - 1, FACE_W + 2, FACE_H + 2, 6);
  ctx.fill();
  ctx.imageSmoothingEnabled = false;
  drawHead(ctx, a, fx, fy, FACE_W, FACE_H);
  // Text.
  const tx = fx + FACE_W + 6;
  const ty = top + Math.round((h - lines.length * BALLOON_LINE_H) / 2) + 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1b1f26';
  ctx.font = BALLOON_NAME_FONT;
  ctx.fillText(`${name}:`, tx, ty);
  ctx.font = BALLOON_FONT;
  lines.forEach((l, i) => ctx.fillText(l, tx + (i === 0 ? nameW : 0), ty + i * BALLOON_LINE_H));
  ctx.restore();
}
