import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_ROOM, normalizeChat, normalizeStatusFields } from '@byte_grounds/shared/protocol';
import type {
  ClientToServer,
  JoinMsg,
  PeerId,
  PeerState,
  ServerToClient,
} from '@byte_grounds/shared/protocol';
import { DEFAULT_MAP } from '@byte_grounds/shared/maps';
import { getSupabase } from './supabase.ts';
import { reconnectDelay, type Net, type NetHandlers } from './net.ts';

/**
 * Supabase's free plan caps Realtime at ~100 msgs/s project-wide (every delivery counts),
 * so positions go out at ~5 Hz instead of the ws relay's ~12 Hz; remote interpolation smooths it.
 */
const POSITION_FLUSH_MS = 200;
/** Re-publish our position into presence at most this often, so late joiners see where we stand. */
const PRESENCE_REFRESH_MS = 2000;
/**
 * A peer whose presence drops is kept this long before `peer-left`, so a brief Realtime
 * reconnect (theirs or ours) doesn't tear down the WebRTC call, which is P2P and survives it.
 * Peers that close the tab say `bye` and leave immediately.
 */
const LEAVE_GRACE_MS = 10_000;
/** Signaling held while disconnected: older than this is stale (the call will be redone). */
const OUTBOX_MAX_AGE_MS = 20_000;
const OUTBOX_LIMIT = 200;

/** Signaling payload: a relay message addressed to one peer (others drop it). */
interface SignalPayload {
  to: PeerId;
  msg: ServerToClient;
}

/**
 * Same contract as the ws `NetClient`, but with no server of our own: a Supabase Realtime
 * channel plays the relay. Presence = who's here (+ last known position), broadcast =
 * positions and WebRTC signaling. Messages are translated to the same `ServerToClient`
 * shapes the ws server would send, so the game and mesh code don't know the difference.
 */
export class SupabaseNet implements Net {
  private readonly selfId: PeerId = crypto.randomUUID();
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private handlers: NetHandlers | null = null;
  private self: PeerState | null = null;
  private room = DEFAULT_ROOM;
  /** Peers already announced to the game, so presence updates don't re-announce them. */
  private known = new Set<PeerId>();
  /** Pending `peer-left` timers, cancelled if the peer's presence comes back in time. */
  private leaving = new Map<PeerId, ReturnType<typeof setTimeout>>();
  private subscribed = false;
  /** False until the first SUBSCRIBED: later ones are rejoins and must not reset the game. */
  private welcomed = false;
  private closed = false;
  private attempt = 0;
  private reopenTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPos = false;
  /**
   * Our position counter, bumped on every move and sent with every broadcast and presence
   * update. Presence travels a slower path than broadcast, so a receiver can get a presence
   * position *after* newer broadcasts; it keeps only the highest `seq` it has seen per peer
   * (`seen`), so avatars never snap back to an older spot.
   */
  private outbox: { payload: SignalPayload; at: number }[] = [];
  private seq = 0;
  private trackedSeq = -1;
  private readonly seen = new Map<PeerId, number>();
  /** Last status fields announced per peer (serialized), so presence refreshes don't repeat them. */
  private readonly statusSeen = new Map<PeerId, string>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastPresenceAt = 0;

  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  connect(join: Omit<JoinMsg, 'type'>, handlers: NetHandlers): void {
    this.handlers = handlers;
    this.closed = false;
    this.room = join.room ?? DEFAULT_ROOM;
    this.self = {
      id: this.selfId,
      name: join.name,
      color: join.color,
      appearance: join.appearance,
      x: join.x ?? DEFAULT_MAP.spawn.x,
      y: join.y ?? DEFAULT_MAP.spawn.y,
      ...(join.uid ? { uid: join.uid } : {}),
      ...normalizeStatusFields(join),
      ...(join.admin === true ? { admin: true } : {}),
    };
    handlers.onStatus?.('connecting');
    void getSupabase(this.url, this.key).then((client) => {
      if (this.closed) return;
      this.client = client;
      this.open();
    });
    globalThis.addEventListener?.('pagehide', this.sayBye);
  }

  private readonly sayBye = (): void => {
    if (this.channel && this.subscribed) {
      void this.channel.send({ type: 'broadcast', event: 'bye', payload: { id: this.selfId } });
    }
  };

