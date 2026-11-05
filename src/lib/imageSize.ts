/**
 * Read an image's pixel dimensions from its header without decoding it, so
 * we can explain (or refuse) inputs that are too large before the browser
 * tries to allocate memory for them.
 */
export interface HeaderSize {
  width: number;
  height: number;
}

/** Decoded images take width × height × 4 bytes; past this we refuse up front. */
export const MAX_DECODE_PIXELS = 250_000_000;

async function bytes(file: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}

export async function readImageSize(file: Blob): Promise<HeaderSize | null> {
  const head = await bytes(file, 0, 32);
  // PNG: IHDR is always the first chunk.
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  // JPEG: walk the marker segments until a start-of-frame.
  if (head[0] === 0xff && head[1] === 0xd8) {
    let pos = 2;
    for (let guard = 0; guard < 1000 && pos < file.size; guard++) {
      const seg = await bytes(file, pos, 9);
      if (seg.length < 4 || seg[0] !== 0xff) return null;
      const marker = seg[1];
      if (marker === 0xff) {
        pos += 1; // fill byte
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        pos += 2;
        continue;
      }
      const length = (seg[2] << 8) | seg[3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (seg.length < 9) return null;
        return { height: (seg[5] << 8) | seg[6], width: (seg[7] << 8) | seg[8] };
      }
      if (marker === 0xda || marker === 0xd9) return null; // scan data before any frame header
      pos += 2 + length;
    }
  }
  return null;
}

export function megapixels(width: number, height: number): string {
  return `${Math.round((width * height) / 1e5) / 10} MP`;
}
