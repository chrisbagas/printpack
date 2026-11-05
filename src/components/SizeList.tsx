import {
  effectivePpi,
  formatInches,
  needsUpscale,
  scaleFactor,
  type ExportTarget,
  type PixelSize,
} from '../lib/print';

interface Props {
  targets: ExportTarget[];
  crop: PixelSize;
  selected: ReadonlySet<string>;
  onToggle: (key: string, on: boolean) => void;
  onSelectSharp: () => void;
  onClear: () => void;
}

export function SizeList({ targets, crop, selected, onToggle, onSelectSharp, onClear }: Props) {
  const anyHere = targets.some((t) => selected.has(t.key));
  return (
    <fieldset className="field sizes" aria-labelledby="sizes-label">
      <div className="sizes-head">
        <span className="field-label" id="sizes-label">
          Print sizes
        </span>
        <div className="sizes-actions">
          <button type="button" className="link" onClick={onSelectSharp}>
            All 300 PPI
          </button>
          {anyHere && (
            <button type="button" className="link" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      </div>
      {targets.map((t) => {
        const up = needsUpscale(crop, t);
        const on = selected.has(t.key);
        return (
          <label key={t.key} className={`size-row${on ? ' is-on' : ''}`}>
            <input type="checkbox" checked={on} onChange={(e) => onToggle(t.key, e.target.checked)} />
            <span className="size-main">
              <span className="size-name">
                {t.kind === 'full' ? 'Full resolution' : `${formatInches(t.widthIn)} × ${formatInches(t.heightIn)} in`}
              </span>
              <span className="size-meta">
                {t.kind === 'full' && `${formatInches(t.widthIn)} × ${formatInches(t.heightIn)} in · `}
                {t.widthPx.toLocaleString()} × {t.heightPx.toLocaleString()} px
              </span>
            </span>
            {up ? (
              <span className="badge badge-warn" title={`${Math.round(effectivePpi(crop, t))} PPI of real detail`}>
                Upscale {scaleFactor(crop, t).toFixed(1)}×
              </span>
            ) : (
              <span className="badge badge-ok">300 PPI</span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
