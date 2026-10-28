import { CONNECT_RADIUS } from '@byte_grounds/shared/protocol';
import type { PeerId } from '@byte_grounds/shared/protocol';

export const BUBBLE_W = 120;
export const BUBBLE_H = 90;

/** Map tile distance in [0, CONNECT_RADIUS] to playback gain [1.0 … 0.25]. */
export function volumeForDistance(dist: number): number {
  const t = Math.min(Math.max(dist / CONNECT_RADIUS, 0), 1);
  return 1 - t * 0.75;
}

/**
 * Per-peer remote <video> overlays, positioned over the canvas near each
 * connected peer's avatar. Audio rides in the same (unmuted) element.
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
    const existing = this.bubbles.get(peerId);
    if (existing) {
      existing.srcObject = stream;
      return;
    }
    const v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    v.srcObject = stream;
    v.style.cssText = `position:absolute;width:${BUBBLE_W}px;height:${BUBBLE_H}px;object-fit:cover;border-radius:8px;border:2px solid #4fe0a0;background:#000;`;
    this.layer.appendChild(v);
    this.bubbles.set(peerId, v);
  }

  /** Center the bubble horizontally over (cx) and float it above (cy). */
  place(peerId: PeerId, cx: number, cy: number): void {
    const v = this.bubbles.get(peerId);
    if (!v) return;
    v.style.left = `${cx - BUBBLE_W / 2}px`;
    v.style.top = `${cy - BUBBLE_H - 24}px`;
  }

  /** Set playback volume (0..1) for a peer's bubble; no-op if absent. */
  setVolume(peerId: PeerId, volume: number): void {
    const v = this.bubbles.get(peerId);
    if (v) v.volume = volume;
  }

  remove(peerId: PeerId): void {
    const v = this.bubbles.get(peerId);
    if (!v) return;
    v.srcObject = null;
    v.remove();
    this.bubbles.delete(peerId);
  }
}

/**
 * Owns the single local MediaStream (shared across all peer connections), its
 * muted corner preview, and the mic/cam toggle buttons. Acquisition is lazy:
 * `acquire()` runs getUserMedia once and caches the result (null if denied).
 */
export class MediaManager {
  private stream: MediaStream | null = null;
  private pending: Promise<MediaStream | null> | null = null;
  private readonly preview: HTMLVideoElement;
  private readonly micBtn: HTMLButtonElement;
  private readonly camBtn: HTMLButtonElement;
  private readonly notice: HTMLDivElement;

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
    this.camBtn = this.makeButton('Cam: on', () => this.toggleCam());
    bar.append(this.micBtn, this.camBtn);

    this.notice = document.createElement('div');
    this.notice.style.cssText = 'font-size:12px;color:#ffb4b4;max-width:160px;';

    root.append(this.preview, bar, this.notice);
    document.body.appendChild(root);
    this.setControlsEnabled(false);
  }

  /** Acquire camera+mic once (cached). Resolves null when denied/unavailable. */
  acquire(): Promise<MediaStream | null> {
    if (this.stream) return Promise.resolve(this.stream);
    if (this.pending) return this.pending;
    this.pending = navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((s) => {
        this.stream = s;
        this.preview.srcObject = s;
        this.setControlsEnabled(true);
        this.updatePreviewVisibility();
        return s;
      })
      .catch(() => {
        this.notice.textContent = 'Camera/mic unavailable — you can still move and see others.';
        return null;
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
    this.micBtn.textContent = `Mic: ${this.toggleKind('audio') ? 'on' : 'off'}`;
  }

  toggleCam(): void {
    this.camBtn.textContent = `Cam: ${this.toggleKind('video') ? 'on' : 'off'}`;
    this.updatePreviewVisibility();
  }

  /** Show the corner preview only when a live, enabled video track exists. */
  private updatePreviewVisibility(): void {
    const track = this.stream?.getVideoTracks()[0];
    const on = !!track && track.enabled && track.readyState === 'live';
    this.preview.style.display = on ? '' : 'none';
  }

  /** Flip `enabled` on tracks of a kind; returns the new enabled state. */
  private toggleKind(kind: 'audio' | 'video'): boolean {
    const tracks =
      kind === 'audio' ? this.stream?.getAudioTracks() : this.stream?.getVideoTracks();
    if (!tracks || tracks.length === 0) return true;
    const enabled = !tracks[0].enabled;
    for (const t of tracks) t.enabled = enabled;
    return enabled;
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'flex:1;padding:6px;border:0;border-radius:6px;background:#2a2f37;color:#e6e8eb;cursor:pointer;';
    b.addEventListener('click', onClick);
    return b;
  }

  private setControlsEnabled(on: boolean): void {
    this.micBtn.disabled = !on;
    this.camBtn.disabled = !on;
  }
}
