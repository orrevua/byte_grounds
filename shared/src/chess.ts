/**
 * Chess for the chess tables (spec: docs/specs/chess-table.md): the rules (legal moves, check,
 * mate, draws, SAN), and the table's game state with the ops players send. Pure, no deps.
 *
 * Squares are 0..63, a8 = 0, h8 = 7, a1 = 56, h1 = 63 (row 0 = rank 8). Pieces are FEN letters
 * (`PNBRQK` white, `pnbrqk` black), '' = empty. Moves travel as UCI (`e2e4`, `e7e8q`).
 */

export type Color = 'w' | 'b';
export type Promo = 'q' | 'r' | 'b' | 'n';

export interface Position {
  board: string[];
  turn: Color;
  /** Castling rights still left, a subset of `KQkq`. */
  castling: string;
  /** En passant target square, or -1. */
  ep: number;
  /** Half-moves since the last capture or pawn move (fifty-move rule). */
  half: number;
}

export interface Move {
  from: number;
  to: number;
  promo?: Promo;
}

const START = 'rnbqkbnrpppppppp' + ' '.repeat(32) + 'PPPPPPPPRNBQKBNR';

export function startPosition(): Position {
  return { board: [...START].map((c) => (c === ' ' ? '' : c)), turn: 'w', castling: 'KQkq', ep: -1, half: 0 };
}

export const colorOf = (p: string): Color | null => (p === '' ? null : p === p.toUpperCase() ? 'w' : 'b');
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const at = (r: number, f: number): number => (r >= 0 && r < 8 && f >= 0 && f < 8 ? r * 8 + f : -1);

export function squareName(sq: number): string {
  return 'abcdefgh'[sq % 8]! + String(8 - (sq >> 3));
}

export function parseSquare(s: string): number {
  const f = s.charCodeAt(0) - 97;
  const r = 8 - Number(s[1]);
  return at(r, f);
}

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]] as const;
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] as const;
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

/** Is `sq` attacked by any piece of color `by`? */
export function attacked(board: readonly string[], sq: number, by: Color): boolean {
  const r = sq >> 3;
  const f = sq % 8;
  const is = (s: number, piece: string) => s >= 0 && board[s] === (by === 'w' ? piece.toUpperCase() : piece);
  // A white pawn attacks up the board (toward row 0), so it sits one row below the square.
  const pr = by === 'w' ? r + 1 : r - 1;
  if (is(at(pr, f - 1), 'p') || is(at(pr, f + 1), 'p')) return true;
  if (KNIGHT.some(([dr, df]) => is(at(r + dr, f + df), 'n'))) return true;
  if (KING.some(([dr, df]) => is(at(r + dr, f + df), 'k'))) return true;
  const slide = (dirs: readonly (readonly [number, number])[], pieces: string) =>
    dirs.some(([dr, df]) => {
      for (let i = 1; ; i++) {
        const s = at(r + dr * i, f + df * i);
        if (s < 0) return false;
        if (board[s] === '') continue;
        return colorOf(board[s]!) === by && pieces.includes(board[s]!.toLowerCase());
      }
    });
  return slide(ROOK, 'rq') || slide(BISHOP, 'bq');
}

export function inCheck(pos: Position): boolean {
  const king = pos.board.indexOf(pos.turn === 'w' ? 'K' : 'k');
  return king >= 0 && attacked(pos.board, king, other(pos.turn));
}

