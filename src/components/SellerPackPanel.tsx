import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadBlob } from '../lib/download';
import type { EngineHost } from '../lib/engine';
import type { ExportJob, ExportOptions, ExportProgress } from '../lib/exportJobs';
import { baseName, exportFileName } from '../lib/filename';
import { readImageSize } from '../lib/imageSize';
import { formatMB, type UploadLimits } from '../lib/marketplace';
import { checkUploads, planUploads, type PackEntry, type PackProblem, type UploadPlan } from '../lib/packaging';
import { effectivePpi, formatInches, needsUpscale, scaleFactor, type ExportTarget } from '../lib/print';
import { buildGuide, type PrintGuide, type RenderedPackFile } from '../lib/printGuide';
import { ratioLabel } from '../lib/ratios';
import { defaultArtworkName, planPackFiles, type PackFile, type SelectedItem } from '../lib/sellerPack';
import { buildZip } from '../lib/zip';
import type { UpscaleItem } from './UpscaleDialog';

export const DEFAULT_QUALITY = 0.92;
const MIN_QUALITY = 0.5;

interface Upload extends UploadPlan {
  blob: Blob;
  bytes: number;
}

interface BuiltPack {
  signature: string;
  quality: number;
  uploads: Upload[];
  guide: PrintGuide;
  problems: PackProblem[];
}

interface Props {
  fileName: string;
  selected: SelectedItem[];
  host: () => EngineHost | null;
  exportOptions: ExportOptions;
  limits: UploadLimits;
  requestUpscaleApproval: (items: UpscaleItem[]) => Promise<boolean>;
  onJump: (target: ExportTarget) => void;
  onBusyChange: (busy: boolean) => void;
}

function describeProgress(p: ExportProgress): string {
  if (!p.job) return 'Packing…';
  const pct = p.fraction ? ` (${Math.round(p.fraction * 100)}%)` : '';
  return `Rendering file ${p.index + 1} of ${p.total}: ${p.job.width.toLocaleString()} × ${p.job.height.toLocaleString()} px${pct}…`;
}

function groupLabel(f: PackFile) {
  return `${ratioLabel(f.target.ratio, f.target.orientation)} ${f.target.orientation}`;
}

function sizeLabel(t: ExportTarget) {
  const inches = `${formatInches(t.widthIn)} × ${formatInches(t.heightIn)} in`;
  return t.kind === 'full' ? `Full resolution (${inches})` : inches;
}

/** Seller-facing description of a packaging problem. */
function problemText(p: PackProblem, limits: UploadLimits): string {
  if (p.kind === 'too-many-files') {
    return `The pack needs ${p.count} uploads, but ${limits.marketplace} allows ${p.limit} per listing (the printing guide counts as one).`;
  }
  const where = p.inside ? ` (inside ${p.inside})` : '';
  return `${p.name}${where} is ${formatMB(p.bytes)}. ${limits.marketplace} allows up to ${formatMB(p.limit)} per file.`;
}

/** Turn each JPG back into a measured description: names and pixel sizes come from the files themselves. */
async function measure(files: { name: string; blob: Blob }[]) {
  return Promise.all(
    files.map(async (f) => {
      const size = await readImageSize(f.blob);
      if (!size) throw new Error(`${f.name} isn't a readable JPG.`);
      return { ...f, ...size, bytes: f.blob.size };
    }),
  );
}

