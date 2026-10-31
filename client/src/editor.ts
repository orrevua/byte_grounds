import { TILE_SIZE } from '@byte_grounds/shared/protocol';
import { createBlankMap, mapIdFromName, tileAt, zoneAt, type Facing, type OfficeMap, type Seat } from '@byte_grounds/shared/map';
import { DEFAULT_MAP } from '@byte_grounds/shared/maps';
import { effectiveSeats } from '@byte_grounds/shared/seats';
import { drawDecorCellAt, drawMap, drawObjectDecorFlat, drawZones, mapPixelSize } from './render.ts';
import { decorImage, loadDecorSheets } from './decor.ts';
import { IDENTITY, footprint, transformFacing, type DecorTransform } from './decor-transform.ts';
import { mountDecorPicker, transformForKey } from './decor-picker.ts';
import {
  brushCells,
  cellBlocks,
  eraseDecor,
  paintColor,
  resizeMap,
  setBlocked,
  setSpawn,
  stampDecor,
  toggleNoSeat,
  toggleSeat,
  type BlockMode,
  type DecorSelection,
} from './editor-model.ts';
import { StaleSaveError, createStore, type MapSummary } from './store.ts';
import { mergeLiveEdits } from './live-model.ts';
import { hasSupabase } from './supabase.ts';
import { checkCanEditMaps, ensureSession, shortId } from './auth.ts';
import { createAutosave, type SaveStatus } from './autosave.ts';

type Tool = 'paint' | 'block' | 'walk' | 'decor' | 'erase' | 'spawn' | 'seat' | 'zone';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'paint', label: 'Paint color' },
  { id: 'decor', label: 'Decoration' },
  { id: 'block', label: 'Block (wall)' },
  { id: 'walk', label: 'Walkable' },
  { id: 'erase', label: 'Erase decor' },
  { id: 'spawn', label: 'Spawn point' },
  { id: 'seat', label: 'Seat / bed' },
  { id: 'zone', label: 'Meeting room' },
];

const ARROW: Record<Facing, string> = { up: '↑', down: '↓', left: '←', right: '→' };

/** Starter palette: floors (wood, carpet, tile), walls, outdoors. */
const SWATCHES = [
  '#2a2f37', '#454d5a', '#8b6a4a', '#a8825a', '#6b4f3a', '#c9b48f', '#d9d4c7', '#9aa0a6',
  '#3d5a80', '#5b7f9e', '#6a8f5a', '#4e7a3d', '#3c6e8f', '#7a4b6b', '#a34d4d', '#d1a54a',
];

const UNDO_LIMIT = 100;
/** Autosave: quiet time after the last change, and the wait before retrying a failed save. */
const AUTOSAVE_DELAY_MS = 1500;
const AUTOSAVE_RETRY_MS = 15000;
/** Postgres "insufficient privilege": RLS refused the write (no editor permission). */
const NO_PERMISSION = '42501';
/** Saves retried when live edits keep landing between the merge and the save. */
const STALE_RETRIES = 3;

/** Another editor saved or deleted this map since we loaded it (a 'reset' in its live log). */
class ConflictError extends Error {}

const knownSheet = (s: string) => decorImage(s) !== null;

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
let seatKind: Seat['kind'] | 'none' = 'sit';
let seatDir: Facing = 'down';
let showWalls = true;
let zoom = 1;
let hover: { x: number; y: number } | null = null;
const undo: string[] = [];
/**
 * The last live edit folded into `map` (from the load, each merge and each save); null for a new
 * map that was never stored, whose first save overwrites.
 */
let loadedSeq: number | null = null;
/** The user chose Overwrite after a conflict: the next save skips the merge. */
let overwrite = false;
/** May this page save maps: always in local dev; with Supabase, decided by the permission gate. */
let canSave = !hasSupabase;

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
        <select id="seat-kind">
          <option value="sit">Sit (chair, sofa)</option><option value="lie">Lie (bed)</option>
          <option value="none">No seat (turn off automatic)</option>
        </select>
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

let saveStatus: SaveStatus = 'idle';
const autosave = createAutosave({
  delayMs: AUTOSAVE_DELAY_MS,
  retryMs: AUTOSAVE_RETRY_MS,
  isDirty: dirty,
  save: saveMap,
  onStatus: showSaveStatus,
  isDenied: (err) => err instanceof ConflictError || (err as { code?: string } | null)?.code === NO_PERMISSION,
});

