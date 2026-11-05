import { createCanvas, get2d, releaseCanvas } from './canvas';
import { MAX_DECODE_PIXELS, megapixels, readImageSize } from './imageSize';

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
  const header = await readImageSize(file);
  const size = header ? `${header.width.toLocaleString('en-US')} × ${header.height.toLocaleString('en-US')} px (${megapixels(header.width, header.height)})` : null;
  if (header && header.width * header.height > MAX_DECODE_PIXELS) {
    throw new Error(
      `“${fileName}” is ${size}, more than PrintPack can open in a browser ` +
        `(${megapixels(MAX_DECODE_PIXELS, 1)} max). Save a smaller copy, for example 12,000 px on the long side, and try that.`,
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      size
        ? `This browser couldn't open “${fileName}” (${size}). It's probably more than this device has memory for. ` +
            `Try a smaller copy of the image, or a desktop browser.`
        : `Couldn't open “${fileName}”. The file may be damaged or not a real JPG or PNG.`,
    );
  }

  // Some browsers quietly decode huge images at reduced size; print sizes would be wrong.
  if (header) {
    const same = bitmap.width === header.width && bitmap.height === header.height;
    const rotated = bitmap.width === header.height && bitmap.height === header.width;
    if (!same && !rotated) {
      const got = `${bitmap.width} × ${bitmap.height}`;
      bitmap.close();
      throw new Error(
        `This browser opened “${fileName}” at reduced size (${got} px instead of ${size}), ` +
          `so print sizes would be wrong. Try a smaller copy of the image, or a desktop browser.`,
      );
    }
  }

  const hasTransparency = (await pngMayHaveAlpha(file)) && bitmapHasTransparency(bitmap);
  return { bitmap, width: bitmap.width, height: bitmap.height, hasTransparency };
}
