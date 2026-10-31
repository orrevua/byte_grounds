import { TILE_SIZE } from '@byte_grounds/shared/protocol';
import { DECOR_SHEETS, TILE_SHEETS, decorImage, decorObjects } from './decor.ts';
import { pickCellsAt, type CellRect } from './decor-objects.ts';
import {
  IDENTITY,
  describeTransform,
  flipH,
  flipV,
  rotateCCW,
  rotateCW,
  type DecorTransform,
} from './decor-transform.ts';
import type { BlockMode, DecorSelection } from './editor-model.ts';
import { t, type MsgKey } from './i18n.ts';

/** What the next stamp puts down: the picked sheet cells, how they block, and the turn/mirror. */
export interface PickerState {
  selection: DecorSelection | null;
  mode: BlockMode;
  t: DecorTransform;
}

export type TransformOp = (t: DecorTransform) => DecorTransform;

const TRANSFORM_BUTTONS: { label: string; title: MsgKey; op: TransformOp }[] = [
  { label: '⟲', title: 'picker.rotateLeft', op: rotateCCW },
  { label: '⟳', title: 'picker.rotateRight', op: rotateCW },
  { label: '⇋', title: 'picker.flipH', op: flipH },
  { label: '⇵', title: 'picker.flipV', op: flipV },
];

/** The brush transform a key stands for: R / Shift+R turn, F / V mirror. */
export function transformForKey(e: KeyboardEvent): TransformOp | null {
  switch (e.key.toLowerCase()) {
    case 'r':
      return e.shiftKey ? rotateCCW : rotateCW;
    case 'f':
      return flipH;
    case 'v':
      return flipV;
    default:
      return null;
  }
}

/**
 * The decoration sheet picker (map editor and live build panel): sheet select, the sheet with
 * whole-object click / Alt+click / drag picking, the Block select and the transform buttons.
 * `onChange` fires when the user picks cells, changes the transform, or changes the Block mode;
 * `setTransform` (keyboard R/F/V) does not fire it.
 */
