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
}

/**
 * One peer connection. The constructor builds the RTCPeerConnection (STUN),
 * adds local tracks, and forwards ICE/track events. Negotiation (offer/answer
 * glare handling) is added in the perfect-negotiation unit.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;

  constructor(
    readonly selfId: PeerId,
    readonly peerId: PeerId,
    localStream: MediaStream | null,
    protected readonly cb: PeerCallbacks,
  ) {
    this.polite = isPolite(selfId, peerId);
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URLS }] });

    if (localStream) for (const t of localStream.getTracks()) this.pc.addTrack(t, localStream);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) cb.sendIce(candidate.toJSON());
    };
    this.pc.ontrack = ({ streams }) => {
      if (streams[0]) cb.onTrack(streams[0]);
    };
    // Network change / NAT rebinding: 'disconnected' usually heals by itself, 'failed' doesn't.
    // restartIce() re-runs negotiation (via onnegotiationneeded) with fresh ICE candidates.
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') this.pc.restartIce();
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

  async handleSignal(msg: SignalMsg): Promise<void> {
    if (msg.type === 'offer') {
      const link = await this.connect(msg.from);
      await link.onDescription(msg.sdp);
      return;
    }
    const link = this.links.get(msg.from);
    if (!link) return; // answer/ice with no local link: nothing to apply
    if (msg.type === 'answer') await link.onDescription(msg.sdp);
    else await link.onIce(msg.candidate);
  }

  closeAll(): void {
    for (const id of [...this.links.keys()]) this.disconnect(id);
  }

  private async create(peerId: PeerId): Promise<PeerLink> {
    const stream = await this.getStream();
    const link = new PeerLink(this.selfId, peerId, stream, {
      sendOffer: (sdp) => this.net.send({ type: 'offer', to: peerId, sdp }),
      sendAnswer: (sdp) => this.net.send({ type: 'answer', to: peerId, sdp }),
      sendIce: (candidate) => this.net.send({ type: 'ice-candidate', to: peerId, candidate }),
      onTrack: (s) => this.onTrack(peerId, s),
    });
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
