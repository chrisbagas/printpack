import { expect, test, type Page } from '@playwright/test';
import { near, pickRatio, record, sampleRgb, selectSize, upload } from './helpers';
import { downloadFile, expectPrintReady, openZip } from './zip';

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const YELLOW = [255, 255, 0];
const WHITE = [255, 255, 255];

/** Remove everything from the export queue. */
async function clearQueue(page: Page) {
  const remove = page.getByRole('button', { name: /^Remove / });
  while ((await remove.count()) > 0) await remove.first().click();
}

async function expectEngine(page: Page, kind: 'worker' | 'main') {
  await expect(page.locator('html')).toHaveAttribute('data-engine', kind);
}

/** After a finished or failed export: nothing stuck in a working state. */
async function expectIdleControls(page: Page) {
  await expect(page.getByTestId('download')).toBeEnabled();
  await expect(page.getByTestId('download')).not.toHaveText(/Rendering/);
  await expect(page.getByTestId('status')).not.toContainText('Rendering');
  await expect(page.getByTestId('replace-input')).toBeEnabled();
}

interface Case {
  fixture: string;
  ratio: string;
  size: RegExp;
  expected: Record<string, [number, number]>;
  check?: (file: Buffer) => Promise<void>;
}

/** Each input in a ratio that uses the whole frame, so corner markers are visible. */
const CASES: Case[] = [
  {
    fixture: 'portrait.png',
    ratio: '2:3',
    size: /^8 × 12 in/,
    expected: {
      'portrait_2x3_full_10x15in_3000x4500px.jpg': [3000, 4500],
      'portrait_2x3_8x12in_2400x3600px.jpg': [2400, 3600],
    },
    check: async (buf) => {
      expect(near(await sampleRgb(buf, 0.02, 0.02), RED, 70)).toBe(true);
      expect(near(await sampleRgb(buf, 0.98, 0.98), YELLOW, 70)).toBe(true);
    },
  },
  {
    fixture: 'landscape.jpg',
    ratio: '3:2',
    size: /^12 × 8 in/,
    expected: {
      'landscape_3x2_full_20x13.3in_6000x4000px.jpg': [6000, 4000],
      'landscape_3x2_12x8in_3600x2400px.jpg': [3600, 2400],
    },
    check: async (buf) => {
      expect(near(await sampleRgb(buf, 0.98, 0.02), GREEN, 70)).toBe(true);
      expect(near(await sampleRgb(buf, 0.02, 0.98), BLUE, 70)).toBe(true);
    },
  },
  {
    fixture: 'transparent.png',
    ratio: '4:5',
    size: /^4 × 5 in/,
    expected: {
      'transparent_4x5_full_5.3x6.7in_1600x2000px.jpg': [1600, 2000],
      'transparent_4x5_4x5in_1200x1500px.jpg': [1200, 1500],
    },
    check: async (buf) => {
      expect(near(await sampleRgb(buf, 0.03, 0.03), WHITE, 6)).toBe(true);
      expect(near(await sampleRgb(buf, 0.5, 0.82), [142, 167, 159], 14)).toBe(true);
    },
  },
  {
    fixture: 'exif-rotated.jpg',
    ratio: '3:4',
    size: /^9 × 12 in/,
    expected: {
      'exif-rotated_3x4_full_10x13.3in_3000x4000px.jpg': [3000, 4000],
      'exif-rotated_3x4_9x12in_2700x3600px.jpg': [2700, 3600],
    },
    // Stored top-left (red) rotates to the top-right.
    check: async (buf) => {
      expect(near(await sampleRgb(buf, 0.02, 0.02), BLUE, 70)).toBe(true);
      expect(near(await sampleRgb(buf, 0.98, 0.02), RED, 70)).toBe(true);
    },
  },
];

const MODES = [
  { name: 'worker, one canvas', query: '', engine: 'worker', method: 'canvas' },
  { name: 'worker, strips', query: '?canvasLimit=1000000', engine: 'worker', method: 'strips' },
  { name: 'main thread, one canvas', query: '?engine=main', engine: 'main', method: 'canvas' },
  { name: 'main thread, strips', query: '?engine=main&canvasLimit=1000000', engine: 'main', method: 'strips' },
] as const;

for (const mode of MODES) {
  test.describe(`rendering: ${mode.name}`, () => {
    for (const c of CASES) {
      test(c.fixture, async ({ page }, ti) => {
        await upload(page, c.fixture, mode.query);
        await expectEngine(page, mode.engine);
        await pickRatio(page, c.ratio);
        await clearQueue(page);
        await selectSize(page, /^Full resolution/);
        await selectSize(page, c.size);

        const zip = await downloadFile(page);
        const files = await openZip(zip.file, `${mode.engine}-${mode.method}`);
        expect([...files.keys()].sort()).toEqual(Object.keys(c.expected).sort());
        for (const [name, [w, h]] of Object.entries(c.expected)) {
          const info = files.get(name)!;
          expectPrintReady(info, w, h);
          await c.check?.(info.buf);
          record(ti.title, c.fixture, info, { mode: mode.name });
        }
        // The page reports how each file was rendered.
        const methods = await page.getByTestId('results').locator('li').evaluateAll((els) =>
          els.map((el) => el.getAttribute('data-method')),
        );
        expect(methods).toEqual([mode.method, mode.method]);
        await expectIdleControls(page);
      });
    }
  });
}

