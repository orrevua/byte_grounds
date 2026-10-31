import type { MoveInput } from './movement.ts';
import { t } from './i18n.ts';

const KEY_MAP: Record<string, keyof MoveInput> = {
  w: 'up',
  arrowup: 'up',
  s: 'down',
  arrowdown: 'down',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
};

function isTextField(t: EventTarget | null): boolean {
  return (
    (typeof HTMLInputElement !== 'undefined' && t instanceof HTMLInputElement) ||
    (typeof HTMLTextAreaElement !== 'undefined' && t instanceof HTMLTextAreaElement)
  );
}

/** Tracks held movement keys (WASD + arrows) via window listeners. */
export class Keyboard {
  private readonly held = new Set<keyof MoveInput>();
  private readonly onDown = (e: KeyboardEvent) => this.set(e, true);
  private readonly onUp = (e: KeyboardEvent) => this.set(e, false);

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
  }

  private set(e: KeyboardEvent, down: boolean): void {
    const dir = KEY_MAP[e.key.toLowerCase()];
    if (!dir) return;
    if (isTextField(e.target)) {
      // Typing (chat, status): letters are text, not movement. Still release a held key.
      if (!down) this.held.delete(dir);
      return;
    }
    e.preventDefault();
    if (down) this.held.add(dir);
    else this.held.delete(dir);
  }

  get input(): MoveInput {
    return {
      up: this.held.has('up'),
      down: this.held.has('down'),
      left: this.held.has('left'),
      right: this.held.has('right'),
    };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
  }
}

/** True on touch-first devices (phones/tablets), where the on-screen pad is shown. */
export function isTouchDevice(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

const PAD_BUTTONS: { dir: keyof MoveInput; label: string; area: string }[] = [
  { dir: 'up', label: '▲', area: 'up' },
  { dir: 'left', label: '◀', area: 'left' },
  { dir: 'right', label: '▶', area: 'right' },
  { dir: 'down', label: '▼', area: 'down' },
];

/** On-screen D-pad for phones: hold a button to walk, like holding an arrow key. */
export class TouchPad {
  private readonly held = new Set<keyof MoveInput>();
  private readonly root: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'touchpad';
    this.root.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:10;display:grid;gap:6px;' +
      'grid-template-columns:repeat(3,56px);grid-template-rows:repeat(3,56px);' +
      'grid-template-areas:". up ." "left . right" ". down .";' +
      'touch-action:none;user-select:none;-webkit-user-select:none;';
    for (const { dir, label, area } of PAD_BUTTONS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-label', t('game.move', { dir }));
      b.style.cssText =
        `grid-area:${area};border:0;border-radius:12px;background:#2a2f37cc;color:#e6e8eb;` +
        'font-size:22px;touch-action:none;-webkit-tap-highlight-color:transparent;';
      const press = (e: PointerEvent) => {
        e.preventDefault();
        this.held.add(dir);
        b.style.background = '#4f8cffcc';
      };
      const release = () => {
        this.held.delete(dir);
        b.style.background = '#2a2f37cc';
      };
      b.addEventListener('pointerdown', press);
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('pointerleave', release);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      this.root.appendChild(b);
    }
    document.body.appendChild(this.root);
  }

  get input(): MoveInput {
    return {
      up: this.held.has('up'),
      down: this.held.has('down'),
      left: this.held.has('left'),
      right: this.held.has('right'),
    };
  }

  dispose(): void {
    this.root.remove();
  }
}
