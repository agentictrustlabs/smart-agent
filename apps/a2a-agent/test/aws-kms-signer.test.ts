/**
 * Unit tests for `packages/sdk/src/key-custody/aws-kms-signer.ts` (KMS K4 PR-2).
 *
 * Mocking strategy: `aws-sdk-client-mock` intercepts `KMSClient.send(...)` calls
 * without ever reaching AWS. We can't have KMS actually produce a signature for
 * us in unit tests, so the mock generates a REAL secp256k1 signature locally
 * via `@noble/curves` (from a known test private key), DER-encodes it, and
 * returns it as the `Signature` blob. The signer's downstream logic — DER
 * decode, low-s normalize, recovery-id derivation, address derivation —
 * runs unmodified against this realistic mock output.
 *
 * Co-located with `aws-kms-provider.test.ts` (same pattern, same mock dep,
 * same `node:test` style). See the comment in that file for the precedent on
 * why `aws-sdk-client-mock` lives in `apps/a2a-agent/test/` rather than the
 * SDK package itself.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/aws-kms-signer.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  KMSClient,
  SignCommand,
  GetPublicKeyCommand,
} from '@aws-sdk/client-kms'
import { mockClient } from 'aws-sdk-client-mock'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { recoverMessageAddress, hashMessage, toHex } from 'viem'
import {
  createAwsKmsSigner,
  parseDerSignature,
  extractSec1FromSpki,
  SECP256K1_N,
  SECP256K1_N_HALF,
} from '@smart-agent/sdk/key-custody'

// ─── Test fixtures ────────────────────────────────────────────────────

const VALID_ENV = {
  AWS_REGION: 'us-east-1',
  AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/SmartAgentA2A',
  AWS_KMS_SIGNER_KEY_ID:
    'arn:aws:kms:us-east-1:111122223333:key/0123abcd-4567-89ef-0123-456789abcdef',
}

// Deterministic test private key — used to construct realistic mock KMS
// responses. The address derived from this key is the "expected" signer
// address in every recovery-id assertion below.
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

// ─── DER + SPKI helpers (mirror image of `der-utils.ts`) ──────────────

/**
 * Encode an unsigned bigint as a DER `INTEGER`. Prepends 0x00 when the
 * top byte's high bit is set (positive-integer disambiguation).
 */
function encodeDerInteger(v: bigint): Uint8Array {
  if (v < 0n) throw new Error('test helper: negative')
  // Convert to minimum-length big-endian bytes.
  const bytes: number[] = []
  let x = v
  if (x === 0n) bytes.push(0)
  while (x > 0n) {
    bytes.unshift(Number(x & 0xffn))
    x >>= 8n
  }
  // Prepend 0x00 if high bit of first byte is set.
  if ((bytes[0]! & 0x80) !== 0) bytes.unshift(0)
  const len = bytes.length
  const lenBytes = len < 0x80 ? [len] : [] // ECDSA r/s always fit single-byte length
  if (lenBytes.length === 0) throw new Error('unsupported multi-byte length in test helper')
  return new Uint8Array([0x02, ...lenBytes, ...bytes])
}

