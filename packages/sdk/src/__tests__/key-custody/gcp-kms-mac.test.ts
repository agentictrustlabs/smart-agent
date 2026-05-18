/**
 * Unit tests for `packages/sdk/src/key-custody/gcp-kms-mac.ts`
 * (GCP-KMS G-PR-5 — inter-service MAC provider).
 *
 * Mocking strategy: the provider exposes a `kmsClientFactory` dep seam
 * which returns a `MacKmsClientLike` stub. Tests pass a hand-built stub
 * whose `macSign`/`macVerify` methods return configured responses and
 * record the request shape for assertion. NO real Google Cloud KMS or
 * google-auth-library network call is made.
 *
 * Patterned after `apps/a2a-agent/test/aws-kms-mac.test.ts` — every AWS
 * test case has an analogue here, plus GCP-specific CRC32C tripwires
 * that have no AWS equivalent.
 *
 * Run: `node --import tsx --test packages/sdk/src/__tests__/key-custody/gcp-kms-mac.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  createGcpKmsMacProvider,
  crc32c,
  type MacKmsClientLike,
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
  'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/mac-web-to-a2a/cryptoKeyVersions/1'

const VALID_ENV = {
  ...VALID_AUTH_ENV,
  keyVersionPath: VERSION_PATH,
} as const

// A stable shared secret the stub uses to compute HMAC-SHA256 — lets us
// model a realistic round-trip where `macSign` and `macVerify` are
// internally consistent.
const STUB_SECRET = Buffer.from('a'.repeat(64), 'hex')

function canonical(): Uint8Array {
  return new TextEncoder().encode(
    '1746902400|abc-nonce|/session-store/insert|deadbeef',
  )
}

interface CapturedCall {
  op: 'macSign' | 'macVerify'
  request: unknown
}

interface MockKmsResult {
  client: MacKmsClientLike
  calls: CapturedCall[]
}

/**
 * Build a stub `MacKmsClientLike` that records every call into `calls`
 * and produces realistic responses:
 *
 *   - macSign computes HMAC-SHA256 over `data` with STUB_SECRET, echoes
 *     CRC fields based on the supplied data + computed mac.
 *   - macVerify recomputes the HMAC and reports `success: true` iff the
 *     supplied mac equals it.
 *
 * Each method accepts overrides so individual tests can force corruption
 * paths (verifiedDataCrc32c=false, mismatched macCrc, etc.).
 */
function makeMockKms(opts: {
  signResponse?: (req: { data: Uint8Array }) => {
    name?: string
    mac?: Uint8Array
    verifiedDataCrc32c?: boolean
    macCrc32cOverride?: bigint
  }
  signError?: Error
  verifyResponse?: (req: { data: Uint8Array; mac: Uint8Array }) => {
    name?: string
    success?: boolean
    verifiedDataCrc32c?: boolean
    verifiedMacCrc32c?: boolean
  }
  verifyError?: Error
} = {}): MockKmsResult {
  const calls: CapturedCall[] = []
  const client: MacKmsClientLike = {
    async macSign(request) {
      calls.push({ op: 'macSign', request })
      if (opts.signError) throw opts.signError
      const factory: (req: { data: Uint8Array }) => {
        name?: string
        mac?: Uint8Array
        verifiedDataCrc32c?: boolean
        macCrc32cOverride?: bigint
      } =
        opts.signResponse ??
        ((req: { data: Uint8Array }) => ({
          name: VERSION_PATH,
          mac: new Uint8Array(
            createHmac('sha256', STUB_SECRET).update(req.data).digest(),
          ),
          verifiedDataCrc32c: true,
        }))
      const r = factory(request)
      const mac =
        r.mac ??
        new Uint8Array(
          createHmac('sha256', STUB_SECRET).update(request.data).digest(),
        )
      const macCrc = r.macCrc32cOverride ?? crc32c(mac)
      return [
        {
          name: r.name ?? VERSION_PATH,
          mac,
          macCrc32c: { value: macCrc.toString() },
          verifiedDataCrc32c: r.verifiedDataCrc32c ?? true,
        },
      ]
    },
    async macVerify(request) {
      calls.push({ op: 'macVerify', request })
      if (opts.verifyError) throw opts.verifyError
      const factory =
        opts.verifyResponse ??
        ((req: { data: Uint8Array; mac: Uint8Array }) => {
          const expected = new Uint8Array(
            createHmac('sha256', STUB_SECRET).update(req.data).digest(),
          )
          let valid = expected.length === req.mac.length
          if (valid) {
            for (let i = 0; i < expected.length; i++) {
              if (expected[i] !== req.mac[i]) {
                valid = false
                break
              }
            }
          }
          return {
            name: VERSION_PATH,
            success: valid,
            verifiedDataCrc32c: true,
            verifiedMacCrc32c: true,
          }
        })
      const r = factory(request)
      return [
        {
          name: r.name ?? VERSION_PATH,
          success: r.success ?? false,
          verifiedDataCrc32c: r.verifiedDataCrc32c ?? true,
          verifiedMacCrc32c: r.verifiedMacCrc32c ?? true,
        },
      ]
    },
  }
  return { client, calls }
}

