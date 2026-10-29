import type { Facing, PeerId, PeerState, Pose } from '@byte_grounds/shared/protocol';

/** In-memory presence for a single room. State is lost on restart (by design). */
export class Room {
  private readonly peers = new Map<PeerId, PeerState>();

  add(peer: PeerState): void {
    this.peers.set(peer.id, peer);
  }

  remove(id: PeerId): boolean {
    return this.peers.delete(id);
  }

  updatePosition(id: PeerId, x: number, y: number, pose?: Pose, dir?: Facing): boolean {
    const peer = this.peers.get(id);
    if (!peer) return false;
    peer.x = x;
    peer.y = y;
    peer.pose = pose;
    peer.dir = dir;
    return true;
  }

  has(id: PeerId): boolean {
    return this.peers.has(id);
  }

  /** All peers, optionally excluding one id (e.g. the requester). */
  list(exceptId?: PeerId): PeerState[] {
    const out: PeerState[] = [];
    for (const peer of this.peers.values()) {
      if (peer.id !== exceptId) out.push(peer);
    }
    return out;
  }
}
