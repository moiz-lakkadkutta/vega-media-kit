import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  retries: 0, // flakiness is a bug here, not a retry budget
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    browserName: 'chromium',
    baseURL: 'http://localhost:4173',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    // `pnpm exec` always runs from the nearest package.json (the repo root), whatever Playwright's cwd is,
    // so the config path is given from the root and cwd is pinned there explicitly.
    command: 'pnpm exec vite --config harness/vite.config.ts',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://localhost:4173/overlay.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
