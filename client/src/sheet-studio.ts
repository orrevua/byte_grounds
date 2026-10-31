import { createStore, customSheetId, type CustomSheet } from './store.ts';
import { hasSupabase } from './supabase.ts';
import { checkIsAdmin, ensureSession, shortId } from './auth.ts';
import { decorImage, loadCustomSheets, registerSheet, unregisterSheet } from './decor.ts';
import { mountDecorPicker } from './decor-picker.ts';
import { normalizeSeatMarks, registerSeatMarks, type SeatMark } from '@byte_grounds/shared/seats';
import {
  CELL,
  MAX_CELLS,
  applyOps,
  blankPixels,
  bufferToSpec,
  floodFill,
  linePoints,
  parseColor,
  parseSpec,
  put,
  sheetSlug,
  toHex,
  type Op,
  type Pixels,
  type SheetSpec,
} from './sprite-spec.ts';

/**
 * Sheet Studio (/sheets, admins only): draw 32px-cell pixel-art sheets, borrow pieces from the
 * game's art, save them for the map editor / Build panel, and import / export SheetSpec text.
 * Agents drive the same state through `window.sheetStudio` (see docs/sheet-studio.md).
 */

type Tool = 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'rectFill' | 'ellipse' | 'picker' | 'select';
type RGBA = [number, number, number, number];

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'b' },
  { id: 'eraser', label: 'Eraser', key: 'e' },
  { id: 'fill', label: 'Fill', key: 'g' },
  { id: 'line', label: 'Line', key: 'l' },
  { id: 'rect', label: 'Rect', key: 'r' },
  { id: 'rectFill', label: 'Filled rect', key: 'f' },
  { id: 'ellipse', label: 'Ellipse', key: 'o' },
  { id: 'picker', label: 'Eyedropper', key: 'i' },
  { id: 'select', label: 'Select cells', key: 's' },
];

/** A palette for the soft, modern office look (Gather-like), plus outlines and a shadow. */
const PALETTE = [
  '#2b2d42', '#4a4e69', '#8d99ae', '#c9ced6', '#f4f4f6', '#ffffff', '#000000', '#00000040',
  '#e8b77a', '#b5835a', '#7a4f33', '#efe3cf', '#d9c7a7', '#f2a679', '#c8693c', '#e05252',
  '#2f3542', '#5aa9e6', '#3c64b4', '#2a4680', '#7b74c9', '#5d57a8', '#f07ab0', '#b25bd1',
  '#5fa04e', '#3f7a3a', '#8ccf6b', '#4fc0b0', '#f5c84c', '#f29b38', '#9be3f5', '#6b4f3a',
];

type Bg = 'dark' | 'checker' | 'beige' | 'carpet' | 'tile';
const BGS: { id: Bg; label: string }[] = [
  { id: 'checker', label: 'Transparent' },
  { id: 'dark', label: 'Dark' },
  { id: 'beige', label: 'Beige floor' },
  { id: 'carpet', label: 'Purple carpet' },
  { id: 'tile', label: 'Grey tiles' },
];

const UNDO_LIMIT = 80;
const OUTLINE = '#2b2d42';

const store = createStore();
const root = document.querySelector<HTMLDivElement>('#studio')!;

// ---------- state ----------

let name = 'my_sheet';
let px: Pixels = blankPixels(4, 4);
let savedId: string | null = null;
let dirty = false;
let tool: Tool = 'pencil';
let color: RGBA = parseColor('#2b2d42')!;
let mirror = false;
let zoom = 8;
let bg: Bg = 'checker';
let showGrid = true;
/** Selection in cells. */
let sel: { x: number; y: number; w: number; h: number } | null = null;
let clipboard: Pixels | null = null;
let hover: { x: number; y: number } | null = null;
/** Sittable cells, by "x,y" (cell coordinates). */
let seats = new Map<string, SeatMark>();
let seatKind: SeatMark['kind'] = 'sit';
let seatDir: SeatMark['dir'] = 'down';
const undo: Uint8ClampedArray[] = [];
const redo: Uint8ClampedArray[] = [];
const recent: string[] = [];

// ---------- layout ----------

