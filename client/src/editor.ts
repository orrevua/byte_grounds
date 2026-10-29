import { TILE_SIZE } from '@byte_grounds/shared/protocol';
import { createBlankMap, mapIdFromName, tileAt, type Facing, type OfficeMap, type Seat } from '@byte_grounds/shared/map';
import { DEFAULT_MAP } from '@byte_grounds/shared/maps';
import { drawDecorCellAt, drawMap, drawObjectDecorFlat, mapPixelSize } from './render.ts';
import { DECOR_SHEETS, TILE_SHEETS, decorImage, decorObjects, loadDecorSheets } from './decor.ts';
import { objectAt, objectCells, type CellRect } from './decor-objects.ts';
import {
  IDENTITY,
  describeTransform,
  flipH,
  flipV,
  footprint,
  rotateCCW,
  rotateCW,
  transformFacing,
  type DecorTransform,
} from './decor-transform.ts';
import {
  brushCells,
  cellBlocks,
  eraseDecor,
  paintColor,
  resizeMap,
  setBlocked,
  setSpawn,
  stampDecor,
  toggleSeat,
  type BlockMode,
  type DecorSelection,
} from './editor-model.ts';
import { createStore, type MapSummary } from './store.ts';

type Tool = 'paint' | 'block' | 'walk' | 'decor' | 'erase' | 'spawn' | 'seat';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'paint', label: 'Paint color' },
  { id: 'decor', label: 'Decoration' },
  { id: 'block', label: 'Block (wall)' },
  { id: 'walk', label: 'Walkable' },
  { id: 'erase', label: 'Erase decor' },
  { id: 'spawn', label: 'Spawn point' },
  { id: 'seat', label: 'Seat / bed' },
];

const ARROW: Record<Facing, string> = { up: '↑', down: '↓', left: '←', right: '→' };

type TransformOp = (t: DecorTransform) => DecorTransform;

const TRANSFORM_BUTTONS: { label: string; title: string; op: TransformOp }[] = [
  { label: '⟲', title: 'Rotate left (Shift+R)', op: rotateCCW },
  { label: '⟳', title: 'Rotate right (R)', op: rotateCW },
  { label: '⇋', title: 'Flip horizontal (F)', op: flipH },
  { label: '⇵', title: 'Flip vertical (V)', op: flipV },
];

