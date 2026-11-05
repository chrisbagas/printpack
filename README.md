# PrintPack

Crop a photo to a common print ratio and download print-ready JPGs at 300 PPI.
Everything runs in the browser: images are never uploaded.

## What it does

1. **Upload** a JPG or PNG (drag and drop, or pick a file).
2. **Choose a ratio**: 2:3, 3:4 or 4:5, portrait or landscape. The orientation
   defaults to the image's own.
3. **Adjust the crop** by dragging and zooming. PrintPack shows the crop in
   pixels and the largest print it supports at 300 PPI.
4. **Pick one or more print sizes.** Each ratio keeps its own crop, so a ZIP can
   mix, say, an 8×10 and a 12×18 from different framings. Sizes that need more
   pixels than the crop has are flagged, and you're asked before anything is
   upscaled (with the option to skip those sizes).
5. **Download** a single JPG, or a ZIP when more than one size is selected.

| Ratio | Standard sizes (inches) |
|---|---|
| 2:3 | 4×6, 8×12, 10×15, 12×18, 16×24, 20×30, 24×36 |
| 3:4 | 6×8, 9×12, 12×16, 18×24, 30×40 |
| 4:5 | 4×5, 8×10, 12×15, 16×20, 24×30 |

"Full resolution" exports the crop at its own size, trimmed by at most a few
pixels so the ratio is exact.

### Output details

- JPG, quality 0.92, sRGB, with the JFIF header set to **300 DPI**.
- Transparent PNG areas are filled with **white** (JPG can't store transparency).
- EXIF orientation is applied, so phone photos export upright.
- Large reductions are resized in halving steps to avoid jagged results.
- If an export is larger than the browser's canvas limit, you get a clear
  error instead of a blank file.
- File names: `sunset_4x5_16x20in_4800x6000px.jpg`,
  `sunset_5x4_full_16.7x13.3in_5000x4000px.jpg`, `sunset_printpack.zip`.
- ZIP entries are stored uncompressed: JPGs don't shrink further, and this
  keeps packing fast.

## Development

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and build to dist/
npm run lint
```

### Tests

```bash
npm test           # unit tests (Vitest): print math, file names, DPI tag, ZIP
npm run test:e2e   # end-to-end tests (Playwright, Chromium)
npm run report     # table of every exported file from the last e2e run
```

The end-to-end tests generate their own images (`npm run fixtures`, into
`tests/fixtures/`): a 6000×4000 landscape JPG, a 3000×4500 portrait PNG, a
transparent PNG, a 12000×8000 (96 MP) JPG, an 800×600 JPG for upscale warnings,
and an EXIF-rotated JPG. Each has coloured corner markers. The tests download
real files from the browser and check their pixel dimensions, file size, DPI
tag, ZIP contents, white fill for transparency, and that corners land where
they should.

If you haven't installed Playwright's browser before, run
`npx playwright install chromium` first.

## Stack

React 19, TypeScript, Vite, [react-easy-crop](https://github.com/ValentinH/react-easy-crop)
for the crop UI, and [fflate](https://github.com/101arrowz/fflate) for ZIPs.
