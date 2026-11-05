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
  selected: string;
  onSelect: (key: string) => void;
}

export function SizeList({ targets, crop, selected, onSelect }: Props) {
  return (
    <fieldset className="field sizes">
      <legend className="field-label">Print size</legend>
      {targets.map((t) => {
        const up = needsUpscale(crop, t);
        return (
          <label key={t.key} className={`size-row${t.key === selected ? ' is-on' : ''}`}>
            <input
              type="radio"
              name="size"
              value={t.key}
              checked={t.key === selected}
              onChange={() => onSelect(t.key)}
            />
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
