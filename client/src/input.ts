import type { MoveInput } from './movement.ts';

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