/** The brush transform a key stands for: R / Shift+R turn, F / V mirror. */
function transformForKey(e: KeyboardEvent): TransformOp | null {
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

/** Starter palette: floors (wood, carpet, tile), walls, outdoors. */
const SWATCHES = [
  '#2a2f37', '#454d5a', '#8b6a4a', '#a8825a', '#6b4f3a', '#c9b48f', '#d9d4c7', '#9aa0a6',
  '#3d5a80', '#5b7f9e', '#6a8f5a', '#4e7a3d', '#3c6e8f', '#7a4b6b', '#a34d4d', '#d1a54a',
];

const UNDO_LIMIT = 100;

const store = createStore();
const root = document.querySelector<HTMLDivElement>('#editor')!;

let maps: MapSummary[] = [];
let map: OfficeMap = createBlankMap('New map', 20, 15);
let savedJson = '';
let tool: Tool = 'paint';
let color = SWATCHES[2]!;
let selection: DecorSelection | null = null;
let brushT: DecorTransform = IDENTITY;
let blockMode: BlockMode = 'base';
let seatKind: Seat['kind'] = 'sit';
let seatDir: Facing = 'down';
let showWalls = true;
let zoom = 1;
let hover: { x: number; y: number } | null = null;
const undo: string[] = [];

root.innerHTML = `
  <aside>
    <h1>Map editor <a href="index.html">← Play</a></h1>
    <section>
      <h2>Map</h2>
      <div class="row">
        <select id="map-select" style="flex:1"></select>
        <button id="new">New…</button>
      </div>
      <div class="row" style="margin-top:6px">
        <input id="map-name" placeholder="Map name" style="flex:1" />
      </div>
      <div class="row" style="margin-top:6px">
        <button id="save" class="primary" style="flex:1">Save</button>
        <button id="delete" class="danger">Delete</button>
      </div>
      <div id="status" class="status"></div>
    </section>
    <section>
      <h2>Size (tiles)</h2>
      <div class="row">
        <input id="w" type="number" min="3" max="80" /> ×
        <input id="h" type="number" min="3" max="80" />
        <button id="resize">Resize</button>
      </div>
    </section>
    <section>
      <h2>Tool</h2>
      <div class="tools" id="tools"></div>
      <div class="row" style="margin-top:6px">
        <button id="undo">Undo (Ctrl+Z)</button>
        <label class="check"><input id="show-walls" type="checkbox" checked /> Show walls</label>
      </div>
    </section>
    <section id="color-section">
      <h2>Color</h2>
      <div class="row" style="margin-bottom:6px">
        <input id="color" type="color" /> <span class="hint">Right-click a tile to pick its color.</span>
      </div>
      <div class="swatches" id="swatches"></div>
    </section>
    <section id="decor-section">
      <h2>Decoration</h2>
      <div id="decor-body"></div>
    </section>
    <section id="seat-section">
      <h2>Seat / bed</h2>
      <div class="row">
        <select id="seat-kind"><option value="sit">Sit (chair, sofa)</option><option value="lie">Lie (bed)</option></select>
        <select id="seat-dir">
          <option value="down">↓ down</option><option value="up">↑ up</option>
          <option value="left">← left</option><option value="right">→ right</option>
        </select>
      </div>
      <p class="hint" id="seat-hint"></p>
    </section>
    <section>
      <h2>View</h2>
      <div class="row">
        Zoom <select id="zoom"><option>0.5</option><option>0.75</option><option selected>1</option><option>1.5</option><option>2</option></select>
      </div>
    </section>
  </aside>
  <main><canvas id="map-canvas"></canvas></main>`;

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#map-canvas');
const ctx = canvas.getContext('2d')!;
const statusEl = $<HTMLDivElement>('#status');
const mapSelect = $<HTMLSelectElement>('#map-select');
const nameEl = $<HTMLInputElement>('#map-name');
const colorEl = $<HTMLInputElement>('#color');

function setStatus(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.className = error ? 'status error' : 'status';
}

const dirty = () => JSON.stringify(map) !== savedJson;

function refreshStatus(): void {
  setStatus(dirty() ? 'Unsaved changes' : `Saved · id "${map.id}"`);
}

// ---------- map list / load / save ----------

async function refreshMaps(selectId: string): Promise<void> {
  maps = await store.listMaps();
  mapSelect.replaceChildren(
    ...maps.map((m) => {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.name;
      o.selected = m.id === selectId;
      return o;
    }),
  );
}

async function openMap(id: string): Promise<void> {
  const loaded = await store.loadMap(id);
  if (!loaded) return setStatus(`Map "${id}" not found`, true);
  setMap(structuredClone(loaded), true);
  history.replaceState(null, '', `?map=${encodeURIComponent(id)}`);
}

function setMap(next: OfficeMap, saved: boolean): void {
  map = next;
  savedJson = saved ? JSON.stringify(map) : '';
  undo.length = 0;
  nameEl.value = map.name ?? map.id;
  $<HTMLInputElement>('#w').value = String(map.width);
  $<HTMLInputElement>('#h').value = String(map.height);
  void loadDecorSheets((map.decor ?? []).map((d) => d.sheet)).then(draw);
  sizeCanvas();
  draw();
  refreshStatus();
}

function confirmDiscard(): boolean {
  return !dirty() || confirm('Discard unsaved changes to this map?');
}

mapSelect.addEventListener('change', () => {
  if (!confirmDiscard()) {
    mapSelect.value = map.id;
    return;
  }
  void openMap(mapSelect.value).catch(showError);
});

$('#new').addEventListener('click', () => {
  if (!confirmDiscard()) return;
  const name = prompt('Name for the new map?', 'New room')?.trim();
  if (!name) return;
  let id = mapIdFromName(name);
  for (let n = 2; maps.some((m) => m.id === id); n++) id = `${mapIdFromName(name)}-${n}`;
  const m = createBlankMap(name, 20, 15);
  m.id = id;
  setMap(m, false);
  setStatus(`New map "${id}" — not saved yet`);
});

nameEl.addEventListener('input', () => {
  map.name = nameEl.value.trim() || map.id;
  refreshStatus();
});

$('#save').addEventListener('click', async () => {
  setStatus('Saving…');
  try {
    await store.saveMap(map);
    savedJson = JSON.stringify(map);
    await refreshMaps(map.id);
    history.replaceState(null, '', `?map=${encodeURIComponent(map.id)}`);
    refreshStatus();
  } catch (err) {
    showError(err);
  }
});

$('#delete').addEventListener('click', async () => {
  if (!confirm(`Delete map "${map.name ?? map.id}" for everyone? Saved player spots on it go too.`)) return;
  try {
    await store.deleteMap(map.id);
    await refreshMaps('');
    await openMap(maps[0]!.id);
    setStatus('Deleted');
  } catch (err) {
    showError(err);
  }
});

function showError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
  setStatus(
    /relation|schema cache|does not exist|42P01|PGRST/i.test(msg)
      ? "Maps aren't set up in Supabase yet: run supabase/schema.sql (see README)."
      : `Error: ${msg}`,
    true,
  );
}

