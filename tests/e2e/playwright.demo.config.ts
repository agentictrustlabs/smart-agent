import { defineConfig } from '@playwright/test'

/**
 * Customer-demo Playwright config — produces a polished mp4 of the
 * full grant lifecycle (pool → round → award → attest → release).
 *
 * Differs from playwright.config.ts:
 *   • testMatch limited to grant-flow-demo.spec.ts
 *   • no retries — the demo run is meant to be replayed manually, not
 *     gated in CI, and a retried failure pollutes the output dir
 *   • global video OFF — the test manages its own video context so
 *     the pre-warm phase doesn't leak blank/compile frames
 *   • larger viewport for high-quality video frames
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['grant-flow-demo.spec.ts', 'grant-flow-full-ui-demo.spec.ts'],
  timeout: 1_800_000, // 30 min — beforeAll pre-warm + bootstrap + full UI walk on a cold dev server
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
    // Default is Infinity — a single mis-matched locator (e.g. selectOption
    // by label when the dropdown text is a slug) hangs the entire test.
    // 30s is plenty for a real action; anything longer is a bug.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  outputDir: './demo-output',
  reporter: [['list']],
})
