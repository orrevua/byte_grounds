import {
  TIME_CONTROLS,
  applyChessOp,
  colorOf,
  emptyGame,
  inCheck,
  inProgress,
  legalMoves,
  materialBalance,
  matchOf,
  newChessId,
  recordOf,
  replay,
  seatOf,
  squareName,
  timeLeft,
  toUci,
  type ChessGame,
  type ChessMatch,
  type ChessOp,
  type ChessReason,
  type Color,
  type Move,
  type Promo,
  type Replay,
} from '@byte_grounds/shared/chess';
import { summarize, type MoveReview } from '@byte_grounds/shared/chess-engine';
import type { ReviewJob, ReviewResult } from './chess-review-worker.ts';
import piecesUrl from './assets/chess/pieces.png';
import type { Store } from './store.ts';
import { t } from './i18n.ts';

/** Columns of `assets/chess/pieces.png` (row 0 white, row 1 black). */
const PIECE_COL: Record<string, number> = { k: 0, q: 1, r: 2, b: 3, n: 4, p: 5 };
const VALUE: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };
const BADGE: Record<MoveReview['label'], string> = { best: '★', excellent: '!', good: '✓', inaccuracy: '?!', mistake: '?', blunder: '??' };
const TICK_MS = 200;

/** A piece sprite (`p`: FEN letter, or a kind plus `color`). */
function pieceHtml(p: string, color: Color = colorOf(p)!): string {
  return `<i class="pc" style="--c:${PIECE_COL[p.toLowerCase()]};--r:${color === 'w' ? 0 : 1}"></i>`;
}

/** `m:ss`, or `s.t` under 10 s. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  if (ms < 10_000) return (Math.max(0, ms) / 1000).toFixed(1);
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const controlLabel = (initial: number, increment: number) => `${initial / 60_000}+${increment / 1000}`;

/** What the view needs from the game. */
export interface ChessDeps {
  store: Store;
  name: () => string;
  /** Names of everyone in the room now (us included): a seat of someone who left can be freed. */
  online: () => Set<string>;
  send: (table: string, op: ChessOp) => void;
}

/** A sequence of moves on the board: the live game, or a match from the history. */
interface Shown {
  key: string;
  moves: string[];
  white: string;
  black: string;
  /** Over (reviewable, browsable). */
  done: boolean;
}

/**
 * The chess table, full screen (spec: docs/specs/chess-table.md): the board between the two
 * players' bars (name, captured pieces, clock), and a side panel with the seats, the time control,
 * the game's buttons, the moves (rated once the game is over) and the table's match history.
 */
export class ChessView {
  private root: HTMLDivElement | null = null;
  private table = '';
  private game: ChessGame = emptyGame();
  private play: Replay = replay([])!;
  private matches: ChessMatch[] = [];
  /** Ops that arrived while the saved game was loading. */
  private pending: ChessOp[] | null = null;
  private selected = -1;
  /** A pawn move waiting for its promotion piece. */
  private promoting: Move | null = null;
  /** A finished match shown on the board instead of the live game. */
  private viewing: ChessMatch | null = null;
  /** The last game that ended while we watched, shown once the table has moved on to a fresh one. */
  private lastEnded: ChessGame | null = null;
  /** Browsing a finished game: the board shows the position after this many moves (null = the end). */
  private browse: number | null = null;
  private status = '';
  private statusBad = false;
  private tick: ReturnType<typeof setInterval> | undefined;
  /** The game + ply we already claimed a flag for (one claim each). */
  private flagged = '';
  /** Move reviews per game / match id (kept while the page lives: games don't change once over). */
  private readonly reviews = new Map<string, (MoveReview | null)[]>();
  private readonly requested = new Map<string, number>();
  private worker: Worker | null = null;
  private reviewRaf = 0;
  onClose: () => void = () => {};

