import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderGuidePdf } from './guidePdf';
import { ETSY_LIMITS, formatMB, limitsFromSearch } from './marketplace';
import { checkUploads, planUploads, storedZipSize } from './packaging';
import { fullResTarget, standardTarget, type CropRect } from './print';
import { buildGuide, type RenderedPackFile } from './printGuide';
import { RATIOS } from './ratios';
import { defaultArtworkName, planPackFiles } from './sellerPack';
import { buildZip } from './zip';

const crop = (w: number, h: number): CropRect => ({ x: 0, y: 0, width: w, height: h });
const MB = 1_000_000;

describe('planPackFiles', () => {
  it('keeps the largest selected size per ratio and orientation, with its own crop', () => {
    const c45 = crop(5000, 4000);
    const c23 = crop(4000, 6000);
    const files = planPackFiles([
      { target: standardTarget(RATIOS['4:5'], { short: 8, long: 10 }, 'landscape'), crop: c45 },
      { target: standardTarget(RATIOS['4:5'], { short: 12, long: 15 }, 'landscape'), crop: c45 },
      { target: fullResTarget(RATIOS['4:5'], 'landscape', c45), crop: c45 },
      { target: standardTarget(RATIOS['2:3'], { short: 8, long: 12 }, 'portrait'), crop: c23 },
      { target: standardTarget(RATIOS['2:3'], { short: 4, long: 6 }, 'landscape'), crop: crop(3000, 2000) },
    ]);
    expect(files.map((f) => [f.group, f.target.widthPx, f.target.heightPx, f.selectedSizes])).toEqual([
      ['2:3-portrait', 2400, 3600, 1],
      ['2:3-landscape', 1800, 1200, 1],
      ['4:5-landscape', 5000, 4000, 3], // full resolution beats 15×12 (4500×3600)
    ]);
    expect(files[0].crop).toBe(c23);
  });

  it('suggests an artwork name from the file name', () => {
    expect(defaultArtworkName('golden_hour-final.PNG')).toBe('Golden hour final');
    expect(defaultArtworkName('.png')).toBe('Artwork');
  });
});

function packFile(over: Partial<RenderedPackFile> & Pick<RenderedPackFile, 'widthPx' | 'heightPx' | 'crop'>): RenderedPackFile {
  return {
    fileName: 'art_2x3_12x18in_3600x5400px.jpg',
    ratio: RATIOS['2:3'],
    orientation: 'portrait',
    bytes: 4 * MB,
    upload: 'art_2x3_12x18in_3600x5400px.jpg',
    ...over,
  };
}

describe('buildGuide', () => {
  it('lists only sizes the file covers, split by real detail', () => {
    // 12×18 file from a crop that only has detail for 10×15.
    const guide = buildGuide('Art', [packFile({ widthPx: 3600, heightPx: 5400, crop: crop(3000, 4500) })]);
    const f = guide.files[0];
    expect(f.sharp.map((s) => s.label)).toEqual(['4 × 6 in', '8 × 12 in', '10 × 15 in']);
    expect(f.enlarged.map((s) => [s.label, Math.round(s.detailPpi)])).toEqual([['12 × 18 in', 250]]);
    expect(f.upscaled).toBe(true);
    // Never lists a size larger than the file.
    expect([...f.sharp, ...f.enlarged].some((s) => s.widthIn * 300 > 3600)).toBe(false);
    expect(guide.lookup.map((l) => l.label)).toEqual(['4 × 6 in', '8 × 12 in', '10 × 15 in', '12 × 18 in']);
  });

  it('treats a native file as sharp at every listed size', () => {
    const guide = buildGuide('Art', [
      packFile({ orientation: 'landscape', fileName: 'a.jpg', widthPx: 7200, heightPx: 4800, crop: crop(7200, 4800) }),
    ]);
    expect(guide.files[0].upscaled).toBe(false);
    expect(guide.files[0].enlarged).toEqual([]);
    expect(guide.files[0].sharp.map((s) => s.label)).toEqual(['6 × 4 in', '12 × 8 in', '15 × 10 in', '18 × 12 in', '24 × 16 in']);
    expect(guide.files[0].shape).toBe('3:2 landscape');
  });
});