/** Every edit ends here: autosave picks it up (once the page may save). */
function refreshStatus(): void {
  if (canSave) autosave.changed();
  else setStatus(dirty() ? 'Unsaved changes' : `Saved · id "${map.id}"`);
}

function showSaveStatus(s: SaveStatus, err?: unknown): void {
  saveStatus = s;
  statusEl.title = '';
  switch (s) {
    case 'pending':
      return setStatus('Unsaved changes');
    case 'saving':
      return setStatus('Saving…');
    case 'failed':
      setStatus('Save failed — Retry', true);
      statusEl.classList.add('retry');
      statusEl.title = errorMessage(err);
      return;
    case 'denied':
      if (err instanceof ConflictError) return showConflict();
      return setStatus('Save failed: you no longer have editor permission', true);
    default:
      return setStatus(`Saved · id "${map.id}"`);
  }
}

/** Autosave stops until the user picks: reload the other editor's version, or overwrite it. */
function showConflict(): void {
  statusEl.className = 'status error';
  statusEl.innerHTML = `This map was changed in another editor —
    <span class="act" data-act="reload">Reload</span> | <span class="act" data-act="overwrite">Overwrite</span>`;
}

statusEl.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).dataset.act;
  if (act === 'reload') return void reloadAfterConflict().catch(showError);
  if (act === 'overwrite') {
    overwrite = true;
    return void autosave.flush();
  }
  if (saveStatus === 'failed') void autosave.flush();
});

async function reloadAfterConflict(): Promise<void> {
  if (dirty() && !confirm('Reload this map as the other editor saved it? Your changes here are lost.')) return;
  await openMap(map.id);
  void autosave.flush();
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
  const { map: loaded, seq } = await store.loadMapState(id);
  if (!loaded) return setStatus(`Map "${id}" not found`, true);
  setMap(structuredClone(loaded), true);
  loadedSeq = seq;
  history.replaceState(null, '', `?map=${encodeURIComponent(id)}`);
}

