import { positionsOf, reviewMove, type MoveReview } from '@byte_grounds/shared/chess-engine';

/** A game to review: its moves, from ply `from` on (earlier plies were already sent back). */
export interface ReviewJob {
  key: string;
  moves: string[];
  from: number;
}

export interface ReviewResult {
  key: string;
  ply: number;
  review: MoveReview | null;
}

/** Rates the moves of a game off the main thread, one message per move as it's done. */
self.onmessage = (e: MessageEvent<ReviewJob>) => {
  const { key, moves, from } = e.data;
  const positions = positionsOf(moves);
  if (!positions) return;
  for (let ply = from; ply < moves.length; ply++) {
    const result: ReviewResult = { key, ply, review: reviewMove(positions[ply]!, moves[ply]!) };
    postMessage(result);
  }
};