root.innerHTML = `
  <aside>
    <h1>Sheet Studio <a href="editor.html">Map editor →</a></h1>
    <div>
      <h2>Sheet</h2>
      <div class="row"><input id="name" style="flex:1" maxlength="40" /></div>
      <div class="row" style="margin-top:6px">
        <label>Cols <input id="cols" type="number" min="1" max="${MAX_CELLS}" /></label>
        <label>Rows <input id="rows" type="number" min="1" max="${MAX_CELLS}" /></label>
        <button id="resize">Resize</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="new">New</button>
        <button id="save" class="primary">Save</button>
        <button id="delete" class="danger">Delete</button>
      </div>
      <div class="row" style="margin-top:6px">
        <select id="saved" style="flex:1"><option value="">Open a saved sheet…</option></select>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="open-png">Open PNG</button>
        <button id="export-png">Export PNG</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="import-spec">Import spec</button>
        <button id="export-spec">Export spec</button>
      </div>
      <input id="png-file" type="file" accept="image/png" class="hidden" />
      <div id="status" class="status"></div>
    </div>
    <div>
      <h2>Tools</h2>
      <div class="tools" id="tools"></div>
      <div class="row" style="margin-top:6px">
        <label><input type="checkbox" id="mirror" /> Mirror in cell (M)</label>
      </div>
    </div>
    <div>
      <h2>Color</h2>
      <div class="row">
        <div id="current"><span></span></div>
        <input type="color" id="color" />
        <label style="flex:1">Alpha <input type="range" id="alpha" min="0" max="255" style="width:100%" /></label>
      </div>
      <div class="swatches" id="swatches" style="margin-top:6px"></div>
      <div class="swatches" id="recent" style="margin-top:6px"></div>
    </div>
    <div>
      <h2>Selection</h2>
      <p class="hint" id="sel-info">Select cells (S) to copy, flip, outline or shade them.</p>
      <div class="row" style="margin-top:6px">
        <button id="copy">Copy</button><button id="paste">Paste</button><button id="flip">Flip ⇋</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="outline">Outline</button><button id="darker">Darker</button><button id="lighter">Lighter</button><button id="clear">Clear</button>
      </div>
      <p class="hint" style="margin-top:6px">Paste goes to the cell under the pointer (or the selection). Outline uses the current color.</p>
    </div>
    <div>
      <h2>Seats (sittable)</h2>
      <div class="row">
        <select id="seat-kind"><option value="sit">Sit</option><option value="lie">Lie down</option></select>
        <label>facing <select id="seat-dir">
          <option value="down">↓ down</option><option value="up">↑ up</option>
          <option value="left">← left</option><option value="right">→ right</option></select></label>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="seat-mark">Mark selected cells</button><button id="seat-clear">Remove seats</button>
      </div>
      <p class="hint" style="margin-top:6px">Select the seat cell(s) of a chair, sofa or bed and mark them: in the game people
        get "Sit (E)" / "Lie down (E)" there. Facing = the way the person looks (a bed: where the feet point).
        Usually one cell per seat: the cushion, not the backrest.</p>
    </div>
  </aside>
  <main>
    <div class="bar">
      <label>Zoom <select id="zoom">${[4, 6, 8, 12, 16].map((z) => `<option value="${z}"${z === zoom ? ' selected' : ''}>${z}x</option>`).join('')}</select></label>
      <label>Background <select id="bg">${BGS.map((b) => `<option value="${b.id}">${b.label}</option>`).join('')}</select></label>
      <label><input type="checkbox" id="grid" checked /> Grid</label>
      <button id="undo" title="Ctrl+Z">Undo</button><button id="redo" title="Ctrl+Y">Redo</button>
      <span class="hint" id="pos"></span>
    </div>
    <div id="canvas-wrap"><canvas id="art"></canvas></div>
  </main>
  <aside class="right">
    <div>
      <h2>Preview (2x)</h2>
      <canvas id="preview" width="128" height="128"></canvas>
    </div>
    <div>
      <h2>Borrow from game art</h2>
      <div id="decor-body"></div>
      <div class="row" style="margin-top:6px"><button id="borrow">Copy picked cells</button></div>
      <p class="hint" style="margin-top:6px">Pick a piece above, copy it, then Paste it into your sheet to remix it.</p>
    </div>
    <div>
      <h2>Agent API</h2>
      <p class="hint">In the console, or from an automation: <code>window.sheetStudio</code></p>
      <pre id="api-help"></pre>
    </div>
  </aside>`;

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#art');
const ctx = canvas.getContext('2d')!;
const art = document.createElement('canvas');
const artCtx = art.getContext('2d')!;
const statusEl = $<HTMLDivElement>('#status');

function setStatus(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.className = error ? 'status error' : 'status';
}

// ---------- drawing the canvas ----------

function syncArt(): void {
  if (art.width !== px.width || art.height !== px.height) {
    art.width = px.width;
    art.height = px.height;
  }
  artCtx.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
}

function background(c: CanvasRenderingContext2D, w: number, h: number, scale: number): void {
  const tile = CELL * scale;
  const fills: Record<Bg, [string, string]> = {
    dark: ['#14161a', '#14161a'],
    checker: ['#3a3f47', '#2c3036'],
    beige: ['#efe3cf', '#e9dcc5'],
    carpet: ['#7b74c9', '#6f68bd'],
    tile: ['#b7bcc4', '#aab0b9'],
  };
  const [a, b] = fills[bg];
  const step = bg === 'checker' ? 4 * scale : tile / 2;
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      c.fillStyle = ((x / step + y / step) & 1) === 0 ? a : b;
      c.fillRect(x, y, step, step);
    }
}

/** Shape tools draw onto a copy while dragging; null when not dragging. */
let preview: Pixels | null = null;

