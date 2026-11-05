/**
 * Upload limits for a digital listing. Keep marketplace rules here, in one
 * place, so they're easy to update when the marketplace changes them.
 */
export interface UploadLimits {
  marketplace: string;
  /** Files a buyer can download from one listing. */
  maxFiles: number;
  /** Largest single upload, in bytes. */
  maxBytesPerFile: number;
  /** Where the limits come from, and when they were last checked. */
  source: string;
  checked: string;
}

/**
 * Etsy help center, "How to Manage Your Digital Listings": up to five files,
 * 20 MB each. "20 MB" is read as 20,000,000 bytes, the stricter reading.
 */
export const ETSY_LIMITS: UploadLimits = {
  marketplace: 'Etsy',
  maxFiles: 5,
  maxBytesPerFile: 20_000_000,
  source: 'https://help.etsy.com/hc/en-us/articles/115015628347-How-to-Manage-Your-Digital-Listings',
  checked: '2026-11-05',
};

/** ?maxUploads=3&maxUploadMB=1.5 override the limits (for testing). */
export function limitsFromSearch(search: string, base: UploadLimits = ETSY_LIMITS): UploadLimits {
  const params = new URLSearchParams(search);
  const files = Number(params.get('maxUploads'));
  const mb = Number(params.get('maxUploadMB'));
  return {
    ...base,
    maxFiles: Number.isInteger(files) && files > 0 ? files : base.maxFiles,
    maxBytesPerFile: mb > 0 ? Math.round(mb * 1_000_000) : base.maxBytesPerFile,
  };
}

/**
 * 20000000 → "20 MB", 20040000 → "20.04 MB", 2481 → "2 KB". Decimal units, as
 * marketplaces quote them; two decimals so a file just over a limit never
 * looks equal to it.
 */
export function formatMB(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  const mb = bytes / 1_000_000;
  if (Number.isInteger(mb)) return `${mb} MB`;
  return `${mb.toFixed(2)} MB`;
}
