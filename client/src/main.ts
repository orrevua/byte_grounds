import { createNet, type Net, type NetStatus } from './net.ts';
import { Game } from './game.ts';
import {
  CATEGORIES,
  DEFAULT_APPEARANCE,
  PRESETS,
  drawAppearance,
  fitAppearance,
  optionsFor,
  parseAppearance,
  preloadAll,
  serializeAppearance,
  shuffleAppearance,
} from './sprites.ts';
import type { Appearance, PeerId } from '@byte_grounds/shared/protocol';
import { startPosition, type OfficeMap } from '@byte_grounds/shared/map';
import { DEFAULT_MAP } from '@byte_grounds/shared/maps';
import { createStore, type MapSummary } from './store.ts';
import { loadDecorSheets } from './decor.ts';

/** Color is vestigial now (the sprite appearance drives the look); keep a stable default. */
const DEFAULT_COLOR = '#4f8cff';

/** localStorage key for the last-used appearance (E9). */
const STORAGE_KEY = 'byte_grounds.appearance';
const NAME_KEY = 'byte_grounds.name';
const MAP_KEY = 'byte_grounds.map';
/** How often to save our spot while moving (also saved when the page is closed). */
const SAVE_POSITION_MS = 5000;

const store = createStore();

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container not found');

let net: Net | null = null;
let game: Game | null = null;

const banner = document.createElement('div');
banner.id = 'net-banner';
banner.className = 'hidden';
document.body.appendChild(banner);

function setStatus(status: NetStatus): void {
  if (status === 'open') {
    banner.className = 'hidden';
    return;
  }
  banner.className = `net-banner-${status}`;
  banner.textContent =
    status === 'connecting'
      ? 'Connecting…'
      : status === 'reconnecting'
        ? 'Reconnecting…'
        : 'Disconnected — reload to retry';
}

function loadAppearance(): Appearance {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? parseAppearance(saved) : DEFAULT_APPEARANCE;
}

function renderJoin(): void {
  let appearance: Appearance = loadAppearance();

  const categoryRows = CATEGORIES.map(
    (c) =>
      `<div class="axis" data-key="${c.key}">
         <button type="button" class="arrow" data-dir="-1">◀</button>
         <span class="axis-label">${c.label}</span>
         <button type="button" class="arrow" data-dir="1">▶</button>
       </div>`,
  ).join('');

  const presetBtns = PRESETS.map(
    (p) => `<button type="button" class="preset" data-id="${p.id}">${p.label}</button>`,
  ).join('');

  app!.innerHTML = `
    <div id="join">
      <div class="panel">
        <h1>ByteGrounds</h1>
        <label>Name <input id="name" maxlength="16" placeholder="Your name" /></label>
        <label>Map <select id="map"><option value="${DEFAULT_MAP.id}">${DEFAULT_MAP.name}</option></select></label>
        <div class="editor">
          <canvas id="preview" width="64" height="64"></canvas>
          <div class="axes">${categoryRows}</div>
        </div>
        <button type="button" id="shuffle">Shuffle</button>
        <div class="preset-label">Presets</div>
        <div id="presets">${presetBtns}</div>
        <button id="go">Join</button>
        <div id="join-error" class="join-error"></div>
        <a class="editor-link" href="editor.html">Map editor →</a>
      </div>
    </div>`;

  const nameEl = app!.querySelector<HTMLInputElement>('#name')!;
  nameEl.value = localStorage.getItem(NAME_KEY) ?? 'Guest';
  const mapEl = app!.querySelector<HTMLSelectElement>('#map')!;
  const errorEl = app!.querySelector<HTMLDivElement>('#join-error')!;
  const go = app!.querySelector<HTMLButtonElement>('#go')!;
  void store
    .listMaps()
    .then((maps) => fillMapSelect(mapEl, maps, localStorage.getItem(MAP_KEY)))
    .catch((err) => (errorEl.textContent = storeError(err)));
  const previewCtx = app!.querySelector<HTMLCanvasElement>('#preview')!.getContext('2d');

  function redraw(): void {
    if (!previewCtx) return;
    previewCtx.imageSmoothingEnabled = false;
    previewCtx.clearRect(0, 0, 64, 64);
    drawAppearance(previewCtx, appearance, 'down', 0, 0, 0);
  }

  /** Every change goes through the cross-axis clamp; a bare outfit dims the Top/Pants rows. */
  function setAppearance(next: Appearance): void {
    appearance = fitAppearance(next);
    for (const key of ['torso', 'legs']) {
      app!.querySelector(`.axis[data-key="${key}"]`)!.classList.toggle('disabled', appearance.outfit === 'none');
    }
    redraw();
  }

  // Per-category prev/next cycling (wrap-around).
  for (const axis of app!.querySelectorAll<HTMLDivElement>('.axis')) {
    const cat = CATEGORIES.find((c) => c.key === axis.dataset.key)!;
    for (const arrow of axis.querySelectorAll<HTMLButtonElement>('.arrow')) {
      arrow.addEventListener('click', () => {
        const opts = optionsFor(cat, appearance);
        const cur = opts.indexOf(appearance[cat.key]);
        const step = Number(arrow.dataset.dir);
        const next = opts[(cur + step + opts.length) % opts.length];
        // Picking the skeleton starts it bald and bare (hair/outfit can be cycled back).
        const extra: Partial<Appearance> = cat.key === 'skin' && next === 'skeleton' ? { hair: 'none', outfit: 'none' } : {};
        setAppearance({ ...appearance, [cat.key]: next, ...extra });
      });
    }
  }

  app!.querySelector<HTMLButtonElement>('#shuffle')!.addEventListener('click', () => {
    setAppearance(shuffleAppearance());
  });

  for (const btn of app!.querySelectorAll<HTMLButtonElement>('.preset')) {
    btn.addEventListener('click', () => {
      setAppearance(PRESETS.find((p) => p.id === btn.dataset.id)!.appearance);
    });
  }

  // Clamp a loaded appearance and dim the rows; preload the full vendored set once, then draw.
  setAppearance(appearance);
  void preloadAll().then(redraw);

  go.addEventListener('click', () => {
    go.disabled = true;
    errorEl.textContent = '';
    join(nameEl.value.trim() || 'Guest', appearance, mapEl.value).catch((err) => {
      go.disabled = false;
      errorEl.textContent = storeError(err);
    });
  });
}

