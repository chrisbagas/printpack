import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatInches } from './print';
import type { PrintGuide } from './printGuide';

/** Megabytes as buyers see them in a file browser. */
function mb(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const PAGE = { width: 612, height: 792 }; // US Letter
const MARGIN = 54;
const INK = rgb(0.11, 0.11, 0.1);
const MUTED = rgb(0.42, 0.4, 0.37);
const ACCENT = rgb(0.18, 0.36, 0.31);

/** The standard PDF fonts only cover Latin-1-ish text; replace anything else. */
function safe(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (supported.has(cp)) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    out += base && [...base].every((c) => supported.has(c.codePointAt(0)!)) ? base : '?';
  }
  return out;
}

class Writer {
  page!: PDFPage;
  y = 0;
  readonly doc: PDFDocument;
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly mono: PDFFont;
  readonly footer: string;

  constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont, mono: PDFFont, footer: string) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.mono = mono;
    this.footer = footer;
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
    const n = this.doc.getPageCount();
    this.page.drawText(safe(this.regular, `${this.footer} · page ${n}`), {
      x: MARGIN,
      y: MARGIN / 2,
      size: 8,
      font: this.regular,
      color: MUTED,
    });
  }

  ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }

  /** Wrapped text; returns the height used. */
  text(
    content: string,
    { size = 10.5, font = this.regular, color = INK, indent = 0, gap = 4, lineHeight = 1.35 } = {},
  ) {
    const maxWidth = PAGE.width - MARGIN * 2 - indent;
    const words = safe(font, content).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    for (const l of lines) {
      this.ensure(size * lineHeight);
      this.y -= size * lineHeight;
      this.page.drawText(l, { x: MARGIN + indent, y: this.y + size * 0.25, size, font, color });
    }
    this.y -= gap;
  }

  rule() {
    this.ensure(12);
    this.y -= 6;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness: 0.5,
      color: rgb(0.85, 0.84, 0.8),
    });
    this.y -= 8;
  }
}

/** Render the buyer's printing guide as a PDF. */
export async function renderGuidePdf(guide: PrintGuide): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${guide.artworkName}: printing guide`);
  doc.setCreator('PrintPack');
  doc.setProducer('PrintPack');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const w = new Writer(doc, regular, bold, mono, `${guide.artworkName}: printing guide`);

  const n = guide.files.length;
  w.text(guide.artworkName, { size: 22, font: bold, gap: 2 });
  w.text('Printing guide', { size: 13, color: ACCENT, gap: 12 });
  w.text(
    `This download has ${n} print-ready JPG ${n === 1 ? 'file' : 'files'}. Each file is made for one shape ` +
      '(aspect ratio) and prints at the sizes listed for it. All files are saved at 300 PPI, the standard for sharp prints.',
    { gap: 10 },
  );

  w.text('How to choose a file', { size: 13, font: bold, gap: 6 });
  const example = guide.lookup[Math.floor(guide.lookup.length / 2)]?.label ?? '8 × 10 in';
  const steps = [
    `Decide the print or frame size you want, for example ${example}.`,
    'Find that size in "Which file for which size" below, and use the file named next to it.',
    'Print at that size with no cropping ("fit" or "actual size"). If your size isn\'t listed, it has a different shape: printing it would crop or stretch the artwork.',
    'For the best result, print at a photo lab or print shop. Colors vary between screens and printers.',
  ];
  steps.forEach((s, i) => w.text(`${i + 1}.  ${s}`, { indent: 6, gap: 3 }));
  w.y -= 8;

  w.text('Which file for which size', { size: 13, font: bold, gap: 6 });
  for (const row of guide.lookup) {
    w.ensure(16);
    const y = w.y - 14;
    w.page.drawText(safe(regular, row.label), { x: MARGIN + 6, y, size: 10.5, font: bold, color: INK });
    w.page.drawText(safe(mono, row.fileName), { x: MARGIN + 110, y, size: 8.5, font: mono, color: INK });
    w.y -= 16;
    if (!row.sharp) {
      w.text(`Enlarged: about ${Math.round(row.detailPpi)} PPI of real detail (see the notes for this file).`, {
        size: 8.5,
        color: MUTED,
        indent: 110,
        gap: 2,
      });
    }
  }
  w.y -= 8;

  w.text('The files', { size: 13, font: bold, gap: 6 });
  for (const f of guide.files) {
    w.rule();
    w.text(f.fileName, { size: 9.5, font: mono, gap: 2 });
    const where = f.upload === f.fileName ? '' : ` · inside ${f.upload}`;
    w.text(`${f.shape} · ${f.widthPx.toLocaleString('en-US')} × ${f.heightPx.toLocaleString('en-US')} px · ${mb(f.bytes)}${where}`, {
      size: 9.5,
      color: MUTED,
      gap: 4,
    });
    if (f.sharp.length) {
      w.text(`Prints sharply (300 PPI) at: ${f.sharp.map((s) => s.label).join(', ')}`, { gap: 3 });
    } else {
      w.text('No standard size of this shape prints at a full 300 PPI from this artwork.', { gap: 3 });
    }
    if (f.enlarged.length) {
      const list = f.enlarged.map((s) => `${s.label} (about ${Math.round(s.detailPpi)} PPI)`).join(', ');
      w.text(
        `Also printable, with less detail: ${list}. The original artwork has enough detail for ` +
          `${formatInches(f.nativeMax.widthIn)} × ${formatInches(f.nativeMax.heightIn)} in at 300 PPI. ` +
          'This file was enlarged to reach these sizes, and enlarging does not add detail: prints may look softer up close.',
        { color: MUTED, gap: 3 },
      );
    }
  }

  return doc.save();
}
