import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildZip } from './zip';

describe('buildZip', () => {
  it('stores files byte-for-byte', () => {
    const a = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const b = new Uint8Array(10_000).map((_, i) => i % 251);
    const zip = buildZip([
      { name: 'a.jpg', data: a },
      { name: 'b.jpg', data: b },
    ]);
    const out = unzipSync(zip);
    expect(Object.keys(out)).toEqual(['a.jpg', 'b.jpg']);
    expect(out['a.jpg']).toEqual(a);
    expect(out['b.jpg']).toEqual(b);
    // Stored, not deflated: archive is slightly larger than its contents.
    expect(zip.length).toBeGreaterThan(a.length + b.length);
  });

  it('never overwrites an entry with the same name', () => {
    const d = new Uint8Array([1]);
    const out = unzipSync(buildZip([
      { name: 'x.jpg', data: d },
      { name: 'x.jpg', data: d },
    ]));
    expect(Object.keys(out)).toEqual(['x.jpg', 'x-2.jpg']);
  });
});
