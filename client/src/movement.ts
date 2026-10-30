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
 * wall collision (so you slide along walls instead of sticking). From inside a blocked tile any
 * step within the map is allowed, so you can walk out. Pure function.
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

  // Standing inside a blocked tile (furniture placed on top of us live) must not trap us.
  const stuck = !isWalkable(map, x, y);
  const free = (px: number, py: number) =>
    isWalkable(map, px, py) || (stuck && px >= 0 && py >= 0 && px < map.width && py < map.height);
  const outX = free(nx, y) ? nx : x;
  const outY = free(outX, ny) ? ny : y;
  return { x: outX, y: outY };
}