test('repeated exports, then another image', async ({ page }) => {
  await upload(page, 'landscape.jpg');
  await selectSize(page, /^10 × 8 in/);
  const first = await openZip((await downloadFile(page)).file, 'repeat-1');
  const second = await openZip((await downloadFile(page)).file, 'repeat-2');
  expect([...second.keys()]).toEqual([...first.keys()]);
  for (const [name, info] of first) {
    expect([second.get(name)!.width, second.get(name)!.height]).toEqual([info.width, info.height]);
    // Same input and settings: same encoder output.
    expect(second.get(name)!.bytes).toBe(info.bytes);
  }

  // Load a different image without reloading the page.
  await page.getByTestId('replace-input').setInputFiles('tests/fixtures/portrait.png');
  await expect(page.getByTestId('file-meta')).toContainText('portrait.png');
  await expect(page.getByTestId('crop-px')).toHaveText('3,000 × 3,750 px');
  await expect(page.getByTestId('status')).toHaveCount(0); // old status cleared
  await expect(page.getByTestId('results')).toHaveCount(0);
  await expect(page.getByTestId('queue')).toContainText('1 file to export');

  const single = await downloadFile(page);
  expect(single.name).toBe('portrait_4x5_full_10x12.5in_3000x3750px.jpg');
  await expectIdleControls(page);
});

for (const simulate of ['worker-load-fail', 'worker-no-canvas'] as const) {
  test(`worker start-up failure (${simulate}) falls back to the main thread`, async ({ page }) => {
    await upload(page, 'portrait.png', `?simulate=${simulate}`);
    await expectEngine(page, 'main');
    await selectSize(page, /^8 × 10 in/);
    const files = await openZip((await downloadFile(page)).file, simulate);
    expectPrintReady(files.get('portrait_4x5_8x10in_2400x3000px.jpg')!, 2400, 3000);
    expectPrintReady(files.get('portrait_4x5_full_10x12.5in_3000x3750px.jpg')!, 3000, 3750);
  });
}

for (const { simulate, engine, message } of [
  { simulate: 'export-error', engine: 'worker', message: 'Simulated export failure.' },
  { simulate: 'export-error', engine: 'main', message: 'Simulated export failure.' },
  { simulate: 'worker-crash', engine: 'worker', message: 'stopped unexpectedly' },
] as const) {
  test(`recovers after ${simulate} (${engine})`, async ({ page }) => {
    const query = `?simulate=${simulate}${engine === 'main' ? '&engine=main' : ''}`;
    await upload(page, 'landscape.jpg', query);
    await expectEngine(page, engine);
    await selectSize(page, /^10 × 8 in/);

    let downloads = 0;
    page.on('download', () => downloads++);
    await page.getByTestId('download').click();
    const status = page.getByTestId('status');
    await expect(status).toHaveClass(/status-error/);
    await expect(status).toContainText(message);
    await expectIdleControls(page);
    await expect(page.getByTestId('results')).toHaveCount(0);
    expect(downloads).toBe(0);

    // Retry: succeeds, with a fresh worker after a crash.
    const zip = await downloadFile(page);
    await expect(status).toHaveClass(/status-done/);
    const files = await openZip(zip.file, `${simulate}-${engine}`);
    expectPrintReady(files.get('landscape_5x4_10x8in_3000x2400px.jpg')!, 3000, 2400);
    expectPrintReady(files.get('landscape_5x4_full_16.7x13.3in_5000x4000px.jpg')!, 5000, 4000);
    await expectEngine(page, engine);
    await expectIdleControls(page);
  });
}

test('explains images too large to open, then accepts a normal one', async ({ page }) => {
  // A PNG header claiming 20,000 × 20,000 px (400 MP); refused before decoding.
  const png = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'latin1');
  png.writeUInt32BE(20000, 16);
  png.writeUInt32BE(20000, 20);
  png[24] = 8;
  png[25] = 2;
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: png });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('20,000 × 20,000 px (400 MP)');
  await expect(alert).toContainText('Save a smaller copy');

  await page.getByTestId('file-input').setInputFiles('tests/fixtures/small.jpg');
  await expect(page.getByTestId('crop-px')).toHaveText('750 × 600 px');
});

test('a damaged file gets a clear error and the page keeps working', async ({ page }) => {
  await upload(page, 'small.jpg');
  // Valid JPEG header, garbage after it.
  const bad = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), Buffer.alloc(500, 7)]);
  await page.getByTestId('replace-input').setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: bad });
  await expect(page.getByRole('alert')).toContainText('Couldn’t open “broken.jpg”'.replace('’', "'"));
  // The previous image is still usable.
  await expect(page.getByTestId('file-meta')).toContainText('small.jpg');
  const out = await downloadFile(page);
  expect(out.name).toBe('small_5x4_full_2.5x2in_750x600px.jpg');
});

test('the page stays responsive while the worker exports', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Long-task timing is only reported by Chromium');
  test.setTimeout(240_000);
  await upload(page, 'large.jpg');
  await expectEngine(page, 'worker');
  await pickRatio(page, '3:2');
  await clearQueue(page);
  await page.getByRole('button', { name: 'All 300 PPI' }).click();

  await page.evaluate(() => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.longTasks.push(e.duration);
    }).observe({ type: 'longtask' });
  });
  const out = await downloadFile(page);
  expect(out.name).toBe('large_printpack.zip');
  const longTasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  const worst = Math.max(0, ...longTasks);
  test.info().annotations.push({ type: 'longest main-thread task', description: `${Math.round(worst)} ms` });
  // Rendering 8 files (up to 96 MP) happens off the page; the page itself never blocks for long.
  expect(worst).toBeLessThan(250);
});
