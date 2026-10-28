import { MOVE_SPEED } from '@byte_grounds/shared/protocol';
import type { Position } from '@byte_grounds/shared/protocol';
import { isWalkable } from '@byte_grounds/shared/map';
import type { OfficeMap } from '@byte_grounds/shared/map';

export interface MoveInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Integrate one movement step for `dt` seconds at MOVE_SPEED, with axis-separated
 * wall collision (so you slide along walls instead of sticking). Pure function.
 */
export function stepMovement(
  map: OfficeMap,
  x: number,
  y: number,
  input: MoveInput,
  dt: number,
): Position {
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx === 0 && dy === 0) return { x, y };

  const len = Math.hypot(dx, dy);
  dx /= len;
  dy /= len;

  const dist = MOVE_SPEED * dt;
  const nx = x + dx * dist;
  const ny = y + dy * dist;

  const outX = isWalkable(map, nx, y) ? nx : x;
  const outY = isWalkable(map, outX, ny) ? ny : y;
  return { x: outX, y: outY };
}
