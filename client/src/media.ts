import { CONNECT_RADIUS } from '@byte_grounds/shared/protocol';
import type { PeerId } from '@byte_grounds/shared/protocol';

export const BUBBLE_W = 120;
export const BUBBLE_H = 90;

/** Map tile distance in [0, CONNECT_RADIUS] to playback gain [1.0 … 0.25]. */
export function volumeForDistance(dist: number): number {
  const t = Math.min(Math.max(dist / CONNECT_RADIUS, 0), 1);
  return 1 - t * 0.75;
}

/** Gap between the avatar's tile point and the bubble, above or below it. */
const BUBBLE_GAP_ABOVE = 64; // clears the name, status and zzZ tags over the head
const BUBBLE_GAP_BELOW = 16;
const EDGE_MARGIN = 4;

/** True while the stream carries a live video track (the peer's camera is on). */
export function hasLiveVideo(stream: MediaStream): boolean {
  return stream.getVideoTracks().some((t) => t.readyState === 'live');
}

/**
 * Bubble top-left in layer coordinates for an avatar at (cx, cy). Floats above the avatar,
 * but drops below it when it would be cut off by the top of the viewport, and is clamped
 * horizontally so it stays on screen. `originX/Y` is the layer's viewport offset.
 */
export function bubblePosition(
  cx: number,
  cy: number,
  originX: number,
  originY: number,
  viewportW: number,
): { left: number; top: number } {
  let top = cy - BUBBLE_H - BUBBLE_GAP_ABOVE;
  if (originY + top < EDGE_MARGIN) top = cy + BUBBLE_GAP_BELOW;
  const minLeft = EDGE_MARGIN - originX;
  const maxLeft = viewportW - BUBBLE_W - EDGE_MARGIN - originX;
  const left = Math.max(minLeft, Math.min(cx - BUBBLE_W / 2, maxLeft));
  return { left, top };
}

/**
 * Per-peer remote <video> overlays, positioned over the canvas near each
 * connected peer's avatar. Audio rides in the same (unmuted) element, which stays
 * mounted (hidden) while the peer's camera is off so their voice keeps playing.
 */
export class VideoBubbles {
  private readonly layer: HTMLDivElement;
  private readonly bubbles = new Map<PeerId, HTMLVideoElement>();
  /** Peers whose video shows elsewhere (the screen-share stage): bubble hidden, audio kept. */
  private readonly suppressed = new Set<PeerId>();

  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    parent.appendChild(this.layer);
  }

  add(peerId: PeerId, stream: MediaStream): void {
    let v = this.bubbles.get(peerId);
    if (!v) {
      v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.style.cssText = `position:absolute;width:${BUBBLE_W}px;height:${BUBBLE_H}px;object-fit:cover;border-radius:8px;border:2px solid #4fe0a0;background:#000;`;
      this.layer.appendChild(v);
      this.bubbles.set(peerId, v);
    }
    if (v.srcObject !== stream) {
      if (v.srcObject instanceof MediaStream) v.srcObject.onaddtrack = v.srcObject.onremovetrack = null;
      v.srcObject = stream;
      // The peer adds/removes its video track when it turns the camera on/off.
      const sync = () => this.sync(peerId);
      stream.onaddtrack = sync;
      stream.onremovetrack = sync;
    }
    this.sync(peerId);
  }

  private sync(peerId: PeerId): void {
    const v = this.bubbles.get(peerId);
    if (!v) return;
    const stream = v.srcObject instanceof MediaStream ? v.srcObject : null;
    v.style.display = stream && hasLiveVideo(stream) && !this.suppressed.has(peerId) ? '' : 'none';
  }

  /** The peer's incoming stream (audio + camera or screen), if connected. */
  stream(peerId: PeerId): MediaStream | null {
    const src = this.bubbles.get(peerId)?.srcObject;
    return src instanceof MediaStream ? src : null;
  }

  /** Hide (or show again) a peer's bubble while its video is shown elsewhere; audio keeps playing. */
  suppress(peerId: PeerId, on: boolean): void {
    if (on) this.suppressed.add(peerId);
    else this.suppressed.delete(peerId);
    this.sync(peerId);
  }

  /** Position the bubble for an avatar at canvas point (cx, cy); see `bubblePosition`. */
  place(peerId: PeerId, cx: number, cy: number): void {
    const v = this.bubbles.get(peerId);
    if (!v || v.style.display === 'none') return;
    const origin = this.layer.getBoundingClientRect();
    const { left, top } = bubblePosition(cx, cy, origin.left, origin.top, window.innerWidth);
    v.style.left = `${left}px`;
    v.style.top = `${top}px`;
  }

  /** Set playback volume (0..1) for a peer's bubble; no-op if absent. */
  setVolume(peerId: PeerId, volume: number): void {
    const v = this.bubbles.get(peerId);
    if (v) v.volume = volume;
  }

  remove(peerId: PeerId): void {
    const v = this.bubbles.get(peerId);
    if (!v) return;
    if (v.srcObject instanceof MediaStream) v.srcObject.onaddtrack = v.srcObject.onremovetrack = null;
    v.srcObject = null;
    v.remove();
    this.bubbles.delete(peerId);
    this.suppressed.delete(peerId);
  }
}

