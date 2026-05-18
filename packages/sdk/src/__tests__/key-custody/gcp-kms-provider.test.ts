/**
 * Unit tests for `packages/sdk/src/key-custody/gcp-kms-provider.ts`
 * (GCP-KMS G-PR-2 — session envelope encryption).
 *
 * Mocking strategy: the provider exposes a `kmsClientFactory` dep seam
 * which returns a `KmsClientLike` stub. Tests pass a hand-built stub
 * whose `encrypt`/`decrypt` methods return configured responses and
 * record the request shape for assertion. NO real Google Cloud KMS or
 * google-auth-library network call is made.
 *
 * Patterned after `apps/a2a-agent/test/aws-kms-provider.test.ts` — every
 * AWS test case has an analogue here, plus GCP-specific CRC32C
 * tripwires that have no AWS equivalent.
 *
 * Run: `node --import tsx --test packages/sdk/src/__tests__/key-custody/gcp-kms-provider.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGcpKmsProvider,
  canonicalContextBytes,
  crc32c,
  type KmsClientLike,
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

const VALID_KEK =
  'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/session-kek'

const VALID_ENV = { ...VALID_AUTH_ENV, GCP_KMS_SESSION_KEK: VALID_KEK } as const

const AAD_CONTEXT = {
  session_id_h: 'a'.repeat(32),
  account_address: '0xabc0000000000000000000000000000000000001',
  chain_id: '31337',
  expires_at: '2026-05-20T00:00:00.000Z',
  key_version: 'gcp-kms:primary',
}

function makeFixedKey(): Uint8Array {
  const k = new Uint8Array(32)
  for (let i = 0; i < 32; i++) k[i] = (i * 7 + 13) & 0xff
  return k
}

function makeCiphertext(): Uint8Array {
  return new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x02, 0x03, 0x04, 0x05])
}

interface CapturedCall {
  op: 'encrypt' | 'decrypt'
  request: unknown
}

interface MockKmsResult {
  client: KmsClientLike
  calls: CapturedCall[]
}

/**
 * Build a stub `KmsClientLike` that records every call into `calls` and
 * returns configured responses. `encryptResponse` / `decryptResponse`
 * are factories so each call can build a CRC over the actual returned
 * plaintext/ciphertext (matching what real KMS does).
 */
function makeMockKms(opts: {
  encryptResponse?: (req: {
    plaintext: Uint8Array
    additionalAuthenticatedData?: Uint8Array
  }) => {
    name?: string
    ciphertext: Uint8Array
    verifiedPlaintextCrc32c?: boolean
    verifiedAdditionalAuthenticatedDataCrc32c?: boolean
  }
  encryptError?: Error
  decryptResponse?: (req: {
    ciphertext: Uint8Array
    additionalAuthenticatedData?: Uint8Array
  }) => {
    plaintext: Uint8Array
    plaintextCrc32cOverride?: bigint
  }
  decryptError?: Error
}): MockKmsResult {
  const calls: CapturedCall[] = []
  const client: KmsClientLike = {
    async encrypt(request) {
      calls.push({ op: 'encrypt', request })
      if (opts.encryptError) throw opts.encryptError
      const factory =
        opts.encryptResponse ??
        ((_req: { plaintext: Uint8Array }) => ({
          name: `${VALID_KEK}/cryptoKeyVersions/7`,
          ciphertext: makeCiphertext(),
          verifiedPlaintextCrc32c: true,
          verifiedAdditionalAuthenticatedDataCrc32c: true,
        }))
      const r = factory(request)
      return [
        {
          name: r.name ?? `${VALID_KEK}/cryptoKeyVersions/7`,
          ciphertext: r.ciphertext,
          verifiedPlaintextCrc32c: r.verifiedPlaintextCrc32c ?? true,
          verifiedAdditionalAuthenticatedDataCrc32c:
            r.verifiedAdditionalAuthenticatedDataCrc32c ?? true,
        },
      ]
    },
    async decrypt(request) {
      calls.push({ op: 'decrypt', request })
      if (opts.decryptError) throw opts.decryptError
      const factory:
        | NonNullable<typeof opts.decryptResponse>
        | ((_req: {
            ciphertext: Uint8Array
            additionalAuthenticatedData?: Uint8Array
          }) => {
            plaintext: Uint8Array
            plaintextCrc32cOverride?: bigint
          }) =
        opts.decryptResponse ??
        ((_req: { ciphertext: Uint8Array }) => ({
          plaintext: makeFixedKey(),
        }))
      const r = factory(request)
      const crc = r.plaintextCrc32cOverride ?? crc32c(r.plaintext)
      return [
        {
          plaintext: r.plaintext,
          plaintextCrc32c: { value: crc.toString() },
        },
      ]
    },
  }
  return { client, calls }
}

