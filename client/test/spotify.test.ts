import { describe, it, expect } from 'vitest';
import { SCOPE, authorizeUrl, base64url, codeChallenge, needsRefresh, nowPlayingText, randomString, redirectUri, tokensFrom } from '../src/spotify.ts';
import { musicTag } from '../src/render.ts';

describe('spotify now playing', () => {
  it('makes URL-safe PKCE verifiers and the RFC 7636 S256 challenge', async () => {
    const v = randomString();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(randomString()).not.toBe(v);
    // RFC 7636 appendix B test vector
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('builds the authorize URL', () => {
    const u = new URL(authorizeUrl('cid', redirectUri('https://site.app'), 'chal', 'st'));
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      scope: SCOPE,
      redirect_uri: 'https://site.app/spotify-callback.html',
      code_challenge_method: 'S256',
      code_challenge: 'chal',
      state: 'st',
    });
  });

  it('reads token responses, keeping the old refresh token when a refresh omits it', () => {
    expect(tokensFrom({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }, 1000)).toEqual({ access: 'a', refresh: 'r', expiresAt: 3_601_000 });
    expect(tokensFrom({ access_token: 'b', expires_in: 60 }, 0, 'old')).toEqual({ access: 'b', refresh: 'old', expiresAt: 60_000 });
    expect(tokensFrom({ error: 'invalid_grant' }, 0)).toBeNull();
    expect(needsRefresh({ access: 'a', refresh: 'r', expiresAt: 100_000 }, 30_000)).toBe(false);
    expect(needsRefresh({ access: 'a', refresh: 'r', expiresAt: 100_000 }, 50_000)).toBe(true);
  });

  it('turns currently-playing into one line', () => {
    expect(nowPlayingText({ is_playing: true, item: { name: 'Song', artists: [{ name: 'A' }, { name: 'B' }] } })).toBe('Song — A, B');
    expect(nowPlayingText({ is_playing: true, item: { name: 'Ep 12', show: { name: 'Pod' } } })).toBe('Ep 12 — Pod');
    expect(nowPlayingText({ is_playing: false, item: { name: 'Song', artists: [{ name: 'A' }] } })).toBe('');
    expect(nowPlayingText({ is_playing: true, item: null })).toBe('');
    expect(nowPlayingText(null)).toBe('');
  });

  it('shortens long lines over heads', () => {
    expect(musicTag('Song — A')).toBe('♪ Song — A');
    const long = musicTag('x'.repeat(80));
    expect(long.length).toBeLessThanOrEqual(36);
    expect(long.endsWith('…')).toBe(true);
  });
});
