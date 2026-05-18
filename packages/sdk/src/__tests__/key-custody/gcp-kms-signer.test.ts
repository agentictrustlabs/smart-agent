/**
 * Unit tests for `packages/sdk/src/key-custody/gcp-kms-signer.ts`
 * (GCP-KMS G-PR-3 — master-EOA secp256k1 signer).
 *
 * Mocking strategy: the signer exposes a `kmsClientFactory` dep seam
 * which returns a `SignerKmsClientLike` stub. Tests pass a hand-built
 * stub whose `getPublicKey` returns a PEM-wrapped SPKI from a known
 * secp256k1 private key, and whose `asymmetricSign` signs the digest
 * with that same key — returning a DER-encoded `SEQUENCE { r, s }` with
 * matching CRC32C fields. The signer's downstream logic (DER decode,
 * low-S normalize, recovery-id derivation, address derivation) runs
 * unmodified against this realistic mock output.
 *
 * Sibling of `apps/a2a-agent/test/aws-kms-signer.test.ts` — every AWS
 * test case has an analogue here, plus GCP-specific CRC32C tripwires
 * and the low-S-normalized audit-event test that have no AWS analog.
 *
 * Run: `node --import tsx --test packages/sdk/src/__tests__/key-custody/gcp-kms-signer.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { recoverMessageAddress, hashMessage, toHex } from 'viem'
import {
  createGcpKmsSigner,
  crc32c,
  SECP256K1_N,
  SECP256K1_N_HALF,
  type GcpKmsSignerAuditEvent,
  type SignerKmsClientLike,
} from '../../key-custody'

// --- Test fixtures ---------------------------------------------------

const VALID_AUTH_ENV = {
  GCP_PROJECT_ID: 'smart-agent-prod',
  GCP_PROJECT_NUMBER: '123456789012',
  GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel-pool',
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel-oidc',
  GCP_SERVICE_ACCOUNT_EMAIL:
    'a2a-agent@smart-agent-prod.iam.gserviceaccount.com',
}

const VERSION_PATH =
  'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/master-signer/cryptoKeyVersions/1'

const VALID_ENV = {
  ...VALID_AUTH_ENV,
  GCP_KMS_MASTER_SIGNER_VERSION: VERSION_PATH,
} as const

// Deterministic test private key — used to construct realistic mock
// KMS responses. The address derived from this key is the "expected"
// signer address in every recovery-id assertion below.
const TEST_PRIV_HEX = 'b1'.repeat(32)
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return out
}
const TEST_PRIV = hexToBytes(TEST_PRIV_HEX)
const TEST_PUB_UNCOMPRESSED = secp256k1.getPublicKey(TEST_PRIV, false) // 65 bytes (0x04 || X || Y)
const TEST_PUB_RAW = TEST_PUB_UNCOMPRESSED.slice(1) // 64 bytes (X || Y)
const EXPECTED_ADDR_BYTES = keccak_256(TEST_PUB_RAW).slice(-20)
const EXPECTED_ADDR = ('0x' +
  Array.from(EXPECTED_ADDR_BYTES)
    .map((b) => (b < 16 ? '0' : '') + b.toString(16))
    .join('')) as `0x${string}`

const BINDING = {
  canonicalPayload: new TextEncoder().encode('test-payload'),
  accountAddress: EXPECTED_ADDR,
  chainId: '31337',
  sessionId: 'sa_test_session_001',
  actionId: 'action-001',
}

// --- DER + SPKI helpers (mirror image of `der-utils.ts`) ------------

/**
 * Encode an unsigned bigint as a DER `INTEGER`. Prepends 0x00 when the
 * top byte's high bit is set (positive-integer disambiguation).
 */
function encodeDerInteger(v: bigint): Uint8Array {
  if (v < 0n) throw new Error('test helper: negative')
  const bytes: number[] = []
  let x = v
  if (x === 0n) bytes.push(0)
  while (x > 0n) {
    bytes.unshift(Number(x & 0xffn))
    x >>= 8n
  }
  if ((bytes[0]! & 0x80) !== 0) bytes.unshift(0)
  const len = bytes.length
  if (len >= 0x80) throw new Error('unsupported multi-byte length in test helper')
  return new Uint8Array([0x02, len, ...bytes])
}

