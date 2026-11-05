import { describe, expect, it } from 'vitest';
import { readJpegDpi, setJpegDpi } from './jpegDpi';

// SOI + JFIF APP0 (aspect-ratio units, 1×1) + EOI: what Chrome's encoder writes.
const withJfif = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const withoutJfif = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9]);

describe('setJpegDpi', () => {
  it('rewrites an existing JFIF header in place', () => {
    const out = setJpegDpi(withJfif, 300);
    expect(out.length).toBe(withJfif.length);
    expect(readJpegDpi(out)).toEqual({ x: 300, y: 300 });
    expect(readJpegDpi(withJfif)).toBeNull();
  });
  it('inserts a JFIF header when missing', () => {
    const out = setJpegDpi(withoutJfif, 300);
    expect(out.length).toBe(withoutJfif.length + 18);
    expect(readJpegDpi(out)).toEqual({ x: 300, y: 300 });
    expect(Array.from(out.subarray(20))).toEqual(Array.from(withoutJfif.subarray(2)));
  });
  it('rejects non-JPEG data', () => {
    expect(() => setJpegDpi(new Uint8Array([0x89, 0x50]), 300)).toThrow();
  });
});
