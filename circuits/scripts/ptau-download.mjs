#!/usr/bin/env node
/**
 * Download the Hermez Powers-of-Tau ceremony file we use for groth16
 * trusted setup (`pot15_final.ptau`, ~36 MB).
 *
 * One-time per dev box. The file is gitignored — re-running is idempotent.
 */
import { existsSync, createWriteStream, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PTAU_DIR = resolve(__dirname, '..', 'ptau')
const FILE = join(PTAU_DIR, 'pot15_final.ptau')
const URL = 'https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau'

if (existsSync(FILE)) {
  const sz = statSync(FILE).size
  console.log(`✓ ${FILE} (${(sz / 1e6).toFixed(1)} MB) already present`)
  process.exit(0)
}

console.log(`→ GET ${URL}`)
const res = await fetch(URL)
if (!res.ok) {
  console.error(`✗ download failed: ${res.status} ${res.statusText}`)
  process.exit(1)
}
await pipeline(res.body, createWriteStream(FILE))
console.log(`  ✓ ${FILE} (${(statSync(FILE).size / 1e6).toFixed(1)} MB)`)