function pseudoMoves(pos: Position): Move[] {
  const out: Move[] = [];
  const { board, turn } = pos;
  const enemy = other(turn);
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]!;
    if (colorOf(p) !== turn) continue;
    const r = sq >> 3;
    const f = sq % 8;
    const kind = p.toLowerCase();
    const add = (to: number) => {
      if (to >= 0 && colorOf(board[to]!) !== turn) out.push({ from: sq, to });
    };
    if (kind === 'p') {
      const dir = turn === 'w' ? -1 : 1;
      const last = turn === 'w' ? 0 : 7;
      const push = (to: number) => {
        if ((to >> 3) === last) for (const promo of ['q', 'r', 'b', 'n'] as const) out.push({ from: sq, to, promo });
        else out.push({ from: sq, to });
      };
      const one = at(r + dir, f);
      if (one >= 0 && board[one] === '') {
        push(one);
        const two = at(r + 2 * dir, f);
        if (r === (turn === 'w' ? 6 : 1) && board[two] === '') push(two);
      }
      for (const df of [-1, 1]) {
        const to = at(r + dir, f + df);
        if (to >= 0 && (colorOf(board[to]!) === enemy || to === pos.ep)) push(to);
      }
    } else if (kind === 'n' || kind === 'k') {
      for (const [dr, df] of kind === 'n' ? KNIGHT : KING) add(at(r + dr, f + df));
    } else {
      const dirs = kind === 'r' ? ROOK : kind === 'b' ? BISHOP : [...ROOK, ...BISHOP];
      for (const [dr, df] of dirs) {
        for (let i = 1; ; i++) {
          const to = at(r + dr * i, f + df * i);
          if (to < 0) break;
          if (board[to] === '') out.push({ from: sq, to });
          else {
            if (colorOf(board[to]!) === enemy) out.push({ from: sq, to });
            break;
          }
        }
      }
    }
  }
  // Castling: king and rook unmoved (rights), squares between empty, king not in, through or into check.
  const home = turn === 'w' ? 60 : 4;
  const free = (...s: number[]) => s.every((x) => board[x] === '');
  const safe = (...s: number[]) => s.every((x) => !attacked(board, x, enemy));
  const [k, q] = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
  if (board[home] === (turn === 'w' ? 'K' : 'k')) {
    if (pos.castling.includes(k) && free(home + 1, home + 2) && safe(home, home + 1, home + 2)) out.push({ from: home, to: home + 2 });
    if (pos.castling.includes(q) && free(home - 1, home - 2, home - 3) && safe(home, home - 1, home - 2)) out.push({ from: home, to: home - 2 });
  }
  return out;
}

/** The position after `m` (assumed legal or at least pseudo-legal). */
export function makeMove(pos: Position, m: Move): Position {
  const board = pos.board.slice();
  const p = board[m.from]!;
  const kind = p.toLowerCase();
  const capture = board[m.to] !== '';
  board[m.to] = m.promo ? (pos.turn === 'w' ? m.promo.toUpperCase() : m.promo) : p;
  board[m.from] = '';
  if (kind === 'p' && m.to === pos.ep) board[m.to + (pos.turn === 'w' ? 8 : -8)] = '';
  if (kind === 'k' && Math.abs(m.to - m.from) === 2) {
    const [rookFrom, rookTo] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
    board[rookTo] = board[rookFrom]!;
    board[rookFrom] = '';
  }
  let castling = pos.castling;
  if (p === 'K') castling = castling.replace(/[KQ]/g, '');
  if (p === 'k') castling = castling.replace(/[kq]/g, '');
  const corners: Record<number, string> = { 63: 'K', 56: 'Q', 7: 'k', 0: 'q' };
  for (const sq of [m.from, m.to]) if (corners[sq]) castling = castling.replace(corners[sq]!, '');
  return {
    board,
    turn: other(pos.turn),
    castling,
    ep: kind === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1,
    half: kind === 'p' || capture ? 0 : pos.half + 1,
  };
}

export function legalMoves(pos: Position): Move[] {
  return pseudoMoves(pos).filter((m) => {
    const next = makeMove(pos, m);
    return !inCheck({ ...next, turn: pos.turn });
  });
}

export function toUci(m: Move): string {
  return squareName(m.from) + squareName(m.to) + (m.promo ?? '');
}

export const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** The legal move written `uci` in `pos`, if it is one. */
export function findMove(pos: Position, uci: string): Move | undefined {
  if (!UCI_RE.test(uci)) return undefined;
  return legalMoves(pos).find((m) => toUci(m) === uci);
}

/** Standard algebraic notation of a legal move (`Nf3`, `exd5`, `O-O`, `e8=Q#`). */
export function toSan(pos: Position, m: Move): string {
  const p = pos.board[m.from]!.toLowerCase();
  let san: string;
  if (p === 'k' && Math.abs(m.to - m.from) === 2) san = m.to > m.from ? 'O-O' : 'O-O-O';
  else {
    const capture = pos.board[m.to] !== '' || (p === 'p' && m.to === pos.ep);
    if (p === 'p') san = (capture ? 'abcdefgh'[m.from % 8]! + 'x' : '') + squareName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    else {
      const rivals = legalMoves(pos).filter((o) => o.to === m.to && o.from !== m.from && pos.board[o.from]!.toLowerCase() === p);
      let dis = '';
      if (rivals.length) {
        const sameFile = rivals.some((o) => o.from % 8 === m.from % 8);
        const sameRank = rivals.some((o) => o.from >> 3 === m.from >> 3);
        dis = !sameFile ? 'abcdefgh'[m.from % 8]! : !sameRank ? String(8 - (m.from >> 3)) : squareName(m.from);
      }
      san = p.toUpperCase() + dis + (capture ? 'x' : '') + squareName(m.to);
    }
  }
  const next = makeMove(pos, m);
  if (inCheck(next)) san += legalMoves(next).length ? '+' : '#';
  return san;
}

