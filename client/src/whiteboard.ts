import { SIGN_COLORS, SIGN_DURATIONS, SIGN_MAX, normalizeSign, type Appearance, type Sign } from '@byte_grounds/shared/protocol';
import {
  BOARD_H,
  BOARD_W,
  applyBoardOp,
  emptyBoard,
  itemHit,
  newBoardId,
  thinPoints,
  type BoardOp,
  type BoardState,
  type Item,
  type ItemKind,
} from '@byte_grounds/shared/board';
import type { Store } from './store.ts';
import { drawAppearance, drawAppearanceFrame, preloadAppearance } from './sprites.ts';
import { t } from './i18n.ts';

export type Tool = 'pen' | 'marker' | 'eraser' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text';

const TOOLS: { id: Tool; icon: string; key: string }[] = [
  { id: 'pen', icon: '✎', key: 'p' },
  { id: 'marker', icon: '🖍', key: 'm' },
  { id: 'eraser', icon: '⌫', key: 'e' },
  { id: 'line', icon: '╱', key: 'l' },
  { id: 'arrow', icon: '➚', key: 'a' },
  { id: 'rect', icon: '▭', key: 'r' },
  { id: 'ellipse', icon: '◯', key: 'o' },
  { id: 'text', icon: 'T', key: 't' },
];
const COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#e64980', '#868e96'];
const WIDTHS = [3, 6, 12];
/** Eraser reach (board px). */
const ERASE_R = 10;
const SAVE_MS = 1500;

/** What the view needs from the game: who we are, and where edits go. */
export interface WhiteboardDeps {
  store: Store;
  name: () => string;
  appearance: () => Appearance;
  /** Send an edit to the room. */
  send: (board: string, op: BoardOp) => void;
  /** The sign we hold now (null = none), and holding one up / putting it down. */
  sign: () => Sign | null;
  setSign: (sign: Sign | null) => void;
}

/**
 * The full-screen whiteboard (spec: docs/specs/whiteboard.md): tabs, a tool bar, the board canvas
 * (1600x1000 board px, scaled to fit), and our character drawn big beside it, facing the board.
 */
