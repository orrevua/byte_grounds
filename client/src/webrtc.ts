import { STUN_URLS } from '@byte_grounds/shared/protocol';
import type {
  PeerId,
  RelayAnswerMsg,
  RelayIceMsg,
  RelayOfferMsg,
} from '@byte_grounds/shared/protocol';
import type { Net } from './net.ts';

/** Perfect-negotiation politeness: the lexicographically smaller id is polite. */
export function isPolite(selfId: PeerId, otherId: PeerId): boolean {
  return selfId < otherId;
}

export interface PeerCallbacks {
  sendOffer(sdp: RTCSessionDescriptionInit): void;
  sendAnswer(sdp: RTCSessionDescriptionInit): void;
  sendIce(candidate: RTCIceCandidateInit): void;
  onTrack(stream: MediaStream): void;
  /** The connection failed for good (e.g. the other side's end is gone). */
  onFailed(): void;
}

/** A short random id for one RTCPeerConnection (its "call"). */
function newCallId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * One peer connection. The constructor builds the RTCPeerConnection (STUN),
 * adds local tracks, and forwards ICE/track events. Negotiation (offer/answer
 * glare handling) is added in the perfect-negotiation unit.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly polite: boolean;
  /** Our call id, stamped on everything we send for this connection. */
  readonly sid = newCallId();
  /** The other side's call id, learned from its first message. */
  remoteSid: string | null = null;
  private makingOffer = false;
  private ignoreOffer = false;
  private videoSender: RTCRtpSender | null = null;

  constructor(
    readonly selfId: PeerId,
    readonly peerId: PeerId,
    localStream: MediaStream | null,
    protected readonly cb: PeerCallbacks,
    /** The outgoing video (camera or screen); defaults to the local stream's camera track. */
    video: MediaStreamTrack | null = localStream?.getVideoTracks()[0] ?? null,
  ) {
    this.polite = isPolite(selfId, peerId);
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URLS }] });

    if (localStream) {
      for (const t of localStream.getAudioTracks()) this.pc.addTrack(t, localStream);
      if (video) this.setVideo(video, localStream);
    }

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) cb.sendIce(candidate.toJSON());
    };
    this.pc.ontrack = ({ streams }) => {
      if (streams[0]) cb.onTrack(streams[0]);
    };
    // 'disconnected' usually heals by itself; 'failed' doesn't (often the other side's end
    // is gone after a long drop), so the mesh replaces this connection with a fresh call.
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') cb.onFailed();
    };
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) cb.sendOffer(this.pc.localDescription.toJSON());
      } catch (err) {
        console.error('negotiation failed', err);
      } finally {
        this.makingOffer = false;
      }
    };
  }

  /**
   * Start/stop sending our camera. Adding the track or flipping the transceiver direction
   * renegotiates (perfect negotiation via onnegotiationneeded), and the remote stream gets
   * addtrack/removetrack, which is what shows/hides their bubble.
   */
  setVideo(track: MediaStreamTrack | null, stream: MediaStream): void {
    if (this.pc.signalingState === 'closed') return;
    const transceiver = this.pc.getTransceivers().find((t) => t.sender === this.videoSender);
    if (!transceiver) {
      if (track) this.videoSender = this.pc.addTrack(track, stream);
      return;
    }
    // Reuse the same transceiver on every toggle so m-lines don't pile up.
    void transceiver.sender.replaceTrack(track);
    transceiver.direction = track ? 'sendrecv' : 'recvonly';
  }

  /** Handle a relayed offer or answer with glare-safe collision rules. */
  async onDescription(sdp: RTCSessionDescriptionInit): Promise<void> {
    const collision =
      sdp.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
    this.ignoreOffer = !this.polite && collision;
    if (this.ignoreOffer) return;

    await this.pc.setRemoteDescription(sdp);
    if (sdp.type === 'offer') {
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) this.cb.sendAnswer(this.pc.localDescription.toJSON());
    }
  }

  async onIce(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!this.ignoreOffer) throw err;
    }
  }

  close(): void {
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }
}

type SignalMsg = RelayOfferMsg | RelayAnswerMsg | RelayIceMsg;

/**
 * The WebRTC mesh: one PeerLink per connected peer, driven by proximity
 * (`connect`/`disconnect`) and relayed signaling (`handleSignal`).
 */
