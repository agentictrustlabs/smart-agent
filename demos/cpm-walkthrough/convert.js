#!/usr/bin/env node
/**
 * Converts the Playwright webm recording to MP4 (Trupeer-compatible).
 * Run after the Playwright test: node demos/cpm-walkthrough/convert.js
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ffmpeg = require('ffmpeg-static')
const input = path.resolve(__dirname, 'output/record.ts-CPM-Demo-Walkthrough/video.webm')
const output = path.resolve(__dirname, 'output/cpm-demo.mp4')

if (!fs.existsSync(input)) {
  console.error('No recording found. Run the Playwright test first:')
  console.error('  npx playwright test --config demos/cpm-walkthrough/playwright.config.ts')
  process.exit(1)
}

console.log('Converting webm → mp4...')
execSync(`"${ffmpeg}" -i "${input}" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -movflags +faststart "${output}" -y`, { stdio: 'inherit' })
console.log(`Done: ${output}`)
console.log(`Size: ${(fs.statSync(output).size / 1024 / 1024).toFixed(1)} MB`)
