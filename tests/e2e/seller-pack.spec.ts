import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { inspectBuffer, inspectJpeg, pickRatio, saveDownload, upload, type ExportInfo } from './helpers';
import { downloadFile, expectPrintReady, openZip } from './zip';

const hasPdftotext = spawnSync('pdftotext', ['-v']).status === 0;

interface UploadRow {
  name: string;
  bytes: number;
  kind: string;
  entries: { name: string; bytes: number }[];
}

async function sellerMode(page: Page) {
  await page.getByRole('radio', { name: 'Seller Pack' }).click();
  await expect(page.getByTestId('seller-pack')).toBeVisible();
}

async function check(page: Page, name: RegExp, on = true) {
  const box = page.getByRole('checkbox', { name });
  if (on) await box.check();
  else await box.uncheck();
}

async function build(page: Page, { approveUpscale = false } = {}) {
  await page.getByTestId('build-pack').click();
  if (approveUpscale) {
    const dialog = page.getByTestId('upscale-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Upscale and download' }).click();
  }
  await expect(page.getByTestId('pack-uploads')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('pack-status')).toHaveCount(0);
}

async function uploadRows(page: Page): Promise<UploadRow[]> {
  return page.locator('[data-testid=pack-uploads] li.upload').evaluateAll((els) =>
    els.map((el) => ({
      name: el.getAttribute('data-name')!,
      bytes: Number(el.getAttribute('data-bytes')),
      kind: el.getAttribute('data-kind')!,
      entries: [...el.querySelectorAll('[data-entry]')].map((e) => ({
        name: e.getAttribute('data-entry')!,
        bytes: Number(e.getAttribute('data-bytes')),
      })),
    })),
  );
}

/** Download one upload by its row's own Download button. */
async function downloadUpload(page: Page, name: string): Promise<string> {
  const row = page.locator(`[data-testid=pack-uploads] li.upload[data-name="${name}"]`);
  const dl = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download' }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe(name);
  return saveDownload(download);
}

function pdfText(file: string): string {
  return spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).stdout.replace(/\s+/g, ' ');
}

/** Everything the guide says about one file must match the file itself. */
function expectGuideDescribes(text: string, info: ExportInfo, upload: string) {
  const px = `${info.width.toLocaleString('en-US')} × ${info.height.toLocaleString('en-US')} px`;
  expect(text).toContain(info.name);
  const where = upload === info.name ? '' : ` · inside ${upload}`;
  expect(text).toMatch(new RegExp(`${px.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · [\\d.]+ MB${where.replace(/[.]/g, '\\.')}`));
  expect(text).toContain(`${(info.bytes / 1_000_000).toFixed(1)} MB`);
}