// --- Constructor validation -----------------------------------------

test('constructor rejects empty keyVersionPath', () => {
  assert.throws(
    () =>
      createGcpKmsMacProvider(
        { ...VALID_AUTH_ENV, keyVersionPath: '' },
        'web-to-a2a',
      ),
    /keyVersionPath is required/,
  )
})

test('constructor rejects malformed keyVersionPath (no cryptoKeyVersions suffix)', () => {
  assert.throws(
    () =>
      createGcpKmsMacProvider(
        {
          ...VALID_AUTH_ENV,
          keyVersionPath:
            'projects/p/locations/l/keyRings/r/cryptoKeys/k',
        },
        'web-to-a2a',
      ),
    /must match.*cryptoKeyVersions/,
  )
})

test('constructor rejects missing GCP_PROJECT_NUMBER (auth env validation runs)', () => {
  const env = { ...VALID_ENV } as Record<string, string>
  delete env.GCP_PROJECT_NUMBER
  assert.throws(
    () =>
      createGcpKmsMacProvider(
        env as unknown as typeof VALID_ENV,
        'web-to-a2a',
      ),
    /GCP_PROJECT_NUMBER is required/,
  )
})

// --- Provider surface -----------------------------------------------

test("provider.backend === 'gcp-kms' and macKeyId is preserved", () => {
  const { client } = makeMockKms()
  const provider = createGcpKmsMacProvider(VALID_ENV, 'a2a-to-person', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  assert.equal(provider.backend, 'gcp-kms')
  assert.equal(provider.macKeyId, 'a2a-to-person')
  assert.equal(provider.keyVersionPath, VERSION_PATH)
})

// --- generateMac happy path -----------------------------------------

test('generateMac forwards canonicalMessage byte-identical + dataCrc32c', async () => {
  const { client, calls } = makeMockKms()
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  const message = canonical()
  const out = await provider.generateMac({ canonicalMessage: message })

  assert.equal(out.mac.length, 32)
  assert.equal(out.keyId, VERSION_PATH)

  // Stub returned a real HMAC; the provider must have surfaced it verbatim.
  const expected = new Uint8Array(
    createHmac('sha256', STUB_SECRET).update(message).digest(),
  )
  assert.deepEqual(Array.from(out.mac), Array.from(expected))

  // Exactly one macSign call.
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.op, 'macSign')
  const req = calls[0]!.request as {
    name: string
    data: Uint8Array
    dataCrc32c?: { value: string }
  }
  // canonicalMessage forwarded byte-identical.
  assert.deepEqual(Array.from(req.data), Array.from(message))
  // dataCrc32c matches local CRC32C of the message.
  assert.equal(req.dataCrc32c?.value, crc32c(message).toString())
  // Targeted the pinned key version.
  assert.equal(req.name, VERSION_PATH)
})