function draw(): void {
  const w = px.width * zoom;
  const h = px.height * zoom;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  ctx.imageSmoothingEnabled = false;
  background(ctx, w, h, zoom);
  if (preview) {
    const tmp = document.createElement('canvas');
    tmp.width = preview.width;
    tmp.height = preview.height;
    tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height), 0, 0);
    ctx.drawImage(tmp, 0, 0, w, h);
  } else ctx.drawImage(art, 0, 0, w, h);
  if (showGrid) {
    if (zoom >= 8) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      for (let x = 0; x <= px.width; x++) (ctx.moveTo(x * zoom + 0.5, 0), ctx.lineTo(x * zoom + 0.5, h));
      for (let y = 0; y <= px.height; y++) (ctx.moveTo(0, y * zoom + 0.5), ctx.lineTo(w, y * zoom + 0.5));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    for (let x = 0; x <= px.width; x += CELL) (ctx.moveTo(x * zoom + 0.5, 0), ctx.lineTo(x * zoom + 0.5, h));
    for (let y = 0; y <= px.height; y += CELL) (ctx.moveTo(0, y * zoom + 0.5), ctx.lineTo(w, y * zoom + 0.5));
    ctx.stroke();
  }
  if (sel) {
    ctx.strokeStyle = '#4fe0a0';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(sel.x * CELL * zoom + 1, sel.y * CELL * zoom + 1, sel.w * CELL * zoom - 2, sel.h * CELL * zoom - 2);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }
  drawSeatBadges();
  if (hover && tool !== 'select') {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.strokeRect(hover.x * zoom + 0.5, hover.y * zoom + 0.5, zoom - 1, zoom - 1);
  }
  drawPreview();
}

const ARROW: Record<SeatMark['dir'], string> = { up: '↑', down: '↓', left: '←', right: '→' };

