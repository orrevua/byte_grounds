import { normalizeMusic } from '@byte_grounds/shared/protocol';

/**
 * Spotify "now playing" (spec: docs/specs/spotify-now-playing.md): Authorization Code + PKCE in
 * the browser (no secret, no server), then `currently-playing` polled while connected and sharing.
 * Tokens live in localStorage; the connect popup lands on spotify-callback.html, which stores them.
 */

export const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '';
export const SCOPE = 'user-read-currently-playing';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const NOW_PLAYING_URL = 'https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode';

/** localStorage keys: the tokens, and the verifier + state of a connect in progress. */
export const TOKENS_KEY = 'byte_grounds.spotify';
export const PENDING_KEY = 'byte_grounds.spotify.pending';
const SHARE_KEY = 'byte_grounds.spotify.share';

export const POLL_MS = 30_000;
/** Refresh this long before the access token runs out. */
const EXPIRY_MARGIN_MS = 60_000;

export interface Tokens {
  access: string;
  refresh: string;
  /** Epoch ms when `access` stops working. */
  expiresAt: number;
}

export interface Pending {
  verifier: string;
  state: string;
}

/** Where Spotify sends the browser back (must be listed in the app's dashboard). */
export function redirectUri(origin: string = location.origin): string {
  return `${origin}/spotify-callback.html`;
}

/** Random URL-safe string (PKCE verifier / state). */
export function randomString(bytes = 48): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE S256 challenge for a verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(clientId: string, redirect: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPE,
    redirect_uri: redirect,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  return `${AUTHORIZE_URL}?${q}`;
}

/** A token response → stored tokens (a refresh may omit the refresh token: keep the old one). */
export function tokensFrom(json: unknown, now: number, prevRefresh = ''): Tokens | null {
  const o = (json ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof o.access_token !== 'string' || !o.access_token) return null;
  const refresh = typeof o.refresh_token === 'string' && o.refresh_token ? o.refresh_token : prevRefresh;
  const secs = typeof o.expires_in === 'number' && o.expires_in > 0 ? o.expires_in : 3600;
  return { access: o.access_token, refresh, expiresAt: now + secs * 1000 };
}

export function needsRefresh(t: Tokens, now: number): boolean {
  return now >= t.expiresAt - EXPIRY_MARGIN_MS;
}

/** A `currently-playing` body → "Song — Artist" / "Episode — Show"; '' when paused or nothing. */
export function nowPlayingText(json: unknown): string {
  const o = (json ?? {}) as {
    is_playing?: unknown;
    item?: { name?: unknown; artists?: { name?: unknown }[]; show?: { name?: unknown } } | null;
  };
  if (o.is_playing !== true || !o.item || typeof o.item.name !== 'string') return '';
  const by = Array.isArray(o.item.artists)
    ? o.item.artists.map((a) => (typeof a?.name === 'string' ? a.name : '')).filter(Boolean).join(', ')
    : typeof o.item.show?.name === 'string'
      ? o.item.show.name
      : '';
  return normalizeMusic(by ? `${o.item.name} — ${by}` : o.item.name);
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode: works for this page only
  }
}

export function loadTokens(): Tokens | null {
  const t = readJson<Tokens>(TOKENS_KEY);
  return t && typeof t.access === 'string' && typeof t.expiresAt === 'number' ? t : null;
}

export function saveTokens(t: Tokens | null): void {
  write(TOKENS_KEY, t);
}

/** Exchange the callback's code for tokens (the callback page calls this). */
export async function exchangeCode(code: string, verifier: string, clientId = SPOTIFY_CLIENT_ID): Promise<Tokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  const tokens = tokensFrom(await res.json().catch(() => null), Date.now());
  if (!res.ok || !tokens) throw new Error(`Spotify token exchange failed (${res.status})`);
  return tokens;
}

export type SpotifyState = 'off' | 'connected' | 'denied' | 'error';

/**
 * The page's Spotify link: connect (popup), poll what's playing while sharing, refresh tokens,
 * disconnect. `onChange` fires with the line to share ('' = nothing) and whenever the state changes.
 */
