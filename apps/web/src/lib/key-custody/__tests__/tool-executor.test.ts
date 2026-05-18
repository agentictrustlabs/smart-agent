/**
 * Tests for `getAuthBootstrapSigner()` — KMS migration K6 Sprint S1.5.
 *
 * Covers:
 *   - Lazy singleton: a second call returns the same `LocalAccount`.
 *   - `A2A_KMS_BACKEND='aws-kms'` with no
 *     `AWS_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_KEY_ID` throws a clean,
 *     operator-facing error mentioning the exact env var name.
 *   - `A2A_KMS_BACKEND='local-aes'` (default) with a valid
 *     `TOOL_EXECUTOR_AUTH_BOOTSTRAP_PRIVATE_KEY` returns a working
 *     viem `LocalAccount` whose `signMessage` round-trips through
 *     `recoverMessageAddress`.
 *   - `__resetAuthBootstrapSignerForTests()` clears the cached
 *     singleton so a follow-up call rebuilds with new env.
 *
 * Mirrors the test posture established by
 * `apps/a2a-agent/test/a2a-signer.test.ts` (the K4/K5 equivalents for
 * the master + per-tool signers on the a2a-agent side).
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { recoverMessageAddress } from 'viem'
import {
  getAuthBootstrapSigner,
  __resetAuthBootstrapSignerForTests,
} from '../tool-executor'

const env = process.env as Record<string, string | undefined>

const SAVED_KEYS = [
  'NODE_ENV',
  'A2A_KMS_BACKEND',
  'TOOL_EXECUTOR_AUTH_BOOTSTRAP_PRIVATE_KEY',
  'AWS_REGION',
  'AWS_ROLE_ARN',
  'AWS_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_KEY_ID',
] as const

const TEST_KEY = '0x' + 'a1'.repeat(32)
const TEST_KEY_B = '0x' + 'b1'.repeat(32)

describe('getAuthBootstrapSigner', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of SAVED_KEYS) {
      saved[k] = env[k]
      delete env[k]
    }
    __resetAuthBootstrapSignerForTests()
  })

  afterEach(() => {
    for (const k of SAVED_KEYS) {
      if (saved[k] === undefined) delete env[k]
      else env[k] = saved[k]
    }
    __resetAuthBootstrapSignerForTests()
  })

  it("local-aes backend with valid key → working LocalAccount whose signature round-trips", async () => {
    env.A2A_KMS_BACKEND = 'local-aes'
    env.TOOL_EXECUTOR_AUTH_BOOTSTRAP_PRIVATE_KEY = TEST_KEY
    const account = await getAuthBootstrapSigner()
    assert.match(account.address, /^0x[a-fA-F0-9]{40}$/)
    const message = 'auth-bootstrap-canary'
    const signature = await account.signMessage({ message })
    const recovered = await recoverMessageAddress({ message, signature })
    assert.equal(recovered.toLowerCase(), account.address.toLowerCase())
  })

  it('returns a cached singleton (second call returns same instance)', async () => {
    env.A2A_KMS_BACKEND = 'local-aes'
    env.TOOL_EXECUTOR_AUTH_BOOTSTRAP_PRIVATE_KEY = TEST_KEY
    const a = await getAuthBootstrapSigner()
    const b = await getAuthBootstrapSigner()
    assert.equal(a, b, 'second call should return the cached singleton')
  })

  it("aws-kms backend with missing AWS_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_KEY_ID throws clean error", async () => {
    env.A2A_KMS_BACKEND = 'aws-kms'
    env.AWS_REGION = 'us-east-1'
    env.AWS_ROLE_ARN = 'arn:aws:iam::111122223333:role/SmartAgentWeb'
    // No AWS_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_KEY_ID set.
    await assert.rejects(
      async () => { await getAuthBootstrapSigner() },
      /AWS_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_KEY_ID is required/,
    )
  })

  it('__resetAuthBootstrapSignerForTests clears the cache so a fresh key rebuilds', async () => {
    env.A2A_KMS_BACKEND = 'local-aes'
    env.TOOL_EXECUTOR_AUTH_BOOTSTRAP_PRIVATE_KEY = TEST_KEY
    const a = await getAuthBootstrapSigner()
    __resetAuthBootstrapSignerForTests()
    env.TOOL_EXECUTOR_AUTH_BOOTSTRAP_PRIVATE_KEY = TEST_KEY_B
    const b = await getAuthBootstrapSigner()
    assert.notEqual(a, b)
    assert.notEqual(a.address.toLowerCase(), b.address.toLowerCase())
  })
})
