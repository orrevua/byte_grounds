import { describe, it, expect } from 'vitest';
import {
  applyChessOp,
  emptyGame,
  materialBalance,
  timeLeft,
  legalMoves,
  matchOf,
  normalizeChessOp,
  normalizeGame,
  recordOf,
  replay,
  startPosition,
  type ChessGame,
} from '../src/chess.ts';

const play = (s: string) => replay(s.split(' ').filter(Boolean));

describe('chess rules', () => {
  it('has 20 moves at the start, and counts perft 2 and 3', () => {
    const perft = (moves: string[], depth: number): number => {
      const r = replay(moves)!;
      if (depth === 0) return 1;
      return legalMoves(r.pos).reduce((n, m) => n + perft([...moves, uci(m)], depth - 1), 0);
    };
    const uci = (m: { from: number; to: number; promo?: string }) =>
      'abcdefgh'[m.from % 8]! + (8 - (m.from >> 3)) + 'abcdefgh'[m.to % 8]! + (8 - (m.to >> 3)) + (m.promo ?? '');
    expect(legalMoves(startPosition())).toHaveLength(20);
    expect(perft([], 2)).toBe(400);
    expect(perft([], 3)).toBe(8902);
  });

  it("writes SAN and spots fool's mate", () => {
    const r = play('f2f3 e7e5 g2g4 d8h4')!;
    expect(r.sans).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    expect(r.over).toEqual({ winner: 'b', reason: 'checkmate' });
  });

  it('refuses illegal moves', () => {
    expect(play('e2e5')).toBeNull();
    expect(play('e2e4 e7e5 d2d3 f8b4 a2a3')).toBeNull(); // ignores the check
  });

  it('castles both ways and moves the rook', () => {
    const r = play('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1')!;
    expect(r.sans.at(-1)).toBe('O-O');
    expect(r.pos.board[62]).toBe('K');
    expect(r.pos.board[61]).toBe('R');
    expect(r.pos.castling).toBe('kq');
    const q = play('d2d4 d7d5 b1c3 b8c6 c1f4 c8f5 d1d2 d8d7 e1c1 e8c8')!;
    expect(q.sans.slice(-2)).toEqual(['O-O-O', 'O-O-O']);
    expect(q.pos.board[2]).toBe('k');
    expect(q.pos.board[3]).toBe('r');
  });

  it('cannot castle through check', () => {
    const r = play('e2e4 e7e5 g1f3 f8c5 f1e2 c5f2')!;
    // Bxf2+: no castling while in check.
    expect(legalMoves(r.pos).some((m) => m.from === 60 && m.to === 62)).toBe(false);
  });

  it('takes en passant and promotes', () => {
    const r = play('e2e4 a7a6 e4e5 d7d5 e5d6')!;
    expect(r.sans.at(-1)).toBe('exd6');
    expect(r.pos.board[27]).toBe(''); // d5 pawn gone
    const p = play('h2h4 g7g5 h4g5 h7h6 g5h6 a7a6 h6h7 a6a5 h7g8q')!;
    expect(p.sans.at(-1)).toBe('hxg8=Q');
    expect(p.pos.board[6]).toBe('Q');
  });

  it('disambiguates SAN', () => {
    const t = play('g1f3 a7a6 b1c3 b7b6 c3d5 c7c6 d5e3 c6c5 e3g4')!;
    expect(t.sans.at(-1)).toBe('Ng4');
    const two = play('b1c3 a7a6 g1f3 b7b6 c3d5 a6a5 d5e3 a5a4 f3e5 h7h6 e5g4')!;
    expect(two.sans.at(-1)).toBe('N5g4');
  });

  it('calls stalemate', () => {
    // Shortest known stalemate (Sam Loyd, 10 moves).
    const r = play('e2e3 a7a5 d1h5 a8a6 h5a5 h7h5 h2h4 a6h6 a5c7 f7f6 c7d7 e8f7 d7b7 d8d3 b7b8 d3h7 b8c8 f7g6 c8e6')!;
    expect(r.sans.at(-1)).toBe('Qe6');
    expect(r.over).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('calls threefold repetition', () => {
    const r = play('g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8')!;
    expect(r.over).toEqual({ winner: null, reason: 'repetition' });
  });
});

describe('chess table game', () => {
  const seated = (): ChessGame => {
    const g = emptyGame('g1', 1);
    applyChessOp(g, { kind: 'sit', color: 'w', by: 'Ana' });
    applyChessOp(g, { kind: 'sit', color: 'b', by: 'Bia' });
    return g;
  };

  it('seats two players, once each', () => {
    const g = seated();
    expect([g.white, g.black]).toEqual(['Ana', 'Bia']);
    expect(applyChessOp(g, { kind: 'sit', color: 'w', by: 'Caio' })).toBe(false);
    const h = emptyGame();
    applyChessOp(h, { kind: 'sit', color: 'w', by: 'Ana' });
    expect(applyChessOp(h, { kind: 'sit', color: 'b', by: 'Ana' })).toBe(false);
  });

  it('only the side to move moves, at the right ply, legally', () => {
    const g = seated();
    expect(applyChessOp(g, { kind: 'move', game: 'g1', ply: 0, uci: 'e7e5', by: 'Bia' })).toBe(false);
    expect(applyChessOp(g, { kind: 'move', game: 'g1', ply: 0, uci: 'e2e5', by: 'Ana' })).toBe(false);
    expect(applyChessOp(g, { kind: 'move', game: 'g1', ply: 0, uci: 'e2e4', by: 'Ana' })).toBe(true);
    expect(applyChessOp(g, { kind: 'move', game: 'g1', ply: 0, uci: 'e2e4', by: 'Ana' })).toBe(false); // duplicate
    expect(applyChessOp(g, { kind: 'move', game: 'other', ply: 1, uci: 'e7e5', by: 'Bia' })).toBe(false);
    expect(g.moves).toEqual(['e2e4']);
  });

  it('ends by mate, records the match, and rematches with colours swapped', () => {
    const g = seated();
    ['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach((uci, ply) =>
      applyChessOp(g, { kind: 'move', game: 'g1', ply, uci, by: ply % 2 ? 'Bia' : 'Ana' }),
    );
    expect(g.result).toEqual({ winner: 'b', reason: 'checkmate' });
    expect(matchOf(g, 'lounge:3,4', 99)).toMatchObject({ white: 'Ana', black: 'Bia', winner: 'b', reason: 'checkmate', ended: 99 });
    expect(applyChessOp(g, { kind: 'new', game: 'g2', started: 2, by: 'Caio' })).toBe(false);
    expect(applyChessOp(g, { kind: 'new', game: 'g2', started: 2, by: 'Bia' })).toBe(true);
    expect([g.id, g.white, g.black, g.moves.length, g.result]).toEqual(['g2', 'Bia', 'Ana', 0, null]);
  });

  it('resigns, draws by agreement, and loses by standing up mid-game', () => {
    const g = seated();
    applyChessOp(g, { kind: 'move', game: 'g1', ply: 0, uci: 'e2e4', by: 'Ana' });
    expect(applyChessOp(g, { kind: 'draw', game: 'g1', by: 'Ana' })).toBe(true);
    expect(g.drawOffer).toBe('w');
    expect(applyChessOp(g, { kind: 'draw', game: 'g1', by: 'Bia' })).toBe(true);
    expect(g.result).toEqual({ winner: null, reason: 'agreement' });

    const r = seated();
    applyChessOp(r, { kind: 'move', game: 'g1', ply: 0, uci: 'e2e4', by: 'Ana' });
    applyChessOp(r, { kind: 'resign', game: 'g1', by: 'Bia' });
    expect(r.result).toEqual({ winner: 'w', reason: 'resign' });

    const s = seated();
    applyChessOp(s, { kind: 'move', game: 'g1', ply: 0, uci: 'e2e4', by: 'Ana' });
    expect(applyChessOp(s, { kind: 'stand', color: 'w', by: 'Caio' })).toBe(false);
    applyChessOp(s, { kind: 'stand', color: 'w', by: 'Caio', force: true });
    expect([s.white, s.result]).toEqual(['', { winner: 'b', reason: 'abandon' }]);
  });

  it('both players leaving mid-game: the match ends, then the table starts a fresh game', () => {
    const g = seated();
    applyChessOp(g, { kind: 'move', game: 'g1', ply: 0, uci: 'e2e4', by: 'Ana' });
    const ended: ChessGame[] = [];
    applyChessOp(g, { kind: 'stand', color: 'w', by: 'Ana', next: 'g2', started: 2 }, (e) => ended.push(e));
    expect(ended).toHaveLength(1);
    expect(matchOf(ended[0]!, 't', 5)).toMatchObject({ id: 'g1', white: 'Ana', black: 'Bia', winner: 'b', reason: 'resign' });
    // Bia is still seated in the fresh game, waiting for an opponent.
    expect([g.id, g.white, g.black, g.moves, g.result]).toEqual(['g2', '', 'Bia', [], null]);
    applyChessOp(g, { kind: 'stand', color: 'b', by: 'Bia', next: 'g3', started: 3 }, (e) => ended.push(e));
    expect(ended).toHaveLength(1); // nothing was in play
    expect([g.id, g.white, g.black]).toEqual(['g2', '', '']);
    applyChessOp(g, { kind: 'sit', color: 'w', by: 'Caio', next: 'g4', started: 4 });
    expect([g.id, g.white]).toEqual(['g2', 'Caio']);
  });

  it('leaving after a mate starts a fresh game; sitting at a finished table starts one too', () => {
    const g = seated();
    ['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach((uci, ply) =>
      applyChessOp(g, { kind: 'move', game: 'g1', ply, uci, by: ply % 2 ? 'Bia' : 'Ana' }),
    );
    applyChessOp(g, { kind: 'stand', color: 'w', by: 'Ana', next: 'g2', started: 2 });
    expect([g.id, g.white, g.black, g.result]).toEqual(['g2', '', 'Bia', null]);

    // A finished game left with empty seats (saved by an older version) restarts on the next sit.
    const old = { ...emptyGame('g9', 9), moves: ['e2e4'], result: { winner: 'w' as const, reason: 'resign' as const } };
    applyChessOp(old, { kind: 'sit', color: 'b', by: 'Caio', next: 'g10', started: 10 });
    expect([old.id, old.black, old.moves, old.result]).toEqual(['g10', 'Caio', [], null]);
  });

  it('runs a clock: starts after white first moves, adds the increment, flags on time', () => {
    const g = seated();
    applyChessOp(g, { kind: 'time', by: 'Ana', initial: 60_000, increment: 2_000 });
    expect(g.clock).toMatchObject({ w: 60_000, b: 60_000, at: 0 });
    applyChessOp(g, { kind: 'move', game: 'g1', ply: 0, uci: 'e2e4', by: 'Ana', at: 1_000 });
    expect(g.clock).toMatchObject({ w: 60_000, at: 1_000 }); // white's first move is free
    expect(timeLeft(g, 'b', 6_000)).toBe(55_000);
    applyChessOp(g, { kind: 'move', game: 'g1', ply: 1, uci: 'e7e5', by: 'Bia', at: 11_000 });
    expect(g.clock).toMatchObject({ b: 52_000, at: 11_000 }); // 60 - 10 + 2
    expect(applyChessOp(g, { kind: 'flag', game: 'g1', by: 'Bia', at: 30_000 })).toBe(false); // white still has time
    expect(applyChessOp(g, { kind: 'flag', game: 'g1', by: 'Bia', at: 71_000 })).toBe(true);
    expect(g.result).toEqual({ winner: 'b', reason: 'timeout' });
    expect(applyChessOp(g, { kind: 'time', by: 'Ana', initial: 0, increment: 0 })).toBe(true);
    expect(g.clock).toBeNull();
  });

  it('a move arriving after the flag fell loses on time; a rematch keeps the time control', () => {
    const g = seated();
    applyChessOp(g, { kind: 'time', by: 'Bia', initial: 10_000, increment: 0 });
    applyChessOp(g, { kind: 'move', game: 'g1', ply: 0, uci: 'e2e4', by: 'Ana', at: 0 + 1 });
    applyChessOp(g, { kind: 'move', game: 'g1', ply: 1, uci: 'e7e5', by: 'Bia', at: 20_000 });
    expect([g.moves.length, g.result]).toEqual([1, { winner: 'w', reason: 'timeout' }]);
    applyChessOp(g, { kind: 'new', game: 'g2', started: 2, by: 'Ana' });
    expect(g.clock).toEqual({ initial: 10_000, increment: 0, w: 10_000, b: 10_000, at: 0 });
  });

  it('counts captured pieces and material', () => {
    const r = replay(['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5a2', 'a1a2'])!;
    expect(r.captured).toEqual({ w: ['p', 'q'], b: ['p', 'p'] });
    expect(materialBalance(r.pos.board)).toBe(8);
  });

  it('adopts a newer state only', () => {
    const g = seated();
    const old = structuredClone(g);
    applyChessOp(g, { kind: 'move', game: 'g1', ply: 0, uci: 'e2e4', by: 'Ana' });
    expect(applyChessOp(g, { kind: 'state', state: old })).toBe(false);
    expect(applyChessOp(old, { kind: 'state', state: g })).toBe(true);
    expect(old.moves).toEqual(['e2e4']);
  });

  it('normalizes ops and games from the network', () => {
    expect(normalizeChessOp({ kind: 'move', game: 'g1', ply: 0, uci: 'e2e4', by: 'Ana' })).not.toBeNull();
    expect(normalizeChessOp({ kind: 'move', game: 'g1', ply: -1, uci: 'e2e4', by: 'Ana' })).toBeNull();
    expect(normalizeChessOp({ kind: 'move', game: 'g1', ply: 0, uci: 'z9', by: 'Ana' })).toBeNull();
    expect(normalizeChessOp({ kind: 'sit', color: 'x', by: 'Ana' })).toBeNull();
    expect(normalizeChessOp({ kind: 'nope' })).toBeNull();
    expect(normalizeGame({ ...emptyGame(), moves: ['e2e5'] })).toBeNull();
    expect(normalizeGame(emptyGame())).toEqual(emptyGame());
  });

  it("counts a player's record", () => {
    const m = (white: string, black: string, winner: 'w' | 'b' | null) =>
      ({ id: white + black, table: 't', white, black, winner, reason: 'resign', moves: [], ended: 0 }) as const;
    expect(recordOf([m('Ana', 'Bia', 'w'), m('Bia', 'Ana', 'w'), m('Ana', 'Caio', null), m('Bia', 'Caio', 'b')], 'Ana')).toEqual({ won: 1, lost: 1, drawn: 1 });
  });
});