export class WhiteboardView {
  private root: HTMLDivElement | null = null;
  private boardId = '';
  private board: BoardState = emptyBoard();
  private tab = 'main';
  private tool: Tool = 'pen';
  private color = COLORS[0]!;
  private width = WIDTHS[1]!;
  private fill = false;
  private draft: Item | null = null;
  private drawing = false;
  /** Ops that arrived while the saved board was loading. */
  private pending: BoardOp[] | null = null;
  /** Our items, newest last, for "undo my last". */
  private mine: { tab: string; id: string }[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private raf = 0;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private avatarCtx!: CanvasRenderingContext2D;
  private status!: HTMLSpanElement;
  private textInput: HTMLInputElement | null = null;
  onClose: () => void = () => {};

  constructor(private readonly deps: WhiteboardDeps) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Open a board (by id), loading what was saved; live edits keep coming in meanwhile. */
  open(boardId: string, title: string): void {
    if (this.root) this.close();
    this.boardId = boardId;
    this.board = emptyBoard();
    this.tab = 'main';
    this.mine = [];
    this.pending = [];
    this.build(title);
    void preloadAppearance(this.deps.appearance());
    this.deps.store
      .loadBoard(boardId)
      .then((saved) => {
        if (this.boardId !== boardId || !this.root) return;
        if (saved) this.board = saved;
        for (const op of this.pending ?? []) applyBoardOp(this.board, op);
        this.pending = null;
        if (!this.board.tabs.some((tb) => tb.id === this.tab)) this.tab = this.board.tabs[0]!.id;
        this.refresh();
      })
      .catch((err) => {
        console.warn('[whiteboard] load failed:', err);
        this.pending && this.pending.forEach((op) => applyBoardOp(this.board, op));
        this.pending = null;
        this.setStatus(t('wb.notSaved'), true);
        this.refresh();
      });
  }

  close(): void {
    if (!this.root) return;
    this.commitText();
    if (this.dirty) this.save();
    cancelAnimationFrame(this.raf);
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('resize', this.fit);
    this.root.remove();
    this.root = null;
    this.onClose();
  }

  /** An edit from someone else in the room. */
  applyRemote(boardId: string, op: BoardOp): void {
    if (boardId !== this.boardId || !this.root) return;
    if (this.pending) {
      this.pending.push(op);
      return;
    }
    if (applyBoardOp(this.board, op)) {
      if (!this.board.tabs.some((tb) => tb.id === this.tab)) this.tab = this.board.tabs[0]!.id;
      this.refresh();
    }
  }

  // ---------- building ----------

  private build(title: string): void {
    const root = (this.root = document.createElement('div'));
    root.id = 'whiteboard';
    root.innerHTML = `
      <div class="wb-head">
        <b class="wb-title"></b>
        <div class="wb-tabs"></div>
        <span class="wb-status"></span>
        <button type="button" class="wb-close" title="${t('wb.close')}">✕</button>
      </div>
      <div class="wb-body">
        <div class="wb-tools"></div>
        <div class="wb-stage"><canvas class="wb-canvas" width="${BOARD_W}" height="${BOARD_H}"></canvas></div>
        <div class="wb-side"><canvas class="wb-avatar" width="64" height="64"></canvas><div class="wb-name"></div><div class="wb-sign"></div></div>
      </div>`;
    root.querySelector('.wb-title')!.textContent = title;
    root.querySelector('.wb-name')!.textContent = this.deps.name();
    root.querySelector('.wb-close')!.addEventListener('click', () => this.close());
    this.status = root.querySelector('.wb-status')!;
    this.canvas = root.querySelector('.wb-canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.avatarCtx = root.querySelector<HTMLCanvasElement>('.wb-avatar')!.getContext('2d')!;
    this.buildTools(root.querySelector('.wb-tools')!);
    this.signBox = root.querySelector('.wb-sign')!;
    this.renderSign();
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    addEventListener('keydown', this.onKey, true);
    addEventListener('resize', this.fit);
    document.body.appendChild(root);
    this.fit();
    this.refresh();
    const loop = () => {
      this.drawAvatar();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ---------- my sign ----------

  private signBox: HTMLDivElement | null = null;
  private signForm = false;

  /**
   * "Make my sign": write a short text, pick a card colour and how long to hold it; the character
   * then holds it up on the map for everyone. While holding one: what it says, and "Put it down".
   */
  private renderSign(): void {
    const box = this.signBox;
    if (!box) return;
    const sign = this.deps.sign();
    box.replaceChildren();
    if (sign && !this.signForm) {
      const what = document.createElement('div');
      what.className = 'wb-sign-now';
      what.textContent = `🪧 “${sign.text}”`;
      const when = document.createElement('div');
      when.className = 'wb-sign-when';
      when.textContent = sign.until
        ? t('wb.signUntil', { time: new Date(sign.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
        : t('wb.signForever');
      const down = button(t('wb.signDown'), () => {
        this.deps.setSign(null);
        this.renderSign();
      });
      const edit = button(t('wb.signEdit'), () => {
        this.signForm = true;
        this.renderSign();
      });
      box.append(what, when, down, edit);
      return;
    }
    if (!this.signForm) {
      box.append(button(t('wb.signMake'), () => {
        this.signForm = true;
        this.renderSign();
      }));
      return;
    }
    const text = document.createElement('input');
    text.className = 'wb-sign-text';
    text.maxLength = SIGN_MAX;
    text.placeholder = t('wb.signPlaceholder');
    text.value = sign?.text ?? '';
    let color: string = sign?.color ?? SIGN_COLORS[1];
    const colors = document.createElement('div');
    colors.className = 'wb-sign-colors';
    for (const c of SIGN_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.classList.toggle('on', c === color);
      b.addEventListener('click', () => {
        color = c;
        for (const o of colors.children) o.classList.toggle('on', o === b);
      });
      colors.appendChild(b);
    }
    const time = document.createElement('select');
    time.className = 'wb-sign-time';
    for (const m of SIGN_DURATIONS) {
      const o = document.createElement('option');
      o.value = String(m);
      o.textContent = m ? (m < 60 ? t('wb.signMinutes', { n: m }) : t('wb.signHour')) : t('wb.signForever');
      time.appendChild(o);
    }
    time.value = '15';
    const hold = button(t('wb.signHold'), () => {
      const minutes = Number(time.value);
      const next = normalizeSign({ text: text.value, color, until: minutes ? Date.now() + minutes * 60_000 : 0 });
      if (!next) return text.focus();
      this.deps.setSign(next);
      this.signForm = false;
      this.renderSign();
    });
    hold.classList.add('wb-sign-hold');
    const cancel = button(t('wb.signCancel'), () => {
      this.signForm = false;
      this.renderSign();
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') hold.click();
    });
    box.append(text, colors, time, hold, cancel);
    text.focus();
  }

  private buildTools(bar: HTMLDivElement): void {
    const group = (cls: string) => {
      const g = document.createElement('div');
      g.className = `wb-group ${cls}`;
      bar.appendChild(g);
      return g;
    };
    const tools = group('wb-tool-group');
    for (const tool of TOOLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tool = tool.id;
      b.textContent = tool.icon;
      b.title = `${t(`wb.tool.${tool.id}`)} (${tool.key.toUpperCase()})`;
      b.addEventListener('click', () => this.setTool(tool.id));
      tools.appendChild(b);
    }
    const colors = group('wb-colors');
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-color';
      b.dataset.color = c;
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => {
        this.color = c;
        this.syncTools();
      });
      colors.appendChild(b);
    }
    const widths = group('wb-widths');
    WIDTHS.forEach((w) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-width';
      b.dataset.width = String(w);
      b.innerHTML = `<i style="width:${w + 4}px;height:${w + 4}px"></i>`;
      b.title = t('wb.width');
      b.addEventListener('click', () => {
        this.width = w;
        this.syncTools();
      });
      widths.appendChild(b);
    });
    const actions = group('wb-actions');
    const action = (label: string, title: string, run: () => void, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', run);
      actions.appendChild(b);
      return b;
    };
    action('◧', t('wb.fill'), () => {
      this.fill = !this.fill;
      this.syncTools();
    }, 'wb-fill');
    action('↶', `${t('wb.undo')} (Ctrl+Z)`, () => this.undo());
    action('🗑', t('wb.clear'), () => {
      if (confirm(t('wb.confirmClear'))) this.local({ kind: 'clear', tab: this.tab });
    });
    action('⤓', t('wb.export'), () => this.exportPng());
    this.syncTools();
  }

  private setTool(tool: Tool): void {
    this.commitText();
    this.tool = tool;
    this.syncTools();
  }

  private syncTools(): void {
    const root = this.root;
    if (!root) return;
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-tool]')) b.classList.toggle('on', b.dataset.tool === this.tool);
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-color]')) b.classList.toggle('on', b.dataset.color === this.color);
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-width]')) b.classList.toggle('on', Number(b.dataset.width) === this.width);
    root.querySelector('.wb-fill')?.classList.toggle('on', this.fill);
    this.canvas.style.cursor = this.tool === 'eraser' ? 'cell' : this.tool === 'text' ? 'text' : 'crosshair';
  }

  /** Re-render the tabs bar and the board. */
  private refresh(): void {
    const root = this.root;
    if (!root) return;
    const bar = root.querySelector<HTMLDivElement>('.wb-tabs')!;
    bar.replaceChildren();
    for (const tb of this.board.tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = tb.id === this.tab ? 'wb-tab on' : 'wb-tab';
      b.textContent = tb.name;
      b.title = t('wb.tabHint');
      b.addEventListener('click', () => {
        this.commitText();
        this.tab = tb.id;
        this.refresh();
      });
      b.addEventListener('dblclick', () => {
        const name = prompt(t('wb.renameTab'), tb.name)?.trim();
        if (name) this.local({ kind: 'tab-rename', tab: tb.id, name });
      });
      if (tb.id === this.tab && this.board.tabs.length > 1) {
        const x = document.createElement('span');
        x.className = 'wb-tab-x';
        x.textContent = '×';
        x.title = t('wb.removeTab');
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(t('wb.confirmRemoveTab', { name: tb.name }))) this.local({ kind: 'tab-remove', tab: tb.id });
        });
        b.appendChild(x);
      }
      bar.appendChild(b);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'wb-tab wb-tab-add';
    add.textContent = '+';
    add.title = t('wb.addTab');
    add.addEventListener('click', () => {
      const id = newBoardId();
      this.local({ kind: 'tab-add', id, name: t('wb.page', { n: this.board.tabs.length + 1 }) });
      this.tab = id;
      this.refresh();
    });
    bar.appendChild(add);
    this.render();
  }

  // ---------- edits ----------

  /** Apply our own edit, send it to the room and schedule a save. */
  private local(op: BoardOp): void {
    if (!applyBoardOp(this.board, op)) return;
    if (op.kind === 'add') this.mine.push({ tab: op.tab, id: op.item.id });
    if (!this.board.tabs.some((tb) => tb.id === this.tab)) this.tab = this.board.tabs[0]!.id;
    this.deps.send(this.boardId, op);
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_MS);
    this.refresh();
  }

  private save(): void {
    this.dirty = false;
    const id = this.boardId;
    this.deps.store
      .saveBoard(id, structuredClone(this.board))
      .then(() => this.setStatus(t('wb.saved')))
      .catch((err) => {
        console.warn('[whiteboard] save failed:', err);
        this.setStatus(t('wb.notSaved'), true);
      });
  }

  private setStatus(text: string, bad = false): void {
    if (!this.root) return;
    this.status.textContent = text;
    this.status.classList.toggle('bad', bad);
  }

  /** Remove our newest item still on the board. */
  private undo(): void {
    while (this.mine.length) {
      const last = this.mine.pop()!;
      const tab = this.board.tabs.find((tb) => tb.id === last.tab);
      if (tab?.items.some((i) => i.id === last.id)) {
        this.tab = last.tab;
        this.local({ kind: 'remove', tab: last.tab, id: last.id });
        return;
      }
    }
  }

  private exportPng(): void {
    const a = document.createElement('a');
    const tab = this.board.tabs.find((tb) => tb.id === this.tab);
    a.download = `${this.root?.querySelector('.wb-title')?.textContent ?? 'whiteboard'} - ${tab?.name ?? ''}.png`;
    a.href = this.canvas.toDataURL('image/png');
    a.click();
  }

  // ---------- pointer ----------

  private point(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * BOARD_W, y: ((e.clientY - r.top) / r.height) * BOARD_H };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.point(e);
    if (this.tool === 'text') {
      e.preventDefault(); // keep the press from taking the focus away from the new text field
      this.startText(p.x, p.y);
      return;
    }
    this.commitText();
    this.canvas.setPointerCapture(e.pointerId);
    this.drawing = true;
    if (this.tool === 'eraser') {
      this.eraseAt(p.x, p.y);
      return;
    }
    const kind = this.tool as ItemKind;
    const base = { id: newBoardId(), by: this.deps.name(), kind, color: this.color };
    if (kind === 'pen' || kind === 'marker') {
      this.draft = { ...base, width: kind === 'marker' ? this.width * 3 : this.width, points: [p.x, p.y] };
    } else {
      this.draft = { ...base, width: this.width, x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...(this.fill ? { fill: true } : {}) };
    }
    this.render();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.drawing) return;
    const p = this.point(e);
    if (this.tool === 'eraser') return this.eraseAt(p.x, p.y);
    const d = this.draft;
    if (!d) return;
    if (d.points) d.points.push(p.x, p.y);
    else if (e.shiftKey && (d.kind === 'rect' || d.kind === 'ellipse')) {
      const s = Math.max(Math.abs(p.x - d.x1!), Math.abs(p.y - d.y1!));
      d.x2 = d.x1! + Math.sign(p.x - d.x1! || 1) * s;
      d.y2 = d.y1! + Math.sign(p.y - d.y1! || 1) * s;
    } else {
      d.x2 = p.x;
      d.y2 = p.y;
    }
    this.render();
  };

  private readonly onUp = (): void => {
    if (!this.drawing) return;
    this.drawing = false;
    const d = this.draft;
    this.draft = null;
    if (!d) return this.render();
    if (d.points) d.points = thinPoints(d.points);
    else {
      for (const k of ['x1', 'y1', 'x2', 'y2'] as const) d[k] = Math.round(d[k]!);
      if (Math.hypot(d.x2! - d.x1!, d.y2! - d.y1!) < 3) return this.render(); // a click, not a shape
    }
    this.local({ kind: 'add', tab: this.tab, item: d });
  };

  private eraseAt(x: number, y: number): void {
    const tab = this.board.tabs.find((tb) => tb.id === this.tab);
    if (!tab) return;
    for (let i = tab.items.length - 1; i >= 0; i--) {
      const it = tab.items[i]!;
      if (itemHit(it, x, y, ERASE_R)) {
        this.local({ kind: 'remove', tab: this.tab, id: it.id });
        return;
      }
    }
  }

  // ---------- text ----------

  private startText(x: number, y: number): void {
    this.commitText();
    const stage = this.root!.querySelector<HTMLDivElement>('.wb-stage')!;
    const r = this.canvas.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const scale = r.width / BOARD_W;
    const size = 16 + this.width * 4;
    const input = (this.textInput = document.createElement('input'));
    input.className = 'wb-text';
    input.maxLength = 300;
    input.style.left = `${r.left - s.left + x * scale}px`;
    input.style.top = `${r.top - s.top + y * scale}px`;
    input.style.font = `600 ${Math.max(10, size * scale)}px system-ui, sans-serif`;
    input.style.color = this.color;
    input.dataset.x = String(Math.round(x));
    input.dataset.y = String(Math.round(y));
    input.dataset.size = String(size);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.commitText();
      else if (e.key === 'Escape') this.cancelText();
    });
    stage.appendChild(input);
    input.focus();
    // Commit on blur, but not on a blur in the first moments (the click that made the field).
    setTimeout(() => input.addEventListener('blur', () => this.commitText()), 150);
  }

  private commitText(): void {
    const input = this.textInput;
    if (!input) return;
    this.textInput = null;
    const text = input.value.trim();
    input.remove();
    if (!text) return;
    this.local({
      kind: 'add',
      tab: this.tab,
      item: {
        id: newBoardId(),
        by: this.deps.name(),
        kind: 'text',
        color: this.color,
        width: this.width,
        x1: Number(input.dataset.x),
        y1: Number(input.dataset.y),
        text,
        size: Number(input.dataset.size),
      },
    });
  }

  private cancelText(): void {
    this.textInput?.remove();
    this.textInput = null;
  }

  // ---------- keys / layout ----------

  /** Board shortcuts; nothing reaches the game (movement, chat) while the board is open. */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.root) return;
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    e.stopPropagation();
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      this.undo();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const tool = TOOLS.find((tl) => tl.key === k);
      if (tool) {
        e.preventDefault();
        this.setTool(tool.id);
      }
    }
  };

  /** Scale the board to the stage, keeping its 16:10 shape. */
  private readonly fit = (): void => {
    const stage = this.root?.querySelector<HTMLDivElement>('.wb-stage');
    if (!stage) return;
    const { width, height } = stage.getBoundingClientRect();
    const scale = Math.min(width / BOARD_W, height / BOARD_H);
    this.canvas.style.width = `${Math.floor(BOARD_W * scale)}px`;
    this.canvas.style.height = `${Math.floor(BOARD_H * scale)}px`;
  };

  // ---------- drawing ----------

  private render(): void {
    if (!this.root) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    ctx.fillStyle = '#e3e6ea';
    for (let y = 25; y < BOARD_H; y += 25) for (let x = 25; x < BOARD_W; x += 25) ctx.fillRect(x - 1, y - 1, 2, 2);
    const tab = this.board.tabs.find((tb) => tb.id === this.tab);
    for (const it of tab?.items ?? []) drawItem(ctx, it);
    if (this.draft) drawItem(ctx, this.draft);
  }

  /** Our character beside the board, facing it; an arm up while drawing, a slow idle bob otherwise. */
  private drawAvatar(): void {
    const ctx = this.avatarCtx;
    ctx.clearRect(0, 0, 64, 64);
    ctx.imageSmoothingEnabled = false;
    const a = this.deps.appearance();
    if (this.drawing) drawAppearanceFrame(ctx, a, 1, 3, 0, 0); // cast row, facing left: arm raised
    else drawAppearance(ctx, a, 'left', 0, 0, Math.floor(performance.now() / 700) % 2);
  }
}