function encodeDerSequence(...elements: Uint8Array[]): Uint8Array {
  const body = elements.reduce((acc, x) => acc + x.length, 0)
  if (body >= 0x80) {
    // Long-form length, single-byte. ECDSA-secp256k1 sigs hit this
    // when both r and s pad to 33 bytes (~70-byte body).
    if (body > 0xff) throw new Error('test helper: sequence too long')
    const out = new Uint8Array(3 + body)
    out[0] = 0x30
    out[1] = 0x81
    out[2] = body
    let off = 3
    for (const el of elements) {
      out.set(el, off)
      off += el.length
    }
    return out
  }
  const out = new Uint8Array(2 + body)
  out[0] = 0x30
  out[1] = body
  let off = 2
  for (const el of elements) {
    out.set(el, off)
    off += el.length
  }
  return out
}

function encodeDerEcdsaSig(r: bigint, s: bigint): Uint8Array {
  return encodeDerSequence(encodeDerInteger(r), encodeDerInteger(s))
}

/**
 * Build a DER `SubjectPublicKeyInfo` envelope around a 65-byte SEC1
 * point. AlgorithmIdentifier carries `1.2.840.10045.2.1 ecPublicKey` +
 * named curve `1.3.132.0.10 secp256k1`. Same shape AWS KMS / GCP KMS
 * both emit; the SDK's `extractSec1FromSpki` handles either.
 */
function buildSpki(sec1Point65: Uint8Array): Uint8Array {
  if (sec1Point65.length !== 65 || sec1Point65[0] !== 0x04) {
    throw new Error('test helper: bad SEC1 point')
  }
  const oidEcPublicKey = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
  const oidSecp256k1 = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a])
  const algId = encodeDerSequence(oidEcPublicKey, oidSecp256k1)
  const bitStringBody = new Uint8Array(1 + sec1Point65.length)
  bitStringBody[0] = 0x00 // unused bits = 0
  bitStringBody.set(sec1Point65, 1)
  const bitString = new Uint8Array(2 + bitStringBody.length)
  bitString[0] = 0x03
  bitString[1] = bitStringBody.length
  bitString.set(bitStringBody, 2)
  return encodeDerSequence(algId, bitString)
}

/**
 * Wrap DER SPKI bytes in PEM `BEGIN/END PUBLIC KEY` markers. Matches
 * what Google Cloud KMS returns in `getPublicKey.pem`.
 */
