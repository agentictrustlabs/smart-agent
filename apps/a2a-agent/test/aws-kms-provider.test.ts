/**
 * Unit tests for `packages/sdk/src/key-custody/aws-kms-provider.ts`
 * (KMS migration K2 / §9.2 of plan).
 *
 * Mocking strategy: `aws-sdk-client-mock` (the standard AWS SDK v3 mocker)
 * intercepts `KMSClient.send(...)` calls without ever reaching AWS. The
 * provider is built with `deps.client` pointing at a real `KMSClient`
 * instance whose `send` has been stubbed by `mockClient(...)`.
 *
 * Why this test file lives in `apps/a2a-agent/test/` rather than
 * `packages/sdk/src/__tests__/key-custody/`:
 *   - The `aws-sdk-client-mock` dev dep stays out of the published sdk
 *     package — the sdk publishes only the implementation; mocking is
 *     co-located with the integration code that wires it.
 *   - Matches the precedent set by `apps/a2a-agent/test/encryption.test.ts`
 *     which exercises sdk code via the a2a-agent integration.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/aws-kms-provider.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms'
import { mockClient } from 'aws-sdk-client-mock'
import {
  createAwsKmsProvider,
  extractKmsKeyUuid,
} from '@smart-agent/sdk/key-custody'

// --- Test fixtures ---------------------------------------------------

const VALID_ENV = {
  AWS_REGION: 'us-east-1',
  AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/SmartAgentA2A',
  AWS_KMS_KEY_ID:
    'arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567',
}

const EXPECTED_KEY_VERSION = 'aws-kms:9a8b7c6d-1234-5678-90ab-cdef01234567'

const AAD_CONTEXT = {
  sessionId: 'sa_test_session_001',
  accountAddress: '0xabc0000000000000000000000000000000000001',
  chainId: '31337',
  expiresAt: '2026-05-20T00:00:00.000Z',
}

function makeFixedKey(): Uint8Array {
  const k = new Uint8Array(32)
  for (let i = 0; i < 32; i++) k[i] = (i * 7 + 13) & 0xff
  return k
}

function makeCiphertext(): Uint8Array {
  // The CiphertextBlob is opaque to us — AWS includes the encryption-
  // context binding inside its MAC. For tests we use any constant blob.
  return new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x02, 0x03, 0x04, 0x05])
}

// --- Constructor validation -----------------------------------------

test('constructor rejects empty AWS_REGION', () => {
  assert.throws(
    () =>
      createAwsKmsProvider({
        ...VALID_ENV,
        AWS_REGION: '',
      }),
    /AWS_REGION is required/,
  )
})

test('constructor rejects malformed AWS_ROLE_ARN', () => {
  assert.throws(
    () =>
      createAwsKmsProvider({
        ...VALID_ENV,
        AWS_ROLE_ARN: 'not-an-arn',
      }),
    /AWS_ROLE_ARN must match/,
  )
})

test('constructor rejects malformed AWS_KMS_KEY_ID', () => {
  assert.throws(
    () =>
      createAwsKmsProvider({
        ...VALID_ENV,
        AWS_KMS_KEY_ID: 'not-a-key-id',
      }),
    /AWS_KMS_KEY_ID must be/,
  )
})

test('constructor accepts a bare UUID for AWS_KMS_KEY_ID', () => {
  const provider = createAwsKmsProvider(
    {
      ...VALID_ENV,
      AWS_KMS_KEY_ID: '9a8b7c6d-1234-5678-90ab-cdef01234567',
    },
    { client: new KMSClient({ region: 'us-east-1' }) },
  )
  assert.ok(provider)
})

test('constructor accepts an alias for AWS_KMS_KEY_ID', () => {
  const provider = createAwsKmsProvider(
    {
      ...VALID_ENV,
      AWS_KMS_KEY_ID: 'alias/smart-agent-session-encryption',
    },
    { client: new KMSClient({ region: 'us-east-1' }) },
  )
  assert.ok(provider)
})

test('extractKmsKeyUuid extracts the UUID from a key ARN', () => {
  assert.equal(
    extractKmsKeyUuid(
      'arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567',
    ),
    '9a8b7c6d-1234-5678-90ab-cdef01234567',
  )
})

test('extractKmsKeyUuid returns bare UUID unchanged', () => {
  assert.equal(
    extractKmsKeyUuid('9a8b7c6d-1234-5678-90ab-cdef01234567'),
    '9a8b7c6d-1234-5678-90ab-cdef01234567',
  )
})

// --- Round-trip happy path ------------------------------------------

test('generateSessionDataKey round-trip — EncryptionContext forwarded verbatim, keyVersion derived from ARN', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  const plaintext = makeFixedKey()
  const ciphertext = makeCiphertext()

  kmsMock.on(GenerateDataKeyCommand).resolves({
    Plaintext: plaintext,
    CiphertextBlob: ciphertext,
    KeyId: VALID_ENV.AWS_KMS_KEY_ID,
  })
  kmsMock.on(DecryptCommand).resolves({
    Plaintext: plaintext,
    KeyId: VALID_ENV.AWS_KMS_KEY_ID,
  })

  const provider = createAwsKmsProvider(VALID_ENV, { client })

  const dk = await provider.generateSessionDataKey({ aadContext: AAD_CONTEXT })
  assert.equal(dk.plaintextDataKey.length, 32)
  assert.equal(dk.keyId, VALID_ENV.AWS_KMS_KEY_ID)
  assert.equal(dk.keyVersion, EXPECTED_KEY_VERSION)
  assert.deepEqual(Array.from(dk.plaintextDataKey), Array.from(plaintext))
  assert.deepEqual(Array.from(dk.encryptedDataKey), Array.from(ciphertext))

  // Verify EncryptionContext was forwarded verbatim.
  const generateCall = kmsMock.commandCalls(GenerateDataKeyCommand)[0]
  assert.ok(generateCall, 'GenerateDataKey was called')
  const genInput = generateCall.args[0].input
  assert.deepEqual(genInput.EncryptionContext, AAD_CONTEXT)
  assert.equal(genInput.KeySpec, 'AES_256')
  assert.equal(genInput.KeyId, VALID_ENV.AWS_KMS_KEY_ID)

  // Decrypt round-trip — also forwards EncryptionContext verbatim.
  const back = await provider.decryptSessionDataKey({
    encryptedDataKey: dk.encryptedDataKey,
    aadContext: AAD_CONTEXT,
    keyId: dk.keyId,
    keyVersion: dk.keyVersion,
  })
  assert.deepEqual(Array.from(back), Array.from(plaintext))

  const decryptCall = kmsMock.commandCalls(DecryptCommand)[0]
  assert.ok(decryptCall, 'Decrypt was called')
  assert.deepEqual(decryptCall.args[0].input.EncryptionContext, AAD_CONTEXT)

  kmsMock.restore()
})

// --- InvalidCiphertextException → context mismatch error ------------

test('decryptSessionDataKey maps InvalidCiphertextException to "context mismatch (KMS denied decrypt)"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  // Construct an Error with the AWS-SDK-style name.
  const awsErr = Object.assign(new Error('The ciphertext refers to a ...'), {
    name: 'InvalidCiphertextException',
  })
  kmsMock.on(DecryptCommand).rejects(awsErr)

  const provider = createAwsKmsProvider(VALID_ENV, { client })

  await assert.rejects(
    () =>
      provider.decryptSessionDataKey({
        encryptedDataKey: makeCiphertext(),
        aadContext: AAD_CONTEXT,
        keyId: VALID_ENV.AWS_KMS_KEY_ID,
        keyVersion: EXPECTED_KEY_VERSION,
      }),
    /context mismatch \(KMS denied decrypt\)/,
  )
  kmsMock.restore()
})

// --- AccessDeniedException → kms unauthorized -----------------------

test('AccessDeniedException maps to "kms unauthorized"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  const awsErr = Object.assign(new Error('User is not authorized'), {
    name: 'AccessDeniedException',
  })
  kmsMock.on(GenerateDataKeyCommand).rejects(awsErr)

  const provider = createAwsKmsProvider(VALID_ENV, { client })

  await assert.rejects(
    () => provider.generateSessionDataKey({ aadContext: AAD_CONTEXT }),
    /kms unauthorized/,
  )
  kmsMock.restore()
})

// --- ThrottlingException → mapped to "kms unreachable" -------------

test('ThrottlingException surfaces as "kms unreachable" (SDK middleware retry exhausted)', async () => {
  // The AWS SDK's default middleware retries throttling errors with
  // exponential backoff (up to 3 attempts). `aws-sdk-client-mock` short-
  // circuits the middleware, so we can't directly test the retry-then-
  // success path here. Instead we verify that a persistent throttling
  // error (what the caller sees AFTER middleware retries exhaust) is
  // mapped to the clean "kms unreachable" surface error.
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  const throttle = Object.assign(new Error('Rate exceeded'), {
    name: 'ThrottlingException',
  })
  kmsMock.on(GenerateDataKeyCommand).rejects(throttle)

  const provider = createAwsKmsProvider(VALID_ENV, { client })

  await assert.rejects(
    () => provider.generateSessionDataKey({ aadContext: AAD_CONTEXT }),
    /kms unreachable.*ThrottlingException/,
  )
  kmsMock.restore()
})

// --- Network / unreachable -----------------------------------------

test('network-class errors map to "kms unreachable"', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  const netErr = Object.assign(new Error('getaddrinfo ENOTFOUND kms.us-east-1.amazonaws.com'), {
    name: 'Error',
  })
  kmsMock.on(GenerateDataKeyCommand).rejects(netErr)

  const provider = createAwsKmsProvider(VALID_ENV, { client })
  await assert.rejects(
    () => provider.generateSessionDataKey({ aadContext: AAD_CONTEXT }),
    /kms unreachable/,
  )
  kmsMock.restore()
})

// --- keyVersion consistency across encrypt/decrypt ------------------

test('keyVersion is consistent and synchronously knowable across encrypt/decrypt', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  const plaintext = makeFixedKey()
  const ciphertext = makeCiphertext()
  kmsMock.on(GenerateDataKeyCommand).resolves({
    Plaintext: plaintext,
    CiphertextBlob: ciphertext,
    KeyId: VALID_ENV.AWS_KMS_KEY_ID,
  })
  kmsMock.on(DecryptCommand).resolves({ Plaintext: plaintext })

  const provider = createAwsKmsProvider(VALID_ENV, { client })
  const dk1 = await provider.generateSessionDataKey({ aadContext: AAD_CONTEXT })
  const dk2 = await provider.generateSessionDataKey({ aadContext: AAD_CONTEXT })
  // Same provider instance, same key id → identical keyVersion every call.
  assert.equal(dk1.keyVersion, EXPECTED_KEY_VERSION)
  assert.equal(dk2.keyVersion, EXPECTED_KEY_VERSION)

  // Decrypt accepts the same keyVersion verbatim.
  await provider.decryptSessionDataKey({
    encryptedDataKey: dk1.encryptedDataKey,
    aadContext: AAD_CONTEXT,
    keyId: dk1.keyId,
    keyVersion: dk1.keyVersion,
  })

  kmsMock.restore()
})

// --- keyVersion mismatch rejected ----------------------------------

test('decryptSessionDataKey rejects a row whose keyVersion is from a different provider', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  // We never expect the SDK to be called — the provider should reject
  // before reaching network.
  kmsMock.on(DecryptCommand).resolves({ Plaintext: makeFixedKey() })

  const provider = createAwsKmsProvider(VALID_ENV, { client })

  await assert.rejects(
    () =>
      provider.decryptSessionDataKey({
        encryptedDataKey: makeCiphertext(),
        aadContext: AAD_CONTEXT,
        keyId: VALID_ENV.AWS_KMS_KEY_ID,
        keyVersion: 'local-v1', // mismatched
      }),
    /keyVersion mismatch/,
  )
  // Provider should have short-circuited before calling SDK.
  assert.equal(kmsMock.commandCalls(DecryptCommand).length, 0)
  kmsMock.restore()
})

// --- Missing-fields response handling ------------------------------

test('GenerateDataKey response with missing Plaintext throws a clean error', async () => {
  const client = new KMSClient({ region: 'us-east-1' })
  const kmsMock = mockClient(client)
  kmsMock.on(GenerateDataKeyCommand).resolves({
    // Intentionally missing Plaintext + CiphertextBlob.
    KeyId: VALID_ENV.AWS_KMS_KEY_ID,
  })

  const provider = createAwsKmsProvider(VALID_ENV, { client })
  await assert.rejects(
    () => provider.generateSessionDataKey({ aadContext: AAD_CONTEXT }),
    /missing key material/,
  )
  kmsMock.restore()
})
