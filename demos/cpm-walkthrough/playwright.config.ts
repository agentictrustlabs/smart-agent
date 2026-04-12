import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'record*.ts',
  timeout: 900_000, // 15 minutes for full GAPP-matching demo
  use: {
    baseURL: 'http://localhost:3000',
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
    viewport: { width: 1920, height: 1080 },
    launchOptions: {
      slowMo: 30,
    },
  },
  outputDir: './output',
  reporter: [['list']],
})
