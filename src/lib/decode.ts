import { createCanvas, get2d, releaseCanvas } from './canvas';

export interface DecodedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  hasTransparency: boolean;
}

/** PNG colour types 4 and 6 have alpha; a tRNS chunk adds transparency to others. */
async function pngMayHaveAlpha(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (!isPng) return false;
  const colorType = head[25];
  if (colorType === 4 || colorType === 6) return true;
  // tRNS must come before the first IDAT, so it sits in the header area.
  const text = new TextDecoder('latin1').decode(head);
  const idat = text.indexOf('IDAT');
  const trns = text.indexOf('tRNS');
  return trns !== -1 && (idat === -1 || trns < idat);
}

/** Check a downsampled copy for any pixel that isn't fully opaque. */
function bitmapHasTransparency(bitmap: ImageBitmap): boolean {
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = get2d(canvas, { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  releaseCanvas(canvas);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

export async function decodeImage(file: Blob, fileName: string): Promise<DecodedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      `Couldn't open “${fileName}”. The file may be damaged, or too large for this browser to decode.`,
    );
  }
  const hasTransparency = (await pngMayHaveAlpha(file)) && bitmapHasTransparency(bitmap);
  return { bitmap, width: bitmap.width, height: bitmap.height, hasTransparency };
}