/** Draw one item (board px). */
export function drawItem(ctx: CanvasRenderingContext2D, it: Item): void {
  ctx.save();
  ctx.strokeStyle = it.color;
  ctx.fillStyle = it.color;
  ctx.lineWidth = it.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (it.kind === 'marker') ctx.globalAlpha = 0.35;
  if (it.points) {
    const p = it.points;
    ctx.beginPath();
    ctx.moveTo(p[0]!, p[1]!);
    if (p.length === 2) ctx.lineTo(p[0]! + 0.1, p[1]!);
    for (let i = 2; i < p.length - 2; i += 2) {
      // smooth: curve through the midpoints
      ctx.quadraticCurveTo(p[i]!, p[i + 1]!, (p[i]! + p[i + 2]!) / 2, (p[i + 1]! + p[i + 3]!) / 2);
    }
    if (p.length > 2) ctx.lineTo(p[p.length - 2]!, p[p.length - 1]!);
    ctx.stroke();
  } else if (it.kind === 'text') {
    ctx.font = `600 ${it.size ?? 28}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(it.text ?? '', it.x1!, it.y1!);
  } else {
    const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = it;
    ctx.beginPath();
    if (it.kind === 'line' || it.kind === 'arrow') {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      if (it.kind === 'arrow') {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const head = 12 + it.width * 2.5;
        for (const s of [-1, 1]) {
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - head * Math.cos(ang + s * 0.45), y2 - head * Math.sin(ang + s * 0.45));
        }
      }
    } else if (it.kind === 'rect') {
      ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else {
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    }
    if (it.fill && (it.kind === 'rect' || it.kind === 'ellipse')) {
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.stroke();
  }
  ctx.restore();
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
