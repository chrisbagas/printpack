import { decodeImage } from './decode';
import { exportJobs, type ExportJob, type ExportOptions, type ExportOutput, type ExportProgress } from './exportJobs';
import type { ImageInfo, Request, Response } from '../workers/protocol';

export type { ImageInfo };

/**
 * Decodes, renders and zips images. Runs in a Web Worker when the browser
 * supports canvases there (OffscreenCanvas), so the page stays responsive;
 * otherwise runs the same code on the page.
 */
export interface Engine {
  readonly kind: 'worker' | 'main';
  load(file: File): Promise<ImageInfo>;
  export(
    jobs: ExportJob[],
    zipName: string,
    options: ExportOptions,
    onProgress: (p: ExportProgress) => void,
  ): Promise<ExportOutput>;
  dispose(): void;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

class WorkerEngine implements Engine {
  readonly kind = 'worker';
  private nextId = 1;
  private readonly pending = new Map<number, (msg: Response) => void>();
  private readonly worker: Worker;

  constructor() {
    this.worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Response>) => this.pending.get(e.data.id)?.(e.data);
    // A crash (for example, running out of memory) fails every request in flight.
    this.worker.onerror = (e) => {
      e.preventDefault();
      const message = e.message || 'The export worker stopped unexpectedly. Try a smaller size.';
      for (const [id, fn] of [...this.pending]) fn({ id, type: 'error', message });
    };
  }

  /** Send a request; `onMessage` returns a value to settle, or undefined to keep listening. */
  private call<T>(req: DistributiveOmit<Request, 'id'>, onMessage: (msg: Response) => T | undefined, transfer?: Transferable[]) {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (msg) => {
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
      });
      this.worker.postMessage({ ...req, id } as Request, transfer ?? []);
    });
  }

  ping(timeoutMs: number): Promise<boolean> {
    const pong = this.call({ type: 'ping' }, (m) => (m.type === 'pong' ? m.canvas : undefined));
    const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs));
    return Promise.race([pong.catch(() => false), timeout]);
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

  dispose() {
    this.worker.terminate();
  }
}

class MainThreadEngine implements Engine {
  readonly kind = 'main';
  private bitmap: ImageBitmap | null = null;

  async load(file: File) {
    this.bitmap?.close();
    this.bitmap = null;
    const decoded = await decodeImage(file, file.name);
    this.bitmap = decoded.bitmap;
    return { width: decoded.width, height: decoded.height, hasTransparency: decoded.hasTransparency };
  }

  async export(jobs: ExportJob[], zipName: string, options: ExportOptions, onProgress: (p: ExportProgress) => void) {
    if (!this.bitmap) throw new Error('No image loaded.');
    return exportJobs(this.bitmap, jobs, zipName, options, (p) => onProgress(p));
  }

  dispose() {
    this.bitmap?.close();
  }
}

export async function createEngine(prefer: 'worker' | 'main' = 'worker'): Promise<Engine> {
  if (prefer === 'worker' && typeof Worker !== 'undefined') {
    try {
      const engine = new WorkerEngine();
      if (await engine.ping(3000)) return engine;
      engine.dispose();
    } catch {
      // Fall through to the main thread.
    }
  }
  return new MainThreadEngine();
}