// --- Constructor validation -----------------------------------------

test('constructor rejects missing GCP_KMS_SESSION_KEK', () => {
  assert.throws(
    () =>
      createGcpKmsProvider({
        ...VALID_AUTH_ENV,
        GCP_KMS_SESSION_KEK: '',
      }),
    /GCP_KMS_SESSION_KEK is required/,
  )
})

test('constructor rejects malformed GCP_KMS_SESSION_KEK', () => {
  assert.throws(
    () =>
      createGcpKmsProvider({
        ...VALID_AUTH_ENV,
        GCP_KMS_SESSION_KEK: 'not-a-resource-path',
      }),
    /must match.*projects/,
  )
})

test('constructor rejects missing GCP_PROJECT_NUMBER (auth env validation runs)', () => {
  // The provider delegates auth env validation to createGcpAuthClient.
  // Missing GCP_PROJECT_NUMBER must surface as the auth-env error.
  const env = { ...VALID_ENV } as Record<string, string>
  delete env.GCP_PROJECT_NUMBER
  assert.throws(
    () => createGcpKmsProvider(env as unknown as typeof VALID_ENV),
    /GCP_PROJECT_NUMBER is required/,
  )
})

// --- Provider surface -----------------------------------------------

test("provider exposes synchronous keyVersion starting with 'gcp-kms:'", () => {
  const { client } = makeMockKms({})
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  // The keyVersion is needed BEFORE generateSessionDataKey so callers
  // can build the aadContext (which includes 'key_version').
  assert.ok(
    provider.keyVersion.startsWith('gcp-kms:'),
    `keyVersion '${provider.keyVersion}' must start with 'gcp-kms:'`,
  )
})

test("provider.backend === 'gcp-kms'", () => {
  const { client } = makeMockKms({})
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  assert.equal(provider.backend, 'gcp-kms')
})

test("provider with GCP_KMS_SESSION_KEK_VERSION set surfaces it in keyVersion immediately", () => {
  const { client } = makeMockKms({})
  const provider = createGcpKmsProvider(
    {
      ...VALID_ENV,
      GCP_KMS_SESSION_KEK_VERSION: `${VALID_KEK}/cryptoKeyVersions/3`,
    },
    {
      kmsClientFactory: () => client,
      gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
    },
  )
  assert.equal(provider.keyVersion, 'gcp-kms:3')
})

// --- generateSessionDataKey round-trip ------------------------------

test('generateSessionDataKey returns a 32-byte plaintext DEK + wrapped DEK', async () => {
  const fixedKey = makeFixedKey()
  const { client, calls } = makeMockKms({
    encryptResponse: (req) => ({
      name: `${VALID_KEK}/cryptoKeyVersions/7`,
      ciphertext: makeCiphertext(),
      verifiedPlaintextCrc32c: true,
      verifiedAdditionalAuthenticatedDataCrc32c: true,
    }),
  })
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    randomBytes: () => fixedKey,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })

  const dk = await provider.generateSessionDataKey({ aadContext: AAD_CONTEXT })
  assert.equal(dk.plaintextDataKey.length, 32)
  assert.deepEqual(Array.from(dk.plaintextDataKey), Array.from(fixedKey))
  assert.equal(dk.keyId, VALID_KEK)
  // The wrapped DEK comes verbatim from the KMS response ciphertext.
  assert.deepEqual(Array.from(dk.encryptedDataKey), Array.from(makeCiphertext()))
  // Resolved keyVersion came from response.name (suffix '7').
  assert.equal(dk.keyVersion, 'gcp-kms:7')
  // Provider made exactly one encrypt call.
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.op, 'encrypt')
})

test('aadBytes passed to KMS encrypt match canonicalContextBytes(aadContext) verbatim', async () => {
  const { client, calls } = makeMockKms({})
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await provider.generateSessionDataKey({ aadContext: AAD_CONTEXT })

  const expectedAad = canonicalContextBytes(AAD_CONTEXT)
  const req = calls[0]!.request as {
    additionalAuthenticatedData: Uint8Array
  }
  assert.deepEqual(
    Array.from(req.additionalAuthenticatedData),
    Array.from(expectedAad),
    'KMS encrypt additionalAuthenticatedData must equal canonicalContextBytes(aadContext) byte-for-byte',
  )
})