function encodeDerSequence(...elements: Uint8Array[]): Uint8Array {
  const body = elements.reduce((acc, x) => acc + x.length, 0)
  if (body >= 0x80) {
    // Long-form length. For typical ECDSA-secp256k1 sigs body is ~70 bytes,
    // which IS >= 0x80 when both r and s pad to 33 bytes. Use single-byte
    // long-form: 0x81 0xLL.
    if (body > 0xff) throw new Error('test helper: sequence too long')
    const out = new Uint8Array(2 + 2 + body)
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
 * Build a DER `SubjectPublicKeyInfo` envelope around a 65-byte SEC1 point.
 * AlgorithmIdentifier carries `1.2.840.10045.2.1 ecPublicKey` + named curve
 * `1.3.132.0.10 secp256k1`. The exact OID bytes are well-known constants.
 */
function buildSpki(sec1Point65: Uint8Array): Uint8Array {
  if (sec1Point65.length !== 65 || sec1Point65[0] !== 0x04) {
    throw new Error('test helper: bad SEC1 point')
  }
  // AlgorithmIdentifier ::= SEQUENCE { OID ecPublicKey, OID secp256k1 }
  // OID 1.2.840.10045.2.1 (ecPublicKey): 06 07 2A 86 48 CE 3D 02 01
  const oidEcPublicKey = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
  // OID 1.3.132.0.10 (secp256k1): 06 05 2B 81 04 00 0A
  const oidSecp256k1 = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a])
  const algId = encodeDerSequence(oidEcPublicKey, oidSecp256k1)
  // BIT STRING ::= 03 LL 00 <content>
  const bitStringBody = new Uint8Array(1 + sec1Point65.length)
  bitStringBody[0] = 0x00 // unused bits = 0
  bitStringBody.set(sec1Point65, 1)
  const bitString = new Uint8Array(2 + bitStringBody.length)
  bitString[0] = 0x03
  bitString[1] = bitStringBody.length
  bitString.set(bitStringBody, 2)
  return encodeDerSequence(algId, bitString)
}

const VALID_SPKI = buildSpki(TEST_PUB_UNCOMPRESSED)

/**
 * Helper: produce a realistic AWS KMS Sign response for `msgHash` using the
 * test private key. `forceHighS` lets us exercise the low-s normalization
 * branch by NOT asking noble to canonicalise.
 */
function mockKmsSignature(msgHash: Uint8Array, opts: { highS?: boolean } = {}): Uint8Array {
  const sig = secp256k1.sign(msgHash, TEST_PRIV, { lowS: !opts.highS })
  let s = sig.s
  if (opts.highS && s <= SECP256K1_N_HALF) {
    // noble gave us low-s; flip it to force the high-s branch.
    s = SECP256K1_N - s
  }
  return encodeDerEcdsaSig(sig.r, s)
}

// ─── Constructor validation ───────────────────────────────────────────

test('constructor rejects empty AWS_REGION', () => {
  assert.throws(
    () => createAwsKmsSigner({ ...VALID_ENV, AWS_REGION: '' }),
    /AWS_REGION is required/,
  )
})

test('constructor rejects malformed AWS_ROLE_ARN', () => {
  assert.throws(
    () => createAwsKmsSigner({ ...VALID_ENV, AWS_ROLE_ARN: 'not-an-arn' }),
    /AWS_ROLE_ARN must match/,
  )
})

test('constructor rejects malformed AWS_KMS_SIGNER_KEY_ID', () => {
  assert.throws(
    () => createAwsKmsSigner({ ...VALID_ENV, AWS_KMS_SIGNER_KEY_ID: 'not-a-key' }),
    /AWS_KMS_SIGNER_KEY_ID must be/,
  )
})

test('constructor accepts a bare UUID key id', () => {
  const signer = createAwsKmsSigner(
    { ...VALID_ENV, AWS_KMS_SIGNER_KEY_ID: '0123abcd-4567-89ef-0123-456789abcdef' },
    { client: new KMSClient({ region: 'us-east-1' }) },
  )
  assert.ok(signer)
})

test('constructor accepts an alias key id', () => {
  const signer = createAwsKmsSigner(
    { ...VALID_ENV, AWS_KMS_SIGNER_KEY_ID: 'alias/smart-agent-master-signer' },
    { client: new KMSClient({ region: 'us-east-1' }) },
  )
  assert.ok(signer)
})

// ─── Address derivation (GetPublicKey path) ───────────────────────────

test('getSignerAddress derives the EOA from kms:GetPublicKey output', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({
    PublicKey: VALID_SPKI,
    KeyId: VALID_ENV.AWS_KMS_SIGNER_KEY_ID,
  })

  const signer = createAwsKmsSigner(VALID_ENV, { client })
  const addr = await signer.getSignerAddress()
  assert.equal(addr.toLowerCase(), EXPECTED_ADDR.toLowerCase())
  assert.equal(kmsMock.commandCalls(GetPublicKeyCommand).length, 1)
  kmsMock.restore()
})

