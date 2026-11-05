/**
 * Baseline JPEG encoder that takes the image a strip of rows at a time, so a
 * huge export never needs to exist as one canvas or one pixel buffer. Used
 * when an export is bigger than the browser's canvas limit (about 16.7 MP in
 * iOS Safari) or when the browser can't encode JPEG itself.
 *
 * Output: JFIF, YCbCr 4:2:0, standard Annex K Huffman tables, libjpeg-style
 * quality scaling, density set in dots per inch.
 */

// Natural (row-major) index → zigzag position.
const ZIGZAG = [
  0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18,
  24, 31, 40, 44, 53, 10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60, 21, 34, 37,
  47, 50, 56, 59, 61, 35, 36, 48, 49, 57, 58, 62, 63,
];

const STD_LUMA_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14,
  17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49,
  64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

const STD_CHROMA_Q = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47,
  66, 99, 99, 99, 99, 99, 99, ...new Array<number>(32).fill(99),
];

// Huffman tables: counts of codes of length 1..16, then symbols.
export const DC_LUMA_COUNTS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
export const DC_CHROMA_COUNTS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
export const DC_SYMBOLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export const AC_LUMA_COUNTS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
export const AC_LUMA_SYMBOLS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

export const AC_CHROMA_COUNTS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
export const AC_CHROMA_SYMBOLS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

/** AAN DCT scale factors. */
const AASF = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961, 0.275899379];

type HuffTable = { codes: Uint16Array; lengths: Uint8Array };

export function buildHuffman(counts: number[], symbols: number[]): HuffTable {
  const codes = new Uint16Array(256);
  const lengths = new Uint8Array(256);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) {
      codes[symbols[k]] = code;
      lengths[symbols[k]] = len;
      k++;
      code++;
    }
    code <<= 1;
  }
  return { codes, lengths };
}

const HT = {
  dcY: buildHuffman(DC_LUMA_COUNTS, DC_SYMBOLS),
  acY: buildHuffman(AC_LUMA_COUNTS, AC_LUMA_SYMBOLS),
  dcC: buildHuffman(DC_CHROMA_COUNTS, DC_SYMBOLS),
  acC: buildHuffman(AC_CHROMA_COUNTS, AC_CHROMA_SYMBOLS),
};

