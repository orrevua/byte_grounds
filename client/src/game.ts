import { decorLayer, seatsNearIn, type DecorCell, type OfficeMap, type Seat } from '@byte_grounds/shared/map';
import { POSITION_TICK_MS, TILE_SIZE, normalizePose } from '@byte_grounds/shared/protocol';
import { effectiveSeats, seatSpot } from '@byte_grounds/shared/seats';
import type { Appearance, PeerId, PeerState, Pose, ServerToClient } from '@byte_grounds/shared/protocol';
import { drawAvatar, drawDecorCellAt, drawMap, drawNameLabel, drawPosedSprite, mapPixelSize, tileToScreen } from './render.ts';
import { avatarAnchorY, sortRenderables, stackedDecorAnchors } from './depth.ts';
import { cameraOffset, viewportSize } from './camera.ts';
import { Keyboard, TouchPad, isTouchDevice } from './input.ts';
import { stepMovement, type MoveInput } from './movement.ts';
import { distanceTiles, nextProxState, type ProxState } from './proximity.ts';
import { MediaManager, VideoBubbles, volumeForDistance } from './media.ts';
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
}

interface RemoteAvatar extends Avatar {
  tx: number; // latest target from the server
  ty: number;
  uid?: string;
}

/** How close (tiles, to the seat's center) you must be to sit/lie on it. */
const SEAT_REACH = 1.6;

/** Exponential smoothing rate for remote interpolation (~matches the 12 Hz stream). */
const INTERP_RATE = 12;

/** Movement below this per-frame delta (tiles) counts as idle (standing frame). */
const MOVE_EPS = 1e-3;

/** How long a toast (e.g. a refused edit) stays up. */
const TOAST_MS = 4000;

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
  private sentPose: Pose = 'stand';
  private sentDir: Direction = 'down';
  private readonly remotes = new Map<PeerId, RemoteAvatar>();
  private readonly prox = new Map<PeerId, ProxState>();
  private readonly media = new MediaManager();
  private readonly bubbles: VideoBubbles;
  private readonly mesh: WebrtcMesh;
  private raf = 0;
  private lastT = 0;
  private sinceSend = 0;
  private sentX = NaN;
  private sentY = NaN;
  /** The last frame's view: camera offset (world px) and CSS scale, for mapping clicks. */
  private camX = 0;
  private camY = 0;
  private scale = 1;
  /** Called when a remote avatar is clicked (client coords of the click). */
  onAvatarClick: ((id: PeerId, clientX: number, clientY: number) => void) | null = null;

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
    addEventListener('keydown', this.onKey);
    addEventListener('resize', this.fitCanvas);
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
  }

  /** Our current tile-space position (for saving where we left off); the stand spot while seated. */
  get position(): { x: number; y: number } {
    return this.seat ? { x: this.seat.standX, y: this.seat.standY } : { x: this.self.x, y: this.self.y };
  }

  /** Recompute the usable seats after the map's decor/seats/noSeats change; stand up if ours is gone. */
  refreshSeats(): void {
    this.seats = effectiveSeats(this.map);
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
    this.live?.stop();
    this.mesh.closeAll();
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

  private toast(msg: string): void {
    const el = (this.toastEl ??= document.body.appendChild(document.createElement('div')));
    el.id = 'toast';
    el.textContent = msg;
    el.classList.remove('hidden');
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
      case 'peer-left':
        this.remotes.delete(msg.id);
        this.prox.delete(msg.id);
        this.mesh.disconnect(msg.id);
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
    if (moveHeld && this.self.pose === 'dance') this.self.pose = 'stand';
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

  /** The canvas shows the whole map when it fits the window, else a window-sized view of it. */
  private readonly fitCanvas = (): void => {
    const canvas = this.ctx.canvas;
    const { w, h } = viewportSize(mapPixelSize(this.map), { w: innerWidth, h: innerHeight });
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    const key = e.key.toLowerCase();
    if (key === 'escape' && this.moving) {
      this.moving = null;
      return;
    }
    if (key === 'e') this.toggleSeat();
    else if (key === 'q') this.toggleDance();
  };

  private worldPoint(e: PointerEvent): { px: number; py: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return screenToWorld(e.clientX - r.left, e.clientY - r.top, this.scale, this.camX, this.camY);
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
  }

  /** Update facing + walk-cycle clock from a per-frame movement delta. */
  private animate(a: { dir: Direction; animMs: number; moving: boolean }, dx: number, dy: number, dt: number): void {
    a.moving = Math.hypot(dx, dy) > MOVE_EPS;
    a.dir = directionFromDelta(dx, dy, a.dir);
    a.animMs = a.moving ? a.animMs + dt * 1000 : 0;
  }

  /** Recompute near/far per remote; connect/tear down the mesh on transitions. */
  private updateProximity(): void {
    for (const [id, r] of this.remotes) {
      const prev = this.prox.get(id) ?? 'far';
      const next = nextProxState(prev, distanceTiles(this.self, r));
      if (next === prev) continue;
      this.prox.set(id, next);
      if (next === 'near') void this.mesh.connect(id);
      else this.mesh.disconnect(id);
    }
  }

  /** Keyboard and on-screen pad combined (either one can hold a direction). */
  private moveInput(): MoveInput {
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
    const focus = tileToScreen(this.self.x, this.self.y);
    const camX = cameraOffset(focus.px, ctx.canvas.width, world.w);
    const camY = cameraOffset(focus.py, ctx.canvas.height, world.h);
    this.camX = camX;
    this.camY = camY;
    this.scale = scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(1, 0, 0, 1, -camX, -camY);
    drawMap(ctx, map);

    // One y-sorted pass over object-layer furniture + every avatar, drawn back-to-front so
    // near furniture occludes avatars behind it (and avatars occlude furniture behind them).
    type DecorItem = { anchorY: number; isAvatar: false; cell: DecorCell };
    type AvatarItem = { anchorY: number; isAvatar: true; id: PeerId | null; av: Avatar; isSelf: boolean };
    const items: (DecorItem | AvatarItem)[] = [];
    const objects = (map.decor ?? []).filter((d) => decorLayer(map, d) === 'object');
    const anchors = stackedDecorAnchors(objects);
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
        if (it.av.pose === 'sit' && it.av.dir === 'up') this.drawChairBackOver(it.av);
      }
    }

    this.drawBuildOverlay();

    // Final pass on top of all furniture: name labels, and remote bubble placement + volume.
    for (const r of this.remotes.values()) this.drawName(r);
    this.drawName(this.self);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const [id, r] of this.remotes) {
      if (this.prox.get(id) === 'near') this.bubbles.setVolume(id, volumeForDistance(distanceTiles(this.self, r)));
      const { px, py } = tileToScreen(r.x, r.y);
      this.bubbles.place(id, (px - camX) * scale, (py - camY) * scale);
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

  /** Name label above an avatar (sprite or disc), drawn in the top pass so furniture can't cover it. */
  private drawName(a: Avatar): void {
    drawNameLabel(this.ctx, a.x, a.y, a.name);
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
