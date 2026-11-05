import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { inspectBuffer, outDir, saveDownload, type ExportInfo } from './helpers';

/** Click download (accepting or skipping an upscale warning) and return the saved file. */
export async function downloadFile(page: Page, upscale: 'none' | 'confirm' | 'skip' = 'none') {
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

/** Unzip, write each entry to the per-browser output folder, and inspect it. */
export async function openZip(file: string, subdir = 'unzipped'): Promise<Map<string, ExportInfo & { buf: Buffer }>> {
  const entries = unzipSync(new Uint8Array(readFileSync(file)));
  const out = new Map<string, ExportInfo & { buf: Buffer }>();
  const dir = join(outDir(), subdir);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(entries)) {
    const buf = Buffer.from(data);
    const path = join(dir, name);
    writeFileSync(path, buf);
    out.set(name, { ...(await inspectBuffer(buf, path)), buf });
  }
  return out;
}

export function expectPrintReady(info: ExportInfo, width: number, height: number) {
  expect(info.format).toBe('jpeg');
  expect([info.width, info.height]).toEqual([width, height]);
  expect(info.dpi).toEqual({ units: 1, x: 300, y: 300 });
}
