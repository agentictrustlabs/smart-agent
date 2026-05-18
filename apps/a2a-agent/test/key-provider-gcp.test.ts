/**
 * Unit tests for the GCP-KMS backend stub wired in G-PR-1.
 *
 * GCP-KMS G-PR-1 lands the entry-point infrastructure for
 * `A2A_KMS_BACKEND='gcp-kms'`:
 *   - `gcp-auth.ts` (the WIF auth-client primitive),
 *   - the `'gcp-kms'` case on all four factory functions
 *     (`buildKeyProvider`, `buildSignerBackend`, `buildToolExecutorBackend`,
 *     `buildMacProvider`),
 *   - the production-mode forbidden-static-key guard.
 *
 * Each factory in this PR throws a staged "GCP backend not yet implemented
 * for <X> (G-PR-N)" once env validation + auth-client construction
 * succeed. G-PR-2..G-PR-5 replace those throws with real implementations.
 *
 * The tests below verify the staged-throw contract, the env-validation
 * order (auth-env errors > staged marker), and the production guard.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/key-provider-gcp.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildKeyProvider,
  buildSignerBackend,
  buildToolExecutorBackend,
  type KeyProviderEnv,
} from '../src/auth/key-provider'
import { buildMacProvider } from '../src/auth/mac-provider'

const VALID_GCP_AUTH_ENV = {
  GCP_PROJECT_ID: 'smart-agent-prod',
  GCP_PROJECT_NUMBER: '123456789012',
  GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel-pool',
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel-oidc',
  GCP_SERVICE_ACCOUNT_EMAIL:
    'a2a-agent@smart-agent-prod.iam.gserviceaccount.com',
}

function gcpEnv(extra: Partial<KeyProviderEnv> = {}): KeyProviderEnv {
  return {
    A2A_KMS_BACKEND: 'gcp-kms',
    ...VALID_GCP_AUTH_ENV,
    ...extra,
  }
}

// ─── buildKeyProvider ─ session envelope encryption (G-PR-2 target) ──

test("buildKeyProvider('gcp-kms') with valid GCP env + session KEK throws G-PR-2 marker", () => {
  assert.throws(
    () =>
      buildKeyProvider(
        gcpEnv({
          GCP_KMS_SESSION_KEK:
            'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/session-kek',
        }),
      ),
    /GCP backend not yet implemented for session provider \(G-PR-2\)/,
  )
})

test("buildKeyProvider('gcp-kms') missing GCP_PROJECT_NUMBER throws clean error naming the field", () => {
  const env = gcpEnv({ GCP_KMS_SESSION_KEK: 'projects/x/cryptoKeys/y' })
  delete env.GCP_PROJECT_NUMBER
  assert.throws(
    () => buildKeyProvider(env),
    /GCP_PROJECT_NUMBER is required/,
  )
})

test("buildKeyProvider('gcp-kms') missing GCP_KMS_SESSION_KEK throws clean error", () => {
  // Session KEK is the buildKeyProvider-specific identifier. With every
  // auth field present but the KEK missing, the factory must surface
  // the KEK error specifically.
  assert.throws(
    () => buildKeyProvider(gcpEnv()),
    /GCP_KMS_SESSION_KEK is required/,
  )
})

// ─── buildSignerBackend ─ master-EOA signer (G-PR-3 target) ──────────

test("buildSignerBackend('gcp-kms') with valid GCP env + master version throws G-PR-3 marker", () => {
  assert.throws(
    () =>
      buildSignerBackend(
        gcpEnv({
          GCP_KMS_MASTER_SIGNER_VERSION:
            'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/master-signer/cryptoKeyVersions/1',
        }),
      ),
    /GCP backend not yet implemented for master-EOA signer \(G-PR-3\)/,
  )
})

test("buildSignerBackend('gcp-kms') missing GCP_PROJECT_NUMBER throws clean error", () => {
  const env = gcpEnv({
    GCP_KMS_MASTER_SIGNER_VERSION: 'projects/x/cryptoKeyVersions/1',
  })
  delete env.GCP_PROJECT_NUMBER
  assert.throws(
    () => buildSignerBackend(env),
    /GCP_PROJECT_NUMBER is required/,
  )
})

test("buildSignerBackend('gcp-kms') missing GCP_KMS_MASTER_SIGNER_VERSION throws clean error", () => {
  assert.throws(
    () => buildSignerBackend(gcpEnv()),
    /GCP_KMS_MASTER_SIGNER_VERSION is required/,
  )
})

// ─── buildToolExecutorBackend ─ per-tool signers (G-PR-4 target) ─────

test("buildToolExecutorBackend('gcp-kms') with valid env + per-tool version throws G-PR-4 marker", () => {
  assert.throws(
    () =>
      buildToolExecutorBackend(
        'round-awards',
        gcpEnv({
          GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION:
            'projects/x/cryptoKeys/round-awards/cryptoKeyVersions/1',
        }),
      ),
    /GCP backend not yet implemented for tool-executor signer "round-awards" \(G-PR-4\)/,
  )
})

test("buildToolExecutorBackend('gcp-kms') missing GCP_PROJECT_NUMBER throws clean error", () => {
  const env = gcpEnv({
    GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION:
      'projects/x/cryptoKeyVersions/1',
  })
  delete env.GCP_PROJECT_NUMBER
  assert.throws(
    () => buildToolExecutorBackend('round-awards', env),
    /GCP_PROJECT_NUMBER is required/,
  )
})

test("buildToolExecutorBackend('gcp-kms') missing per-tool version throws clean error naming the tool env var", () => {
  assert.throws(
    () => buildToolExecutorBackend('round-awards', gcpEnv()),
    /GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION is required/,
  )
})

// ─── buildMacProvider ─ inter-service MAC (G-PR-5 target) ────────────

test("buildMacProvider('gcp-kms') with valid env + per-MAC-key version throws G-PR-5 marker", () => {
  assert.throws(
    () =>
      buildMacProvider('web-to-a2a', {
        ...gcpEnv(),
        GCP_KMS_MAC_WEB_TO_A2A_VERSION:
          'projects/x/cryptoKeys/mac-web-to-a2a/cryptoKeyVersions/1',
      }),
    /GCP backend not yet implemented for MAC provider "web-to-a2a" \(G-PR-5\)/,
  )
})

test("buildMacProvider('gcp-kms') missing GCP_PROJECT_NUMBER throws clean error", () => {
  const env: KeyProviderEnv = {
    ...gcpEnv(),
    GCP_KMS_MAC_WEB_TO_A2A_VERSION:
      'projects/x/cryptoKeyVersions/1',
  }
  delete env.GCP_PROJECT_NUMBER
  assert.throws(
    () => buildMacProvider('web-to-a2a', env),
    /GCP_PROJECT_NUMBER is required/,
  )
})

test("buildMacProvider('gcp-kms') missing per-MAC-key version throws clean error", () => {
  assert.throws(
    () => buildMacProvider('web-to-a2a', gcpEnv()),
    /GCP_KMS_MAC_WEB_TO_A2A_VERSION is required/,
  )
})

// ─── Production startup guard ────────────────────────────────────────

const FORBIDDEN_PROD_ENV_CASES: Array<[string, string]> = [
  ['GOOGLE_APPLICATION_CREDENTIALS', '/path/to/key.json'],
  ['GCP_SERVICE_ACCOUNT_KEY_JSON', '{"type":"service_account"}'],
  ['A2A_SESSION_SECRET', '0x' + 'd'.repeat(64)],
  ['A2A_MASTER_EOA_PRIVATE_KEY', '0x' + 'd'.repeat(64)],
  ['WEB_TO_A2A_HMAC_KEY', '0x' + 'd'.repeat(64)],
  ['TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY', '0x' + 'd'.repeat(64)],
  ['A2A_INTERSERVICE_HMAC_KEY_PERSON', '0x' + 'd'.repeat(64)],
]

for (const [envVarName, envVarValue] of FORBIDDEN_PROD_ENV_CASES) {
  test(`production guard: NODE_ENV='production' + 'gcp-kms' + ${envVarName} set → refuses with that var named`, () => {
    assert.throws(
      () =>
        buildKeyProvider(
          gcpEnv({
            NODE_ENV: 'production',
            GCP_KMS_SESSION_KEK:
              'projects/x/cryptoKeys/y',
            [envVarName]: envVarValue,
          }),
        ),
      new RegExp(envVarName),
    )
  })
}

test("production guard fires from buildSignerBackend too", () => {
  assert.throws(
    () =>
      buildSignerBackend(
        gcpEnv({
          NODE_ENV: 'production',
          GCP_KMS_MASTER_SIGNER_VERSION:
            'projects/x/cryptoKeyVersions/1',
          A2A_SESSION_SECRET: '0x' + 'd'.repeat(64),
        }),
      ),
    /A2A_SESSION_SECRET/,
  )
})

test("production guard fires from buildToolExecutorBackend too", () => {
  assert.throws(
    () =>
      buildToolExecutorBackend('round-awards', gcpEnv({
        NODE_ENV: 'production',
        GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION:
          'projects/x/cryptoKeyVersions/1',
        GOOGLE_APPLICATION_CREDENTIALS: '/path/to/key.json',
      })),
    /GOOGLE_APPLICATION_CREDENTIALS/,
  )
})

test("production guard fires from buildMacProvider too", () => {
  assert.throws(
    () =>
      buildMacProvider('web-to-a2a', {
        ...gcpEnv({
          NODE_ENV: 'production',
        }),
        GCP_KMS_MAC_WEB_TO_A2A_VERSION:
          'projects/x/cryptoKeyVersions/1',
        WEB_TO_A2A_HMAC_KEY: '0x' + 'd'.repeat(64),
      }),
    /WEB_TO_A2A_HMAC_KEY/,
  )
})

test("production guard allows clean prod env (all forbidden vars absent)", () => {
  // Sanity: with NODE_ENV='production' + 'gcp-kms' + all GCP env present
  // + every forbidden static key ABSENT, the factory must reach the
  // staged "not yet implemented" throw (not the production guard).
  assert.throws(
    () =>
      buildKeyProvider(
        gcpEnv({
          NODE_ENV: 'production',
          GCP_KMS_SESSION_KEK:
            'projects/x/cryptoKeys/y',
        }),
      ),
    /GCP backend not yet implemented for session provider \(G-PR-2\)/,
  )
})