$('#resize').addEventListener('click', () => {
  const w = Number($<HTMLInputElement>('#w').value);
  const h = Number($<HTMLInputElement>('#h').value);
  pushUndo();
  map = resizeMap(map, w, h);
  $<HTMLInputElement>('#w').value = String(map.width);
  $<HTMLInputElement>('#h').value = String(map.height);
  sizeCanvas();
  draw();
  refreshStatus();
});

// ---------- tools ----------

const toolsEl = $<HTMLDivElement>('#tools');
for (const t of TOOLS) {
  const b = document.createElement('button');
  b.textContent = t.label;
  b.dataset.tool = t.id;
  b.addEventListener('click', () => setTool(t.id));
  toolsEl.appendChild(b);
}

function setTool(t: Tool): void {
  tool = t;
  for (const b of toolsEl.querySelectorAll<HTMLButtonElement>('button')) {
    b.classList.toggle('active', b.dataset.tool === t);
  }
  draw();
}

colorEl.value = color;
colorEl.addEventListener('input', () => {
  color = colorEl.value;
  setTool('paint');
});
const swatchesEl = $<HTMLDivElement>('#swatches');
for (const c of SWATCHES) {
  const b = document.createElement('button');
  b.style.background = c;
  b.title = c;
  b.addEventListener('click', () => {
    color = c;
    colorEl.value = c;
    setTool('paint');
  });
  swatchesEl.appendChild(b);
}

$<HTMLInputElement>('#show-walls').addEventListener('change', (e) => {
  showWalls = (e.target as HTMLInputElement).checked;
  draw();
});
$<HTMLSelectElement>('#zoom').addEventListener('change', (e) => {
  zoom = Number((e.target as HTMLSelectElement).value);
  sizeCanvas();
});

function pushUndo(): void {
  undo.push(JSON.stringify(map));
  if (undo.length > UNDO_LIMIT) undo.shift();
}

function doUndo(): void {
  const prev = undo.pop();
  if (!prev) return;
  const m = JSON.parse(prev) as OfficeMap;
  const resized = m.width !== map.width || m.height !== map.height;
  map = m;
  if (resized) {
    $<HTMLInputElement>('#w').value = String(map.width);
    $<HTMLInputElement>('#h').value = String(map.height);
    sizeCanvas();
  }
  draw();
  refreshStatus();
}
$('#undo').addEventListener('click', doUndo);
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    doUndo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
  const op = transformForKey(e);
  if (!op) return;
  if (tool === 'decor') {
    e.preventDefault();
    setBrushTransform(op(brushT));
  } else if (tool === 'seat') {
    e.preventDefault();
    seatDir = transformFacing(seatDir, op(IDENTITY));
    $<HTMLSelectElement>('#seat-dir').value = seatDir;
  }
});
addEventListener('beforeunload', (e) => {
  if (dirty()) e.preventDefault();
});

const seatHint = $<HTMLParagraphElement>('#seat-hint');
function updateSeatHint(): void {
  seatHint.textContent =
    seatKind === 'sit'
      ? 'Click the chair/sofa tile. The arrow is the way the person faces. Click again to remove.'
      : 'Click the bed tile with the pillow. The arrow is where the feet point. Click again to remove. ' +
        'Rotated a bed? Press R here to turn the arrow the same way.';
}
$<HTMLSelectElement>('#seat-kind').addEventListener('change', (e) => {
  seatKind = (e.target as HTMLSelectElement).value as Seat['kind'];
  updateSeatHint();
  setTool('seat');
});
$<HTMLSelectElement>('#seat-dir').addEventListener('change', (e) => {
  seatDir = (e.target as HTMLSelectElement).value as Facing;
  setTool('seat');
});
updateSeatHint();

