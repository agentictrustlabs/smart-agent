/**
 * Unit tests for `createLocalSecp256k1Signer` (KMS migration K4 PR-1 / §4).
 *
 * Covers:
 *   - Address-derivation parity with `viem.privateKeyToAccount` (same hex
 *     in → same address out). This is the load-bearing invariant for the
 *     call-site swap in `apps/a2a-agent/src/routes/onchain-redeem.ts`.
 *   - `recoverMessageAddress` round-trip: the EIP-191 signature returned by
 *     the signer must recover to the signer's own address.
 *   - Low-s normalization (EIP-2): `s ≤ n/2` for every output, even when
 *     the underlying noble call would yield high-s. We verify by sweeping
 *     a deterministic batch of digests and asserting `s` is always low.
 *   - Production guard: `NODE_ENV='production'` rejects at construction.
 *   - Canonical digest path: when `digest` is omitted, the signer hashes
 *     the binding tuple and produces a recoverable signature.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hexToBytes, keccak256, recoverMessageAddress, toBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { secp256k1 } from '@noble/curves/secp256k1'
import {
  createLocalSecp256k1Signer,
  buildCanonicalDigest,
} from '../../key-custody'

const TEST_KEY = ('0x' + 'a1'.repeat(32)) as `0x${string}`

const BINDING = {
  canonicalPayload: new TextEncoder().encode('some-canonical-payload'),
  accountAddress: '0xabc0000000000000000000000000000000000001',
  chainId: '31337',
  sessionId: 'sa_test_session_001',
  actionId: 'action-001',
}

// secp256k1 n/2 — signatures with s above this are non-canonical (EIP-2).
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const SECP256K1_N_HALF = SECP256K1_N >> 1n

function sBigIntFromSignature(sig65: Uint8Array): bigint {
  let v = 0n
  for (let i = 32; i < 64; i++) v = (v << 8n) | BigInt(sig65[i]!)
  return v
}

describe('createLocalSecp256k1Signer / address derivation', () => {
  it('matches viem.privateKeyToAccount for the same hex input', async () => {
    const signer = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const ours = await signer.getSignerAddress()
    const viemAccount = privateKeyToAccount(TEST_KEY)
    assert.equal(ours.toLowerCase(), viemAccount.address.toLowerCase())
  })

  it('accepts a hex secret without 0x prefix', async () => {
    const signer = createLocalSecp256k1Signer({
      A2A_MASTER_PRIVATE_KEY: 'a1'.repeat(32),
    })
    const ours = await signer.getSignerAddress()
    const viemAccount = privateKeyToAccount(TEST_KEY)
    assert.equal(ours.toLowerCase(), viemAccount.address.toLowerCase())
  })

  it('produces a different address for a different key', async () => {
    const a = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const b = createLocalSecp256k1Signer({
      A2A_MASTER_PRIVATE_KEY: ('0x' + 'b2'.repeat(32)) as `0x${string}`,
    })
    assert.notEqual(await a.getSignerAddress(), await b.getSignerAddress())
  })
})

describe('createLocalSecp256k1Signer / signing round-trip', () => {
  it('caller-provided digest recovers to the signer address (EIP-191 message-hash form)', async () => {
    const signer = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const addr = await signer.getSignerAddress()

    // Simulate the viem.signMessage shape: caller passes the hashed
    // message (raw 32-byte keccak digest after EIP-191 prefix).
    const message = 'hello-from-K4-PR1'
    // hashMessage("hello-from-K4-PR1") is what viem.signMessage would compute.
    // We mimic by hashing the EIP-191 envelope manually using viem helpers
    // through `recoverMessageAddress`: the assertion is that recovery
    // returns our address regardless of how the digest was constructed.
    const prefix = `\x19Ethereum Signed Message:\n${message.length}${message}`
    const digest = hexToBytes(keccak256(toBytes(prefix)))

    const result = await signer.signA2AAction({
      ...BINDING,
      digest,
    })
    assert.equal(result.signature.length, 65)
    assert.equal(result.signerAddress.toLowerCase(), addr.toLowerCase())
    assert.equal(result.keyId, 'local-secp256k1')

    const recovered = await recoverMessageAddress({
      message,
      signature: toHex(result.signature),
    })
    assert.equal(recovered.toLowerCase(), addr.toLowerCase())
  })

  it('canonical-digest path (no digest field) returns a valid 65-byte signature', async () => {
    const signer = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const result = await signer.signA2AAction(BINDING)
    assert.equal(result.signature.length, 65)
    assert.ok(result.signature[64] === 27 || result.signature[64] === 28, 'v must be 27/28')

    // Verify the digest used: rebuild canonical digest and confirm noble
    // recovery against the signer address matches.
    const expectedDigest = buildCanonicalDigest(BINDING)
    const r = BigInt(toHex(result.signature.slice(0, 32)))
    const s = BigInt(toHex(result.signature.slice(32, 64)))
    const recovery = result.signature[64]! - 27
    const sig = new secp256k1.Signature(r, s).addRecoveryBit(recovery)
    const recoveredPub = sig.recoverPublicKey(expectedDigest).toRawBytes(false).slice(1)
    const { keccak_256 } = await import('@noble/hashes/sha3')
    const recoveredAddr = '0x' + Buffer.from(keccak_256(recoveredPub).slice(-20)).toString('hex')
    assert.equal(recoveredAddr.toLowerCase(), result.signerAddress.toLowerCase())
  })

  it('low-s normalization holds across a sweep of digests', async () => {
    const signer = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    for (let i = 0; i < 32; i++) {
      // Generate a deterministic but varying 32-byte digest.
      const digest = hexToBytes(keccak256(toBytes(`sweep-${i}`)))
      const { signature } = await signer.signA2AAction({ ...BINDING, digest })
      const s = sBigIntFromSignature(signature)
      assert.ok(
        s <= SECP256K1_N_HALF,
        `signature ${i} violated EIP-2 low-s: s=${s.toString(16)}`,
      )
    }
  })

  it('rejects non-32-byte digests', async () => {
    const signer = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    await assert.rejects(
      () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(31) }),
      /digest must be 32 bytes/,
    )
    await assert.rejects(
      () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(33) }),
      /digest must be 32 bytes/,
    )
  })
})

describe('createLocalSecp256k1Signer / construction validation', () => {
  it("refuses to instantiate under NODE_ENV='production'", () => {
    assert.throws(
      () =>
        createLocalSecp256k1Signer({
          A2A_MASTER_PRIVATE_KEY: TEST_KEY,
          NODE_ENV: 'production',
        }),
      /refusing to instantiate in production/,
    )
  })

  it('accepts NODE_ENV=development', () => {
    const s = createLocalSecp256k1Signer({
      A2A_MASTER_PRIVATE_KEY: TEST_KEY,
      NODE_ENV: 'development',
    })
    assert.ok(s)
  })

  it('rejects missing private key', () => {
    assert.throws(
      () => createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: '' }),
      /required/,
    )
  })

  it('rejects non-hex private key', () => {
    assert.throws(
      () => createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: 'z'.repeat(64) }),
      /hex-encoded|hex character/i,
    )
  })

  it('rejects wrong-length private key', () => {
    assert.throws(
      () => createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: '0x' + 'a'.repeat(60) }),
      /32 bytes/,
    )
  })
})

describe('buildCanonicalDigest', () => {
  it('is deterministic over the same input tuple', () => {
    const a = buildCanonicalDigest(BINDING)
    const b = buildCanonicalDigest(BINDING)
    assert.deepEqual(Array.from(a), Array.from(b))
    assert.equal(a.length, 32)
  })

  it('changes when any binding field changes', () => {
    const base = buildCanonicalDigest(BINDING)
    const variants = [
      buildCanonicalDigest({ ...BINDING, sessionId: 'other' }),
      buildCanonicalDigest({ ...BINDING, actionId: 'other' }),
      buildCanonicalDigest({ ...BINDING, chainId: '1' }),
      buildCanonicalDigest({
        ...BINDING,
        accountAddress: '0xabc0000000000000000000000000000000000002',
      }),
      buildCanonicalDigest({
        ...BINDING,
        canonicalPayload: new TextEncoder().encode('different'),
      }),
    ]
    for (const v of variants) {
      assert.notDeepEqual(Array.from(base), Array.from(v))
    }
  })
})
