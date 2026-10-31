import { describe, it, expect } from 'vitest';
import { labelLift, wrapText } from '../src/render.ts';

const measure = (s: string) => s.length * 6; // 6 px per char

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText(measure, 'hello there', 120, 3)).toEqual(['hello there']);
  });

  it('wraps on words and ellipsizes past the line limit', () => {
    const lines = wrapText(measure, 'one two three four five six seven', 60, 2);
    expect(lines).toEqual(['one two', 'three fou…']);
    expect(lines.every((l) => measure(l) <= 60)).toBe(true);
  });

  it('cuts a single word longer than a line', () => {
    expect(wrapText(measure, 'x'.repeat(30), 60, 1)).toEqual(['xxxxxxxxx…']);
  });
});

describe('labelLift', () => {
  it('puts names over the head: highest standing, lower seated and lying', () => {
    expect(labelLift('stand')).toBeGreaterThan(labelLift('sit'));
    expect(labelLift('sit')).toBeGreaterThan(labelLift('lie'));
    expect(labelLift('dance')).toBe(labelLift('stand'));
  });
});

describe('wrapText indent', () => {
  it('gives the first line less room and keeps every word', () => {
    expect(wrapText(measure, 'hey Bruno how are you', 60, 3, 24)).toEqual(['hey', 'Bruno how', 'are you']);
  });
});
