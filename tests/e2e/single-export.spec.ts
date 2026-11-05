import { expect, test, type Page } from '@playwright/test';
import {
  cropPx,
  inspectJpeg,
  near,
  pickRatio,
  record,
  sampleRgb,
  saveDownload,
  selectOnly,
  sizeRow,
  upload,
} from './helpers';

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const YELLOW = [255, 255, 0];
const WHITE = [255, 255, 255];


/** Click download and, if `confirmUpscale`, accept the warning first. */
async function download(page: Page, { confirmUpscale = false } = {}) {
  const dl = page.waitForEvent('download', { timeout: 150_000 });
  const started = Date.now();
  await page.getByRole('button', { name: 'Download JPG' }).click();
  if (confirmUpscale) {
    await expect(page.getByTestId('upscale-dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Upscale and download' }).click();
  }
  const file = await saveDownload(await dl);
  const ms = Date.now() - started;
  await expect(page.getByTestId('status')).toContainText('Downloaded');
  return { info: await inspectJpeg(file), file, ms };
}

async function corners(file: string) {
  return {
    tl: await sampleRgb(file, 0.02, 0.02),
    tr: await sampleRgb(file, 0.98, 0.02),
    bl: await sampleRgb(file, 0.02, 0.98),
    br: await sampleRgb(file, 0.98, 0.98),
  };
}

function expectPrintReady(info: { format: string; dpi: unknown; hasAlpha: boolean }) {
  expect(info.format).toBe('jpeg');
  expect(info.dpi).toEqual({ units: 1, x: 300, y: 300 });
  expect(info.hasAlpha).toBe(false);
}

test('landscape JPG: defaults to landscape, exports exact 300 PPI sizes', async ({ page }, ti) => {
  await upload(page, 'landscape.jpg');
  await expect(page.getByRole('radio', { name: 'Landscape' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /^5:4/ })).toHaveAttribute('aria-checked', 'true');
  expect(await cropPx(page)).toEqual([5000, 4000]);
  await expect(page.getByTestId('max-print')).toHaveText('16.7 × 13.3 in');

  await selectOnly(page, /^10 × 8 in/);
  const a = await download(page);
  expect(a.info.name).toBe('landscape_5x4_10x8in_3000x2400px.jpg');
  expect([a.info.width, a.info.height]).toEqual([3000, 2400]);
  expectPrintReady(a.info);
  record(ti.title, 'landscape.jpg', a.info, { ms: a.ms });

  // 3:2 uses the whole frame, so the corner markers must land in the corners.
  await pickRatio(page, '3:2');
  expect(await cropPx(page)).toEqual([6000, 4000]);
  await expect(page.getByTestId('max-print')).toHaveText('20 × 13.3 in');
  await selectOnly(page, /Full resolution/);
  const b = await download(page);
  expect(b.info.name).toBe('landscape_3x2_full_20x13.3in_6000x4000px.jpg');
  expect([b.info.width, b.info.height]).toEqual([6000, 4000]);
  expectPrintReady(b.info);
  const c = await corners(b.file);
  expect(near(c.tl, RED, 70), `top-left ${c.tl}`).toBe(true);
  expect(near(c.tr, GREEN, 70), `top-right ${c.tr}`).toBe(true);
  expect(near(c.bl, BLUE, 70), `bottom-left ${c.bl}`).toBe(true);
  expect(near(c.br, YELLOW, 70), `bottom-right ${c.br}`).toBe(true);
  record(ti.title, 'landscape.jpg', b.info, { ms: b.ms });
});

test('zoom shrinks the crop and the max print size', async ({ page }) => {
  await upload(page, 'landscape.jpg');
  await page.getByLabel('Zoom').fill('2');
  await expect.poll(() => cropPx(page)).toEqual([2500, 2000]);
  await expect(page.getByTestId('max-print')).toHaveText('8.3 × 6.7 in');
  await expect(sizeRow(page, /^10 × 8 in/)).toContainText('Upscale 1.2×');
});