/** A badge with the facing arrow on every seat cell (amber = sit, purple = lie), like the map editor. */
function drawSeatBadges(): void {
  ctx.font = `bold ${Math.max(10, zoom * 1.6)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const m of seats.values()) {
    const cx = (m.x * CELL + CELL / 2) * zoom;
    const cy = (m.y * CELL + CELL / 2) * zoom;
    const r = Math.max(8, zoom * 2.2);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = m.kind === 'lie' ? 'rgba(160, 110, 255, 0.85)' : 'rgba(255, 190, 60, 0.9)';
    ctx.fill();
    ctx.fillStyle = '#14161a';
    ctx.fillText(ARROW[m.dir], cx, cy + 0.5);
  }
}

function setSeats(list: readonly SeatMark[]): void {
  const cols = px.width / CELL;
  const rows = px.height / CELL;
  seats = new Map(normalizeSeatMarks(list).filter((m) => m.x < cols && m.y < rows).map((m) => [`${m.x},${m.y}`, m]));
}

function seatList(): SeatMark[] {
  return [...seats.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

function markSeats(remove: boolean): void {
  if (!sel) return setStatus('Select the seat cell(s) first (Select cells, S)', true);
  for (let y = sel.y; y < sel.y + sel.h; y++)
    for (let x = sel.x; x < sel.x + sel.w; x++) {
      if (remove) seats.delete(`${x},${y}`);
      else seats.set(`${x},${y}`, { x, y, kind: seatKind, dir: seatDir });
    }
  dirty = true;
  setStatus(remove ? 'Seats removed' : `Marked ${sel.w * sel.h} cell(s): ${seatKind === 'sit' ? 'Sit' : 'Lie down'}, facing ${seatDir}`);
  draw();
}

function drawPreview(): void {
  const c = $<HTMLCanvasElement>('#preview');
  const area = sel ?? { x: 0, y: 0, w: Math.min(2, px.width / CELL), h: Math.min(2, px.height / CELL) };
  c.width = area.w * CELL * 2;
  c.height = area.h * CELL * 2;
  const p = c.getContext('2d')!;
  p.imageSmoothingEnabled = false;
  background(p, c.width, c.height, 2);
  p.drawImage(art, area.x * CELL, area.y * CELL, area.w * CELL, area.h * CELL, 0, 0, c.width, c.height);
}

// ---------- history ----------

function snapshot(): void {
  undo.push(new Uint8ClampedArray(px.data));
  if (undo.length > UNDO_LIMIT) undo.shift();
  redo.length = 0;
}

function changed(): void {
  dirty = true;
  syncArt();
  draw();
}

function restore(from: Uint8ClampedArray[], to: Uint8ClampedArray[]): void {
  const data = from.pop();
  if (!data) return;
  to.push(new Uint8ClampedArray(px.data));
  if (data.length !== px.data.length) return; // a resize in between: skip
  px.data.set(data);
  changed();
}

// ---------- pointer ----------

function pixelAt(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((e.clientX - r.left) / r.width) * px.width),
    y: Math.floor(((e.clientY - r.top) / r.height) * px.height),
  };
}

function mirrored(x: number): number {
  const cx = Math.floor(x / CELL) * CELL;
  return cx + (CELL - 1 - (x - cx));
}

function paint(x: number, y: number, c: RGBA | null): void {
  for (const tx of mirror ? [x, mirrored(x)] : [x]) {
    if (tx < 0 || y < 0 || tx >= px.width || y >= px.height) continue;
    if (c) put(px, tx, y, c);
    else px.data.fill(0, (y * px.width + tx) * 4, (y * px.width + tx) * 4 + 4);
  }
}

function shapeOps(a: { x: number; y: number }, b: { x: number; y: number }): Op[] {
  const hex = toHex(color);
  const [x, y, w, h] = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x) + 1, Math.abs(a.y - b.y) + 1];
  const one: Op =
    tool === 'line'
      ? { op: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: hex }
      : tool === 'ellipse'
        ? { op: 'ellipse', x, y, w, h, color: hex }
        : tool === 'rectFill'
          ? { op: 'rect', x, y, w, h, color: hex }
          : { op: 'rect', x, y, w, h, outline: hex };
  if (!mirror) return [one];
  const m = (v: number) => mirrored(v);
  const two: Op =
    one.op === 'line'
      ? { ...one, x1: m(one.x1), x2: m(one.x2) }
      : { ...(one as Extract<Op, { op: 'rect' }>), x: m(x + w - 1) };
  return [one, two];
}

let drag: { start: { x: number; y: number }; last: { x: number; y: number } } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return;
  canvas.setPointerCapture(e.pointerId);
  const p = pixelAt(e);
  drag = { start: p, last: p };
  if (tool === 'picker') {
    const i = (p.y * px.width + p.x) * 4;
    setColor([px.data[i]!, px.data[i + 1]!, px.data[i + 2]!, px.data[i + 3]! || 255]);
    drag = null;
    return;
  }
  if (tool === 'select') {
    sel = { x: Math.floor(p.x / CELL), y: Math.floor(p.y / CELL), w: 1, h: 1 };
    updateSelInfo();
    draw();
    return;
  }
  snapshot();
  if (tool === 'fill') {
    floodFill(px, p.x, p.y, color);
    if (mirror) floodFill(px, mirrored(p.x), p.y, color);
    drag = null;
    changed();
    return;
  }
  if (tool === 'pencil' || tool === 'eraser') {
    paint(p.x, p.y, tool === 'eraser' ? null : color);
    changed();
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pixelAt(e);
  hover = p;
  $<HTMLSpanElement>('#pos').textContent = `x ${p.x}, y ${p.y} · cell ${Math.floor(p.x / CELL)}, ${Math.floor(p.y / CELL)}`;
  if (!drag) return draw();
  if (tool === 'select') {
    const a = { x: Math.floor(drag.start.x / CELL), y: Math.floor(drag.start.y / CELL) };
    const b = { x: Math.floor(p.x / CELL), y: Math.floor(p.y / CELL) };
    sel = clampSel({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 });
    updateSelInfo();
    return draw();
  }
  if (tool === 'pencil' || tool === 'eraser') {
    for (const [x, y] of linePoints(drag.last.x, drag.last.y, p.x, p.y)) paint(x, y, tool === 'eraser' ? null : color);
    drag.last = p;
    return changed();
  }
  // Shape tools: preview on a copy.
  preview = { width: px.width, height: px.height, data: new Uint8ClampedArray(px.data) };
  applyOps(preview, shapeOps(drag.start, p));
  drag.last = p;
  draw();
});

canvas.addEventListener('pointerup', () => {
  if (drag && (tool === 'line' || tool === 'rect' || tool === 'rectFill' || tool === 'ellipse')) {
    applyOps(px, shapeOps(drag.start, drag.last));
    preview = null;
    changed();
  }
  drag = null;
});
canvas.addEventListener('pointerleave', () => {
  hover = null;
  draw();
});
canvas.addEventListener('contextmenu', (e) => {
  // Right-click = eyedropper.
  e.preventDefault();
  const p = pixelAt(e as PointerEvent);
  const i = (p.y * px.width + p.x) * 4;
  if (px.data[i + 3]) setColor([px.data[i]!, px.data[i + 1]!, px.data[i + 2]!, px.data[i + 3]!]);
});

// ---------- tools & colors ----------

const toolsEl = $<HTMLDivElement>('#tools');
for (const t of TOOLS) {
  const b = document.createElement('button');
  b.textContent = `${t.label} (${t.key.toUpperCase()})`;
  b.dataset.tool = t.id;
  b.addEventListener('click', () => setTool(t.id));
  toolsEl.appendChild(b);
}

function setTool(t: Tool): void {
  tool = t;
  for (const b of toolsEl.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('active', b.dataset.tool === t);
  canvas.style.cursor = t === 'picker' ? 'copy' : t === 'select' ? 'cell' : 'crosshair';
}

function setColor(c: RGBA): void {
  color = c;
  const hex = toHex(c);
  $<HTMLInputElement>('#color').value = hex.slice(0, 7);
  $<HTMLInputElement>('#alpha').value = String(c[3]);
  $<HTMLSpanElement>('#current span').style.background = `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
  for (const b of root.querySelectorAll<HTMLButtonElement>('.swatches button')) b.classList.toggle('on', b.dataset.hex === hex);
  if (!recent.includes(hex)) {
    recent.unshift(hex);
    recent.length = Math.min(recent.length, 8);
    renderSwatches($<HTMLDivElement>('#recent'), recent);
  }
}

