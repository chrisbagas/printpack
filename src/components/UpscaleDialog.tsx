import { useEffect, useRef } from 'react';
import { formatInches, type ExportTarget } from '../lib/print';

export interface UpscaleItem {
  target: ExportTarget;
  factor: number;
  ppi: number;
}

interface Props {
  items: UpscaleItem[] | null;
  cropLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** Offered when other selected sizes don't need upscaling. */
  onSkip?: () => void;
}

export function UpscaleDialog({ items, cropLabel, onCancel, onConfirm, onSkip }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (items && !d.open) d.showModal();
    if (!items && d.open) d.close();
  }, [items]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby="upscale-title"
      data-testid="upscale-dialog"
    >
      {items && (
        <>
          <h2 id="upscale-title">
            {items.length === 1 ? 'This size will be upscaled' : `${items.length} sizes will be upscaled`}
          </h2>
          <p>
            {cropLabel ? `Your crop is ${cropLabel}. ` : ''}To print at 300 PPI, the following{' '}
            {items.length === 1 ? 'size needs' : 'sizes need'} more pixels than the crop has, so the
            image will be enlarged. Prints may look soft.
          </p>
          <ul className="dialog-list">
            {items.map(({ target, factor, ppi }) => (
              <li key={target.key}>
                <strong>
                  {formatInches(target.widthIn)} × {formatInches(target.heightIn)} in
                </strong>{' '}
                ({target.widthPx.toLocaleString()} × {target.heightPx.toLocaleString()} px): enlarged {factor.toFixed(2)}×, about{' '}
                {Math.round(ppi)} PPI of real detail
              </li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onCancel} autoFocus>
              Cancel
            </button>
            {onSkip && (
              <button type="button" className="btn" onClick={onSkip}>
                Skip {items.length === 1 ? 'this size' : 'these sizes'}
              </button>
            )}
            <button type="button" className="btn btn-warn" onClick={onConfirm}>
              Upscale and download
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
