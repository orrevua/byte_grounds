/**
 * A small chess engine for the game review at the chess tables (spec: docs/specs/chess-table.md):
 * material + piece-square evaluation, fixed-depth alpha-beta with a capture search. Not strong,
 * but it sees hanging pieces and short tactics, which is what "how good was this move" needs.
 * Fixed depth keeps it deterministic: every client rates a game the same way.
 *
 * Board: Int8Array(64), a8 = 0 .. h1 = 63 like `chess.ts`; pieces 1..6 = P N B R Q K, white
 * positive, black negative. Moves are ints: from | to << 6 | promo << 12.
 */
import { findMove, legalMoves, makeMove, squareName, startPosition, toSan, type Position } from './chess.ts';

const VAL = [0, 100, 320, 330, 500, 900, 20000];
const CODE: Record<string, number> = { P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6, p: -1, n: -2, b: -3, r: -4, q: -5, k: -6 };
const MATE = 100000;
/** Search depth of the game review (plies, plus captures): ~50 ms a move. */
export const REVIEW_DEPTH = 4;
const INF = 1000000;

// Piece-square tables (white's view, a8 first), from the "simplified evaluation function".
// prettier-ignore
const PST: number[][] = [
  [],
  [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
   0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
   -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
   -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
   -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
   0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
];
// prettier-ignore
const KING_END = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30,
  -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];

const on = (r: number, f: number) => r >= 0 && r < 8 && f >= 0 && f < 8;
const steps = (sq: number, deltas: number[][]) =>
  deltas.filter(([dr, df]) => on((sq >> 3) + dr!, (sq % 8) + df!)).map(([dr, df]) => sq + dr! * 8 + df!);
const SQ = [...Array(64).keys()];
const KNIGHT = SQ.map((s) => steps(s, [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]));
const KING = SQ.map((s) => steps(s, [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]));
/** Rays per square: 0-3 rook directions, 4-7 bishop directions. */
const RAYS = SQ.map((s) =>
  [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]].map(([dr, df]) => {
    const out: number[] = [];
    for (let r = (s >> 3) + dr!, f = (s % 8) + df!; on(r, f); r += dr!, f += df!) out.push(r * 8 + f);
    return out;
  }),
);
/** Squares a pawn of each colour attacks `sq` from: [white, black]. */
const PAWN_FROM = SQ.map((s) => [steps(s, [[1, -1], [1, 1]]), steps(s, [[-1, -1], [-1, 1]])]);
const CASTLE_MASK = SQ.map((s) => ({ 60: 12, 63: 14, 56: 13, 4: 3, 7: 11, 0: 7 })[s] ?? 15);

class Board {
  b = new Int8Array(64);
  side = 1;
  castle = 0;
  ep = -1;
  private undo: number[] = [];

  constructor(pos: Position) {
    pos.board.forEach((p, i) => (this.b[i] = p ? CODE[p]! : 0));
    this.side = pos.turn === 'w' ? 1 : -1;
    for (const [c, bit] of [['K', 1], ['Q', 2], ['k', 4], ['q', 8]] as const) if (pos.castling.includes(c)) this.castle |= bit;
    this.ep = pos.ep;
  }

  attacked(sq: number, by: number): boolean {
    const b = this.b;
    for (const s of PAWN_FROM[sq]![by > 0 ? 0 : 1]!) if (b[s] === by) return true;
    for (const s of KNIGHT[sq]!) if (b[s] === 2 * by) return true;
    for (const s of KING[sq]!) if (b[s] === 6 * by) return true;
    const rays = RAYS[sq]!;
    for (let d = 0; d < 8; d++) {
      for (const s of rays[d]!) {
        const p = b[s]!;
        if (!p) continue;
        if (p === 5 * by || p === (d < 4 ? 4 : 3) * by) return true;
        break;
      }
    }
    return false;
  }

  king(side: number): number {
    return this.b.indexOf(6 * side);
  }

  inCheck(): boolean {
    return this.attacked(this.king(this.side), -this.side);
  }

