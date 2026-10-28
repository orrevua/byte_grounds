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
const BUBBLE_GAP_ABOVE = 24;
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
      const sync = () => (v.style.display = hasLiveVideo(stream) ? '' : 'none');
      stream.onaddtrack = sync;
      stream.onremovetrack = sync;
    }
    v.style.display = hasLiveVideo(stream) ? '' : 'none';
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
  private readonly preview: HTMLVideoElement;
  private readonly micBtn: HTMLButtonElement;
  private readonly camBtn: HTMLButtonElement;
  private readonly notice: HTMLDivElement;

  onVideoTrack: (track: MediaStreamTrack | null, stream: MediaStream) => void = () => {};

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
    bar.append(this.micBtn, this.camBtn);

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
        this.onVideoTrack(null, stream);
      } else {
        try {
          const cam = await navigator.mediaDevices.getUserMedia({ video: true });
          const track = cam.getVideoTracks()[0]!;
          stream.addTrack(track);
          this.notice.textContent = '';
          this.onVideoTrack(track, stream);
        } catch {
          this.notice.textContent = 'Camera unavailable or blocked.';
        }
      }
    } finally {
      this.camBusy = false;
      const on = !!this.stream?.getVideoTracks().length;
      this.camBtn.textContent = `Cam: ${on ? 'on' : 'off'}`;
      this.preview.style.display = on ? '' : 'none';
    }
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'flex:1;padding:6px;border:0;border-radius:6px;background:#2a2f37;color:#e6e8eb;cursor:pointer;';
    b.addEventListener('click', onClick);
    return b;
  }
}