/**
 * The big screen-share view (top centre, like a meeting's presentation): the presenter's stream in
 * a muted element (their voice keeps coming from the bubble's), with Minimize / Show.
 */
export class ScreenStage {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLSpanElement;
  private readonly video: HTMLVideoElement;
  private readonly minBtn: HTMLButtonElement;
  private current: { id: PeerId; stream: MediaStream } | null = null;

  constructor() {
    const root = (this.root = document.createElement('div'));
    root.id = 'screen-stage';
    root.className = 'hidden';
    root.innerHTML = '<div class="stage-head"><span></span><button type="button">Minimize</button></div>';
    this.title = root.querySelector('span')!;
    this.minBtn = root.querySelector('button')!;
    this.minBtn.addEventListener('click', () => {
      const min = root.classList.toggle('min');
      this.minBtn.textContent = min ? 'Show' : 'Minimize';
    });
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    root.appendChild(this.video);
    document.body.appendChild(root);
  }

  /** The peer on stage now, if any. */
  get peer(): PeerId | null {
    return this.current?.id ?? null;
  }

  show(id: PeerId, name: string, stream: MediaStream): void {
    this.title.textContent = `${name} is presenting`;
    if (this.current?.id === id && this.current.stream === stream) return;
    this.current = { id, stream };
    this.video.srcObject = stream;
    this.root.classList.remove('hidden');
  }

  clear(): void {
    if (!this.current) return;
    this.current = null;
    this.video.srcObject = null;
    this.root.classList.add('hidden');
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }
}

/**
 * Owns the single local MediaStream (shared across all peer connections), its
 * muted corner preview, and the mic/cam toggle buttons. The mic is on by default and
 * acquired lazily (`acquire()`, first time someone is near). The camera is off until the
 * user turns it on: only then is it opened, and turning it off stops it (light goes off).
 * `onVideoTrack` tells the mesh to add/remove the video track on every peer connection.
 */
export class MediaManager {
  /** Local stream; exists (maybe empty) once `acquire()` has run, even if the mic was denied. */
  private stream: MediaStream | null = null;
  private pending: Promise<MediaStream> | null = null;
  private micOn = true;
  private camBusy = false;
  /** The screen being shared; while set it is the outgoing video instead of the camera. */
  private screen: MediaStreamTrack | null = null;
  private readonly preview: HTMLVideoElement;
  private readonly micBtn: HTMLButtonElement;
  private readonly camBtn: HTMLButtonElement;
  private readonly screenBtn: HTMLButtonElement;
  private readonly notice: HTMLDivElement;

  /** The outgoing video changed (camera, screen, or none): the mesh sends it to every peer. */
  onVideoTrack: (track: MediaStreamTrack | null, stream: MediaStream) => void = () => {};
  /** Screen sharing started / stopped. */
  onSharing: (on: boolean) => void = () => {};
  /** Mic, camera or screen state changed (the meeting view's buttons follow it). */
  onChange: () => void = () => {};
  /** Screen sharing is only offered inside a meeting room (`setScreenAllowed`). */
  private screenAllowed = false;
  /** One-track streams for previews, cached per track (a new MediaStream would restart playback). */
  private readonly solo = new WeakMap<MediaStreamTrack, MediaStream>();

  constructor() {
    const root = document.createElement('div');
    root.id = 'media';
    root.style.cssText =
      'position:fixed;left:12px;bottom:12px;display:flex;flex-direction:column;gap:6px;z-index:10;';

    this.preview = document.createElement('video');
    this.preview.muted = true;
    this.preview.autoplay = true;
    this.preview.playsInline = true;
    this.preview.style.cssText =
      'width:160px;height:120px;background:#000;border-radius:8px;object-fit:cover;transform:scaleX(-1);';
    this.preview.style.display = 'none';

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;';
    this.micBtn = this.makeButton('Mic: on', () => this.toggleMic());
    this.camBtn = this.makeButton('Cam: off', () => void this.toggleCam());
    this.screenBtn = this.makeButton('Share screen', () => void this.toggleScreen());
    bar.append(this.micBtn, this.camBtn, this.screenBtn);
    this.screenBtn.style.display = 'none';

    this.notice = document.createElement('div');
    this.notice.style.cssText = 'font-size:12px;color:#ffb4b4;max-width:160px;';

    root.append(this.preview, bar, this.notice);
    document.body.appendChild(root);
  }

