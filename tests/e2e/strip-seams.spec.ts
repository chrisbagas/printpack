import { expect, test, type Page } from '@playwright/test';
import { decodeRgb, median, rowChannelShift, rowLuma, rowMae, selectSize, upload, type RawImage } from './helpers';
import { downloadFile, expectPrintReady, openZip } from './zip';

/**
 * Renders boundary.png (gradients, 1 px lines on every 7th row, vertical and
 * diagonal lines, colour bands, text) once on a single canvas and once in
 * strips, then compares the decoded pixels row by row. The two JPEG encoders
 * differ, so we compare with tolerances, not bytes.
 *
 * A 500,000 px canvas limit gives 192-row strips at 2400 px wide, 80-row strips
 * for the 2× reduction and 112-row strips for the enlargement: 16–40 seams each.
 */
const LIMIT = 500_000;
const FILES: Record<string, [number, number]> = {
  'boundary_4x5_full_8x10in_2400x3000px.jpg': [2400, 3000],
  'boundary_4x5_4x5in_1200x1500px.jpg': [1200, 1500],
  'boundary_4x5_12x15in_3600x4500px.jpg': [3600, 4500],
};

async function exportAll(page: Page, query: string, method: 'canvas' | 'strips') {
  await upload(page, 'boundary.png', query);
  await expect(page.getByTestId('crop-px')).toHaveText('2,400 × 3,000 px');
  await selectSize(page, /^4 × 5 in/);
  await selectSize(page, /^12 × 15 in/);
  const zip = await downloadFile(page, 'confirm');
  const methods = await page.getByTestId('results').locator('li').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-method')),
  );
  expect(methods).toEqual([method, method, method]);
  const files = await openZip(zip.file, `seams-${method}`);
  const decoded = new Map<string, RawImage>();
  for (const [name, [w, h]] of Object.entries(FILES)) {
    expectPrintReady(files.get(name)!, w, h);
    decoded.set(name, await decodeRgb(files.get(name)!.buf));
  }
  return decoded;
}

test('strip rendering matches single-canvas rendering row for row', async ({ page }) => {
  test.setTimeout(300_000);
  const canvas = await exportAll(page, '', 'canvas');
  const strips = await exportAll(page, `?canvasLimit=${LIMIT}`, 'strips');

  const summary: string[] = [];
  for (const name of Object.keys(FILES)) {
    const a = strips.get(name)!;
    const b = canvas.get(name)!;
    const rows = a.height;

    // 1. Overall agreement, and no row (a seam) much worse than typical rows.
    const mae = Array.from({ length: rows }, (_, r) => rowMae(a, r, b, r));
    const typical = median(mae);
    const worst = Math.max(...mae);
    const worstRow = mae.indexOf(worst);
    expect(typical, `${name}: median row difference`).toBeLessThan(2.5);
    expect(worst, `${name}: worst row ${worstRow}`).toBeLessThan(Math.max(6, typical * 3));

    // 2. No colour shift in any row (e.g. a strip drawn with the wrong background or offset).
    let worstShift = 0;
    for (let r = 0; r < rows; r++) {
      for (const c of rowChannelShift(a, b, r)) worstShift = Math.max(worstShift, Math.abs(c));
    }
    expect(worstShift, `${name}: worst per-row colour shift`).toBeLessThan(2);

    // 3. Alignment: every row with distinct content matches the same row in the
    //    reference better than its neighbours, so no row is missing or doubled.
    let checked = 0;
    for (let r = 1; r < rows - 1; r++) {
      const distinct = Math.min(rowMae(b, r, b, r - 1), rowMae(b, r, b, r + 1)) > 8;
      if (!distinct) continue;
      checked++;
      const same = mae[r];
      expect(same, `${name}: row ${r} is closer to a neighbouring row`).toBeLessThan(
        Math.min(rowMae(a, r, b, r - 1), rowMae(a, r, b, r + 1)),
      );
    }
    expect(checked, `${name}: rows with distinct content`).toBeGreaterThan(rows * 0.3);
    summary.push(
      `${name}: median row diff ${typical.toFixed(2)}, worst ${worst.toFixed(2)} (row ${worstRow}), ` +
        `worst colour shift ${worstShift.toFixed(2)}, ${checked} distinct rows aligned`,
    );
  }

  // 4. Ground truth at full size: a black 1 px line on every 7th row in x 150–450,
  //    across every strip boundary.
  const full = strips.get('boundary_4x5_full_8x10in_2400x3000px.jpg')!;
  const luma = Array.from({ length: full.height }, (_, r) => rowLuma(full, r, 150, 450));
  for (let r = 0; r < full.height; r++) {
    if (r % 7 === 0) {
      expect(luma[r], `row ${r} should be a line`).toBeLessThan(70);
      if (r > 0) expect(luma[r - 1] - luma[r], `row ${r} vs row above`).toBeGreaterThan(120);
      if (r + 1 < full.height) expect(luma[r + 1] - luma[r], `row ${r} vs row below`).toBeGreaterThan(120);
    } else {
      expect(luma[r], `row ${r} should be white`).toBeGreaterThan(200);
    }
  }
  test.info().annotations.push({ type: 'seam metrics', description: summary.join('\n') });
  console.log(summary.join('\n'));
});
