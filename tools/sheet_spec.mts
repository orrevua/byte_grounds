/**
 * SheetSpec CLI for agents (and humans) working in the repo, no browser needed.
 *
 *   node tools/sheet_spec.mts render <spec.json> <out.png>   # draw a spec into a PNG sheet
 *   node tools/sheet_spec.mts dump <in.png> [name] > out.json # read any PNG sheet back as a spec
 *   node tools/sheet_spec.mts check <spec.json>              # validate only (exit 1 on problems)
 *
 * The format and renderer are client/src/sprite-spec.ts (shared with Sheet Studio, /sheets).
 * A PNG written into client/src/assets/decor/ shows up in the map editor's picker on the next build.
 * Needs Node >= 22.18 (runs TypeScript directly); no dependencies.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { bufferToSpec, parseSpec, renderSpec, type Pixels } from '../client/src/sprite-spec.ts';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGBA pixels → PNG bytes (8-bit RGBA, no filtering). */
export function encodePng(px: Pixels): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px.width, 0);
  ihdr.writeUInt32BE(px.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((px.width * 4 + 1) * px.height);
  for (let y = 0; y < px.height; y++) raw.set(px.data.subarray(y * px.width * 4, (y + 1) * px.width * 4), y * (px.width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** PNG bytes → RGBA pixels (8-bit gray / RGB / palette / gray+alpha / RGBA, not interlaced). */
export function decodePng(buf: Buffer): Pixels {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`unsupported bit depth ${data[8]} (only 8)`);
      type = data[9]!;
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`unsupported color type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= channels ? rows[y * stride + x - channels]! : 0;
      const b = y > 0 ? rows[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels]! : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      rows[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paeth][f]!) & 0xff;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let rgba: number[];
    if (type === 6) rgba = [rows[s]!, rows[s + 1]!, rows[s + 2]!, rows[s + 3]!];
    else if (type === 2) rgba = [rows[s]!, rows[s + 1]!, rows[s + 2]!, 255];
    else if (type === 0) rgba = [rows[s]!, rows[s]!, rows[s]!, 255];
    else if (type === 4) rgba = [rows[s]!, rows[s]!, rows[s]!, rows[s + 1]!];
    else {
      const k = rows[s]!;
      rgba = [palette![k * 3]!, palette![k * 3 + 1]!, palette![k * 3 + 2]!, trns && k < trns.length ? trns[k]! : 255];
    }
    data.set(rgba, i * 4);
  }
  return { width, height, data };
}

function main(argv: string[]): number {
  const [cmd, a, b] = argv;
  if (cmd === 'render' || cmd === 'check') {
    if (!a) return usage();
    const { spec, errors } = parseSpec(JSON.parse(readFileSync(a, 'utf8')));
    if (!spec) {
      console.error(errors.join('\n'));
      return 1;
    }
    if (cmd === 'check') {
      console.log(`ok: ${spec.name}, ${spec.cols}x${spec.rows} cells, ${spec.ops.length} ops`);
      return 0;
    }
    if (!b) return usage();
    writeFileSync(b, encodePng(renderSpec(spec)));
    console.log(`wrote ${b}: ${spec.cols}x${spec.rows} cells (${spec.cols * 32}x${spec.rows * 32} px), ${spec.ops.length} ops`);
    return 0;
  }
  if (cmd === 'dump') {
    if (!a) return usage();
    const name = b ?? a.replace(/^.*[\\/]/, '').replace(/\.png$/i, '');
    process.stdout.write(JSON.stringify(bufferToSpec(decodePng(readFileSync(a)), name), null, 1) + '\n');
    return 0;
  }
  return usage();
}

function usage(): number {
  console.error('usage: node tools/sheet_spec.mts render <spec.json> <out.png> | dump <in.png> [name] | check <spec.json>');
  return 2;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/sheet_spec.mts')) process.exitCode = main(process.argv.slice(2));
