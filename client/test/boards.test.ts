import { describe, it, expect } from 'vitest';
import { createBlankMap } from '@byte_grounds/shared/map';
import { builtInMap } from '@byte_grounds/shared/maps';
import { boardNear, boardsIn } from '../src/boards.ts';

describe('whiteboards on the map', () => {
  it('groups a whiteboard piece by its top-left tile (old gemini_ names too)', () => {
    const m = {
      ...createBlankMap('room', 10, 10),
      decor: [
        { x: 4, y: 2, sheet: 'byte_grounds_studio_grid', sx: 9, sy: 0 },
        { x: 5, y: 2, sheet: 'byte_grounds_studio_grid', sx: 10, sy: 0 },
        { x: 4, y: 3, sheet: 'gemini_studio_grid', sx: 9, sy: 1 },
        { x: 7, y: 7, sheet: 'byte_grounds_studio_grid', sx: 0, sy: 0 }, // a table
      ],
    };
    const boards = boardsIn(m);
    expect(boards.map((b) => b.id)).toEqual(['room:4,2']);
    expect(boards[0]!.cells).toHaveLength(3);
    expect(boardNear(boards, 4.5, 5.0)?.board.id).toBe('room:4,2');
    expect(boardNear(boards, 8.5, 8.5)).toBeUndefined();
  });

  it('the Office meeting room has a whiteboard', () => {
    expect(boardsIn(builtInMap('office')!).map((b) => b.id)).toContain('office:34,2');
  });
});
