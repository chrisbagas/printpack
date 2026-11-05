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
- Exports too large for one canvas (iOS Safari allows about 16.7 MP) are
  rendered in horizontal strips and encoded strip by strip, so the output
  size isn't limited by the canvas. See [How exports are rendered](#how-exports-are-rendered).
- File names: `sunset_4x5_16x20in_4800x6000px.jpg`,
  `sunset_5x4_full_16.7x13.3in_5000x4000px.jpg`, `sunset_printpack.zip`.
- ZIP entries are stored uncompressed: JPGs don't shrink further, and this
  keeps packing fast.

## How exports are rendered

- **Off the page.** Decoding, resizing, JPEG encoding and ZIP packing run in a
  Web Worker using `OffscreenCanvas`, so the page stays responsive during big
  exports. Browsers without canvas support in workers (Safari before 16.4) run
  the same code on the page instead.
- **One canvas when possible, strips when not.** An export normally renders on
  one canvas and uses the browser's JPEG encoder. If that canvas (or an
  intermediate resize step) is larger than the browser allows, PrintPack
  renders horizontal strips with overlapping margins and feeds them to its own
  streaming JPEG encoder (`src/lib/jpegEncoder.ts`, baseline 4:2:0, quality
  matched to libjpeg in tests). Big reductions step down by exact powers of two
  so strips line up pixel for pixel.
- **Decoding still needs memory.** Strip rendering limits the size of the
  *output* canvases, but the browser still decodes the whole source image
  (width × height × 4 bytes: 384 MB for a 96 MP photo). PrintPack reads the
  image size from the file header first, refuses images over 250 MP, and
  explains decode failures with the image's size and what to try instead.
- **Failures don't leave the page stuck.** One operation runs at a time. If the
  worker can't start, PrintPack falls back to the page; if it crashes during an
  export, the error is shown, controls come back, and the next export starts a
  fresh worker and reloads the image automatically.

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
npm test                 # unit tests (Vitest)
npm run test:e2e         # browser tests (Playwright)
npm run typecheck:tests  # type-check the browser tests
npm run report           # table of every exported file from the last browser run
```

Browser tests run in **Chromium, Firefox and WebKit**: one Playwright project
per installed browser. Browsers that aren't installed are skipped with a note;
install them with `npx playwright install chromium firefox webkit`, or choose
explicitly with `BROWSERS=chromium,webkit npm run test:e2e` (a browser named
there must be installed).

The tests generate their own images (`npm run fixtures`, into
`tests/fixtures/`), download real files from the browser, and check them:

| Area | What's checked |
|---|---|
| Inputs | 6000×4000 landscape JPG, 3000×4500 portrait PNG, transparent PNG, 96 MP JPG, 800×600 JPG, EXIF-rotated JPG |
| Render modes | Worker and main thread × one canvas and forced strips, for portrait, landscape, transparent and EXIF-rotated inputs |
| Output | Exact pixel size, JPEG format, 300 DPI tag, ZIP entry names, white fill, corner markers in the right corners |
| Strip seams | `boundary.png` (gradients, 1 px lines on every 7th row, fine vertical and diagonal lines, colour bands, text) rendered on one canvas and in strips, then compared row by row for seams, colour shifts and missing or doubled rows, plus the lines checked against their known positions |
| Failures | Worker script fails to load, worker without canvas support, export error, worker crash, damaged file, image too large to open, then recovery with no stale progress or disabled controls |
| Workflow | Repeated exports, loading another image after an export, upscale confirm/cancel/skip |
| Responsiveness | Longest main-thread task during a 96 MP, 8-file export in the worker (Chromium only) |

#### Test switches

These URL parameters exist for the browser tests and for debugging:

| Parameter | Effect |
|---|---|
| `?canvasLimit=16777216` | Treat canvases above this many pixels as too large (16777216 ≈ iOS Safari), forcing strip rendering |
| `?engine=main` | Render on the page instead of in a worker |
| `?simulate=worker-load-fail` | The worker script fails to load |
| `?simulate=worker-no-canvas` | The worker starts without canvas support |
| `?simulate=export-error` | The first export fails with an error |
| `?simulate=worker-crash` | The worker crashes during the first export |

## Browser support and device checks

Automated tests run in desktop Chromium; Firefox and WebKit run when installed.
**Playwright's WebKit is not iPhone Safari**: it doesn't have iOS's memory
limits or canvas limit, so `?canvasLimit=` only simulates the canvas part.
Before relying on PrintPack on phones and tablets, check these on real devices:

1. **iPhone, iOS Safari 16.4 or later**, with a 24–48 MP photo from the camera
   roll (HEIC photos must be exported as JPG first):
   - Upload, crop, and export 24×36 in (2:3), which is 78 MP and must be rendered in strips.
   - Export a ZIP with several sizes, then open the files in Photos and check
     them for bands or seams. Check that the 300 DPI tag is present in an editor.
   - Try larger sources (for example 48, 96 and 150 MP) and note the largest
     source and export that still work.
2. **iPhone on iOS 15–16.3**: checks the main-thread fallback (no OffscreenCanvas).
3. **iPad Safari** and **Android Chrome** (a mid-range phone with 4 GB RAM):
   same as step 1.
4. **Desktop Safari and Firefox**: one large ZIP export each, if they couldn't
   run in CI.
5. On each device, test what happens with an image the device can't decode
   (for example a 200 MP panorama): PrintPack should explain the problem and
   stay usable; the browser tab should not reload.

## Stack

React 19, TypeScript, Vite, [react-easy-crop](https://github.com/ValentinH/react-easy-crop)
for the crop UI, and [fflate](https://github.com/101arrowz/fflate) for ZIPs.
