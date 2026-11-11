import { crc32, deflateSync } from "node:zlib";

export type RGB = [number, number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: RGB;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

// Truecolour 8-bit PNG: a background fill plus solid rectangles painted in order.
export function encodePng(width: number, height: number, background: RGB, rects: Rect[] = []): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  const bgRow = Buffer.alloc(stride);
  for (let x = 0; x < width; x++) bgRow.set(background, 1 + x * 3);
  for (let y = 0; y < height; y++) bgRow.copy(raw, y * stride);
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width, Math.floor(r.x + r.w));
    const y1 = Math.min(height, Math.floor(r.y + r.h));
    if (x1 <= x0 || y1 <= y0) continue;
    const span = Buffer.alloc((x1 - x0) * 3);
    for (let x = 0; x < x1 - x0; x++) span.set(r.color, x * 3);
    for (let y = y0; y < y1; y++) span.copy(raw, y * stride + 1 + x0 * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
