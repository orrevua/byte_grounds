import { describe, it, expect } from 'vitest';
import { dayKey, loadDailyStatus, parseChatInput, saveDailyStatus } from '../src/chat.ts';

describe('parseChatInput', () => {
  it('says plain text, trimmed', () => {
    expect(parseChatInput('  hi all ')).toEqual({ kind: 'say', text: 'hi all' });
    expect(parseChatInput('   ')).toEqual({ kind: 'empty' });
  });

  it('understands /busy (and /afk), /status and /help', () => {
    expect(parseChatInput('/busy')).toEqual({ kind: 'busy' });
    expect(parseChatInput('/AFK')).toEqual({ kind: 'busy' });
    expect(parseChatInput('/status  Fixing the login  ')).toEqual({ kind: 'status', text: 'Fixing the login' });
    expect(parseChatInput('/status')).toEqual({ kind: 'status', text: '' });
    expect(parseChatInput('/help')).toEqual({ kind: 'help' });
  });

  it('reports unknown commands', () => {
    expect(parseChatInput('/dance now')).toEqual({ kind: 'unknown', name: 'dance' });
  });
});

describe('daily status', () => {
  it('formats the local day', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('keeps a status saved today and drops one from another day', () => {
    const saved = saveDailyStatus('  Shipping  ', '2026-10-30');
    expect(loadDailyStatus(saved, '2026-10-30')).toBe('Shipping');
    expect(loadDailyStatus(saved, '2026-10-31')).toBe('');
  });

  it('ignores missing or corrupt values', () => {
    expect(loadDailyStatus(null, '2026-10-30')).toBe('');
    expect(loadDailyStatus('{oops', '2026-10-30')).toBe('');
  });
});
