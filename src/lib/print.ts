import { orient, type Orientation, type PrintSize, type Ratio } from './ratios';

export const PPI = 300;

/** Upscaling by less than this (0.1%) is a rounding artefact, not a real enlargement. */
const UPSCALE_TOLERANCE = 1.001;

export interface PixelSize {
  width: number;
  height: number;
}

export interface CropRect extends PixelSize {
  x: number;
  y: number;
}

export interface ExportTarget {
  /** Stable id, unique across ratios and orientations. */
  key: string;
  kind: 'standard' | 'full';
  ratio: Ratio;
  orientation: Orientation;
  widthIn: number;
  heightIn: number;
  widthPx: number;
  heightPx: number;
}

/** Largest print, in inches, that the crop supports at the given PPI. */
export function maxPrintInches(crop: PixelSize, ppi = PPI): PixelSize {
  return { width: crop.width / ppi, height: crop.height / ppi };
}

export function standardTarget(
  ratio: Ratio,
  size: PrintSize,
  orientation: Orientation,
  ppi = PPI,
): ExportTarget {
  const inches = orient(size.short, size.long, orientation);
  return {
    key: `${ratio.id}-${orientation}-${size.short}x${size.long}`,
    kind: 'standard',
    ratio,
    orientation,
    widthIn: inches.width,
    heightIn: inches.height,
    widthPx: Math.round(inches.width * ppi),
    heightPx: Math.round(inches.height * ppi),
  };
}

/**
 * The crop at its own resolution, trimmed by at most a few pixels so the
 * output matches the ratio exactly (e.g. a 4:5 crop becomes 4k × 5k pixels).
 */
export function fullResTarget(
  ratio: Ratio,
  orientation: Orientation,
  crop: PixelSize,
  ppi = PPI,
): ExportTarget {
  const unit = orient(ratio.short, ratio.long, orientation);
  const k = Math.max(1, Math.floor(Math.min(crop.width / unit.width, crop.height / unit.height)));
  const widthPx = k * unit.width;
  const heightPx = k * unit.height;
  return {
    key: `${ratio.id}-${orientation}-full`,
    kind: 'full',
    ratio,
    orientation,
    widthIn: widthPx / ppi,
    heightIn: heightPx / ppi,
    widthPx,
    heightPx,
  };
}

export function targetsFor(
  ratio: Ratio,
  orientation: Orientation,
  crop: PixelSize,
  ppi = PPI,
): ExportTarget[] {
  return [
    fullResTarget(ratio, orientation, crop, ppi),
    ...ratio.sizes.map((s) => standardTarget(ratio, s, orientation, ppi)),
  ];
}

/** How much the crop must be enlarged to reach the target (1 = no change). */
export function scaleFactor(crop: PixelSize, target: PixelSizeLike): number {
  return Math.max(target.widthPx / crop.width, target.heightPx / crop.height);
}

interface PixelSizeLike {
  widthPx: number;
  heightPx: number;
}

export function needsUpscale(crop: PixelSize, target: PixelSizeLike): boolean {
  return scaleFactor(crop, target) > UPSCALE_TOLERANCE;
}

/** Real source pixels per printed inch for this target. */
export function effectivePpi(crop: PixelSize, target: ExportTarget): number {
  return Math.min(crop.width / target.widthIn, crop.height / target.heightIn);
}

/** 16 → "16", 13.333 → "13.3". */
export function formatInches(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Largest centred crop of the given aspect (width ÷ height) inside the image. */
export function centeredCrop(image: PixelSize, aspect: number): CropRect {
  let width = image.width;
  let height = Math.round(width / aspect);
  if (height > image.height) {
    height = image.height;
    width = Math.round(height * aspect);
  }
  return {
    x: Math.round((image.width - width) / 2),
    y: Math.round((image.height - height) / 2),
    width,
    height,
  };
}
