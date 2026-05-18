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
import {
  createToolExecutorSigner,
  isToolExecutorId,
  listToolExecutorIds,
  toolEnvKeyName,
  TOOL_EXECUTOR_IDS,
  type ToolExecutorId,
} from '@smart-agent/sdk/key-custody'
import {
  __resetToolExecutorSignersForTests,
  getToolExecutorSigner,
  getToolExecutorSignerBackend,
} from '../src/auth/a2a-signer'

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
  }
}

beforeEach(() => {
  __resetToolExecutorSignersForTests()
  delete process.env.A2A_KMS_BACKEND
  delete process.env.AWS_REGION
  delete process.env.AWS_ROLE_ARN
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
