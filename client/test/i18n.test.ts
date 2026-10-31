import { describe, it, expect } from 'vitest';
import { MESSAGES, detectLang, format, lang, t, translate, type MsgKey } from '../src/i18n.ts';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('detects the language: a saved choice wins, else pt for a pt browser, else en', () => {
    expect(detectLang('pt', 'en-US')).toBe('pt');
    expect(detectLang('en', 'pt-BR')).toBe('en');
    expect(detectLang(null, 'pt-BR')).toBe('pt');
    expect(detectLang('xx', 'PT')).toBe('pt');
    expect(detectLang(null, 'es-ES')).toBe('en');
    expect(detectLang(undefined, undefined)).toBe('en');
  });

  it('stays English outside a browser (tests)', () => {
    expect(lang).toBe('en');
    expect(t('game.sit')).toBe('Sit (E)');
  });

  it('fills placeholders and leaves unknown ones', () => {
    expect(format('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect(translate('pt', 'meet.presenting', { name: 'Ana' })).toBe('Ana está apresentando');
    expect(translate('en', 'hud.chatUnread', { n: 3 })).toBe('Chat (3)');
  });

  it('every Portuguese string is filled in and keeps the English placeholders', () => {
    for (const key of Object.keys(MESSAGES.en) as MsgKey[]) {
      expect(MESSAGES.pt[key].trim().length, key).toBeGreaterThan(0);
      expect(placeholders(MESSAGES.pt[key]), key).toEqual(placeholders(MESSAGES.en[key]));
    }
    expect(Object.keys(MESSAGES.pt).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });
});
