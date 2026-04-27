/**
 * H3 + Poseidon-Merkle helpers shared by the geo seed (publishing the
 * h3CoverageRoot for a feature) and the holder wallet's ZK prover
 * (building the witness path that proves their private cell sits
 * under that root).
 *
 * Bound to the same primitives the GeoH3Inclusion Circom
 * circuit uses:
 *   • H3 res-6 covering cells, sorted by their H3 string id (ascending).
 *   • Poseidon-1(cell) leaf hash.
 *   • Poseidon-2(left, right) inner node hash.
 *   • Padded with zero leaves up to the next power of two, then
 *     fixed-depth (default 16) so prover and verifier agree on path
 *     length without dynamic depth signaling.
 *
 * Why H3 res-6 (not res-8) for the coverage tree?
 *   res-6 cells average ~36 km² — most cities are 1–50 cells. The
 *   holder's private cell at res-8 (~0.7 km²) projects up to res-6 via
 *   h3ToParent in the circuit, then proves Merkle membership against
 *   the city's res-6 coverage root. This gives the verifier a coarse
 *   neighborhood-block resolution check without ever revealing the
 *   street-block cell.
 */

import { keccak256, toBytes } from 'viem'

/** Lazy-loaded poseidon instance. circomlibjs builds the constants on
 *  first call (~80ms) so we cache and reuse. */
let _poseidonInstance: ((inputs: bigint[]) => bigint) | null = null
async function poseidon(): Promise<(inputs: bigint[]) => bigint> {
  if (_poseidonInstance) return _poseidonInstance
  // Dynamic import — avoids browser bundles paying the cost when geo
  // matching isn't used. circomlibjs ships without TS types so we
  // accept `any` at the import boundary and re-type our public
  // surface above.
  // @ts-expect-error — circomlibjs has no @types package
  const mod = await import('circomlibjs') as { buildPoseidon: () => Promise<{
    (inputs: bigint[]): unknown
    F: { toObject: (x: unknown) => bigint }
  }> }
  const p = await mod.buildPoseidon()
  _poseidonInstance = (inputs: bigint[]) => p.F.toObject(p(inputs))
  return _poseidonInstance
}

/**
 * Convert an H3 cell string id (e.g. "8628308a3ffffff") to a bigint
 * compatible with the Num2Bits decomposition in the circuit.
 */
export function h3StringToBigint(h3id: string): bigint {
  // H3 ids are 16-hex-char (64-bit) numbers, sometimes with leading 0x.
  const hex = h3id.startsWith('0x') ? h3id.slice(2) : h3id
  return BigInt('0x' + hex.padStart(16, '0'))
}

/** Inverse for debugging. */
export function bigintToH3String(n: bigint): string {
  return n.toString(16).padStart(16, '0')
}

export interface CoverageMerkleTree {
  root: bigint
  /** Leaf-level data: one entry per padded leaf (cells then zero pads). */
  leaves: bigint[]
  /** Each level's array, [0] = leaf hashes, [depth] = root. */
  layers: bigint[][]
  /** Tree depth (must match the Circom MERKLE_DEPTH). */
  depth: number
}

/** Pad to next power of two. */
function nextPow2(n: number): number {
  if (n <= 1) return 1
  return 1 << Math.ceil(Math.log2(n))
}

/**
 * Build a Poseidon Merkle tree over the supplied H3 res-6 cells.
 *
 *   Sort cells ascending by their numeric value so two clients
 *   independently constructing the tree from the same set produce
 *   the same root (canonical encoding).
 *
 *   `depth` defaults to 16 to match the circuit's
 *   `GeoH3Inclusion(16)`.
 */
