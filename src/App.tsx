import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CropStage, MAX_ZOOM, type CropState } from './components/CropStage';
import { RatioPicker } from './components/RatioPicker';
import { SizeList } from './components/SizeList';
import { Uploader } from './components/Uploader';
import { UpscaleDialog, type UpscaleItem } from './components/UpscaleDialog';
import { downloadBlob } from './lib/download';
import { exportFileName } from './lib/filename';
import { loadImage, releaseImage, type LoadedImage } from './lib/image';
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
import { aspectOf, orientationOf, RATIOS, type Orientation, type RatioId } from './lib/ratios';
import { renderJpeg } from './lib/render';
import './App.css';

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

const cropKey = (ratio: RatioId, o: Orientation) => `${ratio}-${o}`;

export default function App() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ratioId, setRatioId] = useState<RatioId>('4:5');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [crops, setCrops] = useState<Record<string, CropState>>({});
  const [selected, setSelected] = useState<string>('');
  const [pendingUpscale, setPendingUpscale] = useState<UpscaleItem[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => () => {
    if (image) releaseImage(image);
  }, [image]);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setLoadError(null);
    try {
      const img = await loadImage(file);
      setImage(img);
      setOrientation(orientationOf(img.width, img.height));
      setCrops({});
      setSelected('');
      setStatus({ kind: 'idle' });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const ratio = RATIOS[ratioId];
  const aspect = aspectOf(ratio, orientation);
  const key = cropKey(ratioId, orientation);
  const cropState: CropState = crops[key] ?? { crop: { x: 0, y: 0 }, zoom: 1, pixels: null };

  const cropPx: CropRect | null = useMemo(
    () => (image ? (cropState.pixels ?? centeredCrop(image, aspect)) : null),
    [image, cropState.pixels, aspect],
  );

  const targets = useMemo(
    () => (cropPx ? targetsFor(ratio, orientation, cropPx) : []),
    [cropPx, ratio, orientation],
  );
  const target = targets.find((t) => t.key === selected) ?? targets[0];

  function updateCrop(next: Partial<CropState>) {
    setCrops((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { crop: { x: 0, y: 0 }, zoom: 1, pixels: null }), ...next },
    }));
  }

  async function exportTarget(t: ExportTarget) {
    if (!image || !cropPx) return;
    setStatus({ kind: 'working', message: `Rendering ${t.widthPx} × ${t.heightPx} px…` });
    // Let the status paint before the main thread is busy.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const blob = await renderJpeg(image.bitmap, cropPx, t.widthPx, t.heightPx);
      const name = exportFileName(image.base, t);
      downloadBlob(blob, name);
      setStatus({ kind: 'done', message: `Downloaded ${name} (${formatBytes(blob.size)})` });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  function onDownload() {
    if (!target || !cropPx) return;
    if (needsUpscale(cropPx, target)) {
      setPendingUpscale([
        { target, factor: scaleFactor(cropPx, target), ppi: effectivePpi(cropPx, target) },
      ]);
      return;
    }
    void exportTarget(target);
  }

  if (!image || !cropPx) {
    return (
      <Shell>
        <Uploader onFile={handleFile} busy={loading} error={loadError} />
      </Shell>
    );
  }

  const maxIn = maxPrintInches(cropPx);
  const cropLabel = `${cropPx.width.toLocaleString()} × ${cropPx.height.toLocaleString()} px`;
  const working = status.kind === 'working';

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
          <CropStage url={image.url} aspect={aspect} state={cropState} onChange={updateCrop} key={key} />
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
              {image.width.toLocaleString()} × {image.height.toLocaleString()} px ·{' '}
              {formatBytes(image.bytes)}
            </span>
          </p>
          {loadError && <p className="error" role="alert">{loadError}</p>}
        </section>

        <aside className="panel">
          <RatioPicker
            ratioId={ratioId}
            orientation={orientation}
            onRatio={setRatioId}
            onOrientation={setOrientation}
          />

          <div className="stats" data-testid="stats">
            <div>
              <span className="stat-label">Crop</span>
              <span className="stat-value" data-testid="crop-px">{cropLabel}</span>
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
              This image has transparent areas. JPG can't store transparency, so they'll be filled
              with white.
            </p>
          )}

          <SizeList targets={targets} crop={cropPx} selected={target.key} onSelect={setSelected} />

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={onDownload}
            disabled={working}
          >
            {working ? 'Rendering…' : 'Download JPG'}
          </button>
          {status.kind !== 'idle' && (
            <p className={`status status-${status.kind}`} role="status" data-testid="status">
              {status.message}
            </p>
          )}
        </aside>
      </div>

      <UpscaleDialog
        items={pendingUpscale}
        cropLabel={cropLabel}
        onCancel={() => setPendingUpscale(null)}
        onConfirm={() => {
          const items = pendingUpscale;
          setPendingUpscale(null);
          if (items) void exportTarget(items[0].target);
        }}
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
