// Draws the toolbar icons (a receipt on a green tile) as PNGs, with no
// dependencies: `node scripts/make-icons.mjs` rewrites icons/icon-*.png.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const GREEN = [31, 111, 80];
const WHITE = [255, 255, 255];
const SIZES = [16, 32, 48, 128];
const SAMPLES = 4;

function inRoundedRect(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Colour and coverage at a point of the unit square. */
function shade(u, v) {
  if (!inRoundedRect(u, v, 0, 0, 1, 1, 0.2)) return null;
  const onReceipt = inRoundedRect(u, v, 0.27, 0.16, 0.73, 0.84, 0.05);
  if (!onReceipt) return GREEN;
  const lines = [0.33, 0.47, 0.61];
  const onLine = lines.some((y) => v >= y - 0.035 && v <= y + 0.035 && u >= 0.35 && u <= (y === 0.61 ? 0.55 : 0.65));
  return onLine ? GREEN : WHITE;
}

function render(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = shade((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = 1 + x * 4;
      if (a) {
        row[o] = Math.round(r / a);
        row[o + 1] = Math.round(g / a);
        row[o + 2] = Math.round(b / a);
        row[o + 3] = Math.round((255 * a) / (SAMPLES * SAMPLES));
      }
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), render(size));
}
