/**
 * Sprint 5 W3 P0-7 — production key-hygiene guard parity (AWS + GCP).
 *
 * Before this work, prod-time static-key refusal was only enforced on
 * the GCP path; the AWS path only refused `A2A_SESSION_SECRET` (via
 * `validateSessionSecret`) and `DEPLOYER_PRIVATE_KEY` (via
 * `validateDeployerKey`). This test pins the broader enforcement
 * against `assertNoForbiddenStaticKeys(env, backend)` + the
 * startup-time `assertProductionKeyHygiene` wrapper.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/policy-startup-static-keys.test.ts`
 */

// Configure env BEFORE importing app code so the audit module's db init
// finds a valid local-aes secret (some test branches import policy-startup
// which in turn imports the audit module).
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = '0x' + 'd'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertNoForbiddenStaticKeys,
  type KeyProviderEnv,
} from '../src/auth/key-provider'
import { assertProductionKeyHygiene } from '../src/lib/policy-startup'

const FORBIDDEN_SHARED_KEYS = [
  'A2A_SESSION_SECRET',
  'A2A_MASTER_EOA_PRIVATE_KEY',
  'WEB_TO_A2A_HMAC_KEY',
] as const

const FORBIDDEN_GCP_KEYS = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GCP_SERVICE_ACCOUNT_KEY_JSON',
] as const

const FORBIDDEN_AWS_KEYS = ['AWS_SECRET_ACCESS_KEY'] as const

// ─── AWS-path enforcement (regression — was missing) ────────────────

for (const key of [...FORBIDDEN_SHARED_KEYS, ...FORBIDDEN_AWS_KEYS]) {
  test(`prod + A2A_KMS_BACKEND='aws-kms' + ${key} set → throws naming the var`, () => {
    assert.throws(
      () =>
        assertNoForbiddenStaticKeys(
          { [key]: 'some-value' } as unknown as KeyProviderEnv,
          'aws-kms',
        ),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        assert.match(msg, new RegExp(key))
        assert.match(msg, /aws-kms/)
        return true
      },
    )
  })
}

test("prod + A2A_KMS_BACKEND='aws-kms' + TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY → throws (pattern match)", () => {
  assert.throws(
    () =>
      assertNoForbiddenStaticKeys(
        {
          TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY: '0xabc',
        } as unknown as KeyProviderEnv,
        'aws-kms',
      ),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY/)
      return true
    },
  )
})

test("prod + A2A_KMS_BACKEND='aws-kms' + A2A_INTERSERVICE_HMAC_KEY_ORG_MCP → throws (pattern match)", () => {
  assert.throws(
    () =>
      assertNoForbiddenStaticKeys(
        {
          A2A_INTERSERVICE_HMAC_KEY_ORG_MCP: 'k',
        } as unknown as KeyProviderEnv,
        'aws-kms',
      ),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /A2A_INTERSERVICE_HMAC_KEY_ORG_MCP/)
      return true
    },
  )
})

test("prod + A2A_KMS_BACKEND='aws-kms' + clean env → no throw", () => {
  assert.doesNotThrow(() =>
    assertNoForbiddenStaticKeys(
      {
        AWS_REGION: 'us-east-1',
        AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/a2a',
        AWS_KMS_KEY_ID: 'alias/a2a',
        // legitimate non-forbidden env vars
        NODE_ENV: 'production',
      } as unknown as KeyProviderEnv,
      'aws-kms',
    ),
  )
})

test("prod + A2A_KMS_BACKEND='aws-kms' + GOOGLE_APPLICATION_CREDENTIALS set → does NOT throw (gcp-specific, not aws-relevant)", () => {
  // The GCP-specific keys are NOT in the AWS forbidden set. The
  // shared-key guard catches static secrets that are forensics
  // liabilities regardless of backend; GCP cred files are GCP-only.
  assert.doesNotThrow(() =>
    assertNoForbiddenStaticKeys(
      {
        GOOGLE_APPLICATION_CREDENTIALS: '/path/to/key.json',
      } as unknown as KeyProviderEnv,
      'aws-kms',
    ),
  )
})

// ─── GCP-path enforcement (regression — was already covered, rerun via shared helper) ─

for (const key of [...FORBIDDEN_SHARED_KEYS, ...FORBIDDEN_GCP_KEYS]) {
  test(`prod + A2A_KMS_BACKEND='gcp-kms' + ${key} set → throws naming the var`, () => {
    assert.throws(
      () =>
        assertNoForbiddenStaticKeys(
          { [key]: 'value' } as unknown as KeyProviderEnv,
          'gcp-kms',
        ),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        assert.match(msg, new RegExp(key))
        assert.match(msg, /gcp-kms/)
        return true
      },
    )
  })
}

// ─── assertProductionKeyHygiene — startup wrapper ───────────────────

test("assertProductionKeyHygiene: dev + A2A_KMS_BACKEND='aws-kms' + forbidden vars set → no throw (dev posture stays)", () => {
  assert.doesNotThrow(() =>
    assertProductionKeyHygiene({
      NODE_ENV: 'development',
      A2A_KMS_BACKEND: 'aws-kms',
      A2A_SESSION_SECRET: 'whatever',
      WEB_TO_A2A_HMAC_KEY: 'whatever',
      TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY: '0xabc',
    }),
  )
})

test("assertProductionKeyHygiene: prod + A2A_KMS_BACKEND='aws-kms' + clean env → no throw", () => {
  assert.doesNotThrow(() =>
    assertProductionKeyHygiene({
      NODE_ENV: 'production',
      A2A_KMS_BACKEND: 'aws-kms',
    }),
  )
})

test("assertProductionKeyHygiene: prod + A2A_KMS_BACKEND='aws-kms' + A2A_MASTER_EOA_PRIVATE_KEY → throws", () => {
  assert.throws(
    () =>
      assertProductionKeyHygiene({
        NODE_ENV: 'production',
        A2A_KMS_BACKEND: 'aws-kms',
        A2A_MASTER_EOA_PRIVATE_KEY: '0xdeadbeef',
      }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /A2A_MASTER_EOA_PRIVATE_KEY/)
      assert.match(msg, /aws-kms/)
      return true
    },
  )
})

test("assertProductionKeyHygiene: prod + A2A_KMS_BACKEND='gcp-kms' + GCP_SERVICE_ACCOUNT_KEY_JSON → throws", () => {
  assert.throws(
    () =>
      assertProductionKeyHygiene({
        NODE_ENV: 'production',
        A2A_KMS_BACKEND: 'gcp-kms',
        GCP_SERVICE_ACCOUNT_KEY_JSON: '{"json":"here"}',
      }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /GCP_SERVICE_ACCOUNT_KEY_JSON/)
      return true
    },
  )
})

test("assertProductionKeyHygiene: prod + A2A_KMS_BACKEND='local-aes' → no-op (local-aes already refused by provider factory)", () => {
  // The local-aes refusal lives in `buildKeyProvider`. This wrapper is
  // a no-op for non-managed backends so the boot path doesn't double-refuse.
  assert.doesNotThrow(() =>
    assertProductionKeyHygiene({
      NODE_ENV: 'production',
      A2A_KMS_BACKEND: 'local-aes',
      A2A_SESSION_SECRET: 'whatever',
    }),
  )
})
