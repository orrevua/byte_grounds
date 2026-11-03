import { TILE_SIZE } from '@byte_grounds/shared/protocol';
import type { OfficeMap } from '@byte_grounds/shared/map';
import type { MapSummary } from './store.ts';
import { loadDecorSheets } from './decor.ts';
import { drawMap, drawObjectDecorFlat } from './render.ts';
import type { RoomCounts } from './lobby.ts';
import { t } from './i18n.ts';

const THUMB_W = 280;
const THUMB_H = 170;

/** Where a map of `w`x`h` px goes in the thumbnail: scaled to fit, centred. */
export function fitThumb(w: number, h: number, boxW = THUMB_W, boxH = THUMB_H): { scale: number; x: number; y: number } {
  const scale = Math.min(boxW / w, boxH / h);
  return { scale, x: (boxW - w * scale) / 2, y: (boxH - h * scale) / 2 };
}

/**
 * The join screen's map picker: a sliding carousel of miniatures (◀ ▶, dots, swipe, ←/→), each
 * with the map's name and how many are online there. Maps load lazily (the current slide and its
 * neighbours), and a miniature is redrawn once its furniture sheets arrive.
 */
export class MapCarousel {
  readonly el: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly dots: HTMLDivElement;
  private maps: MapSummary[] = [];
  private index = 0;
  private counts: RoomCounts = {};
  private readonly loaded = new Set<string>();
  /** The chosen map changed (its name). */
  onChange: (name: string) => void = () => {};

  constructor(private readonly loadMap: (id: string) => Promise<OfficeMap | null>) {
    const el = (this.el = document.createElement('div'));
    el.className = 'map-carousel';
    el.tabIndex = 0;
    el.innerHTML = `<div class="mc-row">
        <button type="button" class="mc-arrow" data-dir="-1" aria-label="${t('join.prevMap')}">◀</button>
        <div class="mc-viewport"><div class="mc-track"></div></div>
        <button type="button" class="mc-arrow" data-dir="1" aria-label="${t('join.nextMap')}">▶</button>
      </div>
      <div class="mc-dots"></div>`;
    this.track = el.querySelector('.mc-track')!;
    this.dots = el.querySelector('.mc-dots')!;
    for (const b of el.querySelectorAll<HTMLButtonElement>('.mc-arrow')) {
      b.addEventListener('click', () => this.go(this.index + Number(b.dataset.dir)));
    }
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.go(this.index + (e.key === 'ArrowLeft' ? -1 : 1));
      }
    });
    let startX: number | null = null;
    const viewport = el.querySelector<HTMLDivElement>('.mc-viewport')!;
    viewport.addEventListener('pointerdown', (e) => (startX = e.clientX));
    viewport.addEventListener('pointerup', (e) => {
      if (startX !== null && Math.abs(e.clientX - startX) > 30) this.go(this.index + (e.clientX < startX ? 1 : -1));
      startX = null;
    });
  }

  /** The chosen map id. */
  get value(): string {
    return this.maps[this.index]?.id ?? '';
  }

  setMaps(maps: MapSummary[], selected: string): void {
    this.maps = maps;
    this.index = Math.max(0, maps.findIndex((m) => m.id === selected));
    this.track.replaceChildren(
      ...maps.map((m) => {
        const slide = document.createElement('div');
        slide.className = 'mc-slide';
        slide.dataset.id = m.id;
        slide.innerHTML = `<canvas width="${THUMB_W}" height="${THUMB_H}"></canvas><div class="mc-name"></div><div class="mc-online"></div>`;
        slide.querySelector('.mc-name')!.textContent = m.name;
        return slide;
      }),
    );
    this.dots.replaceChildren(
      ...maps.map((m, i) => {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'mc-dot';
        d.title = m.name;
        d.addEventListener('click', () => this.go(i));
        return d;
      }),
    );
    this.renderCounts();
    this.go(this.index);
  }

  setCounts(counts: RoomCounts): void {
    this.counts = counts;
    this.renderCounts();
  }

  private go(i: number): void {
    const n = this.maps.length;
    if (!n) return;
    this.index = (i + n) % n;
    this.track.style.transform = `translateX(-${this.index * 100}%)`;
    this.dots.querySelectorAll('.mc-dot').forEach((d, k) => d.classList.toggle('on', k === this.index));
    this.onChange(this.maps[this.index]!.name);
    for (const k of [this.index, this.index + 1, this.index - 1]) void this.thumb(this.maps[(k + n) % n]!.id);
  }

  private renderCounts(): void {
    for (const slide of this.track.querySelectorAll<HTMLDivElement>('.mc-slide')) {
      const n = this.counts[slide.dataset.id!] ?? 0;
      const el = slide.querySelector<HTMLDivElement>('.mc-online')!;
      el.textContent = n === 1 ? t('join.onlineOne') : t('join.online', { n });
      el.classList.toggle('some', n > 0);
    }
  }

  /** Draw a map's miniature once (then again when its furniture sheets have loaded). */
  private async thumb(id: string): Promise<void> {
    if (this.loaded.has(id)) return;
    this.loaded.add(id);
    const map = await this.loadMap(id).catch(() => null);
    const canvas = this.track.querySelector<HTMLCanvasElement>(`.mc-slide[data-id="${CSS.escape(id)}"] canvas`);
    if (!map || !canvas) return;
    const draw = (): void => {
      const w = map.width * TILE_SIZE;
      const h = map.height * TILE_SIZE;
      const full = document.createElement('canvas');
      full.width = w;
      full.height = h;
      const fctx = full.getContext('2d')!;
      fctx.imageSmoothingEnabled = false;
      drawMap(fctx, map);
      drawObjectDecorFlat(fctx, map);
      const ctx = canvas.getContext('2d')!;
      const { scale, x, y } = fitThumb(w, h);
      ctx.clearRect(0, 0, THUMB_W, THUMB_H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(full, x, y, w * scale, h * scale);
    };
    draw();
    await loadDecorSheets((map.decor ?? []).map((d) => d.sheet)).catch(() => {});
    draw();
  }
}
