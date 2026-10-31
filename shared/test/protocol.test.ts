import { describe, it, expect } from 'vitest';
import { CHAT_MAX, POSES, STATUS_MAX, normalizeChat, normalizePose, normalizeStatus, normalizeStatusFields, normalizeLock, LOCK_ALLOW_MAX } from '../src/protocol.ts';

describe('normalizePose', () => {
  it('keeps every known pose', () => {
    for (const p of POSES) expect(normalizePose(p)).toBe(p);
  });

  it('turns unknown, missing or non-string values into stand', () => {
    expect(normalizePose('fly')).toBe('stand');
    expect(normalizePose(undefined)).toBe('stand');
    expect(normalizePose(null)).toBe('stand');
    expect(normalizePose(3)).toBe('stand');
  });
});

describe('status / chat text', () => {
  it('trims, collapses whitespace and clips', () => {
    expect(normalizeStatus('  Shipping\n the  login ')).toBe('Shipping the login');
    expect(normalizeStatus('x'.repeat(STATUS_MAX + 10))).toHaveLength(STATUS_MAX);
    expect(normalizeChat('y'.repeat(CHAT_MAX + 1))).toHaveLength(CHAT_MAX);
  });

  it('turns non-strings into empty text', () => {
    expect(normalizeStatus(undefined)).toBe('');
    expect(normalizeChat(42)).toBe('');
  });

  it('normalizes status fields, defaulting to off', () => {
    expect(normalizeStatusFields({ status: ' hi ', busy: true, sharing: 'yes', muted: true, item: 'coffee' })).toEqual({
      status: 'hi',
      busy: true,
      sharing: false,
      muted: true,
      item: 'coffee',
      lock: null,
    });
    expect(normalizeStatusFields({ item: 'beer' }).item).toBe('');
  });

  it('keeps a well-formed room lock and drops a malformed one', () => {
    const hash = 'a'.repeat(64);
    expect(normalizeLock({ zone: '32,1,15,12', hash, allow: ['p1', 7, ''] })).toEqual({ zone: '32,1,15,12', hash, allow: ['p1'] });
    expect(normalizeLock({ zone: '32,1,15,12', hash: 'nothex' })).toBeNull();
    expect(normalizeLock({ zone: '', hash })).toBeNull();
    expect(normalizeLock('x')).toBeNull();
    expect(normalizeLock({ zone: 'z', hash, allow: Array.from({ length: 40 }, (_, i) => `p${i}`) })!.allow).toHaveLength(LOCK_ALLOW_MAX);
    expect(normalizeStatusFields({ lock: { zone: 'z', hash } }).lock).toEqual({ zone: 'z', hash, allow: [] });
    expect(normalizeStatusFields(null)).toEqual({ status: '', busy: false, sharing: false, muted: false, item: '', lock: null });
  });
});
