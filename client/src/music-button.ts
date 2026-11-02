import type { SpotifyLink } from './spotify.ts';
import { t } from './i18n.ts';

/**
 * The HUD's "♪" button. Not connected: connects Spotify. Connected: opens a small popover with
 * what's playing, Share on/off and Disconnect (and why it can't read, when Spotify refuses).
 */
export class MusicButton {
  private readonly btn: HTMLButtonElement;
  private pop: HTMLDivElement | null = null;

  constructor(
    private readonly link: SpotifyLink,
    bar: HTMLElement,
  ) {
    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.className = 'hud-music';
    this.btn.addEventListener('click', () => {
      if (!this.link.connected) void this.link.connect();
      else if (this.pop) this.close();
      else this.open();
    });
    bar.appendChild(this.btn);
    this.render();
  }

  /** Reflect the link's state (call from its onChange). */
  render(): void {
    const { link } = this;
    const sharing = link.connected && link.sharing;
    this.btn.classList.toggle('on', sharing && !!link.nowPlaying);
    this.btn.textContent = !link.connected
      ? `♪ ${t('spotify.connect')}`
      : sharing && link.nowPlaying
        ? `♪ ${link.nowPlaying}`
        : `♪ ${t(link.sharing ? 'spotify.nothing' : 'spotify.paused')}`;
    this.btn.title = link.connected ? t('spotify.title') : t('spotify.connectTitle');
    if (this.pop) this.fill(this.pop);
  }

  dispose(): void {
    this.close();
    this.btn.remove();
  }

  private open(): void {
    const pop = (this.pop = document.createElement('div'));
    pop.id = 'music-menu';
    this.fill(pop);
    document.body.appendChild(pop);
    const r = this.btn.getBoundingClientRect();
    pop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - pop.offsetWidth - 4))}px`;
    pop.style.top = `${r.bottom + 6}px`;
    document.addEventListener('pointerdown', this.onOutside, true);
    addEventListener('keydown', this.onKey);
  }

  private close(): void {
    if (!this.pop) return;
    document.removeEventListener('pointerdown', this.onOutside, true);
    removeEventListener('keydown', this.onKey);
    this.pop.remove();
    this.pop = null;
  }

  private fill(pop: HTMLDivElement): void {
    const { link } = this;
    const head = document.createElement('div');
    head.className = 'music-now';
    head.textContent = link.nowPlaying ? `♪ ${link.nowPlaying}` : t('spotify.nothingPlaying');
    const share = document.createElement('button');
    share.type = 'button';
    share.className = link.sharing ? 'on' : '';
    share.textContent = t(link.sharing ? 'spotify.shareOn' : 'spotify.shareOff');
    share.addEventListener('click', () => link.setSharing(!link.sharing));
    const off = document.createElement('button');
    off.type = 'button';
    off.textContent = t('spotify.disconnect');
    off.addEventListener('click', () => {
      link.disconnect();
      this.close();
    });
    pop.replaceChildren(head, share, off);
    if (link.state === 'denied' || link.state === 'error') {
      const note = document.createElement('div');
      note.className = 'music-note';
      note.textContent = t(link.state === 'denied' ? 'spotify.denied' : 'spotify.error');
      pop.append(note);
    }
  }

  private readonly onOutside = (e: PointerEvent): void => {
    if (this.pop && !this.pop.contains(e.target as Node) && e.target !== this.btn) this.close();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };
}