export class WebrtcMesh {
  private readonly links = new Map<PeerId, PeerLink>();
  private readonly connecting = new Map<PeerId, Promise<PeerLink>>();
  /** Per-peer signal queue: an ICE candidate must not race ahead of its offer. */
  private readonly queues = new Map<PeerId, Promise<void>>();
  /** What we send as video now (camera or screen), so links made later start with it. */
  private video: MediaStreamTrack | null = null;

  constructor(
    private selfId: PeerId,
    private readonly net: Net,
    private readonly getStream: () => Promise<MediaStream | null>,
    private readonly onTrack: (peerId: PeerId, stream: MediaStream) => void,
    private readonly onClosed: (peerId: PeerId) => void,
  ) {}

  /** Adopt a new local id after a reconnect (affects politeness of new links). */
  setSelfId(selfId: PeerId): void {
    this.selfId = selfId;
  }

  connect(peerId: PeerId): Promise<PeerLink> {
    const existing = this.links.get(peerId);
    if (existing) return Promise.resolve(existing);
    const inflight = this.connecting.get(peerId);
    if (inflight) return inflight;
    const p = this.create(peerId);
    this.connecting.set(peerId, p);
    return p;
  }

  disconnect(peerId: PeerId): void {
    this.connecting.delete(peerId);
    const link = this.links.get(peerId);
    if (!link) return;
    link.close();
    this.links.delete(peerId);
    this.onClosed(peerId);
  }

  /** Signals from one peer are applied strictly in arrival order. */
  handleSignal(msg: SignalMsg): Promise<void> {
    const prev = this.queues.get(msg.from) ?? Promise.resolve();
    const next = prev
      .then(() => this.applySignal(msg))
      .catch((err) => console.error('signal failed', err));
    this.queues.set(msg.from, next);
    return next;
  }

  private async applySignal(msg: SignalMsg): Promise<void> {
    let link = this.links.get(msg.from) ?? (await this.connecting.get(msg.from));
    if (link && msg.sid && link.remoteSid && link.remoteSid !== msg.sid) {
      // The other side started a fresh call (it reconnected, or its old one failed).
      // Ours is talking to a connection that no longer exists: replace it.
      if (msg.type !== 'offer') return; // leftovers from the old call
      this.disconnect(msg.from);
      link = undefined;
    }
    if (msg.type === 'offer') link = await this.connect(msg.from);
    if (!link) return; // answer/ice with no local link: nothing to apply
    if (msg.sid && !link.remoteSid) link.remoteSid = msg.sid;
    if (msg.type === 'ice-candidate') await link.onIce(msg.candidate);
    else await link.onDescription(msg.sdp);
  }

  /** Replace a failed connection with a fresh call (the other side follows via the new id). */
  private restart(peerId: PeerId, failed: PeerLink): void {
    if (this.links.get(peerId) !== failed) return;
    this.disconnect(peerId);
    void this.connect(peerId);
  }

  /** Apply the outgoing video (camera, screen, or none) to every open peer connection. */
  setVideo(track: MediaStreamTrack | null, stream: MediaStream): void {
    this.video = track;
    for (const link of this.links.values()) link.setVideo(track, stream);
  }

  closeAll(): void {
    for (const id of [...this.links.keys()]) this.disconnect(id);
  }

  private async create(peerId: PeerId): Promise<PeerLink> {
    const stream = await this.getStream();
    // Callbacks only fire from later events, by which time `link` is assigned.
    const link: PeerLink = new PeerLink(this.selfId, peerId, stream, {
      sendOffer: (sdp) => this.net.send({ type: 'offer', to: peerId, sdp, sid: link.sid }),
      sendAnswer: (sdp) => this.net.send({ type: 'answer', to: peerId, sdp, sid: link.sid }),
      sendIce: (candidate) =>
        this.net.send({ type: 'ice-candidate', to: peerId, candidate, sid: link.sid }),
      onTrack: (s) => this.onTrack(peerId, s),
      onFailed: () => this.restart(peerId, link),
    }, this.video);
    // disconnected while media was being acquired: drop it.
    if (!this.connecting.has(peerId)) {
      link.close();
      return link;
    }
    this.links.set(peerId, link);
    this.connecting.delete(peerId);
    return link;
  }
}
