import { decorLayer, seatsNearIn, stepOutOf, zoneAt, zoneKey, type DecorCell, type OfficeMap, type Seat, type Zone } from '@byte_grounds/shared/map';
import { POSITION_TICK_MS, TILE_SIZE, normalizeChat, normalizePose, normalizeStatus } from '@byte_grounds/shared/protocol';
import { effectiveSeats, seatSpot } from '@byte_grounds/shared/seats';
import type { Appearance, HeldItem, PeerId, PeerState, Pose, ServerToClient, StatusFields } from '@byte_grounds/shared/protocol';
import { balloonHeight, drawAvatar, drawAvatarTags, drawChatBalloon, drawDecorCellAt, drawHeldItem, drawZones, tagsTop, drawMap, drawPosedSprite, mapPixelSize, tileToScreen } from './render.ts';
import { avatarAnchorY, sortRenderables, stackedDecorAnchors } from './depth.ts';
import { ZOOM_STEPS, cameraOffset, clampZoom, stepZoom, viewportSize } from './camera.ts';
import { Minimap, type MinimapDot } from './minimap.ts';
import { Keyboard, TouchPad, isTouchDevice } from './input.ts';
import { stepMovement, type MoveInput } from './movement.ts';
import { distanceTiles, nextLinkState, type ProxState } from './proximity.ts';
import { MeetingView, type Participant } from './meeting.ts';
import { drinkDuration, formatDuration, machineNear, machinesIn, type Machine } from './dispensers.ts';
import { MediaManager, ScreenStage, VideoBubbles, hasLiveVideo, volumeForDistance } from './media.ts';
import { WebrtcMesh } from './webrtc.ts';
import { avatarAt, screenToWorld } from './hit.ts';
import { AvatarMenu } from './avatar-menu.ts';
import type { GrantsFeed } from './grants.ts';
import type { LiveMap, MoveSource } from './live-map.ts';
import { BuildPanel } from './build-panel.ts';
import { brushCells, cellBlocks } from './editor-model.ts';
import { placeOp } from './edit-ops.ts';
import { blockedByWall, placeCells } from './live-model.ts';
import {
  appearanceReady,
  directionFromDelta,
  normalizeAppearance,
  preloadAppearance,
  walkFrameIndex,
  type Direction,
} from './sprites.ts';
import type { Net } from './net.ts';

export interface SelfInfo {
  name: string;
  color: string;
  appearance: Appearance;
  /** Supabase auth uid; absent in ws dev mode or when signing in failed. */
  uid?: string;
  isAdmin: boolean;
  /** Today's status line (may be empty). */
  status: string;
}

/** The fields every drawable avatar (self or remote) shares. */
interface Avatar {
  name: string;
  color: string;
  appearance: Appearance;
  x: number;
  y: number;
  dir: Direction;
  animMs: number;
  moving: boolean;
  pose: Pose;
  status: string;
  busy: boolean;
  sharing: boolean;
  /** A drink in hand ('' = none). */
  item: HeldItem;
  /** Signed in as the admin: an [ADM] tag before the name. */
  admin: boolean;
}

/** A chat line floating over the room, Habbo style (world px; rises as newer ones arrive). */
interface Balloon {
  appearance: Appearance;
  name: string;
  text: string;
  x: number;
  /** Tail tip (world px) at birth; it drifts up with age and is pushed up by newer balloons. */
  y: number;
  /** Box height (world px). */
  h: number;
  born: number;
}

/** Tail height under a balloon box (matches `drawChatBalloon`). */
const BALLOON_TAIL = 5;

interface RemoteAvatar extends Avatar {
  tx: number; // latest target from the server
  ty: number;
  uid?: string;
}

/** Toward the feet of someone lying facing `dir`. */
const FEET: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const ZOOM_KEY = 'byte_grounds.zoom';

/** The remembered map zoom (1 when unset, unreadable or out of range). */
function loadZoom(): number {
  try {
    return clampZoom(Number(localStorage.getItem(ZOOM_KEY) ?? 1));
  } catch {
    return 1;
  }
}

/** How close (tiles, to the seat's center) you must be to sit/lie on it. */
const SEAT_REACH = 1.6;

/** Exponential smoothing rate for remote interpolation (~matches the 12 Hz stream). */
const INTERP_RATE = 12;

/** Movement below this per-frame delta (tiles) counts as idle (standing frame). */
const MOVE_EPS = 1e-3;

/** How long a toast (e.g. a refused edit) stays up. */
const TOAST_MS = 4000;

/** Chat balloons: how long one lives, its fade-out, upward drift (px/s), gap, and how many at most. */
const BALLOON_MS = 15000;
const BALLOON_FADE_MS = 1500;
const BALLOON_DRIFT = 6;
const BALLOON_GAP = 4;
const BALLOON_MAX = 30;

