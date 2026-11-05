import type { CropRect, ExportTarget } from './print';
import { RATIO_IDS, type Orientation } from './ratios';

/** A selected export (as built by the app's catalogue). */
export interface SelectedItem {
  target: ExportTarget;
  crop: CropRect;
}

/** One file in a Seller Pack: the largest selected size for one ratio and orientation. */
export interface PackFile {
  group: string;
  target: ExportTarget;
  crop: CropRect;
  /** How many sizes were selected in this group (all print from this file). */
  selectedSizes: number;
}

const ORIENTATION_ORDER: Orientation[] = ['portrait', 'landscape'];

/** Group selections by ratio and orientation, keeping the largest target in each. */
export function planPackFiles(selected: SelectedItem[]): PackFile[] {
  const groups = new Map<string, PackFile>();
  for (const item of selected) {
    const group = `${item.target.ratio.id}-${item.target.orientation}`;
    const current = groups.get(group);
    const area = item.target.widthPx * item.target.heightPx;
    if (!current) {
      groups.set(group, { group, target: item.target, crop: item.crop, selectedSizes: 1 });
    } else {
      current.selectedSizes++;
      if (area > current.target.widthPx * current.target.heightPx) {
        current.target = item.target;
        current.crop = item.crop;
      }
    }
  }
  const rank = (f: PackFile) =>
    RATIO_IDS.indexOf(f.target.ratio.id) * 2 + ORIENTATION_ORDER.indexOf(f.target.orientation);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

/** "Golden hour.png" → "Golden hour" (a starting point the seller can edit). */
export function defaultArtworkName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stem) return 'Artwork';
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}
