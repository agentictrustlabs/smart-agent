/**
 * KMS K4 PR-2 — fixture generator for `KmsSigning.t.sol`.
 *
 * The Foundry test `KmsSigning.t.sol` proves that an AgentAccount accepts
 * a KMS-produced signature via ERC-1271. KMS itself cannot run in CI, so
 * the fixture is a real secp256k1 signature produced by the SAME pipeline
 * as the AWS KMS signer:
 *
 *   • Deterministic test private key (seed: `kms-signer-fixture-v1`).
 *   • Address derived via `keccak256(pubkey[1:]).slice(-20)`.
 *   • Message hash: `keccak256("KMS-K4-PR-2 fixture v1")` — a stable bytes32.
 *   • Sign via `@noble/curves/secp256k1.sign(hash, priv, { lowS: true })`.
 *   • Pack as `r (32) || s (32) || v (1)` with `v = recovery + 27`.
 *
 * The semantic claim of the test: KMS produces byte-identical signatures.
 * AWS KMS Sign over `ECC_SECG_P256K1` + `SigningAlgorithm=ECDSA_SHA_256` +
 * `MessageType=DIGEST` is mathematically equivalent to the local secp256k1
 * signature produced here — same curve, same algorithm, same low-s
 * normalization downstream. The only behavioural difference is that KMS
 * keeps the private key inside the HSM. From the on-chain verifier's
 * perspective the two are indistinguishable.
 *
 * Re-run: `pnpm tsx packages/contracts/test/fixtures/generate-kms-fixture.ts`
 *
 * The output is committed to the repo so CI need not run TypeScript to
 * exercise the Foundry test.
 */
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { SECP256K1_N, SECP256K1_N_HALF } from '@smart-agent/sdk/key-custody'

// Deterministic seed → 32-byte private key.
const SEED = 'kms-signer-fixture-v1'
const PRIV = keccak_256(new TextEncoder().encode(SEED))

const PUB_UNCOMPRESSED = secp256k1.getPublicKey(PRIV, false) // 65 bytes (0x04 || X || Y)
const PUB_RAW = PUB_UNCOMPRESSED.slice(1) // 64 bytes
const ADDR_BYTES = keccak_256(PUB_RAW).slice(-20)
const ADDR = '0x' + Array.from(ADDR_BYTES).map((b) => (b < 16 ? '0' : '') + b.toString(16)).join('')

// Message + hash (matches what an EIP-712 / EIP-191 hash would be — but
// we use a plain keccak here for simplicity; the on-chain ERC-1271 path
// is hash-agnostic).
const MESSAGE_BYTES = new TextEncoder().encode('KMS-K4-PR-2 fixture v1')
const MSG_HASH = keccak_256(MESSAGE_BYTES)
const MSG_HASH_HEX =
  '0x' + Array.from(MSG_HASH).map((b) => (b < 16 ? '0' : '') + b.toString(16)).join('')

// Sign. `lowS: true` makes noble do the EIP-2 normalization; we mirror the
// KMS signer's belt-and-suspenders normalization for safety.
const sig = secp256k1.sign(MSG_HASH, PRIV, { lowS: true })
let s = sig.s
let recovery = sig.recovery
if (s > SECP256K1_N_HALF) {
  s = SECP256K1_N - s
  recovery ^= 1
}

function bigIntTo32Bytes(v: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let x = v
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

const sigBytes = new Uint8Array(65)
sigBytes.set(bigIntTo32Bytes(sig.r), 0)
sigBytes.set(bigIntTo32Bytes(s), 32)
sigBytes[64] = recovery + 27

const SIG_HEX =
  '0x' + Array.from(sigBytes).map((b) => (b < 16 ? '0' : '') + b.toString(16)).join('')

// Also produce a "wrong owner" fixture: same message + signature, but the
// owner address is the keccak of a DIFFERENT public key. The Foundry test
// asserts isValidSignature returns NOT the magic value for this case.
const WRONG_PRIV = keccak_256(new TextEncoder().encode('kms-signer-fixture-wrong-v1'))
const WRONG_PUB = secp256k1.getPublicKey(WRONG_PRIV, false).slice(1)
const WRONG_ADDR_BYTES = keccak_256(WRONG_PUB).slice(-20)
const WRONG_ADDR =
  '0x' + Array.from(WRONG_ADDR_BYTES).map((b) => (b < 16 ? '0' : '') + b.toString(16)).join('')

const fixture = {
  description:
    'KMS-K4-PR-2 fixture: real secp256k1 signature from a deterministic test key; ' +
    'byte-semantically equivalent to AWS KMS Sign output over ECC_SECG_P256K1 + ECDSA_SHA_256 + MessageType=DIGEST.',
  seed: SEED,
  address: ADDR,
  wrongAddress: WRONG_ADDR,
  messageHash: MSG_HASH_HEX,
  signature: SIG_HEX,
  v: recovery + 27,
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, 'kms-signature.json')
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8')
console.log(`[generate-kms-fixture] wrote ${outPath}`)
console.log(`[generate-kms-fixture] address=${ADDR} wrongAddress=${WRONG_ADDR}`)
console.log(`[generate-kms-fixture] messageHash=${MSG_HASH_HEX}`)
console.log(`[generate-kms-fixture] signature=${SIG_HEX}`)
