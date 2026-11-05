import { existsSync } from 'node:fs';
import { chromium, defineConfig, firefox, webkit, type BrowserType } from '@playwright/test';

/**
 * One project per browser engine. A browser that isn't installed is skipped
 * with a note instead of failing the run; set BROWSERS=chromium,firefox to
 * choose explicitly (an explicitly requested browser that is missing fails).
 */
const ALL: Record<string, BrowserType> = { chromium, firefox, webkit };
const requested = process.env.BROWSERS?.split(',').map((s) => s.trim()).filter(Boolean);
const names = requested ?? Object.keys(ALL);
const installed = names.filter((name) => {
  const type = ALL[name];
  if (!type) throw new Error(`Unknown browser "${name}" in BROWSERS`);
  const ok = existsSync(type.executablePath());
  if (!ok && !requested && !process.env.PRINTPACK_QUIET) {
    console.warn(`[playwright] ${name} is not installed; skipping it (npx playwright install ${name}).`);
  }
  return ok || !!requested;
});

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4173',
    acceptDownloads: true,
    viewport: { width: 1360, height: 900 },
  },
  projects: installed.map((name) => ({ name, use: { browserName: name as 'chromium' | 'firefox' | 'webkit' } })),
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