test('aadBytes are byte-identical between encrypt and decrypt (dual-tripwire pattern)', async () => {
  // The KMS-side AAD and the AES-GCM AAD must be IDENTICAL bytes (the
  // caller's encryption.ts feeds the same canonicalContextBytes to
  // both). This test verifies that the provider, given the same
  // aadContext on encrypt and decrypt, computes the same AAD bytes on
  // both paths.
  const { client, calls } = makeMockKms({})
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await provider.generateSessionDataKey({ aadContext: AAD_CONTEXT })
  await provider.decryptSessionDataKey({
    encryptedDataKey: makeCiphertext(),
    aadContext: AAD_CONTEXT,
    keyId: VALID_KEK,
    keyVersion: 'gcp-kms:7',
  })
  const encryptReq = calls[0]!.request as {
    additionalAuthenticatedData: Uint8Array
  }
  const decryptReq = calls[1]!.request as {
    additionalAuthenticatedData: Uint8Array
  }
  assert.deepEqual(
    Array.from(encryptReq.additionalAuthenticatedData),
    Array.from(decryptReq.additionalAuthenticatedData),
    'AAD bytes must be byte-identical on encrypt and decrypt',
  )
})

test('encrypt request includes plaintextCrc32c and additionalAuthenticatedDataCrc32c', async () => {
  const fixedKey = makeFixedKey()
  const { client, calls } = makeMockKms({})
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    randomBytes: () => fixedKey,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await provider.generateSessionDataKey({ aadContext: AAD_CONTEXT })

  const req = calls[0]!.request as {
    plaintextCrc32c?: { value: string }
    additionalAuthenticatedDataCrc32c?: { value: string }
  }
  assert.equal(req.plaintextCrc32c?.value, crc32c(fixedKey).toString())
  assert.equal(
    req.additionalAuthenticatedDataCrc32c?.value,
    crc32c(canonicalContextBytes(AAD_CONTEXT)).toString(),
  )
})

// --- CRC32C integrity tripwires (encrypt side) ----------------------

test('KMS-side verifiedPlaintextCrc32c=false → throws CRC32C integrity error on plaintext', async () => {
  const { client } = makeMockKms({
    encryptResponse: () => ({
      name: `${VALID_KEK}/cryptoKeyVersions/7`,
      ciphertext: makeCiphertext(),
      verifiedPlaintextCrc32c: false,
      verifiedAdditionalAuthenticatedDataCrc32c: true,
    }),
  })
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => provider.generateSessionDataKey({ aadContext: AAD_CONTEXT }),
    /CRC32C integrity check failed on encrypt plaintext/,
  )
})

test('KMS-side verifiedAdditionalAuthenticatedDataCrc32c=false → throws CRC32C integrity error on AAD', async () => {
  const { client } = makeMockKms({
    encryptResponse: () => ({
      name: `${VALID_KEK}/cryptoKeyVersions/7`,
      ciphertext: makeCiphertext(),
      verifiedPlaintextCrc32c: true,
      verifiedAdditionalAuthenticatedDataCrc32c: false,
    }),
  })
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => provider.generateSessionDataKey({ aadContext: AAD_CONTEXT }),
    /CRC32C integrity check failed on encrypt additionalAuthenticatedData/,
  )
})

// --- CRC32C integrity tripwire (decrypt side) -----------------------

test('decryptSessionDataKey: response.plaintextCrc32c mismatch → throws CRC32C integrity error', async () => {
  const fakePlaintext = makeFixedKey()
  const { client } = makeMockKms({
    decryptResponse: () => ({
      plaintext: fakePlaintext,
      // Force a CRC value that does NOT match the actual plaintext bytes.
      plaintextCrc32cOverride: 0xdeadbeefn,
    }),
  })
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () =>
      provider.decryptSessionDataKey({
        encryptedDataKey: makeCiphertext(),
        aadContext: AAD_CONTEXT,
        keyId: VALID_KEK,
        keyVersion: 'gcp-kms:7',
      }),
    /CRC32C integrity check failed on decrypt plaintext/,
  )
})

// --- decrypt key-version strictness ---------------------------------

test("decryptSessionDataKey rejects keyVersion not starting with 'gcp-kms:'", async () => {
  const { client, calls } = makeMockKms({})
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () =>
      provider.decryptSessionDataKey({
        encryptedDataKey: makeCiphertext(),
        aadContext: AAD_CONTEXT,
        keyId: VALID_KEK,
        keyVersion: 'aws-kms:9a8b7c6d', // cross-backend row tag
      }),
    /keyVersion mismatch/,
  )
  // Provider must short-circuit BEFORE calling the KMS client.
  assert.equal(calls.length, 0)
})

test("decryptSessionDataKey rejects keyVersion 'local-v1'", async () => {
  const { client, calls } = makeMockKms({})
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () =>
      provider.decryptSessionDataKey({
        encryptedDataKey: makeCiphertext(),
        aadContext: AAD_CONTEXT,
        keyId: VALID_KEK,
        keyVersion: 'local-v1',
      }),
    /keyVersion mismatch/,
  )
  assert.equal(calls.length, 0)
})

// --- Error preservation: tampered AAD on decrypt --------------------