// --- generateMac CRC32C tripwires -----------------------------------

test('generateMac KMS-side verifiedDataCrc32c=false → throws CRC32C integrity error', async () => {
  const { client } = makeMockKms({
    signResponse: (req) => ({
      mac: new Uint8Array(
        createHmac('sha256', STUB_SECRET).update(req.data).digest(),
      ),
      verifiedDataCrc32c: false,
    }),
  })
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => provider.generateMac({ canonicalMessage: canonical() }),
    /CRC32C integrity check failed on sign data/,
  )
})

test('generateMac response macCrc32c mismatch → throws CRC32C integrity error', async () => {
  const { client } = makeMockKms({
    signResponse: (req) => ({
      mac: new Uint8Array(
        createHmac('sha256', STUB_SECRET).update(req.data).digest(),
      ),
      verifiedDataCrc32c: true,
      // Force a CRC value that does NOT match the actual mac bytes.
      macCrc32cOverride: 0xdeadbeefn,
    }),
  })
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => provider.generateMac({ canonicalMessage: canonical() }),
    /CRC32C integrity check failed on sign mac/,
  )
})

// --- verifyMac round-trip -------------------------------------------

test('verifyMac round-trip: MAC generated by stub verifies as valid: true', async () => {
  const { client } = makeMockKms()
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  const message = canonical()
  const { mac } = await provider.generateMac({ canonicalMessage: message })
  const out = await provider.verifyMac({ canonicalMessage: message, mac })
  assert.equal(out.valid, true)
  assert.equal(out.keyId, VERSION_PATH)
})

test('verifyMac round-trip with tampered canonical message → valid: false', async () => {
  const { client } = makeMockKms()
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  const message = canonical()
  const { mac } = await provider.generateMac({ canonicalMessage: message })
  // Flip a byte in the message — the stub's HMAC won't match anymore,
  // so success comes back false.
  const tampered = new Uint8Array(message)
  tampered[0]! ^= 0xff
  const out = await provider.verifyMac({
    canonicalMessage: tampered,
    mac,
  })
  assert.equal(out.valid, false)
})

test('verifyMac soft-fails to { valid: false } on response.success=false (no throw)', async () => {
  const { client } = makeMockKms({
    verifyResponse: () => ({
      success: false,
      verifiedDataCrc32c: true,
      verifiedMacCrc32c: true,
    }),
  })
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  const out = await provider.verifyMac({
    canonicalMessage: canonical(),
    mac: new Uint8Array(32),
  })
  // The middleware always wants a boolean; soft-fail on success=false
  // mirrors the AWS arm's MacValid=false behaviour.
  assert.equal(out.valid, false)
})

test('verifyMac forwards canonicalMessage + mac + both CRCs verbatim', async () => {
  const { client, calls } = makeMockKms()
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  const message = canonical()
  const mac = new Uint8Array(32)
  for (let i = 0; i < 32; i++) mac[i] = (i * 7 + 13) & 0xff
  await provider.verifyMac({ canonicalMessage: message, mac })

  const req = calls[0]!.request as {
    name: string
    data: Uint8Array
    mac: Uint8Array
    dataCrc32c?: { value: string }
    macCrc32c?: { value: string }
  }
  assert.equal(req.name, VERSION_PATH)
  assert.deepEqual(Array.from(req.data), Array.from(message))
  assert.deepEqual(Array.from(req.mac), Array.from(mac))
  assert.equal(req.dataCrc32c?.value, crc32c(message).toString())
  assert.equal(req.macCrc32c?.value, crc32c(mac).toString())
})

// --- verifyMac CRC32C tripwires -------------------------------------

test('verifyMac KMS-side verifiedDataCrc32c=false → throws CRC32C integrity error', async () => {
  const { client } = makeMockKms({
    verifyResponse: () => ({
      success: true,
      verifiedDataCrc32c: false,
      verifiedMacCrc32c: true,
    }),
  })
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () =>
      provider.verifyMac({
        canonicalMessage: canonical(),
        mac: new Uint8Array(32),
      }),
    /CRC32C integrity check failed on verify data/,
  )
})