/** Neither side can mate: K v K, K+B v K, K+N v K, K+B v K+B with bishops on the same colour. */
function insufficient(board: readonly string[]): boolean {
  const rest = board.map((p, sq) => ({ p: p.toLowerCase(), sq })).filter(({ p }) => p !== '' && p !== 'k');
  if (rest.length === 0) return true;
  if (rest.length === 1) return rest[0]!.p === 'b' || rest[0]!.p === 'n';
  const shade = (sq: number) => ((sq >> 3) + (sq % 8)) % 2;
  return rest.every(({ p }) => p === 'b') && rest.every(({ sq }) => shade(sq) === shade(rest[0]!.sq));
}

export type ChessReason = 'checkmate' | 'resign' | 'stalemate' | 'agreement' | 'fifty' | 'repetition' | 'material' | 'abandon' | 'timeout';

export interface ChessResult {
  /** null = a draw. */
  winner: Color | null;
  reason: ChessReason;
}

export interface Replay {
  pos: Position;
  sans: string[];
  /** The last move, for highlighting. */
  last: Move | null;
  /** How the moves ended the game, if they did (mate or a draw by rule). */
  over: ChessResult | null;
  /** Pieces each side took (kinds, lowercase: `w` = the black pieces white captured). */
  captured: Record<Color, string[]>;
}

const POINTS: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** White's material minus black's, in pawns (promotions count as what they became). */
export function materialBalance(board: readonly string[]): number {
  let sum = 0;
  for (const p of board) if (p) sum += (colorOf(p) === 'w' ? 1 : -1) * POINTS[p.toLowerCase()]!;
  return sum;
}

const posKey = (p: Position) => p.board.join(',') + p.turn + p.castling + p.ep;

/** Play `moves` (UCI) from the start; null if one of them is illegal. */
export function replay(moves: readonly string[]): Replay | null {
  let pos = startPosition();
  const sans: string[] = [];
  const seen = new Map<string, number>([[posKey(pos), 1]]);
  let last: Move | null = null;
  let repeated = false;
  const captured: Record<Color, string[]> = { w: [], b: [] };
  for (const uci of moves) {
    const m = findMove(pos, uci);
    if (!m) return null;
    sans.push(toSan(pos, m));
    const taken = pos.board[m.to] || (pos.board[m.from]!.toLowerCase() === 'p' && m.to === pos.ep ? 'p' : '');
    if (taken) captured[pos.turn].push(taken.toLowerCase());
    pos = makeMove(pos, m);
    last = m;
    const k = posKey(pos);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    repeated = n >= 3;
  }
  let over: ChessResult | null = null;
  if (!legalMoves(pos).length) over = inCheck(pos) ? { winner: other(pos.turn), reason: 'checkmate' } : { winner: null, reason: 'stalemate' };
  else if (repeated) over = { winner: null, reason: 'repetition' };
  else if (pos.half >= 100) over = { winner: null, reason: 'fifty' };
  else if (insufficient(pos.board)) over = { winner: null, reason: 'material' };
  return { pos, sans, last, over, captured };
}

// ---------- the table's game ----------

export const CHESS_NAME_MAX = 40;
export const CHESS_ID_MAX = 40;
export const CHESS_MOVES_MAX = 600;

/** The game at a table. Seats hold player names ('' = free). */
export interface ChessGame {
  id: string;
  white: string;
  black: string;
  moves: string[];
  result: ChessResult | null;
  /** Who offered a draw that the other hasn't answered yet. */
  drawOffer: Color | null;
  started: number;
  /** Bumped by every applied op: the newer copy wins when two meet (`state`). */
  rev: number;
  /** The chess clock, if the players picked a time control (null = untimed). */
  clock: ChessClock | null;
}

/**
 * A chess clock (ms). The side to move's clock runs from `at` (the sender's time of the last move;
 * 0 = not running yet: it starts with White's first move). Times come from the movers' machines, so
 * a few hundred ms of clock skew between friends' computers is accepted.
 */
export interface ChessClock {
  initial: number;
  increment: number;
  w: number;
  b: number;
  at: number;
}