export function SellerPackPanel({
  fileName,
  selected,
  host,
  exportOptions,
  limits,
  requestUpscaleApproval,
  onJump,
  onBusyChange,
}: Props) {
  const [artworkName, setArtworkName] = useState(() => defaultArtworkName(fileName));
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [pack, setPack] = useState<BuiltPack | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ quality: number; current: string; next: string; currentBytes: number; nextBytes: number; file: string } | null>(null);
  const approved = useRef<string | null>(null);

  const files = useMemo(() => planPackFiles(selected), [selected]);
  const slug = baseName(artworkName).slice(0, 40).replace(/-+$/, '') || 'artwork';
  const names = files.map((f) => exportFileName(slug, f.target));
  const signature = JSON.stringify([artworkName, files.map((f) => [f.target.key, f.target.widthPx, f.target.heightPx, f.crop])]);
  const stale = pack !== null && pack.signature !== signature;
  const upscaled = files.filter((f) => needsUpscale(f.crop, f.target));

  useEffect(() => onBusyChange(busy !== null), [busy, onBusyChange]);
  useEffect(
    () => () => {
      if (preview) {
        URL.revokeObjectURL(preview.current);
        URL.revokeObjectURL(preview.next);
      }
    },
    [preview],
  );

  async function build(q: number) {
    const h = host();
    if (!h || files.length === 0) return;
    setError(null);
    if (upscaled.length > 0 && approved.current !== signature) {
      const ok = await requestUpscaleApproval(
        upscaled.map((f) => ({ target: f.target, factor: scaleFactor(f.crop, f.target), ppi: effectivePpi(f.crop, f.target) })),
      );
      if (!ok) return;
      approved.current = signature;
    }

    setBusy('Starting…');
    setPack(null);
    try {
      const jobs: ExportJob[] = files.map((f, i) => ({
        fileName: names[i],
        crop: f.crop,
        width: f.target.widthPx,
        height: f.target.heightPx,
      }));
      const rendered = await h.render(jobs, { ...exportOptions, quality: q }, (p) => setBusy(describeProgress(p)));
      setBusy('Writing the printing guide…');
      const measured = await measure(rendered.map((r) => ({ name: r.name, blob: r.blob })));

      const images: PackEntry[] = measured.map((m) => ({ name: m.name, bytes: m.bytes }));
      const guideName = `${slug}_printing-guide.pdf`;
      const plan = planUploads(images, { name: guideName, bytes: 0 }, limits, (i, n) =>
        n === 1 ? `${slug}_images.zip` : `${slug}_images-${i + 1}.zip`,
      );
      const uploadOf = (name: string) => plan.find((p) => p.contents.some((c) => c.name === name))!.name;

      const guide = buildGuide(
        artworkName.trim() || 'Artwork',
        measured.map(
          (m, i): RenderedPackFile => ({
            fileName: m.name,
            ratio: files[i].target.ratio,
            orientation: files[i].target.orientation,
            widthPx: m.width,
            heightPx: m.height,
            bytes: m.bytes,
            crop: files[i].crop,
            upload: uploadOf(m.name),
          }),
        ),
      );
      const { renderGuidePdf } = await import('../lib/guidePdf');
      const pdf = new Blob([(await renderGuidePdf(guide)) as BlobPart], { type: 'application/pdf' });

      setBusy('Packing uploads…');
      const blobs = new Map(measured.map((m) => [m.name, m.blob]));
      const uploads: Upload[] = [];
      for (const p of plan) {
        let blob: Blob;
        if (p.kind === 'pdf') blob = pdf;
        else if (p.kind === 'jpg') blob = blobs.get(p.name)!;
        else {
          const entries = await Promise.all(
            p.contents.map(async (c) => ({ name: c.name, data: new Uint8Array(await blobs.get(c.name)!.arrayBuffer()) })),
          );
          blob = new Blob([buildZip(entries) as BlobPart], { type: 'application/zip' });
        }
        const contents = p.kind === 'pdf' ? [{ name: guideName, bytes: pdf.size }] : p.contents;
        uploads.push({ ...p, contents, blob, bytes: blob.size });
      }
      // Validate what will actually be uploaded, including the guide.
      const problems = checkUploads(uploads, limits);
      setPack({ signature, quality: q, uploads, guide, problems });
      setQuality(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function showPreview(q: number) {
    const h = host();
    if (!h || !pack) return;
    // Preview the largest image: it's the one most likely to be over the limit.
    const biggest = files.reduce((a, b) => (a.target.widthPx * a.target.heightPx >= b.target.widthPx * b.target.heightPx ? a : b));
    const i = files.indexOf(biggest);
    const job: ExportJob = { fileName: names[i], crop: biggest.crop, width: biggest.target.widthPx, height: biggest.target.heightPx };
    setBusy('Rendering preview…');
    try {
      const [current, next] = [await h.preview(job, pack.quality), await h.preview(job, q)];
      setPreview({
        quality: q,
        current: URL.createObjectURL(current),
        next: URL.createObjectURL(next),
        currentBytes: current.size,
        nextBytes: next.size,
        file: names[i],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function downloadAll(uploads: Upload[]) {
    for (const u of uploads) {
      downloadBlob(u.blob, u.name);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const tooLarge = pack?.problems.filter((p) => p.kind === 'file-too-large') ?? [];
  const tooMany = pack?.problems.some((p) => p.kind === 'too-many-files') ?? false;
  const pct = (q: number) => `${Math.round(q * 100)}%`;
  const oversizedFiles = files.filter((_, i) => tooLarge.some((p) => p.name === names[i]));

  return (
    <section className="pack" data-testid="seller-pack" aria-label="Seller Pack">
      <label className="field">
        <span className="field-label">Artwork name</span>
        <input
          className="text-input"
          value={artworkName}
          maxLength={80}
          onChange={(e) => setArtworkName(e.target.value)}
          data-testid="artwork-name"
        />
        <span className="hint">Used for the printing guide's title and the file names.</span>
      </label>

      <div className="field">
        <span className="field-label">Files in the pack</span>
        {files.length === 0 ? (
          <p className="queue-empty">Select at least one print size above.</p>
        ) : (
          <ul className="pack-plan" data-testid="pack-plan">
            {files.map((f, i) => (
              <li key={f.group} data-group={f.group}>
                <button type="button" className="pack-plan-group" onClick={() => onJump(f.target)}>
                  {groupLabel(f)}
                </button>
                <span className="pack-plan-size">
                  {sizeLabel(f.target)} · {f.target.widthPx.toLocaleString()} × {f.target.heightPx.toLocaleString()} px
                  {needsUpscale(f.crop, f.target) && <span className="badge badge-warn">Upscale {scaleFactor(f.crop, f.target).toFixed(1)}×</span>}
                </span>
                <span className="pack-plan-name">{names[i]}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          One file per ratio and orientation, at the largest size you selected. Buyers print every smaller size of
          that shape from the same file, and the printing guide tells them which file to use.
        </p>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy !== null || files.length === 0}
        onClick={() => void build(quality)}
        data-testid="build-pack"
      >
        {busy ? 'Building…' : pack && !stale ? 'Rebuild Seller Pack' : 'Build Seller Pack'}
      </button>
      {busy && (
        <p className="status status-working" role="status" data-testid="pack-status">
          {busy}
        </p>
      )}
      {error && (
        <p className="status status-error" role="alert" data-testid="pack-error">
          {error}
        </p>
      )}
      {stale && (
        <p className="note" data-testid="pack-stale">
          Your selection, crop or artwork name changed since this pack was built. Rebuild it before uploading.
        </p>
      )}

      {pack && !stale && (
        <div className="uploads" data-testid="pack-uploads">
          <div className="uploads-head">
            <span className="field-label">
              Upload these {pack.uploads.length} {pack.uploads.length === 1 ? 'file' : 'files'} to your listing
            </span>
            <span className="hint">
              {limits.marketplace}: up to {limits.maxFiles} files, {formatMB(limits.maxBytesPerFile)} each · JPEG
              quality {pct(pack.quality)}
            </span>
          </div>
          <ul>
            {pack.uploads.map((u) => {
              const over = u.bytes > limits.maxBytesPerFile;
              return (
                <li key={u.name} className={`upload${over ? ' is-over' : ''}`} data-name={u.name} data-bytes={u.bytes} data-kind={u.kind}>
                  <div className="upload-row">
                    <span className="upload-name">{u.name}</span>
                    <span className={`badge ${over ? 'badge-warn' : 'badge-ok'}`}>{formatMB(u.bytes)}</span>
                    <button type="button" className="link" onClick={() => downloadBlob(u.blob, u.name)}>
                      Download
                    </button>
                  </div>
                  <ul className="upload-contents">
                    {u.kind === 'pdf' && <li>
                        Printing guide for buyers ({pack.guide.files.length}{' '}
                        {pack.guide.files.length === 1 ? 'file' : 'files'} described)
                      </li>}
                    {u.kind === 'jpg' && <li>Print file (JPG, 300 DPI)</li>}
                    {u.kind === 'zip' &&
                      u.contents.map((c) => (
                        <li key={c.name} data-entry={c.name} data-bytes={c.bytes}>
                          {c.name} · {formatMB(c.bytes)}
                        </li>
                      ))}
                  </ul>
                </li>
              );
            })}
          </ul>

          {pack.problems.length === 0 ? (
            <>
              <p className="status status-done" data-testid="pack-ok">
                Fits {limits.marketplace}'s limits for a digital listing.
              </p>
              <button type="button" className="btn btn-block" onClick={() => void downloadAll(pack.uploads)} data-testid="download-all">
                Download all {pack.uploads.length} files
              </button>
            </>
          ) : (
            <div className="pack-problems" data-testid="pack-problems" role="alert">
              <p>
                <strong>This pack doesn't fit {limits.marketplace}'s limits yet.</strong>
              </p>
              <ul>
                {pack.problems.map((p) => (
                  <li key={`${p.kind}-${'name' in p ? p.name : ''}`}>{problemText(p, limits)}</li>
                ))}
              </ul>

              {tooLarge.length > 0 && (
                <div className="quality" data-testid="quality">
                  <label htmlFor="quality-slider" className="field-label">
                    JPEG quality: {pct(quality)}
                  </label>
                  <input
                    id="quality-slider"
                    type="range"
                    min={MIN_QUALITY * 100}
                    max={DEFAULT_QUALITY * 100}
                    step={1}
                    value={Math.round(quality * 100)}
                    onChange={(e) => setQuality(Number(e.target.value) / 100)}
                    data-testid="quality-slider"
                  />
                  <p className="hint">
                    Lower quality makes files smaller but can add blur and blocky artefacts, most visible in fine
                    detail and smooth gradients. Preview it at 100% before rebuilding.
                  </p>
                  <div className="quality-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null || quality === pack.quality}
                      onClick={() => void showPreview(quality)}
                      data-testid="preview-quality"
                    >
                      Preview {pct(quality)}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy !== null || quality === pack.quality}
                      onClick={() => void build(quality)}
                      data-testid="rebuild-pack"
                    >
                      Rebuild at {pct(quality)}
                    </button>
                  </div>
                  {preview && (
                    <figure className="quality-preview" data-testid="quality-preview">
                      <div>
                        <img src={preview.current} alt={`Detail at ${pct(pack.quality)} quality`} />
                        <figcaption>Now: {pct(pack.quality)}</figcaption>
                      </div>
                      <div>
                        <img src={preview.next} alt={`Detail at ${pct(preview.quality)} quality`} />
                        <figcaption>
                          {pct(preview.quality)}: this detail is {Math.round((1 - preview.nextBytes / preview.currentBytes) * 100)}% smaller
                        </figcaption>
                      </div>
                      <figcaption className="quality-preview-note">
                        Actual pixels from the middle of {preview.file}. Rebuild to see the real file sizes.
                      </figcaption>
                    </figure>
                  )}
                </div>
              )}

              <div className="pack-advice" data-testid="pack-advice">
                <p>
                  <strong>Other things you can change:</strong>
                </p>
                <ul>
                  {oversizedFiles.map((f) => (
                    <li key={f.group}>
                      Select a smaller largest size for {groupLabel(f)} (now {sizeLabel(f.target)}). Buyers can
                      still print every size up to the one you choose.
                    </li>
                  ))}
                  {tooMany && (
                    <li>
                      Include fewer ratios or orientations: each one adds a file, and {limits.marketplace} allows{' '}
                      {limits.maxFiles} uploads including the guide.
                    </li>
                  )}
                  <li>Offer the largest sizes as a separate listing.</li>
                </ul>
                <p className="hint">PrintPack never resizes, drops files or lowers quality without you choosing it.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
