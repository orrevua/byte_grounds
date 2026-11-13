import {
  applyChessOp,
  colorOf,
  emptyGame,
  inCheck,
  inProgress,
  legalMoves,
  matchOf,
  newChessId,
  recordOf,
  replay,
  seatOf,
  squareName,
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
import type { Store } from './store.ts';
import { t } from './i18n.ts';

/** Solid glyphs for both sides (coloured by CSS); U+FE0E keeps ♟ from turning into an emoji. */
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const glyph = (p: string) => GLYPH[p.toLowerCase()]! + '︎';

/** What the view needs from the game. */
export interface ChessDeps {
  store: Store;
  name: () => string;
  /** Names of everyone in the room now (us included): a seat of someone who left can be freed. */
  online: () => Set<string>;
  send: (table: string, op: ChessOp) => void;
}

/**
 * The chess table, full screen (spec: docs/specs/chess-table.md): the board, the two seats, the
 * game's moves and buttons, and the table's match history. Anyone can watch; the two seated
 * players move. Live over the room; the game and every finished match are saved.
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
  private status = '';
  private statusBad = false;
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
    const before = this.game.result;
    if (!applyChessOp(this.game, op)) return;
    this.afterChange(before, false);
  }

  /** Our own op: applied, sent, saved (and the match recorded when it ended the game). */
  private local(op: ChessOp): void {
    const before = this.game.result;
    if (!applyChessOp(this.game, op)) return;
    this.deps.send(this.table, op);
    this.deps.store.saveChessGame(this.table, this.game).catch((err) => {
      console.warn('[chess] save failed:', err);
      this.setStatus(t('chess.notSaved'), true);
    });
    this.afterChange(before, true);
  }

  private afterChange(before: ChessGame['result'], ours: boolean): void {
    this.setGame(this.game);
    this.selected = -1;
    this.promoting = null;
    const match = !before ? matchOf(this.game, this.table, Date.now()) : null;
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
    root.innerHTML = `
      <div class="wb-head">
        <b class="wb-title"></b>
        <span class="chess-spacer"></span>
        <span class="wb-status"></span>
        <button type="button" class="wb-close" title="${t('wb.close')}">✕</button>
      </div>
      <div class="chess-body">
        <div class="chess-stage"><div class="chess-board"></div><div class="chess-promo hidden"></div></div>
        <div class="chess-side"></div>
      </div>`;
    root.querySelector('.wb-title')!.textContent = title;
    root.querySelector('.wb-close')!.addEventListener('click', () => this.close());
    root.querySelector('.chess-board')!.addEventListener('click', this.onBoardClick);
    addEventListener('keydown', this.onKey, true);
    document.body.appendChild(root);
    this.setStatus(this.status, this.statusBad);
    this.refresh();
  }

  /** Esc closes (or cancels a promotion / a pick); nothing reaches the game while the table is open. */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.root) return;
    e.stopPropagation();
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (this.promoting || this.selected >= 0) {
      this.promoting = null;
      this.selected = -1;
      this.refresh();
    } else this.close();
  };

  // ---------- the board ----------

  /** Our colour if we're seated (black sees the board turned around). */
  private mySeat(): Color | null {
    return seatOf(this.game, this.deps.name());
  }

  /** We may move now: seated, both seats taken, our turn, the game not over, not replaying a match. */
  private canMove(): boolean {
    const me = this.mySeat();
    return !this.viewing && !!me && !!this.game.white && !!this.game.black && !this.game.result && this.play.pos.turn === me;
  }

  private shown(): Replay {
    return this.viewing ? (replay(this.viewing.moves) ?? this.play) : this.play;
  }

  private renderBoard(): void {
    const el = this.root!.querySelector<HTMLDivElement>('.chess-board')!;
    const r = this.shown();
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
      const rank = i % 8 === 0 ? `<i class="rank">${8 - (sq >> 3)}</i>` : '';
      const file = i >= 56 ? `<i class="file">${'abcdefgh'[sq % 8]}</i>` : '';
      const piece = p ? `<span class="pc ${colorOf(p)}">${glyph(p)}</span>` : '';
      cells.push(`<button type="button" class="${cls.join(' ')}" data-sq="${sq}" aria-label="${squareName(sq)}">${piece}${rank}${file}</button>`);
    }
    el.innerHTML = cells.join('');
    el.classList.toggle('live', this.canMove());

    const promo = this.root!.querySelector<HTMLDivElement>('.chess-promo')!;
    promo.classList.toggle('hidden', !this.promoting);
    if (this.promoting) {
      const me = this.mySeat()!;
      promo.innerHTML = (['q', 'r', 'b', 'n'] as Promo[])
        .map((k) => `<button type="button" data-promo="${k}" title="${t(`chess.piece.${k}`)}"><span class="pc ${me}">${glyph(k)}</span></button>`)
        .join('');
      promo.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => this.move({ ...this.promoting!, promo: b.dataset.promo as Promo })),
      );
    }
  }

  private readonly onBoardClick = (e: Event): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.chess-sq');
    if (!btn || !this.canMove() || this.promoting) return;
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
    this.local({ kind: 'move', game: this.game.id, ply: this.game.moves.length, uci: toUci(m), by: this.deps.name() });
  }

  // ---------- the side panel ----------

  private refresh(): void {
    if (!this.root) return;
    this.renderBoard();
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
      const row = el('div', 'chess-seat' + (!g.result && g.white && g.black && this.play.pos.turn === color ? ' turn' : ''));
      row.append(el('span', `pc ${color}`, glyph('k')), el('span', 'chess-who', who || t('chess.free')));
      if (!who && !mine && !inProgress(g)) row.append(button(t('chess.sit'), () => this.local({ kind: 'sit', color, by: me }), 'primary'));
      else if (who === me) row.append(button(t('chess.stand'), () => this.stand(color)));
      else if (who && !online.has(who)) row.append(button(t('chess.freeSeat'), () => this.local({ kind: 'stand', color, by: me, force: true })));
      side.append(row);
    }

    side.append(el('div', 'chess-state', this.stateLine()));

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

    side.append(this.moveList(this.play.sans));
    side.append(this.history());
  }

  /** Leaving mid-game loses it, so ask first. */
  private stand(color: Color): void {
    if (inProgress(this.game) && !confirm(t('chess.confirmLeave'))) return;
    this.local({ kind: 'stand', color, by: this.deps.name() });
  }

  private stateLine(): string {
    const g = this.game;
    const name = (c: Color | null) => (c === 'w' ? g.white || t('chess.white') : c === 'b' ? g.black || t('chess.black') : '');
    if (g.result) return resultText(g.result.winner, g.result.reason, name(g.result.winner));
    if (!g.white || !g.black) return t('chess.waiting');
    const turn = this.play.pos.turn;
    const offer = g.drawOffer ? ' · ' + t('chess.drawOfferBy', { name: name(g.drawOffer) }) : '';
    return (inCheck(this.play.pos) ? t('chess.check') + ' ' : '') + t('chess.toMove', { name: name(turn) }) + offer;
  }

  private moveList(sans: string[]): HTMLElement {
    const list = el('ol', 'chess-moves');
    for (let i = 0; i < sans.length; i += 2) list.append(el('li', '', `${sans[i]}${sans[i + 1] ? '  ' + sans[i + 1] : ''}`));
    if (!sans.length) list.append(el('li', 'chess-empty', t('chess.noMoves')));
    queueMicrotask(() => (list.scrollTop = list.scrollHeight));
    return list;
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
        this.refresh();
      }, 'chess-match');
      row.append(
        el('span', '', `${m.white} ${score} ${m.black}`),
        el('small', '', `${t(`chess.reason.${m.reason}`)} · ${new Date(m.ended).toLocaleDateString()} · ${t('chess.moveCount', { n: Math.ceil(m.moves.length / 2) })}`),
      );
      box.append(row);
    }
    return box;
  }

  /** A finished match on the board, its moves and a way back to the table. */
  private matchView(m: ChessMatch): HTMLElement {
    const box = el('div', 'chess-viewing');
    box.append(
      button(t('chess.back'), () => {
        this.viewing = null;
        this.refresh();
      }, 'primary'),
      el('b', '', `${m.white} – ${m.black}`),
      el('div', 'chess-state', resultText(m.winner, m.reason, m.winner === 'w' ? m.white : m.winner === 'b' ? m.black : '')),
      el('small', '', new Date(m.ended).toLocaleString()),
      this.moveList(replay(m.moves)?.sans ?? []),
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