/** Canvas render loop, local movement, position broadcast, and remote avatars. */
export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly keyboard = new Keyboard();
  private readonly touchpad = isTouchDevice() ? new TouchPad() : null;
  private readonly self: Avatar;
  private readonly isAdmin: boolean;
  private readonly uid: string | undefined;
  private menu: AvatarMenu | null = null;
  private grants: GrantsFeed | null = null;
  /** Live building (Supabase only): the room's edit log, the drawer, and its toggle button. */
  private live: LiveMap | null = null;
  private panel: BuildPanel | null = null;
  private buildBtn: HTMLButtonElement | null = null;
  /** The tile under the pointer while building (ghost position). */
  private buildHover: { x: number; y: number } | null = null;
  /** Move tool: the piece picked up, and which of its tiles was grabbed (it follows the pointer). */
  private moving: { src: MoveSource; dx: number; dy: number } | null = null;
  private toastEl: HTMLDivElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** The seat we're on, and where we stood before, to step back there when getting up. */
  private seat: { seat: Seat; standX: number; standY: number } | null = null;
  /** The map's usable seats (authored + automatic); recomputed by `refreshSeats`. */
  private seats: Seat[];
  private readonly seatBtn: HTMLButtonElement;
  private readonly danceBtn: HTMLButtonElement;
  /** Drink machines on the map, the button that uses one, and when our drink runs out. */
  private machines: Machine[];
  private readonly drinkBtn: HTMLButtonElement;
  private itemUntil = 0;
  private sentPose: Pose = 'stand';
  private sentDir: Direction = 'down';
  private readonly remotes = new Map<PeerId, RemoteAvatar>();
  private balloons: Balloon[] = [];
  private readonly prox = new Map<PeerId, ProxState>();
  private readonly media = new MediaManager();
  private readonly bubbles: VideoBubbles;
  private readonly stage = new ScreenStage();
  /** The meeting room we're in (null = none), its full-screen view and the pill that opens it. */
  private zone: Zone | null = null;
  private readonly meeting: MeetingView;
  private readonly meetPill: HTMLButtonElement;
  private readonly mesh: WebrtcMesh;
  private raf = 0;
  private lastT = 0;
  private sinceSend = 0;
  private sentX = NaN;
  private sentY = NaN;
  /** The last frame's view: camera offset (world px) and CSS scale, for mapping clicks. */
  private camX = 0;
  private camY = 0;
  /** Where the minimap told the camera to look (world px); null = follow our avatar. */
  private lookAt: { px: number; py: number } | null = null;
  private minimap: Minimap | null = null;
  private scale = 1;
  /** Map zoom (the world is drawn this many times bigger); the HUD is DOM and never scales. */
  private zoom = loadZoom();
  private readonly zoomCtl: HTMLDivElement;
  /** Two-finger pinch: the finger distance and zoom when it started. */
  private pinch: { dist: number; zoom: number } | null = null;
  /** Called when a remote avatar is clicked (client coords of the click). */
  onAvatarClick: ((id: PeerId, clientX: number, clientY: number) => void) | null = null;
  /** A chat line arrived (or we sent one: `self` true). */
  onChat: ((name: string, text: string, self: boolean) => void) | null = null;
  /** Our status fields changed (e.g. walking ended busy), for the HUD. */
  onSelfStatus: ((fields: StatusFields) => void) | null = null;
  /** A remote's status fields changed, or they left (screen-share stage). */
  onPeersChanged: (() => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    self: SelfInfo,
    private readonly net: Net,
    private selfId: PeerId,
    private readonly map: OfficeMap,
    start: { x: number; y: number } = map.spawn,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.seats = effectiveSeats(map);
    this.machines = machinesIn(map);

    this.fitCanvas();

    this.isAdmin = self.isAdmin;
    this.uid = self.uid;
    this.self = {
      name: self.name,
      color: self.color,
      appearance: self.appearance,
      x: start.x,
      y: start.y,
      dir: 'down',
      animMs: 0,
      moving: false,
      pose: 'stand',
      status: normalizeStatus(self.status),
      busy: false,
      sharing: false,
      item: '',
      admin: self.isAdmin,
    };

    this.seatBtn = document.createElement('button');
    this.seatBtn.id = 'seat-btn';
    this.seatBtn.className = 'hidden';
    this.seatBtn.addEventListener('click', () => this.toggleSeat());
    document.body.appendChild(this.seatBtn);
    this.danceBtn = document.createElement('button');
    this.danceBtn.id = 'dance-btn';
    this.danceBtn.addEventListener('click', () => this.toggleDance());
    document.body.appendChild(this.danceBtn);
    this.drinkBtn = document.createElement('button');
    this.drinkBtn.id = 'drink-btn';
    this.drinkBtn.className = 'hidden';
    this.drinkBtn.addEventListener('click', () => this.getDrink());
    document.body.appendChild(this.drinkBtn);
    addEventListener('keydown', this.onKey);
    addEventListener('resize', this.fitCanvas);
    this.minimap = new Minimap(
      this.map,
      (px, py) => {
        this.lookAt = { px, py };
        this.minimap?.setFollowing(false);
      },
      () => this.followSelf(),
    );
    this.zoomCtl = document.createElement('div');
    this.zoomCtl.id = 'zoom-ctl';
    this.zoomCtl.innerHTML =
      '<button type="button" data-z="1" title="Zoom in (+ or mouse wheel)">+</button>' +
      '<span></span>' +
      '<button type="button" data-z="-1" title="Zoom out (-)">−</button>';
    this.zoomCtl.addEventListener('click', (e) => {
      const dir = Number((e.target as HTMLElement).closest<HTMLButtonElement>('[data-z]')?.dataset.z);
      if (dir === 1 || dir === -1) this.setZoom(stepZoom(this.zoom, dir));
    });
    document.body.appendChild(this.zoomCtl);
    this.updateZoomCtl();
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    addEventListener('wheel', this.onCtrlWheel, { passive: false });
    canvas.addEventListener('touchstart', this.onTouch, { passive: false });
    canvas.addEventListener('touchmove', this.onTouch, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.bubbles = new VideoBubbles(canvas.parentElement ?? document.body);
    this.mesh = new WebrtcMesh(
      selfId,
      net,
      () => this.media.acquire(),
      (peerId, stream) => this.bubbles.add(peerId, stream),
      (peerId) => this.bubbles.remove(peerId),
    );
    this.media.onVideoTrack = (track, stream) => this.mesh.setVideo(track, stream);
    this.media.onSharing = (on) => this.setSharing(on);
    this.meeting = new MeetingView({
      roomName: () => this.zone?.name ?? 'Meeting room',
      participants: () => this.participants(),
      micOn: () => this.media.micEnabled,
      camOn: () => this.media.camEnabled,
      sharing: () => this.media.sharing,
      canShare: () => this.media.canShareScreen,
      localCamera: () => this.media.cameraStream,
      localScreen: () => this.media.screenStream,
      toggleMic: () => this.media.toggleMic(),
      toggleCam: () => void this.media.toggleCam(),
      toggleScreen: () => void this.media.toggleScreen(),
      leaveRoom: () => this.leaveZone(),
    });
    this.meeting.onClose = () => this.updatePill();
    this.media.onChange = () => this.meeting.sync();
    this.meetPill = document.createElement('button');
    this.meetPill.id = 'meet-pill';
    this.meetPill.className = 'hidden';
    this.meetPill.addEventListener('click', () => {
      this.meeting.open();
      this.updatePill();
    });
    document.body.appendChild(this.meetPill);
  }

  /** Our current tile-space position (for saving where we left off); the stand spot while seated. */
  get position(): { x: number; y: number } {
    return this.seat ? { x: this.seat.standX, y: this.seat.standY } : { x: this.self.x, y: this.self.y };
  }

  /** Recompute the usable seats after the map's decor/seats/noSeats change; stand up if ours is gone. */
  refreshSeats(): void {
    this.seats = effectiveSeats(this.map);
    this.machines = machinesIn(this.map);
    const mine = this.seat?.seat;
    if (mine && !this.seats.some((st) => st.x === mine.x && st.y === mine.y && st.kind === mine.kind)) this.standUp();
  }

  start(): void {
    void preloadAppearance(this.self.appearance);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.keyboard.dispose();
    this.touchpad?.dispose();
    removeEventListener('keydown', this.onKey);
    removeEventListener('resize', this.fitCanvas);
    removeEventListener('wheel', this.onCtrlWheel);
    this.ctx.canvas.removeEventListener('wheel', this.onWheel);
    this.ctx.canvas.removeEventListener('touchstart', this.onTouch);
    this.ctx.canvas.removeEventListener('touchmove', this.onTouch);
    this.ctx.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.zoomCtl.remove();
    this.minimap?.dispose();
    this.ctx.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.ctx.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.menu?.close();
    this.panel?.dispose();
    this.buildBtn?.remove();
    this.toastEl?.remove();
    clearTimeout(this.toastTimer);
    this.seatBtn.remove();
    this.danceBtn.remove();
    this.drinkBtn.remove();
    this.live?.stop();
    this.mesh.closeAll();
    this.stage.dispose();
    this.meeting.close();
    this.meetPill.remove();
  }

  /** Live grants: the admin gets a permissions menu when clicking an avatar; builders a Build button. */
  attachGrants(feed: GrantsFeed): void {
    this.grants = feed;
    feed.onChange(() => this.updateBuildAccess());
    if (!this.isAdmin) return;
    const menu = (this.menu = new AvatarMenu(feed));
    this.onAvatarClick = (id, clientX, clientY) => {
      const r = this.remotes.get(id);
      if (r) menu.open({ name: r.name, uid: r.uid }, clientX, clientY);
    };
  }

  /**
   * Live building: a Build button (admin, or a `build` grant; re-checked on grant changes) opens
   * the drawer; clicks on the map then send edits. Every applied change refreshes the seats.
   */
  attachLive(live: LiveMap): void {
    this.live = live;
    const panel = (this.panel = new BuildPanel(this.isAdmin));
    panel.onUndo = () => void live.undoOwn();
    panel.onTool = () => (this.moving = null);
    const btn = (this.buildBtn = document.createElement('button'));
    btn.id = 'build-btn';
    btn.className = 'hidden';
    btn.addEventListener('click', () => {
      if (panel.isOpen) panel.close();
      else {
        this.menu?.close();
        panel.open();
      }
    });
    document.body.appendChild(btn);
    live.onChange((resized) => {
      this.refreshSeats();
      this.minimap?.invalidate();
      if (resized) this.fitCanvas();
    });
    live.onError((msg) => this.toast(msg));
    this.updateBuildAccess();
  }

  private canBuild(): boolean {
    return this.isAdmin || !!this.grants?.has(this.uid, 'build');
  }

  /** Show the Build button only to builders; a revoked grant closes the drawer. */
  private updateBuildAccess(): void {
    if (!this.buildBtn) return;
    const ok = this.canBuild();
    this.buildBtn.classList.toggle('hidden', !ok);
    if (!ok) this.panel?.close();
  }

  private toast(msg: string, kind: 'error' | 'info' = 'error'): void {
    const el = (this.toastEl ??= document.body.appendChild(document.createElement('div')));
    el.id = 'toast';
    el.textContent = msg;
    el.className = kind;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), TOAST_MS);
  }

  /**
   * After the socket reconnects, the server issues a fresh id. Reset peer and
   * mesh state; remotes re-arrive via the new presence snapshot.
   */
  onReconnect(selfId: PeerId): void {
    this.selfId = selfId;
    this.mesh.closeAll();
    this.mesh.setSelfId(selfId);
    this.remotes.clear();
    this.prox.clear();
    this.sentX = NaN;
    this.sentY = NaN;
    // The ws relay re-joins with the status we had at join time: send the current one.
    this.sendStatus();
    this.onPeersChanged?.();
  }

  /** Our status fields as sent to others. */
  get statusFields(): StatusFields {
    return { status: this.self.status, busy: this.self.busy, sharing: this.self.sharing, item: this.self.item };
  }

  private sendStatus(): void {
    this.net.send({ type: 'status', ...this.statusFields });
    this.onSelfStatus?.(this.statusFields);
  }

  /** Set today's status line ('' clears it). */
  setStatus(text: string): void {
    const status = normalizeStatus(text);
    if (status === this.self.status) return;
    this.self.status = status;
    this.sendStatus();
  }

  /** Busy / away on or off: a zzZ over the avatar; it stops a dance. Walking ends it. */
  toggleBusy(): void {
    this.self.busy = !this.self.busy;
    if (this.self.busy && this.self.pose === 'dance') this.self.pose = 'stand';
    this.sendStatus();
  }

  setSharing(on: boolean): void {
    if (this.self.sharing === on) return;
    this.self.sharing = on;
    this.sendStatus();
  }

  /** The drink machine within reach (not while seated or lying). */
  private machineNearby(): Machine | undefined {
    return this.seat ? undefined : machineNear(this.machines, this.self.x, this.self.y);
  }

  /** Take a coffee / water from the machine in reach: held for 30 s, 1 min or 5 min (random). */
  getDrink(): void {
    const k = this.machineNearby();
    if (!k) return;
    const ms = drinkDuration(Math.random());
    this.self.item = k.item;
    this.itemUntil = Date.now() + ms;
    if (this.self.pose === 'dance') this.self.pose = 'stand';
    this.sendStatus();
    this.toast(`${k.item === 'coffee' ? 'Coffee' : 'Water'} in hand for ${formatDuration(ms)}`, 'info');
  }

  /** The drink is finished. */
  private dropDrink(): void {
    if (!this.self.item) return;
    this.self.item = '';
    this.itemUntil = 0;
    this.sendStatus();
  }

  /** Send a chat line to the room and show it over our avatar. */
  sendChat(text: string): void {
    const clean = normalizeChat(text);
    if (!clean) return;
    this.net.send({ type: 'chat', text: clean });
    this.addBalloon(this.self, clean);
    this.onChat?.(this.self.name, clean, true);
  }

  /**
   * A new balloon appears just above the speaker's tags; every balloon already up moves up by its
   * height, so the conversation stacks and rises like a chat log over the room.
   */
  private addBalloon(a: Avatar, text: string): void {
    const now = Date.now();
    const fresh: Balloon = {
      appearance: a.appearance,
      name: a.name,
      text,
      x: a.x * TILE_SIZE,
      y: tagsTop(a.y, a.pose, { name: a.name, status: a.status, busy: a.busy }) - 2,
      h: balloonHeight(this.ctx, a.name, text),
      born: now,
    };
    // Newest to oldest, each balloon's tail must sit above the top of the one after it.
    let ceiling = fresh.y - BALLOON_TAIL - fresh.h - BALLOON_GAP;
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i]!;
      const drawn = b.y - this.balloonDrift(b, now);
      if (drawn > ceiling) b.y -= drawn - ceiling;
      ceiling = Math.min(drawn, ceiling) - BALLOON_TAIL - b.h - BALLOON_GAP;
    }
    this.balloons.push(fresh);
    if (this.balloons.length > BALLOON_MAX) this.balloons.shift();
  }

  private balloonDrift(b: Balloon, now: number): number {
    return ((now - b.born) / 1000) * BALLOON_DRIFT;
  }

  private drawBalloons(now: number): void {
    this.balloons = this.balloons.filter((b) => now - b.born < BALLOON_MS);
    for (const b of this.balloons) {
      const age = now - b.born;
      const alpha = Math.min(1, (BALLOON_MS - age) / BALLOON_FADE_MS);
      drawChatBalloon(this.ctx, b.appearance, b.name, b.text, b.x, b.y - this.balloonDrift(b, now), alpha);
    }
  }

  /** Remotes that are sharing their screen and connected to us (in call range), nearest first. */
  presenters(): { id: PeerId; name: string }[] {
    return [...this.remotes]
      .filter(([id, r]) => r.sharing && this.prox.get(id) === 'near')
      .sort(([, a], [, b]) => distanceTiles(this.self, a) - distanceTiles(this.self, b))
      .map(([id, r]) => ({ id, name: r.name }));
  }

  private makeRemote(p: PeerState): RemoteAvatar {
    return {
      name: p.name,
      color: p.color,
      appearance: normalizeAppearance(p.appearance),
      x: p.x,
      y: p.y,
      tx: p.x,
      ty: p.y,
      dir: p.dir ?? 'down',
      animMs: 0,
      moving: false,
      pose: normalizePose(p.pose),
      status: normalizeStatus(p.status),
      busy: p.busy === true,
      sharing: p.sharing === true,
      item: p.item === 'coffee' || p.item === 'water' ? p.item : '',
      admin: p.admin === true,
      ...(typeof p.uid === 'string' ? { uid: p.uid } : {}),
    };
  }

  /** Apply a server message to the remote-avatar set. */
  handleMessage(msg: ServerToClient): void {
    switch (msg.type) {
      case 'presence-snapshot':
        for (const p of msg.peers) {
          if (p.id === this.selfId) continue;
          this.remotes.set(p.id, this.makeRemote(p));
        }
        for (const p of msg.peers) void preloadAppearance(normalizeAppearance(p.appearance));
        break;
      case 'peer-joined':
        if (msg.peer.id !== this.selfId) {
          this.remotes.set(msg.peer.id, this.makeRemote(msg.peer));
          void preloadAppearance(normalizeAppearance(msg.peer.appearance));
        }
        break;
      case 'peer-moved': {
        const r = this.remotes.get(msg.id);
        if (r) {
          r.tx = msg.x;
          r.ty = msg.y;
          const pose = normalizePose(msg.pose);
          if (pose !== r.pose) {
            // Jump onto / off the seat instead of gliding through the furniture.
            r.x = msg.x;
            r.y = msg.y;
            r.pose = pose;
          }
          if (pose !== 'stand' && msg.dir) r.dir = msg.dir;
        }
        break;
      }
      case 'peer-status': {
        const r = this.remotes.get(msg.id);
        if (r) {
          r.status = normalizeStatus(msg.status);
          r.busy = msg.busy === true;
          r.sharing = msg.sharing === true;
          r.item = msg.item === 'coffee' || msg.item === 'water' ? msg.item : '';
          this.onPeersChanged?.();
        }
        break;
      }
      case 'chat': {
        const r = this.remotes.get(msg.from);
        const text = normalizeChat(msg.text);
        if (!text) break;
        if (r) this.addBalloon(r, text);
        this.onChat?.(r?.name ?? msg.name, text, false);
        break;
      }
      case 'peer-left':
        this.remotes.delete(msg.id);
        this.prox.delete(msg.id);
        this.mesh.disconnect(msg.id);
        this.onPeersChanged?.();
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        void this.mesh.handleSignal(msg);
        break;
    }
  }

  private readonly frame = (t: number): void => {
    const dt = Math.min((t - this.lastT) / 1000, 0.1);
    this.lastT = t;

    const input = this.moveInput();
    const moveHeld = input.up || input.down || input.left || input.right;
    if (moveHeld && this.lookAt) this.followSelf();
    if (moveHeld && this.self.pose === 'dance') this.self.pose = 'stand';
    if (moveHeld && this.self.busy && !this.seat) this.toggleBusy();
    if (this.self.item && Date.now() >= this.itemUntil) this.dropDrink();
    this.updateZone();
    if (this.seat && moveHeld) this.standUp();
    if (!this.seat) {
      const prevX = this.self.x;
      const prevY = this.self.y;
      const next = stepMovement(this.map, this.self.x, this.self.y, input, dt);
      this.self.x = next.x;
      this.self.y = next.y;
      this.animate(this.self, this.self.x - prevX, this.self.y - prevY, dt);
    }

    const a = 1 - Math.exp(-INTERP_RATE * dt);
    for (const r of this.remotes.values()) {
      const rpx = r.x;
      const rpy = r.y;
      r.x += (r.tx - r.x) * a;
      r.y += (r.ty - r.y) * a;
      if (r.pose === 'stand') this.animate(r, r.x - rpx, r.y - rpy, dt);
    }

    this.updateProximity();
    this.updateButtons();
    this.updateStage();

    this.sinceSend += dt * 1000;
    if (this.sinceSend >= POSITION_TICK_MS) {
      this.sinceSend = 0;
      const { x, y, pose, dir } = this.self;
      if (x !== this.sentX || y !== this.sentY || pose !== this.sentPose || dir !== this.sentDir) {
        this.sentX = x;
        this.sentY = y;
        this.sentPose = pose;
        this.sentDir = dir;
        this.net.send(
          pose === 'stand' ? { type: 'position', x, y } : { type: 'position', x, y, pose, dir },
        );
      }
    }

    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** The canvas shows the whole (zoomed) map when it fits the window, else a window-sized view of it. */
  private readonly fitCanvas = (): void => {
    const canvas = this.ctx.canvas;
    const world = mapPixelSize(this.map);
    const { w, h } = viewportSize({ w: Math.ceil(world.w * this.zoom), h: Math.ceil(world.h * this.zoom) }, { w: innerWidth, h: innerHeight });
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  };

  /** Zoom the map (snapped to a step unless pinching), remembered for next time. */
  private setZoom(z: number): void {
    const next = clampZoom(z);
    if (next === this.zoom) return;
    this.zoom = next;
    try {
      localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // private mode: just don't remember it
    }
    this.fitCanvas();
    this.updateZoomCtl();
  }

  private updateZoomCtl(): void {
    this.zoomCtl.querySelector('span')!.textContent = `${Math.round(this.zoom * 100)}%`;
    const [min, max] = [ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.length - 1]];
    this.zoomCtl.querySelector<HTMLButtonElement>('[data-z="1"]')!.disabled = this.zoom >= max;
    this.zoomCtl.querySelector<HTMLButtonElement>('[data-z="-1"]')!.disabled = this.zoom <= min;
  }

  /** Mouse wheel over the map zooms it (one step per notch). */
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.deltaY !== 0) this.setZoom(stepZoom(this.zoom, e.deltaY < 0 ? 1 : -1));
  };

  /** Ctrl+wheel anywhere would zoom the whole page (and scale the HUD away): zoom the map instead. */
  private readonly onCtrlWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey || e.target === this.ctx.canvas || this.meeting.isOpen) return;
    e.preventDefault();
    if (e.deltaY !== 0) this.setZoom(stepZoom(this.zoom, e.deltaY < 0 ? 1 : -1));
  };

  private readonly onTouch = (e: TouchEvent): void => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = [e.touches[0]!, e.touches[1]!];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (!this.pinch || e.type === 'touchstart') this.pinch = { dist, zoom: this.zoom };
    else if (this.pinch.dist > 0) this.setZoom(this.pinch.zoom * (dist / this.pinch.dist));
  };

  /** End of a pinch: settle on the nearest zoom step (crisp pixels). */
  private readonly onTouchEnd = (e: TouchEvent): void => {
    if (!this.pinch || e.touches.length >= 2) return;
    this.pinch = null;
    const nearest = ZOOM_STEPS.reduce((best, z) => (Math.abs(z - this.zoom) < Math.abs(best - this.zoom) ? z : best));
    this.setZoom(nearest);
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (this.meeting.isOpen) return;
    // Zoom keys, also with Ctrl so the browser doesn't scale the page and the HUD with it.
    if ((e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || (e.ctrlKey && e.key === '0')) && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (e.key === '0') return this.setZoom(1);
      return this.setZoom(stepZoom(this.zoom, e.key === '-' || e.key === '_' ? -1 : 1));
    }
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === 'escape' && this.moving) {
      this.moving = null;
      return;
    }
    if (key === 'e') this.toggleSeat();
    else if (key === 'q') this.toggleDance();
    else if (key === 'f') this.getDrink();
  };

  private worldPoint(e: PointerEvent): { px: number; py: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return screenToWorld(e.clientX - r.left, e.clientY - r.top, this.scale * this.zoom, this.camX, this.camY);
  }

  /** While building, a click edits the tile; otherwise it may open the avatar menu. */
  private readonly onPointerDown = (e: PointerEvent): void => {
    const { px, py } = this.worldPoint(e);
    if (this.panel?.isOpen) return this.buildAt(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
    if (!this.onAvatarClick) return;
    const id = avatarAt(this.remotes, px, py);
    if (id) this.onAvatarClick(id, e.clientX, e.clientY);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.panel?.isOpen) return;
    const { px, py } = this.worldPoint(e);
    this.buildHover = { x: Math.floor(px / TILE_SIZE), y: Math.floor(py / TILE_SIZE) };
  };

  private readonly onPointerLeave = (): void => {
    this.buildHover = null;
  };

  private inMap(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height;
  }

  /** The piece a click at (x, y) would place (or drop, when moving), and its blocking cells on walls (then a no-op). */
  private ghostAt(x: number, y: number): { cells: DecorCell[]; blocked: DecorCell[] } | null {
    let cells: DecorCell[];
    let mode;
    if (this.panel?.tool === 'move') {
      if (!this.moving) return null;
      const { src, dx, dy } = this.moving;
      const ox = x - dx - src.op.x;
      const oy = y - dy - src.op.y;
      const extra = src.kind === 'baked' ? src.extra : [];
      cells = [src.op, ...extra].flatMap((o) => placeCells({ ...o, x: o.x + ox, y: o.y + oy }));
      mode = src.op.mode;
    } else {
      const s = this.panel?.state();
      if (this.panel?.tool !== 'place' || !s?.selection) return null;
      cells = brushCells(x, y, s.selection, s.t, s.mode);
      mode = s.mode;
    }
    const blocked = cells.filter((c) => cellBlocks(c, mode) && this.inMap(c.x, c.y) && blockedByWall(this.map, c.x, c.y));
    return { cells, blocked };
  }

  /** Apply the build tool at tile (x, y); the database decides whether the edit is allowed. */
  private buildAt(x: number, y: number): void {
    const { live, panel } = this;
    if (!live || !panel || !this.inMap(x, y)) return;
    switch (panel.tool) {
      case 'place': {
        const s = panel.state();
        if (!s?.selection) return this.toast('Pick a piece in the Build panel first');
        if (this.ghostAt(x, y)?.blocked.length) return;
        void live.send(placeOp(x, y, s.selection, s.mode, s.t));
        return;
      }
      case 'move': {
        if (!this.moving) {
          const src = live.pickUp(x, y);
          if (typeof src === 'string') return this.toast(src);
          this.moving = { src, dx: x - src.op.x, dy: y - src.op.y };
          return this.toast('Click where it should go (Esc cancels)');
        }
        if (this.ghostAt(x, y)?.blocked.length) return;
        const { src, dx, dy } = this.moving;
        this.moving = null;
        void live.moveTo(src, x - dx, y - dy);
        return;
      }
      case 'erase':
        void live.removeAt(x, y);
        return;
      case 'block':
      case 'walk':
        void live.send({ kind: 'tile', x, y, blocked: panel.tool === 'block' });
        return;
    }
  }

  /** The nearest seat in reach that nobody else is using. */
  private freeSeatNearby(): Seat | undefined {
    return seatsNearIn(this.seats, this.self.x, this.self.y, SEAT_REACH).find(
      (st) =>
        ![...this.remotes.values()].some(
          (r) => (r.pose === 'sit' || r.pose === 'lie') && Math.abs(r.tx - (st.x + 0.5)) < 0.1 && Math.abs(r.ty - (st.y + 0.5)) < 0.1,
        ),
    );
  }

  toggleSeat(): void {
    if (this.self.pose === 'dance') return;
    if (this.seat) return this.standUp();
    const st = this.freeSeatNearby();
    if (!st) return;
    this.seat = { seat: st, standX: this.self.x, standY: this.self.y };
    this.self.x = st.x + 0.5;
    this.self.y = st.y + 0.5;
    this.self.pose = st.kind === 'lie' ? 'lie' : 'sit';
    this.self.dir = st.dir;
    this.self.moving = false;
  }

  /** Start / stop dancing in place; not while seated. */
  toggleDance(): void {
    if (this.seat) return;
    this.self.pose = this.self.pose === 'dance' ? 'stand' : 'dance';
  }

  private standUp(): void {
    if (!this.seat) return;
    this.self.x = this.seat.standX;
    this.self.y = this.seat.standY;
    this.self.pose = 'stand';
    this.seat = null;
  }

  /**
   * Seat button: "Sit (E)" / "Lie down (E)" near a free seat, "Stand up (E)" while seated, hidden
   * otherwise and while dancing. Dance button: "Dance (Q)" / "Stop dancing (Q)", hidden while seated.
   */
  private updateButtons(): void {
    if (this.buildBtn && this.panel) {
      const label = this.panel.isOpen ? 'Done building' : 'Build';
      if (this.buildBtn.textContent !== label) this.buildBtn.textContent = label;
    }
    const dancing = this.self.pose === 'dance';
    const danceLabel = this.seat ? '' : dancing ? 'Stop dancing (Q)' : 'Dance (Q)';
    if (this.danceBtn.textContent !== danceLabel) this.danceBtn.textContent = danceLabel;
    this.danceBtn.className = danceLabel ? '' : 'hidden';

    const near = this.seat || dancing ? null : this.freeSeatNearby();
    const label = this.seat
      ? 'Stand up (E)'
      : near
        ? near.kind === 'lie'
          ? 'Lie down (E)'
          : 'Sit (E)'
        : '';
    if (this.seatBtn.textContent !== label) this.seatBtn.textContent = label;
    this.seatBtn.className = label ? '' : 'hidden';

    const k = this.machineNearby();
    const drinkLabel = k ? (k.item === 'coffee' ? 'Get coffee (F)' : 'Get water (F)') : '';
    if (this.drinkBtn.textContent !== drinkLabel) this.drinkBtn.textContent = drinkLabel;
    this.drinkBtn.className = drinkLabel ? '' : 'hidden';
  }

  /**
   * Show the nearest connected presenter's screen on the stage (their bubble hides meanwhile), or
   * clear it. Cheap enough per frame, and it catches the track arriving after the sharing flag.
   */
  private updateStage(): void {
    const pick = this.presenters().find((p) => {
      const s = this.bubbles.stream(p.id);
      return !!s && hasLiveVideo(s);
    });
    const prev = this.stage.peer;
    if (prev && prev !== pick?.id) this.bubbles.suppress(prev, false);
    if (!pick) return this.stage.clear();
    this.stage.show(pick.id, pick.name, this.bubbles.stream(pick.id)!);
    if (prev !== pick.id) this.bubbles.suppress(pick.id, true);
  }

  /** Update facing + walk-cycle clock from a per-frame movement delta. */
  private animate(a: { dir: Direction; animMs: number; moving: boolean }, dx: number, dy: number, dt: number): void {
    a.moving = Math.hypot(dx, dy) > MOVE_EPS;
    a.dir = directionFromDelta(dx, dy, a.dir);
    a.animMs = a.moving ? a.animMs + dt * 1000 : 0;
  }

  /** Entering / leaving a meeting room: screen sharing allowed only inside; the view closes outside. */
  private updateZone(): void {
    const z = zoneAt(this.map, this.self.x, this.self.y);
    if (zoneKey(z) === zoneKey(this.zone)) return;
    this.zone = z;
    this.media.setScreenAllowed(!!z);
    if (!z) this.meeting.close();
    this.updatePill();
  }

  private updatePill(): void {
    const show = !!this.zone && !this.meeting.isOpen;
    this.meetPill.classList.toggle('hidden', !show);
    if (this.zone) this.meetPill.textContent = `${this.zone.name} · Open meeting view`;
  }

  private sameRoom(r: Avatar): boolean {
    return !!this.zone && zoneKey(zoneAt(this.map, r.x, r.y)) === zoneKey(this.zone);
  }

  /** Everyone in our meeting room for the meeting view, us first. */
  private participants(): Participant[] {
    const me: Participant = {
      id: 'self',
      name: this.self.name,
      appearance: this.self.appearance,
      self: true,
      video: null,
      presenting: this.self.sharing,
      busy: this.self.busy,
    };
    const others = [...this.remotes]
      .filter(([id, r]) => this.prox.get(id) === 'near' && this.sameRoom(r))
      .map(([id, r]): Participant => {
        const stream = this.bubbles.stream(id);
        return {
          id,
          name: r.name,
          appearance: r.appearance,
          self: false,
          video: stream && hasLiveVideo(stream) ? stream : null,
          presenting: r.sharing,
          busy: r.busy,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return [me, ...others];
  }

  /** Step out of the meeting room (the meeting view's red button). */
  private leaveZone(): void {
    const z = this.zone;
    if (!z) return;
    this.standUp();
    const out = stepOutOf(this.map, z, this.self.x, this.self.y);
    if (!out) return this.toast('No way out of this room');
    this.self.x = out.x;
    this.self.y = out.y;
    this.self.pose = 'stand';
    this.updateZone();
  }

  /** Recompute near/far per remote; connect/tear down the mesh on transitions. */
  private updateProximity(): void {
    const mine = zoneKey(this.zone);
    for (const [id, r] of this.remotes) {
      const prev = this.prox.get(id) ?? 'far';
      const next = nextLinkState(prev, distanceTiles(this.self, r), mine, zoneKey(zoneAt(this.map, r.x, r.y)));
      if (next === prev) continue;
      this.prox.set(id, next);
      if (next === 'near') void this.mesh.connect(id);
      else this.mesh.disconnect(id);
      this.onPeersChanged?.();
    }
  }

  /** Keyboard and on-screen pad combined (either one can hold a direction). */
  private moveInput(): MoveInput {
    if (this.meeting.isOpen) return { up: false, down: false, left: false, right: false };
    const k = this.keyboard.input;
    const t = this.touchpad?.input;
    if (!t) return k;
    return { up: k.up || t.up, down: k.down || t.down, left: k.left || t.left, right: k.right || t.right };
  }

  private render(): void {
    const { ctx, map } = this;
    // The canvas is CSS-scaled to fit small screens; bubbles live in CSS pixels.
    const scale = ctx.canvas.clientWidth / ctx.canvas.width || 1;
    // A map bigger than the canvas scrolls to keep our avatar centred (clamped at the edges).
    const world = mapPixelSize(map);
    const focus = this.lookAt ?? tileToScreen(this.self.x, this.self.y);
    // Zoomed, the canvas shows a smaller piece of the world, drawn bigger.
    const z = this.zoom;
    const camX = cameraOffset(focus.px, ctx.canvas.width / z, world.w);
    const camY = cameraOffset(focus.py, ctx.canvas.height / z, world.h);
    this.camX = camX;
    this.camY = camY;
    this.scale = scale;
    this.drawMinimap();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.imageSmoothingEnabled = false;
    // Whole device pixels for the scroll, so tile edges stay crisp at fractional zooms.
    ctx.setTransform(z, 0, 0, z, -Math.round(camX * z), -Math.round(camY * z));
    drawMap(ctx, map);
    drawZones(ctx, map, this.zone, 'area');

    // One y-sorted pass over object-layer furniture + every avatar, drawn back-to-front so
    // near furniture occludes avatars behind it (and avatars occlude furniture behind them).
    type DecorItem = { anchorY: number; isAvatar: false; cell: DecorCell };
    type AvatarItem = { anchorY: number; isAvatar: true; id: PeerId | null; av: Avatar; isSelf: boolean };
    const items: (DecorItem | AvatarItem)[] = [];
    const objects = (map.decor ?? []).filter((d) => decorLayer(map, d) === 'object');
    const anchors = stackedDecorAnchors(objects, (d) => !seatSpot(d.sheet, d.sx, d.sy));
    objects.forEach((d, i) => items.push({ anchorY: anchors[i]!, isAvatar: false, cell: d }));
    for (const [id, r] of this.remotes) {
      items.push({ anchorY: avatarAnchorY(r), isAvatar: true, id, av: r, isSelf: false });
    }
    items.push({ anchorY: avatarAnchorY(this.self), isAvatar: true, id: null, av: this.self, isSelf: true });

    for (const it of sortRenderables(items)) {
      if (!it.isAvatar) {
        drawDecorCellAt(ctx, it.cell);
      } else {
        if (!it.isSelf && it.id !== null && this.prox.get(it.id) === 'near') this.drawRing(it.av.x, it.av.y);
        this.drawCharacter(it.av);
        if (it.av.item) drawHeldItem(ctx, it.av.item, it.av.pose, it.av.dir, it.av.x, it.av.y, Date.now(), it.av.name.length * 977);
        if (it.av.pose === 'sit' && it.av.dir === 'up') this.drawChairBackOver(it.av);
        if (it.av.pose === 'lie' && appearanceReady(it.av.appearance)) this.drawBedOver(it.av);
      }
    }

    this.drawBuildOverlay();

    // Final pass on top of all furniture: name tags, and remote bubble placement + volume.
    const now = Date.now();
    drawZones(ctx, map, this.zone, 'label');
    for (const r of this.remotes.values()) this.drawTags(r, now);
    this.drawTags(this.self, now);
    this.drawBalloons(now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const [id, r] of this.remotes) {
      if (this.prox.get(id) === 'near') {
        // In a meeting room everyone is heard at full volume, wherever they stand.
        this.bubbles.setVolume(id, this.sameRoom(r) ? 1 : volumeForDistance(distanceTiles(this.self, r)));
      }
      const { px, py } = tileToScreen(r.x, r.y);
      this.bubbles.place(id, (px - camX) * scale * z, (py - camY) * scale * z);
    }
  }

  /**
   * Sitting with the back to the viewer, the chair's backrest is nearer than the body: draw the
   * chair cells of the seat tile again over the avatar, so only the back of the head shows.
   * Only seat cells (chairs, sofas…) are redrawn; a desk in the same row stays behind.
   */
  private drawChairBackOver(a: Avatar): void {
    const x = Math.floor(a.x);
    const y = Math.floor(a.y);
    for (const d of this.map.decor ?? []) {
      if (d.x === x && d.y === y && decorLayer(this.map, d) === 'object' && seatSpot(d.sheet, d.sx, d.sy)) {
        drawDecorCellAt(this.ctx, d);
      }
    }
  }

  /**
   * Lying in bed, the body is under the covers: draw the bed's own cells on the tiles toward the
   * feet (the blanket) back over the avatar, so only the head and shoulders on the pillow show.
   * Every decor cell of those tiles is redrawn in map order (floor first), exactly as the map
   * shows them, so nothing else changes.
   */
  private drawBedOver(a: Avatar): void {
    const x = Math.floor(a.x);
    const y = Math.floor(a.y);
    const v = FEET[a.dir];
    const tiles = new Set([1, 2].map((k) => `${x + v.dx * k},${y + v.dy * k}`));
    const cells = (this.map.decor ?? []).filter((d) => tiles.has(`${d.x},${d.y}`));
    for (const layer of ['floor', 'object'] as const) {
      for (const d of cells) if (decorLayer(this.map, d) === layer) drawDecorCellAt(this.ctx, d);
    }
  }

  /** The camera follows our avatar again (after looking around with the minimap). */
  private followSelf(): void {
    this.lookAt = null;
    this.minimap?.setFollowing(true);
  }

  private drawMinimap(): void {
    if (!this.minimap) return;
    const dots: MinimapDot[] = [];
    for (const [id, r] of this.remotes) dots.push({ x: r.x, y: r.y, kind: this.prox.get(id) === 'near' ? 'near' : 'other' });
    dots.push({ x: this.self.x, y: this.self.y, kind: 'self' });
    const { width, height } = this.ctx.canvas;
    this.minimap.draw({ x: this.camX, y: this.camY, w: width / this.zoom, h: height / this.zoom }, dots);
  }

  /** Own edits on their way (ghosts), and while building the piece / tile under the pointer. */
  private drawBuildOverlay(): void {
    const { ctx } = this;
    if (!this.panel?.isOpen) this.moving = null;
    const pending = this.live?.pending ?? [];
    const hover = this.panel?.isOpen ? this.buildHover : null;
    if (this.moving) {
      // Outline where the picked-up piece stands now.
      ctx.strokeStyle = '#4fe0a0';
      ctx.lineWidth = 2;
      const { src } = this.moving;
      for (const c of [src.op, ...(src.kind === 'baked' ? src.extra : [])].flatMap(placeCells)) {
        ctx.strokeRect(c.x * TILE_SIZE + 1, c.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
      }
      ctx.lineWidth = 1;
    }
    const ghost = hover && this.ghostAt(hover.x, hover.y);
    if (pending.length === 0 && !hover) return;
    ctx.save();
    ctx.globalAlpha = 0.6;
    for (const cell of pending) drawDecorCellAt(ctx, cell);
    for (const cell of ghost?.cells ?? []) drawDecorCellAt(ctx, cell);
    ctx.restore();
    ctx.fillStyle = 'rgba(220, 60, 60, 0.45)';
    for (const cell of ghost?.blocked ?? []) ctx.fillRect(cell.x * TILE_SIZE, cell.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    if (hover && !ghost) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(hover.x * TILE_SIZE + 1, hover.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
      ctx.lineWidth = 1;
    }
  }

  /** Draw an avatar as its animated sprite, falling back to the disc until layers load. */
  private drawCharacter(a: Avatar): void {
    const { ctx } = this;
    if (appearanceReady(a.appearance)) {
      drawPosedSprite(ctx, a.appearance, a.pose, a.dir, walkFrameIndex(a.animMs, a.moving), a.x, a.y, Date.now());
    } else {
      drawAvatar(ctx, a.x, a.y, a.color, a === this.self);
    }
  }

  /** Name, status, zzZ and chat bubble above an avatar, drawn in the top pass so furniture can't cover them. */
  private drawTags(a: Avatar, now: number): void {
    drawAvatarTags(this.ctx, a.x, a.y, a.pose, { name: a.name, status: a.status, busy: a.busy, admin: a.admin }, now);
  }

  private drawRing(x: number, y: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = '#4fe0a0';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
