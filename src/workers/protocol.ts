import type { ExportJob, ExportOptions, ExportOutput, ExportProgress, RenderedFile } from '../lib/exportJobs';

export interface ImageInfo {
  width: number;
  height: number;
  hasTransparency: boolean;
}

export type Request =
  | { id: number; type: 'ping'; simulateNoCanvas?: boolean }
  | { id: number; type: 'load'; file: Blob; fileName: string }
  | { id: number; type: 'export'; jobs: ExportJob[]; zipName: string; options: ExportOptions }
  | { id: number; type: 'render'; jobs: ExportJob[]; options: ExportOptions }
  | { id: number; type: 'preview'; job: ExportJob; quality: number };

export type Response =
  | { id: number; type: 'pong'; canvas: boolean }
  | { id: number; type: 'loaded'; info: ImageInfo }
  | { id: number; type: 'progress'; progress: ExportProgress }
  | { id: number; type: 'exported'; output: ExportOutput }
  | { id: number; type: 'rendered'; files: RenderedFile[] }
  | { id: number; type: 'previewed'; blob: Blob }
  | { id: number; type: 'error'; message: string };
