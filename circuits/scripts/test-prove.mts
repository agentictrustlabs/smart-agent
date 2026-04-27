#!/usr/bin/env node
/**
 * End-to-end ZK toolchain test.
 *
 * Uses a synthetic 4-cell coverage set (no h3-js round-trip needed for
 * the toolchain validation; the circuit just constrains the H3 bit
 * pattern of cell→parent and Poseidon Merkle membership). We:
 *
 *   1. Pick a real H3 res-6 cell + its real H3 res-8 child via h3-js
 *      (so the parent-derivation constraints in the circuit hold).
 *   2. Build a Poseidon Merkle tree containing that cell + 3 siblings.
 *   3. Generate a Merkle proof for the cell.
 *   4. Run snarkjs.groth16.fullProve against the compiled wasm + zkey.
 *   5. Verify off-chain via the verification key.
 *   6. Emit the calldata-shape that GeoH3InclusionVerifier expects.
 *
 * Exits 0 only if every step passes. CI / fresh-start can run this as
 * a smoke test that the deployed verifier matches the live circuit.
 */
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as snarkjs from 'snarkjs'
import * as h3 from 'h3-js'
import {
  buildCoverageMerkleTree,
  proveMembership,
  h3StringToBigint,
  encodePolicyId,
} from '../../packages/privacy-creds/src/h3-merkle'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const WASM = join(ROOT, 'build', 'geo-h3-inclusion', 'geo-h3-inclusion_js', 'geo-h3-inclusion.wasm')
const ZKEY = join(ROOT, 'build', 'geo-h3-inclusion', 'geo-h3-inclusion_final.zkey')
const VKEY = join(ROOT, 'build', 'geo-h3-inclusion', 'verification_key.json')

console.log('→ Preparing synthetic coverage set')
// Real H3 res-6 cell over Erie-ish coordinates.
const erieLat = 40.05, erieLon = -105.05
const parentRes6 = h3.latLngToCell(erieLat, erieLon, 6)
const childRes8 = h3.cellToChildren(parentRes6, 8)[0]
console.log(`  parent res-6: ${parentRes6}`)
console.log(`  child  res-8: ${childRes8}`)

// 4-cell coverage = parent + 3 nearby res-6 cells (k-ring).
const coverageCells = h3.gridDisk(parentRes6, 1).slice(0, 4)
console.log(`  coverage cells: ${coverageCells.length}`)

const tree = await buildCoverageMerkleTree(coverageCells, 16)
console.log(`  Merkle root: ${tree.root.toString().slice(0, 24)}…`)

const merkleProof = await proveMembership(tree, parentRes6)

const witness = {
  coverageRoot: tree.root.toString(),
  featureVersion: '1',
  policyId: encodePolicyId('smart-agent.geo-overlap.v1').toString(),
  h3CellRes8: h3StringToBigint(childRes8).toString(),
  h3ParentRes6: h3StringToBigint(parentRes6).toString(),
  merklePath: merkleProof.path.map(s => s.toString()),
  merkleIndices: merkleProof.pathIndices.map(String),
}

console.log('→ Running groth16 fullProve')
const t0 = Date.now()
const { proof, publicSignals } = await snarkjs.groth16.fullProve(witness, WASM, ZKEY)
console.log(`  ✓ proof generated in ${Date.now() - t0}ms`)
console.log(`  publicSignals: [evidenceCommit, coverageRoot, featureVersion, policyId]`)
for (const s of publicSignals) console.log(`    ${s}`)

console.log('→ Off-chain verify')
const vKey = JSON.parse(readFileSync(VKEY, 'utf-8'))
const ok = await snarkjs.groth16.verify(vKey, publicSignals, proof)
if (!ok) { console.error('  ✗ VERIFY FAILED'); process.exit(1) }
console.log('  ✓ verified')

console.log('\n→ Solidity calldata shape (hand-feed to verifier.verifyProof)')
const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)
console.log(calldata.slice(0, 200) + '…')

console.log('\n✓ Toolchain validated end-to-end.')
