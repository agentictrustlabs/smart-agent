/**
 * Unit tests for `packages/sdk/src/key-custody/aws-kms-mac.ts`
 * (KMS migration K3-extension — AWS KMS HMAC provider).
 *
 * Mocking strategy: `aws-sdk-client-mock` intercepts `KMSClient.send(...)`
 * calls without ever reaching AWS. The provider is built with `deps.client`
 * pointing at a real `KMSClient` instance whose `send` has been stubbed by
 * `mockClient(...)`. Same pattern as `aws-kms-provider.test.ts`.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/aws-kms-mac.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  KMSClient,
  GenerateMacCommand,
  VerifyMacCommand,
} from '@aws-sdk/client-kms'
import { mockClient } from 'aws-sdk-client-mock'
import { createAwsKmsMacProvider } from '@smart-agent/sdk/key-custody'

const VALID_ENV = {
  AWS_REGION: 'us-east-1',
  AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/SmartAgentA2A',
  AWS_KMS_MAC_KEY_ID:
    'arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567',
}

function makeFixedMac(): Uint8Array {
  const m = new Uint8Array(32)
  for (let i = 0; i < 32; i++) m[i] = (i * 7 + 13) & 0xff
  return m
}

function canonical(): Uint8Array {
  return new TextEncoder().encode(
    '1746902400|abc-nonce|/session-store/insert|deadbeef',
  )
}

// ─── Constructor validation ──────────────────────────────────────────

test('createAwsKmsMacProvider rejects empty AWS_REGION', () => {
  assert.throws(
    () => createAwsKmsMacProvider({ ...VALID_ENV, AWS_REGION: '' }),
    /AWS_REGION is required/,
  )
})

test('createAwsKmsMacProvider rejects malformed AWS_ROLE_ARN', () => {
  assert.throws(
    () => createAwsKmsMacProvider({ ...VALID_ENV, AWS_ROLE_ARN: 'nope' }),
    /AWS_ROLE_ARN must match/,
  )
})

test('createAwsKmsMacProvider rejects malformed AWS_KMS_MAC_KEY_ID', () => {
  assert.throws(
    () => createAwsKmsMacProvider({ ...VALID_ENV, AWS_KMS_MAC_KEY_ID: 'nope' }),
    /AWS_KMS_MAC_KEY_ID must be/,
  )
})

test('createAwsKmsMacProvider accepts a bare UUID', () => {
  const provider = createAwsKmsMacProvider(
    { ...VALID_ENV, AWS_KMS_MAC_KEY_ID: '9a8b7c6d-1234-5678-90ab-cdef01234567' },
    { client: new KMSClient({ region: 'us-east-1' }) },
  )
  assert.ok(provider)
})

// ─── generateMac happy path ──────────────────────────────────────────

test('generateMac sends GenerateMacCommand with HMAC_SHA_256 and returns the mac bytes', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const m = mockClient(client)
  const mac = makeFixedMac()
  m.on(GenerateMacCommand).resolves({ Mac: mac, KeyId: VALID_ENV.AWS_KMS_MAC_KEY_ID })

  const provider = createAwsKmsMacProvider(VALID_ENV, { client })
  const message = canonical()
  const out = await provider.generateMac({ canonicalMessage: message })
  assert.deepEqual(Array.from(out.mac), Array.from(mac))
  assert.equal(out.keyId, VALID_ENV.AWS_KMS_MAC_KEY_ID)

  const call = m.commandCalls(GenerateMacCommand)[0]
  assert.ok(call, 'GenerateMac was invoked')
  const input = call.args[0].input
  assert.equal(input.MacAlgorithm, 'HMAC_SHA_256')
  assert.equal(input.KeyId, VALID_ENV.AWS_KMS_MAC_KEY_ID)
  assert.deepEqual(Array.from(input.Message as Uint8Array), Array.from(message))

  m.restore()
})

// ─── verifyMac happy path ────────────────────────────────────────────

test('verifyMac returns {valid: true} when KMS reports MacValid=true', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const m = mockClient(client)
  m.on(VerifyMacCommand).resolves({ MacValid: true, KeyId: VALID_ENV.AWS_KMS_MAC_KEY_ID })

  const provider = createAwsKmsMacProvider(VALID_ENV, { client })
  const out = await provider.verifyMac({ canonicalMessage: canonical(), mac: makeFixedMac() })
  assert.equal(out.valid, true)
  assert.equal(out.keyId, VALID_ENV.AWS_KMS_MAC_KEY_ID)
  m.restore()
})

test('verifyMac returns {valid: false} when KMS reports MacValid=false', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const m = mockClient(client)
  m.on(VerifyMacCommand).resolves({ MacValid: false, KeyId: VALID_ENV.AWS_KMS_MAC_KEY_ID })

  const provider = createAwsKmsMacProvider(VALID_ENV, { client })
  const out = await provider.verifyMac({ canonicalMessage: canonical(), mac: makeFixedMac() })
  assert.equal(out.valid, false)
  m.restore()
})

// ─── verifyMac soft-fails KMSInvalidMacException → {valid: false} ────

test('verifyMac soft-fails to {valid: false} on KMSInvalidMacException', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const m = mockClient(client)
  const awsErr = Object.assign(new Error('invalid mac'), {
    name: 'KMSInvalidMacException',
  })
  m.on(VerifyMacCommand).rejects(awsErr)

  const provider = createAwsKmsMacProvider(VALID_ENV, { client })
  const out = await provider.verifyMac({ canonicalMessage: canonical(), mac: makeFixedMac() })
  // The middleware always wants a boolean; soft-fail prevents a 500 from
  // KMS rejecting an unrelated malformed-input request.
  assert.equal(out.valid, false)
  m.restore()
})

// ─── Error mapping ───────────────────────────────────────────────────

test('generateMac AccessDeniedException → "kms unauthorized"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const m = mockClient(client)
  m.on(GenerateMacCommand).rejects(
    Object.assign(new Error('denied'), { name: 'AccessDeniedException' }),
  )

  const provider = createAwsKmsMacProvider(VALID_ENV, { client })
  await assert.rejects(
    () => provider.generateMac({ canonicalMessage: canonical() }),
    /kms unauthorized/,
  )
  m.restore()
})

test('generateMac ThrottlingException → "kms unreachable"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const m = mockClient(client)
  m.on(GenerateMacCommand).rejects(
    Object.assign(new Error('rate exceeded'), { name: 'ThrottlingException' }),
  )

  const provider = createAwsKmsMacProvider(VALID_ENV, { client })
  await assert.rejects(
    () => provider.generateMac({ canonicalMessage: canonical() }),
    /kms unreachable.*ThrottlingException/,
  )
  m.restore()
})

test('generateMac network error → "kms unreachable"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const m = mockClient(client)
  m.on(GenerateMacCommand).rejects(
    Object.assign(new Error('getaddrinfo ENOTFOUND kms.us-east-1.amazonaws.com'), { name: 'Error' }),
  )

  const provider = createAwsKmsMacProvider(VALID_ENV, { client })
  await assert.rejects(
    () => provider.generateMac({ canonicalMessage: canonical() }),
    /kms unreachable/,
  )
  m.restore()
})

test('generateMac KMSInvalidStateException → "kms key unavailable"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const m = mockClient(client)
  m.on(GenerateMacCommand).rejects(
    Object.assign(new Error('key disabled'), { name: 'KMSInvalidStateException' }),
  )

  const provider = createAwsKmsMacProvider(VALID_ENV, { client })
  await assert.rejects(
    () => provider.generateMac({ canonicalMessage: canonical() }),
    /kms key unavailable/,
  )
  m.restore()
})

// ─── Missing-field response handling ─────────────────────────────────

test('generateMac throws when KMS response is missing the Mac field', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const m = mockClient(client)
  m.on(GenerateMacCommand).resolves({ KeyId: VALID_ENV.AWS_KMS_MAC_KEY_ID })

  const provider = createAwsKmsMacProvider(VALID_ENV, { client })
  await assert.rejects(
    () => provider.generateMac({ canonicalMessage: canonical() }),
    /missing Mac in response/,
  )
  m.restore()
})

// ─── KeyId fallback ──────────────────────────────────────────────────

test('verifyMac falls back to env keyId when KMS response omits it', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const m = mockClient(client)
  m.on(VerifyMacCommand).resolves({ MacValid: true }) // no KeyId

  const provider = createAwsKmsMacProvider(VALID_ENV, { client })
  const out = await provider.verifyMac({ canonicalMessage: canonical(), mac: makeFixedMac() })
  assert.equal(out.keyId, VALID_ENV.AWS_KMS_MAC_KEY_ID)
  m.restore()
})
