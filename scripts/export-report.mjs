// Prints the exports measured by the Playwright run as a Markdown table.
import { readFileSync } from 'node:fs';

const rows = readFileSync('test-results/export-report.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

const mb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(0)} KB`);
console.log('| Browser | Source | Output | Pixels | File size | DPI tag | Time |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) {
  const px = r.format === 'zip' ? `${r.entries} files` : `${r.width} × ${r.height}`;
  const dpi = r.dpi ? `${r.dpi.x}` : r.format === 'zip' ? '' : 'missing';
  const time = r.ms ? `${(r.ms / 1000).toFixed(1)} s` : '';
  const out = r.zip ? `↳ ${r.name}` : r.name;
  console.log(`| ${r.browser ?? ''} | ${r.source} (${mb(r.sourceBytes)}) | ${out} | ${px} | ${mb(r.bytes)} | ${dpi} | ${time} |`);
}
