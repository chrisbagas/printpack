import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CropStage, MAX_ZOOM, type CropState } from './components/CropStage';
import { ExportQueue, ExportResults, type QueueItem } from './components/ExportQueue';
import { RatioPicker } from './components/RatioPicker';
import { SizeList } from './components/SizeList';
import { Uploader } from './components/Uploader';
import { UpscaleDialog, type UpscaleItem } from './components/UpscaleDialog';
import { downloadBlob } from './lib/download';
import { exportFileName, zipFileName } from './lib/filename';
import { createEngine, type Engine } from './lib/engine';
import type { ExportedFile, ExportOptions, ExportProgress } from './lib/exportJobs';
import { describeImage, validateFile, type LoadedImage } from './lib/image';
import {
  centeredCrop,
  effectivePpi,
  formatBytes,
  formatInches,
  maxPrintInches,
  needsUpscale,
  scaleFactor,
  targetsFor,
  type CropRect,
  type ExportTarget,
} from './lib/print';
import {
  aspectOf,
  orientationOf,
  RATIO_IDS,
  RATIOS,
  type Orientation,
  type RatioId,
} from './lib/ratios';
import './App.css';

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

interface Results {
  files: ExportedFile[];
  zip: { name: string; bytes: number } | null;
}

const ORIENTATIONS: Orientation[] = ['portrait', 'landscape'];
const DEFAULT_RATIO: RatioId = '4:5';
const groupKey = (ratio: RatioId, o: Orientation) => `${ratio}-${o}`;
const fullKey = (ratio: RatioId, o: Orientation) => `${groupKey(ratio, o)}-full`;
const freshCrop = (): CropState => ({ crop: { x: 0, y: 0 }, zoom: 1, pixels: null });

/**
 * Debug switches, used by the browser tests:
 *   ?engine=main       render on the page instead of in a worker
 *   ?canvasLimit=N     pretend canvases can't exceed N pixels (iOS Safari: 16777216)
 */
const params = new URLSearchParams(window.location.search);
const PREFERRED_ENGINE = params.get('engine') === 'main' ? 'main' : 'worker';
const EXPORT_OPTIONS: ExportOptions = {
  maxArea: Number(params.get('canvasLimit')) || undefined,
};

function describeProgress(p: ExportProgress): string {
  if (!p.job) return 'Packing ZIP…';
  const prefix = p.total > 1 ? `${p.index + 1} of ${p.total}: ` : '';
  const pct = p.fraction ? ` (${Math.round(p.fraction * 100)}%)` : '';
  return `Rendering ${prefix}${p.job.width.toLocaleString()} × ${p.job.height.toLocaleString()} px${pct}…`;
}

