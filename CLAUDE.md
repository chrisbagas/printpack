# PrintPack

Browser-only React + TypeScript + Vite app. Sellers upload a JPG/PNG, crop it to
2:3, 3:4 or 4:5 (portrait or landscape), and download print-ready 300 PPI JPGs:
single files, a ZIP, or a **Seller Pack** (one JPG per ratio/orientation plus a
buyer printing-guide PDF, checked against Etsy's upload limits).

## Hard constraints

- **All image processing stays in the browser.** No uploads, no backend, no
  external services for user artwork or test fixtures.
- Not yet in scope: accounts, billing, analytics, AI features, batch uploads,
  new print ratios, Etsy API integration.
- Never silently resize, upscale, drop files or lower JPEG quality. Upscaling
  needs explicit user approval; quality changes are the seller's choice.
- The printing guide must come from the actual exported files and must never
  list a size larger than a file or imply that upscaling adds detail.
- Add dependencies only when clearly justified; heavy ones are lazy-loaded
  (`pdf-lib` is only imported when a Seller Pack is built).

## Commands

```bash
npm run dev               # Vite dev server
npm run build             # tsc -b && vite build
npm run lint              # oxlint
npm test                  # Vitest unit tests (src/**/*.test.ts, Node env)
npm run test:e2e          # Playwright; builds and serves on :4173 itself
npm run typecheck:tests   # type-check tests/ and playwright.config.ts
npm run fixtures          # (re)generate tests/fixtures (also run by e2e global setup)
npm run report            # table of exported files from the last e2e run
```

Run build, lint, `typecheck:tests`, unit and e2e tests before committing.
Report results honestly: say which browsers actually ran.

## Layout

- `src/App.tsx`: page state (image, per-ratio crops, selection, mode), the
  individual-files flow, the upscale dialog, and the URL test switches.
- `src/components/`: `SellerPackPanel.tsx` (pack build, upload preview,
  oversized handling, quality preview), plus the uploader, crop stage, size
  list, export queue and dialog.
- `src/lib/` (pure logic unless noted):
  - `ratios.ts`, `print.ts`: ratios, standard sizes, 300 PPI targets,
    upscale maths, `centeredCrop`.
  - `filename.ts`: `sunset_4x5_16x20in_4800x6000px.jpg` naming.
  - `engine.ts`: `EngineHost` (one operation at a time, worker crash
    recovery, reloads the image into a new worker), `WorkerEngine`,
    `MainThreadEngine`.
  - `exportJobs.ts`: `renderJobs`, `exportJobs` (single JPG or ZIP),
    `previewJob`.
  - `render.ts`: one-canvas render, or strips + streaming encoder when the
    canvas limit is exceeded. Large reductions step down by exact powers of two.
  - `jpegEncoder.ts`: streaming baseline JPEG encoder (4:2:0, JFIF 300 DPI).
  - `decode.ts`, `imageSize.ts`: header size check (250 MP cap), decode with
    EXIF orientation, transparency detection, actionable errors.
  - `jpegDpi.ts`: sets the JFIF density to 300 DPI on browser-encoded JPGs.
  - `sellerPack.ts`, `printGuide.ts`, `guidePdf.ts`, `packaging.ts`: pack plan,
    guide content, PDF rendering, upload planning and limit checks.
  - `marketplace.ts`: **the only place for marketplace limits** (Etsy: 5 files,
    20,000,000 bytes each; last checked 2026-11-05).
  - `zip.ts`: stored (level 0) ZIPs via fflate.
  - `simulate.ts`: failure switches for tests.
- `src/workers/`: `export.worker.ts` plus the typed message `protocol.ts`.
- `tests/e2e/`: Playwright specs; `helpers.ts` and `zip.ts` hold shared
  download, decode and pixel-comparison helpers.
- `scripts/make-fixtures.mjs`: generates test images with sharp; they're
  gitignored, so don't commit them.

## Conventions

- Keep marketplace rules in `marketplace.ts` and file naming in `filename.ts`;
  don't duplicate them in components.
- Any new engine operation goes through `EngineHost` (queued, crash-safe) and
  must work in both `WorkerEngine` and `MainThreadEngine`.
- Release canvases (`releaseCanvas`), ImageBitmaps and object URLs when done.
- UI copy is for non-technical sellers: plain language, US spelling, say what
  to do next.
- `index.css` disables Inter's `calt` feature so `3x2` isn't rendered as `3×2`.
  File names must display exactly as saved.
- Commits are small and focused, with a body explaining why.

## Testing notes

- Browser tests check real downloaded files: pixel size, JPEG format, the
  300 DPI JFIF tag, ZIP entries, and pixel content (corner markers, white fill,
  strip seams compared with single-canvas output). Compare decoded pixels
  with tolerances, never encoder bytes.
- URL switches used by tests: `?canvasLimit=N` (force strips),
  `?engine=main`, `?simulate=worker-load-fail|worker-no-canvas|export-error|worker-crash`,
  `?maxUploads=N&maxUploadMB=X`.
- Seller Pack and guide tests read PDFs with `pdftotext` (poppler-utils) and
  skip without it.
- Playwright runs one project per *installed* browser (Chromium, Firefox,
  WebKit) and skips missing ones with a note; `BROWSERS=chromium,webkit`
  selects explicitly.
- In Claude Code cloud sessions, Chromium is preinstalled for Playwright
  **1.63**; keep `@playwright/test` at 1.63.x in the lockfile, and don't run
  `npx playwright install chromium`. Firefox/WebKit downloads from
  `cdn.playwright.dev` may be blocked by the environment's network policy.
- Playwright WebKit is not iPhone Safari. Real-device checks are listed in the
  README under "Browser support and device checks".

## Git and PRs

- Default branch is `main`. Branch for changes and open PRs into `main`.
- If you stack PRs, retarget each to `main` after the one below merges, or
  merge only the top PR into `main`. Merging stacked PRs into their stacked
  bases leaves `main` without the work.
