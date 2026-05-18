/**
 * Tests for the key-custody factory (`getKeyCustody`) — Sprint S1.1 + S1.4.
 *
 * Covers:
 *   - aws-kms backend selection when `SESSION_SIGNER_BACKEND=aws-kms`.
 *   - dev-pepper as the default in dev environments.
 *   - S1.4 production guard: NODE_ENV=production + dev-pepper must throw.
 *   - Unknown backend value rejection.
 *
 * NODE_ENV is typed readonly in Next.js's tsconfig, so we mutate via a
 * plain index-signature cast (same trick as `env-guard.test.ts`).
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getKeyCustody, _resetKeyCustodyForTests } from '../index'

const env = process.env as Record<string, string | undefined>

const SAVED_KEYS = [
  'NODE_ENV',
  'SESSION_SIGNER_BACKEND',
  'SERVER_PEPPER',
  'AWS_REGION',
  'AWS_ROLE_ARN',
  'AWS_WEB_SESSION_SIGNER_KEY_ID',
] as const

describe('getKeyCustody', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of SAVED_KEYS) {
      saved[k] = env[k]
      delete env[k]
    }
    _resetKeyCustodyForTests()
  })

  afterEach(() => {
    for (const k of SAVED_KEYS) {
      if (saved[k] === undefined) delete env[k]
      else env[k] = saved[k]
    }
    _resetKeyCustodyForTests()
  })

  it('returns the aws-kms backend when SESSION_SIGNER_BACKEND=aws-kms and env is valid', () => {
    env.SESSION_SIGNER_BACKEND = 'aws-kms'
    env.AWS_REGION = 'us-east-1'
    env.AWS_ROLE_ARN = 'arn:aws:iam::111122223333:role/SmartAgentWeb'
    env.AWS_WEB_SESSION_SIGNER_KEY_ID =
      'arn:aws:kms:us-east-1:111122223333:key/0123abcd-4567-89ef-0123-456789abcdef'
    const custody = getKeyCustody()
    assert.ok(custody)
    assert.equal(typeof custody.deriveSigner, 'function')
    assert.equal(typeof custody.signWithDerivedSigner, 'function')
  })

  it('throws when SESSION_SIGNER_BACKEND=aws-kms but env is incomplete', () => {
    env.SESSION_SIGNER_BACKEND = 'aws-kms'
    // No AWS_REGION / AWS_ROLE_ARN / AWS_WEB_SESSION_SIGNER_KEY_ID — the
    // aws-kms factory rejects synchronously.
    assert.throws(() => getKeyCustody(), /AWS_REGION is required/)
  })

  it('defaults to dev-pepper in development', () => {
    env.NODE_ENV = 'development'
    env.SERVER_PEPPER = 'test-pepper-value'
    const custody = getKeyCustody()
    assert.ok(custody)
    assert.equal(typeof custody.deriveSigner, 'function')
  })

  it('S1.4 production guard: NODE_ENV=production + dev-pepper throws', () => {
    env.NODE_ENV = 'production'
    env.SESSION_SIGNER_BACKEND = 'dev-pepper'
    env.SERVER_PEPPER = 'doesnt-matter-guard-runs-first'
    assert.throws(
      () => getKeyCustody(),
      /SESSION_SIGNER_BACKEND=dev-pepper is forbidden in production/,
    )
  })

  it('S1.4 production guard: NODE_ENV=production with default backend (unset) also throws', () => {
    env.NODE_ENV = 'production'
    // SESSION_SIGNER_BACKEND unset → defaults to dev-pepper → must trip the guard.
    delete env.SESSION_SIGNER_BACKEND
    assert.throws(
      () => getKeyCustody(),
      /SESSION_SIGNER_BACKEND=dev-pepper is forbidden in production/,
    )
  })

  it('rejects unknown backend values', () => {
    env.SESSION_SIGNER_BACKEND = 'hashi-vault'
    assert.throws(() => getKeyCustody(), /unknown SESSION_SIGNER_BACKEND/)
  })

  it('memoizes the backend across calls', () => {
    env.NODE_ENV = 'development'
    env.SERVER_PEPPER = 'pepper'
    const a = getKeyCustody()
    const b = getKeyCustody()
    assert.equal(a, b)
  })
})
