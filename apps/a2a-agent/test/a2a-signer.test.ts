/**
 * Unit tests for `apps/a2a-agent/src/auth/a2a-signer.ts` (KMS K4 PR-1 §7).
 *
 * Asserts the backend-selector behaviour:
 *   - 'local-aes' (default) + A2A_MASTER_PRIVATE_KEY set → returns a working
 *     viem LocalAccount that can sign a message.
 *   - 'aws-kms' → throws cleanly with the "not yet implemented (K4 PR-2)"
 *     marker so a misconfigured prod boot fails fast.
 *   - 'vault-transit' → throws cleanly with the deferred-sibling marker.
 *
 * Tests mutate `process.env` and reset the singleton between cases via the
 * `__resetMasterSignerForTests` hook — matches the pattern established in
 * `apps/a2a-agent/test/encryption.test.ts` for the envelope provider.
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { recoverMessageAddress } from 'viem'
import { TOOL_EXECUTOR_IDS, toolEnvKeyName } from '@smart-agent/sdk/key-custody'
import {
  __resetMasterSignerForTests,
  __resetToolExecutorSignersForTests,
  getMasterSigner,
  getMasterSignerBackend,
  getToolExecutorSigner,
} from '../src/auth/a2a-signer'

const TEST_KEY = '0x' + 'a1'.repeat(32)
const TOOL_KEY_A = '0x' + 'b1'.repeat(32)
const TOOL_KEY_B = '0x' + 'c1'.repeat(32)

beforeEach(() => {
  __resetMasterSignerForTests()
  __resetToolExecutorSignersForTests()
  // Clear KMS-related env between tests so each case sets its own
  // backend cleanly. NODE_ENV stays test-default.
  delete process.env.A2A_KMS_BACKEND
  delete process.env.A2A_MASTER_PRIVATE_KEY
  delete process.env.A2A_MASTER_EOA_PRIVATE_KEY
  delete process.env.AWS_REGION
  delete process.env.AWS_ROLE_ARN
  delete process.env.AWS_KMS_SIGNER_KEY_ID
  for (const id of TOOL_EXECUTOR_IDS) {
    delete process.env[toolEnvKeyName(id, 'local-aes')]
    delete process.env[toolEnvKeyName(id, 'aws-kms')]
  }
})

test("A2A_KMS_BACKEND='local-aes' with valid key → working LocalAccount", async () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  process.env.A2A_MASTER_PRIVATE_KEY = TEST_KEY
  const account = await getMasterSigner()
  assert.equal(account.type, 'local')
  assert.match(account.address, /^0x[a-fA-F0-9]{40}$/)
  const message = 'hello-master-signer'
  const signature = await account.signMessage({ message })
  const recovered = await recoverMessageAddress({ message, signature })
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase())
})

test("A2A_KMS_BACKEND undefined → defaults to 'local-aes'", async () => {
  // No explicit backend — buildSignerBackend should default to local-aes.
  process.env.A2A_MASTER_PRIVATE_KEY = TEST_KEY
  const account = await getMasterSigner()
  assert.equal(account.type, 'local')
})

test("A2A_KMS_BACKEND='local-aes' with missing key → throws clean error", () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  // No A2A_MASTER_PRIVATE_KEY set.
  assert.throws(
    () => getMasterSignerBackend(),
    /A2A_MASTER_PRIVATE_KEY is required/,
  )
})

test("A2A_KMS_BACKEND='aws-kms' with no env → throws clean operator-facing error", () => {
  process.env.A2A_KMS_BACKEND = 'aws-kms'
  // No AWS_REGION / AWS_ROLE_ARN / AWS_KMS_SIGNER_KEY_ID set.
  assert.throws(
    () => getMasterSignerBackend(),
    /AWS_REGION is required for 'aws-kms' signer \(K4 PR-2\)/,
  )
})

test("A2A_KMS_BACKEND='aws-kms' with AWS_REGION but missing role arn → clean error", () => {
  process.env.A2A_KMS_BACKEND = 'aws-kms'
  process.env.AWS_REGION = 'us-east-1'
  delete process.env.AWS_ROLE_ARN
  delete process.env.AWS_KMS_SIGNER_KEY_ID
  assert.throws(
    () => getMasterSignerBackend(),
    /AWS_ROLE_ARN is required for 'aws-kms' signer/,
  )
  delete process.env.AWS_REGION
})

test("A2A_KMS_BACKEND='aws-kms' with region+role but missing signer key id → clean error", () => {
  process.env.A2A_KMS_BACKEND = 'aws-kms'
  process.env.AWS_REGION = 'us-east-1'
  process.env.AWS_ROLE_ARN = 'arn:aws:iam::111122223333:role/SmartAgentA2A'
  delete process.env.AWS_KMS_SIGNER_KEY_ID
  assert.throws(
    () => getMasterSignerBackend(),
    /AWS_KMS_SIGNER_KEY_ID is required for 'aws-kms' signer \(K4 PR-2\)/,
  )
  delete process.env.AWS_REGION
  delete process.env.AWS_ROLE_ARN
})

test("A2A_KMS_BACKEND='aws-kms' with full valid env → constructs successfully", () => {
  process.env.A2A_KMS_BACKEND = 'aws-kms'
  process.env.AWS_REGION = 'us-east-1'
  process.env.AWS_ROLE_ARN = 'arn:aws:iam::111122223333:role/SmartAgentA2A'
  process.env.AWS_KMS_SIGNER_KEY_ID =
    'arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567'
  // Should not throw — the backend builds lazily and does not contact AWS
  // until first signA2AAction / getSignerAddress call.
  const backend = getMasterSignerBackend()
  assert.equal(typeof backend.signA2AAction, 'function')
  assert.equal(typeof backend.getSignerAddress, 'function')
  delete process.env.AWS_REGION
  delete process.env.AWS_ROLE_ARN
  delete process.env.AWS_KMS_SIGNER_KEY_ID
})

test("A2A_KMS_BACKEND='vault-transit' → throws deferred-sibling error", () => {
  process.env.A2A_KMS_BACKEND = 'vault-transit'
  assert.throws(
    () => getMasterSignerBackend(),
    /vault-transit signer not implemented \(deferred sibling\)/,
  )
})

test("A2A_KMS_BACKEND='bogus' → throws unknown backend error", () => {
  process.env.A2A_KMS_BACKEND = 'bogus'
  assert.throws(
    () => getMasterSignerBackend(),
    /unknown A2A_KMS_BACKEND: bogus/,
  )
})

test('getMasterSigner caches the LocalAccount across calls', async () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  process.env.A2A_MASTER_PRIVATE_KEY = TEST_KEY
  const a = await getMasterSigner()
  const b = await getMasterSigner()
  assert.equal(a, b, 'second call should return the cached singleton')
})

// ─── K5 — per-tool executor signers ─────────────────────────────────

test('getToolExecutorSigner returns a working signer under local-aes', async () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  process.env[toolEnvKeyName('round-awards', 'local-aes')] = TOOL_KEY_A
  const account = await getToolExecutorSigner('round-awards')
  assert.match(account.address, /^0x[a-fA-F0-9]{40}$/)
  const message = 'tool-exec-canary'
  const signature = await account.signMessage({ message })
  const recovered = await recoverMessageAddress({ message, signature })
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase())
})

test('getToolExecutorSigner caches the LocalAccount per tool id', async () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  process.env[toolEnvKeyName('disbursement', 'local-aes')] = TOOL_KEY_A
  const a = await getToolExecutorSigner('disbursement')
  const b = await getToolExecutorSigner('disbursement')
  assert.equal(a, b)
})

test('getToolExecutorSigner produces distinct addresses for different tool ids when keys differ', async () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  process.env[toolEnvKeyName('round-awards', 'local-aes')] = TOOL_KEY_A
  process.env[toolEnvKeyName('grant-awards', 'local-aes')] = TOOL_KEY_B
  const a = await getToolExecutorSigner('round-awards')
  const b = await getToolExecutorSigner('grant-awards')
  assert.notEqual(a.address.toLowerCase(), b.address.toLowerCase())
})

test('__resetToolExecutorSignersForTests clears all per-tool caches', async () => {
  process.env.A2A_KMS_BACKEND = 'local-aes'
  process.env[toolEnvKeyName('pool-lifecycle', 'local-aes')] = TOOL_KEY_A
  const a = await getToolExecutorSigner('pool-lifecycle')
  __resetToolExecutorSignersForTests()
  process.env[toolEnvKeyName('pool-lifecycle', 'local-aes')] = TOOL_KEY_B
  const b = await getToolExecutorSigner('pool-lifecycle')
  assert.notEqual(a, b)
  assert.notEqual(a.address.toLowerCase(), b.address.toLowerCase())
})