function renderSwatches(el: HTMLDivElement, colors: string[]): void {
  el.replaceChildren(
    ...colors.map((hex) => {
      const b = document.createElement('button');
      b.dataset.hex = hex;
      b.title = hex;
      const c = parseColor(hex)!;
      b.style.background = `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
      b.addEventListener('click', () => setColor(c));
      return b;
    }),
  );
}
renderSwatches($<HTMLDivElement>('#swatches'), PALETTE);
$<HTMLInputElement>('#color').addEventListener('input', (e) => {
  const c = parseColor((e.target as HTMLInputElement).value)!;
  setColor([c[0], c[1], c[2], color[3]]);
});
$<HTMLInputElement>('#alpha').addEventListener('input', (e) => setColor([color[0], color[1], color[2], Number((e.target as HTMLInputElement).value)]));
$<HTMLInputElement>('#mirror').addEventListener('change', (e) => (mirror = (e.target as HTMLInputElement).checked));
$<HTMLSelectElement>('#zoom').addEventListener('change', (e) => {
  zoom = Number((e.target as HTMLSelectElement).value);
  draw();
});
$<HTMLSelectElement>('#bg').addEventListener('change', (e) => {
  bg = (e.target as HTMLSelectElement).value as Bg;
  draw();
});
$<HTMLInputElement>('#grid').addEventListener('change', (e) => {
  showGrid = (e.target as HTMLInputElement).checked;
  draw();
});
$('#undo').addEventListener('click', () => restore(undo, redo));
$('#redo').addEventListener('click', () => restore(redo, undo));

addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') return (e.preventDefault(), restore(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo));
  if ((e.ctrlKey || e.metaKey) && k === 'y') return (e.preventDefault(), restore(redo, undo));
  if ((e.ctrlKey || e.metaKey) && k === 'c') return copySel();
  if ((e.ctrlKey || e.metaKey) && k === 'v') return pasteClip();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'm') {
    mirror = !mirror;
    $<HTMLInputElement>('#mirror').checked = mirror;
    return;
  }
  if (k === 'delete' || k === 'backspace') return selAction('clear');
  const hit = TOOLS.find((x) => x.key === k);
  if (hit) setTool(hit.id);
});

// ---------- selection ----------

function clampSel(s: { x: number; y: number; w: number; h: number }) {
  const cols = px.width / CELL;
  const rows = px.height / CELL;
  const x = Math.max(0, Math.min(cols - 1, s.x));
  const y = Math.max(0, Math.min(rows - 1, s.y));
  return { x, y, w: Math.max(1, Math.min(cols - x, s.w)), h: Math.max(1, Math.min(rows - y, s.h)) };
}

function updateSelInfo(): void {
  $<HTMLParagraphElement>('#sel-info').textContent = sel
    ? `Cells ${sel.x},${sel.y} · ${sel.w}x${sel.h} (${sel.w * CELL}x${sel.h * CELL} px)`
    : 'Select cells (S) to copy, flip, outline or shade them.';
}

/** The selection in pixels, or the whole sheet. */
function selRect() {
  const s = sel ?? { x: 0, y: 0, w: px.width / CELL, h: px.height / CELL };
  return { x: s.x * CELL, y: s.y * CELL, w: s.w * CELL, h: s.h * CELL };
}

function copySel(): void {
  const r = selRect();
  const out = blankPixels(r.w / CELL, r.h / CELL);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * px.width + r.x) * 4;
    out.data.set(px.data.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  clipboard = out;
  setStatus(`Copied ${r.w / CELL}x${r.h / CELL} cells`);
}

function pasteClip(): void {
  if (!clipboard) return setStatus('Nothing copied yet', true);
  const at = hover ? { x: Math.floor(hover.x / CELL) * CELL, y: Math.floor(hover.y / CELL) * CELL } : sel ? { x: sel.x * CELL, y: sel.y * CELL } : { x: 0, y: 0 };
  snapshot();
  for (let y = 0; y < clipboard.height; y++)
    for (let x = 0; x < clipboard.width; x++) {
      const i = (y * clipboard.width + x) * 4;
      if (clipboard.data[i + 3]) put(px, at.x + x, at.y + y, [clipboard.data[i]!, clipboard.data[i + 1]!, clipboard.data[i + 2]!, clipboard.data[i + 3]!]);
    }
  sel = clampSel({ x: at.x / CELL, y: at.y / CELL, w: clipboard.width / CELL, h: clipboard.height / CELL });
  updateSelInfo();
  changed();
}

function selAction(kind: 'flip' | 'outline' | 'darker' | 'lighter' | 'clear'): void {
  const r = selRect();
  snapshot();
  const ops: Op[] =
    kind === 'flip'
      ? [{ op: 'copy', ...r, toX: r.x, toY: r.y, flipX: true }]
      : kind === 'outline'
        ? [{ op: 'outline', ...r, color: color[3] ? toHex(color) : OUTLINE }]
        : kind === 'clear'
          ? [{ op: 'clear', ...r }]
          : [{ op: 'shade', ...r, amount: kind === 'darker' ? -0.15 : 0.15 }];
  applyOps(px, ops);
  changed();
}

$('#copy').addEventListener('click', copySel);
$<HTMLSelectElement>('#seat-kind').addEventListener('change', (e) => (seatKind = (e.target as HTMLSelectElement).value as SeatMark['kind']));
$<HTMLSelectElement>('#seat-dir').addEventListener('change', (e) => (seatDir = (e.target as HTMLSelectElement).value as SeatMark['dir']));
$('#seat-mark').addEventListener('click', () => markSeats(false));
$('#seat-clear').addEventListener('click', () => markSeats(true));
$('#paste').addEventListener('click', () => {
  hover = null;
  pasteClip();
});
for (const k of ['flip', 'outline', 'darker', 'lighter', 'clear'] as const) $(`#${k}`).addEventListener('click', () => selAction(k));

// ---------- borrow from the game's sheets ----------

let picked: { sheet: string; sx: number; sy: number; w: number; h: number } | null = null;
let picker: ReturnType<typeof mountDecorPicker> | null = null;

function mountPicker(): void {
  picker = mountDecorPicker($<HTMLDivElement>('#decor-body'), (s) => (picked = s.selection));
}

$('#borrow').addEventListener('click', () => {
  if (!picked) return setStatus('Pick a piece in "Borrow from game art" first', true);
  const img = decorImage(picked.sheet);
  if (!img?.complete) return setStatus('That sheet is still loading', true);
  const tmp = document.createElement('canvas');
  tmp.width = picked.w * CELL;
  tmp.height = picked.h * CELL;
  const t = tmp.getContext('2d')!;
  t.drawImage(img, picked.sx * CELL, picked.sy * CELL, tmp.width, tmp.height, 0, 0, tmp.width, tmp.height);
  const d = t.getImageData(0, 0, tmp.width, tmp.height);
  clipboard = { width: d.width, height: d.height, data: d.data };
  setStatus(`Copied ${picked.w}x${picked.h} cells of ${picked.sheet}: hover a cell and Paste (Ctrl+V)`);
});

// ---------- sheet: new / resize / open / save ----------

function setSheet(next: Pixels, nextName: string, id: string | null, nextSeats: readonly SeatMark[] = []): void {
  px = next;
  setSeats(nextSeats);
  name = sheetSlug(nextName);
  savedId = id;
  dirty = false;
  sel = null;
  undo.length = 0;
  redo.length = 0;
  $<HTMLInputElement>('#name').value = name;
  $<HTMLInputElement>('#cols').value = String(px.width / CELL);
  $<HTMLInputElement>('#rows').value = String(px.height / CELL);
  updateSelInfo();
  syncArt();
  draw();
}

function resized(cols: number, rows: number): Pixels {
  const out = blankPixels(cols, rows);
  for (let y = 0; y < Math.min(px.height, out.height); y++) {
    const from = y * px.width * 4;
    out.data.set(px.data.subarray(from, from + Math.min(px.width, out.width) * 4), y * out.width * 4);
  }
  return out;
}

function sizeFromInputs(): { cols: number; rows: number } | null {
  const cols = Number($<HTMLInputElement>('#cols').value);
  const rows = Number($<HTMLInputElement>('#rows').value);
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_CELLS;
  if (!ok(cols) || !ok(rows)) {
    setStatus(`Cols and rows must be 1..${MAX_CELLS}`, true);
    return null;
  }
  return { cols, rows };
}

$('#new').addEventListener('click', () => {
  if (dirty && !confirm('Discard unsaved changes?')) return;
  const size = sizeFromInputs();
  if (size) setSheet(blankPixels(size.cols, size.rows), prompt('Name for the new sheet?', 'my_sheet') ?? 'my_sheet', null);
});
$('#resize').addEventListener('click', () => {
  const size = sizeFromInputs();
  if (!size) return;
  undo.length = 0;
  redo.length = 0;
  px = resized(size.cols, size.rows);
  setSeats(seatList());
  changed();
});
$<HTMLInputElement>('#name').addEventListener('change', (e) => {
  name = sheetSlug((e.target as HTMLInputElement).value);
  (e.target as HTMLInputElement).value = name;
  dirty = true;
});

function pngDataUrl(): string {
  syncArt();
  return art.toDataURL('image/png');
}

async function save(): Promise<string> {
  const id = customSheetId(name);
  const sheet: CustomSheet = { id, name, png: pngDataUrl(), cols: px.width / CELL, rows: px.height / CELL, seats: seatList() };
  await store.saveSheet(sheet);
  if (savedId && savedId !== id) setStatus(`Saved as a new sheet ${id} (renamed from ${savedId})`);
  savedId = id;
  dirty = false;
  registerSheet(id, sheet.png);
  registerSeatMarks(id, sheet.seats ?? []);
  await refreshSaved(id);
  setStatus(`Saved ${id}: it is in the map editor and Build panel pickers now`);
  return id;
}

$('#save').addEventListener('click', () => {
  save().catch((err) => setStatus(saveError(err), true));
});
$('#delete').addEventListener('click', () => {
  if (!savedId || !confirm(`Delete ${savedId}? Pieces already placed on maps stop drawing.`)) return;
  const id = savedId;
  store
    .deleteSheet(id)
    .then(async () => {
      unregisterSheet(id);
      savedId = null;
      await refreshSaved('');
      setStatus(`Deleted ${id}`);
    })
    .catch((err) => setStatus(saveError(err), true));
});

function saveError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
  if (/42501|row-level security|permission/i.test(msg)) return 'Only admins can save sheets.';
  if (/relation|does not exist|42P01|schema cache/i.test(msg)) return 'Run supabase/sheets.sql in Supabase first (see README).';
  return `Save failed: ${msg}`;
}

let savedSheets: CustomSheet[] = [];

async function refreshSaved(selected: string | null): Promise<void> {
  savedSheets = await store.listSheets().catch(() => []);
  const sel = $<HTMLSelectElement>('#saved');
  sel.replaceChildren(
    new Option('Open a saved sheet…', ''),
    ...savedSheets.map((s) => new Option(`${s.name} (${s.cols}x${s.rows})`, s.id, false, s.id === selected)),
  );
}

async function openSaved(id: string): Promise<void> {
  const s = savedSheets.find((x) => x.id === id) ?? (await store.listSheets()).find((x) => x.id === id);
  if (!s) throw new Error(`no saved sheet ${id}`);
  setSheet(await decodePng(s.png), s.name, s.id, s.seats ?? []);
  setStatus(`Opened ${s.id}`);
}

$<HTMLSelectElement>('#saved').addEventListener('change', (e) => {
  const id = (e.target as HTMLSelectElement).value;
  if (!id || (dirty && !confirm('Discard unsaved changes?'))) return;
  openSaved(id).catch((err) => setStatus(String(err), true));
});

/** Decode a PNG (URL or data URL) into pixels padded to whole cells. */
function decodePng(src: string): Promise<Pixels> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cols = Math.min(MAX_CELLS, Math.ceil(img.naturalWidth / CELL));
      const rows = Math.min(MAX_CELLS, Math.ceil(img.naturalHeight / CELL));
      const tmp = document.createElement('canvas');
      tmp.width = cols * CELL;
      tmp.height = rows * CELL;
      const t = tmp.getContext('2d')!;
      t.drawImage(img, 0, 0);
      const d = t.getImageData(0, 0, tmp.width, tmp.height);
      resolve({ width: d.width, height: d.height, data: d.data });
    };
    img.onerror = () => reject(new Error('not a readable PNG'));
    img.src = src;
  });
}

