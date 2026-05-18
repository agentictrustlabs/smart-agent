/**
 * Unit tests for `apps/web/src/lib/key-custody/aws-kms.ts` (Sprint S1.1).
 *
 * Mirrors the testing approach used by `apps/a2a-agent/test/aws-kms-signer.test.ts`:
 * `aws-sdk-client-mock` intercepts every `KMSClient.send(...)` call so we
 * never reach AWS. KMS Sign responses are real secp256k1 signatures
 * generated locally with `@noble/curves` from a known test private key,
 * DER-encoded, and handed back to the custody backend; everything
 * downstream of the SDK boundary (DER decode, low-s normalize, recovery-id
 * derivation, EVM address derivation) runs unmodified against this
 * realistic mock output.
 *
 * Run: `pnpm --filter @smart-agent/web test` (executes the wider suite).
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
import { SECP256K1_N, SECP256K1_N_HALF } from '@smart-agent/sdk/key-custody'
import { createAwsKmsCustody } from '../aws-kms'

// ─── Test fixtures ────────────────────────────────────────────────────

const VALID_ENV = {
  AWS_REGION: 'us-east-1',
  AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/SmartAgentWeb',
  AWS_WEB_SESSION_SIGNER_KEY_ID:
    'arn:aws:kms:us-east-1:111122223333:key/0123abcd-4567-89ef-0123-456789abcdef',
}

// Deterministic test private key — drives realistic KMS Sign mocks.
const TEST_PRIV_HEX = 'a7'.repeat(32)
function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16)
  }
  return out
}
const TEST_PRIV = hexToBytes(TEST_PRIV_HEX)
const TEST_PUB_UNCOMPRESSED = secp256k1.getPublicKey(TEST_PRIV, false) // 65 bytes
const TEST_PUB_RAW = TEST_PUB_UNCOMPRESSED.slice(1) // 64 bytes
const EXPECTED_ADDR_BYTES = keccak_256(TEST_PUB_RAW).slice(-20)
const EXPECTED_ADDR = ('0x' +
  Array.from(EXPECTED_ADDR_BYTES)
    .map((b) => (b < 16 ? '0' : '') + b.toString(16))
    .join('')) as `0x${string}`

// ─── DER + SPKI helpers (mirror image of `der-utils.ts`) ──────────────

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
  return new Uint8Array([0x02, len, ...bytes])
}

function encodeDerSequence(...elements: Uint8Array[]): Uint8Array {
  const body = elements.reduce((acc, x) => acc + x.length, 0)
  if (body >= 0x80) {
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

function buildSpki(sec1Point65: Uint8Array): Uint8Array {
  if (sec1Point65.length !== 65 || sec1Point65[0] !== 0x04) {
    throw new Error('test helper: bad SEC1 point')
  }
  const oidEcPublicKey = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
  const oidSecp256k1 = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a])
  const algId = encodeDerSequence(oidEcPublicKey, oidSecp256k1)
  const bitStringBody = new Uint8Array(1 + sec1Point65.length)
  bitStringBody[0] = 0x00
  bitStringBody.set(sec1Point65, 1)
  const bitString = new Uint8Array(2 + bitStringBody.length)
  bitString[0] = 0x03
  bitString[1] = bitStringBody.length
  bitString.set(bitStringBody, 2)
  return encodeDerSequence(algId, bitString)
}

const VALID_SPKI = buildSpki(TEST_PUB_UNCOMPRESSED)

function mockKmsSignature(msgHash: Uint8Array, opts: { highS?: boolean } = {}): Uint8Array {
  const sig = secp256k1.sign(msgHash, TEST_PRIV, { lowS: !opts.highS })
  let s = sig.s
  if (opts.highS && s <= SECP256K1_N_HALF) {
    s = SECP256K1_N - s
  }
  return encodeDerEcdsaSig(sig.r, s)
}

// ─── Constructor validation ───────────────────────────────────────────

test('aws-kms-custody: constructor rejects missing AWS_REGION', () => {
  assert.throws(
    () => createAwsKmsCustody({ ...VALID_ENV, AWS_REGION: '' }),
    /AWS_REGION is required/,
  )
})

test('aws-kms-custody: constructor rejects malformed AWS_ROLE_ARN', () => {
  assert.throws(
    () => createAwsKmsCustody({ ...VALID_ENV, AWS_ROLE_ARN: 'not-an-arn' }),
    /AWS_ROLE_ARN must match/,
  )
})

test('aws-kms-custody: constructor rejects malformed AWS_WEB_SESSION_SIGNER_KEY_ID', () => {
  assert.throws(
    () =>
      createAwsKmsCustody({ ...VALID_ENV, AWS_WEB_SESSION_SIGNER_KEY_ID: 'not-a-key' }),
    /AWS_WEB_SESSION_SIGNER_KEY_ID must be/,
  )
})

test('aws-kms-custody: constructor accepts a bare UUID key id', () => {
  const custody = createAwsKmsCustody(
    {
      ...VALID_ENV,
      AWS_WEB_SESSION_SIGNER_KEY_ID: '0123abcd-4567-89ef-0123-456789abcdef',
    },
    { client: new KMSClient({ region: 'us-east-1' }) },
  )
  assert.ok(custody)
})

// ─── Public-key cache + address derivation ────────────────────────────

test('aws-kms-custody: getPublicKey is cached across multiple sign calls', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  kmsMock.on(SignCommand).callsFake((input: { Message?: Uint8Array }) => {
    return { Signature: mockKmsSignature(input.Message!) }
  })

  const custody = createAwsKmsCustody(VALID_ENV, { client })
  const sig1 = await custody.deriveSigner('session-1')
  const sig2 = await custody.deriveSigner('session-2')

  // Same KMS key → same address for every session.
  assert.equal(sig1.address.toLowerCase(), EXPECTED_ADDR.toLowerCase())
  assert.equal(sig2.address.toLowerCase(), EXPECTED_ADDR.toLowerCase())

  // Issue several signs across both signers.
  const digestA = ('0x' + 'aa'.repeat(32)) as `0x${string}`
  const digestB = ('0x' + 'bb'.repeat(32)) as `0x${string}`
  await sig1.sign(digestA)
  await sig2.sign(digestB)
  await sig1.sign(digestA)
  await sig2.sign(digestB)

  assert.equal(
    kmsMock.commandCalls(GetPublicKeyCommand).length,
    1,
    'GetPublicKey must be called exactly once across all derivations',
  )
  assert.equal(kmsMock.commandCalls(SignCommand).length, 4)
  kmsMock.restore()
})

// ─── Sign round-trip ──────────────────────────────────────────────────

test('aws-kms-custody: sign round-trip — recovered address matches cached address', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  kmsMock.on(SignCommand).callsFake((input: { Message?: Uint8Array }) => {
    return { Signature: mockKmsSignature(input.Message!) }
  })

  const custody = createAwsKmsCustody(VALID_ENV, { client })
  const signer = await custody.deriveSigner('round-trip-session')

  const message = 'hello-web-kms'
  const digestBytes = hexToBytes(hashMessage(message).slice(2))
  const digestHex = toHex(digestBytes) as `0x${string}`
  const signature = await signer.sign(digestHex)

  // Wire format: 0x + 65 bytes hex = 132 chars + 2 for prefix.
  assert.equal(signature.length, 2 + 65 * 2)
  const sigBytes = hexToBytes(signature.slice(2))
  assert.ok(sigBytes[64] === 27 || sigBytes[64] === 28, 'v in {27, 28}')

  // viem recoverMessageAddress confirms the signature recovers to the
  // KMS-cached signer address.
  const recovered = await recoverMessageAddress({ message, signature })
  assert.equal(recovered.toLowerCase(), EXPECTED_ADDR.toLowerCase())
  kmsMock.restore()
})

test('aws-kms-custody: low-s normalization end-to-end', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  kmsMock.on(SignCommand).callsFake((input: { Message?: Uint8Array }) => {
    // Force high-s output so the normalization branch runs.
    return { Signature: mockKmsSignature(input.Message!, { highS: true }) }
  })

  const custody = createAwsKmsCustody(VALID_ENV, { client })
  const signer = await custody.deriveSigner('lows-session')

  // Sweep multiple digests so we hit both recovery-id paths.
  for (let i = 0; i < 8; i++) {
    const digestBytes = new Uint8Array(32)
    digestBytes[0] = 0xff
    digestBytes[31] = i
    const digestHex = toHex(digestBytes) as `0x${string}`
    const signature = await signer.sign(digestHex)
    const sigBytes = hexToBytes(signature.slice(2))
    let s = 0n
    for (let j = 32; j < 64; j++) s = (s << 8n) | BigInt(sigBytes[j]!)
    assert.ok(s <= SECP256K1_N_HALF, `iter ${i}: s must be low (got ${s.toString(16)})`)

    // Recovery still works against the cached pubkey after normalization.
    const recovered = secp256k1.Signature.fromCompact(sigBytes.slice(0, 64))
      .addRecoveryBit((sigBytes[64]! - 27) as 0 | 1)
      .recoverPublicKey(digestBytes)
      .toRawBytes(false)
    assert.equal(
      Buffer.from(recovered.slice(1)).toString('hex'),
      Buffer.from(TEST_PUB_RAW).toString('hex'),
      `iter ${i}: recovered pubkey must match cached`,
    )
  }
  kmsMock.restore()
})

test('aws-kms-custody: recovery-id derivation correctness via signWithDerivedSigner', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  kmsMock.on(SignCommand).callsFake((input: { Message?: Uint8Array }) => {
    return { Signature: mockKmsSignature(input.Message!) }
  })

  const custody = createAwsKmsCustody(VALID_ENV, { client })

  // signWithDerivedSigner is the path used by wallet-action dispatch.
  for (let i = 0; i < 6; i++) {
    const digestBytes = new Uint8Array(32)
    digestBytes[10] = i
    digestBytes[20] = (i * 7) & 0xff
    const digestHex = toHex(digestBytes) as `0x${string}`
    const { address, signature } = await custody.signWithDerivedSigner(
      `sess-${i}`,
      digestHex,
    )
    assert.equal(address.toLowerCase(), EXPECTED_ADDR.toLowerCase())
    const sigBytes = hexToBytes(signature.slice(2))
    const recovered = secp256k1.Signature.fromCompact(sigBytes.slice(0, 64))
      .addRecoveryBit((sigBytes[64]! - 27) as 0 | 1)
      .recoverPublicKey(digestBytes)
      .toRawBytes(false)
    assert.equal(
      Buffer.from(recovered.slice(1)).toString('hex'),
      Buffer.from(TEST_PUB_RAW).toString('hex'),
    )
  }
  kmsMock.restore()
})

// ─── Error mapping ────────────────────────────────────────────────────

test('aws-kms-custody: AccessDeniedException → "kms unauthorized"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  const awsErr = Object.assign(new Error('user not authorized'), {
    name: 'AccessDeniedException',
  })
  kmsMock.on(GetPublicKeyCommand).rejects(awsErr)
  const custody = createAwsKmsCustody(VALID_ENV, { client })
  await assert.rejects(() => custody.deriveSigner('s'), /kms unauthorized/)
  kmsMock.restore()
})

test('aws-kms-custody: InvalidCiphertextException maps to "kms ciphertext invalid"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: VALID_SPKI })
  const awsErr = Object.assign(new Error('invalid ciphertext'), {
    name: 'InvalidCiphertextException',
  })
  kmsMock.on(SignCommand).rejects(awsErr)
  const custody = createAwsKmsCustody(VALID_ENV, { client })
  const signer = await custody.deriveSigner('s')
  await assert.rejects(
    () => signer.sign(('0x' + '11'.repeat(32)) as `0x${string}`),
    /kms ciphertext invalid/,
  )
  kmsMock.restore()
})

test('aws-kms-custody: network timeout → "kms unreachable"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  const netErr = Object.assign(
    new Error('getaddrinfo ENOTFOUND kms.us-east-1.amazonaws.com'),
    { name: 'Error' },
  )
  kmsMock.on(GetPublicKeyCommand).rejects(netErr)
  const custody = createAwsKmsCustody(VALID_ENV, { client })
  await assert.rejects(() => custody.deriveSigner('s'), /kms unreachable.*network/)
  kmsMock.restore()
})
