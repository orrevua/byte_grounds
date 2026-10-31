import { TILE_SIZE } from '@byte_grounds/shared/protocol';
import { decorLayer, tileColor, zoneKey } from '@byte_grounds/shared/map';
import type { DecorCell, OfficeMap, Zone } from '@byte_grounds/shared/map';
import {
  FRAME_SIZE,
  drawHead,
  LIE_SHIFT,
  drawAppearance,
  drawDanceAppearance,
  drawSitAppearance,
  breathOffset,
  drawAppearanceFrame,
  drawTuckedAppearance,
  lieMode,
  lieTransform,
  tuckLayout,
} from './sprites.ts';
import { drawDecorCell } from './decor.ts';
import type { Direction } from './sprites.ts';
import type { Appearance, HeldItem, Pose } from '@byte_grounds/shared/protocol';

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
 * the pillow. On an up/down bed: tucked in, head on the pillow. Either way the head breathes (1px,
 * slow) and the game draws the bed's own cells back over the body.
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
    drawTuckedAppearance(ctx, a, dir, breathOffset(nowMs, seedOf(x, y)));
    ctx.restore();
    return;
  }
  const feet = FEET_VECTOR[dir];
  const { src, rot } = lieTransform(dir);
  ctx.save();
  // Breathing nudges the sleeper toward the pillow and back.
  const b = breathOffset(nowMs, seedOf(x, y));
  ctx.translate(px + feet.dx * (LIE_SHIFT - b), py + feet.dy * (LIE_SHIFT - b));
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
  /** Prefix the name with a yellow [ADM] tag. */
  admin?: boolean;
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
  if (tags.admin) {
    // "[ADM] name" centred as one line: yellow tag, then the name.
    const tag = '[ADM] ';
    const tagW = ctx.measureText(tag).width;
    const left = px - (tagW + ctx.measureText(tags.name).width) / 2;
    ctx.textAlign = 'left';
    outlinedText(ctx, tag, left, top, '#ffd84a');
    outlinedText(ctx, tags.name, left + tagW, top, '#e6e8eb');
    ctx.textAlign = 'center';
  } else {
    outlinedText(ctx, tags.name, px, top, '#e6e8eb');
  }
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

