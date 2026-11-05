export type RatioId = '2:3' | '3:4' | '4:5';
export type Orientation = 'portrait' | 'landscape';

/** A print size in inches, expressed as short side × long side. */
export interface PrintSize {
  short: number;
  long: number;
}

export interface Ratio {
  id: RatioId;
  short: number;
  long: number;
  /** Common print sizes that match this ratio exactly. */
  sizes: PrintSize[];
}

export const RATIOS: Record<RatioId, Ratio> = {
  '2:3': {
    id: '2:3',
    short: 2,
    long: 3,
    sizes: [
      { short: 4, long: 6 },
      { short: 8, long: 12 },
      { short: 10, long: 15 },
      { short: 12, long: 18 },
      { short: 16, long: 24 },
      { short: 20, long: 30 },
      { short: 24, long: 36 },
    ],
  },
  '3:4': {
    id: '3:4',
    short: 3,
    long: 4,
    sizes: [
      { short: 6, long: 8 },
      { short: 9, long: 12 },
      { short: 12, long: 16 },
      { short: 18, long: 24 },
      { short: 30, long: 40 },
    ],
  },
  '4:5': {
    id: '4:5',
    short: 4,
    long: 5,
    sizes: [
      { short: 4, long: 5 },
      { short: 8, long: 10 },
      { short: 12, long: 15 },
      { short: 16, long: 20 },
      { short: 24, long: 30 },
    ],
  },
};

export const RATIO_IDS: RatioId[] = ['2:3', '3:4', '4:5'];

/** Width and height for a short/long pair in the given orientation. */
export function orient(short: number, long: number, orientation: Orientation) {
  return orientation === 'portrait'
    ? { width: short, height: long }
    : { width: long, height: short };
}

/** Width ÷ height of a ratio in the given orientation. */
export function aspectOf(ratio: Ratio, orientation: Orientation): number {
  const { width, height } = orient(ratio.short, ratio.long, orientation);
  return width / height;
}

/** Ratio label as width:height, e.g. "4:5" portrait or "5:4" landscape. */
export function ratioLabel(ratio: Ratio, orientation: Orientation): string {
  const { width, height } = orient(ratio.short, ratio.long, orientation);
  return `${width}:${height}`;
}

export function orientationOf(width: number, height: number): Orientation {
  return width > height ? 'landscape' : 'portrait';
}