  private open(): void {
    const channel = this.client!.channel(`byte_grounds:${this.room}`, {
      config: { broadcast: { self: false }, presence: { key: this.selfId } },
    });
    this.channel = channel;

    channel
      .on('broadcast', { event: 'position' }, ({ payload }) => {
        const { id, x, y, seq, pose, dir } = payload as PeerState & { seq?: number };
        if (this.known.has(id) && this.isNewer(id, seq)) {
          this.emit({ type: 'peer-moved', id, x, y, pose, dir });
        }
      })
      .on('broadcast', { event: 'status' }, ({ payload }) => {
        const id = (payload as { id: PeerId }).id;
        if (this.known.has(id)) this.emitStatus(id, payload);
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        const { id, name, text, at } = payload as { id: PeerId; name: unknown; text: unknown; at: unknown };
        const clean = normalizeChat(text);
        if (!this.known.has(id) || !clean) return;
        this.emit({
          type: 'chat',
          from: id,
          name: typeof name === 'string' ? name : '',
          text: clean,
          at: typeof at === 'number' ? at : Date.now(),
        });
      })
      .on('broadcast', { event: 'bye' }, ({ payload }) => {
        this.dropPeer((payload as { id: PeerId }).id);
      })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const { to, msg } = payload as SignalPayload;
        if (to === this.selfId) this.emit(msg);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (!this.subscribed || key === this.selfId) return;
        const peer = newPresences[0] as unknown as (PeerState & { seq?: number }) | undefined;
        if (!peer) return;
        if (this.known.has(key)) {
          this.cancelLeave(key);
          if (this.isNewer(key, peer.seq)) {
            this.emit({ type: 'peer-moved', id: key, x: peer.x, y: peer.y, pose: peer.pose, dir: peer.dir });
          }
          this.emitStatus(key, peer);
        } else {
          this.known.add(key);
          this.isNewer(key, peer.seq);
          this.statusSeen.set(key, JSON.stringify(normalizeStatusFields(peer)));
          this.emit({ type: 'peer-joined', peer: toPeer(peer) });
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key === this.selfId || !this.known.has(key)) return;
        if (channel.presenceState()[key]?.length || this.leaving.has(key)) return;
        this.leaving.set(
          key,
          setTimeout(() => {
            this.leaving.delete(key);
            if (!this.channel?.presenceState()[key]?.length) this.dropPeer(key);
          }, LEAVE_GRACE_MS),
        );
      })
      .subscribe((status) => {
        if (this.closed) return;
        if (status === 'SUBSCRIBED') this.onSubscribed();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // supabase-js rejoins on its own; SUBSCRIBED fires again when it does.
          this.subscribed = false;
          this.handlers?.onStatus?.('reconnecting');
          this.handlers?.onClose?.();
        } else if (status === 'CLOSED') {
          // The server closed the channel (e.g. after a rate-limit kick); supabase-js won't
          // rejoin a closed channel, so build a new one with backoff.
          this.subscribed = false;
          this.handlers?.onStatus?.('reconnecting');
          this.handlers?.onClose?.();
          if (this.channel === channel) this.reopen();
        }
      });

    this.flushTimer ??= setInterval(() => this.flush(), POSITION_FLUSH_MS);
  }

  private reopen(): void {
    const old = this.channel;
    this.channel = null;
    if (old) void this.client?.removeChannel(old);
    this.attempt += 1;
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null;
      if (!this.closed) this.open();
    }, reconnectDelay(this.attempt));
  }

  /**
   * First time: mirrors the ws server's join reply (`welcome`, then a snapshot of who is here).
   * On a rejoin our id is unchanged, so skip `welcome` (which would reset the game and hang up
   * every call) and just announce peers we didn't know yet; vanished ones go via `leave`.
   */
  private onSubscribed(): void {
    this.subscribed = true;
    this.attempt = 0;
    const peers: PeerState[] = [];
    for (const [key, metas] of Object.entries(this.channel!.presenceState())) {
      const meta = metas[0] as unknown as PeerState | undefined;
      if (key === this.selfId || !meta || this.known.has(key)) continue;
      this.known.add(key);
      this.isNewer(key, (meta as { seq?: number }).seq);
      this.statusSeen.set(key, JSON.stringify(normalizeStatusFields(meta)));
      peers.push(toPeer(meta));
    }
    if (!this.welcomed) {
      this.welcomed = true;
      this.emit({ type: 'welcome', selfId: this.selfId, room: this.room });
      this.emit({ type: 'presence-snapshot', peers });
    } else {
      for (const peer of peers) this.emit({ type: 'peer-joined', peer });
      // A rebuilt channel never sees `leave` for peers who left while we were away:
      // once everyone has had time to re-track, drop whoever is still missing.
      const channel = this.channel!;
      setTimeout(() => {
        if (this.channel !== channel || !this.subscribed) return;
        const present = channel.presenceState();
        for (const id of [...this.known]) if (!present[id]?.length) this.dropPeer(id);
      }, LEAVE_GRACE_MS);
    }
    this.trackPresence();
    this.flushOutbox();
    this.handlers?.onStatus?.('open');
    this.handlers?.onOpen?.();
  }

  send(msg: ClientToServer): void {
    if (!this.self) return;
    switch (msg.type) {
      case 'join':
        return; // handled by presence on subscribe
      case 'position':
        this.self!.x = msg.x;
        this.self!.y = msg.y;
        this.self!.pose = msg.pose;
        this.self!.dir = msg.dir;
        this.seq += 1;
        this.pendingPos = true;
        return;
      case 'status': {
        const fields = normalizeStatusFields(msg);
        Object.assign(this.self, fields);
        if (this.channel && this.subscribed) {
          void this.channel.send({ type: 'broadcast', event: 'status', payload: { id: this.selfId, ...fields } });
          this.trackPresence();
        }
        // Otherwise the next SUBSCRIBED tracks presence with these fields.
        return;
      }
      case 'chat': {
        const text = normalizeChat(msg.text);
        if (!text || !this.channel || !this.subscribed) return;
        void this.channel.send({
          type: 'broadcast',
          event: 'chat',
          payload: { id: this.selfId, name: this.self.name, text, at: Date.now() },
        });
        return;
      }
      case 'offer':
      case 'answer':
        this.signal(msg.to, { type: msg.type, from: this.selfId, sdp: msg.sdp, sid: msg.sid });
        return;
      case 'ice-candidate':
        this.signal(msg.to, {
          type: 'ice-candidate',
          from: this.selfId,
          candidate: msg.candidate,
          sid: msg.sid,
        });
        return;
    }
  }

  /**
   * Throttled position output: broadcast at ~5 Hz while moving; refresh presence every couple
   * of seconds while moving, and once more after stopping so it holds the final spot.
   */
  private flush(): void {
    if (!this.channel || !this.subscribed) return;
    if (this.pendingPos) {
      this.pendingPos = false;
      const { id, x, y, pose, dir } = this.self!;
      void this.channel.send({
        type: 'broadcast',
        event: 'position',
        payload: { id, x, y, pose, dir, seq: this.seq },
      });
      if (Date.now() - this.lastPresenceAt >= PRESENCE_REFRESH_MS) this.trackPresence();
    } else if (this.trackedSeq !== this.seq) {
      this.trackPresence();
    }
  }

  private trackPresence(): void {
    this.lastPresenceAt = Date.now();
    this.trackedSeq = this.seq;
    void this.channel!.track({ ...this.self!, seq: this.seq });
  }

  /** Record `seq` for a peer; false if it is older than (or equal to) one already applied. */
  private isNewer(id: PeerId, seq: number | undefined): boolean {
    if (seq === undefined) return true; // sender predates seq numbers
    if (seq <= (this.seen.get(id) ?? -1)) return false;
    this.seen.set(id, seq);
    return true;
  }

  /**
   * Send WebRTC signaling now, or hold it while the channel is down and send it on rejoin.
   * Dropping it would leave a call stuck half-negotiated (no audio either way).
   */
  private signal(to: PeerId, msg: ServerToClient): void {
    const payload: SignalPayload = { to, msg };
    if (this.channel && this.subscribed) {
      void this.channel.send({ type: 'broadcast', event: 'signal', payload });
      return;
    }
    this.outbox.push({ payload, at: Date.now() });
    if (this.outbox.length > OUTBOX_LIMIT) this.outbox.shift();
  }

  private flushOutbox(): void {
    const fresh = this.outbox.filter((m) => Date.now() - m.at < OUTBOX_MAX_AGE_MS);
    this.outbox = [];
    for (const { payload } of fresh) {
      void this.channel!.send({ type: 'broadcast', event: 'signal', payload });
    }
  }

  /** Announce a peer's status fields when they differ from the last ones announced. */
  private emitStatus(id: PeerId, raw: unknown): void {
    const fields = normalizeStatusFields(raw);
    const key = JSON.stringify(fields);
    if (this.statusSeen.get(id) === key) return;
    this.statusSeen.set(id, key);
    this.emit({ type: 'peer-status', id, ...fields });
  }

  private cancelLeave(id: PeerId): void {
    const t = this.leaving.get(id);
    if (t) clearTimeout(t);
    this.leaving.delete(id);
  }

  private dropPeer(id: PeerId): void {
    this.cancelLeave(id);
    if (!this.known.delete(id)) return;
    this.seen.delete(id);
    this.statusSeen.delete(id);
    this.emit({ type: 'peer-left', id });
  }

  private emit(msg: ServerToClient): void {
    this.handlers?.onMessage(msg);
  }

  close(): void {
    this.sayBye();
    this.closed = true;
    this.subscribed = false;
    globalThis.removeEventListener?.('pagehide', this.sayBye);
    if (this.reopenTimer) clearTimeout(this.reopenTimer);
    for (const t of this.leaving.values()) clearTimeout(t);
    this.leaving.clear();
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    if (this.channel) void this.client?.removeChannel(this.channel);
    this.channel = null;
  }
}

/** Strip Supabase's presence bookkeeping (`presence_ref`) back down to a `PeerState`. */
function toPeer(meta: PeerState): PeerState {
  const { id, name, color, appearance, x, y, pose, dir, uid, admin } = meta;
  return {
    id,
    name,
    color,
    appearance,
    x,
    y,
    pose,
    dir,
    ...(typeof uid === 'string' ? { uid } : {}),
    ...normalizeStatusFields(meta),
    ...(admin === true ? { admin: true } : {}),
  };
}