/** Time controls offered at the table: [minutes, increment seconds]. */
export const TIME_CONTROLS: readonly (readonly [number, number])[] = [[1, 0], [3, 0], [3, 2], [5, 0], [5, 3], [10, 0], [15, 10], [30, 0]];
const CLOCK_MAX = 3 * 3600_000;
const INCREMENT_MAX = 60_000;

/** A fresh clock with the same time control. */
export function freshClock(c: { initial: number; increment: number }): ChessClock {
  return { initial: c.initial, increment: c.increment, w: c.initial, b: c.initial, at: 0 };
}

const turnOf = (g: ChessGame): Color => (g.moves.length % 2 === 0 ? 'w' : 'b');

/** Time left on `color`'s clock at `now` (only the side to move's clock runs). */
export function timeLeft(g: ChessGame, color: Color, now: number): number {
  const c = g.clock;
  if (!c) return Infinity;
  const running = !g.result && c.at > 0 && turnOf(g) === color;
  return Math.max(0, c[color] - (running ? now - c.at : 0));
}

/** Who wins when `color` runs out of time: the other side, unless it has only a king (a draw). */
function timeoutResult(board: readonly string[], color: Color): ChessResult {
  const winner = other(color);
  const hasMore = board.some((p) => p && colorOf(p) === winner && p.toLowerCase() !== 'k');
  return { winner: hasMore ? winner : null, reason: 'timeout' };
}

/** A finished game, kept in the table's match history. */
export interface ChessMatch {
  id: string;
  table: string;
  white: string;
  black: string;
  winner: Color | null;
  reason: ChessReason;
  moves: string[];
  ended: number;
}

/**
 * `next` / `started`: the id and start time of the fresh game that `sit` / `stand` open when they
 * touch a finished game (the sender picks them, so every client resets to the same game).
 */
export type ChessOp =
  /** Take a free seat; at a finished game, a fresh game starts (whoever is still seated stays). */
  | { kind: 'sit'; color: Color; by: string; next?: string; started?: number }
  /**
   * Leave a seat; mid-game it loses the game. `force`: someone else frees the seat of a player who
   * left. A game that is (now) over is put in the history and a fresh one starts.
   */
  | { kind: 'stand'; color: Color; by: string; force?: boolean; next?: string; started?: number }
  /** `at`: the mover's time (ms), for the clock. */
  | { kind: 'move'; game: string; ply: number; uci: string; by: string; at?: number }
  /** Pick the time control (initial 0 = untimed), before the game starts or for the next one. */
  | { kind: 'time'; by: string; initial: number; increment: number }
  /** The side to move ran out of time (as of `at`). */
  | { kind: 'flag'; game: string; by: string; at: number }
  | { kind: 'resign'; game: string; by: string }
  /** Offer a draw, or accept the other's offer. */
  | { kind: 'draw'; game: string; by: string }
  /** Start the next game (colours swap after a finished one). */
  | { kind: 'new'; game: string; started: number; by: string }
  /** Someone's whole copy (answer to `hello`); adopted when newer. */
  | { kind: 'state'; state: ChessGame }
  /** Just opened the table: anyone with it open answers with `state`. */
  | { kind: 'hello' };

export function newChessId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function emptyGame(id = 'first', started = 0): ChessGame {
  return { id, white: '', black: '', moves: [], result: null, drawOffer: null, started, rev: 0, clock: null };
}

/** The seat `name` holds, if any. */
export function seatOf(g: ChessGame, name: string): Color | null {
  return name && g.white === name ? 'w' : name && g.black === name ? 'b' : null;
}

/** Moves made and nobody won or drew yet. */
export const inProgress = (g: ChessGame): boolean => g.moves.length > 0 && !g.result;

/** A fresh game in place of `g`, keeping whoever is still seated. */
function restart(g: ChessGame, id: string, started: number): void {
  Object.assign(g, emptyGame(id, started), { white: g.white, black: g.black, clock: g.clock && freshClock(g.clock) });
}

/**
 * Apply an op in place; false (unchanged) when it doesn't apply. `hello` never changes anything.
 * `onEnd` gets a copy of the game as it ends (the op gave it a result), before any fresh game
 * replaces it: that copy goes to the match history.
 */
