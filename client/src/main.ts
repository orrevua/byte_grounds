import { NetClient, type NetStatus } from './net.ts';
import { Game } from './game.ts';
import {
  CATEGORIES,
  DEFAULT_APPEARANCE,
  PRESETS,
  drawAppearance,
  parseAppearance,
  preloadAll,
  serializeAppearance,
  shuffleAppearance,
} from './sprites.ts';
import type { Appearance, PeerId } from '@byte_grounds/shared/protocol';

/** Color is vestigial now (the sprite appearance drives the look); keep a stable default. */
const DEFAULT_COLOR = '#4f8cff';

/** localStorage key for the last-used appearance (E9). */
const STORAGE_KEY = 'byte_grounds.appearance';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container not found');

let net: NetClient | null = null;
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
        <label>Name <input id="name" maxlength="16" placeholder="Your name" value="Guest" /></label>
        <div class="editor">
          <canvas id="preview" width="64" height="64"></canvas>
          <div class="axes">${categoryRows}</div>
        </div>
        <button type="button" id="shuffle">Shuffle</button>
        <div class="preset-label">Presets</div>
        <div id="presets">${presetBtns}</div>
        <button id="go">Join office</button>
      </div>
    </div>`;

  const nameEl = app!.querySelector<HTMLInputElement>('#name')!;
  const go = app!.querySelector<HTMLButtonElement>('#go')!;
  const previewCtx = app!.querySelector<HTMLCanvasElement>('#preview')!.getContext('2d');

  function redraw(): void {
    if (!previewCtx) return;
    previewCtx.imageSmoothingEnabled = false;
    previewCtx.clearRect(0, 0, 64, 64);
    drawAppearance(previewCtx, appearance, 'down', 0, 0, 0);
  }

  // Per-category prev/next cycling (wrap-around).
  for (const axis of app!.querySelectorAll<HTMLDivElement>('.axis')) {
    const cat = CATEGORIES.find((c) => c.key === axis.dataset.key)!;
    for (const arrow of axis.querySelectorAll<HTMLButtonElement>('.arrow')) {
      arrow.addEventListener('click', () => {
        const opts = cat.options;
        const cur = opts.indexOf(appearance[cat.key]);
        const step = Number(arrow.dataset.dir);
        const next = opts[(cur + step + opts.length) % opts.length];
        appearance = { ...appearance, [cat.key]: next };
        redraw();
      });
    }
  }

  app!.querySelector<HTMLButtonElement>('#shuffle')!.addEventListener('click', () => {
    appearance = shuffleAppearance();
    redraw();
  });

  for (const btn of app!.querySelectorAll<HTMLButtonElement>('.preset')) {
    btn.addEventListener('click', () => {
      appearance = PRESETS.find((p) => p.id === btn.dataset.id)!.appearance;
      redraw();
    });
  }

  // Preload the full vendored set once, then draw the initial preview.
  void preloadAll().then(redraw);

  go.addEventListener('click', () => join(nameEl.value.trim() || 'Guest', appearance));
}

function join(name: string, appearance: Appearance): void {
  localStorage.setItem(STORAGE_KEY, serializeAppearance(appearance));
  net = new NetClient();
  net.connect(
    { name, color: DEFAULT_COLOR, appearance },
    {
      onStatus: setStatus,
      onMessage: (msg) => {
        if (msg.type === 'welcome') {
          if (game) game.onReconnect(msg.selfId);
          else startGame(name, appearance, msg.selfId);
        } else game?.handleMessage(msg);
      },
    },
  );
}

function startGame(name: string, appearance: Appearance, selfId: PeerId): void {
  app!.innerHTML = '<canvas id="stage"></canvas>';
  const canvas = app!.querySelector<HTMLCanvasElement>('#stage')!;
  game = new Game(canvas, { name, color: DEFAULT_COLOR, appearance }, net!, selfId);
  game.start();
}

renderJoin();
