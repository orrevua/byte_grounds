import type { Appearance, PeerId } from '@byte_grounds/shared/protocol';
import { drawHead, HEAD_CROP } from './sprites.ts';
import { t } from './i18n.ts';

/** One person in the meeting view. `video` is their live camera (or screen, when presenting). */
export interface Participant {
  id: PeerId | 'self';
  name: string;
  appearance: Appearance;
  self: boolean;
  video: MediaStream | null;
  presenting: boolean;
  busy: boolean;
  /** Mic off: a mic-off badge on their tile. */
  muted: boolean;
}

/** What the meeting view reads from and drives (the game + media). */
export interface MeetingSource {
  roomName(): string;
  /** Everyone in the room, us first. */
  participants(): Participant[];
  micOn(): boolean;
  camOn(): boolean;
  sharing(): boolean;
  canShare(): boolean;
  /** Our camera (self view) and our shared screen (preview). */
  localCamera(): MediaStream | null;
  localScreen(): MediaStream | null;
  /** Talking right now (a green ring around their face / tile). */
  speaking(id: Participant['id']): boolean;
  toggleMic(): void;
  toggleCam(): void;
  toggleScreen(): void;
  /** Walk out of the room (the red button). */
  leaveRoom(): void;
}

/** How often the open view re-reads participants and streams, and who is speaking. */
const SYNC_MS = 400;
const SPEAKING_MS = 100;

/** Material Symbols paths (Apache 2.0), 24x24. */
const ICON = {
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z',
  cam: 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z',
  present:
    'M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4v2h8v-2h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 12H4V6h16v10zM12 7l-4 4h3v3h2v-3h3l-4-4z',
  hangup:
    'M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.96.96 0 0 1 0-1.36C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.72c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.3 11.3 0 0 0-2.67-1.85.99.99 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z',
  people:
    'M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05A4.22 4.22 0 0 1 17 16.5V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  map: 'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9a.5.5 0 0 0-.36.48V20.5a.5.5 0 0 0 .5.5l.16-.03L9 18.9l6 2.1 5.64-1.9a.5.5 0 0 0 .36-.48V3.5a.5.5 0 0 0-.5-.5zM15 19l-6-2.11V5l6 2.11V19z',
};

function icon(path: string, slashed = false): string {
  const slash = slashed ? '<line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' : '';
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${path}" fill="currentColor"/>${slash}</svg>`;
}

/** Grid columns for n tiles (Meet-like: 1, 2, 2x2, 3x…). */
export function gridColumns(n: number): number {
  return n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
}

