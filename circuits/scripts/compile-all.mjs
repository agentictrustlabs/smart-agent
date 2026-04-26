#!/usr/bin/env node
/**
 * Compile every .circom under circuits/src/ into r1cs + wasm + sym.
 *
 * Outputs land in circuits/build/<circuit-name>/ — gitignored so each
 * dev box rebuilds locally. CI is responsible for re-deriving the
 * Solidity verifier and committing it under packages/contracts/src/zk/.
 */
import { execSync } from 'node:child_process'
import { readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SRC = join(ROOT, 'src')
const BUILD = join(ROOT, 'build')
const BIN = join(ROOT, 'bin', 'circom')

if (!existsSync(BIN)) {
  console.error(`✗ circom binary missing at ${BIN}`)
  console.error(`  Run the install step from circuits/README.md.`)
  process.exit(1)
}

const sources = readdirSync(SRC).filter(f => f.endsWith('.circom'))
if (sources.length === 0) {
  console.error('✗ no .circom files under circuits/src/')
  process.exit(1)
}

for (const src of sources) {
  const name = basename(src, '.circom')
  const outDir = join(BUILD, name)
  mkdirSync(outDir, { recursive: true })
  const cmd = `${BIN} ${join(SRC, src)} --r1cs --wasm --sym -o ${outDir} -l ${join(ROOT, 'node_modules')}`
  console.log(`→ ${cmd}`)
  try {
    execSync(cmd, { stdio: 'inherit' })
  } catch {
    console.error(`✗ compile failed for ${src}`)
    process.exit(1)
  }
  console.log(`  ✓ ${outDir}`)
}
