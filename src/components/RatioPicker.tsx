import { RATIO_IDS, RATIOS, ratioLabel, type Orientation, type RatioId } from '../lib/ratios';

interface Props {
  ratioId: RatioId;
  orientation: Orientation;
  onRatio: (id: RatioId) => void;
  onOrientation: (o: Orientation) => void;
}

export function RatioPicker({ ratioId, orientation, onRatio, onOrientation }: Props) {
  return (
    <div className="field">
      <span className="field-label" id="ratio-label">
        Aspect ratio
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby="ratio-label">
        {RATIO_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === ratioId}
            className={id === ratioId ? 'is-on' : ''}
            onClick={() => onRatio(id)}
          >
            {ratioLabel(RATIOS[id], orientation)}
          </button>
        ))}
      </div>
      <div className="segmented segmented-sm" role="radiogroup" aria-label="Orientation">
        {(['portrait', 'landscape'] as const).map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={o === orientation}
            className={o === orientation ? 'is-on' : ''}
            onClick={() => onOrientation(o)}
          >
            <span className={`orient-glyph orient-${o}`} aria-hidden="true" />
            {o === 'portrait' ? 'Portrait' : 'Landscape'}
          </button>
        ))}
      </div>
    </div>
  );
}