describe('planUploads / checkUploads', () => {
  const guide = { name: 'art_printing-guide.pdf', bytes: 5_000 };
  const zipName = (i: number, n: number) => (n === 1 ? 'art_images.zip' : `art_images-${i + 1}.zip`);
  const built = (plans: ReturnType<typeof planUploads>) =>
    plans.map((p) => ({ ...p, bytes: p.kind === 'zip' ? storedZipSize(p.contents) : p.contents[0].bytes }));

  it('uploads images separately when they fit, counting the guide', () => {
    const images = [1, 2, 3, 4].map((n) => ({ name: `img${n}.jpg`, bytes: 10 * MB }));
    const plan = planUploads(images, guide, ETSY_LIMITS, zipName);
    expect(plan.map((p) => p.name)).toEqual(['img1.jpg', 'img2.jpg', 'img3.jpg', 'img4.jpg', 'art_printing-guide.pdf']);
    expect(checkUploads(built(plan), ETSY_LIMITS)).toEqual([]);
  });

  it('zips images when there are too many files, keeping the guide separate', () => {
    const images = [1, 2, 3, 4, 5, 6].map((n) => ({ name: `img${n}.jpg`, bytes: 6 * MB }));
    const plan = planUploads(images, guide, ETSY_LIMITS, zipName);
    expect(plan.map((p) => [p.name, p.contents.map((c) => c.name)])).toEqual([
      ['art_images-1.zip', ['img1.jpg', 'img2.jpg', 'img3.jpg']],
      ['art_images-2.zip', ['img4.jpg', 'img5.jpg', 'img6.jpg']],
      ['art_printing-guide.pdf', ['art_printing-guide.pdf']],
    ]);
    const uploads = built(plan);
    expect(Math.max(...uploads.map((u) => u.bytes))).toBeLessThanOrEqual(ETSY_LIMITS.maxBytesPerFile);
    expect(checkUploads(uploads, ETSY_LIMITS)).toEqual([]);
  });

  it('reports a single image over the limit, whether separate or zipped', () => {
    const images = [{ name: 'big.jpg', bytes: 23 * MB }, { name: 'ok.jpg', bytes: 3 * MB }];
    expect(checkUploads(built(planUploads(images, guide, ETSY_LIMITS, zipName)), ETSY_LIMITS)).toEqual([
      { kind: 'file-too-large', name: 'big.jpg', bytes: 23 * MB, limit: 20 * MB },
    ]);
    const many = [...images, ...[1, 2, 3, 4].map((n) => ({ name: `s${n}.jpg`, bytes: MB }))];
    const problems = checkUploads(built(planUploads(many, guide, ETSY_LIMITS, zipName)), ETSY_LIMITS);
    expect(problems).toEqual([
      { kind: 'file-too-large', name: 'big.jpg', bytes: 23 * MB, limit: 20 * MB, inside: 'art_images-1.zip' },
    ]);
  });

  it('reports too many uploads when even ZIPs cannot fit', () => {
    const images = [1, 2, 3, 4, 5, 6].map((n) => ({ name: `img${n}.jpg`, bytes: 15 * MB }));
    const uploads = built(planUploads(images, guide, ETSY_LIMITS, zipName));
    expect(uploads).toHaveLength(7);
    expect(checkUploads(uploads, ETSY_LIMITS)).toEqual([{ kind: 'too-many-files', count: 7, limit: 5 }]);
  });

  it('includes the guide when checking, and respects overrides', () => {
    const limits = limitsFromSearch('?maxUploads=2&maxUploadMB=0.004');
    expect([limits.maxFiles, limits.maxBytesPerFile]).toEqual([2, 4_000]);
    const uploads = built(planUploads([{ name: 'a.jpg', bytes: 1_000 }], guide, limits, zipName));
    expect(checkUploads(uploads, limits)).toEqual([
      { kind: 'file-too-large', name: 'art_printing-guide.pdf', bytes: 5_000, limit: 4_000 },
    ]);
  });

  it('formats sizes so near-limit files are distinguishable', () => {
    expect([formatMB(20_000_000), formatMB(20_040_000), formatMB(3_083_657), formatMB(2_481), formatMB(10)]).toEqual([
      '20 MB',
      '20.04 MB',
      '3.08 MB',
      '2 KB',
      '1 KB',
    ]);
  });

  it('predicts the exact size of the ZIPs it builds', () => {
    const entries = [
      { name: 'one.jpg', data: new Uint8Array(1234) },
      { name: 'twó.jpg', data: new Uint8Array(99) },
    ];
    const zip = buildZip(entries);
    expect(storedZipSize(entries.map((e) => ({ name: e.name, bytes: e.data.length })))).toBe(zip.length);
  });
});

const hasPdftotext = spawnSync('pdftotext', ['-v']).status === 0;

describe.skipIf(!hasPdftotext)('renderGuidePdf', () => {
  it('writes every file name, size and limitation into the PDF', async () => {
    const guide = buildGuide('Café “Golden Hour” 🌅 黄昏', [
      packFile({
        fileName: 'golden-hour_2x3_12x18in_3600x5400px.jpg',
        upload: 'golden-hour_images.zip',
        widthPx: 3600,
        heightPx: 5400,
        bytes: 3_456_789,
        crop: crop(3000, 4500),
      }),
      packFile({
        fileName: 'golden-hour_5x4_full_16.7x13.3in_5000x4000px.jpg',
        upload: 'golden-hour_5x4_full_16.7x13.3in_5000x4000px.jpg',
        ratio: RATIOS['4:5'],
        orientation: 'landscape',
        widthPx: 5000,
        heightPx: 4000,
        crop: crop(5000, 4000),
      }),
    ]);
    const pdf = await renderGuidePdf(guide);
    const dir = mkdtempSync(join(tmpdir(), 'guide-'));
    writeFileSync(join(dir, 'g.pdf'), pdf);
    const text = spawnSync('pdftotext', ['-layout', join(dir, 'g.pdf'), '-'], { encoding: 'utf8' }).stdout;
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toContain('Café “Golden Hour” ? ??'); // unsupported characters replaced, not crashing
    expect(flat).toContain('golden-hour_2x3_12x18in_3600x5400px.jpg');
    expect(flat).toContain('golden-hour_5x4_full_16.7x13.3in_5000x4000px.jpg');
    expect(flat).toContain('2:3 portrait · 3,600 × 5,400 px · 3.5 MB · inside golden-hour_images.zip');
    expect(flat).toContain('Prints sharply (300 PPI) at: 4 × 6 in, 8 × 12 in, 10 × 15 in');
    expect(flat).toContain('12 × 18 in (about 250 PPI)');
    expect(flat).toContain('enlarging does not add detail');
    expect(flat).toContain('Prints sharply (300 PPI) at: 5 × 4 in, 10 × 8 in, 15 × 12 in');
    expect(flat).not.toContain('20 × 16 in'); // larger than the 5000 × 4000 file
  });
});
