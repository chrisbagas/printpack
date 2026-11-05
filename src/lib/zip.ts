import { zipSync, type Zippable } from 'fflate';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Package files into a ZIP. JPGs are already compressed, so entries are
 * stored as-is (level 0): smaller CPU cost, same size.
 */
export function buildZip(entries: ZipEntry[], mtime = new Date()): Uint8Array {
  const files: Zippable = {};
  for (const { name, data } of entries) {
    let unique = name;
    for (let n = 2; unique in files; n++) unique = name.replace(/(\.[^.]+)?$/, `-${n}$1`);
    files[unique] = [data, { level: 0, mtime }];
  }
  return zipSync(files);
}
