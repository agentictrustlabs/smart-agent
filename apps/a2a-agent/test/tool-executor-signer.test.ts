/**
 * Unit tests for the K5 tool-executor signer registry.
 *
 * Covers:
 *   - the SDK factory (`createToolExecutorSigner`) under both local-aes
 *     and aws-kms backends — construction success + clean error
 *     messages on missing env;
 *   - the env-key naming convention (`toolEnvKeyName`) — verify the
 *     SCREAMING_SNAKE_CASE conversion matches the legacy
 *     deploy-local.sh convention;
 *   - per-tool address derivation under local-aes — distinct keys
 *     produce distinct addresses;
 *   - the apps/a2a-agent integration via `getToolExecutorSigner` —
 *     cache hit on the second call, different addresses across tool
 *     ids when keys differ, reset hook drops the cache.
 *
 * The aws-kms construction path is tested for env-validation only —
 * the actual cryptographic round-trip is covered by
 * `aws-kms-signer.test.ts` which exercises the same underlying signer
 * factory.
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { recoverMessageAddress, hashMessage, toHex } from 'viem'
import {
  createToolExecutorSigner,
  crc32c,
  isToolExecutorId,
  listToolExecutorIds,
  toolEnvKeyName,
  TOOL_EXECUTOR_IDS,
  type SignerKmsClientLike,
  type ToolExecutorId,
} from '@smart-agent/sdk/key-custody'
import {
  __resetToolExecutorSignersForTests,
  getToolExecutorSigner,
  getToolExecutorSignerBackend,
} from '../src/auth/a2a-signer'
import { buildToolExecutorBackend } from '../src/auth/key-provider'

// ─── Deterministic dev keys (anvil accounts 5-8, same as
// scripts/deploy-local.sh) so addresses are stable across the tests. ─

const DEV_KEYS: Record<ToolExecutorId, `0x${string}`> = {
  'round-awards':
    '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  disbursement:
    '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b341e916b',
  'pool-lifecycle':
    '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbb4ccf',
  'grant-awards':
    '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  // K6 S1.5 — web-tier bootstrap-auth signer (anvil account #9).
  'auth-bootstrap':
    '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
}

function clearAllToolEnvs() {
  for (const id of TOOL_EXECUTOR_IDS) {
    delete process.env[toolEnvKeyName(id, 'local-aes')]
    delete process.env[toolEnvKeyName(id, 'aws-kms')]
    delete process.env[toolEnvKeyName(id, 'gcp-kms')]
  }
}

// GCP auth identifiers used by the gcp-kms arm tests. None are secrets.
const GCP_AUTH_ENV = {
  GCP_PROJECT_ID: 'smart-agent-prod',
  GCP_PROJECT_NUMBER: '123456789012',
  GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel-pool',
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel-oidc',
  GCP_SERVICE_ACCOUNT_EMAIL:
    'a2a-agent@smart-agent-prod.iam.gserviceaccount.com',
} as const

function gcpVersionPath(toolId: ToolExecutorId): string {
  return `projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/tool-${toolId}/cryptoKeyVersions/1`
}

beforeEach(() => {
  __resetToolExecutorSignersForTests()
  delete process.env.A2A_KMS_BACKEND
  delete process.env.AWS_REGION
  delete process.env.AWS_ROLE_ARN
  delete process.env.NODE_ENV
  for (const key of Object.keys(GCP_AUTH_ENV)) {
    delete process.env[key]
  }
  clearAllToolEnvs()
})

// ─── Constants / type helpers ────────────────────────────────────────

test('TOOL_EXECUTOR_IDS contains the canonical tool families (K5 + K6 S1.5)', () => {
  assert.deepEqual(
    [...TOOL_EXECUTOR_IDS],
    [
      'round-awards',
      'disbursement',
      'pool-lifecycle',
      'grant-awards',
      // K6 S1.5 — web bootstrap-auth signer.
      'auth-bootstrap',
    ],
  )
})

test('isToolExecutorId narrows known + rejects unknown ids', () => {
  assert.equal(isToolExecutorId('round-awards'), true)
  assert.equal(isToolExecutorId('grant-awards'), true)
  assert.equal(isToolExecutorId('not-a-real-tool'), false)
  assert.equal(isToolExecutorId('ROUND_AWARDS'), false) // case-sensitive
})

test('listToolExecutorIds returns a mutable copy of canonical list', () => {
  const a = listToolExecutorIds()
  const b = listToolExecutorIds()
  assert.notEqual(a, b)
  assert.deepEqual(a, b)
})

test('toolEnvKeyName converts tool id → env var per backend', () => {
  assert.equal(
    toolEnvKeyName('round-awards', 'local-aes'),
    'TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY',
  )
  assert.equal(
    toolEnvKeyName('round-awards', 'aws-kms'),
    'AWS_KMS_TOOL_EXECUTOR_ROUND_AWARDS_KEY_ID',
  )
  assert.equal(
    toolEnvKeyName('round-awards', 'gcp-kms'),
    'GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION',
  )
  assert.equal(toolEnvKeyName('round-awards'), 'ROUND_AWARDS')
  // Multi-dash tool id
  assert.equal(
    toolEnvKeyName('pool-lifecycle', 'local-aes'),
    'TOOL_EXECUTOR_POOL_LIFECYCLE_PRIVATE_KEY',
  )
  assert.equal(
    toolEnvKeyName('pool-lifecycle', 'aws-kms'),
    'AWS_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_KEY_ID',
  )
  assert.equal(
    toolEnvKeyName('pool-lifecycle', 'gcp-kms'),
    'GCP_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_VERSION',
  )
})

test('toolEnvKeyName: every canonical tool id has a stable gcp-kms env var name', () => {
  for (const id of TOOL_EXECUTOR_IDS) {
    const expected = `GCP_KMS_TOOL_EXECUTOR_${id.replace(/-/g, '_').toUpperCase()}_VERSION`
    assert.equal(toolEnvKeyName(id, 'gcp-kms'), expected)
  }
})

// ─── SDK factory: createToolExecutorSigner ────────────────────────────

test('local-aes: factory builds a working signer for every tool id', async () => {
  for (const toolId of TOOL_EXECUTOR_IDS) {
    const envName = toolEnvKeyName(toolId, 'local-aes')
    const signer = createToolExecutorSigner(toolId, {
      A2A_KMS_BACKEND: 'local-aes',
      [envName]: DEV_KEYS[toolId],
    })
    const addr = await signer.getSignerAddress()
    const expectedAddr = privateKeyToAccount(DEV_KEYS[toolId]).address
    assert.equal(addr.toLowerCase(), expectedAddr.toLowerCase())
  }
})

test('local-aes: missing env throws with exact env name in error', () => {
  // No env for round-awards
  assert.throws(
    () =>
      createToolExecutorSigner('round-awards', {
        A2A_KMS_BACKEND: 'local-aes',
      }),
    /TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY is required for tool "round-awards"/,
  )
})

test('local-aes: production guard refuses dev signer in NODE_ENV=production', () => {
  assert.throws(
    () =>
      createToolExecutorSigner('round-awards', {
        A2A_KMS_BACKEND: 'local-aes',
        NODE_ENV: 'production',
        TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY: DEV_KEYS['round-awards'],
      }),
    /refusing to instantiate 'local-aes' signer for tool "round-awards" in production/,
  )
})

test("aws-kms: constructs successfully with valid env for every tool id", () => {
  for (const toolId of TOOL_EXECUTOR_IDS) {
    const envName = toolEnvKeyName(toolId, 'aws-kms')
    const signer = createToolExecutorSigner(toolId, {
      A2A_KMS_BACKEND: 'aws-kms',
      AWS_REGION: 'us-east-1',
      AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/SmartAgentA2A',
      [envName]:
        'arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567',
    })
    // Should not throw; backend doesn't contact AWS until first sign call.
    assert.equal(typeof signer.signA2AAction, 'function')
    assert.equal(typeof signer.getSignerAddress, 'function')
  }
})

test("aws-kms: missing AWS_KMS_TOOL_EXECUTOR_* throws with the env name", () => {
  assert.throws(
    () =>
      createToolExecutorSigner('disbursement', {
        A2A_KMS_BACKEND: 'aws-kms',
        AWS_REGION: 'us-east-1',
        AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/SmartAgentA2A',
        // no AWS_KMS_TOOL_EXECUTOR_DISBURSEMENT_KEY_ID
      }),
    /AWS_KMS_TOOL_EXECUTOR_DISBURSEMENT_KEY_ID is required for tool "disbursement"/,
  )
})

test('aws-kms: missing AWS_REGION yields a clean error', () => {
  assert.throws(
    () =>
      createToolExecutorSigner('round-awards', {
        A2A_KMS_BACKEND: 'aws-kms',
        AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/SmartAgentA2A',
        AWS_KMS_TOOL_EXECUTOR_ROUND_AWARDS_KEY_ID:
          'arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567',
      }),
    /AWS_REGION is required for tool "round-awards"/,
  )
})

// ─── GCP KMS mock helpers (mirror image of gcp-kms-signer.test.ts) ───
//
// Tests below pass a `kmsClientFactory` dep seam returning a stub that
// signs with a known secp256k1 private key. The signer's downstream
// logic (DER decode, low-S normalize, recovery-id derivation, address
// derivation) runs unmodified against this realistic mock output, so
// the round-trip assertions in the test exercise the same code paths
// that production would.

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return out
}

const TEST_PRIV_HEX = 'c1'.repeat(32)
const TEST_PRIV = hexToBytes(TEST_PRIV_HEX)
const TEST_PUB_UNCOMPRESSED = secp256k1.getPublicKey(TEST_PRIV, false)
const TEST_PUB_RAW = TEST_PUB_UNCOMPRESSED.slice(1)
const EXPECTED_ADDR_BYTES = keccak_256(TEST_PUB_RAW).slice(-20)
const EXPECTED_ADDR = ('0x' +
  Array.from(EXPECTED_ADDR_BYTES)
    .map((b) => (b < 16 ? '0' : '') + b.toString(16))
    .join('')) as `0x${string}`

function encodeDerInteger(v: bigint): Uint8Array {
  const bytes: number[] = []
  let x = v
  if (x === 0n) bytes.push(0)
  while (x > 0n) {
    bytes.unshift(Number(x & 0xffn))
    x >>= 8n
  }
  if ((bytes[0]! & 0x80) !== 0) bytes.unshift(0)
  return new Uint8Array([0x02, bytes.length, ...bytes])
}
function encodeDerSequence(...elements: Uint8Array[]): Uint8Array {
  const body = elements.reduce((acc, x) => acc + x.length, 0)
  if (body >= 0x80) {
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
  const oidEcPublicKey = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
  const oidSecp256k1 = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a])
  const algId = encodeDerSequence(oidEcPublicKey, oidSecp256k1)
  const bitStringBody = new Uint8Array(1 + sec1Point65.length)
  bitStringBody[0] = 0
  bitStringBody.set(sec1Point65, 1)
  const bitString = new Uint8Array(2 + bitStringBody.length)
  bitString[0] = 0x03
  bitString[1] = bitStringBody.length
  bitString.set(bitStringBody, 2)
  return encodeDerSequence(algId, bitString)
}
function spkiToPem(spki: Uint8Array): string {
  const b64 = Buffer.from(spki).toString('base64')
  const lines: string[] = []
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.substring(i, i + 64))
  }
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`
}

const VALID_PEM = spkiToPem(buildSpki(TEST_PUB_UNCOMPRESSED))

function makeGcpKmsMock(): SignerKmsClientLike {
  return {
    async getPublicKey(_request) {
      return [{ pem: VALID_PEM, name: 'mock-version-path' }]
    },
    async asymmetricSign(request) {
      const digest = request.digest?.sha256 ?? new Uint8Array(32)
      const sig = secp256k1.sign(digest, TEST_PRIV, { lowS: true })
      const der = encodeDerEcdsaSig(sig.r, sig.s)
      return [
        {
          name: 'mock-version-path',
          signature: der,
          signatureCrc32c: { value: crc32c(der).toString() },
          verifiedDigestCrc32c: true,
        },
      ]
    },
  }
}

// ─── SDK factory: gcp-kms arm ────────────────────────────────────────

test('gcp-kms: factory builds a working signer for every tool id', async () => {
  for (const toolId of TOOL_EXECUTOR_IDS) {
    const envName = toolEnvKeyName(toolId, 'gcp-kms')
    const signer = createToolExecutorSigner(
      toolId,
      {
        A2A_KMS_BACKEND: 'gcp-kms',
        ...GCP_AUTH_ENV,
        [envName]: gcpVersionPath(toolId),
      },
      {
        gcpKmsDeps: {
          kmsClientFactory: () => makeGcpKmsMock(),
          gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
        },
      },
    )
    const addr = await signer.getSignerAddress()
    assert.equal(addr.toLowerCase(), EXPECTED_ADDR.toLowerCase())
  }
})

test('gcp-kms: missing GCP_KMS_TOOL_EXECUTOR_<TOOL>_VERSION throws with the env name', () => {
  assert.throws(
    () =>
      createToolExecutorSigner('disbursement', {
        A2A_KMS_BACKEND: 'gcp-kms',
        ...GCP_AUTH_ENV,
        // no GCP_KMS_TOOL_EXECUTOR_DISBURSEMENT_VERSION
      }),
    /GCP_KMS_TOOL_EXECUTOR_DISBURSEMENT_VERSION is required for tool "disbursement"/,
  )
})

test('gcp-kms: missing GCP_PROJECT_NUMBER throws with the env name (SDK factory level)', () => {
  const envName = toolEnvKeyName('round-awards', 'gcp-kms')
  assert.throws(
    () =>
      createToolExecutorSigner('round-awards', {
        A2A_KMS_BACKEND: 'gcp-kms',
        GCP_PROJECT_ID: GCP_AUTH_ENV.GCP_PROJECT_ID,
        // no GCP_PROJECT_NUMBER
        GCP_WORKLOAD_IDENTITY_POOL_ID: GCP_AUTH_ENV.GCP_WORKLOAD_IDENTITY_POOL_ID,
        GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:
          GCP_AUTH_ENV.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
        GCP_SERVICE_ACCOUNT_EMAIL: GCP_AUTH_ENV.GCP_SERVICE_ACCOUNT_EMAIL,
        [envName]: gcpVersionPath('round-awards'),
      }),
    /GCP_PROJECT_NUMBER is required for tool "round-awards"/,
  )
})

test('gcp-kms: signed digest verifies via viem recoverMessageAddress against the signer address', async () => {
  const envName = toolEnvKeyName('grant-awards', 'gcp-kms')
  const signer = createToolExecutorSigner(
    'grant-awards',
    {
      A2A_KMS_BACKEND: 'gcp-kms',
      ...GCP_AUTH_ENV,
      [envName]: gcpVersionPath('grant-awards'),
    },
    {
      gcpKmsDeps: {
        kmsClientFactory: () => makeGcpKmsMock(),
        gcpAuthDeps: { subjectTokenSupplier: async () => 'stub' },
      },
    },
  )
  const message = 'hello-gcp-tool-executor'
  const digest = hexToBytes(hashMessage(message).slice(2))
  const res = await signer.signA2AAction({
    canonicalPayload: new TextEncoder().encode('p'),
    accountAddress: EXPECTED_ADDR,
    chainId: '31337',
    sessionId: 'sess-1',
    actionId: 'act-1',
    digest,
  })
  assert.equal(res.signature.length, 65)
  assert.equal(res.signerAddress.toLowerCase(), EXPECTED_ADDR.toLowerCase())
  const recovered = await recoverMessageAddress({
    message,
    signature: toHex(res.signature),
  })
  assert.equal(recovered.toLowerCase(), EXPECTED_ADDR.toLowerCase())
})

// ─── apps/a2a-agent factory: buildToolExecutorBackend ('gcp-kms') ────

test('buildToolExecutorBackend (gcp-kms): missing GCP_KMS_TOOL_EXECUTOR_<TOOL>_VERSION throws with the env name', () => {
  assert.throws(
    () =>
      buildToolExecutorBackend('round-awards', {
        A2A_KMS_BACKEND: 'gcp-kms',
        ...GCP_AUTH_ENV,
        // no GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION
      }),
    /GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION is required for tool "round-awards"/,
  )
})

test('buildToolExecutorBackend (gcp-kms): missing GCP_PROJECT_NUMBER throws via shared validator', () => {
  const envName = toolEnvKeyName('round-awards', 'gcp-kms')
  assert.throws(
    () =>
      buildToolExecutorBackend('round-awards', {
        A2A_KMS_BACKEND: 'gcp-kms',
        GCP_PROJECT_ID: GCP_AUTH_ENV.GCP_PROJECT_ID,
        // no GCP_PROJECT_NUMBER — shared validator must catch this
        GCP_WORKLOAD_IDENTITY_POOL_ID: GCP_AUTH_ENV.GCP_WORKLOAD_IDENTITY_POOL_ID,
        GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:
          GCP_AUTH_ENV.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
        GCP_SERVICE_ACCOUNT_EMAIL: GCP_AUTH_ENV.GCP_SERVICE_ACCOUNT_EMAIL,
        [envName]: gcpVersionPath('round-awards'),
      }),
    /GCP_PROJECT_NUMBER is required for 'gcp-kms' backend/,
  )
})

test('buildToolExecutorBackend (gcp-kms): production guard refuses static-key fallback', () => {
  const envName = toolEnvKeyName('round-awards', 'gcp-kms')
  assert.throws(
    () =>
      buildToolExecutorBackend('round-awards', {
        A2A_KMS_BACKEND: 'gcp-kms',
        NODE_ENV: 'production',
        ...GCP_AUTH_ENV,
        [envName]: gcpVersionPath('round-awards'),
        // Forensics-liability: static EOA key set in production.
        A2A_MASTER_EOA_PRIVATE_KEY:
          '0x0000000000000000000000000000000000000000000000000000000000000001',
      }),
    /forbidden static-key env var/,
  )
})

test("vault-transit: now falls into the unknown-backend branch (GCP-KMS G-PR-1)", () => {
  // The vault-transit deferred-sibling case was deleted in G-PR-1
  // (GCP-KMS-IMPLEMENTATION-PLAN § G6, orchestrator decision: AWS + GCP only).
  // Setting A2A_KMS_BACKEND='vault-transit' must now fail closed via the
  // default branch with "unknown A2A_KMS_BACKEND".
  assert.throws(
    () =>
      createToolExecutorSigner('round-awards', {
        A2A_KMS_BACKEND: 'vault-transit',
      }),
    /unknown A2A_KMS_BACKEND: vault-transit/,
  )
})

test('unknown tool id throws with the canonical list in the error', () => {
  assert.throws(
    () =>
      createToolExecutorSigner(
        'not-a-tool' as ToolExecutorId,
        { A2A_KMS_BACKEND: 'local-aes' },
      ),
    /unknown tool id "not-a-tool"/,
  )
})

// ─── a2a-signer wrapper: getToolExecutorSigner ────────────────────────

test('getToolExecutorSigner returns a working LocalAccount under local-aes', async () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  process.env[toolEnvKeyName('round-awards', 'local-aes')] = DEV_KEYS['round-awards']
  const account = await getToolExecutorSigner('round-awards')
  assert.equal(account.type, 'local')
  const expectedAddr = privateKeyToAccount(DEV_KEYS['round-awards']).address
  assert.equal(account.address.toLowerCase(), expectedAddr.toLowerCase())
})

test('getToolExecutorSigner caches the LocalAccount across calls for the same tool id', async () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  process.env[toolEnvKeyName('disbursement', 'local-aes')] = DEV_KEYS['disbursement']
  const a = await getToolExecutorSigner('disbursement')
  const b = await getToolExecutorSigner('disbursement')
  assert.equal(a, b, 'second call should return the cached singleton')
})

test('getToolExecutorSigner returns distinct addresses across tool ids when keys differ', async () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  for (const id of TOOL_EXECUTOR_IDS) {
    process.env[toolEnvKeyName(id, 'local-aes')] = DEV_KEYS[id]
  }
  const ra = await getToolExecutorSigner('round-awards')
  const ds = await getToolExecutorSigner('disbursement')
  const pl = await getToolExecutorSigner('pool-lifecycle')
  const ga = await getToolExecutorSigner('grant-awards')
  const addrs = new Set([
    ra.address.toLowerCase(),
    ds.address.toLowerCase(),
    pl.address.toLowerCase(),
    ga.address.toLowerCase(),
  ])
  assert.equal(addrs.size, 4, 'distinct private keys must yield distinct addresses')
})

test('__resetToolExecutorSignersForTests clears the cache', async () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  process.env[toolEnvKeyName('round-awards', 'local-aes')] = DEV_KEYS['round-awards']
  const a = await getToolExecutorSigner('round-awards')
  __resetToolExecutorSignersForTests()
  // Swap the key after reset; the next call should pick up the new key.
  process.env[toolEnvKeyName('round-awards', 'local-aes')] = DEV_KEYS['disbursement']
  const b = await getToolExecutorSigner('round-awards')
  assert.notEqual(a, b, 'reset must drop the cached LocalAccount')
  assert.notEqual(
    a.address.toLowerCase(),
    b.address.toLowerCase(),
    'reset must let the next call observe the new env',
  )
})

test('getToolExecutorSignerBackend exposes the underlying signer interface', () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  process.env[toolEnvKeyName('pool-lifecycle', 'local-aes')] =
    DEV_KEYS['pool-lifecycle']
  const backend = getToolExecutorSignerBackend('pool-lifecycle')
  assert.equal(typeof backend.signA2AAction, 'function')
  assert.equal(typeof backend.getSignerAddress, 'function')
})

test("getToolExecutorSignerBackend under 'aws-kms' missing env throws with exact env name", () => {
  process.env.A2A_KMS_BACKEND = 'aws-kms'
  process.env.AWS_REGION = 'us-east-1'
  process.env.AWS_ROLE_ARN = 'arn:aws:iam::111122223333:role/SmartAgentA2A'
  // no per-tool key id set
  assert.throws(
    () => getToolExecutorSignerBackend('grant-awards'),
    /AWS_KMS_TOOL_EXECUTOR_GRANT_AWARDS_KEY_ID is required for tool "grant-awards"/,
  )
})