test('portrait PNG: native size downloads directly, larger size warns first', async ({ page }, ti) => {
  await upload(page, 'portrait.png');
  await expect(page.getByRole('radio', { name: 'Portrait' })).toHaveAttribute('aria-checked', 'true');
  // The PNG has an alpha channel, but every pixel is opaque: no white-fill note.
  await expect(page.getByTestId('alpha-note')).toHaveCount(0);
  await pickRatio(page, '2:3');
  expect(await cropPx(page)).toEqual([3000, 4500]);
  await expect(page.getByTestId('max-print')).toHaveText('10 × 15 in');

  await selectOnly(page, /^10 × 15 in/);
  await expect(sizeRow(page, /^10 × 15 in/)).toContainText('300 PPI');
  const a = await download(page);
  expect(a.info.name).toBe('portrait_2x3_10x15in_3000x4500px.jpg');
  expect([a.info.width, a.info.height]).toEqual([3000, 4500]);
  expectPrintReady(a.info);
  record(ti.title, 'portrait.png', a.info, { ms: a.ms });

  // 12×18 needs 3600×5400: cancelling the warning must not download anything.
  await selectOnly(page, /^12 × 18 in/);
  let downloaded = false;
  page.once('download', () => (downloaded = true));
  await page.getByRole('button', { name: 'Download JPG' }).click();
  const dialog = page.getByTestId('upscale-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('enlarged 1.20×');
  await expect(dialog).toContainText('about 250 PPI');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(1500);
  expect(downloaded).toBe(false);

  const b = await download(page, { confirmUpscale: true });
  expect(b.info.name).toBe('portrait_2x3_12x18in_3600x5400px.jpg');
  expect([b.info.width, b.info.height]).toEqual([3600, 5400]);
  expectPrintReady(b.info);
  record(ti.title, 'portrait.png', b.info, { ms: b.ms, upscaled: 1.2 });
});

test('transparent PNG: transparency is flattened onto white', async ({ page }, ti) => {
  await upload(page, 'transparent.png');
  await expect(page.getByTestId('alpha-note')).toBeVisible();
  expect(await cropPx(page)).toEqual([1600, 2000]);
  await selectOnly(page, /Full resolution/);
  const a = await download(page);
  expect([a.info.width, a.info.height]).toEqual([1600, 2000]);
  expectPrintReady(a.info);
  // Fully transparent corner → white, not black.
  expect(near(await sampleRgb(a.file, 0.03, 0.03), WHITE, 6)).toBe(true);
  // Opaque centre keeps its colour.
  expect(near(await sampleRgb(a.file, 0.5, 0.5), [29, 79, 63], 10)).toBe(true);
  // 50% transparent band blends with white.
  expect(near(await sampleRgb(a.file, 0.5, 0.82), [142, 167, 159], 12)).toBe(true);
  record(ti.title, 'transparent.png', a.info, { ms: a.ms });
});

test('large 96 MP JPG: exports 36×24 in and full resolution', async ({ page }, ti) => {
  await upload(page, 'large.jpg');
  await pickRatio(page, '3:2');
  expect(await cropPx(page)).toEqual([12000, 8000]);
  await expect(page.getByTestId('max-print')).toHaveText('40 × 26.7 in');

  await selectOnly(page, /^36 × 24 in/);
  const a = await download(page);
  expect(a.info.name).toBe('large_3x2_36x24in_10800x7200px.jpg');
  expect([a.info.width, a.info.height]).toEqual([10800, 7200]);
  expectPrintReady(a.info);
  record(ti.title, 'large.jpg', a.info, { ms: a.ms });

  await selectOnly(page, /Full resolution/);
  const b = await download(page);
  expect([b.info.width, b.info.height]).toEqual([12000, 8000]);
  expectPrintReady(b.info);
  const c = await corners(b.file);
  expect(near(c.tl, RED, 70) && near(c.br, YELLOW, 70)).toBe(true);
  record(ti.title, 'large.jpg', b.info, { ms: b.ms });
});

test('small JPG: every standard size is flagged as an upscale', async ({ page }, ti) => {
  await upload(page, 'small.jpg');
  expect(await cropPx(page)).toEqual([750, 600]);
  await expect(page.getByTestId('max-print')).toHaveText('2.5 × 2 in');
  for (const name of [/^5 × 4 in/, /^10 × 8 in/, /^15 × 12 in/, /^20 × 16 in/, /^30 × 24 in/]) {
    await expect(sizeRow(page, name)).toContainText('Upscale');
  }
  await expect(sizeRow(page, /Full resolution/)).toContainText('300 PPI');

  await selectOnly(page, /^5 × 4 in/);
  const a = await download(page, { confirmUpscale: true });
  expect([a.info.width, a.info.height]).toEqual([1500, 1200]);
  expectPrintReady(a.info);
  record(ti.title, 'small.jpg', a.info, { ms: a.ms, upscaled: 2 });
});

test('EXIF-rotated JPG: exported upright', async ({ page }, ti) => {
  await upload(page, 'exif-rotated.jpg');
  await expect(page.getByTestId('file-meta')).toContainText('3,000 × 4,000 px');
  await expect(page.getByRole('radio', { name: 'Portrait' })).toHaveAttribute('aria-checked', 'true');
  await pickRatio(page, '3:4');
  expect(await cropPx(page)).toEqual([3000, 4000]);
  await selectOnly(page, /Full resolution/);
  const a = await download(page);
  expect([a.info.width, a.info.height]).toEqual([3000, 4000]);
  // Stored top-left (red) rotates 90° clockwise to the top-right.
  const c = await corners(a.file);
  expect(near(c.tl, BLUE, 70), `top-left ${c.tl}`).toBe(true);
  expect(near(c.tr, RED, 70), `top-right ${c.tr}`).toBe(true);
  expect(near(c.br, GREEN, 70), `bottom-right ${c.br}`).toBe(true);
  expect(near(c.bl, YELLOW, 70), `bottom-left ${c.bl}`).toBe(true);
  record(ti.title, 'exif-rotated.jpg', a.info, { ms: a.ms });
});

test('rejects files that are not JPG or PNG', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(page.getByRole('alert')).toContainText("isn't a JPG or PNG");
});
