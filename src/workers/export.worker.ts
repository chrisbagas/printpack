/// <reference lib="webworker" />
import { canvas2dAvailable } from '../lib/canvas';
import { decodeImage } from '../lib/decode';
import { exportJobs } from '../lib/exportJobs';
import type { Request, Response } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let bitmap: ImageBitmap | null = null;

function reply(msg: Response) {
  self.postMessage(msg);
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    switch (req.type) {
      case 'ping':
        reply({
          id: req.id,
          type: 'pong',
          canvas: !req.simulateNoCanvas && canvas2dAvailable() && typeof createImageBitmap === 'function',
        });
        break;
      case 'load': {
        bitmap?.close();
        bitmap = null;
        const decoded = await decodeImage(req.file, req.fileName);
        bitmap = decoded.bitmap;
        const { width, height, hasTransparency } = decoded;
        reply({ id: req.id, type: 'loaded', info: { width, height, hasTransparency } });
        break;
      }
      case 'export': {
        if (!bitmap) throw new Error('No image loaded.');
        const output = await exportJobs(bitmap, req.jobs, req.zipName, req.options, (progress) =>
          reply({ id: req.id, type: 'progress', progress }),
        );
        reply({ id: req.id, type: 'exported', output });
        break;
      }
    }
  } catch (err) {
    reply({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
