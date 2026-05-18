/**
 * GCP-KMS G-PR-6 — `assertGcpEnvComplete` boot-time invariant.
 *
 * Pins the "every required GCP identifier must be set when
 * A2A_KMS_BACKEND='gcp-kms'" invariant introduced in policy-startup.ts.
 * The function is the single top-level gate (sibling of the per-factory
 * `validateGcpEnvAndBuildAuthClient` in `key-provider.ts`, which fires
 * lazily) and is wired into `apps/a2a-agent/src/index.ts` so a half-
 * configured deploy refuses to start.
 *
 * Test matrix:
 *   - dev   + gcp-kms + everything missing  → THROWS (dev posture also
 *                                              refuses; rationale matches
 *                                              `assertPolicyCompleteness`
 *                                              — surface env-config bugs
 *                                              at dev boot, not in prod).
 *   - prod  + gcp-kms + everything set      → no throw
 *   - prod  + gcp-kms + missing session KEK → throws naming exactly that var
 *   - prod  + gcp-kms + missing 3 tool execs→ throws naming ALL 3 in one msg
 *   - prod  + gcp-kms + missing 5 MAC vers  → throws naming ALL 5 in one msg
 *   - prod  + aws-kms                       → no-op (skip entirely)
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/policy-startup-gcp-env-complete.test.ts`
 */

// Configure env BEFORE importing app code so the audit module's db init
// finds a valid local-aes secret (policy-startup transitively imports it).
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = '0x' + 'd'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAC_KEY_IDS,
  TOOL_EXECUTOR_IDS,
  envKeyForMacKeyId,
  toolEnvKeyName,
} from '@smart-agent/sdk/key-custody'
import {
  assertGcpEnvComplete,
  type GcpEnvCompleteEnv,
} from '../src/lib/policy-startup'

/** Build a fully-populated GCP env map (every required identifier set). */
function fullyPopulatedGcpEnv(nodeEnv: string): GcpEnvCompleteEnv {
  const env: Record<string, string> = {
    NODE_ENV: nodeEnv,
    A2A_KMS_BACKEND: 'gcp-kms',
    GCP_PROJECT_ID: 'smart-agent-prod',
    GCP_PROJECT_NUMBER: '123456789012',
    GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel-pool',
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel-oidc',
    GCP_SERVICE_ACCOUNT_EMAIL:
      'smart-agent-a2a-prod@smart-agent-prod.iam.gserviceaccount.com',
    GCP_KMS_SESSION_KEK:
      'projects/smart-agent-prod/locations/us-east1/keyRings/smart-agent/cryptoKeys/a2a-session-kek',
    GCP_KMS_MASTER_SIGNER_VERSION:
      'projects/smart-agent-prod/locations/us-east1/keyRings/smart-agent/cryptoKeys/master-eoa-signer/cryptoKeyVersions/1',
  }
  for (const id of TOOL_EXECUTOR_IDS) {
    env[toolEnvKeyName(id, 'gcp-kms')] =
      `projects/smart-agent-prod/locations/us-east1/keyRings/smart-agent/cryptoKeys/tool-${id}/cryptoKeyVersions/1`
  }
  for (const id of MAC_KEY_IDS) {
    env[envKeyForMacKeyId(id).gcpKms] =
      `projects/smart-agent-prod/locations/us-east1/keyRings/smart-agent/cryptoKeys/mac-${id}/cryptoKeyVersions/1`
  }
  return env as GcpEnvCompleteEnv
}

// ─── dev + gcp-kms + everything missing → throws (dev posture also refuses) ─

test("dev + A2A_KMS_BACKEND='gcp-kms' + everything missing → throws (dev posture also refuses)", () => {
  assert.throws(
    () =>
      assertGcpEnvComplete({
        NODE_ENV: 'development',
        A2A_KMS_BACKEND: 'gcp-kms',
      }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /assertGcpEnvComplete/)
      assert.match(msg, /missing/)
      // Should name at least the auth + session + master vars.
      assert.match(msg, /GCP_PROJECT_ID/)
      assert.match(msg, /GCP_KMS_SESSION_KEK/)
      assert.match(msg, /GCP_KMS_MASTER_SIGNER_VERSION/)
      return true
    },
  )
})

