import { setJpegDpi } from './jpegDpi';
import { PPI, type CropRect } from './print';

export interface RenderOptions {
  quality?: number;
  background?: string;
  dpi?: number;
}

export class CanvasLimitError extends Error {
  constructor(width: number, height: number) {
    super(
      `This browser can't create a ${width} × ${height} px image. Try a smaller print size or another browser.`,
    );
    this.name = 'CanvasLimitError';
  }
}

function opaqueCanvas(width: number, height: number, background: string) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx || canvas.width !== width || canvas.height !== height) {
    throw new CanvasLimitError(width, height);
  }
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  // Browsers fail silently past their canvas size limit: verify a pixel landed.
  const probe = ctx.getImageData(width - 1, height - 1, 1, 1).data;
  const expected = parseHex(background);
  if (expected && (probe[0] !== expected[0] || probe[1] !== expected[1] || probe[2] !== expected[2])) {
    throw new CanvasLimitError(width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the JPG.'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Crop `source` to `crop`, resize to exactly outWidth × outHeight, flatten
 * transparency onto `background`, and encode as a JPG tagged with `dpi`.
 *
 * Large reductions are done in halving steps, since a single high-ratio
 * drawImage skips source pixels in some browsers and looks jagged.
 */
export async function renderJpeg(
  source: ImageBitmap,
  crop: CropRect,
  outWidth: number,
  outHeight: number,
  { quality = 0.92, background = '#ffffff', dpi = PPI }: RenderOptions = {},
): Promise<Blob> {
  let src: CanvasImageSource = source;
  let sx = crop.x;
  let sy = crop.y;
  let sw = crop.width;
  let sh = crop.height;
  let intermediate: HTMLCanvasElement | null = null;

  while (sw / 2 > outWidth && sh / 2 > outHeight) {
    const w = Math.round(sw / 2);
    const h = Math.round(sh / 2);
    const step = opaqueCanvas(w, h, background);
    step.ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    if (intermediate) release(intermediate);
    intermediate = step.canvas;
    src = step.canvas;
    sx = 0;
    sy = 0;
    sw = w;
    sh = h;
  }

  const out = opaqueCanvas(outWidth, outHeight, background);
  out.ctx.drawImage(src, sx, sy, sw, sh, 0, 0, outWidth, outHeight);
  if (intermediate) release(intermediate);

  try {
    const blob = await toBlob(out.canvas, quality);
    const tagged = setJpegDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
    return new Blob([tagged as BlobPart], { type: 'image/jpeg' });
  } finally {
    release(out.canvas);
  }
}