test('GetPublicKey is cached: 5 sign operations issue only one GetPublicKey call', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({
    PublicKey: VALID_SPKI,
    KeyId: VALID_ENV.AWS_KMS_SIGNER_KEY_ID,
  })
  kmsMock.on(SignCommand).callsFake((input: { Message?: Uint8Array }) => {
    const sigDer = mockKmsSignature(input.Message!)
    return { Signature: sigDer, KeyId: VALID_ENV.AWS_KMS_SIGNER_KEY_ID }
  })

  const signer = createAwsKmsSigner(VALID_ENV, { client })
  for (let i = 0; i < 5; i++) {
    const digest = new Uint8Array(32)
    digest[0] = i + 1
    const res = await signer.signA2AAction({ ...BINDING, digest })
    assert.equal(res.signature.length, 65)
  }
  assert.equal(
    kmsMock.commandCalls(GetPublicKeyCommand).length,
    1,
    'GetPublicKey should be cached after first call',
  )
  assert.equal(kmsMock.commandCalls(SignCommand).length, 5)
  kmsMock.restore()
})

// ─── signA2AAction round-trip ─────────────────────────────────────────

test('signA2AAction round-trip: recovered address matches the cached signer address', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  kmsMock.on(SignCommand).callsFake((input: { Message?: Uint8Array }) => {
    return { Signature: mockKmsSignature(input.Message!) }
  })

  const signer = createAwsKmsSigner(VALID_ENV, { client })
  // Sign an EIP-191 message; recover via viem and assert address match.
  const message = 'hello-aws-kms'
  const digest = hexToBytes(hashMessage(message).slice(2))
  const res = await signer.signA2AAction({ ...BINDING, digest })
  assert.equal(res.signature.length, 65)
  assert.equal(res.signerAddress.toLowerCase(), EXPECTED_ADDR.toLowerCase())
  // v ∈ {27, 28}
  assert.ok(res.signature[64] === 27 || res.signature[64] === 28)
  // viem recoverMessageAddress round-trip.
  const recovered = await recoverMessageAddress({
    message,
    signature: toHex(res.signature),
  })
  assert.equal(recovered.toLowerCase(), EXPECTED_ADDR.toLowerCase())
  kmsMock.restore()
})

test('low-s normalization: high-s KMS signature returns low-s output', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  kmsMock.on(SignCommand).callsFake((input: { Message?: Uint8Array }) => {
    // Force high-s output to exercise normalization.
    return { Signature: mockKmsSignature(input.Message!, { highS: true }) }
  })

  const signer = createAwsKmsSigner(VALID_ENV, { client })
  // Sweep multiple digests so we hit several recovery-id flips.
  for (let i = 0; i < 10; i++) {
    const digest = new Uint8Array(32)
    digest[0] = 0xff
    digest[31] = i
    const res = await signer.signA2AAction({ ...BINDING, digest })
    // Extract s and assert low-s.
    let s = 0n
    for (let j = 32; j < 64; j++) s = (s << 8n) | BigInt(res.signature[j]!)
    assert.ok(s <= SECP256K1_N_HALF, `iter ${i}: s must be low (got ${s.toString(16)})`)
    // Recovery still works after normalization.
    const recovered = secp256k1.Signature.fromCompact(res.signature.slice(0, 64))
      .addRecoveryBit((res.signature[64]! - 27) as 0 | 1)
      .recoverPublicKey(digest)
      .toRawBytes(false)
    assert.equal(
      Buffer.from(recovered.slice(1)).toString('hex'),
      Buffer.from(TEST_PUB_RAW).toString('hex'),
      `iter ${i}: recovered pubkey must match cached`,
    )
  }
  kmsMock.restore()
})

