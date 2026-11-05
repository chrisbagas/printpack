import { baseName } from './filename';
import type { ImageInfo } from './engine';

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

/** What the page knows about the current image. The pixels live in the engine. */
export interface LoadedImage extends ImageInfo {
  fileName: string;
  base: string;
  bytes: number;
  /** Object URL for the crop preview. */
  url: string;
}

export function validateFile(file: File): string | null {
  const byExt = /\.(jpe?g|png)$/i.test(file.name);
  if (!ACCEPTED_TYPES.includes(file.type) && !byExt) {
    return `“${file.name}” isn't a JPG or PNG.`;
  }
  return null;
}

export function describeImage(file: File, info: ImageInfo): LoadedImage {
  return {
    ...info,
    fileName: file.name,
    base: baseName(file.name),
    bytes: file.size,
    url: URL.createObjectURL(file),
  };
}