test('one file per ratio and orientation, with a guide that matches the files', async ({ page }) => {
  test.skip(!hasPdftotext, 'pdftotext is needed to read the guide');
  await upload(page, 'landscape.jpg');
  await sellerMode(page);

  // 5:4 landscape: 10×8 and 15×12 (full resolution is preselected; drop it).
  await check(page, /^Full resolution/, false);
  await check(page, /^10 × 8 in/);
  await check(page, /^15 × 12 in/);
  // 3:2 landscape, zoomed to 1.5×: 6×4 and 18×12 (18×12 needs upscaling).
  await pickRatio(page, '3:2');
  await page.getByLabel('Zoom').fill('1.5');
  await expect(page.getByTestId('crop-px')).toHaveText('4,001 × 2,667 px');
  await check(page, /^6 × 4 in/);
  await check(page, /^18 × 12 in/);
  // 2:3 portrait: 8×12.
  await page.getByRole('radio', { name: 'Portrait' }).click();
  await pickRatio(page, '2:3');
  await check(page, /^8 × 12 in/);

  await page.getByTestId('artwork-name').fill('Golden Hour');
  const plan = page.getByTestId('pack-plan').locator('li');
  await expect(plan).toHaveCount(3);
  await expect(plan.nth(0)).toContainText('golden-hour_2x3_8x12in_2400x3600px.jpg');
  await expect(plan.nth(1)).toContainText('golden-hour_3x2_18x12in_5400x3600px.jpg');
  await expect(plan.nth(2)).toContainText('golden-hour_5x4_15x12in_4500x3600px.jpg');

  // Cancelling the upscale approval builds nothing.
  await page.getByTestId('build-pack').click();
  await page.getByTestId('upscale-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('pack-uploads')).toHaveCount(0);
  await expect(page.getByTestId('build-pack')).toBeEnabled();

  await build(page, { approveUpscale: true });
  await expect(page.getByTestId('pack-ok')).toContainText("Fits Etsy's limits");
  const rows = await uploadRows(page);
  expect(rows.map((r) => [r.name, r.kind])).toEqual([
    ['golden-hour_2x3_8x12in_2400x3600px.jpg', 'jpg'],
    ['golden-hour_3x2_18x12in_5400x3600px.jpg', 'jpg'],
    ['golden-hour_5x4_15x12in_4500x3600px.jpg', 'jpg'],
    ['golden-hour_printing-guide.pdf', 'pdf'],
  ]);

  const expected: Record<string, [number, number]> = {
    'golden-hour_2x3_8x12in_2400x3600px.jpg': [2400, 3600],
    'golden-hour_3x2_18x12in_5400x3600px.jpg': [5400, 3600],
    'golden-hour_5x4_15x12in_4500x3600px.jpg': [4500, 3600],
  };
  const infos = new Map<string, ExportInfo>();
  const saved = new Map<string, string>();
  for (const row of rows) {
    const file = await downloadUpload(page, row.name);
    saved.set(row.name, file);
    // The size shown in the preview is the size of the file that downloads.
    expect(statSync(file).size).toBe(row.bytes);
    expect(row.bytes).toBeLessThanOrEqual(20_000_000);
    if (row.kind === 'jpg') {
      const info = await inspectJpeg(file);
      expectPrintReady(info, ...expected[row.name]);
      infos.set(row.name, info);
    }
  }

  const guide = pdfText(saved.get('golden-hour_printing-guide.pdf')!);
  expect(guide).toContain('Golden Hour');
  expect(guide).toContain('This download has 3 print-ready JPG files');
  for (const [name, info] of infos) expectGuideDescribes(guide, info, name);
  expect(guide).toContain('2:3 portrait');
  expect(guide).toContain('Prints sharply (300 PPI) at: 4 × 6 in, 8 × 12 in');
  expect(guide).toContain('Prints sharply (300 PPI) at: 5 × 4 in, 10 × 8 in, 15 × 12 in');
  // 3:2 file: upscaled from a 4001 × 2667 crop. Only 6×4 and 12×8 have full detail.
  expect(guide).toContain('Prints sharply (300 PPI) at: 6 × 4 in, 12 × 8 in');
  expect(guide).toContain('15 × 10 in (about 267 PPI), 18 × 12 in (about 222 PPI)');
  expect(guide).toContain('enough detail for 13.3 × 8.9 in at 300 PPI');
  expect(guide).toContain('enlarging does not add detail');
  // Never advertises sizes larger than the files.
  for (const big of ['10 × 15 in', '24 × 16 in', '20 × 16 in', '12 × 18 in']) expect(guide).not.toContain(big);
});

test('more groups than upload slots: images are zipped, the guide stays separate', async ({ page }) => {
  test.skip(!hasPdftotext, 'pdftotext is needed to read the guide');
  await upload(page, 'landscape.jpg');
  await sellerMode(page);
  await check(page, /^Full resolution/, false);
  const picks: [string, 'Portrait' | 'Landscape', RegExp][] = [
    ['2:3', 'Portrait', /^4 × 6 in/],
    ['3:2', 'Landscape', /^6 × 4 in/],
    ['3:4', 'Portrait', /^6 × 8 in/],
    ['4:3', 'Landscape', /^8 × 6 in/],
    ['4:5', 'Portrait', /^4 × 5 in/],
    ['5:4', 'Landscape', /^5 × 4 in/],
  ];
  for (const [ratio, orientation, size] of picks) {
    await page.getByRole('radio', { name: orientation }).click();
    await pickRatio(page, ratio);
    await check(page, size);
  }
  await expect(page.getByTestId('pack-plan').locator('li')).toHaveCount(6);
  await build(page);

  const rows = await uploadRows(page);
  // 6 images + guide = 7 uploads > 5, so the images share one ZIP.
  expect(rows.map((r) => [r.name, r.kind])).toEqual([
    ['landscape_images.zip', 'zip'],
    ['landscape_printing-guide.pdf', 'pdf'],
  ]);
  await expect(page.getByTestId('pack-ok')).toBeVisible();

  const zipFile = await downloadUpload(page, 'landscape_images.zip');
  expect(statSync(zipFile).size).toBe(rows[0].bytes);
  const entries = await openZip(zipFile, 'seller-zip');
  expect([...entries.keys()]).toEqual(rows[0].entries.map((e) => e.name));
  expect([...entries.keys()]).toEqual([
    'landscape_2x3_4x6in_1200x1800px.jpg',
    'landscape_3x2_6x4in_1800x1200px.jpg',
    'landscape_3x4_6x8in_1800x2400px.jpg',
    'landscape_4x3_8x6in_2400x1800px.jpg',
    'landscape_4x5_4x5in_1200x1500px.jpg',
    'landscape_5x4_5x4in_1500x1200px.jpg',
  ]);
  for (const e of rows[0].entries) expect(entries.get(e.name)!.bytes).toBe(e.bytes);

  const guideFile = await downloadUpload(page, 'landscape_printing-guide.pdf');
  const guide = pdfText(guideFile);
  for (const [name, info] of entries) {
    const [w, h] = name.match(/_(\d+)x(\d+)px\.jpg$/)!.slice(1).map(Number);
    expectPrintReady(info, w, h);
    expectGuideDescribes(guide, info, 'landscape_images.zip');
  }
});

test('oversized pack: reported, previewed at lower quality, rebuilt and rechecked', async ({ page }) => {
  // A 3.5 MB per-file limit: the 5000 × 4000 full-resolution file is about 4.2 MB at 92%.
  await upload(page, 'landscape.jpg', '?maxUploadMB=3.5');
  await sellerMode(page);
  await build(page);

  const problems = page.getByTestId('pack-problems');
  await expect(problems).toContainText("This pack doesn't fit Etsy's limits yet.");
  let rows = await uploadRows(page);
  const big = rows.find((r) => r.kind === 'jpg')!;
  expect(big.name).toBe('landscape_5x4_full_16.7x13.3in_5000x4000px.jpg');
  expect(big.bytes).toBeGreaterThan(3_500_000);
  await expect(problems).toContainText(`${big.name} is ${(big.bytes / 1e6).toFixed(2)} MB. Etsy allows up to 3.50 MB per file.`);
  await expect(page.getByTestId('pack-advice')).toContainText('Select a smaller largest size for 5:4 landscape');
  await expect(page.getByTestId('download-all')).toHaveCount(0);
  // The reported size is the real size of the file.
  expect(statSync(await downloadUpload(page, big.name)).size).toBe(big.bytes);

  // Preview 75%: two real 100% crops side by side.
  await page.getByTestId('quality-slider').fill('75');
  await page.getByTestId('preview-quality').click();
  const preview = page.getByTestId('quality-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('img')).toHaveCount(2);
  for (const img of await preview.locator('img').all()) {
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(480);
  }
  await expect(preview).toContainText('smaller');

  // Nothing changes until the seller rebuilds.
  rows = await uploadRows(page);
  expect(rows.find((r) => r.kind === 'jpg')!.bytes).toBe(big.bytes);

  await page.getByTestId('rebuild-pack').click();
  await expect(page.getByTestId('pack-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('pack-ok')).toBeVisible();
  await expect(page.getByTestId('pack-uploads')).toContainText('JPEG quality 75%');
  rows = await uploadRows(page);
  const smaller = rows.find((r) => r.kind === 'jpg')!;
  expect(smaller.bytes).toBeLessThanOrEqual(3_500_000);
  const file = await downloadUpload(page, smaller.name);
  expect(statSync(file).size).toBe(smaller.bytes);
  expectPrintReady(await inspectJpeg(file), 5000, 4000); // same pixels, only quality changed
});

test('a pack that cannot fit explains what to change', async ({ page }) => {
  // One upload allowed: the guide alone fills it.
  await upload(page, 'landscape.jpg', '?maxUploads=1');
  await sellerMode(page);
  await build(page);
  const problems = page.getByTestId('pack-problems');
  await expect(problems).toContainText('The pack needs 2 uploads, but Etsy allows 1 per listing (the printing guide counts as one).');
  await expect(page.getByTestId('quality')).toHaveCount(0); // quality can't fix a file count
  await expect(page.getByTestId('pack-advice')).toContainText('Include fewer ratios or orientations');

  // Images too big on their own and too many uploads at once.
  await page.goto('/?maxUploads=2&maxUploadMB=1');
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/landscape.jpg');
  await sellerMode(page);
  await pickRatio(page, '3:2');
  await check(page, /^Full resolution/);
  await build(page);
  const rows = await uploadRows(page);
  expect(rows.map((r) => r.kind)).toEqual(['zip', 'zip', 'pdf']);
  await expect(page.getByTestId('pack-problems')).toContainText('The pack needs 3 uploads, but Etsy allows 2');
  await expect(page.getByTestId('pack-problems')).toContainText('(inside landscape_images-');
});

test('changing the pack after building marks it out of date', async ({ page }) => {
  await upload(page, 'portrait.png');
  await sellerMode(page);
  await build(page);
  await expect(page.getByTestId('pack-ok')).toBeVisible();
  await page.getByTestId('artwork-name').fill('Something else');
  await expect(page.getByTestId('pack-stale')).toBeVisible();
  await expect(page.getByTestId('pack-uploads')).toHaveCount(0);
  await build(page);
  const rows = await uploadRows(page);
  expect(rows.map((r) => r.name)).toEqual([
    'something-else_4x5_full_10x12.5in_3000x3750px.jpg',
    'something-else_printing-guide.pdf',
  ]);
});

test('individual exports still work after using Seller Pack', async ({ page }) => {
  await upload(page, 'landscape.jpg');
  await sellerMode(page);
  await build(page);
  await page.getByRole('radio', { name: 'Individual files' }).click();
  await check(page, /^10 × 8 in/);
  const zip = await downloadFile(page);
  expect(zip.name).toBe('landscape_printpack.zip');
  const entries = unzipSync(new Uint8Array(readFileSync(zip.file)));
  expect(Object.keys(entries).sort()).toEqual([
    'landscape_5x4_10x8in_3000x2400px.jpg',
    'landscape_5x4_full_16.7x13.3in_5000x4000px.jpg',
  ]);
  for (const [name, data] of Object.entries(entries)) {
    const info = await inspectBuffer(Buffer.from(data), name);
    const [w, h] = name.match(/_(\d+)x(\d+)px\.jpg$/)!.slice(1).map(Number);
    expectPrintReady(info, w, h);
  }
});