export function applyChessOp(g: ChessGame, op: ChessOp, onEnd?: (ended: ChessGame) => void): boolean {
  const ended = () => onEnd?.(structuredClone(g));
  const seat = 'by' in op ? seatOf(g, op.by) : null;
  const sameGame = 'game' in op && op.kind !== 'new' ? op.game === g.id : true;
  if (!sameGame) return false;
  switch (op.kind) {
    case 'hello':
      return false;
    case 'state': {
      const s = op.state;
      const newer = s.id === g.id ? s.rev > g.rev : s.started > g.started || (s.started === g.started && s.id > g.id);
      if (!newer) return false;
      Object.assign(g, structuredClone(s));
      return true;
    }
    case 'sit': {
      const key = op.color === 'w' ? 'white' : 'black';
      if (g[key] || seat || inProgress(g)) return false;
      if (g.result && op.next) restart(g, op.next, op.started ?? g.started);
      g[key] = op.by;
      break;
    }
    case 'stand': {
      const key = op.color === 'w' ? 'white' : 'black';
      if (!g[key] || (!op.force && g[key] !== op.by)) return false;
      if (inProgress(g)) {
        g.result = { winner: other(op.color), reason: op.force ? 'abandon' : 'resign' };
        ended();
      }
      g[key] = '';
      g.drawOffer = null;
      if (g.result && op.next) restart(g, op.next, op.started ?? g.started);
      break;
    }
    case 'move': {
      if (g.result || op.ply !== g.moves.length || !g.white || !g.black) return false;
      const r = replay(g.moves);
      if (!r || seat !== r.pos.turn || !findMove(r.pos, op.uci)) return false;
      const c = g.clock;
      const now = op.at ?? c?.at ?? 0;
      if (c && c.at > 0) {
        c[seat] -= Math.max(0, now - c.at);
        if (c[seat] <= 0) {
          // Too late: the flag fell before this move arrived.
          c[seat] = 0;
          g.result = timeoutResult(r.pos.board, seat);
          ended();
          break;
        }
        c[seat] += c.increment;
      }
      if (c) c.at = now;
      g.moves.push(op.uci);
      g.drawOffer = null;
      g.result = replay(g.moves)!.over;
      if (g.result) ended();
      break;
    }
    case 'time': {
      if (!seat || inProgress(g)) return false;
      g.clock = op.initial > 0 ? freshClock(op) : null;
      break;
    }
    case 'flag': {
      const c = g.clock;
      if (!seat || !c || !inProgress(g) || c.at <= 0) return false;
      const turn = turnOf(g);
      if (c[turn] - (op.at - c.at) > 0) return false;
      c[turn] = 0;
      g.result = timeoutResult(replay(g.moves)!.pos.board, turn);
      ended();
      break;
    }
    case 'resign':
      if (!seat || !inProgress(g)) return false;
      g.result = { winner: other(seat), reason: 'resign' };
      ended();
      break;
    case 'draw':
      if (!seat || !inProgress(g)) return false;
      if (g.drawOffer === other(seat)) g.result = { winner: null, reason: 'agreement' };
      else if (g.drawOffer === seat) return false;
      g.drawOffer = g.result ? null : seat;
      if (g.result) ended();
      break;
    case 'new': {
      if (!seat || inProgress(g) || op.game === g.id) return false;
      const swap = g.result !== null;
      Object.assign(g, emptyGame(op.game, op.started), swap ? { white: g.black, black: g.white } : { white: g.white, black: g.black }, {
        clock: g.clock && freshClock(g.clock),
      });
      break;
    }
  }
  g.rev++;
  return true;
}

/** The history record of a finished game (null while it isn't). */
export function matchOf(g: ChessGame, table: string, ended: number): ChessMatch | null {
  if (!g.result || !g.moves.length) return null;
  return { id: g.id, table, white: g.white, black: g.black, winner: g.result.winner, reason: g.result.reason, moves: g.moves.slice(), ended };
}

/** `name`'s wins, losses and draws in these matches. */
export function recordOf(matches: readonly ChessMatch[], name: string): { won: number; lost: number; drawn: number } {
  const r = { won: 0, lost: 0, drawn: 0 };
  for (const m of matches) {
    const seat = m.white === name ? 'w' : m.black === name ? 'b' : null;
    if (!seat) continue;
    if (m.winner === null) r.drawn++;
    else if (m.winner === seat) r.won++;
    else r.lost++;
  }
  return r;
}

