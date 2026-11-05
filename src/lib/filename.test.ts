import { describe, expect, it } from 'vitest';
import { baseName, exportFileName, zipFileName } from './filename';
import { fullResTarget, standardTarget } from './print';
import { RATIOS } from './ratios';

describe('baseName', () => {
  it('cleans file names', () => {
    expect(baseName('Sunset.JPG')).toBe('sunset');
    expect(baseName('My Photo (final) v2.png')).toBe('my-photo-final-v2');
    expect(baseName('Café über.jpeg')).toBe('cafe-uber');
    expect(baseName('???.png')).toBe('image');
    expect(baseName('archive.tar.png')).toBe('archive-tar');
    expect(baseName(`${'a'.repeat(80)}.jpg`)).toHaveLength(60);
  });
});

describe('exportFileName', () => {
  it('names standard sizes', () => {
    const t = standardTarget(RATIOS['4:5'], { short: 16, long: 20 }, 'portrait');
    expect(exportFileName('sunset', t)).toBe('sunset_4x5_16x20in_4800x6000px.jpg');
    const l = standardTarget(RATIOS['2:3'], { short: 12, long: 18 }, 'landscape');
    expect(exportFileName('sunset', l)).toBe('sunset_3x2_18x12in_5400x3600px.jpg');
  });
  it('names full-resolution exports', () => {
    const t = fullResTarget(RATIOS['4:5'], 'landscape', { width: 5000, height: 4000 });
    expect(exportFileName('sunset', t)).toBe('sunset_5x4_full_16.7x13.3in_5000x4000px.jpg');
  });
  it('names the zip', () => {
    expect(zipFileName('sunset')).toBe('sunset_printpack.zip');
  });
});
