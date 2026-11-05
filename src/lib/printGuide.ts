import { formatInches, PPI, type CropRect } from './print';
import { orient, ratioLabel, type Orientation, type Ratio } from './ratios';

/** A rendered JPG, as measured from the actual file. */
export interface RenderedPackFile {
  fileName: string;
  ratio: Ratio;
  orientation: Orientation;
  /** Read from the JPEG header of the exported file. */
  widthPx: number;
  heightPx: number;
  bytes: number;
  /** The source crop it was rendered from: how much real detail it carries. */
  crop: CropRect;
  /** Name of the upload (the file itself, or a ZIP) that contains it. */
  upload: string;
}

export interface GuideSize {
  label: string;
  widthIn: number;
  heightIn: number;
  /** Source (artwork) pixels per printed inch at this size. */
  detailPpi: number;
}

export interface GuideFile {
  fileName: string;
  upload: string;
  shape: string;
  widthPx: number;
  heightPx: number;
  bytes: number;
  /** Sizes this file prints at 300 PPI or more of real detail. */
  sharp: GuideSize[];
  /** Sizes the file has pixels for, but only because it was enlarged. */
  enlarged: GuideSize[];
  /** True when the file has more pixels than its source crop. */
  upscaled: boolean;
  /** Largest print at 300 PPI from the original artwork. */
  nativeMax: { widthIn: number; heightIn: number };
}

export interface PrintGuide {
  artworkName: string;
  files: GuideFile[];
  /** Every listed size, sorted small to large, with the file to use. */
  lookup: { label: string; fileName: string; sharp: boolean; detailPpi: number }[];
}

/** Allow for sub-pixel rounding (0.1%) when comparing sizes. */
const TOLERANCE = 1.001;

function sizeLabel(widthIn: number, heightIn: number) {
  return `${formatInches(widthIn)} × ${formatInches(heightIn)} in`;
}

/**
 * Describe what each exported file can print, using only its measured pixels
 * and the source crop. Sizes larger than the file are never listed; sizes the
 * file covers only by enlargement are listed separately, with their real PPI.
 */
export function buildGuide(artworkName: string, files: RenderedPackFile[]): PrintGuide {
  const guideFiles: GuideFile[] = files.map((f) => {
    const sharp: GuideSize[] = [];
    const enlarged: GuideSize[] = [];
    for (const s of f.ratio.sizes) {
      const { width: widthIn, height: heightIn } = orient(s.short, s.long, f.orientation);
      const fits = widthIn * PPI <= f.widthPx * TOLERANCE && heightIn * PPI <= f.heightPx * TOLERANCE;
      if (!fits) continue;
      const detailPpi = Math.min(f.crop.width / widthIn, f.crop.height / heightIn);
      const size = { label: sizeLabel(widthIn, heightIn), widthIn, heightIn, detailPpi };
      (detailPpi * TOLERANCE >= PPI ? sharp : enlarged).push(size);
    }
    return {
      fileName: f.fileName,
      upload: f.upload,
      shape: `${ratioLabel(f.ratio, f.orientation)} ${f.orientation}`,
      widthPx: f.widthPx,
      heightPx: f.heightPx,
      bytes: f.bytes,
      sharp,
      enlarged,
      upscaled: f.widthPx > f.crop.width * TOLERANCE || f.heightPx > f.crop.height * TOLERANCE,
      nativeMax: { widthIn: f.crop.width / PPI, heightIn: f.crop.height / PPI },
    };
  });

  const lookup = guideFiles
    .flatMap((f) => [
      ...f.sharp.map((s) => ({ s, fileName: f.fileName, sharp: true })),
      ...f.enlarged.map((s) => ({ s, fileName: f.fileName, sharp: false })),
    ])
    .sort((a, b) => a.s.widthIn * a.s.heightIn - b.s.widthIn * b.s.heightIn || a.s.widthIn - b.s.widthIn)
    .map(({ s, fileName, sharp }) => ({ label: s.label, fileName, sharp, detailPpi: s.detailPpi }));

  return { artworkName, files: guideFiles, lookup };
}
