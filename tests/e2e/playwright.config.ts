import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  // One retry covers transient dev-server flakes (Next.js compile races,
  // boot-seed lock contention, occasional ERR_CONNECTION_RESET when the
  // dev server is rebuilding a route while a test navigates to it).
  retries: 1,
  // Run serially. Boot-seed + ERC-1271 chain reads + Next.js dev compile
  // saturate a single dev server; parallel workers race on the deployer
  // wallet's nonce manager, the dev compiler queue, and the JSON cache,
  // surfacing as transient "Unexpected end of JSON input" / nonce errors.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  reporter: [['list']],
})
