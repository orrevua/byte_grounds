import { createNet, type Net, type NetStatus } from './net.ts';
import { Game, type SelfInfo } from './game.ts';
import {
  CATEGORIES,
  DEFAULT_APPEARANCE,
  PRESETS,
  drawAppearance,
  fitAppearance,
  optionsFor,
  parseAppearance,
  preloadAppearance,
  serializeAppearance,
  shuffleAppearance,
} from './sprites.ts';
import type { Appearance, PeerId } from '@byte_grounds/shared/protocol';
import { startPosition, type OfficeMap } from '@byte_grounds/shared/map';
import { DEFAULT_MAP } from '@byte_grounds/shared/maps';
import { createStore, type MapSummary } from './store.ts';

/** The built-in Office, when the saved maps can't be listed. */
const FALLBACK_MAP: MapSummary = { id: DEFAULT_MAP.id, name: DEFAULT_MAP.name ?? 'Office' };
import { loadCustomSheets, loadDecorSheets } from './decor.ts';
import { hasSupabase } from './supabase.ts';
import { adminEmail, checkIsAdmin, ensureSession, signInAdmin, signOutAdmin } from './auth.ts';
import { GrantsFeed } from './grants.ts';
import { LiveMap } from './live-map.ts';
import { Hud } from './hud.ts';
import { SpotifyLink } from './spotify.ts';
import { MusicButton } from './music-button.ts';
import { dayKey, loadDailyStatus, saveDailyStatus } from './chat.ts';
import { isTouchDevice } from './input.ts';
import { MapCarousel } from './map-carousel.ts';
import { watchRoomCounts } from './lobby.ts';
import { applyDocLang, langSwitch, t, type MsgKey } from './i18n.ts';

applyDocLang();
// Phone / tablet layout (CSS `.touch-ui`), decided by the same test that shows the D-pad.
document.body.classList.toggle('touch-ui', isTouchDevice());

/** Color is vestigial now (the sprite appearance drives the look); keep a stable default. */
const DEFAULT_COLOR = '#4f8cff';

/** localStorage key for the last-used appearance (E9). */
const STORAGE_KEY = 'byte_grounds.appearance';
const NAME_KEY = 'byte_grounds.name';
/** Without Supabase (ws dev): a per-browser id, so a reconnect or a second tab replaces the old one. */
const DEVICE_KEY = 'byte_grounds.device';
const STATUS_KEY = 'byte_grounds.status';
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
      ? t('net.connecting')
      : status === 'reconnecting'
        ? t('net.reconnecting')
        : t('net.closed');
}

function loadAppearance(): Appearance {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? parseAppearance(saved) : DEFAULT_APPEARANCE;
}

function renderJoin(error = ''): void {
  let appearance: Appearance = loadAppearance();

  const categoryRows = CATEGORIES.map(
    (c) =>
      `<div class="axis" data-key="${c.key}">
         <button type="button" class="arrow" data-dir="-1">◀</button>
         <span class="axis-label">${t(`axis.${c.key}` as MsgKey)}</span>
         <button type="button" class="arrow" data-dir="1">▶</button>
       </div>`,
  ).join('');

  const presetBtns = PRESETS.map(
    (p) => `<button type="button" class="preset" data-id="${p.id}">${t(`preset.${p.id}` as MsgKey)}</button>`,
  ).join('');

  app!.innerHTML = `
    <div id="join">
      <div class="panel">
        <div class="brand">
          <img src="/logo.svg" alt="" width="48" height="48" />
          <div><h1>ByteGrounds</h1><p class="tagline">${t('join.tagline')}</p></div>
        </div>
        <label>${t('join.name')} <input id="name" maxlength="16" placeholder="${t('join.namePlaceholder')}" /></label>
        <div class="map-label">${t('join.map')}</div>
        <div id="map-slot"></div>
        <div class="editor">
          <canvas id="preview" width="64" height="64"></canvas>
          <div class="axes">${categoryRows}</div>
        </div>
        <button type="button" id="shuffle">${t('join.shuffle')}</button>
        <div class="preset-label">${t('join.presets')}</div>
        <div id="presets">${presetBtns}</div>
        <button id="go">${t('join.go')}</button>
        <div id="join-error" class="join-error"></div>
        <div id="admin-box" class="admin-box"></div>
        <a class="editor-link" href="editor.html">${t('join.mapEditor')}</a>
        <a class="editor-link studio-link hidden" href="sheets.html">${t('join.studio')}</a>
      </div>
    </div>`;

  const nameEl = app!.querySelector<HTMLInputElement>('#name')!;
  nameEl.value = localStorage.getItem(NAME_KEY) ?? t('join.guest');
  app!.querySelector('.brand')!.append(langSwitch());
  const carousel = new MapCarousel((id) => store.loadMap(id));
  app!.querySelector('#map-slot')!.replaceWith(carousel.el);
  const stopCounts = watchRoomCounts((counts) => carousel.setCounts(counts));
  const errorEl = app!.querySelector<HTMLDivElement>('#join-error')!;
  errorEl.textContent = error;
  const go = app!.querySelector<HTMLButtonElement>('#go')!;
  const adminBox = app!.querySelector<HTMLDivElement>('#admin-box')!;
  if (hasSupabase) renderAdminBox(adminBox);
  else app!.querySelector('.studio-link')!.classList.remove('hidden'); // local dev: no gate
  // Sheet Studio sheets first, so the miniatures can draw cells made with them.
  void loadCustomSheets(store)
    .then(() => store.listMaps())
    .then((maps) => carousel.setMaps(maps.length ? maps : [FALLBACK_MAP], DEFAULT_MAP.id)) // the Office is always preselected
    .catch((err) => {
      carousel.setMaps([FALLBACK_MAP], DEFAULT_MAP.id);
      errorEl.textContent = storeError(err);
    });
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
    for (const key of ['torso', 'bottom', 'legs']) {
      app!.querySelector(`.axis[data-key="${key}"]`)!.classList.toggle('disabled', appearance.outfit === 'none');
    }
    redraw();
    // Layers load on demand (the full wardrobe is too big to fetch up front); draw once they land.
    const shown = appearance;
    void preloadAppearance(shown).then(() => shown === appearance && redraw());
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

  // Clamp a loaded appearance and dim the rows (loads its layers, then draws); warm the presets.
  setAppearance(appearance);
  for (const p of PRESETS) void preloadAppearance(p.appearance);

  go.addEventListener('click', () => {
    go.disabled = true;
    errorEl.textContent = '';
    join(nameEl.value.trim() || t('join.guest'), appearance, carousel.value || DEFAULT_MAP.id, stopCounts).catch((err) => {
      go.disabled = false;
      errorEl.textContent = storeError(err);
    });
  });
}