// ---------- decoration sheet picker ----------

/** Brush rotation/mirror for the next stamps; not a map edit (no undo, not dirty). */
function setBrushTransform(t: DecorTransform): void {
  brushT = t;
  const label = root.querySelector<HTMLSpanElement>('#brush-transform');
  if (label) label.textContent = describeTransform(brushT);
  draw();
}

function renderDecorPicker(): void {
  const body = $<HTMLDivElement>('#decor-body');
  if (DECOR_SHEETS.length === 0) {
    body.innerHTML = `<p class="hint">No decoration art yet. Add LPC sheet PNGs to
      <code>client/src/assets/decor/</code> and redeploy; they show up here automatically.</p>`;
    return;
  }
  body.innerHTML = `
    <div class="row" style="margin-bottom:6px">
      <select id="sheet-select" style="flex:1">${DECOR_SHEETS.map((s) => `<option>${s}</option>`).join('')}</select>
    </div>
    <div id="sheet-wrap"><canvas id="sheet"></canvas></div>
    <div class="row" style="margin-top:6px">
      Block <select id="block-decor" style="flex:1">
        <option value="base" selected>Base row (desks, shelves)</option>
        <option value="all">Whole piece</option>
        <option value="none">Nothing (rugs, beds)</option>
      </select>
    </div>
    <p class="hint">Base row: only the bottom row blocks; people can walk behind it. Use Whole piece for
      pieces turned sideways.</p>
    <div class="row" id="brush-tools" style="margin-top:6px">
      <button id="brush-reset">Reset</button> <span id="brush-transform" class="hint"></span>
    </div>
    <p class="hint">Click an object to pick all of it (Alt+click: just that square), or drag to pick
      any block of squares, then click the map to place it.</p>
    <p class="hint">Turn or mirror it with R / Shift+R / F / V. Chairs, sofas and thrones already come
      facing each way in the sheet: pick that variant instead. Turning suits rugs, tables, beds and
      counters; a horizontal flip is almost always safe.</p>`;
  const sheetSelect = body.querySelector<HTMLSelectElement>('#sheet-select')!;
  const sheetCanvas = body.querySelector<HTMLCanvasElement>('#sheet')!;
  const sctx = sheetCanvas.getContext('2d')!;
  body.querySelector<HTMLSelectElement>('#block-decor')!.addEventListener('change', (e) => {
    blockMode = (e.target as HTMLSelectElement).value as BlockMode;
    draw();
  });
  const resetBtn = body.querySelector<HTMLButtonElement>('#brush-reset')!;
  for (const { label, title, op } of TRANSFORM_BUTTONS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => {
      setBrushTransform(op(brushT));
      setTool('decor');
    });
    resetBtn.before(b);
  }
  resetBtn.addEventListener('click', () => {
    setBrushTransform(IDENTITY);
    setTool('decor');
  });
  setBrushTransform(brushT);

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
    const obj = objs && objectAt(objs, p.x, p.y);
    return obj ? objectCells(obj) : { sx: Math.floor(p.x / TILE_SIZE), sy: Math.floor(p.y / TILE_SIZE), w: 1, h: 1 };
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
    setTool('decor');
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
}

// ---------- map canvas ----------

