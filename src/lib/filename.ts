import { formatInches, type ExportTarget } from './print';
import { ratioLabel } from './ratios';

/** "My Photo (final).PNG" → "my-photo-final". */
export function baseName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const clean = stem
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return clean || 'image';
}

/**
 * sunset_4x5_16x20in_4800x6000px.jpg
 * sunset_5x4_full_16.7x13.3in_5000x4000px.jpg
 */
export function exportFileName(base: string, target: ExportTarget): string {
  const ratio = ratioLabel(target.ratio, target.orientation).replace(':', 'x');
  const inches = `${formatInches(target.widthIn)}x${formatInches(target.heightIn)}in`;
  const size = target.kind === 'full' ? `full_${inches}` : inches;
  return `${base}_${ratio}_${size}_${target.widthPx}x${target.heightPx}px.jpg`;
}

export function zipFileName(base: string): string {
  return `${base}_printpack.zip`;
}
