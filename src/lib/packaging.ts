import type { UploadLimits } from './marketplace';

export interface PackEntry {
  name: string;
  bytes: number;
}

/** One file the seller uploads to the listing. */
export interface UploadPlan {
  name: string;
  kind: 'jpg' | 'pdf' | 'zip';
  /** For a ZIP, the files inside it; otherwise the file itself. */
  contents: PackEntry[];
}

export type PackProblem =
  | { kind: 'file-too-large'; name: string; bytes: number; limit: number; inside?: string }
  | { kind: 'too-many-files'; count: number; limit: number };

/** Size of a stored (uncompressed) ZIP made by fflate with no extra fields. */
export function storedZipSize(entries: PackEntry[]): number {
  let size = 22; // end of central directory
  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name).length;
    size += 30 + nameBytes + e.bytes; // local header + data
    size += 46 + nameBytes; // central directory entry
  }
  return size;
}

/**
 * Decide what to upload. Images go up as separate files when everything fits
 * the limits (simplest for buyers); otherwise they're grouped into as few
 * stored ZIPs as fit the per-file limit. The printing guide is always its own
 * upload so buyers see it first, and it counts toward the file limit.
 *
 * This only plans; `checkUploads` validates the files actually built.
 */
export function planUploads(
  images: PackEntry[],
  guide: PackEntry,
  limits: UploadLimits,
  zipName: (index: number, total: number) => string,
): UploadPlan[] {
  const guideUpload: UploadPlan = { name: guide.name, kind: 'pdf', contents: [guide] };
  // Few enough files: upload each image as is. (An image over the size limit
  // is reported by checkUploads; zipping wouldn't make a JPG smaller.)
  if (images.length + 1 <= limits.maxFiles) {
    return [...images.map((i): UploadPlan => ({ name: i.name, kind: 'jpg', contents: [i] })), guideUpload];
  }

  // First-fit decreasing into ZIPs no larger than the limit. An image too big
  // for any ZIP gets a ZIP of its own and is reported by checkUploads.
  const bins: PackEntry[][] = [];
  for (const img of [...images].sort((a, b) => b.bytes - a.bytes)) {
    const bin = bins.find((b) => storedZipSize([...b, img]) <= limits.maxBytesPerFile);
    if (bin) bin.push(img);
    else bins.push([img]);
  }
  // Keep the seller's file order inside each ZIP.
  const order = new Map(images.map((i, n) => [i.name, n]));
  for (const b of bins) b.sort((x, y) => order.get(x.name)! - order.get(y.name)!);
  bins.sort((a, b) => order.get(a[0].name)! - order.get(b[0].name)!);
  return [...bins.map((contents, i): UploadPlan => ({ name: zipName(i, bins.length), kind: 'zip', contents })), guideUpload];
}

/** Check the uploads as actually built (their real byte sizes) against the limits. */
export function checkUploads(uploads: { name: string; bytes: number; contents: PackEntry[]; kind: UploadPlan['kind'] }[], limits: UploadLimits): PackProblem[] {
  const problems: PackProblem[] = [];
  if (uploads.length > limits.maxFiles) {
    problems.push({ kind: 'too-many-files', count: uploads.length, limit: limits.maxFiles });
  }
  for (const u of uploads) {
    if (u.bytes <= limits.maxBytesPerFile) continue;
    // Name the culprit: an image too big on its own, or the ZIP itself.
    const big = u.kind === 'zip' ? u.contents.find((c) => c.bytes > limits.maxBytesPerFile) : undefined;
    problems.push(
      big
        ? { kind: 'file-too-large', name: big.name, bytes: big.bytes, limit: limits.maxBytesPerFile, inside: u.name }
        : { kind: 'file-too-large', name: u.name, bytes: u.bytes, limit: limits.maxBytesPerFile },
    );
  }
  return problems;
}
