import { describe, it, expect } from 'vitest';
import { applyGrantChange, grantKey, toGrantChange } from '../src/grants.ts';

describe('applyGrantChange', () => {
  it('adds on insert, and a duplicate insert changes nothing', () => {
    const set = new Set<string>();
    expect(applyGrantChange(set, { type: 'INSERT', userId: 'u1', perm: 'build' })).toBe(true);
    expect(set.has(grantKey('u1', 'build'))).toBe(true);
    expect(applyGrantChange(set, { type: 'INSERT', userId: 'u1', perm: 'build' })).toBe(false);
    expect(set.size).toBe(1);
  });

  it('removes on delete, and deleting an absent grant changes nothing', () => {
    const set = new Set([grantKey('u1', 'editor')]);
    expect(applyGrantChange(set, { type: 'DELETE', userId: 'u1', perm: 'editor' })).toBe(true);
    expect(set.size).toBe(0);
    expect(applyGrantChange(set, { type: 'DELETE', userId: 'u1', perm: 'editor' })).toBe(false);
  });

  it('keeps the two permissions of one person independent', () => {
    const set = new Set<string>();
    applyGrantChange(set, { type: 'INSERT', userId: 'u1', perm: 'build' });
    applyGrantChange(set, { type: 'INSERT', userId: 'u1', perm: 'editor' });
    applyGrantChange(set, { type: 'DELETE', userId: 'u1', perm: 'build' });
    expect([...set]).toEqual([grantKey('u1', 'editor')]);
  });
});

describe('toGrantChange', () => {
  it('maps a row and ignores unknown perms or missing ids', () => {
    expect(toGrantChange('DELETE', { user_id: 'u1', perm: 'editor' })).toEqual({
      type: 'DELETE',
      userId: 'u1',
      perm: 'editor',
    });
    expect(toGrantChange('INSERT', { user_id: 'u1', perm: 'admin' })).toBeNull();
    expect(toGrantChange('INSERT', { perm: 'build' })).toBeNull();
    expect(toGrantChange('INSERT', undefined)).toBeNull();
  });
});
