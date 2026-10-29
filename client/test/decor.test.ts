import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TILE_SIZE } from '@byte_grounds/shared/protocol';
import { DECOR_SHEETS } from '../src/decor.ts';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/assets/decor');
const sheets = readdirSync(dir)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''));

describe('decor sheets', () => {
  it('every sheet file is a PNG cut into whole 32px cells', () => {
    expect(sheets.length).toBeGreaterThan(0);
    for (const s of sheets) {
      const png = readFileSync(resolve(dir, `${s}.png`));
      const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)]; // IHDR width, height
      expect([s, w % TILE_SIZE, h % TILE_SIZE]).toEqual([s, 0, 0]);
    }
  });

  it('the picker offers each _grid repack in place of its original', () => {
    const repacked = sheets.filter((s) => s.endsWith('_grid')).map((s) => s.replace(/_grid$/, ''));
    expect(repacked.length).toBeGreaterThan(0);
    for (const s of repacked) {
      expect(sheets).toContain(s);
      expect(DECOR_SHEETS).toContain(`${s}_grid`);
      expect(DECOR_SHEETS).not.toContain(s);
    }
    expect([...DECOR_SHEETS].sort()).toEqual(sheets.filter((s) => !repacked.includes(s)).sort());
  });
});
