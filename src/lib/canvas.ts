/** Canvas helpers that work both on the page and inside a Web Worker. */
export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Any2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function get2d(canvas: AnyCanvas, opts?: CanvasRenderingContext2DSettings): Any2D | null {
  return canvas.getContext('2d', opts) as Any2D | null;
}

export function encodeCanvas(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the image.'))),
      type,
      quality,
    );
  });
}

export function releaseCanvas(canvas: AnyCanvas) {
  canvas.width = 0;
  canvas.height = 0;
}

/** True when 2D canvases work in this context (e.g. OffscreenCanvas in a worker). */
export function canvas2dAvailable(): boolean {
  try {
    const c = createCanvas(1, 1);
    return !!get2d(c);
  } catch {
    return false;
  }
}