  moves(capturesOnly: boolean): number[] {
    const { b, side } = this;
    const out: number[] = [];
    const add = (from: number, to: number, promo = 0) => out.push(from | (to << 6) | (promo << 12));
    const pawnTo = (from: number, to: number) => {
      if (to >> 3 === 0 || to >> 3 === 7) for (const pr of [5, 4, 3, 2]) add(from, to, pr);
      else add(from, to);
    };
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq]! * side;
      if (p <= 0) continue;
      if (p === 1) {
        const dir = side > 0 ? -8 : 8;
        const to = sq + dir;
        const promoting = to >> 3 === 0 || to >> 3 === 7;
        if (b[to] === 0 && (!capturesOnly || promoting)) {
          pawnTo(sq, to);
          if (!capturesOnly && sq >> 3 === (side > 0 ? 6 : 1) && b[to + dir] === 0) add(sq, to + dir);
        }
        for (const df of [-1, 1]) {
          const f = (sq % 8) + df;
          if (f < 0 || f > 7) continue;
          const t = to + df;
          if (b[t]! * side < 0 || t === this.ep) pawnTo(sq, t);
        }
      } else if (p === 2 || p === 6) {
        for (const t of (p === 2 ? KNIGHT : KING)[sq]!) {
          const q = b[t]! * side;
          if (q < 0 || (q === 0 && !capturesOnly)) add(sq, t);
        }
      } else {
        const rays = RAYS[sq]!;
        for (let d = p === 3 ? 4 : 0; d < (p === 4 ? 4 : 8); d++) {
          for (const t of rays[d]!) {
            const q = b[t]! * side;
            if (q > 0) break;
            if (q < 0 || !capturesOnly) add(sq, t);
            if (q < 0) break;
          }
        }
      }
    }
    if (!capturesOnly) {
      const [home, kBit, qBit] = side > 0 ? [60, 1, 2] : [4, 4, 8];
      const free = (...s: number[]) => s.every((x) => b[x] === 0);
      const safe = (...s: number[]) => s.every((x) => !this.attacked(x, -side));
      if (b[home] === 6 * side) {
        if (this.castle & kBit && b[home + 3] === 4 * side && free(home + 1, home + 2) && safe(home, home + 1, home + 2)) add(home, home + 2);
        if (this.castle & qBit && b[home - 4] === 4 * side && free(home - 1, home - 2, home - 3) && safe(home, home - 1, home - 2)) add(home, home - 2);
      }
    }
    return out;
  }

  make(m: number): void {
    const from = m & 63;
    const to = (m >> 6) & 63;
    const promo = (m >> 12) & 7;
    const b = this.b;
    const p = b[from]!;
    let capSq = to;
    let cap = b[to]!;
    if ((p === 1 || p === -1) && to === this.ep && cap === 0) {
      capSq = to + (p > 0 ? 8 : -8);
      cap = b[capSq]!;
      b[capSq] = 0;
    }
    this.undo.push(cap, capSq, this.castle, this.ep);
    b[to] = promo ? promo * Math.sign(p) : p;
    b[from] = 0;
    if (p === 6 || p === -6) {
      if (to - from === 2) [b[from + 1], b[from + 3]] = [b[from + 3]!, 0];
      else if (from - to === 2) [b[from - 1], b[from - 4]] = [b[from - 4]!, 0];
    }
    this.castle &= CASTLE_MASK[from]! & CASTLE_MASK[to]!;
    this.ep = (p === 1 || p === -1) && Math.abs(to - from) === 16 ? (from + to) >> 1 : -1;
    this.side = -this.side;
  }

  unmake(m: number): void {
    this.side = -this.side;
    const from = m & 63;
    const to = (m >> 6) & 63;
    const b = this.b;
    this.ep = this.undo.pop()!;
    this.castle = this.undo.pop()!;
    const capSq = this.undo.pop()!;
    const cap = this.undo.pop()!;
    const p = (m >> 12) & 7 ? Math.sign(b[to]!) : b[to]!;
    b[from] = p;
    b[to] = 0;
    b[capSq] = cap;
    if (p === 6 || p === -6) {
      if (to - from === 2) [b[from + 3], b[from + 1]] = [b[from + 1]!, 0];
      else if (from - to === 2) [b[from - 4], b[from - 1]] = [b[from - 1]!, 0];
    }
  }

  /** Static evaluation, from the side to move's point of view. */
  evaluate(): number {
    const b = this.b;
    let score = 0;
    let heavy = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq]!;
      if (p > 1 && p < 6) heavy += VAL[p]!;
      else if (p < -1 && p > -6) heavy += VAL[-p]!;
    }
    const endgame = heavy <= 2600;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq]!;
      if (!p) continue;
      const t = p > 0 ? p : -p;
      const i = p > 0 ? sq : sq ^ 56;
      const v = VAL[t]! + (t === 6 && endgame ? KING_END[i]! : PST[t]![i]!);
      score += p > 0 ? v : -v;
    }
    return score * this.side;
  }

  /** Captures (best victim, cheapest attacker) and promotions first. */
  ordered(moves: number[]): number[] {
    const key = (m: number) => {
      const victim = Math.abs(this.b[(m >> 6) & 63]!);
      return (victim ? VAL[victim]! * 10 - VAL[Math.abs(this.b[m & 63]!)]! / 100 : 0) + ((m >> 12) & 7) * 1000;
    };
    return moves.sort((a, b) => key(b) - key(a));
  }

  /** Make `m` if it doesn't leave our king in check. */
  tryMake(m: number): boolean {
    this.make(m);
    if (this.attacked(this.king(-this.side), this.side)) {
      this.unmake(m);
      return false;
    }
    return true;
  }

  quiesce(alpha: number, beta: number, depth: number): number {
    const stand = this.evaluate();
    if (stand >= beta || depth <= -8) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of this.ordered(this.moves(true))) {
      if (!this.tryMake(m)) continue;
      const score = -this.quiesce(-beta, -alpha, depth - 1);
      this.unmake(m);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  search(depth: number, alpha: number, beta: number, ply: number): number {
    if (depth <= 0) return this.quiesce(alpha, beta, 0);
    let legal = 0;
    let best = -INF;
    for (const m of this.ordered(this.moves(false))) {
      if (!this.tryMake(m)) continue;
      legal++;
      const score = -this.search(depth - 1, -beta, -alpha, ply + 1);
      this.unmake(m);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    if (!legal) return this.inCheck() ? -MATE + ply : 0;
    return best;
  }
}

const toUci = (m: number) => squareName(m & 63) + squareName((m >> 6) & 63) + (['', '', 'n', 'b', 'r', 'q'][(m >> 12) & 7] ?? '');

/** The engine's best move in `pos` (UCI) and its score for the side to move (centipawns). */
export function bestMove(pos: Position, depth = 3): { uci: string; score: number } | null {
  const board = new Board(pos);
  let alpha = -INF;
  let best: { uci: string; score: number } | null = null;
  for (const m of board.ordered(board.moves(false))) {
    if (!board.tryMake(m)) continue;
    const score = -board.search(depth - 1, -INF, -alpha, 1);
    board.unmake(m);
    if (!best || score > best.score) best = { uci: toUci(m), score };
    if (score > alpha) alpha = score;
  }
  return best;
}

/** Score of `pos` for its side to move, searched `depth` plies. */
export function scoreOf(pos: Position, depth: number): number {
  return new Board(pos).search(depth, -INF, INF, 0);
}

export type MoveLabel = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface MoveReview {
  uci: string;
  san: string;
  /** The engine's choice there, and its SAN. */
  best: string;
  bestSan: string;
  /** Win chance (0-100) of the side that moved, before and after the move. */
  winBefore: number;
  winAfter: number;
  label: MoveLabel;
  /** Per-move accuracy (0-100), lichess's formula on the win chance lost. */
  accuracy: number;
}

/** Centipawns → win chance (0-100) of the side they're for (lichess's curve). */
export function winChance(cp: number): number {
  const c = Math.max(-2000, Math.min(2000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

export function labelFor(loss: number, isBest: boolean): MoveLabel {
  if (isBest || loss <= 2) return 'best';
  if (loss <= 5) return 'excellent';
  if (loss <= 10) return 'good';
  if (loss <= 20) return 'inaccuracy';
  if (loss <= 30) return 'mistake';
  return 'blunder';
}

/** Rate one move: the engine's best there against the move played, both searched to the same depth. */
export function reviewMove(pos: Position, uci: string, depth = REVIEW_DEPTH): MoveReview | null {
  const move = legalMoves(pos).find((m) => squareName(m.from) + squareName(m.to) + (m.promo ?? '') === uci);
  const best = bestMove(pos, depth);
  if (!move || !best) return null;
  const after = makeMove(pos, move);
  const played = best.uci === uci ? best.score : -scoreOf(after, depth - 1);
  const winBefore = winChance(best.score);
  const winAfter = winChance(played);
  const loss = Math.max(0, winBefore - winAfter);
  const bestM = legalMoves(pos).find((m) => squareName(m.from) + squareName(m.to) + (m.promo ?? '') === best.uci)!;
  return {
    uci,
    san: toSan(pos, move),
    best: best.uci,
    bestSan: toSan(pos, bestM),
    winBefore,
    winAfter,
    label: labelFor(loss, best.uci === uci),
    accuracy: Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669)),
  };
}

/** The positions before each move of a game (null if a move is illegal). */
export function positionsOf(moves: readonly string[]): Position[] | null {
  const out: Position[] = [];
  let pos = startPosition();
  for (const uci of moves) {
    const m = findMove(pos, uci);
    if (!m) return null;
    out.push(pos);
    pos = makeMove(pos, m);
  }
  return out;
}

/** Average accuracy and mistake counts of one side's reviewed moves. */
export function summarize(reviews: readonly MoveReview[]): { accuracy: number; inaccuracy: number; mistake: number; blunder: number } {
  const n = reviews.length;
  return {
    accuracy: n ? reviews.reduce((s, r) => s + r.accuracy, 0) / n : 0,
    inaccuracy: reviews.filter((r) => r.label === 'inaccuracy').length,
    mistake: reviews.filter((r) => r.label === 'mistake').length,
    blunder: reviews.filter((r) => r.label === 'blunder').length,
  };
}