// ─── prod + gcp-kms + everything set → no throw ─────────────────────

test("prod + A2A_KMS_BACKEND='gcp-kms' + every identifier set → no throw", () => {
  assert.doesNotThrow(() => assertGcpEnvComplete(fullyPopulatedGcpEnv('production')))
})

// ─── prod + gcp-kms + missing GCP_KMS_SESSION_KEK → throws naming exactly that var ─

test("prod + A2A_KMS_BACKEND='gcp-kms' + GCP_KMS_SESSION_KEK missing → throws naming exactly that var", () => {
  const env = fullyPopulatedGcpEnv('production')
  delete (env as Record<string, string | undefined>).GCP_KMS_SESSION_KEK
  assert.throws(
    () => assertGcpEnvComplete(env),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /GCP_KMS_SESSION_KEK/)
      // And nothing else should be reported missing — verify the count
      // section of the message reads "1 required env var(s) missing".
      assert.match(msg, /1 required env var\(s\) missing/)
      return true
    },
  )
})

// ─── prod + gcp-kms + missing 3 tool executor versions → throws naming all 3 ──

test("prod + A2A_KMS_BACKEND='gcp-kms' + 3 tool-executor versions missing → throws naming ALL 3 in one message", () => {
  const env = fullyPopulatedGcpEnv('production')
  // Pick three tool executor ids (deterministic — first three).
  const missingIds = TOOL_EXECUTOR_IDS.slice(0, 3)
  assert.equal(missingIds.length, 3, 'precondition: at least 3 tool executors')
  for (const id of missingIds) {
    delete (env as Record<string, string | undefined>)[toolEnvKeyName(id, 'gcp-kms')]
  }
  assert.throws(
    () => assertGcpEnvComplete(env),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      for (const id of missingIds) {
        const envName = toolEnvKeyName(id, 'gcp-kms')
        assert.match(msg, new RegExp(envName))
      }
      assert.match(msg, /3 required env var\(s\) missing/)
      return true
    },
  )
})

// ─── prod + gcp-kms + missing 5 MAC versions → throws naming all 5 ──

test("prod + A2A_KMS_BACKEND='gcp-kms' + 5 MAC versions missing → throws naming ALL 5 in one message", () => {
  const env = fullyPopulatedGcpEnv('production')
  const missingIds = MAC_KEY_IDS.slice(0, 5)
  assert.equal(missingIds.length, 5, 'precondition: at least 5 MAC keys')
  for (const id of missingIds) {
    delete (env as Record<string, string | undefined>)[envKeyForMacKeyId(id).gcpKms]
  }
  assert.throws(
    () => assertGcpEnvComplete(env),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      for (const id of missingIds) {
        const envName = envKeyForMacKeyId(id).gcpKms
        assert.match(msg, new RegExp(envName))
      }
      assert.match(msg, /5 required env var\(s\) missing/)
      return true
    },
  )
})

// ─── prod + aws-kms → no-op (no throw even if every GCP var is absent) ────

test("prod + A2A_KMS_BACKEND='aws-kms' → assertGcpEnvComplete is a no-op", () => {
  assert.doesNotThrow(() =>
    assertGcpEnvComplete({
      NODE_ENV: 'production',
      A2A_KMS_BACKEND: 'aws-kms',
      // Deliberately empty otherwise — every GCP_* var is absent.
    }),
  )
})

// ─── prod + local-aes → no-op as well ─────────────────────────────────

test("A2A_KMS_BACKEND='local-aes' (any NODE_ENV) → assertGcpEnvComplete is a no-op", () => {
  assert.doesNotThrow(() =>
    assertGcpEnvComplete({
      NODE_ENV: 'production',
      A2A_KMS_BACKEND: 'local-aes',
    }),
  )
})
