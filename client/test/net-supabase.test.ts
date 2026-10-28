import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerToClient } from '@byte_grounds/shared/protocol';
import { SupabaseNet } from '../src/net-supabase.ts';

type Handler = (arg: any) => void;

/** In-memory stand-in for one Supabase Realtime channel topic shared by every fake client. */
class Hub {
  channels = new Set<FakeChannel>();
  state: Record<string, any[]> = {};

  fire(type: string, event: string, arg: any, except?: FakeChannel): void {
    for (const ch of this.channels) if (ch !== except) ch.dispatch(type, event, arg);
  }
}

class FakeChannel {
  private handlers: { type: string; event: string; cb: Handler }[] = [];
  constructor(
    private readonly hub: Hub,
    private readonly key: string,
  ) {}

  on(type: string, filter: { event: string }, cb: Handler): this {
    this.handlers.push({ type, event: filter.event, cb });
    return this;
  }

  dispatch(type: string, event: string, arg: any): void {
    for (const h of this.handlers) if (h.type === type && h.event === event) h.cb(arg);
  }

  subscribe(cb: (status: string) => void): this {
    this.hub.channels.add(this);
    queueMicrotask(() => {
      cb('SUBSCRIBED');
      // Like the real server, existing presences arrive as join events after the subscribe.
      for (const [key, metas] of Object.entries(this.hub.state)) {
        this.dispatch('presence', 'join', { key, newPresences: metas });
      }
    });
    return this;
  }

  presenceState(): Record<string, any[]> {
    return this.hub.state;
  }

  async track(meta: any): Promise<void> {
    this.hub.state[this.key] = [{ ...meta, presence_ref: 'ref' }];
    this.hub.fire('presence', 'join', { key: this.key, newPresences: this.hub.state[this.key] });
  }

  async send(msg: { event: string; payload: any }): Promise<void> {
    this.hub.fire('broadcast', msg.event, { payload: msg.payload }, this);
  }

  leave(): void {
    this.hub.channels.delete(this);
    const left = this.hub.state[this.key] ?? [];
    delete this.hub.state[this.key];
    this.hub.fire('presence', 'leave', { key: this.key, leftPresences: left });
  }
}

let hub: Hub;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    channel: (_name: string, opts: any) => new FakeChannel(hub, opts.config.presence.key),
    removeChannel: async (ch: FakeChannel) => ch.leave(),
  }),
}));

const appearance = { body: 'male', hair: 'brown', torso: 'teal', legs: 'teal' } as const;

async function joinAs(name: string): Promise<{ net: SupabaseNet; inbox: ServerToClient[]; id: string }> {
  const inbox: ServerToClient[] = [];
  const net = new SupabaseNet('https://x.supabase.co', 'anon');
  net.connect({ name, color: '#fff', appearance }, { onMessage: (m) => inbox.push(m) });
  await vi.dynamicImportSettled();
  await Promise.resolve();
  const welcome = inbox.find((m) => m.type === 'welcome');
  if (welcome?.type !== 'welcome') throw new Error('no welcome');
  return { net, inbox, id: welcome.selfId };
}

describe('SupabaseNet', () => {
  beforeEach(() => {
    hub = new Hub();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('announces peers both ways on join, without duplicates', async () => {
    const a = await joinAs('alice');
    const b = await joinAs('bob');

    expect(a.inbox.filter((m) => m.type === 'peer-joined')).toEqual([
      { type: 'peer-joined', peer: expect.objectContaining({ id: b.id, name: 'bob' }) },
    ]);
    const bobSees = b.inbox.filter((m) => m.type === 'peer-joined' || m.type === 'presence-snapshot');
    const alice = bobSees.flatMap((m) =>
      m.type === 'peer-joined' ? [m.peer] : m.type === 'presence-snapshot' ? m.peers : [],
    );
    expect(alice).toEqual([expect.objectContaining({ id: a.id, name: 'alice' })]);
    expect(alice[0]).not.toHaveProperty('presence_ref');
  });

  it('throttles positions into peer-moved for the other side', async () => {
    const a = await joinAs('alice');
    const b = await joinAs('bob');
    b.inbox.length = 0;
    a.net.send({ type: 'position', x: 3, y: 4 });
    a.net.send({ type: 'position', x: 5, y: 6 });
    expect(b.inbox.some((m) => m.type === 'peer-moved')).toBe(false);

    vi.advanceTimersByTime(200);
    expect(b.inbox.filter((m) => m.type === 'peer-moved')).toEqual([
      { type: 'peer-moved', id: a.id, x: 5, y: 6 },
    ]);
  });

  it('delivers signaling only to the addressee, stamped with the sender', async () => {
    const a = await joinAs('alice');
    const b = await joinAs('bob');
    const c = await joinAs('carol');
    const sdp = { type: 'offer', sdp: 'v=0' } as const;
    a.net.send({ type: 'offer', to: b.id, sdp });

    expect(b.inbox).toContainEqual({ type: 'offer', from: a.id, sdp });
    expect(c.inbox.some((m) => m.type === 'offer')).toBe(false);
  });

  it('emits peer-left when a peer closes', async () => {
    const a = await joinAs('alice');
    const b = await joinAs('bob');
    b.net.close();
    expect(a.inbox).toContainEqual({ type: 'peer-left', id: b.id });
  });
});
