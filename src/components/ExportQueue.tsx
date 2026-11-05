import type { ExportedFile } from '../lib/exportJobs';
import { formatBytes, needsUpscale, type CropRect, type ExportTarget } from '../lib/print';
import { ratioLabel } from '../lib/ratios';

export interface QueueItem {
  target: ExportTarget;
  crop: CropRect;
  fileName: string;
  /** False when this ratio still uses the automatic centred crop. */
  adjusted: boolean;
}

interface Props {
  items: QueueItem[];
  currentGroup: string;
  onRemove: (key: string) => void;
  onJump: (item: QueueItem) => void;
}

export function ExportQueue({ items, currentGroup, onRemove, onJump }: Props) {
  if (items.length === 0) {
    return <p className="queue-empty">Select at least one print size.</p>;
  }
  return (
    <div className="queue" data-testid="queue">
      <span className="field-label">
        {items.length} {items.length === 1 ? 'file' : 'files'} to export
      </span>
      <ul>
        {items.map((item) => {
          const group = `${item.target.ratio.id}-${item.target.orientation}`;
          return (
            <li key={item.target.key} className="queue-item">
              <button
                type="button"
                className="queue-name"
                onClick={() => onJump(item)}
                title={group === currentGroup ? item.fileName : `Show the ${ratioLabel(item.target.ratio, item.target.orientation)} crop`}
              >
                {item.fileName}
              </button>
              {needsUpscale(item.crop, item.target) && <span className="dot dot-warn" title="Upscaled" />}
              {!item.adjusted && group !== currentGroup && (
                <span className="queue-hint" title="This ratio uses the automatic centred crop">
                  centred
                </span>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${item.fileName}`}
                onClick={() => onRemove(item.target.key)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ExportResults({ files, zip }: { files: ExportedFile[]; zip: { name: string; bytes: number } | null }) {
  return (
    <div className="results" data-testid="results">
      {zip && (
        <p className="results-zip">
          <strong>{zip.name}</strong> · {formatBytes(zip.bytes)}
        </p>
      )}
      <ul>
        {files.map((f) => (
          <li key={f.name} data-method={f.method}>
            <span className="results-name">{f.name}</span>
            <span className="results-meta">
              {f.width.toLocaleString()} × {f.height.toLocaleString()} px · {formatBytes(f.bytes)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