// ---------- validation of what comes from the network / storage ----------

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isColor = (v: unknown): v is Color => v === 'w' || v === 'b';
const REASONS: readonly ChessReason[] = ['checkmate', 'resign', 'stalemate', 'agreement', 'fifty', 'repetition', 'material', 'abandon', 'timeout'];
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function normalizeResult(v: unknown): ChessResult | null | undefined {
  if (v === null) return null;
  const r = v as Partial<ChessResult> | undefined;
  if (!r || typeof r !== 'object' || !REASONS.includes(r.reason as ChessReason) || !(r.winner === null || isColor(r.winner))) return undefined;
  return { winner: r.winner, reason: r.reason as ChessReason };
}

const movesOk = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= CHESS_MOVES_MAX && v.every((m) => typeof m === 'string' && UCI_RE.test(m));

export function normalizeGame(v: unknown): ChessGame | null {
  const g = v as Partial<ChessGame> | undefined;
  if (!g || typeof g !== 'object') return null;
  if (!str(g.id, CHESS_ID_MAX) || !g.id || !str(g.white, CHESS_NAME_MAX) || !str(g.black, CHESS_NAME_MAX)) return null;
  if (!movesOk(g.moves) || !num(g.started) || !num(g.rev) || !(g.drawOffer === null || isColor(g.drawOffer))) return null;
  const result = normalizeResult(g.result);
  if (result === undefined || !replay(g.moves)) return null;
  const c = g.clock as Partial<ChessClock> | null | undefined;
  const clockOk = !!c && num(c.initial) && c.initial > 0 && c.initial <= CLOCK_MAX && num(c.increment) && c.increment <= INCREMENT_MAX &&
    num(c.w) && num(c.b) && num(c.at);
  const clock = clockOk ? { initial: c!.initial!, increment: c!.increment!, w: c!.w!, b: c!.b!, at: c!.at! } : null;
  return { id: g.id, white: g.white, black: g.black, moves: g.moves.slice(), result, drawOffer: g.drawOffer, started: g.started, rev: g.rev, clock };
}

export function normalizeMatch(v: unknown): ChessMatch | null {
  const m = v as Partial<ChessMatch> | undefined;
  if (!m || typeof m !== 'object' || !str(m.id, CHESS_ID_MAX) || !str(m.table, 80)) return null;
  if (!str(m.white, CHESS_NAME_MAX) || !str(m.black, CHESS_NAME_MAX) || !movesOk(m.moves) || !num(m.ended)) return null;
  if (!(m.winner === null || isColor(m.winner)) || !REASONS.includes(m.reason as ChessReason)) return null;
  return { id: m.id, table: m.table, white: m.white, black: m.black, winner: m.winner, reason: m.reason as ChessReason, moves: m.moves.slice(), ended: m.ended };
}

/** A clean copy of an op from the network, or null. */
export function normalizeChessOp(v: unknown): ChessOp | null {
  const o = v as Record<string, unknown> | undefined;
  if (!o || typeof o !== 'object') return null;
  const by = o.by;
  const named = str(by, CHESS_NAME_MAX) && by.length > 0;
  const game = str(o.game, CHESS_ID_MAX) && (o.game as string).length > 0;
  switch (o.kind) {
    case 'hello':
      return { kind: 'hello' };
    case 'state': {
      const state = normalizeGame(o.state);
      return state ? { kind: 'state', state } : null;
    }
    case 'sit':
    case 'stand': {
      if (!named || !isColor(o.color)) return null;
      const next = str(o.next, CHESS_ID_MAX) && o.next && num(o.started) ? { next: o.next as string, started: o.started as number } : {};
      return o.kind === 'sit'
        ? { kind: 'sit', color: o.color, by, ...next }
        : { kind: 'stand', color: o.color, by, ...(o.force === true ? { force: true } : {}), ...next };
    }
    case 'move':
      return named && game && Number.isInteger(o.ply) && num(o.ply) && typeof o.uci === 'string' && UCI_RE.test(o.uci)
        ? { kind: 'move', game: o.game as string, ply: o.ply as number, uci: o.uci, by, ...(num(o.at) ? { at: o.at } : {}) }
        : null;
    case 'time':
      return named && num(o.initial) && o.initial <= CLOCK_MAX && num(o.increment) && o.increment <= INCREMENT_MAX
        ? { kind: 'time', by, initial: o.initial, increment: o.increment }
        : null;
    case 'flag':
      return named && game && num(o.at) ? { kind: 'flag', game: o.game as string, by, at: o.at } : null;
    case 'resign':
    case 'draw':
      return named && game ? { kind: o.kind, game: o.game as string, by } : null;
    case 'new':
      return named && game && num(o.started) ? { kind: 'new', game: o.game as string, started: o.started, by } : null;
    default:
      return null;
  }
}