test('canonical digest path: omitting `digest` triggers sa:sign:v1 hashing', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  kmsMock.on(SignCommand).callsFake((input: { Message?: Uint8Array }) => {
    assert.equal(input.Message!.length, 32, 'KMS must receive a 32-byte digest')
    return { Signature: mockKmsSignature(input.Message!) }
  })
  const signer = createAwsKmsSigner(VALID_ENV, { client })
  // No `digest` field — signer computes the canonical digest internally.
  const { canonicalPayload, ...rest } = BINDING
  const res = await signer.signA2AAction({ canonicalPayload, ...rest })
  assert.equal(res.signature.length, 65)
  kmsMock.restore()
})

test('signA2AAction rejects a non-32-byte digest', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  const signer = createAwsKmsSigner(VALID_ENV, { client })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(16) }),
    /digest must be 32 bytes/,
  )
  kmsMock.restore()
})

// ─── DER decoder edge cases (via the public surface) ──────────────────

test('parseDerSignature: leading-zero pad on r (high-bit set)', () => {
  // r starts with 0x80 — DER must prepend 0x00 → 33-byte INTEGER.
  // s is small (1 byte) — INTEGER length is 1.
  // Body: 0x02 0x21 [33 bytes] 0x02 0x01 [1 byte] = 38 bytes = 0x26.
  const der = new Uint8Array([
    0x30, 0x26, // SEQUENCE, 38 bytes body
    0x02, 0x21, // INTEGER, 33 bytes (r)
    0x00, 0x80, ...new Array(31).fill(0xab),
    0x02, 0x01, // INTEGER, 1 byte (s)
    0x42,
  ])
  const { r, s } = parseDerSignature(der)
  // r should be 0x80ababab... with 31 0xab bytes (32 bytes total).
  const expected = (0x80n << (31n * 8n)) | BigInt('0x' + 'ab'.repeat(31))
  assert.equal(r, expected)
  assert.equal(s, 0x42n)
})

test('parseDerSignature: leading-zero pad on s', () => {
  // r is small. s starts with 0x90 — pad with 0x00.
  // Body: 0x02 0x01 [1 byte] 0x02 0x21 [33 bytes] = 38 bytes = 0x26.
  const der = new Uint8Array([
    0x30, 0x26, // SEQUENCE, 38 bytes body
    0x02, 0x01, // INTEGER, 1 byte (r)
    0x42,
    0x02, 0x21, // INTEGER, 33 bytes (s)
    0x00, 0x90, ...new Array(31).fill(0xcd),
  ])
  const { r, s } = parseDerSignature(der)
  assert.equal(r, 0x42n)
  const expected = (0x90n << (31n * 8n)) | BigInt('0x' + 'cd'.repeat(31))
  assert.equal(s, expected)
})

test('parseDerSignature: rejects non-minimal integer encoding (illegal leading 00)', () => {
  // 00 followed by a byte whose high bit is CLEAR — illegal padding.
  // Body: 0x02 0x02 0x00 0x42 0x02 0x01 0x42 = 7 bytes.
  const der = new Uint8Array([
    0x30, 0x07,
    0x02, 0x02, 0x00, 0x42, // illegal: 0x42 has high bit clear, the 0x00 is non-minimal
    0x02, 0x01, 0x42,
  ])
  assert.throws(() => parseDerSignature(der), /non-minimal/)
})

test('parseDerSignature: rejects trailing bytes after SEQUENCE', () => {
  // Body: 0x02 0x01 0x42 0x02 0x01 0x42 = 6 bytes. Trailing 0xff makes
  // the buffer 1 byte longer than the SEQUENCE claims → seq length mismatch.
  const der = new Uint8Array([
    0x30, 0x06,
    0x02, 0x01, 0x42,
    0x02, 0x01, 0x42,
    0xff, // trailing junk
  ])
  assert.throws(() => parseDerSignature(der), /seq length mismatch|trailing bytes/)
})

test('parseDerSignature: short integers round-trip via realistic noble signature', () => {
  // Real signatures occasionally have r or s shorter than 32 bytes; we test
  // by signing many different digests and asserting the decoder doesn't fail.
  for (let i = 0; i < 32; i++) {
    const digest = new Uint8Array(32)
    digest[31] = i
    const sig = secp256k1.sign(digest, TEST_PRIV, { lowS: true })
    const der = encodeDerEcdsaSig(sig.r, sig.s)
    const { r, s } = parseDerSignature(der)
    assert.equal(r, sig.r)
    assert.equal(s, sig.s)
  }
})