test('tampering aadContext on decrypt: mocked KMS returns INVALID_ARGUMENT; provider re-throws with KMS error code preserved', async () => {
  const kmsErr = Object.assign(new Error('INVALID_ARGUMENT: ciphertext failed authentication'), {
    code: 3, // gRPC INVALID_ARGUMENT
  })
  const { client } = makeMockKms({ decryptError: kmsErr })
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () =>
      provider.decryptSessionDataKey({
        encryptedDataKey: makeCiphertext(),
        aadContext: AAD_CONTEXT,
        keyId: VALID_KEK,
        keyVersion: 'gcp-kms:7',
      }),
    /gcp-kms-provider \(decrypt\):.*INVALID_ARGUMENT/,
  )
})

// --- Error preservation: key not found on decrypt -------------------

test('cross-version tamper: decrypt against different keyId → mocked KMS returns NOT_FOUND; provider re-throws preserving error code', async () => {
  const kmsErr = Object.assign(
    new Error('NOT_FOUND: CryptoKey projects/.../wrong-key not found'),
    { code: 5 }, // gRPC NOT_FOUND
  )
  const { client } = makeMockKms({ decryptError: kmsErr })
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () =>
      provider.decryptSessionDataKey({
        encryptedDataKey: makeCiphertext(),
        aadContext: AAD_CONTEXT,
        keyId: 'projects/different/locations/global/keyRings/x/cryptoKeys/y',
        keyVersion: 'gcp-kms:7',
      }),
    /gcp-kms-provider \(decrypt\):.*NOT_FOUND/,
  )
})

// --- Error preservation: IAM denied on encrypt ----------------------

test('PERMISSION_DENIED on encrypt → provider re-throws preserving error code', async () => {
  const kmsErr = Object.assign(
    new Error('PERMISSION_DENIED: caller does not have cloudkms.cryptoKeyEncrypterDecrypter'),
    { code: 7 }, // gRPC PERMISSION_DENIED
  )
  const { client } = makeMockKms({ encryptError: kmsErr })
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => provider.generateSessionDataKey({ aadContext: AAD_CONTEXT }),
    /gcp-kms-provider \(encrypt\):.*PERMISSION_DENIED/,
  )
})

// --- Audit event emission -------------------------------------------

test('successful encrypt emits a gcp-kms-encrypt audit event with key id, version, and bytes-out', async () => {
  const { client } = makeMockKms({})
  const captured: unknown[] = []
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
    audit: (event) => {
      captured.push(event)
    },
  })
  await provider.generateSessionDataKey({ aadContext: AAD_CONTEXT })
  assert.equal(captured.length, 1)
  const event = captured[0] as {
    eventType: string
    keyId: string
    keyVersion: string
    bytesOut: number
  }
  assert.equal(event.eventType, 'gcp-kms-encrypt')
  assert.equal(event.keyId, VALID_KEK)
  assert.equal(event.keyVersion, 'gcp-kms:7')
  assert.equal(event.bytesOut, makeCiphertext().length)
})

test('successful decrypt emits a gcp-kms-decrypt audit event', async () => {
  const { client } = makeMockKms({})
  const captured: unknown[] = []
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
    audit: (event) => {
      captured.push(event)
    },
  })
  await provider.decryptSessionDataKey({
    encryptedDataKey: makeCiphertext(),
    aadContext: AAD_CONTEXT,
    keyId: VALID_KEK,
    keyVersion: 'gcp-kms:7',
  })
  assert.equal(captured.length, 1)
  const event = captured[0] as { eventType: string; keyVersion: string }
  assert.equal(event.eventType, 'gcp-kms-decrypt')
  assert.equal(event.keyVersion, 'gcp-kms:7')
})

// --- Full round-trip ------------------------------------------------

test('full encrypt → decrypt round-trip with mocked KMS', async () => {
  const fixedKey = makeFixedKey()
  const ciphertext = makeCiphertext()
  const { client } = makeMockKms({
    encryptResponse: () => ({
      name: `${VALID_KEK}/cryptoKeyVersions/7`,
      ciphertext,
      verifiedPlaintextCrc32c: true,
      verifiedAdditionalAuthenticatedDataCrc32c: true,
    }),
    decryptResponse: () => ({ plaintext: fixedKey }),
  })
  const provider = createGcpKmsProvider(VALID_ENV, {
    kmsClientFactory: () => client,
    randomBytes: () => fixedKey,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })

  const dk = await provider.generateSessionDataKey({ aadContext: AAD_CONTEXT })
  const recovered = await provider.decryptSessionDataKey({
    encryptedDataKey: dk.encryptedDataKey,
    aadContext: AAD_CONTEXT,
    keyId: dk.keyId,
    keyVersion: dk.keyVersion,
  })
  assert.deepEqual(Array.from(recovered), Array.from(fixedKey))
})
