import { baseName } from './filename';

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

export interface LoadedImage {
  fileName: string;
  base: string;
  type: string;
  bytes: number;
  /** Object URL for the crop preview. */
  url: string;
  /** Decoded pixels, already rotated per EXIF orientation. */
  bitmap: ImageBitmap;
  width: number;
  height: number;
  hasTransparency: boolean;
}

export function validateFile(file: File): string | null {
  const byExt = /\.(jpe?g|png)$/i.test(file.name);
  if (!ACCEPTED_TYPES.includes(file.type) && !byExt) {
    return `“${file.name}” isn't a JPG or PNG.`;
  }
  return null;
}

/** PNG color types 4 and 6 have alpha; a tRNS chunk adds transparency to others. */
async function pngMayHaveAlpha(file: File): Promise<boolean> {
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
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

export async function loadImage(file: File): Promise<LoadedImage> {
  const problem = validateFile(file);
  if (problem) throw new Error(problem);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      `Couldn't open “${file.name}”. The file may be damaged, or too large for this browser to decode.`,
    );
  }

  const hasTransparency = (await pngMayHaveAlpha(file)) && bitmapHasTransparency(bitmap);

  return {
    fileName: file.name,
    base: baseName(file.name),
    type: file.type,
    bytes: file.size,
    url: URL.createObjectURL(file),
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    hasTransparency,
  };
}

export function releaseImage(img: LoadedImage): void {
  URL.revokeObjectURL(img.url);
  img.bitmap.close();
}
