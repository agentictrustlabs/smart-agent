/**
 * Local-dev secp256k1 signer (KMS migration K4 — PR-1, §4 of the plan).
 *
 * This is the dev-only signing half of the K4 layering. It is a sibling
 * of `local-aes-provider.ts`, not a replacement: local-aes implements
 * envelope encryption (K1) and is wired through `generateSessionDataKey`/
 * `decryptSessionDataKey`; local-secp256k1 implements `signA2AAction` for
 * the master-EOA path that previously called `privateKeyToAccount` directly
 * in `apps/a2a-agent/src/routes/onchain-redeem.ts`.
 *
 * Behaviour invariant: the address derived from `A2A_MASTER_PRIVATE_KEY`
 * here is byte-identical to `viem.privateKeyToAccount(...).address` for
 * the same hex input. The signature returned for a given digest is also a
 * valid EVM signature recoverable to that address — but byte-equality with
 * viem's signature is NOT guaranteed because:
 *   - viem injects extra entropy by default via `secp256k1.sign(..., { extraEntropy })`,
 *     producing non-deterministic (but still valid) signatures.
 *   - We low-s normalize (EIP-2) per the interface contract; viem also does
 *     this but the underlying ephemeral k differs.
 * Recovered-address parity is the load-bearing property; byte-equality is
 * not.
 *
 * Refuses to operate under `NODE_ENV === 'production'`. The prod signer
 * lands in K4 PR-2 (`aws-kms-signer.ts`).
 *
 * See `KMS-IMPLEMENTATION-PLAN.md` §3 (interface) + K4 PR-1 §4.
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import type { A2AKeyProvider } from './types'

export interface LocalSecp256k1Env {
  /**
   * Hex-encoded 32-byte secp256k1 private key (with or without `0x` prefix).
   * Renamed in K4 PR-1 from `A2A_MASTER_EOA_PRIVATE_KEY`; the "EOA" suffix
   * was inherited from the env-resident era and is misleading for a key
   * that's still an EOA on-chain but resides in KMS in prod.
   */
  A2A_MASTER_PRIVATE_KEY: string
  /**
   * Process `NODE_ENV` — used to refuse instantiation in production. The
   * AWS KMS signer (K4 PR-2) is the prod path; local-secp256k1 in prod is
   * a configuration error and we fail closed at construction.
   */
  NODE_ENV?: string
}

/** Subset of `A2AKeyProvider` that the master-EOA signer implements. */
export interface LocalSecp256k1Signer {
  signA2AAction: NonNullable<A2AKeyProvider['signA2AAction']>
  /**
   * Returns the EVM address (`0x` + 20 bytes) the public key derives to.
   * Cached at construction — secp256k1 key material is immutable per
   * instance.
   */
  getSignerAddress(): Promise<`0x${string}`>
}

// ─── Hex helpers ────────────────────────────────────────────────────
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error('hex string has odd length')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('invalid hex character')
    out[i] = byte
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    s += (b < 16 ? '0' : '') + b.toString(16)
  }
  return s
}

// ─── Canonical "sa:sign:v1" digest (§3 of K4 plan) ──────────────────
const SA_SIGN_V1_PREFIX = new TextEncoder().encode('sa:sign:v1')

/**
 * Build the canonical 32-byte digest the signer hashes when the caller
 * does NOT pass `digest`. Per K4 PR-1 §3:
 *
 *   keccak256(
 *     "sa:sign:v1" || sessionId || accountAddress.toLowerCase()
 *     || chainId || actionId || keccak256(canonicalPayload)
 *   )
 *
 * All variable-length fields are UTF-8 byte sequences concatenated in this
 * exact order. The inner keccak256 over `canonicalPayload` bounds the
 * field's length so an attacker cannot ambiguate the binding tuple by
 * varying payload size.
 */
