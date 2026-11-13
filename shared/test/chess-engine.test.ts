import { describe, it, expect } from 'vitest';
import { bestMove, labelFor, positionsOf, reviewMove, summarize, winChance } from '../src/chess-engine.ts';
import { replay } from '../src/chess.ts';

const at = (moves: string) => replay(moves.split(' ').filter(Boolean))!.pos;

describe('chess engine', () => {
  it('takes a hanging queen and finds mate in one', () => {
    expect(bestMove(at('e2e4 e7e5 d1h5 b8c6 f1c4 g8f6'), 3)!.uci).toBe('h5f7'); // Qxf7#
    expect(bestMove(at('e2e4 e7e5 g1f3 d8g5'), 3)!.uci).toBe('f3g5'); // Nxg5
  });

  it('calls a blunder a blunder and the best move best', () => {
    const pos = at('e2e4 e7e5 g1f3 b8c6');
    expect(reviewMove(pos, 'f3e5', 3)!.label).toMatch(/mistake|blunder|inaccuracy/); // Nxe5?? loses the knight to Nxe5
    const hanging = at('e2e4 e7e5 d1h5 b8c6 f1c4 g8f6');
    const r = reviewMove(hanging, 'h5f7', 3)!;
    expect([r.label, r.san]).toEqual(['best', 'Qxf7#']);
    expect(reviewMove(hanging, 'a2a3', 3)!.label).toBe('blunder'); // misses mate
  });

  it('maps scores to win chance and labels', () => {
    expect(winChance(0)).toBeCloseTo(50);
    expect(winChance(1000)).toBeGreaterThan(95);
    expect(labelFor(1, false)).toBe('best');
    expect(labelFor(40, false)).toBe('blunder');
    expect(positionsOf(['e2e4', 'e7e5'])).toHaveLength(2);
    expect(summarize([])).toEqual({ accuracy: 0, inaccuracy: 0, mistake: 0, blunder: 0 });
  });

  it('reviews a move quickly enough for a worker', () => {
    const pos = at('e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7');
    let ms = 0;
    for (const d of [3, 4]) {
      const t0 = performance.now();
      reviewMove(pos, 'f1e1', d);
      ms = performance.now() - t0;
      console.log(`review at depth ${d}: ${ms.toFixed(0)} ms`);
    }
    expect(ms).toBeLessThan(3000);
  });
});
