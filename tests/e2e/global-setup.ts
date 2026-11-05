import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { REPORT_PATH } from './helpers';

export default function globalSetup() {
  execFileSync('node', ['scripts/make-fixtures.mjs'], { stdio: 'inherit' });
  rmSync(REPORT_PATH, { force: true });
}