export function buildCanonicalDigest(input: {
  canonicalPayload: Uint8Array
  accountAddress: string
  chainId: string
  sessionId: string
  actionId: string
}): Uint8Array {
  const enc = new TextEncoder()
  const sessionIdBytes = enc.encode(input.sessionId)
  const accountBytes = enc.encode(input.accountAddress.toLowerCase())
  const chainIdBytes = enc.encode(input.chainId)
  const actionIdBytes = enc.encode(input.actionId)
  const payloadHash = keccak_256(input.canonicalPayload)

  const total =
    SA_SIGN_V1_PREFIX.length +
    sessionIdBytes.length +
    accountBytes.length +
    chainIdBytes.length +
    actionIdBytes.length +
    payloadHash.length
  const buf = new Uint8Array(total)
  let off = 0
  buf.set(SA_SIGN_V1_PREFIX, off); off += SA_SIGN_V1_PREFIX.length
  buf.set(sessionIdBytes, off); off += sessionIdBytes.length
  buf.set(accountBytes, off); off += accountBytes.length
  buf.set(chainIdBytes, off); off += chainIdBytes.length
  buf.set(actionIdBytes, off); off += actionIdBytes.length
  buf.set(payloadHash, off)
  return keccak_256(buf)
}

// ─── secp256k1 constants for low-s normalization (EIP-2) ────────────
// n / 2 for secp256k1. Signatures with s > n/2 are non-canonical and
// rejected by Ethereum consensus.
//
// Exported so the AWS KMS signer (K4 PR-2, `aws-kms-signer.ts`) can share
// the canonical-curve constants instead of duplicating the numeric literal.
export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
export const SECP256K1_N_HALF = SECP256K1_N >> 1n

function bigIntTo32Bytes(v: bigint): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  if (v !== 0n) throw new Error('bigIntTo32Bytes: integer overflows 32 bytes')
  return out
}

/**
 * Create a local-dev secp256k1 signer that implements the `signA2AAction`
 * half of `A2AKeyProvider`.
 *
 * Synchronously validates the env (hex parse + `NODE_ENV !== 'production'`)
 * so misconfigurations fail at module load rather than first request.
 */
export function createLocalSecp256k1Signer(env: LocalSecp256k1Env): LocalSecp256k1Signer {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      "createLocalSecp256k1Signer: refusing to instantiate in production " +
        "(NODE_ENV='production'). Use AWS KMS signer (K4 PR-2) instead.",
    )
  }
  if (!env.A2A_MASTER_PRIVATE_KEY) {
    throw new Error('createLocalSecp256k1Signer: A2A_MASTER_PRIVATE_KEY is required')
  }
  let priv: Uint8Array
  try {
    priv = hexToBytes(env.A2A_MASTER_PRIVATE_KEY)
  } catch (err) {
    throw new Error(
      `createLocalSecp256k1Signer: A2A_MASTER_PRIVATE_KEY must be hex-encoded (${(err as Error).message})`,
    )
  }
  if (priv.length !== 32) {
    throw new Error(
      `createLocalSecp256k1Signer: A2A_MASTER_PRIVATE_KEY must decode to 32 bytes (got ${priv.length})`,
    )
  }

  // Derive address: keccak256(pubkey[1:65]).slice(-20). Drop the leading
  // 0x04 SEC1 prefix byte before hashing.
  const pubUncompressed = secp256k1.getPublicKey(priv, false)
  if (pubUncompressed.length !== 65 || pubUncompressed[0] !== 0x04) {
    throw new Error('createLocalSecp256k1Signer: unexpected public-key encoding')
  }
  const addrBytes = keccak_256(pubUncompressed.slice(1)).slice(-20)
  const address = (`0x${bytesToHex(addrBytes)}`) as `0x${string}`
  const keyId = 'local-secp256k1'

  return {
    async getSignerAddress() {
      return address
    },
    async signA2AAction({ canonicalPayload, accountAddress, chainId, sessionId, actionId, digest }) {
      const msgHash =
        digest ??
        buildCanonicalDigest({ canonicalPayload, accountAddress, chainId, sessionId, actionId })
      if (msgHash.length !== 32) {
        throw new Error(`createLocalSecp256k1Signer: digest must be 32 bytes (got ${msgHash.length})`)
      }
      // `lowS: true` asks noble to perform EIP-2 normalization at sign time —
      // but we belt-and-suspender it below to keep the invariant local to
      // this file (so future call sites that pass `lowS: false` for testing
      // still get a normalized output).
      const sig = secp256k1.sign(msgHash, priv, { lowS: true })
      let s = sig.s
      let recovery = sig.recovery
      if (s > SECP256K1_N_HALF) {
        s = SECP256K1_N - s
        recovery ^= 1
      }
      const out = new Uint8Array(65)
      out.set(bigIntTo32Bytes(sig.r), 0)
      out.set(bigIntTo32Bytes(s), 32)
      out[64] = recovery + 27
      return {
        signature: out,
        keyId,
        signerAddress: address,
      }
    },
  }
}
