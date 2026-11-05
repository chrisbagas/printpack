import { decodeImage } from './decode';
import {
  exportJobs,
  previewJob,
  renderJobs,
  type ExportJob,
  type ExportOptions,
  type ExportOutput,
  type ExportProgress,
  type RenderedFile,
} from './exportJobs';
import type { Simulation } from './simulate';
import type { ImageInfo, Request, Response } from '../workers/protocol';

export type { ImageInfo };

export class EngineStoppedError extends Error {
  constructor(message = 'The export was stopped.') {
    super(message);
    this.name = 'EngineStoppedError';
  }
}

/**
 * Decodes, renders and zips images. Runs in a Web Worker when the browser
 * supports canvases there (OffscreenCanvas), so the page stays responsive;
 * otherwise runs the same code on the page.
 */
export interface Engine {
  readonly kind: 'worker' | 'main';
  /** False once the engine crashed or was disposed; it can't be used again. */
  readonly alive: boolean;
  load(file: File): Promise<ImageInfo>;
  export(
    jobs: ExportJob[],
    zipName: string,
    options: ExportOptions,
    onProgress: (p: ExportProgress) => void,
  ): Promise<ExportOutput>;
  /** Render each job to its own JPG, without packaging. */
  render(jobs: ExportJob[], options: ExportOptions, onProgress: (p: ExportProgress) => void): Promise<RenderedFile[]>;
  /** A 100% crop from the middle of a job at the given JPEG quality. */
  preview(job: ExportJob, quality: number): Promise<Blob>;
  dispose(): void;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

const CRASH_MESSAGE =
  'The export stopped unexpectedly, which usually means the browser ran out of memory. ' +
  'Your image is still loaded: try again, or choose fewer or smaller sizes.';

class WorkerEngine implements Engine {
  readonly kind = 'worker';
  alive = true;
  private nextId = 1;
  private readonly pending = new Map<number, { onMessage: (msg: Response) => void; reject: (e: Error) => void }>();
  private readonly worker: Worker;

  constructor(simulate: Simulation | null) {
    this.worker =
      simulate === 'worker-load-fail'
        ? new Worker(new URL('/missing-export-worker.js', location.href), { type: 'module' })
        : new Worker(new URL('../workers/export.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Response>) => this.pending.get(e.data.id)?.onMessage(e.data);
    // A script that fails to load, or an uncaught error, ends this worker for good.
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.stop(new Error(CRASH_MESSAGE));
    };
    this.worker.onmessageerror = () => this.stop(new Error(CRASH_MESSAGE));
  }

  /** Terminate and settle every request still in flight. */
  private stop(reason: Error) {
    if (!this.alive) return;
    this.alive = false;
    this.worker.terminate();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) p.reject(reason);
  }

  /** Send a request; `onMessage` returns a value to settle, or undefined to keep listening. */
  private call<T>(req: DistributiveOmit<Request, 'id'>, onMessage: (msg: Response) => T | undefined) {
    if (!this.alive) return Promise.reject(new EngineStoppedError(CRASH_MESSAGE));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        reject,
        onMessage: (msg) => {
          if (msg.type === 'error') {
            this.pending.delete(id);
            reject(new Error(msg.message));
            return;
          }
          const result = onMessage(msg);
          if (result !== undefined) {
            this.pending.delete(id);
            resolve(result);
          }
        },
      });
      this.worker.postMessage({ ...req, id } as Request);
    });
  }

  ping(timeoutMs: number, simulateNoCanvas: boolean): Promise<boolean> {
    const pong = this.call({ type: 'ping', simulateNoCanvas }, (m) => (m.type === 'pong' ? m.canvas : undefined));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), timeoutMs);
    });
    return Promise.race([pong.catch(() => false), timeout]).finally(() => clearTimeout(timer));
  }

  load(file: File) {
    return this.call({ type: 'load', file, fileName: file.name }, (m) => (m.type === 'loaded' ? m.info : undefined));
  }

  export(jobs: ExportJob[], zipName: string, options: ExportOptions, onProgress: (p: ExportProgress) => void) {
    return this.call({ type: 'export', jobs, zipName, options }, (m) => {
      if (m.type === 'progress') onProgress(m.progress);
      return m.type === 'exported' ? m.output : undefined;
    });
  }

  render(jobs: ExportJob[], options: ExportOptions, onProgress: (p: ExportProgress) => void) {
    return this.call({ type: 'render', jobs, options }, (m) => {
      if (m.type === 'progress') onProgress(m.progress);
      return m.type === 'rendered' ? m.files : undefined;
    });
  }

  preview(job: ExportJob, quality: number) {
    return this.call({ type: 'preview', job, quality }, (m) => (m.type === 'previewed' ? m.blob : undefined));
  }

  dispose() {
    this.stop(new EngineStoppedError());
  }
}

