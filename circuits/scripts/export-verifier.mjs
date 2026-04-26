#!/usr/bin/env node
/**
 * Run the groth16 setup for a circuit and export the Solidity verifier
 * to packages/contracts/src/zk/<Circuit>Verifier.sol.
 *
 *   npx node scripts/export-verifier.mjs <circuit-name>
 *
 * Prereqs (see circuits/README.md): compile-all already run, ptau file
 * downloaded, snarkjs available via @smart-agent/circuits.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as snarkjs from 'snarkjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(ROOT, '..')

const name = process.argv[2]
if (!name) {
  console.error('usage: export-verifier <circuit-name>')
  process.exit(2)
}

const buildDir = join(ROOT, 'build', name)
const ptau = join(ROOT, 'ptau', 'pot15_final.ptau')
const r1cs = join(buildDir, `${name}.r1cs`)
const zkey0 = join(buildDir, `${name}_0000.zkey`)
const zkey1 = join(buildDir, `${name}_final.zkey`)

if (!existsSync(r1cs)) {
  console.error(`✗ ${r1cs} missing — run \`pnpm --filter @smart-agent/circuits compile\` first`)
  process.exit(1)
}
if (!existsSync(ptau)) {
  console.error(`✗ ${ptau} missing — run \`pnpm --filter @smart-agent/circuits ptau:download\` first`)
  process.exit(1)
}

console.log(`→ groth16 setup for ${name}`)
await snarkjs.zKey.newZKey(r1cs, ptau, zkey0)

console.log(`→ contributing to phase-2 ceremony (dev-only entropy)`)
await snarkjs.zKey.contribute(zkey0, zkey1, `dev-${Date.now()}`, 'dev-only entropy — DO NOT use in prod')

console.log(`→ exporting Solidity verifier`)
// snarkjs needs the EJS template passed in as { groth16: <text> }.
// snarkjs's package.json doesn't export './package.json' subpath, so
// resolve via the symlink under circuits/node_modules.
const { readFileSync, readdirSync } = await import('node:fs')
const snarkjsRoot = resolve(ROOT, 'node_modules', 'snarkjs')
let templatesDir = join(snarkjsRoot, 'templates')
let groth16Tpl
try {
  groth16Tpl = readFileSync(join(templatesDir, 'verifier_groth16.sol.ejs'), 'utf-8')
} catch {
  // Fallback: walk the snarkjs install for the template (some pnpm
  // layouts hide it under build/).
  const candidates = readdirSync(snarkjsRoot, { recursive: true })
  const hit = candidates.find(p => typeof p === 'string' && p.endsWith('verifier_groth16.sol.ejs'))
  if (!hit) throw new Error('verifier_groth16.sol.ejs template not found in snarkjs')
  groth16Tpl = readFileSync(join(snarkjsRoot, hit), 'utf-8')
}
const sol = await snarkjs.zKey.exportSolidityVerifier(zkey1, { groth16: groth16Tpl })

const dest = join(REPO_ROOT, 'packages', 'contracts', 'src', 'zk')
mkdirSync(dest, { recursive: true })
const className = `${name.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('')}Verifier`
const outFile = join(dest, `${className}.sol`)

// Rename the contract so multiple verifiers can coexist.
const renamed = sol
  .replace(/contract Groth16Verifier\b/g, `contract ${className}`)
  .replace(/^pragma solidity .+;$/m, 'pragma solidity ^0.8.28;')

const { writeFileSync } = await import('node:fs')
writeFileSync(outFile, renamed)
console.log(`  ✓ ${outFile}`)

// Also stage a copy in circuits/verifier/ for inspection.
const stage = join(ROOT, 'verifier')
mkdirSync(stage, { recursive: true })
copyFileSync(outFile, join(stage, `${className}.sol`))

// Compatibility hint: the on-chain MatchAgainstPublicGeoSet flow will
// import this verifier by class name. Phase 6 wires the import.
console.log(`\nnext: wire ${className} into MatchAgainstPublicGeoSet`)