$('#open-png').addEventListener('click', () => $<HTMLInputElement>('#png-file').click());
$<HTMLInputElement>('#png-file').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () =>
    decodePng(String(reader.result))
      .then((p) => setSheet(p, file.name.replace(/\.png$/i, ''), null))
      .catch((err) => setStatus(String(err), true));
  reader.readAsDataURL(file);
});

function download(filename: string, href: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
}

$('#export-png').addEventListener('click', () => download(`${name}.png`, pngDataUrl()));
$('#export-spec').addEventListener('click', () => {
  const text = JSON.stringify(currentSpec(), null, 1);
  download(`${name}.json`, URL.createObjectURL(new Blob([text], { type: 'application/json' })));
  void navigator.clipboard?.writeText(text).catch(() => {});
  setStatus('Spec downloaded (and copied to the clipboard)');
});

$('#import-spec').addEventListener('click', () => {
  const dlg = document.createElement('div');
  dlg.id = 'dialog';
  dlg.innerHTML = `<div class="box">
      <h2>Import a SheetSpec (JSON)</h2>
      <textarea spellcheck="false" placeholder='{ "name": "desk", "cols": 2, "rows": 2, "palette": {...}, "ops": [...] }'></textarea>
      <div class="status error"></div>
      <div class="row">
        <button class="primary" data-act="replace">Load as new sheet</button>
        <button data-act="apply">Apply ops onto this sheet</button>
        <button data-act="cancel">Cancel</button>
      </div></div>`;
  document.body.appendChild(dlg);
  const ta = dlg.querySelector('textarea')!;
  ta.focus();
  dlg.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (!act) return;
    if (act === 'cancel') return dlg.remove();
    let json: unknown;
    try {
      json = JSON.parse(ta.value);
    } catch (err) {
      dlg.querySelector('.status')!.textContent = `Not valid JSON: ${(err as Error).message}`;
      return;
    }
    const errors = act === 'replace' ? api.load(json as SheetSpec) : api.apply((json as SheetSpec).ops ?? (json as Op[]), (json as SheetSpec).palette);
    if (errors.length) dlg.querySelector('.status')!.textContent = errors.join('\n');
    else dlg.remove();
  });
});

