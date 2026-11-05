import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Download, Page } from '@playwright/test';
import sharp from 'sharp';

export const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
export const OUT_DIR = join(process.cwd(), 'test-results', 'exports');
export const REPORT_PATH = join(process.cwd(), 'test-results', 'export-report.jsonl');

export async function upload(page: Page, fixture: string) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(join(FIXTURES, fixture));
  await page.getByTestId('crop-px').waitFor();
}

export async function pickRatio(page: Page, label: string) {
  await page.getByRole('radio', { name: new RegExp(`^${label}`) }).click();
}

export function sizeRow(page: Page, name: string | RegExp) {
  return page.locator('.size-row', { has: page.getByRole('checkbox', { name }) });
}

export async function selectSize(page: Page, name: string | RegExp) {
  await page.getByRole('checkbox', { name }).check();
}

/** Clear the whole export queue, then select a single size. */
export async function selectOnly(page: Page, name: string | RegExp) {
  const remove = page.getByRole('button', { name: /^Remove / });
  while ((await remove.count()) > 0) await remove.first().click();
  await selectSize(page, name);
}

export async function cropPx(page: Page): Promise<[number, number]> {
  const text = (await page.getByTestId('crop-px').textContent()) ?? '';
  const [w, h] = text.replace(/,/g, '').match(/\d+/g)!.map(Number);
  return [w, h];
}

export async function saveDownload(download: Download): Promise<string> {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, download.suggestedFilename());
  await download.saveAs(file);
  return file;
}

/** Read the JFIF density bytes straight from the file header. */
export function jfifDpi(buf: Buffer): { units: number; x: number; y: number } | null {
  if (buf[2] !== 0xff || buf[3] !== 0xe0 || buf.toString('latin1', 6, 10) !== 'JFIF') return null;
  return { units: buf[13], x: buf.readUInt16BE(14), y: buf.readUInt16BE(16) };
}

export interface ExportInfo {
  file: string;
  name: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  dpi: { units: number; x: number; y: number } | null;
  hasAlpha: boolean;
}

export async function inspectJpeg(file: string): Promise<ExportInfo> {
  const buf = readFileSync(file);
  return inspectBuffer(buf, file);
}

export async function inspectBuffer(buf: Buffer, file: string): Promise<ExportInfo> {
  const meta = await sharp(buf, { limitInputPixels: false }).metadata();
  return {
    file,
    name: file.split('/').pop()!,
    format: meta.format!,
    width: meta.width!,
    height: meta.height!,
    bytes: buf.length,
    dpi: jfifDpi(buf),
    hasAlpha: !!meta.hasAlpha,
  };
}

/** Average RGB of a small square at fractional position (fx, fy) of the image. */
export async function sampleRgb(file: string | Buffer, fx: number, fy: number, size = 8) {
  const img = sharp(file, { limitInputPixels: false });
  const { width, height } = await img.metadata();
  const left = Math.min(width! - size, Math.max(0, Math.round(fx * width! - size / 2)));
  const top = Math.min(height! - size, Math.max(0, Math.round(fy * height! - size / 2)));
  const { data } = await img
    .extract({ left, top, width: size, height: size })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  return sum.map((s) => Math.round(s / (data.length / 3)));
}

export function record(testName: string, source: string, info: ExportInfo, extra: Record<string, unknown> = {}) {
  mkdirSync(join(process.cwd(), 'test-results'), { recursive: true });
  const sourceBytes = statSync(join(FIXTURES, source)).size;
  appendFileSync(
    REPORT_PATH,
    JSON.stringify({ test: testName, source, sourceBytes, ...info, file: undefined, ...extra }) + '\n',
  );
}

/** Rough colour match: each channel within `tol`. */
export function near(rgb: number[], target: number[], tol = 40) {
  return rgb.every((v, i) => Math.abs(v - target[i]) <= tol);
}