test('verifyMac KMS-side verifiedMacCrc32c=false → throws CRC32C integrity error', async () => {
  const { client } = makeMockKms({
    verifyResponse: () => ({
      success: true,
      verifiedDataCrc32c: true,
      verifiedMacCrc32c: false,
    }),
  })
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () =>
      provider.verifyMac({
        canonicalMessage: canonical(),
        mac: new Uint8Array(32),
      }),
    /CRC32C integrity check failed on verify mac/,
  )
})

// --- Error preservation (IAM denied, KEY_DISABLED) ------------------

test('generateMac preserves PERMISSION_DENIED gRPC code in re-thrown message', async () => {
  const grpcErr = Object.assign(new Error('7 PERMISSION_DENIED: caller is missing kms.macSign'), {
    code: 7,
  })
  const { client } = makeMockKms({ signError: grpcErr })
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => provider.generateMac({ canonicalMessage: canonical() }),
    /gcp-kms-mac \(sign\):.*PERMISSION_DENIED/,
  )
})

test('generateMac preserves FAILED_PRECONDITION (KEY_DISABLED) in re-thrown message', async () => {
  const grpcErr = Object.assign(
    new Error('9 FAILED_PRECONDITION: key version is DISABLED'),
    { code: 9 },
  )
  const { client } = makeMockKms({ signError: grpcErr })
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () => provider.generateMac({ canonicalMessage: canonical() }),
    /gcp-kms-mac \(sign\):.*FAILED_PRECONDITION/,
  )
})

test('verifyMac preserves PERMISSION_DENIED gRPC code in re-thrown message', async () => {
  const grpcErr = Object.assign(
    new Error('7 PERMISSION_DENIED: caller is missing kms.macVerify'),
    { code: 7 },
  )
  const { client } = makeMockKms({ verifyError: grpcErr })
  const provider = createGcpKmsMacProvider(VALID_ENV, 'web-to-a2a', {
    kmsClientFactory: () => client,
    gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
  })
  await assert.rejects(
    () =>
      provider.verifyMac({
        canonicalMessage: canonical(),
        mac: new Uint8Array(32),
      }),
    /gcp-kms-mac \(verify\):.*PERMISSION_DENIED/,
  )
})

// --- Defense-in-depth: per-key isolation ----------------------------

test('Two providers with different keyVersionPaths produce different MACs', async () => {
  // Each key version is an independent secret. The stub simulates this
  // by deriving its HMAC key from the keyVersionPath itself, so two
  // providers built with different version paths must yield different
  // MAC bytes for the same canonical message.
  const messageA = canonical()
  function buildProviderForVersion(versionPath: string) {
    const secret = createHmac('sha256', 'stub-master').update(versionPath).digest()
    const client: MacKmsClientLike = {
      async macSign(request) {
        const mac = new Uint8Array(
          createHmac('sha256', secret).update(request.data).digest(),
        )
        return [
          {
            name: versionPath,
            mac,
            macCrc32c: { value: crc32c(mac).toString() },
            verifiedDataCrc32c: true,
          },
        ]
      },
      async macVerify() {
        return [
          {
            success: false,
            verifiedDataCrc32c: true,
            verifiedMacCrc32c: true,
          },
        ]
      },
    }
    return createGcpKmsMacProvider(
      { ...VALID_AUTH_ENV, keyVersionPath: versionPath },
      'web-to-a2a',
      {
        kmsClientFactory: () => client,
        gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
      },
    )
  }
  const a = buildProviderForVersion(
    'projects/x/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',
  )
  const b = buildProviderForVersion(
    'projects/x/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/2',
  )
  const { mac: macA } = await a.generateMac({ canonicalMessage: messageA })
  const { mac: macB } = await b.generateMac({ canonicalMessage: messageA })
  assert.notDeepEqual(
    Array.from(macA),
    Array.from(macB),
    'different keyVersions must yield different MACs',
  )
})