  constructor(private readonly deps: ChessDeps) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(table: string, title: string): void {
    if (this.root) this.close();
    this.table = table;
    this.setGame(emptyGame());
    this.matches = [];
    this.pending = [];
    this.selected = -1;
    this.promoting = null;
    this.viewing = null;
    this.lastEnded = null;
    this.browse = null;
    this.status = '';
    this.build(title);
    const { store } = this.deps;
    Promise.all([store.loadChessGame(table), store.listChessMatches(table).catch(() => [] as ChessMatch[])])
      .then(([saved, matches]) => {
        if (this.table !== table || !this.root) return;
        if (saved) this.setGame(saved);
        this.matches = matches;
      })
      .catch((err) => {
        console.warn('[chess] load failed:', err);
        this.setStatus(t('chess.notSaved'), true);
      })
      .finally(() => {
        if (this.table !== table || !this.root) return;
        for (const op of this.pending ?? []) applyChessOp(this.game, op);
        this.pending = null;
        this.setGame(this.game);
        this.deps.send(table, { kind: 'hello' });
        this.refresh();
      });
  }

  close(): void {
    if (!this.root) return;
    removeEventListener('keydown', this.onKey, true);
    clearInterval(this.tick);
    cancelAnimationFrame(this.reviewRaf);
    this.root.remove();
    this.root = null;
    this.onClose();
  }

  /** An op from someone else in the room. */
  applyRemote(table: string, op: ChessOp): void {
    if (table !== this.table || !this.root) return;
    if (this.pending) {
      this.pending.push(op);
      return;
    }
    if (op.kind === 'hello') {
      this.deps.send(this.table, { kind: 'state', state: this.game });
      return;
    }
    let ended: ChessGame | null = null;
    if (!applyChessOp(this.game, op, (g) => (ended = g))) return;
    this.afterChange(ended, false);
  }

  /** Our own op: applied, sent, saved (and the match recorded when it ended the game). */
  private local(op: ChessOp): void {
    let ended: ChessGame | null = null;
    if (!applyChessOp(this.game, op, (g) => (ended = g))) return;
    this.deps.send(this.table, op);
    this.deps.store.saveChessGame(this.table, this.game).catch((err) => {
      console.warn('[chess] save failed:', err);
      this.setStatus(t('chess.notSaved'), true);
    });
    this.afterChange(ended, true);
  }

  /** `ended`: the game as the op ended it (the table may already show a fresh one). */
  private afterChange(ended: ChessGame | null, ours: boolean): void {
    this.setGame(this.game);
    this.selected = -1;
    this.promoting = null;
    if (!this.viewing) this.browse = null;
    if (ended) this.lastEnded = ended;
    const match = ended ? matchOf(ended, this.table, Date.now()) : null;
    if (match && !this.matches.some((m) => m.id === match.id)) {
      this.matches.unshift(match);
      // Whoever ended the game writes it down, so each match is saved once.
      if (ours) this.deps.store.saveChessMatch(match).catch((err) => console.warn('[chess] match not saved:', err));
    }
    this.refresh();
  }

  private setGame(g: ChessGame): void {
    this.game = g;
    this.play = replay(g.moves) ?? replay([])!;
  }

  private setStatus(text: string, bad = false): void {
    this.status = text;
    this.statusBad = bad;
    const el = this.root?.querySelector<HTMLSpanElement>('.wb-status');
    if (el) {
      el.textContent = text;
      el.classList.toggle('bad', bad);
    }
  }

  // ---------- building ----------

  private build(title: string): void {
    const root = (this.root = document.createElement('div'));
    root.id = 'chess';
    root.style.setProperty('--pieces', `url("${piecesUrl}")`);
    root.innerHTML = `
      <div class="wb-head">
        <b class="wb-title"></b>
        <span class="chess-spacer"></span>
        <span class="wb-status"></span>
        <button type="button" class="wb-close" title="${t('wb.close')}">✕</button>
      </div>
      <div class="chess-body">
        <div class="chess-stage">
          <div class="chess-bar top"></div>
          <div class="chess-wrap"><div class="chess-board"></div><div class="chess-promo hidden"></div></div>
          <div class="chess-bar bottom"></div>
        </div>
        <div class="chess-side"></div>
      </div>`;
    root.querySelector('.wb-title')!.textContent = title;
    root.querySelector('.wb-close')!.addEventListener('click', () => this.close());
    root.querySelector('.chess-board')!.addEventListener('click', this.onBoardClick);
    addEventListener('keydown', this.onKey, true);
    document.body.appendChild(root);
    this.setStatus(this.status, this.statusBad);
    this.tick = setInterval(this.onTick, TICK_MS);
    this.refresh();
  }

