# Spec: chess tables

## Goal
A chess table piece of furniture. Two players sit at it and play chess; anyone nearby can watch.
Every finished game is kept in the table's match history.

## Which pieces are chess tables
`client/src/boards.ts` `CHESS_TABLES`:
- `byte_grounds_games` cells (0,0)-(1,1), a 2x2 Gemini-made table in the picker;
- the old `wooden_furniture` cell (2,19).

A table's id is `<map id>:<x>,<y>`, like a whiteboard's. Within `BOARD_REACH`, F / the action button
says "Play chess". The nearest of machine, whiteboard and chess table wins. Chess also works seated.

The Lounge & Café (rev 3) has one at (28,18), with two chairs north and two chairs south.

## Rules (`shared/src/chess.ts`, pure, tested)
- Legal moves: castling, en passant and promotion included. Perft 2 and 3 from the start are checked.
- Check and checkmate.
- Draws: stalemate, threefold repetition, the fifty-move rule, insufficient material.
- SAN for the move list.
- Moves travel as UCI. A game's position is always rebuilt by replaying its moves (`replay`).

## Game state and ops
`ChessGame = { id, white, black, moves, result, drawOffer, started, rev }`. Seats hold player names
('' means free); names are unique online.

`ChessOp`s carry the actor's name (`by`). `applyChessOp` is idempotent and refuses anything that
doesn't fit:
- `sit`: the seat is free, you have no seat, and no game is in progress.
- `stand`: mid-game it loses the game. `force` frees the seat of a player no longer in the room,
  and that counts as abandonment.
- Each game is its own instance (`id`). When a `stand` leaves a game that is (now) over, or a `sit`
  comes to one, the table starts a fresh game, keeping whoever is still seated. The sender picks the
  new id and start time (`next`, `started`), so every client resets to the same game.
  `applyChessOp`'s `onEnd` gets the game as it ended, before the reset, and that copy goes to the
  history. The side panel shows "Last game: …".
- `move`: right game id, ply = moves made, your turn, legal.
- `resign`.
- `draw`: offers a draw, or accepts the other player's offer.
- `new`: a seated player starts the next game; colours swap after a finished one.
- `hello` / `state`: someone opening the table says hello, and anyone who has it open answers with
  their whole game. The copy with the higher `rev` (or a newer `started`) wins.

## Sync and saving
- **Live:** `{ type: 'chess', table, op }`, relayed to the room. The ws server and Supabase broadcast
  both normalize it with `normalizeChessOp`.
- **Saved (`supabase/chess.sql`):**
  - `chess_tables` holds the current game JSON. The actor saves it after each of their ops.
  - `chess_matches` holds finished games (white, black, winner, reason, moves, ended_at). Rows are
    insert-only. Whoever's op ended the game records it, so each match is saved once; the upsert
    ignores duplicates.
- **Local dev:** localStorage.
- Without the tables, play still works live, and a note says nothing is saved.

## UI (`client/src/chess-view.ts`)
Full screen, with the whiteboard's header.

The board:
- an 8x8 grid of buttons with Unicode pieces, turned around for black;
- click a piece, then a highlighted target;
- the last move and check are highlighted;
- promotion asks for a piece.

The side panel:
- the two seats (Sit here / Leave / Free this seat);
- the state line;
- Offer/Accept draw, Resign, Rematch;
- the move list;
- the match history with your record. Click a match to see its final position and moves.

Esc closes the window. Nothing reaches the game while it's open.

## Verified
Units: `shared/test/chess.test.ts` and `client/test/boards.test.ts`.

Three Playwright players on the ws dev server checked the following:
- both seats sync;
- fool's mate is detected on both screens;
- the match shows in history;
- rematch swaps colours;
- a late opener catches up through hello/state.
