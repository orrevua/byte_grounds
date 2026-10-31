import { TILE_SIZE } from '@byte_grounds/shared/protocol';
import type { Rotation } from '@byte_grounds/shared/map';
import { labelObjects, type SheetObjects } from './decor-objects.ts';

/**
 * Decoration art sheets: every PNG in `src/assets/decor/` (bundled by Vite), keyed by file
 * name without `.png`. Cells are TILE_SIZE (32px) squares, the LPC grid.
 */
const SHEET_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('./assets/decor/*.png', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => [path.replace(/^.*\//, '').replace(/\.png$/, ''), url]),
);

/**
 * Sheets offered in the editor picker. A sheet with a `<name>_grid` repack (same art moved onto
 * whole cells by `tools/repack_decor.py`) is hidden in favour of it, but still loads and draws:
 * saved maps reference its cells.
 */
export const DECOR_SHEETS: string[] = Object.keys(SHEET_URLS)
  .filter((s) => !(`${s}_grid` in SHEET_URLS))
  .sort();

/**
 * Add (or replace) a sheet at runtime: Sheet Studio's custom sheets, by id, with an image URL
 * (a PNG data URL). It joins the picker list and drops any cached image/objects of the old version.
 */
export function registerSheet(id: string, url: string): void {
  if (SHEET_URLS[id] === url) return;
  SHEET_URLS[id] = url;
  images.delete(id);
  objects.delete(id);
  if (!DECOR_SHEETS.includes(id)) {
    DECOR_SHEETS.push(id);
    DECOR_SHEETS.sort();
  }
}

/** Remove a runtime sheet from the picker (its cells on maps stop drawing). */
export function unregisterSheet(id: string): void {
  delete SHEET_URLS[id];
  images.delete(id);
  objects.delete(id);
  const i = DECOR_SHEETS.indexOf(id);
  if (i >= 0) DECOR_SHEETS.splice(i, 1);
}

/** Register every saved custom sheet (a failure only means no custom art: logged, not thrown). */
export async function loadCustomSheets(store: { listSheets(): Promise<{ id: string; png: string }[]> }): Promise<string[]> {
  try {
    const sheets = await store.listSheets();
    for (const s of sheets) registerSheet(s.id, s.png);
    return sheets.map((s) => s.id);
  } catch (err) {
    console.warn('[sheets] custom sheets unavailable:', err);
    return [];
  }
}

/**
 * Wall/floor sets whose pieces are drawn to join across cells: "the object under the click"
 * means nothing there, so a picker click selects just the clicked cell.
 */
export const TILE_SHEETS: ReadonlySet<string> = new Set(['interior', 'interior_tiles', 'castle', 'stairs', 'house_inside']);

const images = new Map<string, HTMLImageElement>();
const objects = new Map<string, SheetObjects>();

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

/**
 * Every art object of a loaded sheet (see `decor-objects.ts`), read back from an offscreen
 * canvas once per sheet and cached; null until the image has loaded.
 */
export function decorObjects(sheet: string): SheetObjects | null {
  const cached = objects.get(sheet);
  if (cached) return cached;
  const img = decorImage(sheet);
  if (!img?.complete || !img.naturalWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const found = labelObjects(ctx.getImageData(0, 0, canvas.width, canvas.height));
  objects.set(sheet, found);
  return found;
}

export function loadDecorSheets(sheets: Iterable<string>): Promise<void> {
  const pending = [...new Set(sheets)].flatMap((s) => {
    const img = decorImage(s);
    if (!img || img.complete) return [];
    return [new Promise<void>((done) => img.addEventListener('load', () => done(), { once: true }))];
  });
  return Promise.all(pending).then(() => undefined);
}

/**
 * Draw sheet cell (sx, sy) at canvas pixel (px, py), mirrored by `flipX` then turned `rot`
 * degrees clockwise within its tile; no-op until the sheet has loaded.
 */
export function drawDecorCell(
  ctx: CanvasRenderingContext2D,
  sheet: string,
  sx: number,
  sy: number,
  px: number,
  py: number,
  rot: Rotation = 0,
  flipX = false,
): void {
  const img = decorImage(sheet);
  if (!img?.complete || !img.naturalWidth) return;
  if (rot === 0 && !flipX) {
    ctx.drawImage(img, sx * TILE_SIZE, sy * TILE_SIZE, TILE_SIZE, TILE_SIZE, px, py, TILE_SIZE, TILE_SIZE);
    return;
  }
  const half = TILE_SIZE / 2;
  ctx.save();
  // 90° steps around the integer tile centre are a lossless pixel permutation; keep them crisp.
  ctx.imageSmoothingEnabled = false;
  ctx.translate(px + half, py + half);
  ctx.rotate((rot * Math.PI) / 180);
  if (flipX) ctx.scale(-1, 1);
  ctx.drawImage(img, sx * TILE_SIZE, sy * TILE_SIZE, TILE_SIZE, TILE_SIZE, -half, -half, TILE_SIZE, TILE_SIZE);
  ctx.restore();
}