  /**
   * Esc closes (or cancels a promotion / a pick); ← / → step through a finished game. Nothing
   * reaches the game while the table is open.
   */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.root) return;
    e.stopPropagation();
    const shown = this.shown();
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && shown.done && shown.moves.length) {
      e.preventDefault();
      const at = this.browse ?? shown.moves.length;
      this.browseTo(Math.max(0, Math.min(shown.moves.length, at + (e.key === 'ArrowLeft' ? -1 : 1))));
      return;
    }
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (this.promoting || this.selected >= 0) {
      this.promoting = null;
      this.selected = -1;
      this.refresh();
    } else this.close();
  };

  /** Clocks count down; the side to move's flag falls at 0 (claimed by a seated player). */
  private readonly onTick = (): void => {
    const g = this.game;
    if (!this.root || !g.clock || !inProgress(g) || this.viewing) return;
    this.renderBars();
    const turn = this.play.pos.turn;
    const key = `${g.id}:${g.moves.length}`;
    if (this.mySeat() && timeLeft(g, turn, Date.now()) <= 0 && this.flagged !== key) {
      this.flagged = key;
      this.local({ kind: 'flag', game: g.id, by: this.deps.name(), at: Date.now() });
    }
  };

  // ---------- what the board shows ----------

  /** Our colour if we're seated (black sees the board turned around). */
  private mySeat(): Color | null {
    return seatOf(this.game, this.deps.name());
  }

  /** We may move now: seated, both seats taken, our turn, the game not over, not replaying a match. */
  private canMove(): boolean {
    const me = this.mySeat();
    return !this.viewing && !!me && !!this.game.white && !!this.game.black && !this.game.result && this.play.pos.turn === me;
  }

  /** A finished game nobody sits at any more: the table looks fresh; the next to sit starts a new game. */
  private idle(): boolean {
    return !!this.game.result && !this.game.white && !this.game.black;
  }

  private shown(): Shown {
    const m = this.viewing;
    if (m) return { key: m.id, moves: m.moves, white: m.white, black: m.black, done: true };
    const g = this.game;
    if (this.idle()) return { key: g.id, moves: [], white: '', black: '', done: false };
    return { key: g.id, moves: g.moves, white: g.white, black: g.black, done: !!g.result };
  }

  /** The position on the board: the shown moves, up to the browsed one. */
  private board(): Replay {
    const s = this.shown();
    if (s.moves === this.game.moves && this.browse === null) return this.play;
    return replay(this.browse === null ? s.moves : s.moves.slice(0, this.browse)) ?? this.play;
  }

  private browseTo(ply: number | null): void {
    this.browse = ply;
    this.selected = -1;
    this.refresh();
  }

  /** Ids for the fresh game a `sit` / `stand` opens when the game is over. */
  private next(): { next: string; started: number } {
    return { next: newChessId(), started: Date.now() };
  }

  // ---------- the board ----------

  private renderBoard(): void {
    const el = this.root!.querySelector<HTMLDivElement>('.chess-board')!;
    const r = this.board();
    const flip = this.mySeat() === 'b';
    const targets = this.selected >= 0 ? legalMoves(r.pos).filter((m) => m.from === this.selected).map((m) => m.to) : [];
    const checked = inCheck(r.pos) ? r.pos.board.indexOf(r.pos.turn === 'w' ? 'K' : 'k') : -1;
    const cells: string[] = [];
    for (let i = 0; i < 64; i++) {
      const sq = flip ? 63 - i : i;
      const p = r.pos.board[sq]!;
      const cls = [
        'chess-sq',
        ((sq >> 3) + (sq % 8)) % 2 ? 'dark' : 'light',
        r.last && (r.last.from === sq || r.last.to === sq) ? 'last' : '',
        sq === this.selected ? 'sel' : '',
        targets.includes(sq) ? (p ? 'target take' : 'target') : '',
        sq === checked ? 'check' : '',
      ].filter(Boolean);
      const rank = i % 8 === 0 ? `<b class="rank">${8 - (sq >> 3)}</b>` : '';
      const file = i >= 56 ? `<b class="file">${'abcdefgh'[sq % 8]}</b>` : '';
      cells.push(`<button type="button" class="${cls.join(' ')}" data-sq="${sq}" aria-label="${squareName(sq)}">${p ? pieceHtml(p) : ''}${rank}${file}</button>`);
    }
    el.innerHTML = cells.join('');
    el.classList.toggle('live', this.canMove() && this.browse === null);

    const promo = this.root!.querySelector<HTMLDivElement>('.chess-promo')!;
    promo.classList.toggle('hidden', !this.promoting);
    if (this.promoting) {
      const me = this.mySeat()!;
      promo.innerHTML = (['q', 'r', 'b', 'n'] as Promo[])
        .map((k) => `<button type="button" data-promo="${k}" title="${t(`chess.piece.${k}`)}">${pieceHtml(k, me)}</button>`)
        .join('');
      promo.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => this.move({ ...this.promoting!, promo: b.dataset.promo as Promo })),
      );
    }
  }

  private readonly onBoardClick = (e: Event): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.chess-sq');
    if (!btn || !this.canMove() || this.promoting || this.browse !== null) return;
    const sq = Number(btn.dataset.sq);
    const pos = this.play.pos;
    const moves = legalMoves(pos);
    if (this.selected >= 0) {
      const to = moves.filter((m) => m.from === this.selected && m.to === sq);
      if (to.length > 1) {
        this.promoting = { from: this.selected, to: sq };
        return this.renderBoard();
      }
      if (to.length === 1) return this.move(to[0]!);
    }
    this.selected = colorOf(pos.board[sq]!) === pos.turn && moves.some((m) => m.from === sq) && sq !== this.selected ? sq : -1;
    this.renderBoard();
  };

  private move(m: Move): void {
    this.local({ kind: 'move', game: this.game.id, ply: this.game.moves.length, uci: toUci(m), by: this.deps.name(), at: Date.now() });
  }

  // ---------- the players' bars: name, captured pieces, material, clock ----------

  private renderBars(): void {
    const s = this.shown();
    const r = this.board();
    const bottom: Color = this.mySeat() === 'b' ? 'b' : 'w';
    const balance = materialBalance(r.pos.board);
    const live = !this.viewing && !this.idle();
    for (const [cls, color] of [['bottom', bottom], ['top', bottom === 'w' ? 'b' : 'w']] as const) {
      const bar = this.root!.querySelector<HTMLDivElement>(`.chess-bar.${cls}`)!;
      const name = (color === 'w' ? s.white : s.black) || t(color === 'w' ? 'chess.white' : 'chess.black');
      const taken = [...r.captured[color]].sort((a, b) => VALUE[b]! - VALUE[a]!);
      const lead = color === 'w' ? balance : -balance;
      const g = this.game;
      const clock = live && g.clock ? timeLeft(g, color, Date.now()) : Infinity;
      const running = live && !!g.clock && !g.result && g.clock.at > 0 && this.play.pos.turn === color;
      const html =
        `<span class="chess-bar-king">${pieceHtml('k', color)}</span>` +
        `<span class="chess-bar-name"></span>` +
        `<span class="chess-cap">${taken.map((k) => pieceHtml(k, color === 'w' ? 'b' : 'w')).join('')}${lead > 0 ? `<em>+${lead}</em>` : ''}</span>` +
        (Number.isFinite(clock)
          ? `<span class="chess-clock${running ? ' on' : ''}${clock < 20_000 ? ' low' : ''}">${formatClock(clock)}</span>`
          : '');
      if (bar.dataset.html !== html + name) {
        bar.dataset.html = html + name;
        bar.innerHTML = html;
        bar.querySelector('.chess-bar-name')!.textContent = name;
      }
      bar.classList.toggle('turn', live && !this.game.result && !!this.game.white && !!this.game.black && this.play.pos.turn === color);
    }
  }

  // ---------- the side panel ----------

  private refresh(): void {
    if (!this.root) return;
    this.renderBoard();
    this.renderBars();
    this.renderSide();
  }

  private renderSide(): void {
    const side = this.root!.querySelector<HTMLDivElement>('.chess-side')!;
    const g = this.game;
    const me = this.deps.name();
    const mine = this.mySeat();
    const online = this.deps.online();
    side.innerHTML = '';

    if (this.viewing) {
      side.append(this.matchView(this.viewing));
      return;
    }

    for (const color of ['w', 'b'] as const) {
      const who = color === 'w' ? g.white : g.black;
      const row = el('div', 'chess-seat');
      const king = el('span', 'chess-seat-king');
      king.innerHTML = pieceHtml('k', color);
      row.append(king, el('span', 'chess-who', who || t('chess.free')));
      if (!who && !mine && !inProgress(g)) row.append(button(t('chess.sit'), () => this.local({ kind: 'sit', color, by: me, ...this.next() }), 'primary'));
      else if (who === me) row.append(button(t('chess.stand'), () => this.stand(color)));
      else if (who && !online.has(who)) row.append(button(t('chess.freeSeat'), () => this.local({ kind: 'stand', color, by: me, force: true, ...this.next() })));
      side.append(row);
    }

    side.append(this.timeControl());
    side.append(el('div', 'chess-state', this.stateLine()));
    const last = this.idle() ? g : this.lastEnded && this.lastEnded.id !== g.id ? this.lastEnded : null;
    if (last?.result) {
      const who = last.result.winner === 'w' ? last.white : last.black;
      side.append(el('div', 'chess-last', t('chess.lastGame', { result: resultText(last.result.winner, last.result.reason, who) })));
    }

    const actions = el('div', 'chess-actions');
    if (mine && inProgress(g)) {
      const theirOffer = g.drawOffer && g.drawOffer !== mine;
      actions.append(
        button(theirOffer ? t('chess.acceptDraw') : g.drawOffer === mine ? t('chess.drawOffered') : t('chess.offerDraw'), () =>
          this.local({ kind: 'draw', game: g.id, by: me }),
        ),
        button(t('chess.resign'), () => {
          if (confirm(t('chess.confirmResign'))) this.local({ kind: 'resign', game: g.id, by: me });
        }, 'danger'),
      );
      if (g.drawOffer === mine) (actions.firstChild as HTMLButtonElement).disabled = true;
    }
    if (mine && g.result) actions.append(button(t('chess.rematch'), () => this.local({ kind: 'new', game: newChessId(), started: Date.now(), by: me }), 'primary'));
    if (actions.childElementCount) side.append(actions);

    side.append(this.moveList(this.shown()));
    side.append(this.history());
  }

  /** Seated players pick the clock before the game (it carries over to the next one); others see it. */
  private timeControl(): HTMLElement {
    const g = this.game;
    const row = el('label', 'chess-time');
    row.append(el('span', '', '⏱ ' + t('chess.time')));
    if (this.mySeat() && !inProgress(g)) {
      const select = document.createElement('select');
      const value = g.clock ? `${g.clock.initial},${g.clock.increment}` : '0,0';
      const options: [number, number][] = [[0, 0], ...TIME_CONTROLS.map(([m, s]) => [m * 60_000, s * 1000] as [number, number])];
      for (const [initial, increment] of options) {
        const o = new Option(initial ? controlLabel(initial, increment) : t('chess.noClock'), `${initial},${increment}`);
        o.selected = o.value === value;
        select.add(o);
      }
      select.addEventListener('change', () => {
        const [initial, increment] = select.value.split(',').map(Number) as [number, number];
        this.local({ kind: 'time', by: this.deps.name(), initial, increment });
      });
      row.append(select);
    } else row.append(el('b', '', g.clock ? controlLabel(g.clock.initial, g.clock.increment) : t('chess.noClock')));
    return row;
  }

  /** Leaving mid-game loses it, so ask first. */
  private stand(color: Color): void {
    if (inProgress(this.game) && !confirm(t('chess.confirmLeave'))) return;
    this.local({ kind: 'stand', color, by: this.deps.name(), ...this.next() });
  }

  private stateLine(): string {
    const g = this.game;
    const name = (c: Color | null) => (c === 'w' ? g.white || t('chess.white') : c === 'b' ? g.black || t('chess.black') : '');
    if (this.idle()) return t('chess.waiting');
    if (g.result) return resultText(g.result.winner, g.result.reason, name(g.result.winner));
    if (!g.white || !g.black) return t('chess.waiting');
    const turn = this.play.pos.turn;
    const offer = g.drawOffer ? ' · ' + t('chess.drawOfferBy', { name: name(g.drawOffer) }) : '';
    const clock = g.clock && !g.clock.at ? ' · ' + t('chess.clockStarts') : '';
    return (inCheck(this.play.pos) ? t('chess.check') + ' ' : '') + t('chess.toMove', { name: name(turn) }) + offer + clock;
  }

  // ---------- moves and their review ----------

  /** The moves, two per row; once the game is over each gets the engine's verdict and can be clicked. */
  private moveList(s: Shown): HTMLElement {
    const box = el('div', 'chess-review');
    const reviews = s.done ? this.reviewsFor(s) : [];
    if (s.done && s.moves.length) box.append(this.summary(s, reviews));
    const sans = (replay(s.moves) ?? this.play).sans;
    const list = el('ol', 'chess-moves');
    for (let i = 0; i < sans.length; i += 2) {
      const li = el('li', '');
      for (const ply of [i, i + 1]) {
        if (ply >= sans.length) break;
        const rv = reviews[ply];
        const cell = el(s.done ? 'button' : 'span', 'chess-mv' + (this.browse === ply + 1 ? ' on' : '') + (rv ? ` ${rv.label}` : ''));
        cell.textContent = sans[ply]!;
        if (rv) {
          cell.append(el('i', 'badge', BADGE[rv.label]));
          cell.title = `${t(`chess.label.${rv.label}`)}${rv.best !== rv.uci ? ' · ' + t('chess.bestWas', { move: rv.bestSan }) : ''}`;
        }
        if (s.done) cell.addEventListener('click', () => this.browseTo(ply + 1));
        li.append(cell);
      }
      list.append(li);
    }
    if (!sans.length) list.append(el('li', 'chess-empty', t('chess.noMoves')));
    box.append(list);
    if (s.done && this.browse !== null) {
      const rv = this.browse > 0 ? reviews[this.browse - 1] : undefined;
      const nav = el('div', 'chess-browse');
      nav.append(
        button('⏮', () => this.browseTo(0)),
        button('◀', () => this.browseTo(Math.max(0, this.browse! - 1))),
        button('▶', () => this.browseTo(Math.min(s.moves.length, this.browse! + 1))),
        button('⏭', () => this.browseTo(null)),
      );
      box.append(nav);
      if (rv) box.append(el('div', `chess-verdict ${rv.label}`, `${rv.san}: ${t(`chess.label.${rv.label}`)}${rv.best !== rv.uci ? ' — ' + t('chess.bestWas', { move: rv.bestSan }) : ''}`));
    } else queueMicrotask(() => (list.scrollTop = list.scrollHeight));
    return box;
  }

  /** Accuracy and mistakes per player, or how far the review got. */
  private summary(s: Shown, reviews: (MoveReview | null)[]): HTMLElement {
    const box = el('div', 'chess-summary');
    const done = reviews.filter((r) => r !== undefined).length;
    if (done < s.moves.length) {
      box.append(el('div', 'chess-empty', t('chess.reviewing', { n: done, total: s.moves.length })));
      return box;
    }
    for (const color of ['w', 'b'] as const) {
      const mine = reviews.filter((r, ply): r is MoveReview => !!r && (ply % 2 === 0) === (color === 'w'));
      const sum = summarize(mine);
      const row = el('div', 'chess-acc');
      const king = el('span', 'chess-seat-king');
      king.innerHTML = pieceHtml('k', color);
      row.append(
        king,
        el('span', 'chess-who', (color === 'w' ? s.white : s.black) || t(color === 'w' ? 'chess.white' : 'chess.black')),
        el('b', '', `${Math.round(sum.accuracy)}%`),
        el('small', '', t('chess.mistakes', { i: sum.inaccuracy, m: sum.mistake, b: sum.blunder })),
      );
      box.append(row);
    }
    return box;
  }

  /** Reviews of a finished game so far, asking the worker for the rest. */
  private reviewsFor(s: Shown): (MoveReview | null)[] {
    const have = this.reviews.get(s.key) ?? [];
    this.reviews.set(s.key, have);
    const asked = this.requested.get(s.key) ?? 0;
    if (asked < s.moves.length) {
      this.requested.set(s.key, s.moves.length);
      const job: ReviewJob = { key: s.key, moves: s.moves.slice(), from: asked };
      this.reviewer().postMessage(job);
    }
    return have;
  }

  private reviewer(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./chess-review-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<ReviewResult>) => {
        const { key, ply, review } = e.data;
        const list = this.reviews.get(key);
        if (!list) return;
        list[ply] = review;
        // Many arrive at once: redraw the panel once per frame.
        cancelAnimationFrame(this.reviewRaf);
        this.reviewRaf = requestAnimationFrame(() => this.root && this.shown().key === key && this.renderSide());
      };
    }
    return this.worker;
  }

  private history(): HTMLElement {
    const box = el('div', 'chess-history');
    const me = this.deps.name();
    const rec = recordOf(this.matches, me);
    box.append(el('b', '', t('chess.history')));
    if (rec.won + rec.lost + rec.drawn) box.append(el('div', 'chess-record', t('chess.record', { name: me, ...rec })));
    if (!this.matches.length) box.append(el('div', 'chess-empty', t('chess.noMatches')));
    for (const m of this.matches) {
      const score = m.winner === 'w' ? '1–0' : m.winner === 'b' ? '0–1' : '½–½';
      const row = button('', () => {
        this.viewing = m;
        this.browse = null;
        this.refresh();
      }, 'chess-match');
      const n = Math.ceil(m.moves.length / 2);
      row.append(
        el('span', '', `${m.white} ${score} ${m.black}`),
        el('small', '', `${t(`chess.reason.${m.reason}`)} · ${new Date(m.ended).toLocaleDateString()} · ${n === 1 ? t('chess.moveCountOne') : t('chess.moveCount', { n })}`),
      );
      box.append(row);
    }
    return box;
  }

  /** A finished match on the board, its rated moves and a way back to the table. */
  private matchView(m: ChessMatch): HTMLElement {
    const box = el('div', 'chess-viewing');
    box.append(
      button(t('chess.back'), () => {
        this.viewing = null;
        this.browse = null;
        this.refresh();
      }, 'primary'),
      el('b', '', `${m.white} – ${m.black}`),
      el('div', 'chess-state', resultText(m.winner, m.reason, m.winner === 'w' ? m.white : m.winner === 'b' ? m.black : '')),
      el('small', '', new Date(m.ended).toLocaleString()),
      this.moveList(this.shown()),
    );
    return box;
  }
}

function resultText(winner: Color | null, reason: ChessReason, name: string): string {
  const how = t(`chess.reason.${reason}`);
  return winner ? t('chess.wins', { name, how }) : t('chess.draw', { how });
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', cls, text) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
