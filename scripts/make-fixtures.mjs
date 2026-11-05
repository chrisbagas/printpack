// Generates test images in tests/fixtures. Every image has coloured corner
// markers (top-left red, top-right green, bottom-left blue, bottom-right
// yellow) so tests can check that exports aren't flipped or rotated.
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tests', 'fixtures');

function scene(width, height, { transparent = false } = {}) {
  const m = Math.round(Math.min(width, height) * 0.08);
  const bg = transparent
    ? ''
    : `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="#3b6f8f"/><stop offset="0.55" stop-color="#d9a35b"/>
         <stop offset="1" stop-color="#7c3f58"/></linearGradient></defs>
       <rect width="100%" height="100%" fill="url(#g)"/>`;
  const r = Math.min(width, height) * 0.28;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${bg}
    <circle cx="${width / 2}" cy="${height / 2}" r="${r}" fill="#1d4f3f"/>
    ${transparent ? `<rect x="0" y="${height * 0.78}" width="${width}" height="${height * 0.08}" fill="#1d4f3f" fill-opacity="0.5"/>` : ''}
    <rect x="0" y="0" width="${m}" height="${m}" fill="#ff0000"/>
    <rect x="${width - m}" y="0" width="${m}" height="${m}" fill="#00ff00"/>
    <rect x="0" y="${height - m}" width="${m}" height="${m}" fill="#0000ff"/>
    <rect x="${width - m}" y="${height - m}" width="${m}" height="${m}" fill="#ffff00"/>
  </svg>`);
}

/** Rasterise a small scene, enlarge it, and add grain so JPEG sizes are realistic. */
async function photo(width, height) {
  const small = Math.min(1, 2000 / Math.max(width, height));
  const base = await sharp(scene(Math.round(width * small), Math.round(height * small)))
    .resize(width, height, { kernel: 'cubic' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const grain = await sharp({
    create: { width: 256, height: 256, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 14 } },
  })
    .png()
    .toBuffer();
  return sharp(base, { raw: { width, height, channels: 3 }, limitInputPixels: false })
    .composite([{ input: grain, tile: true, blend: 'soft-light' }]);
}

const fixtures = [
  ['landscape.jpg', async () => (await photo(6000, 4000)).jpeg({ quality: 88 })],
  ['portrait.png', async () => (await photo(3000, 4500)).png({ compressionLevel: 6 })],
  ['transparent.png', async () => sharp(scene(2000, 2000, { transparent: true })).png()],
  ['large.jpg', async () => (await photo(12000, 8000)).jpeg({ quality: 85 })],
  ['small.jpg', async () => (await photo(800, 600)).jpeg({ quality: 88 })],
  // Stored as 4000×3000 landscape with EXIF orientation 6 (rotate 90° clockwise),
  // so it should display and export as 3000×4000 portrait.
  ['exif-rotated.jpg', async () => (await photo(4000, 3000)).jpeg({ quality: 88 }).withMetadata({ orientation: 6 })],
];

await mkdir(out, { recursive: true });
for (const [name, make] of fixtures) {
  const file = join(out, name);
  const exists = await stat(file).then(() => true, () => false);
  if (exists && !process.argv.includes('--force')) continue;
  const t = Date.now();
  await (await make()).toFile(file);
  const meta = await sharp(file, { limitInputPixels: false }).metadata();
  const { size } = await stat(file);
  console.log(
    `${name.padEnd(18)} ${meta.width}×${meta.height} ${meta.hasAlpha ? 'alpha ' : ''}` +
      `orientation=${meta.orientation ?? 1} ${(size / 1048576).toFixed(1)} MB (${Date.now() - t} ms)`,
  );
}
