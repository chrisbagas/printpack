import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import {
  inspectBuffer,
  near,
  OUT_DIR,
  pickRatio,
  record,
  sampleRgb,
  saveDownload,
  selectOnly,
  selectSize,
  type ExportInfo,
} from './helpers';

const WHITE = [255, 255, 255];

/** Click download (accepting or skipping an upscale warning) and return the saved file. */
async function downloadFile(page: Page, upscale: 'none' | 'confirm' | 'skip' = 'none') {
  const dl = page.waitForEvent('download', { timeout: 170_000 });
  const started = Date.now();
  await page.getByTestId('download').click();
  if (upscale !== 'none') {
    const dialog = page.getByTestId('upscale-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: upscale === 'confirm' ? 'Upscale and download' : /^Skip/ }).click();
  }
  const download = await dl;
  const file = await saveDownload(download);
  await expect(page.getByTestId('status')).toContainText('Downloaded');
  return { file, name: download.suggestedFilename(), ms: Date.now() - started };
}

/** Unzip, write each entry next to the ZIP, and inspect it. */
async function openZip(file: string): Promise<Map<string, ExportInfo & { buf: Buffer }>> {
  const entries = unzipSync(new Uint8Array(readFileSync(file)));
  const out = new Map<string, ExportInfo & { buf: Buffer }>();
  mkdirSync(join(OUT_DIR, 'unzipped'), { recursive: true });
  for (const [name, data] of Object.entries(entries)) {
    const buf = Buffer.from(data);
    const path = join(OUT_DIR, 'unzipped', name);
    writeFileSync(path, buf);
    out.set(name, { ...(await inspectBuffer(buf, path)), buf });
  }
  return out;
}

/** Log the ZIP itself in the export report. */
function recordZip(testName: string, source: string, zip: { file: string; name: string; ms: number }, entries: number) {
  const info: ExportInfo = {
    file: zip.file,
    name: zip.name,
    format: 'zip',
    width: 0,
    height: 0,
    bytes: statSync(zip.file).size,
    dpi: null,
    hasAlpha: false,
  };
  record(testName, source, info, { ms: zip.ms, entries });
}

function expectPrintReady(info: ExportInfo, width: number, height: number) {
  expect(info.format).toBe('jpeg');
  expect([info.width, info.height]).toEqual([width, height]);
  expect(info.dpi).toEqual({ units: 1, x: 300, y: 300 });
}

test('ZIP across two ratios, each with its own crop', async ({ page }, ti) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/landscape.jpg');
  await page.getByTestId('crop-px').waitFor();

  // 5:4 (default for this landscape image): full resolution is preselected.
  await selectSize(page, /^10 × 8 in/);
  await selectSize(page, /^15 × 12 in/);

  // 3:2, zoomed in to 1.5×. The cropper rounds to 4001 × 2667; full resolution trims
  // that to an exact 3:2 (3999 × 2666).
  await pickRatio(page, '3:2');
  await page.getByLabel('Zoom').fill('1.5');
  await expect(page.getByTestId('crop-px')).toHaveText('4,001 × 2,667 px');
  await selectSize(page, /^Full resolution/);
  await selectSize(page, /^18 × 12 in/); // needs 5400 × 3600: an upscale

  await expect(page.getByRole('radio', { name: /^5:4/ })).toContainText('3');
  await expect(page.getByRole('radio', { name: /^3:2/ })).toContainText('2');
  await expect(page.getByTestId('queue')).toContainText('5 files to export');
  await expect(page.getByTestId('download')).toHaveText('Download ZIP (5 files)');

  const zip = await downloadFile(page, 'confirm');
  expect(zip.name).toBe('landscape_printpack.zip');
  const files = await openZip(zip.file);
  expect([...files.keys()].sort()).toEqual(
    [
      'landscape_3x2_18x12in_5400x3600px.jpg',
      'landscape_3x2_full_13.3x8.9in_3999x2666px.jpg',
      'landscape_5x4_10x8in_3000x2400px.jpg',
      'landscape_5x4_15x12in_4500x3600px.jpg',
      'landscape_5x4_full_16.7x13.3in_5000x4000px.jpg',
    ].sort(),
  );
  for (const [name, info] of files) {
    const [w, h] = name.match(/_(\d+)x(\d+)px\.jpg$/)!.slice(1).map(Number);
    expectPrintReady(info, w, h);
    record(ti.title, 'landscape.jpg', info, { zip: zip.name });
  }
  await expect(page.getByTestId('results')).toContainText('landscape_printpack.zip');
  await expect(page.getByTestId('results').locator('li')).toHaveCount(5);
  recordZip(ti.title, 'landscape.jpg', zip, files.size);
});

