/**
 * Production-guard test for `buildKeyProvider` (§9.5 of plan).
 *
 * The local-aes provider is a dev shim. `buildKeyProvider` must REFUSE to
 * instantiate it when `NODE_ENV === 'production'` so a misconfigured
 * deployment fails at startup rather than ever serving requests under the
 * dev-mode HKDF derivation.
 *
 * After K2 (KMS-IMPLEMENTATION-PLAN.md §3.2a) lands, `'aws-kms'` returns
 * a real provider in production when all routing env vars are set.
 * The `'vault-transit'` deferred-sibling case was deleted in GCP-KMS
 * G-PR-1 (orchestrator decision: AWS + GCP only — see
 * `output/GCP-KMS-IMPLEMENTATION-PLAN.md § G6`).
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/key-provider-config.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildKeyProvider } from '../src/auth/key-provider'

const VALID_SECRET = '0x' + 'd'.repeat(64)

const VALID_AWS_ENV = {
  AWS_REGION: 'us-east-1',
  AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/SmartAgentA2A',
  AWS_KMS_KEY_ID:
    'arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567',
}

test("NODE_ENV='production' + A2A_KMS_BACKEND='local-aes' → throws at construction", () => {
  assert.throws(
    () => buildKeyProvider({
      NODE_ENV: 'production',
      A2A_KMS_BACKEND: 'local-aes',
      A2A_SESSION_SECRET: VALID_SECRET,
    }),
    /refusing to instantiate 'local-aes' in production/,
  )
})

test("NODE_ENV='production' + A2A_KMS_BACKEND undefined → defaults to local-aes → throws", () => {
  assert.throws(
    () => buildKeyProvider({
      NODE_ENV: 'production',
      A2A_SESSION_SECRET: VALID_SECRET,
    }),
    /refusing to instantiate 'local-aes' in production/,
  )
})

test("NODE_ENV='production' + A2A_KMS_BACKEND='aws-kms' (with valid env) → returns a provider", () => {
  // K2 LANDED: AWS KMS is the v1 prod implementation target. With all
  // routing env vars set, the provider constructs successfully. Note that
  // the constructor does NOT contact AWS — first AWS call would happen on
  // the first generateSessionDataKey / decryptSessionDataKey invocation.
  const provider = buildKeyProvider({
    NODE_ENV: 'production',
    A2A_KMS_BACKEND: 'aws-kms',
    ...VALID_AWS_ENV,
  })
  assert.ok(provider)
  assert.equal(typeof provider.generateSessionDataKey, 'function')
  assert.equal(typeof provider.decryptSessionDataKey, 'function')
})

test("NODE_ENV='production' + A2A_KMS_BACKEND='aws-kms' missing AWS_REGION → throws clean error", () => {
  assert.throws(
    () => buildKeyProvider({
      NODE_ENV: 'production',
      A2A_KMS_BACKEND: 'aws-kms',
      AWS_ROLE_ARN: VALID_AWS_ENV.AWS_ROLE_ARN,
      AWS_KMS_KEY_ID: VALID_AWS_ENV.AWS_KMS_KEY_ID,
    }),
    /AWS_REGION is required for 'aws-kms' backend/,
  )
})

test("NODE_ENV='production' + A2A_KMS_BACKEND='aws-kms' missing AWS_ROLE_ARN → throws clean error", () => {
  assert.throws(
    () => buildKeyProvider({
      NODE_ENV: 'production',
      A2A_KMS_BACKEND: 'aws-kms',
      AWS_REGION: VALID_AWS_ENV.AWS_REGION,
      AWS_KMS_KEY_ID: VALID_AWS_ENV.AWS_KMS_KEY_ID,
    }),
    /AWS_ROLE_ARN is required for 'aws-kms' backend/,
  )
})

test("NODE_ENV='production' + A2A_KMS_BACKEND='aws-kms' missing AWS_KMS_KEY_ID → throws clean error", () => {
  assert.throws(
    () => buildKeyProvider({
      NODE_ENV: 'production',
      A2A_KMS_BACKEND: 'aws-kms',
      AWS_REGION: VALID_AWS_ENV.AWS_REGION,
      AWS_ROLE_ARN: VALID_AWS_ENV.AWS_ROLE_ARN,
    }),
    /AWS_KMS_KEY_ID is required for 'aws-kms' backend/,
  )
})

test("NODE_ENV='development' + local-aes → instantiates successfully", () => {
  const provider = buildKeyProvider({
    NODE_ENV: 'development',
    A2A_KMS_BACKEND: 'local-aes',
    A2A_SESSION_SECRET: VALID_SECRET,
  })
  assert.ok(provider)
  assert.equal(typeof provider.generateSessionDataKey, 'function')
  assert.equal(typeof provider.decryptSessionDataKey, 'function')
})

test('vault-transit backend now falls into the unknown-backend branch (GCP-KMS G-PR-1)', () => {
  // The vault-transit deferred-sibling case was deleted in G-PR-1
  // (GCP-KMS-IMPLEMENTATION-PLAN § G6, orchestrator decision: AWS + GCP only).
  // Setting A2A_KMS_BACKEND='vault-transit' must now fail closed via the
  // default branch with "unknown A2A_KMS_BACKEND".
  assert.throws(
    () => buildKeyProvider({ A2A_KMS_BACKEND: 'vault-transit' }),
    /unknown A2A_KMS_BACKEND: vault-transit/,
  )
})

test('unknown backend throws "unknown A2A_KMS_BACKEND"', () => {
  assert.throws(
    () => buildKeyProvider({ A2A_KMS_BACKEND: 'bogus-backend' }),
    /unknown A2A_KMS_BACKEND: bogus-backend/,
  )
})

test("local-aes requires A2A_SESSION_SECRET in env", () => {
  assert.throws(
    () => buildKeyProvider({
      A2A_KMS_BACKEND: 'local-aes',
      // A2A_SESSION_SECRET intentionally absent
    }),
    /A2A_SESSION_SECRET is required/,
  )
})
