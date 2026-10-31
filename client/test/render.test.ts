import { describe, it, expect } from 'vitest';
import { SIP_LEN_MS, SIP_MS, cupRest, labelLift, sipStep, wrapText } from '../src/render.ts';

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

describe('drinking', () => {
  it('sips only standing still, holding a drink, not facing away, for SIP_LEN_MS of every SIP_MS', () => {
    expect(sipStep('coffee', 'stand', 'down', false, 0)).toMatchObject({ row: 2, col: 1 });
    expect(sipStep('coffee', 'stand', 'down', false, 500)).toMatchObject({ row: 2, col: 2, cup: { dx: 0, dy: -11 } }); // centered, both hands
    expect(sipStep('coffee', 'stand', 'down', false, SIP_LEN_MS)).toBeNull();
    expect(sipStep('water', 'stand', 'left', false, SIP_MS + 10)).toMatchObject({ row: 1, col: 2 });
    expect(sipStep('water', 'stand', 'right', false, 500)).toMatchObject({ row: 3, col: 3 });
    expect(cupRest('stand', 'down')!.dx).toBeGreaterThan(0); // the left hand, on the viewer's right
    expect(sipStep('coffee', 'stand', 'up', false, 0)).toBeNull();
    expect(sipStep('coffee', 'stand', 'down', true, 0)).toBeNull();
    expect(sipStep('coffee', 'sit', 'down', false, 0)).toBeNull();
    expect(sipStep('', 'stand', 'down', false, 0)).toBeNull();
  });


  it('hides the cup facing away, lying or dancing', () => {
    expect(cupRest('stand', 'up')).toBeNull();
    expect(cupRest('lie', 'down')).toBeNull();
    expect(cupRest('dance', 'down')).toBeNull();
    expect(cupRest('sit', 'left')).not.toBeNull();
  });
});