/** Meeting rooms on the map: a soft tint, a dashed outline and the room's name in its corner. */
export function drawZones(
  ctx: CanvasRenderingContext2D,
  map: OfficeMap,
  highlight: Zone | null = null,
  part: 'area' | 'label' | 'both' = 'both',
): void {
  ctx.save();
  for (const z of map.zones ?? []) {
    const x = z.x * TILE_SIZE;
    const y = z.y * TILE_SIZE;
    const w = z.w * TILE_SIZE;
    const h = z.h * TILE_SIZE;
    const on = !!highlight && zoneKey(z) === zoneKey(highlight);
    if (part !== 'label') drawZoneArea(ctx, x, y, w, h, on);
    if (part === 'area') continue;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const label = `▣ ${z.name}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(20, 22, 26, 0.75)';
    ctx.fillRect(x + 4, y + 4, tw + 10, 17);
    ctx.fillStyle = '#cfe0ff';
    ctx.fillText(label, x + 9, y + 7);
  }
  ctx.restore();
}

function drawZoneArea(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, on: boolean): void {
  ctx.fillStyle = on ? 'rgba(79, 140, 255, 0.10)' : 'rgba(79, 140, 255, 0.05)';
  ctx.fillRect(x, y, w, h);
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = on ? 'rgba(120, 170, 255, 0.9)' : 'rgba(120, 170, 255, 0.5)';
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.setLineDash([]);
}

/** A per-bed phase so neighbours don't breathe in unison. */
function seedOf(x: number, y: number): number {
  return Math.floor(x * 7919 + y * 104729) % 3600;
}

/** Every SIP_MS a standing drinker sips; the sip lasts SIP_LEN_MS. */
export const SIP_MS = 7000;
export const SIP_LEN_MS = 1200;

/** One frame of a sip: which sheet frame to draw and where the cup is (px from the feet point). */
export interface SipStep {
  row: number;
  col: number;
  cup: { dx: number; dy: number };
}

/**
 * The sip, per facing, as (frame, cup) steps over SIP_LEN_MS. Facing down: the bow row's hand
 * rises to the chin (cols 4 -> 6 -> 4); sideways: the thrust row's front fist comes up to the chin.
 * Cup positions are the hand in those frames (frame px - (32, 48)).
 */
const SIP_STEPS: Partial<Record<Direction, readonly { until: number; step: SipStep }[]>> = {
  down: [
    { until: 300, step: { row: 18, col: 4, cup: { dx: -10, dy: -12 } } },
    { until: 900, step: { row: 18, col: 6, cup: { dx: -11, dy: -16 } } },
    { until: 1200, step: { row: 18, col: 4, cup: { dx: -10, dy: -12 } } },
  ],
  left: [{ until: 1200, step: { row: 5, col: 7, cup: { dx: -10, dy: -11 } } }],
  right: [{ until: 1200, step: { row: 7, col: 7, cup: { dx: 11, dy: -11 } } }],
};

/** Without arm frames (see `hasArmFrames`): the standing frame, the cup lifted to the mouth. */
const SIP_NO_ARM: Partial<Record<Direction, SipStep>> = {
  down: { row: 10, col: 0, cup: { dx: -8, dy: -14 } },
  left: { row: 9, col: 0, cup: { dx: -9, dy: -14 } },
  right: { row: 11, col: 0, cup: { dx: 9, dy: -14 } },
};

/**
 * The sip frame to draw now, or null: only standing still, holding a drink and not facing away,
 * in the first SIP_LEN_MS of every SIP_MS (offset by `seed` so drinkers don't sip in unison).
 */
export function sipStep(
  item: HeldItem,
  pose: Pose,
  dir: Direction,
  moving: boolean,
  nowMs: number,
  seed = 0,
  armFrames = true,
): SipStep | null {
  if (!item || pose !== 'stand' || moving || !Number.isFinite(nowMs)) return null;
  const steps = SIP_STEPS[dir];
  if (!steps) return null;
  const t = (((nowMs + seed) % SIP_MS) + SIP_MS) % SIP_MS;
  if (t >= SIP_LEN_MS) return null;
  return armFrames ? steps.find((s) => t < s.until)!.step : (SIP_NO_ARM[dir] ?? null);
}

/**
 * Where a held cup rests, from the feet point (world px); null = not shown: facing away (the body
 * hides it), lying down, or dancing (the arms are busy). Seated, it rests on the lap.
 */
export function cupRest(pose: Pose, dir: Direction): { dx: number; dy: number } | null {
  if (dir === 'up' || pose === 'lie' || pose === 'dance') return null;
  // Hands hang at frame rows ~44-48 (the frame's top is 48px above the feet point).
  if (pose === 'sit') return dir === 'down' ? { dx: -8, dy: -2 } : { dx: dir === 'left' ? -6 : 6, dy: -3 };
  return dir === 'down' ? { dx: -12, dy: -2 } : { dx: dir === 'left' ? -5 : 5, dy: -4 };
}

/**
 * A held drink by the avatar's hand: a white mug of coffee with steam, or a paper cup of water.
 * `sip` (from `sipStep`) puts it where the raised hand is. Pixel-drawn (whole px) like the sprites.
 */
export function drawHeldItem(
  ctx: CanvasRenderingContext2D,
  item: HeldItem,
  pose: Pose,
  dir: Direction,
  x: number,
  y: number,
  nowMs: number,
  sip: SipStep | null = null,
): void {
  const at = sip?.cup ?? (item ? cupRest(pose, dir) : null);
  if (!item || !at) return;
  const cx = Math.round(x * TILE_SIZE + at.dx);
  const cy = Math.round(y * TILE_SIZE + at.dy);
  const px = (dx: number, dy: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(cx + dx, cy + dy, w, h);
  };
  ctx.save();
  if (item === 'coffee') {
    px(-3, -3, 7, 7, '#2a1d17'); // outline
    px(-2, -2, 5, 5, '#f4f1ea'); // mug
    px(-2, -2, 5, 1, '#6b3f24'); // coffee
    px(4, -1, 2, 3, '#2a1d17'); // handle
    px(4, 0, 1, 1, '#f4f1ea');
    px(-2, 2, 5, 1, '#cfc8ba'); // shade
    if (!sip) {
      // Steam: two wisps drifting up and fading.
      for (let i = 0; i < 2; i++) {
        const t = (nowMs / 1400 + i / 2) % 1;
        ctx.globalAlpha = 0.55 * (1 - t);
        const sx = Math.round(Math.sin((t + i) * Math.PI * 2) * 1.5) + (i ? 1 : -1);
        px(sx, -5 - Math.round(t * 7), 1, 2, '#ffffff');
      }
    }
  } else {
    px(-3, -4, 6, 8, '#2f4a5e'); // outline
    px(-2, -3, 4, 6, '#e8f4fb'); // paper cup
    px(-2, -1, 4, 3, '#7cc4ec'); // water
    px(-2, -1, 4, 1, '#b9e3f8'); // surface
  }
  ctx.restore();
}

/** Draw a sheet frame (row, col) of an appearance feet-anchored at tile point (x, y), like `drawSprite`. */
export function drawFrameSprite(ctx: CanvasRenderingContext2D, a: Appearance, row: number, col: number, x: number, y: number): void {
  ctx.imageSmoothingEnabled = false;
  drawAppearanceFrame(ctx, a, row, col, x * TILE_SIZE - FRAME_SIZE / 2, y * TILE_SIZE - FRAME_SIZE + FOOT_OFFSET);
}
