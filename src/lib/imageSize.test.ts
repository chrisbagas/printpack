import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readImageSize } from './imageSize';

const blob = (buf: Buffer) => new Blob([new Uint8Array(buf)]);
const make = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#888' } });

describe('readImageSize', () => {
  it('reads PNG and JPEG headers', async () => {
    expect(await readImageSize(blob(await make(321, 123).png().toBuffer()))).toEqual({ width: 321, height: 123 });
    expect(await readImageSize(blob(await make(4000, 3000).jpeg().toBuffer()))).toEqual({ width: 4000, height: 3000 });
  });

  it('finds the frame after large EXIF and ICC segments', async () => {
    const jpeg = await make(640, 480)
      .withMetadata({ orientation: 6, icc: 'p3', exif: { IFD0: { ImageDescription: 'x'.repeat(30_000) } } })
      .jpeg({ progressive: true })
      .toBuffer();
    // Stored dimensions: orientation is applied later, by the decoder.
    expect(await readImageSize(blob(jpeg))).toEqual({ width: 640, height: 480 });
  });

  it('returns null for anything else', async () => {
    expect(await readImageSize(new Blob(['hello world']))).toBeNull();
    expect(await readImageSize(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))).toBeNull();
  });
});
