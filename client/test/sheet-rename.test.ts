import { describe, it, expect } from 'vitest';
import { canonicalSheet, createBlankMap } from '@byte_grounds/shared/map';
import { seatSpot } from '@byte_grounds/shared/seats';
import { isGroundCell } from '@byte_grounds/shared/ground';
import { machinesIn } from '../src/dispensers.ts';

describe('gemini_* sheets renamed to byte_grounds_*', () => {
  it('maps old names to the new files and leaves the rest alone', () => {
    expect(canonicalSheet('gemini_office2_grid')).toBe('byte_grounds_office2_grid');
    expect(canonicalSheet('gemini_floors')).toBe('byte_grounds_floors');
    expect(canonicalSheet('chairs')).toBe('chairs');
    expect(canonicalSheet('byte_grounds_cafe_grid')).toBe('byte_grounds_cafe_grid');
  });

  it('content saved with the old names keeps its seats, floors and machines', () => {
    expect(seatSpot('gemini_studio_grid', 0, 3)).toEqual(seatSpot('byte_grounds_studio_grid', 0, 3));
    expect(seatSpot('gemini_studio_grid', 0, 3)).toBeDefined();
    expect(isGroundCell({ sheet: 'gemini_floors', sx: 0, sy: 0 })).toBe(true);
    const m = { ...createBlankMap('t', 6, 6), decor: [{ x: 2, y: 2, sheet: 'gemini_studio_grid', sx: 0, sy: 4 }] };
    expect(machinesIn(m)).toEqual([{ x: 2, y: 2, item: 'coffee' }]);
  });
});
