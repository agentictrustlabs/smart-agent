#!/usr/bin/env node
/**
 * Powers-of-Tau ceremony file for groth16 trusted setup.
 *
 *   The Hermez S3 mirror went 403 in mid-2026, so we run a small
 *   single-party ceremony locally — snarkjs phase 1 with bn128 + 2^15
 *   constraints. This is FINE FOR DEV but NOT for production: a real
 *   multi-party Hermez file should be substituted before any mainnet
 *   verifier deploys.
 *
 * Idempotent: re-running short-circuits if the final ptau exists.
 */
import { existsSync, statSync, renameSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PTAU_DIR = resolve(__dirname, '..', 'ptau')
const POT_PRE   = join(PTAU_DIR, 'pot15_0000.ptau')
const POT_CONTR = join(PTAU_DIR, 'pot15_0001.ptau')
const POT_PREP  = join(PTAU_DIR, 'pot15_prep.ptau')
const POT_FINAL = join(PTAU_DIR, 'pot15_final.ptau')

if (existsSync(POT_FINAL)) {
  const sz = statSync(POT_FINAL).size
  console.log(`✓ ${POT_FINAL} (${(sz / 1e6).toFixed(1)} MB) already present`)
  process.exit(0)
}

const SNARKJS = resolve(__dirname, '..', 'node_modules', '.bin', 'snarkjs')

function run(args, label) {
  console.log(`→ ${label}`)
  execFileSync(SNARKJS, args, { stdio: 'inherit' })
}

run(['powersoftau', 'new', 'bn128', '15', POT_PRE, '-v'], 'phase-1 new (bn128, 2^15)')
run(['powersoftau', 'contribute', POT_PRE, POT_CONTR, '--name=dev', `--entropy=dev-${Date.now()}`, '-v'], 'phase-1 contribute')
run(['powersoftau', 'prepare', 'phase2', POT_CONTR, POT_PREP, '-v'], 'phase-1 prepare phase2')

renameSync(POT_PREP, POT_FINAL)
try { unlinkSync(POT_PRE) } catch { /* ok */ }
try { unlinkSync(POT_CONTR) } catch { /* ok */ }

console.log(`✓ ${POT_FINAL} (${(statSync(POT_FINAL).size / 1e6).toFixed(1)} MB)`)
console.log('  WARNING: dev-only ceremony. Replace with the multi-party Hermez file before any mainnet verifier deploy.')