export async function buildCoverageMerkleTree(
  cells: string[],
  depth = 16,
): Promise<CoverageMerkleTree> {
  const p = await poseidon()
  const numbers = cells.map(h3StringToBigint).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const targetLeafCount = Math.max(2, nextPow2(numbers.length))
  const padded = [...numbers]
  while (padded.length < targetLeafCount) padded.push(0n)

  const leafLayer = padded.map(c => p([c]))
  const layers: bigint[][] = [leafLayer]
  let cur = leafLayer
  while (cur.length > 1) {
    const next: bigint[] = []
    for (let i = 0; i < cur.length; i += 2) {
      next.push(p([cur[i], cur[i + 1]]))
    }
    layers.push(next)
    cur = next
  }

  // Pad up to fixed `depth`. Each padding iteration combines the
  // current root with a zero-subtree sibling at the same height, then
  // promotes the result to the next level. Two invariants make
  // proveMembership and the Circom circuit agree on what to climb:
  //
  //   1. The sibling hash MUST equal the Poseidon root of an all-zero
  //      subtree of the same height as the running root being padded.
  //      Off-by-one here was the bug: zeroHashAtLayer(level) returns
  //      the root of a height-`level` subtree, so when we promote
  //      from level L to L+1 the sibling must be zeroHashAtLayer(L).
  //   2. The padded layer must store BOTH children (root + zero
  //      sibling) so proveMembership's `layer[idx+1]` lookup yields
  //      the same sibling. Storing only [newRoot] would force callers
  //      to special-case padded levels.
  let root = layers[layers.length - 1][0]
  while (layers.length - 1 < depth) {
    const heightOfRoot = layers.length - 1
    const sibling = await zeroHashAtLayer(heightOfRoot, p)
    // Update the existing top layer to expose the sibling beside the
    // root. proveMembership reads layer[1] as the sibling for idx=0.
    layers[layers.length - 1] = [root, sibling]
    root = p([root, sibling])
    layers.push([root])
  }

  return { root, leaves: padded, layers, depth }
}

/** Hash of an all-zero subtree of height `level` — used for padding. */
async function zeroHashAtLayer(level: number, p: (inputs: bigint[]) => bigint): Promise<bigint> {
  let h = p([0n])  // leaf-level zero (height 0)
  for (let i = 1; i <= level; i++) h = p([h, h])
  return h
}

export interface MerkleProof {
  /** index of the leaf in the padded leaf layer */
  index: number
  /** sibling values bottom-up (length = depth) */
  path: bigint[]
  /** 0/1 selectors for each level: 0 = leaf is left, 1 = leaf is right */
  pathIndices: number[]
  /** the leaf hash (Poseidon1 of the cell) */
  leaf: bigint
}

/**
 * Produce the Merkle inclusion proof for an H3 res-6 cell present in
 * the tree. Throws if the cell isn't covered.
 */
export async function proveMembership(
  tree: CoverageMerkleTree,
  res6Cell: string,
): Promise<MerkleProof> {
  const target = h3StringToBigint(res6Cell)
  const leafIndex = tree.leaves.indexOf(target)
  if (leafIndex < 0) throw new Error(`cell ${res6Cell} not in coverage tree`)

  const path: bigint[] = []
  const pathIndices: number[] = []
  let idx = leafIndex
  for (let level = 0; level < tree.depth; level++) {
    const layer = tree.layers[level] ?? null
    const sibling = layer
      ? (idx % 2 === 0 ? layer[idx + 1] : layer[idx - 1]) ?? 0n
      : 0n
    path.push(sibling ?? 0n)
    pathIndices.push(idx % 2)
    idx = Math.floor(idx / 2)
  }

  const p = await poseidon()
  return {
    index: leafIndex,
    path,
    pathIndices,
    leaf: p([target]),
  }
}

/**
 * Helper: encode the ZK circuit's policyId field (a single field
 * element) from the canonical policy string. The circuit expects a
 * field-fitting integer; we keccak the string and downsize via mod.
 *
 * The Solidity verifier and the holder side compute this exactly the
 * same way so the public `policyId` matches.
 */
export const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
export function encodePolicyId(policyId: string): bigint {
  const k = keccak256(toBytes(policyId)) as `0x${string}`
  return BigInt(k) % FIELD_PRIME
}