  /** Acquire the mic once (cached). Always resolves a stream; it has no audio if denied. */
  acquire(): Promise<MediaStream> {
    if (this.stream) return Promise.resolve(this.stream);
    if (this.pending) return this.pending;
    this.pending = navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        for (const t of s.getAudioTracks()) t.enabled = this.micOn;
        return s;
      })
      .catch(() => {
        this.notice.textContent = 'Mic unavailable — you can still move, see and hear others.';
        return new MediaStream();
      })
      .then((s) => {
        this.stream = s;
        this.preview.srcObject = s;
        return s;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  get localStream(): MediaStream | null {
    return this.stream;
  }

  toggleMic(): void {
    this.micOn = !this.micOn;
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = this.micOn;
    this.micBtn.textContent = `Mic: ${this.micOn ? 'on' : 'off'}`;
    this.onChange();
  }

  get sharing(): boolean {
    return this.screen !== null;
  }

  get micEnabled(): boolean {
    return this.micOn;
  }

  get camEnabled(): boolean {
    return !!this.stream?.getVideoTracks().length;
  }

  /** Phones can't capture the screen (no getDisplayMedia). */
  get canShareScreen(): boolean {
    return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  }

  /** Our camera alone (for a self view), or null while it is off. */
  get cameraStream(): MediaStream | null {
    return this.soloStream(this.stream?.getVideoTracks()[0] ?? null);
  }

  /** The screen we share (for a preview), or null. */
  get screenStream(): MediaStream | null {
    return this.soloStream(this.screen);
  }

  private soloStream(track: MediaStreamTrack | null): MediaStream | null {
    if (!track) return null;
    let s = this.solo.get(track);
    if (!s) this.solo.set(track, (s = new MediaStream([track])));
    return s;
  }

  /** Offer the Share screen button (inside a meeting room); taking it away stops a share. */
  setScreenAllowed(on: boolean): void {
    this.screenAllowed = on;
    if (!on) this.stopScreen();
    this.screenBtn.style.display = on && this.canShareScreen ? '' : 'none';
  }

  async toggleCam(): Promise<void> {
    if (this.camBusy) return;
    this.camBusy = true;
    try {
      const stream = await this.acquire();
      const current = stream.getVideoTracks()[0];
      if (current) {
        current.stop();
        stream.removeTrack(current);
        if (!this.screen) this.onVideoTrack(null, stream);
      } else {
        try {
          const cam = await navigator.mediaDevices.getUserMedia({ video: true });
          const track = cam.getVideoTracks()[0]!;
          stream.addTrack(track);
          if (!this.screen) {
            this.notice.textContent = '';
            this.onVideoTrack(track, stream);
          }
        } catch {
          this.notice.textContent = 'Camera unavailable or blocked.';
        }
      }
    } finally {
      this.camBusy = false;
      const on = !!this.stream?.getVideoTracks().length;
      this.camBtn.textContent = `Cam: ${on ? 'on' : 'off'}`;
      this.preview.style.display = on ? '' : 'none';
      this.onChange();
    }
  }

  /**
   * Share a screen / window / tab, or stop. While sharing, peers get the screen in place of the
   * camera (same video sender); stopping puts the camera back if it is on. The browser's own
   * "Stop sharing" ends it too.
   */
  async toggleScreen(): Promise<void> {
    if (this.screen) return this.stopScreen();
    if (!this.screenAllowed || !this.canShareScreen) return;
    const stream = await this.acquire();
    let track: MediaStreamTrack;
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      track = display.getVideoTracks()[0]!;
    } catch {
      return; // picker cancelled or blocked
    }
    if (this.screen || !this.screenAllowed) {
      track.stop(); // a second click raced the picker, or we left the room meanwhile
      return;
    }
    track.contentHint = 'detail';
    this.screen = track;
    track.addEventListener('ended', () => {
      if (this.screen === track) this.stopScreen();
    });
    this.onVideoTrack(track, stream);
    this.updateScreenUi();
    this.onSharing(true);
    this.onChange();
  }

  stopScreen(): void {
    const track = this.screen;
    if (!track) return;
    this.screen = null;
    track.stop();
    if (this.stream) this.onVideoTrack(this.stream.getVideoTracks()[0] ?? null, this.stream);
    this.updateScreenUi();
    this.onSharing(false);
    this.onChange();
  }

  private updateScreenUi(): void {
    const on = !!this.screen;
    this.screenBtn.textContent = on ? 'Stop sharing' : 'Share screen';
    this.screenBtn.style.background = on ? '#c0392b' : '#2a2f37';
    this.notice.textContent = on ? 'Sharing your screen with the meeting room.' : '';
    this.notice.style.color = on ? '#9fd0ff' : '#ffb4b4';
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'flex:1;padding:6px 8px;border:0;border-radius:6px;background:#2a2f37;color:#e6e8eb;cursor:pointer;white-space:nowrap;';
    b.addEventListener('click', onClick);
    return b;
  }
}