export class SpotifyLink {
  private tokens: Tokens | null = loadTokens();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private playing = '';
  state: SpotifyState = this.tokens ? 'connected' : 'off';
  sharing = readJson<boolean>(SHARE_KEY) ?? true;
  onChange: () => void = () => {};

  constructor(private readonly clientId = SPOTIFY_CLIENT_ID) {
    addEventListener('storage', this.onStorage);
    if (this.tokens) this.schedule(0);
  }

  get enabled(): boolean {
    return !!this.clientId;
  }

  get connected(): boolean {
    return !!this.tokens;
  }

  /** What's playing now (even while not shared). */
  get nowPlaying(): string {
    return this.playing;
  }

  /** The line to put in our status: what's playing, when connected and sharing. */
  get shared(): string {
    return this.tokens && this.sharing ? this.playing : '';
  }

  /** Open Spotify's consent page in a popup; the callback page stores the tokens. */
  async connect(): Promise<void> {
    const verifier = randomString();
    const state = randomString(16);
    write(PENDING_KEY, { verifier, state } satisfies Pending);
    const url = authorizeUrl(this.clientId, redirectUri(), await codeChallenge(verifier), state);
    const popup = window.open(url, 'spotify-connect', 'width=480,height=720');
    if (!popup) location.assign(url); // popups blocked: go there in this tab
  }

  setSharing(on: boolean): void {
    this.sharing = on;
    write(SHARE_KEY, on);
    if (on && this.tokens) this.schedule(0);
    this.onChange();
  }

  disconnect(): void {
    this.tokens = null;
    saveTokens(null);
    clearTimeout(this.timer);
    this.playing = '';
    this.state = 'off';
    this.onChange();
  }

  dispose(): void {
    clearTimeout(this.timer);
    removeEventListener('storage', this.onStorage);
  }

  /** The callback page (another window) saved new tokens: pick them up and poll right away. */
  private readonly onStorage = (e: StorageEvent): void => {
    if (e.key !== TOKENS_KEY) return;
    this.tokens = loadTokens();
    this.state = this.tokens ? 'connected' : 'off';
    if (this.tokens) this.schedule(0);
    else this.playing = '';
    this.onChange();
  };

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), ms);
  }

  private async poll(): Promise<void> {
    if (!this.tokens) return;
    if (!this.sharing) return; // paused: nothing to fetch until sharing is back on
    let next = POLL_MS;
    try {
      const res = await this.get(NOW_PLAYING_URL);
      if (res.status === 429) next = Math.max(POLL_MS, Number(res.headers.get('Retry-After') ?? 30) * 1000);
      else if (res.status === 403) this.setState('denied');
      else if (res.status === 204) this.setPlaying('');
      else if (res.ok) this.setPlaying(nowPlayingText(await res.json().catch(() => null)));
      else this.setState('error');
      if (res.ok || res.status === 204) this.setState('connected');
    } catch {
      this.setState('error');
    }
    if (this.tokens) this.schedule(next);
  }

  /** GET with the access token, refreshing it first when due and once on a 401. */
  private async get(url: string): Promise<Response> {
    if (this.tokens && needsRefresh(this.tokens, Date.now())) await this.refresh();
    let res = await fetch(url, { headers: { Authorization: `Bearer ${this.tokens?.access ?? ''}` } });
    if (res.status === 401 && (await this.refresh())) {
      res = await fetch(url, { headers: { Authorization: `Bearer ${this.tokens?.access ?? ''}` } });
    }
    return res;
  }

  /** Refresh the access token; a refused refresh disconnects (the user revoked access). */
  private async refresh(): Promise<boolean> {
    const t = this.tokens;
    if (!t?.refresh) return false;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: this.clientId }),
    }).catch(() => null);
    const next = res?.ok ? tokensFrom(await res.json().catch(() => null), Date.now(), t.refresh) : null;
    if (!next) {
      if (res && res.status >= 400 && res.status < 500) this.disconnect();
      return false;
    }
    this.tokens = next;
    saveTokens(next);
    return true;
  }

  private setPlaying(text: string): void {
    if (text === this.playing) return;
    this.playing = text;
    this.onChange();
  }

  private setState(s: SpotifyState): void {
    if (s === this.state) return;
    this.state = s;
    this.onChange();
  }
}
