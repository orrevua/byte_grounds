import { describe, it, expect } from 'vitest';
import { Room } from '../src/room.ts';
import type { PeerState } from '@byte_grounds/shared/protocol';

const peer = (id: string): PeerState => ({
  id,
  name: id,
  color: '#fff',
  appearance: { body: 'male', hair: 'brown', outfit: 'casual', torso: 'teal', legs: 'teal', skin: 'light' },
  x: 0,
  y: 0,
});

describe('Room', () => {
  it('adds and lists peers', () => {
    const r = new Room();
    r.add(peer('a'));
    r.add(peer('b'));
    expect(r.list().map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('excludes a given id from list', () => {
    const r = new Room();
    r.add(peer('a'));
    r.add(peer('b'));
    expect(r.list('a').map((p) => p.id)).toEqual(['b']);
  });

  it('updates position only for known peers', () => {
    const r = new Room();
    r.add(peer('a'));
    expect(r.updatePosition('a', 3, 4)).toBe(true);
    expect(r.list()[0]).toMatchObject({ x: 3, y: 4 });
    expect(r.updatePosition('missing', 1, 1)).toBe(false);
  });

  it('stores and returns a dance pose with its facing', () => {
    const r = new Room();
    r.add(peer('a'));
    expect(r.updatePosition('a', 2, 2, 'dance', 'down')).toBe(true);
    expect(r.list()[0]).toMatchObject({ pose: 'dance', dir: 'down' });
  });

  it('stores status fields only for known peers', () => {
    const r = new Room();
    r.add(peer('a'));
    expect(r.updateStatus('a', { status: 'Shipping', busy: true, sharing: false })).toBe(true);
    expect(r.get('a')).toMatchObject({ status: 'Shipping', busy: true, sharing: false });
    expect(r.updateStatus('missing', { status: '', busy: false, sharing: false })).toBe(false);
  });

  it('removes peers', () => {
    const r = new Room();
    r.add(peer('a'));
    expect(r.remove('a')).toBe(true);
    expect(r.remove('a')).toBe(false);
    expect(r.has('a')).toBe(false);
    expect(r.list()).toEqual([]);
  });
});