test('portrait and landscape crops of one image in the same ZIP', async ({ page }, ti) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/portrait.png');
  await page.getByTestId('crop-px').waitFor();
  await pickRatio(page, '2:3');
  await selectOnly(page, /^10 × 15 in/);
  await page.getByRole('radio', { name: 'Landscape' }).click();
  await expect(page.getByTestId('crop-px')).toHaveText('3,000 × 2,000 px');
  await selectSize(page, /^Full resolution/);

  const zip = await downloadFile(page);
  const files = await openZip(zip.file);
  expect(files.size).toBe(2);
  expectPrintReady(files.get('portrait_2x3_10x15in_3000x4500px.jpg')!, 3000, 4500);
  expectPrintReady(files.get('portrait_3x2_full_10x6.7in_3000x2000px.jpg')!, 3000, 2000);
  for (const info of files.values()) record(ti.title, 'portrait.png', info, { zip: zip.name });
  recordZip(ti.title, 'portrait.png', zip, files.size);
});

test('skipping upscaled sizes exports only the sharp ones', async ({ page }, ti) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/small.jpg');
  await page.getByTestId('crop-px').waitFor();
  await selectSize(page, /^5 × 4 in/);
  await selectSize(page, /^10 × 8 in/);
  await expect(page.getByTestId('download')).toHaveText('Download ZIP (3 files)');

  await page.getByTestId('download').click();
  const dialog = page.getByTestId('upscale-dialog');
  await expect(dialog).toContainText('2 sizes will be upscaled');
  await expect(dialog).toContainText('enlarged 2.00×');
  await expect(dialog).toContainText('enlarged 4.00×');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // With the upscaled sizes skipped only one file remains, so it's a plain JPG.
  const out = await downloadFile(page, 'skip');
  expect(out.name).toBe('small_5x4_full_2.5x2in_750x600px.jpg');
  const info = await inspectBuffer(readFileSync(out.file), out.file);
  expectPrintReady(info, 750, 600);
  record(ti.title, 'small.jpg', info, { ms: out.ms });
});

test('transparent PNG: every ratio in the ZIP is flattened onto white', async ({ page }, ti) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/transparent.png');
  await page.getByTestId('crop-px').waitFor();
  await pickRatio(page, '2:3');
  await selectSize(page, /^Full resolution/);
  await pickRatio(page, '3:4');
  await selectSize(page, /^Full resolution/);

  const zip = await downloadFile(page);
  const files = await openZip(zip.file);
  expect(new Map([...files].map(([n, i]) => [n, [i.width, i.height]]))).toEqual(
    new Map([
      ['transparent_4x5_full_5.3x6.7in_1600x2000px.jpg', [1600, 2000]],
      ['transparent_2x3_full_4.4x6.7in_1332x1998px.jpg', [1332, 1998]],
      ['transparent_3x4_full_5x6.7in_1500x2000px.jpg', [1500, 2000]],
    ]),
  );
  for (const info of files.values()) {
    expect(info.dpi).toEqual({ units: 1, x: 300, y: 300 });
    expect(near(await sampleRgb(info.buf, 0.03, 0.03), WHITE, 6)).toBe(true);
    expect(near(await sampleRgb(info.buf, 0.5, 0.5), [29, 79, 63], 10)).toBe(true);
    record(ti.title, 'transparent.png', info, { zip: zip.name });
  }
  recordZip(ti.title, 'transparent.png', zip, files.size);
});

test('large 96 MP JPG: every 300 PPI size for 3:2 in one ZIP', async ({ page }, ti) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/large.jpg');
  await page.getByTestId('crop-px').waitFor();
  await pickRatio(page, '3:2');
  const remove = page.getByRole('button', { name: /^Remove / });
  while ((await remove.count()) > 0) await remove.first().click();
  await page.getByRole('button', { name: 'All 300 PPI' }).click();
  await expect(page.getByTestId('download')).toHaveText('Download ZIP (8 files)');

  const zip = await downloadFile(page);
  const files = await openZip(zip.file);
  const expected: Record<string, [number, number]> = {
    'large_3x2_full_40x26.7in_12000x8000px.jpg': [12000, 8000],
    'large_3x2_6x4in_1800x1200px.jpg': [1800, 1200],
    'large_3x2_12x8in_3600x2400px.jpg': [3600, 2400],
    'large_3x2_15x10in_4500x3000px.jpg': [4500, 3000],
    'large_3x2_18x12in_5400x3600px.jpg': [5400, 3600],
    'large_3x2_24x16in_7200x4800px.jpg': [7200, 4800],
    'large_3x2_30x20in_9000x6000px.jpg': [9000, 6000],
    'large_3x2_36x24in_10800x7200px.jpg': [10800, 7200],
  };
  expect([...files.keys()].sort()).toEqual(Object.keys(expected).sort());
  for (const [name, [w, h]] of Object.entries(expected)) {
    expectPrintReady(files.get(name)!, w, h);
    record(ti.title, 'large.jpg', files.get(name)!, { zip: zip.name });
  }
  const zipBytes = statSync(zip.file).size;
  const sum = [...files.values()].reduce((s, f) => s + f.bytes, 0);
  // Stored ZIP: total = entries + small per-file headers.
  expect(zipBytes - sum).toBeLessThan(2000);
  recordZip(ti.title, 'large.jpg', zip, files.size);
});
