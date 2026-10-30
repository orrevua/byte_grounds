import { decorLayer, type OfficeMap } from '@byte_grounds/shared/map';
import { drawDecorCellAt, drawMap, mapPixelSize } from './render.ts';
import { isTouchDevice } from './input.ts';

/** Largest minimap (CSS px); phones get a smaller one above the touch pad, clear of the centred Sit / Dance buttons. */
const MAX_DESKTOP = { w: 200, h: 150 };
const MAX_TOUCH = { w: 104, h: 104 };
/** Overlay redraws (dots + view rectangle) at most this often. */
const OVERLAY_MS = 100;

/** Minimap px per world px, so a `world`-sized map fits inside `max` (aspect kept). */
export function minimapScale(world: { w: number; h: number }, max: { w: number; h: number }): number {
  return Math.min(max.w / world.w, max.h / world.h);
}

/** A point on the minimap (px from its top-left) → the world point (px) it shows, clamped to the map. */
export function minimapToWorld(
  mx: number,
  my: number,
  scale: number,
  world: { w: number; h: number },
): { px: number; py: number } {
  return {
    px: Math.min(Math.max(mx / scale, 0), world.w),
    py: Math.min(Math.max(my / scale, 0), world.h),
  };
}

export interface MinimapDot {
  x: number; // tile space
  y: number;
  kind: 'self' | 'near' | 'other';
}

/**
 * Overview of the whole map in the bottom-right corner: floors and furniture, everyone as a
 * dot, and the rectangle the screen shows. Clicking or dragging on it looks at that spot
 * (`onLook`, world px); "Back to me" (`onRecenter`) follows our avatar again.
 */
export class Minimap {
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly backBtn: HTMLButtonElement;
  /** The whole map drawn at full size once; scaled down on every overlay redraw. */
  private base: HTMLCanvasElement | null = null;
  private scale = 1;
  private lastDraw = 0;
  private dragging = false;

  constructor(
    private map: OfficeMap,
    private readonly onLook: (px: number, py: number) => void,
    private readonly onRecenter: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'minimap';
    if (isTouchDevice()) this.el.classList.add('touch');
    this.canvas = document.createElement('canvas');
    this.canvas.title = 'Click or drag to look around';
    this.ctx = this.canvas.getContext('2d')!;
    this.backBtn = document.createElement('button');
    this.backBtn.type = 'button';
    this.backBtn.textContent = 'Back to me';
    this.backBtn.className = 'hidden';
    this.backBtn.addEventListener('click', () => this.onRecenter());
    this.el.append(this.backBtn, this.canvas);
    document.body.appendChild(this.el);

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.look(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.look(e);
    });
    const stop = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.resize();
    // Furniture art may still be loading on the first draw: draw the map again a bit later.
    setTimeout(() => this.invalidate(), 1500);
  }

  /** The map changed (live edit, resize): redraw it on the next overlay draw. */
  invalidate(): void {
    this.base = null;
    this.resize();
  }

  /** Show "Back to me" while the view isn't following our avatar. */
  setFollowing(following: boolean): void {
    this.backBtn.classList.toggle('hidden', following);
  }

  dispose(): void {
    this.el.remove();
  }

  /** Redraw: the map, the screen's rectangle (world px) and the dots. Throttled. */
  draw(view: { x: number; y: number; w: number; h: number }, dots: MinimapDot[]): void {
    const now = performance.now();
    if (now - this.lastDraw < OVERLAY_MS) return;
    this.lastDraw = now;
    const { ctx, scale } = this;
    const { width, height } = this.canvas;
    this.base ??= this.renderBase();
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.base, 0, 0, width, height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(view.x * scale + 0.75, view.y * scale + 0.75, view.w * scale - 1.5, view.h * scale - 1.5);

    const r = Math.max(2.5, Math.min(4, 32 * scale * 0.45));
    for (const d of dots) {
      ctx.beginPath();
      ctx.arc(d.x * 32 * scale, d.y * 32 * scale, d.kind === 'self' ? r + 1 : r, 0, Math.PI * 2);
      ctx.fillStyle = d.kind === 'self' ? '#4f8cff' : d.kind === 'near' ? '#4fe0a0' : '#f3c969';
      ctx.fill();
      ctx.strokeStyle = '#14161a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private resize(): void {
    const world = mapPixelSize(this.map);
    this.scale = minimapScale(world, isTouchDevice() ? MAX_TOUCH : MAX_DESKTOP);
    this.canvas.width = Math.max(1, Math.round(world.w * this.scale));
    this.canvas.height = Math.max(1, Math.round(world.h * this.scale));
    this.lastDraw = 0;
  }

  private renderBase(): HTMLCanvasElement {
    const { w, h } = mapPixelSize(this.map);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    drawMap(ctx, this.map);
    for (const d of this.map.decor ?? []) {
      if (decorLayer(this.map, d) === 'object') drawDecorCellAt(ctx, d);
    }
    return c;
  }

  private look(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const mx = ((e.clientX - r.left) * this.canvas.width) / r.width;
    const my = ((e.clientY - r.top) * this.canvas.height) / r.height;
    const p = minimapToWorld(mx, my, this.scale, mapPixelSize(this.map));
    this.onLook(p.px, p.py);
  }
}