/** A calm per-person tile color from their name (the circle behind the face when the camera is off). */
export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 45%, 42%)`;
}

interface Tile {
  root: HTMLDivElement;
  video: HTMLVideoElement;
  face: HTMLCanvasElement;
  label: HTMLSpanElement;
  muted: HTMLSpanElement;
}

/**
 * Full-screen meeting view, styled after Google Meet: a grid of people (camera, or their pixel face
 * in a colored circle), the shared screen large with people in a side strip, and the bottom bar
 * (clock · room | mic, camera, present, leave | people count, back to map). Audio keeps coming
 * from the world's call; every element here is muted.
 */
export class MeetingView {
  private root: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private speakTimer: ReturnType<typeof setInterval> | undefined;
  private readonly tiles = new Map<string, Tile>();
  /** Called when the view closes (Back to map / Esc / leaving the room). */
  onClose: () => void = () => {};

  constructor(private readonly src: MeetingSource) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(): void {
    if (this.root) return;
    const root = (this.root = document.createElement('div'));
    root.id = 'meeting';
    root.innerHTML = `
      <div class="meet-main">
        <div class="meet-stage hidden">
          <video autoplay playsinline muted></video>
          <div class="meet-stage-label"></div>
        </div>
        <div class="meet-grid"></div>
      </div>
      <div class="meet-bar">
        <div class="meet-info"><span class="meet-clock"></span><span class="meet-sep">|</span><span class="meet-room"></span></div>
        <div class="meet-controls">
          <button type="button" class="meet-btn" data-act="mic"></button>
          <button type="button" class="meet-btn" data-act="cam"></button>
          <button type="button" class="meet-btn" data-act="present" title="${t('meet.present')}">${icon(ICON.present)}</button>
          <button type="button" class="meet-btn meet-leave" data-act="leave" title="${t('meet.leave')}">${icon(ICON.hangup)}</button>
        </div>
        <div class="meet-side">
          <span class="meet-people" title="${t('meet.people')}">${icon(ICON.people)}<b></b></span>
          <button type="button" class="meet-btn meet-back" data-act="back" title="${t('meet.backTitle')}">${icon(ICON.map)}<span>${t('meet.back')}</span></button>
        </div>
      </div>`;
    root.querySelector('.meet-room')!.textContent = this.src.roomName();
    root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]')?.dataset.act;
      if (act === 'mic') this.src.toggleMic();
      else if (act === 'cam') this.src.toggleCam();
      else if (act === 'present') this.src.toggleScreen();
      else if (act === 'leave') this.src.leaveRoom();
      else if (act === 'back') this.close();
      this.sync();
    });
    addEventListener('keydown', this.onKey);
    document.body.appendChild(root);
    this.sync();
    this.timer = setInterval(() => this.sync(), SYNC_MS);
    this.speakTimer = setInterval(() => this.syncSpeaking(), SPEAKING_MS);
  }

  /** Green ring on whoever is talking (cheap: only toggles a class per tile). */
  private syncSpeaking(): void {
    for (const [id, tile] of this.tiles) tile.root.classList.toggle('speaking', this.src.speaking(id as Participant['id']));
  }

  close(): void {
    if (!this.root) return;
    clearInterval(this.timer);
    clearInterval(this.speakTimer);
    removeEventListener('keydown', this.onKey);
    for (const t of this.tiles.values()) t.video.srcObject = null;
    this.tiles.clear();
    this.root.remove();
    this.root = null;
    this.onClose();
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  /** Re-read the room: tiles in, tiles out, streams, presentation and the bar's state. */
  sync(): void {
    const root = this.root;
    if (!root) return;
    const people = this.src.participants();
    const presenter = people.find((p) => p.presenting);
    const screen = presenter ? (presenter.self ? this.src.localScreen() : presenter.video) : null;

    const stage = root.querySelector<HTMLDivElement>('.meet-stage')!;
    const stageVideo = stage.querySelector('video')!;
    stage.classList.toggle('hidden', !screen);
    root.classList.toggle('presenting', !!screen);
    if (stageVideo.srcObject !== screen) stageVideo.srcObject = screen;
    stage.querySelector('.meet-stage-label')!.textContent = presenter
      ? presenter.self
        ? t('meet.youPresenting')
        : t('meet.presenting', { name: presenter.name })
      : '';

    const grid = root.querySelector<HTMLDivElement>('.meet-grid')!;
    grid.style.setProperty('--cols', String(screen ? 1 : gridColumns(people.length)));
    const seen = new Set<string>();
    for (const p of people) {
      seen.add(p.id);
      const tile = this.tiles.get(p.id) ?? this.makeTile(p.id, grid);
      // A presenter's video is their screen (it's on the stage): their tile shows the face.
      const cam = p.self ? this.src.localCamera() : p.presenting ? null : p.video;
      if (tile.video.srcObject !== cam) tile.video.srcObject = cam;
      tile.root.classList.toggle('has-video', !!cam);
      tile.root.classList.toggle('self', p.self);
      tile.root.classList.toggle('muted', p.muted);
      tile.label.textContent = (p.self ? t('meet.you', { name: p.name }) : p.name) + (p.busy ? ' · zzZ' : '');
      tile.face.style.background = avatarColor(p.name);
      drawFace(tile.face, p.appearance);
    }
    for (const [id, t] of this.tiles) {
      if (seen.has(id)) continue;
      t.video.srcObject = null;
      t.root.remove();
      this.tiles.delete(id);
    }
    // Keep DOM order = participant order (us first).
    people.forEach((p, i) => {
      const el = this.tiles.get(p.id)!.root;
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] ?? null);
    });

    const mic = root.querySelector<HTMLButtonElement>('[data-act="mic"]')!;
    const micOn = this.src.micOn();
    mic.innerHTML = icon(ICON.mic, !micOn);
    mic.classList.toggle('off', !micOn);
    mic.title = micOn ? t('meet.micOff') : t('meet.micOn');
    const camBtn = root.querySelector<HTMLButtonElement>('[data-act="cam"]')!;
    const camOn = this.src.camOn();
    camBtn.innerHTML = icon(ICON.cam, !camOn);
    camBtn.classList.toggle('off', !camOn);
    camBtn.title = camOn ? t('meet.camOff') : t('meet.camOn');
    const present = root.querySelector<HTMLButtonElement>('[data-act="present"]')!;
    present.classList.toggle('on', this.src.sharing());
    present.classList.toggle('hidden', !this.src.canShare());
    present.title = this.src.sharing() ? t('meet.stopPresenting') : t('meet.present');
    root.querySelector('.meet-people b')!.textContent = String(people.length);
    root.querySelector('.meet-clock')!.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private makeTile(id: string, grid: HTMLDivElement): Tile {
    const root = document.createElement('div');
    root.className = 'meet-tile';
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    const face = document.createElement('canvas');
    face.className = 'meet-face';
    face.width = HEAD_CROP.w * 3;
    face.height = HEAD_CROP.h * 3;
    const label = document.createElement('span');
    label.className = 'meet-name';
    const muted = document.createElement('span');
    muted.className = 'meet-muted';
    muted.title = t('meet.muted');
    muted.innerHTML = icon(ICON.mic, true);
    root.append(face, video, label, muted);
    grid.appendChild(root);
    const tile = { root, video, face, label, muted };
    this.tiles.set(id, tile);
    return tile;
  }
}

/** The pixel face, 3x, crisp. */
function drawFace(canvas: HTMLCanvasElement, a: Appearance): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  drawHead(ctx, a, 0, 0, canvas.width, canvas.height);
}