/** Admin sign-in state under Join: signed in as the admin, or a link that opens the login form. */
function renderAdminBox(box: HTMLDivElement): void {
  void adminEmail().then(async (email) =>
    email ? showSignedIn(box, email, await checkIsAdmin()) : showAdminLink(box),
  );
}

/** Email sign-ups are open, so a signed-in account is only labelled admin when `is_admin()` says so. */
function showSignedIn(box: HTMLDivElement, email: string, isAdmin: boolean): void {
  document.querySelector('.studio-link')?.classList.toggle('hidden', !isAdmin);
  box.innerHTML = `<div><span class="admin-email"></span> · <button type="button" class="link">${t('join.signOut')}</button></div>
    <div class="join-error"></div>`;
  box.querySelector('.admin-email')!.textContent = t(isAdmin ? 'join.admin' : 'join.signedIn', { email });
  const errorEl = box.querySelector<HTMLDivElement>('.join-error')!;
  box.querySelector('button')!.addEventListener('click', () => {
    signOutAdmin()
      .then(() => renderAdminBox(box))
      .catch((err) => (errorEl.textContent = errorMessage(err)));
  });
}

function showAdminLink(box: HTMLDivElement): void {
  box.innerHTML = `<button type="button" class="link">${t('join.adminLogin')}</button>`;
  box.querySelector('button')!.addEventListener('click', () => showAdminForm(box));
}

function showAdminForm(box: HTMLDivElement): void {
  box.innerHTML = `<form class="admin-form">
      <input name="email" type="email" placeholder="${t('join.adminEmail')}" autocomplete="username" required />
      <input name="password" type="password" placeholder="${t('join.password')}" autocomplete="current-password" required />
      <button type="submit">${t('join.signIn')}</button>
      <div class="join-error"></div>
    </form>`;
  const form = box.querySelector('form')!;
  const submit = form.querySelector<HTMLButtonElement>('button')!;
  const errorEl = form.querySelector<HTMLDivElement>('.join-error')!;
  form.querySelector('input')!.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    submit.disabled = true;
    errorEl.textContent = '';
    signInAdmin(String(data.get('email')).trim(), String(data.get('password')))
      .then(() => renderAdminBox(box))
      .catch((err) => {
        submit.disabled = false;
        errorEl.textContent = errorMessage(err);
      });
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
}

/** A friendly message for storage failures (most likely: the SQL setup hasn't been run). */
function storeError(err: unknown): string {
  const msg = errorMessage(err);
  return /relation|schema cache|does not exist|42P01|PGRST/i.test(msg)
    ? t('join.mapsNotSetUp')
    : t('join.mapsLoadFailed', { msg });
}

/** A stable id for this browser, used as the account in ws dev mode (no Supabase Auth there). */
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) localStorage.setItem(DEVICE_KEY, (id = crypto.randomUUID()));
  return id;
}

/** The same account joined elsewhere: this tab stops, with a way to take over again. */
function showKicked(): void {
  const el = document.createElement('div');
  el.id = 'kicked';
  el.innerHTML = `<div class="kicked-card"><p></p><button type="button"></button></div>`;
  el.querySelector('p')!.textContent = t('kicked.text');
  const btn = el.querySelector('button')!;
  btn.textContent = t('kicked.reload');
  btn.addEventListener('click', () => location.reload());
  document.body.appendChild(el);
}

