/**
 * Voice activity: how loud each person is right now, and whether they are speaking. Measured
 * locally with Web Audio on our mic and on every incoming stream (never sent over the network).
 * The analysers are not connected to the speakers, so nothing plays twice. A muted track carries
 * silence, so a muted person never shows as speaking.
 */

/** RMS above this starts speaking; below `SPEAK_OFF` (after `HOLD_MS`) it stops. */
export const SPEAK_ON = 0.03;
export const SPEAK_OFF = 0.018;
/** Keep "speaking" through the short pauses between words. */
export const HOLD_MS = 350;
/** RMS mapped to level 0..1: the noise floor, and loud speech. */
const FLOOR = 0.01;
const LOUD = 0.16;
/** Level smoothing time constants: rise fast, fall slowly. */
const ATTACK_MS = 40;
const RELEASE_MS = 220;

/** Root mean square of time-domain samples in [-1, 1]. */
export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const v of samples) sum += v * v;
  return Math.sqrt(sum / samples.length);
}

/** RMS → 0..1 display level (0 at the noise floor, 1 for loud speech). */
export function levelFromRms(rms: number): number {
  return Math.min(1, Math.max(0, (rms - FLOOR) / (LOUD - FLOOR)));
}

/** One smoothing step from `prev` toward `target` over `dtMs` (attack up, release down). */
export function smoothLevel(prev: number, target: number, dtMs: number): number {
  const tau = target > prev ? ATTACK_MS : RELEASE_MS;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  return prev + (target - prev) * k;
}

export interface SpeakState {
  speaking: boolean;
  /** Last time (ms) the voice was above `SPEAK_OFF`. */
  lastLoud: number;
}

/** Hysteresis + hold: starts above `SPEAK_ON`, stops after `HOLD_MS` below `SPEAK_OFF`. */
export function nextSpeaking(prev: SpeakState, rms: number, nowMs: number): SpeakState {
  const lastLoud = rms >= SPEAK_OFF ? nowMs : prev.lastLoud;
  if (!prev.speaking) return { speaking: rms >= SPEAK_ON, lastLoud };
  return { speaking: nowMs - lastLoud < HOLD_MS, lastLoud };
}

interface Meter extends SpeakState {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  buf: Float32Array<ArrayBuffer>;
  level: number;
  /** Retry hooking up when the stream gains its audio track later. */
  onAdd: () => void;
}

export class VoiceMeter {
  private ctx: AudioContext | null = null;
  private readonly meters = new Map<string, Meter>();
  private last = 0;

  /** Start (or re-point) the meter for `id` on `stream`. */
  track(id: string, stream: MediaStream): void {
    const cur = this.meters.get(id);
    if (cur?.stream === stream) return this.connect(cur);
    if (cur) this.untrack(id);
    const m: Meter = {
      stream,
      source: null,
      analyser: null,
      buf: new Float32Array(512),
      level: 0,
      speaking: false,
      lastLoud: 0,
      onAdd: () => this.connect(m),
    };
    stream.addEventListener('addtrack', m.onAdd);
    this.meters.set(id, m);
    this.connect(m);
  }

  untrack(id: string): void {
    const m = this.meters.get(id);
    if (!m) return;
    m.stream.removeEventListener('addtrack', m.onAdd);
    m.source?.disconnect();
    this.meters.delete(id);
  }

  /** Sample every meter; call once per animation frame. */
  update(nowMs: number): void {
    const dt = this.last ? nowMs - this.last : 16;
    this.last = nowMs;
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {});
    for (const m of this.meters.values()) {
      let rms = 0;
      if (m.analyser) {
        m.analyser.getFloatTimeDomainData(m.buf);
        rms = rmsLevel(m.buf);
      }
      m.level = smoothLevel(m.level, levelFromRms(rms), dt);
      const s = nextSpeaking(m, rms, nowMs);
      m.speaking = s.speaking;
      m.lastLoud = s.lastLoud;
    }
  }

  /** 0..1 voice level (smoothed). */
  level(id: string): number {
    return this.meters.get(id)?.level ?? 0;
  }

  speaking(id: string): boolean {
    return this.meters.get(id)?.speaking ?? false;
  }

  dispose(): void {
    for (const id of [...this.meters.keys()]) this.untrack(id);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /** Hook the analyser up once the stream has an audio track (Web Audio throws without one). */
  private connect(m: Meter): void {
    if (m.source || m.stream.getAudioTracks().length === 0) return;
    try {
      this.ctx ??= new AudioContext();
      m.source = this.ctx.createMediaStreamSource(m.stream);
      m.analyser = this.ctx.createAnalyser();
      m.analyser.fftSize = m.buf.length;
      m.source.connect(m.analyser);
    } catch (err) {
      console.warn('[voice] meter unavailable:', err);
    }
  }
}