function sizeCanvas(): void {
  const { w, h } = mapPixelSize(map);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w * zoom}px`;
  canvas.style.height = `${h * zoom}px`;
  draw();
}

function draw(): void {
  drawMap(ctx, map);
  drawObjectDecorFlat(ctx, map);
  if (showWalls) {
    ctx.save();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (tileAt(map, x, y) !== 1) continue;
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        ctx.fillStyle = 'rgba(220, 60, 60, 0.28)';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = 'rgba(255, 120, 120, 0.55)';
        ctx.beginPath();
        ctx.moveTo(px + 4, py + 4);
        ctx.lineTo(px + TILE_SIZE - 4, py + TILE_SIZE - 4);
        ctx.moveTo(px + TILE_SIZE - 4, py + 4);
        ctx.lineTo(px + 4, py + TILE_SIZE - 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // Seat / bed markers: a badge with the facing arrow.
  ctx.font = 'bold 12px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const st of map.seats ?? []) {
    const cx = st.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = st.y * TILE_SIZE + TILE_SIZE / 2;
    ctx.fillStyle = st.kind === 'lie' ? 'rgba(160, 110, 255, 0.85)' : 'rgba(255, 190, 60, 0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14161a';
    ctx.fillText(ARROW[st.dir], cx, cy + 0.5);
  }
  // Spawn marker.
  ctx.fillStyle = '#4fe0a0';
  ctx.beginPath();
  ctx.arc(map.spawn.x * TILE_SIZE, map.spawn.y * TILE_SIZE, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#14161a';
  ctx.font = 'bold 9px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', map.spawn.x * TILE_SIZE, map.spawn.y * TILE_SIZE + 0.5);
  // Brush preview.
  if (hover) {
    let size = { w: 1, h: 1 };
    if (tool === 'decor' && selection) {
      // Ghost of the piece exactly where a click stamps it.
      const ghost = brushCells(hover.x, hover.y, selection, brushT, blockMode);
      ctx.save();
      ctx.globalAlpha = 0.6;
      for (const cell of ghost) drawDecorCellAt(ctx, cell);
      ctx.restore();
      ctx.fillStyle = 'rgba(220, 60, 60, 0.35)';
      for (const cell of ghost) {
        if (cellBlocks(cell, blockMode)) ctx.fillRect(cell.x * TILE_SIZE, cell.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
      size = footprint(selection.w, selection.h, brushT);
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(hover.x * TILE_SIZE + 1, hover.y * TILE_SIZE + 1, size.w * TILE_SIZE - 2, size.h * TILE_SIZE - 2);
    ctx.lineWidth = 1;
  }
}

function tileFromEvent(e: PointerEvent | MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((e.clientX - r.left) * (canvas.width / r.width)) / TILE_SIZE),
    y: Math.floor(((e.clientY - r.top) * (canvas.height / r.height)) / TILE_SIZE),
  };
}

/** Apply the current tool at a tile. `first` = the pointer just went down (not a drag). */
function apply(x: number, y: number, first: boolean): void {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
  switch (tool) {
    case 'paint':
      paintColor(map, x, y, color);
      break;
    case 'block':
      setBlocked(map, x, y, true);
      break;
    case 'walk':
      setBlocked(map, x, y, false);
      break;
    case 'erase':
      eraseDecor(map, x, y);
      break;
    case 'decor':
      if (!selection) return setStatus('Pick a piece from the decoration sheet first', true);
      if (first) stampDecor(map, x, y, selection, blockMode, brushT);
      break;
    case 'spawn':
      if (first) setSpawn(map, x, y);
      break;
    case 'seat':
      if (first) toggleSeat(map, x, y, seatKind, seatDir);
      break;
  }
  draw();
  refreshStatus();
}

let painting = false;
let lastTile: { x: number; y: number } | null = null;

/** Tiles on the straight line from a to b (excluding a), so fast drags leave no gaps. */
function tilesBetween(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push({ x: Math.round(a.x + ((b.x - a.x) * i) / steps), y: Math.round(a.y + ((b.y - a.y) * i) / steps) });
  }
  return out;
}
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return;
  painting = true;
  canvas.setPointerCapture(e.pointerId);
  pushUndo();
  const t = tileFromEvent(e);
  lastTile = t;
  apply(t.x, t.y, true);
});
canvas.addEventListener('pointermove', (e) => {
  const t = tileFromEvent(e);
  hover = t;
  if (painting && lastTile && (t.x !== lastTile.x || t.y !== lastTile.y)) {
    for (const step of tilesBetween(lastTile, t)) apply(step.x, step.y, false);
    lastTile = t;
  } else draw();
});
const stop = () => {
  painting = false;
};
canvas.addEventListener('pointerup', stop);
canvas.addEventListener('pointercancel', stop);
canvas.addEventListener('pointerleave', () => {
  hover = null;
  draw();
});
// Right-click = eyedropper.
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const t = tileFromEvent(e);
  if (t.x < 0 || t.y < 0 || t.x >= map.width || t.y >= map.height) return;
  const c = map.colors?.[t.y * map.width + t.x];
  if (c) {
    color = c;
    colorEl.value = c;
    setTool('paint');
  }
});

// ---------- boot ----------

setTool('paint');
renderDecorPicker();
const wanted = new URLSearchParams(location.search).get('map') ?? DEFAULT_MAP.id;
refreshMaps(wanted)
  .then(() => openMap(maps.some((m) => m.id === wanted) ? wanted : maps[0]!.id))
  .catch((err) => {
    showError(err);
    setMap(createBlankMap('New map', 20, 15), false);
  });