test('extractSec1FromSpki round-trips through buildSpki', () => {
  const point = extractSec1FromSpki(VALID_SPKI)
  assert.equal(point.length, 65)
  assert.equal(point[0], 0x04)
  assert.deepEqual(Array.from(point), Array.from(TEST_PUB_UNCOMPRESSED))
})

test('extractSec1FromSpki rejects garbage input', () => {
  assert.throws(() => extractSec1FromSpki(new Uint8Array([0x00])), /expected SEQUENCE/)
})

// ─── Error mapping ────────────────────────────────────────────────────

test('KMSInvalidSignatureException maps to "kms signature rejected"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  const awsErr = Object.assign(new Error('algorithm mismatch'), {
    name: 'KMSInvalidSignatureException',
  })
  kmsMock.on(SignCommand).rejects(awsErr)
  const signer = createAwsKmsSigner(VALID_ENV, { client })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) }),
    /kms signature rejected/,
  )
  kmsMock.restore()
})

test('AccessDeniedException maps to "kms unauthorized"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  // Fail at GetPublicKey to test the address-fetch error path.
  const awsErr = Object.assign(new Error('User not authorized'), {
    name: 'AccessDeniedException',
  })
  kmsMock.on(GetPublicKeyCommand).rejects(awsErr)
  const signer = createAwsKmsSigner(VALID_ENV, { client })
  await assert.rejects(() => signer.getSignerAddress(), /kms unauthorized/)
  kmsMock.restore()
})

test('ThrottlingException maps to "kms unreachable" (throttled)', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  const throttle = Object.assign(new Error('Rate exceeded'), {
    name: 'ThrottlingException',
  })
  kmsMock.on(SignCommand).rejects(throttle)
  const signer = createAwsKmsSigner(VALID_ENV, { client })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) }),
    /kms unreachable.*throttled/,
  )
  kmsMock.restore()
})

test('Network-class error maps to "kms unreachable" (network)', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  const netErr = Object.assign(
    new Error('getaddrinfo ENOTFOUND kms.us-east-1.amazonaws.com'),
    { name: 'Error' },
  )
  kmsMock.on(GetPublicKeyCommand).rejects(netErr)
  const signer = createAwsKmsSigner(VALID_ENV, { client })
  await assert.rejects(() => signer.getSignerAddress(), /kms unreachable.*network/)
  kmsMock.restore()
})

test('KMSInvalidStateException (disabled key) maps to "kms key unavailable"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  const stateErr = Object.assign(new Error('Key disabled'), {
    name: 'KMSInvalidStateException',
  })
  kmsMock.on(SignCommand).rejects(stateErr)
  const signer = createAwsKmsSigner(VALID_ENV, { client })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) }),
    /kms key unavailable/,
  )
  kmsMock.restore()
})

test('InvalidKeyUsageException maps to "kms key wrong usage"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  const usageErr = Object.assign(new Error('Wrong KeyUsage'), {
    name: 'InvalidKeyUsageException',
  })
  kmsMock.on(SignCommand).rejects(usageErr)
  const signer = createAwsKmsSigner(VALID_ENV, { client })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) }),
    /kms key wrong usage/,
  )
  kmsMock.restore()
})

test('Sign response with missing Signature throws a clean error', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  kmsMock.on(SignCommand).resolves({})
  const signer = createAwsKmsSigner(VALID_ENV, { client })
  await assert.rejects(
    () => signer.signA2AAction({ ...BINDING, digest: new Uint8Array(32) }),
    /Sign returned no signature/,
  )
  kmsMock.restore()
})

test('GetPublicKey response with missing PublicKey throws a clean error', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({})
  const signer = createAwsKmsSigner(VALID_ENV, { client })
  await assert.rejects(() => signer.getSignerAddress(), /GetPublicKey returned no key material/)
  kmsMock.restore()
})
