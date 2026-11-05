import { createCanvas, encodeCanvas, get2d, releaseCanvas, type Any2D, type AnyCanvas } from './canvas';
import { StripJpegEncoder } from './jpegEncoder';
import { setJpegDpi } from './jpegDpi';
import { PPI, type CropRect } from './print';

export interface RenderOptions {
  quality?: number;
  background?: string;
  dpi?: number;
  /**
   * Largest canvas, in pixels, to create. Browsers enforce their own limit
   * (about 16.7 MP in iOS Safari) and we detect that too; this lets tests
   * simulate a lower one.
   */
  maxArea?: number;
  /** Called with 0–1 while rendering in strips. */
  onProgress?: (fraction: number) => void;
}

export type RenderMethod = 'canvas' | 'strips';

export interface RenderResult {
  blob: Blob;
  method: RenderMethod;
}

export class CanvasLimitError extends Error {
  constructor(width: number, height: number) {
    super(`This browser can't create a ${width} × ${height} px canvas.`);
    this.name = 'CanvasLimitError';
  }
}

/** Extra rows rendered above and below each strip so resampling doesn't seam. */
const STRIP_MARGIN = 8;
/** Keep each strip's canvases small, even where the browser would allow more. */
const STRIP_BUDGET = 4_000_000;

function opaqueCanvas(width: number, height: number, background: string, maxArea: number) {
  if (width * height > maxArea) throw new CanvasLimitError(width, height);
  let canvas: AnyCanvas;
  try {
    canvas = createCanvas(width, height);
  } catch {
    throw new CanvasLimitError(width, height);
  }
  const ctx = get2d(canvas, { alpha: false });
  if (!ctx || canvas.width !== width || canvas.height !== height) {
    releaseCanvas(canvas);
    throw new CanvasLimitError(width, height);
  }
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  // Browsers fail silently past their canvas limit: check a pixel actually landed.
  const probe = ctx.getImageData(width - 1, height - 1, 1, 1).data;
  const expected = parseHex(background);
  if (expected && (probe[0] !== expected[0] || probe[1] !== expected[1] || probe[2] !== expected[2])) {
    releaseCanvas(canvas);
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

/**
 * How many times to halve after the first draw. Large reductions first scale
 * to out × 2^k (a reduction of less than 2×), then halve exactly k times:
 * a single big-ratio drawImage skips source pixels in some browsers.
 */
function halvings(srcW: number, srcH: number, outW: number, outH: number): number {
  const ratio = Math.min(srcW / outW, srcH / outH);
  return ratio >= 2 ? Math.floor(Math.log2(ratio)) : 0;
}

/** Draw a source rectangle into a new outW × outH canvas, flattened onto `background`. */
function drawScaled(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  outW: number,
  outH: number,
  k: number,
  background: string,
  maxArea: number,
): { canvas: AnyCanvas; ctx: Any2D } {
  let cur = opaqueCanvas(outW << k, outH << k, background, maxArea);
  try {
    cur.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW << k, outH << k);
    for (let i = k - 1; i >= 0; i--) {
      const next = opaqueCanvas(outW << i, outH << i, background, maxArea);
      next.ctx.drawImage(cur.canvas, 0, 0, outW << i, outH << i);
      releaseCanvas(cur.canvas);
      cur = next;
    }
    return cur;
  } catch (err) {
    releaseCanvas(cur.canvas);
    throw err;
  }
}

/**
 * Crop `source`, resize to exactly outW × outH, flatten transparency onto
 * `background`, and encode as a JPG tagged with `dpi`.
 *
 * Uses one canvas and the browser's JPEG encoder when it can. If the canvas
 * would be too large for the browser (or `maxArea`), or the browser can't
 * encode JPEG, renders in horizontal strips and encodes them with our own
 * streaming encoder, so memory stays small regardless of output size.
 */
export async function renderJpeg(
  source: CanvasImageSource,
  crop: CropRect,
  outW: number,
  outH: number,
  { quality = 0.92, background = '#ffffff', dpi = PPI, maxArea = Infinity, onProgress }: RenderOptions = {},
): Promise<RenderResult> {
  const k = halvings(crop.width, crop.height, outW, outH);
  if ((outW << k) * (outH << k) <= maxArea) {
    let canvas: AnyCanvas | null = null;
    try {
      canvas = drawScaled(source, crop.x, crop.y, crop.width, crop.height, outW, outH, k, background, maxArea).canvas;
      const blob = await encodeCanvas(canvas, 'image/jpeg', quality);
      if (blob.type === 'image/jpeg') {
        const tagged = setJpegDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
        return { blob: new Blob([tagged as BlobPart], { type: 'image/jpeg' }), method: 'canvas' };
      }
      // The browser fell back to another format: use our encoder instead.
    } catch (err) {
      if (!(err instanceof CanvasLimitError)) throw err;
    } finally {
      if (canvas) releaseCanvas(canvas);
    }
  }
  const blob = await renderStrips(source, crop, outW, outH, k, { quality, background, dpi, maxArea, onProgress });
  return { blob, method: 'strips' };
}

async function renderStrips(
  source: CanvasImageSource,
  crop: CropRect,
  outW: number,
  outH: number,
  k: number,
  { quality, background, dpi, maxArea, onProgress }: Required<Omit<RenderOptions, 'onProgress'>> & Pick<RenderOptions, 'onProgress'>,
): Promise<Blob> {
  const scaleY = crop.height / outH;
  const areaPerRow = (outW << k) << k;
  const budget = Math.min(maxArea, STRIP_BUDGET);
  const fitRows = Math.floor(budget / areaPerRow) - 2 * STRIP_MARGIN;
  const stripRows = Math.max(16, Math.floor(fitRows / 16) * 16);
  if ((stripRows + 2 * STRIP_MARGIN) * areaPerRow > maxArea) {
    throw new CanvasLimitError(outW << k, (stripRows + 2 * STRIP_MARGIN) << k);
  }

  const encoder = new StripJpegEncoder(outW, outH, quality, dpi);
  for (let y0 = 0; y0 < outH; y0 += stripRows) {
    const y1 = Math.min(outH, y0 + stripRows);
    const top = Math.max(0, y0 - STRIP_MARGIN);
    const bottom = Math.min(outH, y1 + STRIP_MARGIN);
    const { canvas, ctx } = drawScaled(
      source,
      crop.x,
      crop.y + top * scaleY,
      crop.width,
      (bottom - top) * scaleY,
      outW,
      bottom - top,
      k,
      background,
      maxArea,
    );
    const rows = ctx.getImageData(0, y0 - top, outW, y1 - y0).data;
    releaseCanvas(canvas);
    encoder.addRows(rows, y1 - y0);
    onProgress?.(y1 / outH);
    // Yield so progress messages and other work can run.
    await new Promise((r) => setTimeout(r, 0));
  }
  return new Blob(encoder.finish() as BlobPart[], { type: 'image/jpeg' });
}
