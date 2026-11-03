import { describe, it, expect } from 'vitest';
import { admission, countByRoom, nameKey, toLobbyEntry, type LobbyEntry } from '../src/lobby.ts';

const online: LobbyEntry[] = [
  { id: 'a', name: 'Ana', uid: 'u-ana', room: 'office' },
  { id: 'b', name: 'Bia', room: 'office' },
  { id: 'c', name: 'Caio', uid: 'u-caio', room: 'lounge' },
];

describe('lobby', () => {
  it('counts players per room', () => {
    expect(countByRoom(online)).toEqual({ office: 2, lounge: 1 });
    expect(countByRoom([])).toEqual({});
  });

  it('compares names trimmed and case-insensitive', () => {
    expect(nameKey('  ANA ')).toBe('ana');
  });

  it('refuses a name someone else is using', () => {
    expect(admission(online, 'ana')).toEqual({ taken: true, kick: [] });
    expect(admission(online, 'Ana', 'u-other')).toEqual({ taken: true, kick: [] });
    expect(admission(online, 'bia', 'u-x')).toEqual({ taken: true, kick: [] });
    expect(admission(online, 'Duda', 'u-x')).toEqual({ taken: false, kick: [] });
  });

  it('replaces the same account, whatever the name (newest wins)', () => {
    expect(admission(online, 'Ana', 'u-ana')).toEqual({ taken: false, kick: ['a'] });
    expect(admission(online, 'Ana Paula', 'u-ana')).toEqual({ taken: false, kick: ['a'] });
    // Same account, but the name belongs to someone else: still refused.
    expect(admission(online, 'Bia', 'u-ana')).toEqual({ taken: true, kick: ['a'] });
  });

  it('reads presence metas safely', () => {
    expect(toLobbyEntry('k', { name: 'Ana', room: 'office', uid: 'u' })).toEqual({ id: 'k', name: 'Ana', room: 'office', uid: 'u' });
    expect(toLobbyEntry('k', { name: '  ', room: 'office' })).toBeNull();
    expect(toLobbyEntry('k', null)).toBeNull();
  });
});