export default function App() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ratioId, setRatioId] = useState<RatioId>(DEFAULT_RATIO);
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [crops, setCrops] = useState<Record<string, CropState>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pendingUpscale, setPendingUpscale] = useState<{ all: QueueItem[]; up: UpscaleItem[] } | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [results, setResults] = useState<Results | null>(null);
  const engineRef = useRef<Promise<Engine> | null>(null);

  function getEngine(): Promise<Engine> {
    engineRef.current ??= createEngine(PREFERRED_ENGINE).then((e) => {
      // Exposed for the browser tests.
      document.documentElement.dataset.engine = e.kind;
      return e;
    });
    return engineRef.current;
  }

  useEffect(() => {
    void getEngine();
  }, []);

  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image.url);
  }, [image]);

  const handleFile = useCallback(async (file: File) => {
    const problem = validateFile(file);
    if (problem) {
      setLoadError(problem);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const engine = await getEngine();
      const img = describeImage(file, await engine.load(file));
      const o = orientationOf(img.width, img.height);
      setImage(img);
      setRatioId(DEFAULT_RATIO);
      setOrientation(o);
      setCrops({});
      setSelected(new Set([fullKey(DEFAULT_RATIO, o)]));
      setStatus({ kind: 'idle' });
      setResults(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Every possible export, with the crop each one would use. */
  const catalog = useMemo(() => {
    const map = new Map<string, QueueItem>();
    if (!image) return map;
    for (const id of RATIO_IDS) {
      for (const o of ORIENTATIONS) {
        const state = crops[groupKey(id, o)];
        const crop = state?.pixels ?? centeredCrop(image, aspectOf(RATIOS[id], o));
        for (const target of targetsFor(RATIOS[id], o, crop)) {
          map.set(target.key, {
            target,
            crop,
            fileName: exportFileName(image.base, target),
            adjusted: !!state?.pixels,
          });
        }
      }
    }
    return map;
  }, [image, crops]);

  if (!image) {
    return (
      <Shell>
        <Uploader onFile={handleFile} busy={loading} error={loadError} />
      </Shell>
    );
  }

  const ratio = RATIOS[ratioId];
  const aspect = aspectOf(ratio, orientation);
  const group = groupKey(ratioId, orientation);
  const cropState = crops[group] ?? freshCrop();
  const cropPx: CropRect = cropState.pixels ?? centeredCrop(image, aspect);
  const targets: ExportTarget[] = targetsFor(ratio, orientation, cropPx);
  const queue = [...catalog.values()].filter((item) => selected.has(item.target.key));
  const maxIn = maxPrintInches(cropPx);
  const cropLabel = `${cropPx.width.toLocaleString()} × ${cropPx.height.toLocaleString()} px`;
  const working = status.kind === 'working';

  const selectionCounts = Object.fromEntries(
    RATIO_IDS.map((id) => [id, queue.filter((q) => q.target.ratio.id === id).length]),
  ) as Record<RatioId, number>;

  function updateCrop(next: Partial<CropState>) {
    setCrops((prev) => ({ ...prev, [group]: { ...(prev[group] ?? freshCrop()), ...next } }));
  }

  function toggle(key: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function selectSharp() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of targets) if (!needsUpscale(cropPx, t)) next.add(t.key);
      return next;
    });
  }

  function clearHere() {
    setSelected((prev) => new Set([...prev].filter((k) => !targets.some((t) => t.key === k))));
  }

  async function runExport(items: QueueItem[]) {
    if (!image || items.length === 0) return;
    setResults(null);
    setStatus({ kind: 'working', message: 'Starting…' });
    try {
      const engine = await getEngine();
      const jobs = items.map(({ fileName, crop, target }) => ({
        fileName,
        crop,
        width: target.widthPx,
        height: target.heightPx,
      }));
      const out = await engine.export(jobs, zipFileName(image.base), EXPORT_OPTIONS, (p) =>
        setStatus({ kind: 'working', message: describeProgress(p) }),
      );
      downloadBlob(out.blob, out.fileName);
      const isZip = out.files.length > 1;
      setStatus({
        kind: 'done',
        message: isZip
          ? `Downloaded ${out.fileName} (${out.files.length} files, ${formatBytes(out.blob.size)})`
          : `Downloaded ${out.fileName} (${formatBytes(out.blob.size)})`,
      });
      setResults({ files: out.files, zip: isZip ? { name: out.fileName, bytes: out.blob.size } : null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message });
    }
  }

  function onDownload() {
    const up = queue
      .filter((q) => needsUpscale(q.crop, q.target))
      .map((q) => ({ target: q.target, factor: scaleFactor(q.crop, q.target), ppi: effectivePpi(q.crop, q.target) }));
    if (up.length > 0) {
      setPendingUpscale({ all: queue, up });
      return;
    }
    void runExport(queue);
  }

  function jumpTo(item: QueueItem) {
    setRatioId(item.target.ratio.id);
    setOrientation(item.target.orientation);
  }

  const upKeys = new Set(pendingUpscale?.up.map((u) => u.target.key));
  const sharpRemainder = pendingUpscale?.all.filter((q) => !upKeys.has(q.target.key)) ?? [];
  const singleCropInDialog =
    pendingUpscale && new Set(pendingUpscale.up.map((u) => `${u.target.ratio.id}-${u.target.orientation}`)).size === 1
      ? (() => {
          const c = pendingUpscale.all.find((q) => q.target.key === pendingUpscale.up[0].target.key)!.crop;
          return `${c.width.toLocaleString()} × ${c.height.toLocaleString()} px`;
        })()
      : '';

  return (
    <Shell
      action={
        <label className="btn btn-ghost">
          Change image
          <input
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            hidden
            data-testid="replace-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
        </label>
      }
    >
      <div className="workspace">
        <section className="stage-col">
          <CropStage url={image.url} aspect={aspect} state={cropState} onChange={updateCrop} key={group} />
          <div className="zoom">
            <label htmlFor="zoom">Zoom</label>
            <input
              id="zoom"
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={cropState.zoom}
              onChange={(e) => updateCrop({ zoom: Number(e.target.value) })}
            />
          </div>
          <p className="file-meta" data-testid="file-meta">
            <span className="file-name">{image.fileName}</span>
            <span>
              {image.width.toLocaleString()} × {image.height.toLocaleString()} px · {formatBytes(image.bytes)}
            </span>
          </p>
          {loadError && (
            <p className="error" role="alert">
              {loadError}
            </p>
          )}
        </section>

        <aside className="panel">
          <RatioPicker
            ratioId={ratioId}
            orientation={orientation}
            counts={selectionCounts}
            onRatio={setRatioId}
            onOrientation={setOrientation}
          />

          <div className="stats" data-testid="stats">
            <div>
              <span className="stat-label">Crop</span>
              <span className="stat-value" data-testid="crop-px">
                {cropLabel}
              </span>
            </div>
            <div>
              <span className="stat-label">Max print at 300 PPI</span>
              <span className="stat-value" data-testid="max-print">
                {formatInches(maxIn.width)} × {formatInches(maxIn.height)} in
              </span>
            </div>
          </div>

          {image.hasTransparency && (
            <p className="note" data-testid="alpha-note">
              This image has transparent areas. JPG can't store transparency, so they'll be filled with
              white.
            </p>
          )}

          <SizeList
            targets={targets}
            crop={cropPx}
            selected={selected}
            onToggle={toggle}
            onSelectSharp={selectSharp}
            onClear={clearHere}
          />

          <ExportQueue
            items={queue}
            currentGroup={group}
            onRemove={(k) => toggle(k, false)}
            onJump={jumpTo}
          />

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={onDownload}
            disabled={working || queue.length === 0}
            data-testid="download"
          >
            {working ? 'Rendering…' : queue.length > 1 ? `Download ZIP (${queue.length} files)` : 'Download JPG'}
          </button>
          {status.kind !== 'idle' && (
            <p className={`status status-${status.kind}`} role="status" data-testid="status">
              {status.message}
            </p>
          )}
          {results && status.kind === 'done' && <ExportResults files={results.files} zip={results.zip} />}
        </aside>
      </div>

      <UpscaleDialog
        items={pendingUpscale?.up ?? null}
        cropLabel={singleCropInDialog}
        onCancel={() => setPendingUpscale(null)}
        onConfirm={() => {
          const all = pendingUpscale?.all ?? [];
          setPendingUpscale(null);
          void runExport(all);
        }}
        onSkip={
          sharpRemainder.length > 0
            ? () => {
                setPendingUpscale(null);
                void runExport(sharpRemainder);
              }
            : undefined
        }
      />
    </Shell>
  );
}

function Shell({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">PrintPack</span>
          <span className="brand-tag">Print-ready crops, made in your browser</span>
        </div>
        {action}
      </header>
      <main>{children}</main>
    </div>
  );
}