function setMap(next: OfficeMap, saved: boolean): void {
  map = next;
  savedJson = saved ? JSON.stringify(map) : '';
  undo.length = 0;
  loadedSeq = null;
  overwrite = false;
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

/** Before leaving this map: save it now; only if that fails, ask whether to drop the changes. */
async function saveOrDiscard(): Promise<boolean> {
  return (canSave && (await autosave.flush())) || confirmDiscard();
}

mapSelect.addEventListener('change', async () => {
  const next = mapSelect.value;
  if (!(await saveOrDiscard())) {
    mapSelect.value = map.id;
    return;
  }
  void openMap(next).catch(showError);
});

$('#new').addEventListener('click', async () => {
  if (!(await saveOrDiscard())) return;
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

/**
 * Fold in live edits made in the room since our last load/save (into undo snapshots too, so undo
 * never reverts a builder's edit). A 'reset' among them = another editor's save: ConflictError.
 */
async function mergeLive(): Promise<void> {
  const edits = await store.loadEdits(map.id, loadedSeq ?? 0);
  const r = mergeLiveEdits(map, undo, edits, knownSheet);
  if (r.lastId) loadedSeq = r.lastId;
  if (r.merged > 0) {
    draw();
    void loadDecorSheets(edits.flatMap((e) => (e.op.kind === 'place' ? [e.op.sheet] : []))).then(draw);
  }
  if (r.conflict) throw new ConflictError('This map was changed in another editor');
}

/**
 * Merge live edits, then store the map as it is now; edits made meanwhile stay dirty and get the
 * next save. Live edits landing between the merge and the save make it stale: merge again.
 */
async function saveMap(): Promise<void> {
  const force = overwrite || loadedSeq === null;
  overwrite = false;
  let json = '';
  for (let tries = 1; ; tries++) {
    if (!force) await mergeLive();
    json = JSON.stringify(map);
    try {
      loadedSeq = await store.saveMap(JSON.parse(json) as OfficeMap, force ? null : loadedSeq);
      break;
    } catch (err) {
      if (!(err instanceof StaleSaveError) || tries >= STALE_RETRIES) throw err;
    }
  }
  savedJson = json;
  history.replaceState(null, '', `?map=${encodeURIComponent(map.id)}`);
  if (!maps.some((m) => m.id === map.id && m.name === (map.name ?? map.id))) {
    await refreshMaps(map.id).catch((err) => console.warn('[editor] map list refresh failed:', err));
  }
}

// Manual Save stays as a fallback: save now instead of after the quiet time.
$('#save').addEventListener('click', () => void autosave.flush());

// Closing or hiding the tab saves at once (best effort: a killed tab may not finish the request).
const flushIfDirty = () => {
  if (canSave && dirty() && saveStatus !== 'denied') void autosave.flush();
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushIfDirty();
});
addEventListener('pagehide', flushIfDirty);

$('#delete').addEventListener('click', async () => {
  if (!confirm(`Delete map "${map.name ?? map.id}" for everyone? Saved player spots on it go too.`)) return;
  try {
    // Let a pending or running autosave land first, so it can't recreate the map afterwards.
    await autosave.flush();
    await store.deleteMap(map.id);
    await refreshMaps('');
    await openMap(maps[0]!.id);
    setStatus('Deleted');
  } catch (err) {
    showError(err);
  }
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
}

function showError(err: unknown): void {
  const msg = errorMessage(err);
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
  if (t === 'zone' && tool !== 'zone') {
    setStatus('Meeting room: drag a rectangle over the room (everyone inside hears each other and can share screens). Click inside a room to remove it.');
  }
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
  if (dirty() || saveStatus === 'saving') e.preventDefault();
});

const seatHint = $<HTMLParagraphElement>('#seat-hint');
function updateSeatHint(): void {
  const auto = 'Chairs, sofas, stools and beds get automatic seats (outlined badges). ';
  seatHint.textContent =
    auto +
    (seatKind === 'sit'
      ? 'Click a tile to set your own seat (filled badge): the arrow is the way the person faces. ' +
        'Click again to remove.'
      : seatKind === 'lie'
        ? 'Click the bed tile with the pillow to set your own bed spot: the arrow is where the feet point. ' +
          'Click again to remove. Press R here to turn the arrow.'
        : 'Click an automatic seat to turn it off (grey ×); click again to turn it back on.');
}
$<HTMLSelectElement>('#seat-kind').addEventListener('change', (e) => {
  seatKind = (e.target as HTMLSelectElement).value as Seat['kind'] | 'none';
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
  picker.setTransform(t);
  brushT = t;
  draw();
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
  // Seat / bed markers: a filled badge (authored) or a ring (automatic) with the facing arrow;
  // a grey × where an automatic seat is turned off.
  ctx.font = 'bold 12px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const authored = map.seats?.length ?? 0;
  effectiveSeats(map).forEach((st, i) => {
    const cx = st.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = st.y * TILE_SIZE + TILE_SIZE / 2;
    const tint = st.kind === 'lie' ? 'rgba(160, 110, 255, 0.85)' : 'rgba(255, 190, 60, 0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    if (i < authored) {
      ctx.fillStyle = tint;
      ctx.fill();
      ctx.fillStyle = '#14161a';
    } else {
      ctx.strokeStyle = tint;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = tint;
    }
    ctx.fillText(ARROW[st.dir], cx, cy + 0.5);
  });
  for (const { x, y } of map.noSeats ?? []) {
    const cx = x * TILE_SIZE + TILE_SIZE / 2;
    const cy = y * TILE_SIZE + TILE_SIZE / 2;
    ctx.fillStyle = 'rgba(150, 150, 150, 0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14161a';
    ctx.fillText('×', cx, cy + 0.5);
  }
  drawZones(ctx, map);
  if (zoneDrag) {
    const r = dragRect(zoneDrag.from, zoneDrag.to);
    ctx.save();
    ctx.fillStyle = 'rgba(79, 140, 255, 0.18)';
    ctx.fillRect(r.x * TILE_SIZE, r.y * TILE_SIZE, r.w * TILE_SIZE, r.h * TILE_SIZE);
    ctx.strokeStyle = '#8ab4f8';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x * TILE_SIZE + 1, r.y * TILE_SIZE + 1, r.w * TILE_SIZE - 2, r.h * TILE_SIZE - 2);
    ctx.restore();
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
      if (!first) break;
      if (seatKind === 'none') toggleNoSeat(map, x, y);
      else toggleSeat(map, x, y, seatKind, seatDir);
      break;
  }
  draw();
  refreshStatus();
}

let painting = false;
let lastTile: { x: number; y: number } | null = null;
/** Meeting-room tool: the rectangle being dragged (tile corners). */
let zoneDrag: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;

type TilePt = { x: number; y: number };

/** The tile rectangle spanned by two corner tiles, clipped to the map. */
function dragRect(a: TilePt, b: TilePt): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(map.width - 1, Math.max(a.x, b.x));
  const y1 = Math.min(map.height - 1, Math.max(a.y, b.y));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0 + 1), h: Math.max(0, y1 - y0 + 1) };
}

