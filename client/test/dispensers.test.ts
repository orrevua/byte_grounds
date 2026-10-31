import { describe, it, expect } from 'vitest';
import { createBlankMap } from '@byte_grounds/shared/map';
import { builtInMap } from '@byte_grounds/shared/maps';
import { drinkDuration, formatDuration, machineNear, machinesIn } from '../src/dispensers.ts';

describe('drink machines', () => {
  it('finds coffee makers and water coolers among the decor', () => {
    const m = {
      ...createBlankMap('k', 10, 10),
      decor: [
        { x: 2, y: 2, sheet: 'office', sx: 10, sy: 0 },
        { x: 6, y: 2, sheet: 'office', sx: 10, sy: 20 },
        { x: 6, y: 3, sheet: 'office', sx: 10, sy: 21 },
        { x: 8, y: 8, sheet: 'office', sx: 9, sy: 0 }, // a mug: not a machine
      ],
    };
    const machines = machinesIn(m);
    expect(machines).toEqual([
      { x: 2, y: 2, item: 'coffee' },
      { x: 6, y: 2, item: 'water' },
      { x: 6, y: 3, item: 'water' },
    ]);
    expect(machineNear(machines, 2.5, 4.4)?.item).toBe('coffee'); // across a counter
    expect(machineNear(machines, 6.5, 4.5)).toEqual({ x: 6, y: 3, item: 'water' }); // nearest cell
    expect(machineNear(machines, 4.5, 7.5)).toBeUndefined();
  });

  it('the built-in maps have machines: coffee in the Lounge, both in the Office', () => {
    const items = (id: string) => new Set(machinesIn(builtInMap(id)!).map((k) => k.item));
    expect(items('lounge').has('coffee')).toBe(true);
    expect(items('office')).toEqual(new Set(['coffee', 'water']));
  });

  it('a drink lasts 30 s, 1 min or 5 min', () => {
    expect([0, 0.4, 0.99].map(drinkDuration)).toEqual([30_000, 60_000, 300_000]);
    expect([30_000, 60_000, 300_000].map(formatDuration)).toEqual(['30 s', '1 min', '5 min']);
  });
});
