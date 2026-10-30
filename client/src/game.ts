import { decorLayer, seatsNearIn, type DecorCell, type OfficeMap, type Seat } from '@byte_grounds/shared/map';
import { POSITION_TICK_MS, TILE_SIZE, normalizePose } from '@byte_grounds/shared/protocol';
import { effectiveSeats } from '@byte_grounds/shared/seats';
import type { Appearance, PeerId, PeerState, Pose, ServerToClient } from '@byte_grounds/shared/protocol';
import { drawAvatar, drawDecorCellAt, drawMap, drawNameLabel, drawPosedSprite, mapPixelSize, tileToScreen } from './render.ts';
import { avatarAnchorY, decorAnchorY, sortRenderables } from './depth.ts';
import { cameraOffset, viewportSize } from './camera.ts';
import { Keyboard, TouchPad, isTouchDevice } from './input.ts';
import { stepMovement, type MoveInput } from './movement.ts';
import { distanceTiles, nextProxState, type ProxState } from './proximity.ts';
import { MediaManager, VideoBubbles, volumeForDistance } from './media.ts';
import { WebrtcMesh } from './webrtc.ts';
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
}

/** How close (tiles, to the seat's center) you must be to sit/lie on it. */
const SEAT_REACH = 1.6;

/** Exponential smoothing rate for remote interpolation (~matches the 12 Hz stream). */
const INTERP_RATE = 12;

/** Movement below this per-frame delta (tiles) counts as idle (standing frame). */
const MOVE_EPS = 1e-3;

/** Canvas render loop, local movement, position broadcast, and remote avatars. */
export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly keyboard = new Keyboard();
  private readonly touchpad = isTouchDevice() ? new TouchPad() : null;
  private readonly self: Avatar;
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
    this.seatBtn.remove();
    this.danceBtn.remove();
    this.mesh.closeAll();
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
    if (key === 'e') this.toggleSeat();
    else if (key === 'q') this.toggleDance();
  };

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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(1, 0, 0, 1, -camX, -camY);
    drawMap(ctx, map);

    // One y-sorted pass over object-layer furniture + every avatar, drawn back-to-front so
    // near furniture occludes avatars behind it (and avatars occlude furniture behind them).
    type DecorItem = { anchorY: number; isAvatar: false; cell: DecorCell };
    type AvatarItem = { anchorY: number; isAvatar: true; id: PeerId | null; av: Avatar; isSelf: boolean };
    const items: (DecorItem | AvatarItem)[] = [];
    for (const d of map.decor ?? []) {
      if (decorLayer(map, d) === 'object') items.push({ anchorY: decorAnchorY(d), isAvatar: false, cell: d });
    }
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
      }
    }

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