/** Finish a meeting-room drag: a click inside a room offers to remove it; a drag adds one. */
function finishZone(from: TilePt, to: TilePt): void {
  const r = dragRect(from, to);
  const click = from.x === to.x && from.y === to.y;
  const hit = zoneAt(map, to.x + 0.5, to.y + 0.5);
  if (click && hit) {
    if (!confirm(`Remove the meeting room "${hit.name}"?`)) return;
    pushUndo();
    map.zones = (map.zones ?? []).filter((z) => z !== hit);
  } else {
    if (r.w < 2 || r.h < 2) return setStatus('Drag over at least 2x2 tiles to make a meeting room', true);
    const name = prompt('Name for this meeting room?', 'Meeting room')?.trim();
    if (!name) return;
    pushUndo();
    map.zones = [...(map.zones ?? []), { name: name.slice(0, 40), ...r }];
  }
  draw();
  refreshStatus();
}

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
  if (tool === 'zone') {
    canvas.setPointerCapture(e.pointerId);
    const t = tileFromEvent(e);
    zoneDrag = { from: t, to: t };
    draw();
    return;
  }
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
  if (zoneDrag) {
    zoneDrag.to = t;
    draw();
    return;
  }
  if (painting && lastTile && (t.x !== lastTile.x || t.y !== lastTile.y)) {
    for (const step of tilesBetween(lastTile, t)) apply(step.x, step.y, false);
    lastTile = t;
  } else draw();
});
const stop = () => {
  painting = false;
  const drag = zoneDrag;
  zoneDrag = null;
  if (drag) finishZone(drag.from, drag.to);
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

// ---------- permission gate ----------

/**
 * With Supabase, only the admin and editor-granted people may save (RLS in supabase/admin.sql).
 * Cover the editor until we know, and tell everyone else why they can't use it.
 */
async function checkPermission(): Promise<boolean> {
  const overlay = document.createElement('div');
  overlay.id = 'gate';
  overlay.innerHTML = '<div class="gate-box"><p>Checking permission…</p></div>';
  document.body.appendChild(overlay);
  const uid = await ensureSession();
  if (uid && (await checkCanEditMaps())) {
    overlay.remove();
    return true;
  }
  const id = uid ? shortId(uid) : 'unknown: signing in failed, reload to retry';
  overlay.querySelector('.gate-box')!.innerHTML = `
    <h2>No permission</h2>
    <p>You can't edit maps. Ask the admin to allow the map editor for you (your id: <b>${id}</b>), then
      reload. The admin signs in on the Play page.</p>
    <a href="index.html">← Back to Play</a>`;
  return false;
}

// ---------- boot ----------

if (hasSupabase) void checkPermission().then((ok) => (canSave = ok));

setTool('paint');
// Picking cells or a transform switches to the Decoration tool; a Block mode change only redraws.
const picker = mountDecorPicker($<HTMLDivElement>('#decor-body'), (s) => {
  const modeChanged = s.mode !== blockMode;
  ({ selection, mode: blockMode, t: brushT } = s);
  if (modeChanged) draw();
  else setTool('decor');
});
const wanted = new URLSearchParams(location.search).get('map') ?? DEFAULT_MAP.id;
refreshMaps(wanted)
  .then(() => openMap(maps.some((m) => m.id === wanted) ? wanted : maps[0]!.id))
  .catch((err) => {
    showError(err);
    setMap(createBlankMap('New map', 20, 15), false);
  });
