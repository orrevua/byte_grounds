import { mountDecorPicker, transformForKey, type PickerState } from './decor-picker.ts';

/** What a click on the map does while building; erase / block / walk are admin-only. */
export type BuildTool = 'place' | 'move' | 'erase' | 'block' | 'walk';

const BUILDER_TOOLS: { id: BuildTool; label: string }[] = [
  { id: 'place', label: 'Place' },
  { id: 'move', label: 'Move' },
];
const ADMIN_TOOLS: { id: BuildTool; label: string }[] = [
  ...BUILDER_TOOLS,
  { id: 'erase', label: 'Erase' },
  { id: 'block', label: 'Block' },
  { id: 'walk', label: 'Walk' },
];

/**
 * The live build drawer (right side; a bottom sheet on narrow screens): the editor's decor
 * picker, "Undo my last", and for the admin a tool row. R / Shift+R / F / V turn the piece and
 * Ctrl+Z undoes while it is open. Built on first open.
 */
export class BuildPanel {
  tool: BuildTool = 'place';
  onUndo: (() => void) | null = null;
  /** Called when the tool changes (the game drops a piece being moved). */
  onTool: ((t: BuildTool) => void) | null = null;
  private el: HTMLDivElement | null = null;
  private picker: ReturnType<typeof mountDecorPicker> | null = null;

  constructor(private readonly isAdmin: boolean) {}

  get isOpen(): boolean {
    return !!this.el && !this.el.classList.contains('hidden');
  }

  state(): PickerState | null {
    return this.picker?.state() ?? null;
  }

  open(): void {
    this.el ??= this.build();
    this.el.classList.remove('hidden');
    addEventListener('keydown', this.onKey);
  }

  close(): void {
    this.el?.classList.add('hidden');
    removeEventListener('keydown', this.onKey);
  }

  dispose(): void {
    this.close();
    this.el?.remove();
    this.el = null;
  }

  private build(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'build-panel';
    el.innerHTML = `
      <div class="row build-head"><b>Build</b><button type="button" class="build-close" title="Close">×</button></div>
      <div class="tools build-tools"></div>
      <div class="row"><button type="button" class="build-undo">Undo my last (Ctrl+Z)</button></div>
      <div class="build-picker"></div>`;
    el.querySelector('.build-close')!.addEventListener('click', () => this.close());
    el.querySelector('.build-undo')!.addEventListener('click', () => this.onUndo?.());
    const tools = el.querySelector<HTMLDivElement>('.build-tools')!;
    for (const t of this.isAdmin ? ADMIN_TOOLS : BUILDER_TOOLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.label;
      b.dataset.tool = t.id;
      b.addEventListener('click', () => this.setTool(t.id));
      tools.appendChild(b);
    }
    document.body.appendChild(el);
    // Picking a piece (or turning it) goes back to placing; a Block mode change doesn't.
    let mode = 'base';
    this.picker = mountDecorPicker(el.querySelector<HTMLDivElement>('.build-picker')!, (s) => {
      if (s.mode === mode) this.setTool('place');
      mode = s.mode;
    });
    this.el = el;
    this.setTool(this.tool);
    return el;
  }

  private setTool(t: BuildTool): void {
    if (t !== this.tool) this.onTool?.(t);
    this.tool = t;
    for (const b of this.el?.querySelectorAll<HTMLButtonElement>('.build-tools button') ?? []) {
      b.classList.toggle('active', b.dataset.tool === t);
    }
  }

  /** Same guards as the editor's keys: not while typing, not with Ctrl/Alt (except Ctrl+Z). */
  private readonly onKey = (e: KeyboardEvent): void => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.onUndo?.();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || !this.picker) return;
    const op = transformForKey(e);
    if (!op) return;
    e.preventDefault();
    this.picker.setTransform(op(this.picker.state().t));
  };
}
