import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AC_CHROMA_COUNTS,
  AC_CHROMA_SYMBOLS,
  AC_LUMA_COUNTS,
  AC_LUMA_SYMBOLS,
  DC_CHROMA_COUNTS,
  DC_LUMA_COUNTS,
  DC_SYMBOLS,
  StripJpegEncoder,
} from './jpegEncoder';
import { readJpegDpi } from './jpegDpi';

/** Smooth gradients, hard edges and some noise, like a photo with detail. */
function testImage(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 16;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inBox = x > w * 0.3 && x < w * 0.6 && y > h * 0.3 && y < h * 0.7;
      px[i] = inBox ? 230 : (255 * x) / w + rand();
      px[i + 1] = inBox ? 40 : (255 * y) / h + rand();
      px[i + 2] = inBox ? 60 : 128 + 60 * Math.sin(x / 9) + rand();
      px[i + 3] = 255;
    }
  }
  return px;
}

/** Feed the image in uneven strips to exercise the 16-row buffering. */
function encode(px: Uint8ClampedArray, w: number, h: number, strips: number[], quality = 0.92) {
  const enc = new StripJpegEncoder(w, h, quality, 300);
  let y = 0;
  let s = 0;
  while (y < h) {
    const rows = Math.min(strips[s++ % strips.length], h - y);
    enc.addRows(px.subarray(y * w * 4, (y + rows) * w * 4), rows);
    y += rows;
  }
  return Buffer.concat(enc.finish());
}

async function psnr(jpeg: Buffer, px: Uint8ClampedArray, w: number, h: number) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height, info.channels]).toEqual([w, h, 3]);
  let se = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    for (let c = 0; c < 3; c++) se += (px[i + c] - data[j + c]) ** 2;
  }
  return 10 * Math.log10((255 * 255) / (se / (w * h * 3)));
}

describe('Huffman tables', () => {
  it('are the complete JPEG symbol sets', () => {
    const acSet = new Set([0x00, 0xf0]);
    for (let run = 0; run < 16; run++) for (let size = 1; size <= 10; size++) acSet.add((run << 4) | size);
    for (const [counts, symbols] of [
      [AC_LUMA_COUNTS, AC_LUMA_SYMBOLS],
      [AC_CHROMA_COUNTS, AC_CHROMA_SYMBOLS],
    ]) {
      expect(counts.reduce((a, b) => a + b)).toBe(162);
      expect(new Set(symbols)).toEqual(acSet);
    }
    expect(DC_LUMA_COUNTS.reduce((a, b) => a + b)).toBe(DC_SYMBOLS.length);
    expect(DC_CHROMA_COUNTS.reduce((a, b) => a + b)).toBe(DC_SYMBOLS.length);
  });
});

describe('StripJpegEncoder', () => {
  it('matches libjpeg quality at the same settings, at odd sizes', async () => {
    for (const [w, h] of [
      [1, 1],
      [37, 23],
      [801, 517],
    ]) {
      const px = testImage(w, h);
      const jpeg = encode(px, w, h, [5, 16, 33]);
      expect(readJpegDpi(jpeg)).toEqual({ x: 300, y: 300 });
      const meta = await sharp(jpeg).metadata();
      expect(meta.chromaSubsampling).toBe('4:2:0');
      expect(meta.density).toBe(300);
      // Reference: libjpeg via sharp, same quality and subsampling.
      const ref = await sharp(Buffer.from(px), { raw: { width: w, height: h, channels: 4 } })
        .removeAlpha()
        .jpeg({ quality: 92, chromaSubsampling: '4:2:0' })
        .toBuffer();
      expect(await psnr(jpeg, px, w, h)).toBeGreaterThan((await psnr(ref, px, w, h)) - 0.3);
      // No Huffman optimisation, so a little larger than libjpeg's output.
      if (w * h > 100_000) expect(jpeg.length).toBeLessThan(ref.length * 1.2);
    }
  });

  it('gives the same file regardless of strip size', () => {
    const w = 200;
    const h = 130;
    const px = testImage(w, h);
    const a = encode(px, w, h, [1]);
    const b = encode(px, w, h, [16]);
    const c = encode(px, w, h, [130]);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(true);
  });

  it('scales file size with quality', async () => {
    const w = 640;
    const h = 480;
    const px = testImage(w, h);
    const low = encode(px, w, h, [64], 0.5);
    const high = encode(px, w, h, [64], 0.92);
    expect(low.length).toBeLessThan(high.length);
    expect(await psnr(high, px, w, h)).toBeGreaterThan(await psnr(low, px, w, h));
  });

  it('rejects row-count mistakes', () => {
    const enc = new StripJpegEncoder(4, 4);
    expect(() => enc.finish()).toThrow(/Expected 4 rows/);
    expect(() => enc.addRows(new Uint8ClampedArray(4 * 5 * 4), 5)).toThrow(/Too many rows/);
  });
});