function fillMapSelect(select: HTMLSelectElement, maps: MapSummary[], selected: string | null): void {
  select.replaceChildren(
    ...maps.map((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      opt.selected = m.id === selected;
      return opt;
    }),
  );
}

/** A friendly message for storage failures (most likely: the SQL setup hasn't been run). */
function storeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
  return /relation|schema cache|does not exist|42P01|PGRST/i.test(msg)
    ? 'Maps aren\'t set up in Supabase yet: run supabase/schema.sql (see README).'
    : `Couldn't load maps: ${msg}`;
}

async function join(name: string, appearance: Appearance, mapId: string): Promise<void> {
  localStorage.setItem(STORAGE_KEY, serializeAppearance(appearance));
  localStorage.setItem(NAME_KEY, name);
  localStorage.setItem(MAP_KEY, mapId);
  const [map, saved] = await Promise.all([
    store.loadMap(mapId).then((m) => m ?? DEFAULT_MAP),
    store.loadPosition(mapId, name).catch(() => null),
  ]);
  await loadDecorSheets((map.decor ?? []).map((d) => d.sheet));
  const start = startPosition(map, saved);
  net = createNet();
  net.connect(
    { name, color: DEFAULT_COLOR, appearance, room: map.id, ...start },
    {
      onStatus: setStatus,
      onMessage: (msg) => {
        if (msg.type === 'welcome') {
          if (game) game.onReconnect(msg.selfId);
          else startGame(name, appearance, msg.selfId, map, start);
        } else game?.handleMessage(msg);
      },
    },
  );
}

function startGame(
  name: string,
  appearance: Appearance,
  selfId: PeerId,
  map: OfficeMap,
  start: { x: number; y: number },
): void {
  app!.innerHTML = '<canvas id="stage"></canvas>';
  const canvas = app!.querySelector<HTMLCanvasElement>('#stage')!;
  game = new Game(canvas, { name, color: DEFAULT_COLOR, appearance }, net!, selfId, map, start);
  game.start();
  savePositionPeriodically(map.id, name);
}

/** Remember where we are on this map, so we come back to the same spot next time. */
function savePositionPeriodically(mapId: string, name: string): void {
  let last = game!.position;
  const save = () => {
    const pos = game?.position;
    if (!pos || (pos.x === last.x && pos.y === last.y)) return;
    last = pos;
    void store.savePosition(mapId, name, pos.x, pos.y).catch(() => {});
  };
  setInterval(save, SAVE_POSITION_MS);
  addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
}

renderJoin();