class MainThreadEngine implements Engine {
  readonly kind = 'main';
  alive = true;
  private bitmap: ImageBitmap | null = null;

  async load(file: File) {
    this.bitmap?.close();
    this.bitmap = null;
    const decoded = await decodeImage(file, file.name);
    if (!this.alive) {
      decoded.bitmap.close();
      throw new EngineStoppedError();
    }
    this.bitmap = decoded.bitmap;
    return { width: decoded.width, height: decoded.height, hasTransparency: decoded.hasTransparency };
  }

  async export(jobs: ExportJob[], zipName: string, options: ExportOptions, onProgress: (p: ExportProgress) => void) {
    if (!this.bitmap) throw new Error('No image loaded.');
    // A crash can't be simulated on the page; treat it as an ordinary failure.
    const simulate = options.simulate === 'worker-crash' ? 'export-error' : options.simulate;
    return exportJobs(this.bitmap, jobs, zipName, { ...options, simulate }, onProgress);
  }

  async render(jobs: ExportJob[], options: ExportOptions, onProgress: (p: ExportProgress) => void) {
    if (!this.bitmap) throw new Error('No image loaded.');
    const simulate = options.simulate === 'worker-crash' ? 'export-error' : options.simulate;
    return renderJobs(this.bitmap, jobs, { ...options, simulate }, onProgress);
  }

  async preview(job: ExportJob, quality: number) {
    if (!this.bitmap) throw new Error('No image loaded.');
    return previewJob(this.bitmap, job, quality);
  }

  dispose() {
    this.alive = false;
    this.bitmap?.close();
    this.bitmap = null;
  }
}

async function createEngine(prefer: 'worker' | 'main', simulate: Simulation | null): Promise<Engine> {
  if (prefer === 'worker' && typeof Worker !== 'undefined') {
    let engine: WorkerEngine | null = null;
    try {
      engine = new WorkerEngine(simulate);
      if (await engine.ping(5000, simulate === 'worker-no-canvas')) return engine;
    } catch {
      // Fall through to the main thread.
    }
    engine?.dispose();
  }
  return new MainThreadEngine();
}

/**
 * Owns the engine for the page. Runs one operation at a time (so loading a
 * new image can't pull pixels out from under an export), replaces an engine
 * that crashed, and reloads the current image into the replacement.
 */
export class EngineHost {
  private engine: Promise<Engine> | null = null;
  private file: File | null = null;
  private loadedInto: Engine | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly prefer: 'worker' | 'main';
  private readonly simulate: Simulation | null;
  private readonly onKind: (kind: Engine['kind']) => void;

  constructor(prefer: 'worker' | 'main', simulate: Simulation | null, onKind: (kind: Engine['kind']) => void = () => {}) {
    this.prefer = prefer;
    this.simulate = simulate;
    this.onKind = onKind;
  }

  private async current(): Promise<Engine> {
    if (this.disposed) throw new EngineStoppedError();
    if (this.engine) {
      const e = await this.engine;
      if (e.alive) return e;
    }
    this.engine = createEngine(this.prefer, this.simulate).then((e) => {
      this.onKind(e.kind);
      return e;
    });
    return this.engine;
  }

  /** Start the engine early, so the first upload doesn't wait for it. */
  warmUp(): void {
    void this.enqueue(() => this.current());
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op, op);
    this.queue = run.catch(() => undefined);
    return run;
  }

  load(file: File): Promise<ImageInfo> {
    return this.enqueue(async () => {
      const engine = await this.current();
      this.loadedInto = null;
      const info = await engine.load(file);
      this.file = file;
      this.loadedInto = engine;
      return info;
    });
  }

  /** Run an operation on a live engine that has the current image loaded. */
  private withImage<T>(op: (engine: Engine) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const engine = await this.current();
      if (this.loadedInto !== engine) {
        if (!this.file) throw new Error('No image loaded.');
        await engine.load(this.file); // after a crash, the new engine needs the image again
        this.loadedInto = engine;
      }
      return op(engine);
    });
  }

  export(jobs: ExportJob[], zipName: string, options: ExportOptions, onProgress: (p: ExportProgress) => void) {
    return this.withImage((e) => e.export(jobs, zipName, options, onProgress));
  }

  render(jobs: ExportJob[], options: ExportOptions, onProgress: (p: ExportProgress) => void) {
    return this.withImage((e) => e.render(jobs, options, onProgress));
  }

  preview(job: ExportJob, quality: number) {
    return this.withImage((e) => e.preview(job, quality));
  }

  dispose(): void {
    this.disposed = true;
    void this.engine?.then((e) => e.dispose());
    this.engine = null;
  }
}