/** libjpeg quality scaling. Returns the table in zigzag order. */
function scaleQuant(base: number[], quality: number): Uint8Array {
  const q = Math.min(100, Math.max(1, Math.round(quality * 100)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    out[ZIGZAG[i]] = Math.min(255, Math.max(1, Math.floor((base[i] * scale + 50) / 100)));
  }
  return out;
}

/** Divisors for the float DCT, natural order. */
function divisors(zigzagTable: Uint8Array): Float64Array {
  const out = new Float64Array(64);
  for (let i = 0; i < 64; i++) {
    out[i] = 1 / (zigzagTable[ZIGZAG[i]] * AASF[i >> 3] * AASF[i & 7] * 8);
  }
  return out;
}

const CHUNK = 1 << 20;

export class StripJpegEncoder {
  readonly width: number;
  readonly height: number;
  private readonly parts: Uint8Array[] = [];
  private buf = new Uint8Array(CHUNK);
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;
  private readonly qY: Uint8Array;
  private readonly qC: Uint8Array;
  private readonly fY: Float64Array;
  private readonly fC: Float64Array;
  private dcY = 0;
  private dcCb = 0;
  private dcCr = 0;
  /** 16 rows of RGBA waiting to be encoded as one MCU row. */
  private readonly band: Uint8ClampedArray;
  private bandRows = 0;
  private rowsIn = 0;
  private finished = false;
  // Scratch buffers.
  private readonly block = new Float64Array(64);
  private readonly quant = new Int32Array(64);
  private readonly mY = new Float64Array(256);
  private readonly mCb = new Float64Array(256);
  private readonly mCr = new Float64Array(256);

  constructor(width: number, height: number, quality = 0.92, dpi = 300) {
    if (width < 1 || height < 1 || width > 65535 || height > 65535) {
      throw new Error(`JPEG can't be ${width} × ${height} px`);
    }
    this.width = width;
    this.height = height;
    this.qY = scaleQuant(STD_LUMA_Q, quality);
    this.qC = scaleQuant(STD_CHROMA_Q, quality);
    this.fY = divisors(this.qY);
    this.fC = divisors(this.qC);
    this.band = new Uint8ClampedArray(width * 16 * 4);
    this.writeHeaders(dpi);
  }

  /** Append `rows` rows of RGBA pixels (alpha is ignored). */
  addRows(rgba: Uint8ClampedArray | Uint8Array, rows: number): void {
    if (this.finished) throw new Error('Encoder already finished');
    if (this.rowsIn + rows > this.height) throw new Error('Too many rows');
    const rowBytes = this.width * 4;
    if (rgba.length < rows * rowBytes) throw new Error('Not enough pixel data');
    for (let r = 0; r < rows; r++) {
      this.band.set(rgba.subarray(r * rowBytes, (r + 1) * rowBytes), this.bandRows * rowBytes);
      this.bandRows++;
      this.rowsIn++;
      if (this.bandRows === 16) {
        this.encodeBand(16);
        this.bandRows = 0;
      }
    }
  }

  /** Flush and return the finished file as chunks (pass to `new Blob(parts)`). */
  finish(): Uint8Array[] {
    if (this.finished) return this.parts;
    if (this.rowsIn !== this.height) {
      throw new Error(`Expected ${this.height} rows, got ${this.rowsIn}`);
    }
    if (this.bandRows > 0) this.encodeBand(this.bandRows);
    if (this.bitCnt > 0) this.putBits((1 << (8 - this.bitCnt)) - 1, 8 - this.bitCnt);
    this.writeWord(0xffd9);
    this.parts.push(this.buf.subarray(0, this.pos));
    this.finished = true;
    return this.parts;
  }

  // --- output ------------------------------------------------------------

  private writeByte(b: number) {
    if (this.pos === this.buf.length) {
      this.parts.push(this.buf);
      this.buf = new Uint8Array(CHUNK);
      this.pos = 0;
    }
    this.buf[this.pos++] = b;
  }

  private writeWord(w: number) {
    this.writeByte((w >> 8) & 0xff);
    this.writeByte(w & 0xff);
  }

  private putBits(code: number, len: number) {
    this.bitBuf = ((this.bitBuf << len) | code) >>> 0;
    this.bitCnt += len;
    while (this.bitCnt >= 8) {
      const b = (this.bitBuf >>> (this.bitCnt - 8)) & 0xff;
      this.writeByte(b);
      if (b === 0xff) this.writeByte(0);
      this.bitCnt -= 8;
    }
    this.bitBuf &= (1 << this.bitCnt) - 1;
  }

  private writeHeaders(dpi: number) {
    this.writeWord(0xffd8); // SOI
    // APP0 JFIF
    this.writeWord(0xffe0);
    this.writeWord(16);
    for (const c of [0x4a, 0x46, 0x49, 0x46, 0x00]) this.writeByte(c);
    this.writeWord(0x0101); // version 1.1
    this.writeByte(1); // units: dpi
    this.writeWord(dpi);
    this.writeWord(dpi);
    this.writeWord(0); // no thumbnail
    // DQT
    this.writeWord(0xffdb);
    this.writeWord(2 + 2 * 65);
    this.writeByte(0);
    for (const v of this.qY) this.writeByte(v);
    this.writeByte(1);
    for (const v of this.qC) this.writeByte(v);
    // SOF0
    this.writeWord(0xffc0);
    this.writeWord(17);
    this.writeByte(8);
    this.writeWord(this.height);
    this.writeWord(this.width);
    this.writeByte(3);
    for (const [id, sampling, table] of [
      [1, 0x22, 0],
      [2, 0x11, 1],
      [3, 0x11, 1],
    ]) {
      this.writeByte(id);
      this.writeByte(sampling);
      this.writeByte(table);
    }
    // DHT
    const tables: [number, number[], number[]][] = [
      [0x00, DC_LUMA_COUNTS, DC_SYMBOLS],
      [0x10, AC_LUMA_COUNTS, AC_LUMA_SYMBOLS],
      [0x01, DC_CHROMA_COUNTS, DC_SYMBOLS],
      [0x11, AC_CHROMA_COUNTS, AC_CHROMA_SYMBOLS],
    ];
    this.writeWord(0xffc4);
    this.writeWord(2 + tables.reduce((n, [, c, s]) => n + 1 + c.length + s.length, 0));
    for (const [cls, counts, symbols] of tables) {
      this.writeByte(cls);
      for (const c of counts) this.writeByte(c);
      for (const s of symbols) this.writeByte(s);
    }
    // SOS
    this.writeWord(0xffda);
    this.writeWord(12);
    this.writeByte(3);
    for (const [id, tables2] of [
      [1, 0x00],
      [2, 0x11],
      [3, 0x11],
    ]) {
      this.writeByte(id);
      this.writeByte(tables2);
    }
    this.writeByte(0);
    this.writeByte(63);
    this.writeByte(0);
  }

  // --- encoding ----------------------------------------------------------

  private encodeBand(rows: number) {
    const w = this.width;
    const band = this.band;
    const { mY, mCb, mCr, block } = this;
    for (let mx = 0; mx < w; mx += 16) {
      // Colour-convert the 16×16 macroblock, repeating edge pixels as padding.
      for (let y = 0; y < 16; y++) {
        const rowOff = Math.min(y, rows - 1) * w;
        for (let x = 0; x < 16; x++) {
          const p = (rowOff + Math.min(mx + x, w - 1)) * 4;
          const r = band[p];
          const g = band[p + 1];
          const b = band[p + 2];
          const i = y * 16 + x;
          mY[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          mCb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          mCr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      for (let by = 0; by < 16; by += 8) {
        for (let bx = 0; bx < 16; bx += 8) {
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) block[y * 8 + x] = mY[(by + y) * 16 + bx + x];
          }
          this.dcY = this.encodeBlock(block, this.fY, this.dcY, HT.dcY, HT.acY);
        }
      }
      for (const [plane, which] of [
        [mCb, 0],
        [mCr, 1],
      ] as const) {
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const i = y * 32 + x * 2;
            block[y * 8 + x] = (plane[i] + plane[i + 1] + plane[i + 16] + plane[i + 17]) / 4;
          }
        }
        if (which === 0) this.dcCb = this.encodeBlock(block, this.fC, this.dcCb, HT.dcC, HT.acC);
        else this.dcCr = this.encodeBlock(block, this.fC, this.dcCr, HT.dcC, HT.acC);
      }
    }
  }

  /** Forward DCT + quantise + Huffman-code one 8×8 block. Returns the new DC predictor. */
  private encodeBlock(d: Float64Array, fdiv: Float64Array, prevDc: number, dc: HuffTable, ac: HuffTable): number {
    fdct(d);
    const q = this.quant;
    for (let i = 0; i < 64; i++) {
      const v = d[i] * fdiv[i];
      q[ZIGZAG[i]] = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0;
    }

    const diff = q[0] - prevDc;
    if (diff === 0) {
      this.putBits(dc.codes[0], dc.lengths[0]);
    } else {
      const [size, bits] = category(diff);
      this.putBits(dc.codes[size], dc.lengths[size]);
      this.putBits(bits, size);
    }

    let end = 63;
    while (end > 0 && q[end] === 0) end--;
    if (end === 0) {
      this.putBits(ac.codes[0x00], ac.lengths[0x00]);
      return q[0];
    }
    let i = 1;
    while (i <= end) {
      const start = i;
      while (q[i] === 0 && i <= end) i++;
      let zeros = i - start;
      while (zeros >= 16) {
        this.putBits(ac.codes[0xf0], ac.lengths[0xf0]);
        zeros -= 16;
      }
      const [size, bits] = category(q[i]);
      const sym = (zeros << 4) | size;
      this.putBits(ac.codes[sym], ac.lengths[sym]);
      this.putBits(bits, size);
      i++;
    }
    if (end !== 63) this.putBits(ac.codes[0x00], ac.lengths[0x00]);
    return q[0];
  }
}