function spkiToPem(spki: Uint8Array): string {
  const b64 = Buffer.from(spki).toString('base64')
  // 64-char wrap per RFC 7468.
  const lines: string[] = []
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.substring(i, i + 64))
  }
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`
}

const VALID_SPKI = buildSpki(TEST_PUB_UNCOMPRESSED)
const VALID_PEM = spkiToPem(VALID_SPKI)

interface CapturedCall {
  op: 'getPublicKey' | 'asymmetricSign'
  request: unknown
}

interface MockKmsResult {
  client: SignerKmsClientLike
  calls: CapturedCall[]
}

/**
 * Build a stub `SignerKmsClientLike` that records every call and emits
 * configured responses. The defaults sign with the test private key so
 * the round-trip recovers to `EXPECTED_ADDR`.
 */
function makeMockKms(opts: {
  publicKeyPem?: string
  publicKeyError?: Error
  signResponse?: (req: { digest: Uint8Array }) => {
    signatureDer: Uint8Array
    verifiedDigestCrc32c?: boolean
    signatureCrc32cOverride?: bigint
    name?: string
  }
  signError?: Error
} = {}): MockKmsResult {
  const calls: CapturedCall[] = []
  const client: SignerKmsClientLike = {
    async getPublicKey(request) {
      calls.push({ op: 'getPublicKey', request })
      if (opts.publicKeyError) throw opts.publicKeyError
      return [
        {
          pem: opts.publicKeyPem ?? VALID_PEM,
          name: VERSION_PATH,
        },
      ]
    },
    async asymmetricSign(request) {
      calls.push({ op: 'asymmetricSign', request })
      if (opts.signError) throw opts.signError
      const digest = request.digest?.sha256 ?? new Uint8Array(32)
      const factory: NonNullable<typeof opts.signResponse> =
        opts.signResponse ??
        ((req) => {
          const sig = secp256k1.sign(req.digest, TEST_PRIV, { lowS: true })
          return { signatureDer: encodeDerEcdsaSig(sig.r, sig.s) }
        })
      const r = factory({ digest })
      const sigCrc =
        r.signatureCrc32cOverride ?? crc32c(r.signatureDer)
      return [
        {
          name: r.name ?? VERSION_PATH,
          signature: r.signatureDer,
          signatureCrc32c: { value: sigCrc.toString() },
          verifiedDigestCrc32c: r.verifiedDigestCrc32c ?? true,
        },
      ]
    },
  }
  return { client, calls }
}

// --- Constructor validation -----------------------------------------

test('construction validates GCP_KMS_MASTER_SIGNER_VERSION is required', () => {
  assert.throws(
    () =>
      createGcpKmsSigner({
        ...VALID_AUTH_ENV,
        GCP_KMS_MASTER_SIGNER_VERSION: '',
      }),
    /GCP_KMS_MASTER_SIGNER_VERSION is required/,
  )
})

test('construction validates GCP_KMS_MASTER_SIGNER_VERSION format (must end with /cryptoKeyVersions/<n>)', () => {
  assert.throws(
    () =>
      createGcpKmsSigner({
        ...VALID_AUTH_ENV,
        // Missing the cryptoKeyVersions suffix — the parent key path.
        GCP_KMS_MASTER_SIGNER_VERSION:
          'projects/p/locations/l/keyRings/r/cryptoKeys/k',
      }),
    /must match.*cryptoKeyVersions/,
  )
})

test('construction validates GCP auth env (GCP_PROJECT_NUMBER missing)', () => {
  const env = { ...VALID_ENV } as Record<string, string>
  delete env.GCP_PROJECT_NUMBER
  assert.throws(
    () => createGcpKmsSigner(env as unknown as typeof VALID_ENV),
    /GCP_PROJECT_NUMBER is required/,
  )
})

// --- Signer surface --------------------------------------------------

test("signer.backend === 'gcp-kms'", () => {
  const { client } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  assert.equal(signer.backend, 'gcp-kms')
})

test("signer.keyVersion starts with 'gcp-kms:' and carries the version suffix", () => {
  const { client } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  assert.equal(signer.keyVersion, 'gcp-kms:1')
  assert.ok(signer.keyVersion.startsWith('gcp-kms:'))
})

test('signer.keyId is the pinned cryptoKeyVersion resource path', () => {
  const { client } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  assert.equal(signer.keyId, VERSION_PATH)
})

// --- Address derivation (getPublicKey path) --------------------------

test('getSignerAddress calls getPublicKey, decodes SPKI, and caches the derived EVM address', async () => {
  const { client, calls } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  const addr = await signer.getSignerAddress()
  assert.equal(addr.toLowerCase(), EXPECTED_ADDR.toLowerCase())
  // getPublicKey was called exactly once with the pinned version path.
  const pkCalls = calls.filter((c) => c.op === 'getPublicKey')
  assert.equal(pkCalls.length, 1)
  assert.equal((pkCalls[0]!.request as { name: string }).name, VERSION_PATH)
  // Second call returns the cached address (no extra getPublicKey).
  await signer.getSignerAddress()
  assert.equal(calls.filter((c) => c.op === 'getPublicKey').length, 1)
})

test('getPublicKey is cached: 5 sign operations issue only one getPublicKey call', async () => {
  const { client, calls } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  for (let i = 0; i < 5; i++) {
    const digest = new Uint8Array(32)
    digest[0] = i + 1
    const res = await signer.signA2AAction({ ...BINDING, digest })
    assert.equal(res.signature.length, 65)
  }
  assert.equal(
    calls.filter((c) => c.op === 'getPublicKey').length,
    1,
    'getPublicKey should be cached after first call',
  )
  assert.equal(calls.filter((c) => c.op === 'asymmetricSign').length, 5)
})

// --- signA2AAction round-trip ----------------------------------------

test('sign returns 65-byte EVM signature (r | s | v) recoverable to signer.address', async () => {
  const { client } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  const message = 'hello-gcp-kms'
  const digest = hexToBytes(hashMessage(message).slice(2))
  const res = await signer.signA2AAction({ ...BINDING, digest })
  assert.equal(res.signature.length, 65)
  assert.equal(res.signerAddress.toLowerCase(), EXPECTED_ADDR.toLowerCase())
  // v ∈ {27, 28}
  assert.ok(res.signature[64] === 27 || res.signature[64] === 28)
  // viem round-trip: signed message must verify via recoverAddress
  // against the signer's KMS-derived address.
  const recovered = await recoverMessageAddress({
    message,
    signature: toHex(res.signature),
  })
  assert.equal(recovered.toLowerCase(), EXPECTED_ADDR.toLowerCase())
})

test('sign forwards digest.sha256 to asymmetricSign with matching digestCrc32c', async () => {
  const { client, calls } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  const digest = new Uint8Array(32)
  digest[0] = 0xaa
  digest[31] = 0xbb
  await signer.signA2AAction({ ...BINDING, digest })
  const signCalls = calls.filter((c) => c.op === 'asymmetricSign')
  assert.equal(signCalls.length, 1)
  const req = signCalls[0]!.request as {
    name: string
    digest: { sha256: Uint8Array }
    digestCrc32c: { value: string }
  }
  assert.equal(req.name, VERSION_PATH)
  assert.deepEqual(Array.from(req.digest.sha256), Array.from(digest))
  assert.equal(req.digestCrc32c.value, crc32c(digest).toString())
})

test('verifiedDigestCrc32c=false → throws CRC32C integrity error on sign digest', async () => {
  const { client } = makeMockKms({
    signResponse: ({ digest }) => {
      const sig = secp256k1.sign(digest, TEST_PRIV, { lowS: true })
      return {
        signatureDer: encodeDerEcdsaSig(sig.r, sig.s),
        verifiedDigestCrc32c: false,
      }
    },
  })
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) }),
    /CRC32C integrity check failed on sign digest/,
  )
})

test('signatureCrc32c mismatch on response → throws CRC32C integrity error', async () => {
  const { client } = makeMockKms({
    signResponse: ({ digest }) => {
      const sig = secp256k1.sign(digest, TEST_PRIV, { lowS: true })
      return {
        signatureDer: encodeDerEcdsaSig(sig.r, sig.s),
        // Lie about the CRC — force a divergence.
        signatureCrc32cOverride: 0xdeadbeefn,
      }
    },
  })
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) }),
    /CRC32C integrity check failed on sign signature/,
  )
})

// --- Low-S normalization --------------------------------------------

test('low-S normalization: KMS returns high-S → signer silently fixes AND emits gcp-kms-low-s-normalized audit event', async () => {
  const captured: GcpKmsSignerAuditEvent[] = []
  const { client } = makeMockKms({
    signResponse: ({ digest }) => {
      // Force high-S by signing low-S then flipping.
      const sig = secp256k1.sign(digest, TEST_PRIV, { lowS: true })
      const highS = SECP256K1_N - sig.s // flip to high half
      return { signatureDer: encodeDerEcdsaSig(sig.r, highS) }
    },
  })
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
    audit: (event) => {
      captured.push(event)
    },
  })
  const digest = new Uint8Array(32)
  digest[0] = 0xff
  const res = await signer.signA2AAction({ ...BINDING, digest })
  // Returned signature is low-S.
  let s = 0n
  for (let j = 32; j < 64; j++) s = (s << 8n) | BigInt(res.signature[j]!)
  assert.ok(s <= SECP256K1_N_HALF, `s must be low (got ${s.toString(16)})`)
  // And we emitted the low-S-normalized audit event (BEFORE the standard sign event).
  const kinds = captured.map((e) => e.kind)
  assert.deepEqual(kinds, ['low-s-normalized', 'sign'])
})

test('low-S normalization: KMS returns low-S → NO gcp-kms-low-s-normalized event (only sign event)', async () => {
  const captured: GcpKmsSignerAuditEvent[] = []
  const { client } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
    audit: (event) => {
      captured.push(event)
    },
  })
  await signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) })
  assert.equal(captured.length, 1)
  assert.equal(captured[0]!.kind, 'sign')
})

// --- Recovery-id derivation -----------------------------------------

test('recovery-id derivation: v=27 or v=28 picked so recovered address matches', async () => {
  // Sweep multiple digests so we hit both bits.
  const seenV = new Set<number>()
  const { client } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  for (let i = 0; i < 32; i++) {
    const digest = new Uint8Array(32)
    digest[0] = 0xff
    digest[31] = i
    const res = await signer.signA2AAction({ ...BINDING, digest })
    const v = res.signature[64]!
    assert.ok(v === 27 || v === 28)
    seenV.add(v)
    // Recovered pubkey must match cached.
    const sig = secp256k1.Signature.fromCompact(res.signature.slice(0, 64))
      .addRecoveryBit((v - 27) as 0 | 1)
    const recovered = sig.recoverPublicKey(digest).toRawBytes(false)
    assert.equal(
      Buffer.from(recovered.slice(1)).toString('hex'),
      Buffer.from(TEST_PUB_RAW).toString('hex'),
    )
  }
  // Both recovery bits must have been hit across 32 digests with very
  // high probability — this asserts the picker doesn't hardcode one.
  assert.equal(seenV.size, 2, 'both v=27 and v=28 should have been observed')
})

test('mismatched recovery (corrupted DER signature data) → throws "recovered address does not match expected signer"', async () => {
  const { client } = makeMockKms({
    signResponse: ({ digest }) => {
      // Sign with a DIFFERENT private key — the signature will be valid
      // but recover to the wrong address.
      const otherPriv = new Uint8Array(32)
      otherPriv.fill(0x42)
      const sig = secp256k1.sign(digest, otherPriv, { lowS: true })
      return { signatureDer: encodeDerEcdsaSig(sig.r, sig.s) }
    },
  })
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) }),
    /recovered address does not match expected signer/,
  )
})

// --- Canonical-digest path (no `digest` field) -----------------------

test('canonical digest path: omitting `digest` triggers sa:sign:v1 hashing internally', async () => {
  const { client, calls } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  const { canonicalPayload, ...rest } = BINDING
  const res = await signer.signA2AAction({ canonicalPayload, ...rest })
  assert.equal(res.signature.length, 65)
  const signCalls = calls.filter((c) => c.op === 'asymmetricSign')
  assert.equal(signCalls.length, 1)
  const req = signCalls[0]!.request as { digest: { sha256: Uint8Array } }
  assert.equal(req.digest.sha256.length, 32, 'asymmetricSign must receive a 32-byte digest')
})

test('sign rejects a non-32-byte digest', async () => {
  const { client } = makeMockKms()
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(16) }),
    /digest must be 32 bytes/,
  )
})

// --- Error preservation ---------------------------------------------

test('PERMISSION_DENIED on sign → re-thrown with gcp-kms-signer (sign) prefix preserving error message', async () => {
  const grpcErr = Object.assign(
    new Error('PERMISSION_DENIED: caller does not have cloudkms.signer on key version'),
    { code: 7 },
  )
  const { client } = makeMockKms({ signError: grpcErr })
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) }),
    /gcp-kms-signer \(sign\):.*PERMISSION_DENIED/,
  )
})

test('FAILED_PRECONDITION (version disabled / destroyed) on sign → re-thrown preserving message', async () => {
  const grpcErr = Object.assign(
    new Error('FAILED_PRECONDITION: CryptoKeyVersion is in DESTROYED state'),
    { code: 9 },
  )
  const { client } = makeMockKms({ signError: grpcErr })
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) }),
    /gcp-kms-signer \(sign\):.*FAILED_PRECONDITION/,
  )
})

test('IAM denied on getPublicKey → re-thrown with gcp-kms-signer (getPublicKey) prefix', async () => {
  const grpcErr = Object.assign(
    new Error('PERMISSION_DENIED: caller does not have cloudkms.viewer'),
    { code: 7 },
  )
  const { client } = makeMockKms({ publicKeyError: grpcErr })
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => signer.getSignerAddress(),
    /gcp-kms-signer \(getPublicKey\):.*PERMISSION_DENIED/,
  )
})

test('getPublicKey response with empty PEM → throws clean error', async () => {
  const { client } = makeMockKms({ publicKeyPem: '' })
  const signer = createGcpKmsSigner(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => signer.getSignerAddress(),
    /getPublicKey returned no PEM key material/,
  )
})
