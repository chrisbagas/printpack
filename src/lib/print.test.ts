import { describe, expect, it } from 'vitest';
import {
  centeredCrop,
  effectivePpi,
  formatInches,
  fullResTarget,
  maxPrintInches,
  needsUpscale,
  scaleFactor,
  standardTarget,
  targetsFor,
} from './print';
import { RATIOS, aspectOf } from './ratios';

describe('maxPrintInches', () => {
  it('divides crop pixels by 300', () => {
    expect(maxPrintInches({ width: 4800, height: 6000 })).toEqual({ width: 16, height: 20 });
    const m = maxPrintInches({ width: 4000, height: 5000 });
    expect(formatInches(m.width)).toBe('13.3');
    expect(formatInches(m.height)).toBe('16.7');
  });
});

describe('standardTarget', () => {
  it('builds portrait and landscape pixel sizes at 300 PPI', () => {
    const p = standardTarget(RATIOS['4:5'], { short: 16, long: 20 }, 'portrait');
    expect([p.widthPx, p.heightPx]).toEqual([4800, 6000]);
    const l = standardTarget(RATIOS['4:5'], { short: 16, long: 20 }, 'landscape');
    expect([l.widthPx, l.heightPx]).toEqual([6000, 4800]);
  });

  it('only lists sizes that match each ratio exactly', () => {
    for (const ratio of Object.values(RATIOS)) {
      for (const s of ratio.sizes) {
        expect(s.short / s.long).toBeCloseTo(ratio.short / ratio.long, 10);
      }
    }
  });
});

describe('fullResTarget', () => {
  it('trims to an exact ratio without exceeding the crop', () => {
    const t = fullResTarget(RATIOS['4:5'], 'portrait', { width: 4001, height: 5003 });
    expect([t.widthPx, t.heightPx]).toEqual([4000, 5000]);
    const l = fullResTarget(RATIOS['2:3'], 'landscape', { width: 5999, height: 4000 });
    expect(l.widthPx).toBeLessThanOrEqual(5999);
    expect(l.widthPx / l.heightPx).toBe(1.5);
    expect(needsUpscale({ width: 5999, height: 4000 }, l)).toBe(false);
  });
});

describe('upscaling', () => {
  const crop = { width: 2400, height: 3000 };
  it('8×10 from 2400×3000 is native', () => {
    const t = standardTarget(RATIOS['4:5'], { short: 8, long: 10 }, 'portrait');
    expect(scaleFactor(crop, t)).toBe(1);
    expect(needsUpscale(crop, t)).toBe(false);
    expect(effectivePpi(crop, t)).toBe(300);
  });
  it('16×20 from 2400×3000 is a 2× upscale at 150 PPI', () => {
    const t = standardTarget(RATIOS['4:5'], { short: 16, long: 20 }, 'portrait');
    expect(scaleFactor(crop, t)).toBe(2);
    expect(needsUpscale(crop, t)).toBe(true);
    expect(effectivePpi(crop, t)).toBe(150);
  });
  it('ignores sub-0.1% rounding differences', () => {
    const t = standardTarget(RATIOS['4:5'], { short: 8, long: 10 }, 'portrait');
    expect(needsUpscale({ width: 2399, height: 2999 }, t)).toBe(false);
    expect(needsUpscale({ width: 2390, height: 2990 }, t)).toBe(true);
  });
});

describe('centeredCrop', () => {
  it('fits the largest centred rectangle', () => {
    expect(centeredCrop({ width: 6000, height: 4000 }, aspectOf(RATIOS['4:5'], 'landscape'))).toEqual({
      x: 500,
      y: 0,
      width: 5000,
      height: 4000,
    });
    expect(centeredCrop({ width: 3000, height: 3000 }, aspectOf(RATIOS['2:3'], 'portrait'))).toEqual({
      x: 500,
      y: 0,
      width: 2000,
      height: 3000,
    });
  });
});

describe('targetsFor', () => {
  it('puts full resolution first and gives unique keys across orientations', () => {
    const crop = { width: 3000, height: 4000 };
    const keys = [
      ...targetsFor(RATIOS['3:4'], 'portrait', crop),
      ...targetsFor(RATIOS['3:4'], 'landscape', crop),
    ].map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(targetsFor(RATIOS['3:4'], 'portrait', crop)[0].kind).toBe('full');
  });
});
