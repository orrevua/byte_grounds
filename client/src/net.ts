import type { ClientToServer, JoinMsg, ServerToClient } from '@byte_grounds/shared/protocol';
import { SupabaseNet } from './net-supabase.ts';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080';

/** Give up automatic reconnection after this many consecutive failures. */
const MAX_RECONNECTS = 5;

export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type MessageHandler = (msg: ServerToClient) => void;

export interface NetHandlers {
  onMessage: MessageHandler;
  onOpen?: () => void;
  onClose?: () => void;
  onStatus?: (status: NetStatus) => void;
}

/** Exponential backoff (ms) for reconnect attempt `n` (1-based), capped at 10s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 10_000);
}

/** Transport to the other peers: either our own ws relay or a Supabase Realtime channel. */
export interface Net {
  connect(join: Omit<JoinMsg, 'type'>, handlers: NetHandlers): void;
  send(msg: ClientToServer): void;
  close(): void;
}

/** Thin typed wrapper over the WebSocket connection to the relay server. */
export class NetClient implements Net {
  private ws: WebSocket | null = null;
  private join: Omit<JoinMsg, 'type'> | null = null;
  private handlers: NetHandlers | null = null;
  private attempt = 0;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly url: string = WS_URL) {}

  /** Opens the socket, (re)sends `join` on each open, and auto-reconnects on drop. */
  connect(join: Omit<JoinMsg, 'type'>, handlers: NetHandlers): void {
    this.join = join;
    this.handlers = handlers;
    this.closed = false;
    this.attempt = 0;
    this.open();
  }

  private open(): void {
    if (this.attempt === 0) this.handlers?.onStatus?.('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.attempt = 0;
      if (this.join) this.send({ type: 'join', ...this.join });
      this.handlers?.onStatus?.('open');
      this.handlers?.onOpen?.();
    });

    ws.addEventListener('message', (ev) => {
      let msg: ServerToClient;
      try {
        msg = JSON.parse(ev.data as string) as ServerToClient;
      } catch {
        return;
      }
      this.handlers?.onMessage(msg);
    });

    ws.addEventListener('close', () => {
      this.handlers?.onClose?.();
      if (this.closed) return;
      if (this.attempt >= MAX_RECONNECTS) {
        this.handlers?.onStatus?.('closed');
        return;
      }
      this.attempt += 1;
      this.handlers?.onStatus?.('reconnecting');
      this.timer = setTimeout(() => this.open(), reconnectDelay(this.attempt));
    });
  }

  send(msg: ClientToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }
}

/** Supabase when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set, else the ws relay. */
export function createNet(): Net {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && key ? new SupabaseNet(url, key) : new NetClient();
}
