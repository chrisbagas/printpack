import Cropper, { type Area, type Point } from 'react-easy-crop';
import type { CropRect } from '../lib/print';

export interface CropState {
  crop: Point;
  zoom: number;
  pixels: CropRect | null;
}

interface Props {
  url: string;
  aspect: number;
  state: CropState;
  onChange: (next: Partial<CropState>) => void;
}

export const MAX_ZOOM = 8;

export function CropStage({ url, aspect, state, onChange }: Props) {
  return (
    <div className="stage" data-testid="crop-stage">
      <Cropper
        image={url}
        aspect={aspect}
        crop={state.crop}
        zoom={state.zoom}
        maxZoom={MAX_ZOOM}
        objectFit="contain"
        showGrid
        onCropChange={(crop) => onChange({ crop })}
        onZoomChange={(zoom) => onChange({ zoom })}
        onCropComplete={(_: Area, px: Area) => onChange({ pixels: px })}
      />
    </div>
  );
}
