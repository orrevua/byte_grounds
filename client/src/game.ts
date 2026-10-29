import { seatsNear, type OfficeMap, type Seat } from '@byte_grounds/shared/map';
import { POSITION_TICK_MS, TILE_SIZE } from '@byte_grounds/shared/protocol';
import type { Appearance, PeerId, PeerState, Pose, ServerToClient } from '@byte_grounds/shared/protocol';
import { drawAvatar, drawMap, drawNameLabel, drawPosedSprite, mapPixelSize, tileToScreen } from './render.ts';
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

interface RemoteAvatar {
  name: string;
  color: string;
  appearance: Appearance;
  x: number; // rendered (interpolated) position
  y: number;
  tx: number; // latest target from the server
  ty: number;
  dir: Direction;
  animMs: number;
  moving: boolean;
  pose: Pose;
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
  private readonly self: {
    name: string;
    color: string;
    appearance: Appearance;
    x: number;
    y: number;
    dir: Direction;
    animMs: number;
    moving: boolean;
    pose: Pose;
  };
  /** The seat we're on, and where we stood before, to step back there when getting up. */
  private seat: { seat: Seat; standX: number; standY: number } | null = null;
  private readonly seatBtn: HTMLButtonElement;
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

    const { w, h } = mapPixelSize(this.map);
    canvas.width = w;
    canvas.height = h;

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
    addEventListener('keydown', this.onKey);

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

  /** Our current tile-space position (for saving where we left off). */
  get position(): { x: number; y: number } {
    return { x: this.self.x, y: this.self.y };
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
    this.seatBtn.remove();
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
      pose: p.pose ?? 'stand',
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
          const pose = msg.pose ?? 'stand';
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
    if (this.seat && (input.up || input.down || input.left || input.right)) this.standUp();
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
    this.updateSeatButton();

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

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() !== 'e' || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.toggleSeat();
  };

  /** The nearest seat in reach that nobody else is using. */
  private freeSeatNearby(): Seat | undefined {
    return seatsNear(this.map, this.self.x, this.self.y, SEAT_REACH).find(
      (st) =>
        ![...this.remotes.values()].some(
          (r) => r.pose !== 'stand' && Math.abs(r.tx - (st.x + 0.5)) < 0.1 && Math.abs(r.ty - (st.y + 0.5)) < 0.1,
        ),
    );
  }

  toggleSeat(): void {
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

  private standUp(): void {
    if (!this.seat) return;
    this.self.x = this.seat.standX;
    this.self.y = this.seat.standY;
    this.self.pose = 'stand';
    this.seat = null;
  }

  /** "Sit (E)" / "Lie down (E)" near a free seat, "Stand up (E)" while seated, else hidden. */
  private updateSeatButton(): void {
    const near = this.seat ? null : this.freeSeatNearby();
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
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    drawMap(ctx, map);
    for (const [id, r] of this.remotes) {
      if (this.prox.get(id) === 'near') {
        this.drawRing(r.x, r.y);
        this.bubbles.setVolume(id, volumeForDistance(distanceTiles(this.self, r)));
      }
      this.drawCharacter(r.appearance, r.pose, r.dir, r.animMs, r.moving, r.x, r.y, r.color, r.name, false);
      const { px, py } = tileToScreen(r.x, r.y);
      this.bubbles.place(id, px * scale, py * scale);
    }
    const s = this.self;
    this.drawCharacter(s.appearance, s.pose, s.dir, s.animMs, s.moving, s.x, s.y, s.color, s.name, true);
  }

  /** Draw an avatar as its animated sprite, falling back to the disc until layers load. */
  private drawCharacter(
    appearance: Appearance,
    pose: Pose,
    dir: Direction,
    animMs: number,
    moving: boolean,
    x: number,
    y: number,
    color: string,
    name: string,
    isSelf: boolean,
  ): void {
    const { ctx } = this;
    if (appearanceReady(appearance)) {
      drawPosedSprite(ctx, appearance, pose, dir, walkFrameIndex(animMs, moving), x, y);
      drawNameLabel(ctx, x, y, name);
    } else {
      drawAvatar(ctx, x, y, color, name, isSelf);
    }
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