async function join(name: string, appearance: Appearance, mapId: string, stopCounts: () => Promise<void>): Promise<void> {
  localStorage.setItem(STORAGE_KEY, serializeAppearance(appearance));
  localStorage.setItem(NAME_KEY, name);
  // Sheet Studio sheets before the map, so cells drawn with them are known (and loadable).
  await loadCustomSheets(store);
  const [map, saved, uid] = await Promise.all([
    store.loadMap(mapId).then((m) => m ?? DEFAULT_MAP),
    store.loadPosition(mapId, name).catch(() => null),
    ensureSession(),
  ]);
  const isAdmin = uid ? await checkIsAdmin() : false;
  await loadDecorSheets((map.decor ?? []).map((d) => d.sheet));
  const start = startPosition(map, saved);
  const status = loadDailyStatus(localStorage.getItem(STATUS_KEY), dayKey(new Date()));
  const self: SelfInfo = { name, color: DEFAULT_COLOR, appearance, isAdmin, status, ...(uid ? { uid } : {}) };
  // The game joins the lobby channel itself; the join screen's watcher must be gone first.
  await stopCounts();
  // ws dev has no auth: a per-browser id stands in, so one browser = one player there too.
  const account = uid ?? (hasSupabase ? undefined : deviceId());
  net = createNet();
  net.connect(
    { name, color: DEFAULT_COLOR, appearance, room: map.id, ...start, status, ...(account ? { uid: account } : {}), ...(isAdmin ? { admin: true } : {}) },
    {
      onStatus: setStatus,
      onMessage: (msg) => {
        if (msg.type === 'refused' || msg.type === 'kicked') {
          net?.close();
          net = null;
          banner.className = 'hidden';
          if (game || msg.type === 'kicked') {
            game?.stop();
            game = null;
            app!.innerHTML = '';
            showKicked();
          } else renderJoin(t('join.nameTaken', { name }));
          return;
        }
        if (msg.type === 'welcome') {
          if (game) game.onReconnect(msg.selfId);
          else startGame(self, msg.selfId, map, start);
        } else game?.handleMessage(msg);
      },
    },
  );
}

function startGame(self: SelfInfo, selfId: PeerId, map: OfficeMap, start: { x: number; y: number }): void {
  app!.innerHTML = '<canvas id="stage"></canvas>';
  const canvas = app!.querySelector<HTMLCanvasElement>('#stage')!;
  game = new Game(canvas, self, net!, selfId, map, start);
  game.start();
  if (self.uid) {
    const uid = self.uid;
    const feed = new GrantsFeed();
    void feed.start().catch((err) => console.warn('[grants] feed failed:', err));
    game.attachGrants(feed);
    // Live building: `map` is the object the game draws, so applied edits show at once.
    // Attach before start() so the first load already reaches the game's onChange.
    const live = new LiveMap(map, map.id, uid, {
      isAdmin: self.isAdmin,
      canBake: () => self.isAdmin || feed.has(uid, 'editor'),
    });
    game.attachLive(live);
    void live.start().catch((err) => console.warn('[live] edits feed failed:', err));
  }
  const savePosition = savePositionPeriodically(map.id, self.name);
  attachHud(game, savePosition);
}

/** The HUD drives the game (status, busy, chat); Leave goes back to the join screen. */
function attachHud(g: Game, savePosition: () => Promise<void>): void {
  const hud = new Hud(
    {
      // A reload is the join screen, and it releases mic/cam/screen, channels and timers at once.
      leave: () => void savePosition().finally(() => location.reload()),
      setStatus: (text) => {
        g.setStatus(text);
        localStorage.setItem(STATUS_KEY, saveDailyStatus(g.statusFields.status, dayKey(new Date())));
      },
      toggleBusy: () => g.toggleBusy(),
      sendChat: (text) => g.sendChat(text),
    },
    g.statusFields,
    !isTouchDevice(),
  );
  g.onSelfStatus = (fields) => hud.setSelfStatus(fields);
  g.onChat = (name, text, self) => hud.addChat(name, text, self);
  attachSpotify(g);
}

/** Spotify "now playing" (when the build has a Client ID): a HUD button; what plays goes to our status. */
function attachSpotify(g: Game): void {
  const link = new SpotifyLink();
  const bar = document.querySelector<HTMLElement>('#hud .hud-bar');
  if (!link.enabled || !bar) return;
  const button = new MusicButton(link, bar);
  link.onChange = () => {
    g.setMusic(link.shared);
    button.render();
  };
}

/** Remember where we are on this map, so we come back to the same spot next time. Returns a save-now. */
function savePositionPeriodically(mapId: string, name: string): () => Promise<void> {
  let last = game!.position;
  const save = async (): Promise<void> => {
    const pos = game?.position;
    if (!pos || (pos.x === last.x && pos.y === last.y)) return;
    last = pos;
    await store.savePosition(mapId, name, pos.x, pos.y).catch(() => {});
  };
  setInterval(save, SAVE_POSITION_MS);
  addEventListener('pagehide', () => void save());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void save();
  });
  return save;
}

renderJoin();
