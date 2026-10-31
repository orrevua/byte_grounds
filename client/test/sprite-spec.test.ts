import { describe, it, expect } from 'vitest';
import { applyOps, blankPixels, bufferToSpec, parseColor, parseSpec, renderSpec, sheetSlug, toHex, type Pixels } from '../src/sprite-spec.ts';

const at = (px: Pixels, x: number, y: number) => {
  const i = (y * px.width + x) * 4;
  return toHex([px.data[i]!, px.data[i + 1]!, px.data[i + 2]!, px.data[i + 3]!]);
};

describe('parseColor', () => {
  it('reads short and long hex, with and without alpha', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 255]);
    expect(parseColor('#00000080')).toEqual([0, 0, 0, 128]);
    expect(parseColor('#1b1f26')).toEqual([27, 31, 38, 255]);
    expect(parseColor('red')).toBeNull();
  });
});

describe('parseSpec', () => {
  it('accepts a minimal spec and slugs its name', () => {
    const { spec, errors } = parseSpec({ name: 'Modern Office!', cols: 2, rows: 1 });
    expect(errors).toEqual([]);
    expect(spec).toMatchObject({ name: 'modern_office', cols: 2, rows: 1, ops: [] });
  });

  it('explains what is wrong', () => {
    const { spec, errors } = parseSpec({
      cols: 0,
      rows: 2,
      palette: { kk: '#000', w: 'white' },
      ops: [{ op: 'blob' }, { op: 'rect', x: 0, y: 0, w: 2 }, { op: 'pixels', x: 0, y: 0, rows: ['zz'] }],
    });
    expect(spec).toBeNull();
    expect(errors.join('\n')).toMatch(/cols/);
    expect(errors.join('\n')).toMatch(/palette key "kk"/);
    expect(errors.join('\n')).toMatch(/unknown op "blob"/);
    expect(errors.join('\n')).toMatch(/"h" must be a number/);
    expect(errors.join('\n')).toMatch(/uses "z"/);
  });
});

describe('renderSpec / applyOps', () => {
  const spec = (ops: unknown[], palette = { k: '#000000', w: '#ffffff' }) => parseSpec({ cols: 1, rows: 1, palette, ops }).spec!;

  it('draws an outlined rect', () => {
    const px = renderSpec(spec([{ op: 'rect', x: 2, y: 2, w: 4, h: 3, color: 'w', outline: 'k' }]));
    expect(px.width).toBe(32);
    expect(at(px, 2, 2)).toBe('#000000');
    expect(at(px, 3, 3)).toBe('#ffffff');
    expect(at(px, 6, 3)).toBe('#00000000');
  });

  it('draws pixels rows, lines, fills and ellipses', () => {
    const px = renderSpec(
      spec([
        { op: 'pixels', x: 0, y: 0, rows: ['k.w'] },
        { op: 'line', x1: 0, y1: 10, x2: 4, y2: 10, color: 'k' },
        { op: 'rect', x: 10, y: 10, w: 5, h: 5, outline: 'k' },
        { op: 'fill', x: 12, y: 12, color: '#ff0000' },
        { op: 'ellipse', x: 20, y: 20, w: 8, h: 8, color: 'w' },
      ]),
    );
    expect([at(px, 0, 0), at(px, 1, 0), at(px, 2, 0)]).toEqual(['#000000', '#00000000', '#ffffff']);
    expect(at(px, 4, 10)).toBe('#000000');
    expect(at(px, 12, 12)).toBe('#ff0000');
    expect(at(px, 10, 12)).toBe('#000000'); // the outline stopped the fill
    expect(at(px, 24, 24)).toBe('#ffffff');
    expect(at(px, 20, 20)).toBe('#00000000'); // corner outside the ellipse
  });

  it('outlines art, shades, copies mirrored and clears', () => {
    const px = blankPixels(2, 1);
    applyOps(
      px,
      [
        { op: 'pixels', x: 5, y: 5, rows: ['ww'] },
        { op: 'outline', x: 0, y: 0, w: 32, h: 32, color: 'k' },
        { op: 'shade', x: 0, y: 0, w: 32, h: 32, amount: -0.5 },
        { op: 'pixels', x: 0, y: 0, rows: ['k'] },
        { op: 'copy', x: 0, y: 0, w: 32, h: 32, toX: 32, toY: 0, flipX: true },
        { op: 'clear', x: 0, y: 0, w: 1, h: 1 },
      ],
      { k: '#000000', w: '#ffffff' },
    );
    expect(at(px, 4, 5)).toBe('#000000'); // the outline ring
    expect(at(px, 5, 5)).toBe('#808080'); // white shaded by half
    expect(at(px, 63, 0)).toBe('#000000'); // mirrored copy of (0,0)
    expect(at(px, 0, 0)).toBe('#00000000'); // cleared
  });

  it('blends translucent colors (shadows)', () => {
    const px = renderSpec(spec([{ op: 'pixels', x: 0, y: 0, rows: ['w'] }, { op: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#00000080' }]));
    expect(at(px, 0, 0)).toBe('#7f7f7f');
  });
});

describe('bufferToSpec', () => {
  it('round-trips an image through text, one pixels op per used cell', () => {
    const a = renderSpec(parseSpec({ cols: 2, rows: 1, ops: [{ op: 'rect', x: 33, y: 1, w: 6, h: 4, color: '#123456', outline: '#000' }] }).spec!);
    const text = bufferToSpec(a, 'Round Trip');
    expect(text.name).toBe('round_trip');
    expect(text.ops).toHaveLength(1);
    const back = renderSpec(parseSpec(JSON.parse(JSON.stringify(text))).spec!);
    expect(Buffer.from(back.data).equals(Buffer.from(a.data))).toBe(true);
  });

  it('slugs names', () => {
    expect(sheetSlug('  Café Bar #2 ')).toBe('cafe_bar_2');
    expect(sheetSlug('!!!')).toBe('sheet');
  });
});

describe('seats in a spec', () => {
  it('keeps valid seat cells and rejects ones outside the sheet or malformed', () => {
    const ok = parseSpec({ cols: 2, rows: 1, seats: [{ x: 1, y: 0, kind: 'sit', dir: 'down', extra: 1 }] });
    expect(ok.spec!.seats).toEqual([{ x: 1, y: 0, kind: 'sit', dir: 'down' }]);
    const bad = parseSpec({ cols: 2, rows: 1, seats: [{ x: 2, y: 0, kind: 'sit', dir: 'down' }, { x: 0, y: 0, kind: 'stand', dir: 'north' }] });
    expect(bad.spec).toBeNull();
    expect(bad.errors.join('\n')).toMatch(/inside the sheet/);
    expect(bad.errors.join('\n')).toMatch(/kind must be/);
    expect(bad.errors.join('\n')).toMatch(/dir must be/);
  });
});