export function mountDecorPicker(
  body: HTMLElement,
  onChange: (s: PickerState) => void,
): { state(): PickerState; setTransform(t: DecorTransform): void; refreshSheets(): void } {
  let selection: DecorSelection | null = null;
  let mode: BlockMode = 'base';
  let brushT: DecorTransform = IDENTITY;
  const state = (): PickerState => ({ selection, mode, t: brushT });
  const setTransform = (t: DecorTransform) => {
    brushT = t;
    const label = body.querySelector<HTMLSpanElement>('#brush-transform');
    if (label) label.textContent = describeTransform(brushT);
  };

  if (DECOR_SHEETS.length === 0) {
    body.innerHTML = `<p class="hint">${t('picker.noArt')}</p>`;
    return { state, setTransform, refreshSheets: () => {} };
  }
  body.innerHTML = `
    <div class="row" style="margin-bottom:6px">
      <select id="sheet-select" style="flex:1">${DECOR_SHEETS.map((s) => `<option>${s}</option>`).join('')}</select>
    </div>
    <div id="sheet-wrap"><canvas id="sheet"></canvas></div>
    <div class="row" style="margin-top:6px">
      ${t('picker.block')} <select id="block-decor" style="flex:1">
        <option value="base" selected>${t('picker.blockBase')}</option>
        <option value="all">${t('picker.blockAll')}</option>
        <option value="none">${t('picker.blockNone')}</option>
      </select>
    </div>
    <p class="hint">${t('picker.blockHint')}</p>
    <div class="row" id="brush-tools" style="margin-top:6px">
      <button id="brush-reset">${t('picker.reset')}</button> <span id="brush-transform" class="hint"></span>
    </div>
    <p class="hint">${t('picker.pickHint')}</p>
    <p class="hint">${t('picker.turnHint')}</p>`;
  const sheetSelect = body.querySelector<HTMLSelectElement>('#sheet-select')!;
  const sheetCanvas = body.querySelector<HTMLCanvasElement>('#sheet')!;
  const sctx = sheetCanvas.getContext('2d')!;
  body.querySelector<HTMLSelectElement>('#block-decor')!.addEventListener('change', (e) => {
    mode = (e.target as HTMLSelectElement).value as BlockMode;
    onChange(state());
  });
  const resetBtn = body.querySelector<HTMLButtonElement>('#brush-reset')!;
  for (const { label, title, op } of TRANSFORM_BUTTONS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = t(title);
    b.addEventListener('click', () => {
      setTransform(op(brushT));
      onChange(state());
    });
    resetBtn.before(b);
  }
  resetBtn.addEventListener('click', () => {
    setTransform(IDENTITY);
    onChange(state());
  });
  setTransform(brushT);

  let sheet = DECOR_SHEETS[0]!;
  let dragFrom: { x: number; y: number } | null = null;
  let dragged = false;
  let hoverPick: CellRect | null = null;

  const drawSheet = () => {
    const img = decorImage(sheet);
    if (!img) return;
    if (!img.complete) {
      img.addEventListener('load', drawSheet, { once: true });
      return;
    }
    sheetCanvas.width = img.naturalWidth;
    sheetCanvas.height = img.naturalHeight;
    sctx.fillStyle = '#0d0f12';
    sctx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
    sctx.drawImage(img, 0, 0);
    sctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let x = 0; x <= img.naturalWidth; x += TILE_SIZE) sctx.strokeRect(x, 0, 0, img.naturalHeight);
    for (let y = 0; y <= img.naturalHeight; y += TILE_SIZE) sctx.strokeRect(0, y, img.naturalWidth, 0);
    if (selection?.sheet === sheet) {
      sctx.strokeStyle = '#4fe0a0';
      sctx.lineWidth = 2;
      sctx.strokeRect(
        selection.sx * TILE_SIZE + 1,
        selection.sy * TILE_SIZE + 1,
        selection.w * TILE_SIZE - 2,
        selection.h * TILE_SIZE - 2,
      );
      sctx.lineWidth = 1;
    }
    if (hoverPick) {
      sctx.strokeStyle = '#ffffff';
      sctx.setLineDash([4, 3]);
      sctx.strokeRect(
        hoverPick.sx * TILE_SIZE + 0.5,
        hoverPick.sy * TILE_SIZE + 0.5,
        hoverPick.w * TILE_SIZE - 1,
        hoverPick.h * TILE_SIZE - 1,
      );
      sctx.setLineDash([]);
    }
  };

  const pixelAt = (e: PointerEvent) => {
    const r = sheetCanvas.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - r.left) * (sheetCanvas.width / r.width)),
      y: Math.floor((e.clientY - r.top) * (sheetCanvas.height / r.height)),
    };
  };
  const cellAt = (e: PointerEvent) => {
    const p = pixelAt(e);
    return { x: Math.floor(p.x / TILE_SIZE), y: Math.floor(p.y / TILE_SIZE) };
  };
  /** What a click here picks: the whole object under it, or the one cell on tile sheets / Alt. */
  const clickPick = (e: PointerEvent): CellRect => {
    const p = pixelAt(e);
    const objs = e.altKey || TILE_SHEETS.has(sheet) ? null : decorObjects(sheet);
    return (objs && pickCellsAt(objs, p.x, p.y)) ?? { sx: Math.floor(p.x / TILE_SIZE), sy: Math.floor(p.y / TILE_SIZE), w: 1, h: 1 };
  };
  const rectKey = (r: CellRect | null) => (r ? `${r.sx},${r.sy},${r.w},${r.h}` : '');
  const setHover = (pick: CellRect | null) => {
    if (rectKey(pick) === rectKey(hoverPick)) return;
    hoverPick = pick;
    drawSheet();
  };
  const selectRect = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    selection = {
      sheet,
      sx: Math.min(a.x, b.x),
      sy: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x) + 1,
      h: Math.abs(a.y - b.y) + 1,
    };
    drawSheet();
  };
  // A click picks the object under it; once the pointer leaves the pressed cell it is a drag,
  // which picks exactly the dragged block (the manual override, e.g. for wall/floor sets).
  sheetCanvas.addEventListener('pointerdown', (e) => {
    dragFrom = cellAt(e);
    dragged = false;
    sheetCanvas.setPointerCapture(e.pointerId);
    hoverPick = null;
    selection = { sheet, ...clickPick(e) };
    drawSheet();
  });
  sheetCanvas.addEventListener('pointermove', (e) => {
    if (!dragFrom) return setHover(clickPick(e));
    const c = cellAt(e);
    if (dragged || c.x !== dragFrom.x || c.y !== dragFrom.y) {
      dragged = true;
      selectRect(dragFrom, c);
    }
  });
  sheetCanvas.addEventListener('pointerup', () => {
    dragFrom = null;
    onChange(state());
  });
  sheetCanvas.addEventListener('pointerleave', () => {
    if (!dragFrom) setHover(null);
  });
  sheetSelect.addEventListener('change', () => {
    sheet = sheetSelect.value;
    hoverPick = null;
    drawSheet();
  });
  drawSheet();
  /** Re-list the sheets (custom sheets registered after mounting), keeping the current one. */
  const refreshSheets = () => {
    sheetSelect.replaceChildren(...DECOR_SHEETS.map((s) => new Option(s, s, false, s === sheet)));
    if (!DECOR_SHEETS.includes(sheet)) {
      sheet = DECOR_SHEETS[0]!;
      drawSheet();
    }
  };
  return { state, setTransform, refreshSheets };
}
