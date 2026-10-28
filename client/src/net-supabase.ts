import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_ROOM } from '@byte_grounds/shared/protocol';
import type {
  ClientToServer,
  JoinMsg,
  PeerId,
  PeerState,
  ServerToClient,
} from '@byte_grounds/shared/protocol';
import { OFFICE_MAP } from '@byte_grounds/shared/map';
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
      x: OFFICE_MAP.spawn.x,
      y: OFFICE_MAP.spawn.y,
    };
    handlers.onStatus?.('connecting');
    // Loaded lazily so the default ws build doesn't pay for the Supabase bundle.
    void import('@supabase/supabase-js').then(({ createClient }) => {
      if (this.closed) return;
      // `worker`: heartbeats run in a Web Worker, so background tabs / locked phones (whose
      // timers get throttled) don't miss them and get dropped by the server.
      this.client = createClient(this.url, this.key, { realtime: { worker: true } });
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
        const { id, x, y } = payload as { id: PeerId; x: number; y: number };
        if (this.known.has(id)) this.emit({ type: 'peer-moved', id, x, y });
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
        const peer = newPresences[0] as unknown as PeerState | undefined;
        if (!peer) return;
        if (this.known.has(key)) {
          this.cancelLeave(key);
          this.emit({ type: 'peer-moved', id: key, x: peer.x, y: peer.y });
        } else {
          this.known.add(key);
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
    void this.channel!.track({ ...this.self! });
    this.lastPresenceAt = Date.now();
    this.handlers?.onStatus?.('open');
    this.handlers?.onOpen?.();
  }

  send(msg: ClientToServer): void {
    if (!this.channel || !this.subscribed) return;
    switch (msg.type) {
      case 'join':
        return; // handled by presence on subscribe
      case 'position':
        this.self!.x = msg.x;
        this.self!.y = msg.y;
        this.pendingPos = true;
        return;
      case 'offer':
      case 'answer':
        this.signal(msg.to, { type: msg.type, from: this.selfId, sdp: msg.sdp });
        return;
      case 'ice-candidate':
        this.signal(msg.to, { type: 'ice-candidate', from: this.selfId, candidate: msg.candidate });
        return;
    }
  }

  /** Throttled position output: broadcast at ~5 Hz, refresh presence every couple of seconds. */
  private flush(): void {
    if (!this.channel || !this.subscribed || !this.pendingPos) return;
    this.pendingPos = false;
    const { id, x, y } = this.self!;
    void this.channel.send({ type: 'broadcast', event: 'position', payload: { id, x, y } });
    if (Date.now() - this.lastPresenceAt >= PRESENCE_REFRESH_MS) {
      this.lastPresenceAt = Date.now();
      void this.channel.track({ ...this.self! });
    }
  }

  private signal(to: PeerId, msg: ServerToClient): void {
    const payload: SignalPayload = { to, msg };
    void this.channel!.send({ type: 'broadcast', event: 'signal', payload });
  }

  private cancelLeave(id: PeerId): void {
    const t = this.leaving.get(id);
    if (t) clearTimeout(t);
    this.leaving.delete(id);
  }

  private dropPeer(id: PeerId): void {
    this.cancelLeave(id);
    if (!this.known.delete(id)) return;
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
  const { id, name, color, appearance, x, y } = meta;
  return { id, name, color, appearance, x, y };
}
