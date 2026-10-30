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

  private status: ((status: string) => void) | null = null;

  subscribe(cb: (status: string) => void): this {
    this.status = cb;
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

  /** The server kicks this channel (as after a rate-limit or missed heartbeats). */
  serverClose(): void {
    this.leave();
    this.status?.('CLOSED');
  }

  leave(): void {
    this.hub.channels.delete(this);
    const left = this.hub.state[this.key] ?? [];
    delete this.hub.state[this.key];
    this.hub.fire('presence', 'leave', { key: this.key, leftPresences: left });
  }
}

let hub: Hub;
/** Every channel the code under test created, newest last. */
let created: FakeChannel[];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    channel: (_name: string, opts: any) => {
      const ch = new FakeChannel(hub, opts.config.presence.key);
      created.push(ch);
      return ch;
    },
    removeChannel: async (ch: FakeChannel) => ch.leave(),
  }),
}));

const appearance = { body: 'male', hair: 'brown', outfit: 'casual', torso: 'teal', legs: 'teal', skin: 'light' } as const;

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
    created = [];
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

  it('carries a dance pose and its facing to the other side', async () => {
    const a = await joinAs('alice');
    const b = await joinAs('bob');
    b.inbox.length = 0;
    a.net.send({ type: 'position', x: 3, y: 4, pose: 'dance', dir: 'down' });

    vi.advanceTimersByTime(200);
    expect(b.inbox.filter((m) => m.type === 'peer-moved')).toEqual([
      { type: 'peer-moved', id: a.id, x: 3, y: 4, pose: 'dance', dir: 'down' },
    ]);
  });

  it('ignores a late presence update that is older than the latest move', async () => {
    const a = await joinAs('alice');
    const b = await joinAs('bob');
    const meta = { id: a.id, name: 'alice', color: '#fff', appearance };
    a.net.send({ type: 'position', x: 3, y: 3 }); // seq 1
    a.net.send({ type: 'position', x: 4, y: 3 }); // seq 2
    vi.advanceTimersByTime(200);
    b.inbox.length = 0;

    // Presence from seq 1 shows up after the seq-2 broadcast: must not snap alice back.
    hub.fire('presence', 'join', { key: a.id, newPresences: [{ ...meta, x: 3, y: 3, seq: 1 }] });
    expect(b.inbox.some((m) => m.type === 'peer-moved')).toBe(false);
  });

  it('updates presence with the final spot after stopping', async () => {
    const a = await joinAs('alice');
    a.net.send({ type: 'position', x: 7, y: 5 });
    vi.advanceTimersByTime(400); // one broadcast tick, then the idle tick re-tracks
    expect(hub.state[a.id]?.[0]).toMatchObject({ x: 7, y: 5 });

    const late = await joinAs('bob');
    const snapshot = late.inbox.find((m) => m.type === 'presence-snapshot');
    const joined = late.inbox.filter((m) => m.type === 'peer-joined');
    const alice = [
      ...(snapshot?.type === 'presence-snapshot' ? snapshot.peers : []),
      ...joined.map((m) => (m.type === 'peer-joined' ? m.peer : null)),
    ].find((p) => p?.id === a.id);
    expect(alice).toMatchObject({ x: 7, y: 5 });
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

  it('emits peer-left right away when a peer closes', async () => {
    const a = await joinAs('alice');
    const b = await joinAs('bob');
    b.net.close();
    expect(a.inbox).toContainEqual({ type: 'peer-left', id: b.id });
  });

  it('keeps a peer through a short presence drop, drops them after the grace period', async () => {
    const a = await joinAs('alice');
    const b = await joinAs('bob');
    const bobChannel = created[1]!;

    bobChannel.leave(); // connection blip: presence gone, no bye
    vi.advanceTimersByTime(5_000);
    void bobChannel.track({ id: b.id, name: 'bob', color: '#fff', appearance, x: 1, y: 1 });
    vi.advanceTimersByTime(10_000);
    expect(a.inbox.some((m) => m.type === 'peer-left')).toBe(false);

    bobChannel.leave();
    vi.advanceTimersByTime(10_000);
    expect(a.inbox).toContainEqual({ type: 'peer-left', id: b.id });
  });

  it('rebuilds a server-closed channel without resetting the game', async () => {
    const statuses: string[] = [];
    const inbox: ServerToClient[] = [];
    const a = new SupabaseNet('https://x.supabase.co', 'anon');
    a.connect(
      { name: 'alice', color: '#fff', appearance },
      { onMessage: (m) => inbox.push(m), onStatus: (s) => statuses.push(s) },
    );
    await vi.dynamicImportSettled();
    await Promise.resolve();
    const b = await joinAs('bob');

    created[0]!.serverClose();
    expect(statuses.at(-1)).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(500);

    expect(created).toHaveLength(3);
    expect(statuses.at(-1)).toBe('open');
    expect(inbox.filter((m) => m.type === 'welcome')).toHaveLength(1);
    expect(inbox.some((m) => m.type === 'peer-left')).toBe(false);

    // Bob still sees alice: her presence is back after the reopen.
    expect(b.inbox.some((m) => m.type === 'peer-left')).toBe(false);

    // Carol left while alice was away; alice drops her once the grace period passes.
    const c = await joinAs('carol');
    expect(inbox).toContainEqual({ type: 'peer-joined', peer: expect.objectContaining({ id: c.id }) });
    created[2]!.serverClose(); // alice's rebuilt channel drops again...
    c.net.close(); // ...and carol leaves meanwhile, so alice never gets her bye or leave
    await vi.advanceTimersByTimeAsync(500);
    expect(inbox.some((m) => m.type === 'peer-left')).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(inbox).toContainEqual({ type: 'peer-left', id: c.id });
    expect(inbox).not.toContainEqual({ type: 'peer-left', id: b.id });
  });
});