function currentSpec(): SheetSpec {
  const spec = bufferToSpec(px, name);
  return seats.size ? { ...spec, seats: seatList() } : spec;
}

// ---------- agent API ----------

const api = {
  /** Start an empty sheet. */
  new(sheetName = 'my_sheet', cols = 4, rows = 4): void {
    setSheet(blankPixels(Math.max(1, Math.min(MAX_CELLS, cols)), Math.max(1, Math.min(MAX_CELLS, rows))), sheetName, null);
  },
  /** Replace the sheet with a SheetSpec; returns problems (empty = loaded). */
  load(spec: SheetSpec): string[] {
    const { spec: ok, errors } = parseSpec(spec);
    if (!ok) return errors;
    const out = blankPixels(ok.cols, ok.rows);
    applyOps(out, ok.ops, ok.palette);
    setSheet(out, ok.name, null, ok.seats ?? []);
    dirty = true;
    setStatus(`Loaded spec "${ok.name}" (${ok.ops.length} ops)`);
    return [];
  },
  /** Apply ops on top of the current sheet (one undo step); returns problems (empty = applied). */
  apply(ops: Op[], palette: Record<string, string> = {}): string[] {
    const { errors } = parseSpec({ cols: px.width / CELL, rows: px.height / CELL, palette, ops });
    if (errors.length) return errors;
    snapshot();
    applyOps(px, ops, palette);
    changed();
    return [];
  },
  /** The sheet as SheetSpec text (auto palette + one pixels op per used cell). */
  spec: (): SheetSpec => currentSpec(),
  /** The sheet as a PNG data URL. */
  png: (): string => pngDataUrl(),
  /** Save (admins); resolves to the sheet id used in maps (custom_<name>). */
  save: (): Promise<string> => save(),
  list: async (): Promise<{ id: string; name: string; cols: number; rows: number }[]> =>
    (await store.listSheets()).map(({ id, name: n, cols, rows }) => ({ id, name: n, cols, rows })),
  open: (id: string): Promise<void> => openSaved(id),
  /** The sittable cells, or replace them: [{ x, y, kind: 'sit' | 'lie', dir }] in cells → problems[]. */
  seats(list?: SeatMark[]): SeatMark[] | string[] {
    if (list === undefined) return seatList();
    const { errors } = parseSpec({ cols: px.width / CELL, rows: px.height / CELL, seats: list });
    if (errors.length) return errors;
    setSeats(list);
    dirty = true;
    draw();
    return [];
  },
  /** Name the sheet (its id becomes custom_<slug>). */
  rename(next: string): void {
    name = sheetSlug(next);
    $<HTMLInputElement>('#name').value = name;
    dirty = true;
  },
};