/** JPEG magnitude category and its bit pattern. */
function category(v: number): [number, number] {
  const a = v < 0 ? -v : v;
  const size = 32 - Math.clz32(a);
  return [size, v < 0 ? v + (1 << size) - 1 : v];
}

/** In-place AAN float forward DCT (as in libjpeg's jfdctflt.c), unscaled. */
function fdct(d: Float64Array) {
  for (let pass = 0; pass < 2; pass++) {
    const step = pass === 0 ? 1 : 8;
    const stride = pass === 0 ? 8 : 1;
    for (let k = 0; k < 8; k++) {
      const o = k * stride;
      const d0 = d[o];
      const d1 = d[o + step];
      const d2 = d[o + 2 * step];
      const d3 = d[o + 3 * step];
      const d4 = d[o + 4 * step];
      const d5 = d[o + 5 * step];
      const d6 = d[o + 6 * step];
      const d7 = d[o + 7 * step];

      const t0 = d0 + d7;
      const t7 = d0 - d7;
      const t1 = d1 + d6;
      const t6 = d1 - d6;
      const t2 = d2 + d5;
      const t5 = d2 - d5;
      const t3 = d3 + d4;
      const t4 = d3 - d4;

      let t10 = t0 + t3;
      const t13 = t0 - t3;
      let t11 = t1 + t2;
      let t12 = t1 - t2;
      d[o] = t10 + t11;
      d[o + 4 * step] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      d[o + 2 * step] = t13 + z1;
      d[o + 6 * step] = t13 - z1;

      t10 = t4 + t5;
      t11 = t5 + t6;
      t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433;
      const z2 = 0.5411961 * t10 + z5;
      const z4 = 1.306562965 * t12 + z5;
      const z3 = t11 * 0.707106781;
      const z11 = t7 + z3;
      const z13 = t7 - z3;
      d[o + 5 * step] = z13 + z2;
      d[o + 3 * step] = z13 - z2;
      d[o + step] = z11 + z4;
      d[o + 7 * step] = z11 - z4;
    }
  }
}
