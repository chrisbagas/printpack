import { renderJpeg, type RenderMethod } from './render';
import type { CropRect } from './print';
import { buildZip } from './zip';

export interface ExportJob {
  fileName: string;
  crop: CropRect;
  width: number;
  height: number;
}

export interface ExportOptions {
  quality?: number;
  maxArea?: number;
  /** Test hook: fail after the first file is rendered. */
  simulate?: 'export-error' | 'worker-crash';
}

export interface ExportedFile {
  name: string;
  width: number;
  height: number;
  bytes: number;
  method: RenderMethod;
}

export interface ExportOutput {
  blob: Blob;
  fileName: string;
  files: ExportedFile[];
}

export interface ExportProgress {
  index: number;
  total: number;
  job: ExportJob | null;
  /** 0–1 within the current file; null while packing the ZIP. */
  fraction: number | null;
}

/** Render every job; one job returns its JPG, several return a ZIP. */
export async function exportJobs(
  bitmap: ImageBitmap,
  jobs: ExportJob[],
  zipName: string,
  options: ExportOptions,
  onProgress: (p: ExportProgress) => void,
): Promise<ExportOutput> {
  if (jobs.length === 0) throw new Error('Nothing to export.');
  const files: ExportedFile[] = [];
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const [index, job] of jobs.entries()) {
    onProgress({ index, total: jobs.length, job, fraction: 0 });
    const { blob, method } = await renderJpeg(bitmap, job.crop, job.width, job.height, {
      quality: options.quality,
      maxArea: options.maxArea,
      onProgress: (fraction) => onProgress({ index, total: jobs.length, job, fraction }),
    });
    files.push({ name: job.fileName, width: job.width, height: job.height, bytes: blob.size, method });
    if (options.simulate === 'export-error') throw new Error('Simulated export failure.');
    if (options.simulate === 'worker-crash') {
      // An uncaught error outside this promise, as a real crash would raise.
      setTimeout(() => {
        throw new Error('Simulated worker crash');
      });
      await new Promise(() => {}); // never settles
    }
    if (jobs.length === 1) return { blob, fileName: job.fileName, files };
    entries.push({ name: job.fileName, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  onProgress({ index: jobs.length, total: jobs.length, job: null, fraction: null });
  const zip = buildZip(entries);
  return { blob: new Blob([zip as BlobPart], { type: 'application/zip' }), fileName: zipName, files };
}
