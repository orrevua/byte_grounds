import { describe, it, expect } from 'vitest';
import { stepMovement, type MoveInput } from '../src/movement.ts';
import type { OfficeMap } from '@byte_grounds/shared/map';
import { MOVE_SPEED } from '@byte_grounds/shared/protocol';

// 3x1: floor, floor, wall
const map: OfficeMap = {
  id: 't',
  width: 3,
  height: 1,
  tiles: [0, 0, 1],
  spawn: { x: 0.5, y: 0.5 },
};

const input = (p: Partial<MoveInput> = {}): MoveInput => ({
  up: false,
  down: false,
  left: false,
  right: false,
  ...p,
});

describe('stepMovement', () => {
  it('no input leaves position unchanged', () => {
    expect(stepMovement(map, 1.0, 0.5, input(), 0.1)).toEqual({ x: 1.0, y: 0.5 });
  });

  it('moves at MOVE_SPEED tiles/second', () => {
    const r = stepMovement(map, 0.2, 0.5, input({ right: true }), 0.1);
    expect(r.x).toBeCloseTo(0.2 + MOVE_SPEED * 0.1, 5);
    expect(r.y).toBe(0.5);
  });

  it('collision stops at a wall (x unchanged)', () => {
    // from x=1.6 moving right would cross into the wall tile at index 2
    const r = stepMovement(map, 1.6, 0.5, input({ right: true }), 0.2);
    expect(r.x).toBe(1.6);
    expect(r.y).toBe(0.5);
  });

  it('out-of-bounds is blocked', () => {
    const r = stepMovement(map, 0.3, 0.5, input({ left: true }), 0.2);
    expect(r.x).toBe(0.3);
  });

  it('diagonal input is normalized to constant speed', () => {
    const r = stepMovement(map, 0.5, 0.5, input({ right: true, down: true }), 0.1);
    const moved = Math.hypot(r.x - 0.5, r.y - 0.5);
    expect(moved).toBeCloseTo(MOVE_SPEED * 0.1, 5);
  });
});