const HELP = `sheetStudio.new(name, cols, rows)
sheetStudio.load(spec)      → errors[]
sheetStudio.apply(ops, palette?) → errors[]
sheetStudio.spec()          → SheetSpec
sheetStudio.png()           → data URL
sheetStudio.save()          → Promise<id>
sheetStudio.seats()         → [{x,y,kind,dir}]
sheetStudio.seats(list)     → errors[] (cells; kind sit|lie)
sheetStudio.list() / open(id) / rename(n)

ops (pixel coords, 32px cells):
rect{x,y,w,h,color?,outline?}
ellipse{x,y,w,h,color?,outline?}
line{x1,y1,x2,y2,color}
pixels{x,y,rows:["..kk.."]}
fill{x,y,color}  outline{x,y,w,h,color}
shade{x,y,w,h,amount:-1..1}
copy{x,y,w,h,toX,toY,flipX?,flipY?}
clear{x,y,w,h}
color = palette key or #rrggbb[aa]
Full guide: docs/sheet-studio.md`;
$<HTMLPreElement>('#api-help').textContent = HELP;
(window as unknown as { sheetStudio: typeof api }).sheetStudio = api;

addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

// ---------- gate + boot ----------

async function gate(): Promise<boolean> {
  if (!hasSupabase) return true;
  const overlay = document.createElement('div');
  overlay.id = 'gate';
  overlay.innerHTML = '<div class="gate-box"><p>Checking permission…</p></div>';
  document.body.appendChild(overlay);
  const uid = await ensureSession();
  if (uid && (await checkIsAdmin())) {
    overlay.remove();
    return true;
  }
  overlay.querySelector('.gate-box')!.innerHTML = `
    <h2>Admins only</h2>
    <p>Sheet Studio is for the admin. Sign in with the admin account on the Play page (Admin login),
      then come back.${uid ? ` Your id: <b>${shortId(uid)}</b>.` : ''}</p>
    <a href="index.html">← Back to Play</a>`;
  return false;
}

setTool('pencil');
setColor(color);
setSheet(blankPixels(4, 4), 'my_sheet', null);
void gate().then(async (ok) => {
  if (!ok) return;
  await loadCustomSheets(store);
  mountPicker();
  await refreshSaved(null);
  void picker;
});
