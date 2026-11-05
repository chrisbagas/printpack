/**
 * Browsers write JPEGs without a meaningful resolution tag. Print labs and
 * editors read it from the JFIF APP0 header, so we set it to the print PPI.
 */
const JFIF = [0x4a, 0x46, 0x49, 0x46, 0x00]; // "JFIF\0"

function hasJfifApp0(b: Uint8Array): boolean {
  return b[2] === 0xff && b[3] === 0xe0 && JFIF.every((v, i) => b[6 + i] === v);
}

export function setJpegDpi(src: Uint8Array, dpi: number): Uint8Array {
  if (src[0] !== 0xff || src[1] !== 0xd8) throw new Error('Not a JPEG file');
  const hi = (dpi >> 8) & 0xff;
  const lo = dpi & 0xff;

  if (hasJfifApp0(src)) {
    const out = src.slice();
    out[13] = 1; // units: dots per inch
    out[14] = hi;
    out[15] = lo;
    out[16] = hi;
    out[17] = lo;
    return out;
  }

  // No JFIF header: insert one right after SOI.
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...JFIF, 0x01, 0x01, 0x01, hi, lo, hi, lo, 0x00, 0x00];
  const out = new Uint8Array(src.length + app0.length);
  out.set(src.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(src.subarray(2), 2 + app0.length);
  return out;
}

export function readJpegDpi(b: Uint8Array): { x: number; y: number } | null {
  if (!hasJfifApp0(b) || b[13] !== 1) return null;
  return { x: (b[14] << 8) | b[15], y: (b[16] << 8) | b[17] };
}
