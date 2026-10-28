import { TILE_SIZE } from '@byte_grounds/shared/protocol';

/**
 * Decoration art sheets: every PNG in `src/assets/decor/` (bundled by Vite), keyed by file
 * name without `.png`. Cells are TILE_SIZE (32px) squares, the LPC grid.
 */
const SHEET_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('./assets/decor/*.png', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => [path.replace(/^.*\//, '').replace(/\.png$/, ''), url]),
);

export const DECOR_SHEETS: string[] = Object.keys(SHEET_URLS).sort();

const images = new Map<string, HTMLImageElement>();

/** The sheet's image, starting the load on first use; draw it once `complete`. */
export function decorImage(sheet: string): HTMLImageElement | null {
  const url = SHEET_URLS[sheet];
  if (!url) return null;
  let img = images.get(sheet);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(sheet, img);
  }
  return img;
}

export function loadDecorSheets(sheets: Iterable<string>): Promise<void> {
  const pending = [...new Set(sheets)].flatMap((s) => {
    const img = decorImage(s);
    if (!img || img.complete) return [];
    return [new Promise<void>((done) => img.addEventListener('load', () => done(), { once: true }))];
  });
  return Promise.all(pending).then(() => undefined);
}

/** Draw sheet cell (sx, sy) at canvas pixel (px, py); no-op until the sheet has loaded. */
export function drawDecorCell(
  ctx: CanvasRenderingContext2D,
  sheet: string,
  sx: number,
  sy: number,
  px: number,
  py: number,
): void {
  const img = decorImage(sheet);
  if (!img?.complete || !img.naturalWidth) return;
  ctx.drawImage(img, sx * TILE_SIZE, sy * TILE_SIZE, TILE_SIZE, TILE_SIZE, px, py, TILE_SIZE, TILE_SIZE);
}
