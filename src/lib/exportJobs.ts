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

export interface RenderedFile extends ExportedFile {
  blob: Blob;
}

/** Render every job to its own JPG. */
export async function renderJobs(
  bitmap: ImageBitmap,
  jobs: ExportJob[],
  options: ExportOptions,
  onProgress: (p: ExportProgress) => void,
): Promise<RenderedFile[]> {
  if (jobs.length === 0) throw new Error('Nothing to export.');
  const files: RenderedFile[] = [];
  for (const [index, job] of jobs.entries()) {
    onProgress({ index, total: jobs.length, job, fraction: 0 });
    const { blob, method } = await renderJpeg(bitmap, job.crop, job.width, job.height, {
      quality: options.quality,
      maxArea: options.maxArea,
      onProgress: (fraction) => onProgress({ index, total: jobs.length, job, fraction }),
    });
    files.push({ name: job.fileName, width: job.width, height: job.height, bytes: blob.size, method, blob });
    if (options.simulate === 'export-error') throw new Error('Simulated export failure.');
    if (options.simulate === 'worker-crash') {
      // An uncaught error outside this promise, as a real crash would raise.
      setTimeout(() => {
        throw new Error('Simulated worker crash');
      });
      await new Promise(() => {}); // never settles
    }
  }
  return files;
}

/** Render every job; one job returns its JPG, several return a ZIP. */
export async function exportJobs(
  bitmap: ImageBitmap,
  jobs: ExportJob[],
  zipName: string,
  options: ExportOptions,
  onProgress: (p: ExportProgress) => void,
): Promise<ExportOutput> {
  const rendered = await renderJobs(bitmap, jobs, options, onProgress);
  const files = rendered.map(({ blob: _blob, ...f }) => f);
  if (rendered.length === 1) return { blob: rendered[0].blob, fileName: rendered[0].name, files };
  onProgress({ index: jobs.length, total: jobs.length, job: null, fraction: null });
  const entries = await Promise.all(
    rendered.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })),
  );
  const zip = buildZip(entries);
  return { blob: new Blob([zip as BlobPart], { type: 'application/zip' }), fileName: zipName, files };
}

/**
 * Render a square from the middle of a job at full output scale, at the given
 * JPEG quality: a true 100% preview of what the exported file will look like.
 */
export async function previewJob(bitmap: ImageBitmap, job: ExportJob, quality: number, size = 480): Promise<Blob> {
  const w = Math.min(size, job.width);
  const h = Math.min(size, job.height);
  const scaleX = job.crop.width / job.width;
  const scaleY = job.crop.height / job.height;
  const crop = {
    x: job.crop.x + ((job.width - w) / 2) * scaleX,
    y: job.crop.y + ((job.height - h) / 2) * scaleY,
    width: w * scaleX,
    height: h * scaleY,
  };
  return (await renderJpeg(bitmap, crop, w, h, { quality })).blob;
}
