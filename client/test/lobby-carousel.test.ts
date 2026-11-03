import { describe, it, expect } from 'vitest';
import { lobbyEntries, lobbyUrl } from '../src/lobby.ts';
import { fitThumb } from '../src/map-carousel.ts';
import { iceServers } from '../src/webrtc.ts';

describe('lobby (client)', () => {
  it("finds the ws server's lobby endpoint", () => {
    expect(lobbyUrl('ws://localhost:8080')).toBe('http://localhost:8080/lobby');
    expect(lobbyUrl('wss://relay.example.com/')).toBe('https://relay.example.com/lobby');
  });

  it('reads presence into entries, skipping junk', () => {
    expect(lobbyEntries({ k1: [{ name: 'Ana', room: 'office' }], k2: [{}], k3: [] })).toEqual([{ id: 'k1', name: 'Ana', room: 'office' }]);
  });
});

describe('map carousel', () => {
  it('fits a map into the miniature, centred', () => {
    expect(fitThumb(1280, 896, 280, 170)).toEqual({ scale: 170 / 896, x: (280 - 1280 * (170 / 896)) / 2, y: 0 });
  });
});

describe('ice servers', () => {
  it('adds a TURN relay only when configured', () => {
    expect(iceServers({})).toHaveLength(1);
    expect(iceServers({ VITE_TURN_URLS: 'turn:a.example:3478, turns:a.example:443', VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'p' })[1]).toEqual({
      urls: ['turn:a.example:3478', 'turns:a.example:443'],
      username: 'u',
      credential: 'p',
    });
  });
});
