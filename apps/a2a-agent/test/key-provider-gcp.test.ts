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

// ─── buildKeyProvider ─ session envelope encryption (G-PR-2 LIVE) ────

test("buildKeyProvider('gcp-kms') with valid GCP env + session KEK returns a real GcpKmsProvider", () => {
  const provider = buildKeyProvider(
    gcpEnv({
      GCP_KMS_SESSION_KEK:
        'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/session-kek',
    }),
  ) as unknown as { backend?: string; keyVersion: string }
  // G-PR-2 lights up `createGcpKmsProvider`. The returned object exposes
  // both the `A2AKeyProvider` shape and the `backend: 'gcp-kms'` tag.
  assert.equal(provider.backend, 'gcp-kms')
  assert.ok(
    provider.keyVersion.startsWith('gcp-kms:'),
    `keyVersion '${provider.keyVersion}' must start with 'gcp-kms:'`,
  )
})

test("buildKeyProvider('gcp-kms') with GCP_KMS_SESSION_KEK_VERSION pin surfaces the pinned version in keyVersion", () => {
  const provider = buildKeyProvider(
    gcpEnv({
      GCP_KMS_SESSION_KEK:
        'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/session-kek',
      GCP_KMS_SESSION_KEK_VERSION:
        'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/session-kek/cryptoKeyVersions/3',
    }),
  ) as unknown as { keyVersion: string }
  assert.equal(provider.keyVersion, 'gcp-kms:3')
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

// ─── buildSignerBackend ─ master-EOA signer (G-PR-3 LIVE) ────────────

test("buildSignerBackend('gcp-kms') with valid GCP env + master version returns a real GcpKmsSigner", () => {
  const backend = buildSignerBackend(
    gcpEnv({
      GCP_KMS_MASTER_SIGNER_VERSION:
        'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/master-signer/cryptoKeyVersions/1',
    }),
  ) as unknown as { backend?: string; keyVersion: string; keyId: string }
  // G-PR-3 lights up `createGcpKmsSigner`. The returned object exposes
  // the `KmsAccountBackend` shape PLUS the backend/keyId/keyVersion
  // tag-fields so callers can identify the backend without an
  // `instanceof` check.
  assert.equal(backend.backend, 'gcp-kms')
  assert.equal(backend.keyVersion, 'gcp-kms:1')
  assert.ok(backend.keyId.endsWith('/cryptoKeyVersions/1'))
})

test("buildSignerBackend('gcp-kms') missing GCP_PROJECT_NUMBER throws clean error", () => {
  const env = gcpEnv({
    GCP_KMS_MASTER_SIGNER_VERSION:
      'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',
  })
  delete env.GCP_PROJECT_NUMBER
  assert.throws(
    () => buildSignerBackend(env),
    /GCP_PROJECT_NUMBER is required/,
  )
})

test("buildSignerBackend('gcp-kms') missing GCP_KMS_MASTER_SIGNER_VERSION throws clean error naming the env var", () => {
  assert.throws(
    () => buildSignerBackend(gcpEnv()),
    /GCP_KMS_MASTER_SIGNER_VERSION is required/,
  )
})

test("buildSignerBackend('gcp-kms') with malformed GCP_KMS_MASTER_SIGNER_VERSION throws format error", () => {
  // Parent-key path (no /cryptoKeyVersions/ suffix). The signer pins to
  // a specific version because each version has its own public key.
  assert.throws(
    () =>
      buildSignerBackend(
        gcpEnv({
          GCP_KMS_MASTER_SIGNER_VERSION:
            'projects/p/locations/l/keyRings/r/cryptoKeys/k',
        }),
      ),
    /must match.*cryptoKeyVersions/,
  )
})

// ─── buildToolExecutorBackend ─ per-tool signers (G-PR-4) ────────────

test("buildToolExecutorBackend('gcp-kms') with malformed version path rejects via signer format validation (G-PR-4)", () => {
  // The signer pins to a specific version (each version has its own
  // public key). A non-fully-qualified path now reaches the underlying
  // `createGcpKmsSigner` constructor which enforces the canonical
  // `projects/.../cryptoKeyVersions/<n>` format. Pre-G-PR-4 this branch
  // threw the staged "not yet implemented" marker; G-PR-4 wires the
  // signer and surfaces the same format-validation error the master
  // signer test asserts.
  assert.throws(
    () =>
      buildToolExecutorBackend(
        'round-awards',
        gcpEnv({
          GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION:
            'projects/x/cryptoKeys/round-awards/cryptoKeyVersions/1',
        }),
      ),
    /must match.*cryptoKeyVersions/,
  )
})

test("buildToolExecutorBackend('gcp-kms') with valid env + fully-qualified per-tool version constructs a signer (G-PR-4)", () => {
  const backend = buildToolExecutorBackend(
    'round-awards',
    gcpEnv({
      GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION:
        'projects/p/locations/global/keyRings/r/cryptoKeys/tool-round-awards/cryptoKeyVersions/1',
    }),
  )
  // Signer is constructed lazily; method surface is the contract.
  assert.equal(typeof backend.signA2AAction, 'function')
  assert.equal(typeof backend.getSignerAddress, 'function')
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

// ─── buildMacProvider ─ inter-service MAC (G-PR-5 LIVE) ──────────────

test("buildMacProvider('gcp-kms') with valid GCP env + per-MAC-key version returns a real GcpKmsMacProvider", () => {
  const provider = buildMacProvider('web-to-a2a', {
    ...gcpEnv(),
    GCP_KMS_MAC_WEB_TO_A2A_VERSION:
      'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/mac-web-to-a2a/cryptoKeyVersions/1',
  }) as unknown as {
    backend?: string
    macKeyId?: string
    keyVersionPath?: string
  }
  // G-PR-5 lights up `createGcpKmsMacProvider`. The returned object
  // exposes the KmsMacProvider shape PLUS the backend/macKeyId/keyVersionPath
  // tag-fields so callers can identify the backend.
  assert.equal(provider.backend, 'gcp-kms')
  assert.equal(provider.macKeyId, 'web-to-a2a')
  assert.ok(
    provider.keyVersionPath?.endsWith('/cryptoKeyVersions/1'),
    `keyVersionPath '${provider.keyVersionPath}' must end with /cryptoKeyVersions/1`,
  )
})

test("buildMacProvider('gcp-kms') with malformed GCP_KMS_MAC_<...>_VERSION throws format error", () => {
  // Parent-key path (no /cryptoKeyVersions/ suffix). The MAC provider
  // pins to a specific version because each version is an independent
  // secret.
  assert.throws(
    () =>
      buildMacProvider('web-to-a2a', {
        ...gcpEnv(),
        GCP_KMS_MAC_WEB_TO_A2A_VERSION:
          'projects/p/locations/l/keyRings/r/cryptoKeys/k',
      }),
    /must match.*cryptoKeyVersions/,
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
  // + every forbidden static key ABSENT, the factory must successfully
  // return a real `GcpKmsProvider` (G-PR-2 — provider live).
  const provider = buildKeyProvider(
    gcpEnv({
      NODE_ENV: 'production',
      GCP_KMS_SESSION_KEK:
        'projects/smart-agent-prod/locations/global/keyRings/a2a/cryptoKeys/session-kek',
    }),
  ) as unknown as { backend?: string; keyVersion: string }
  assert.equal(provider.backend, 'gcp-kms')
  assert.ok(provider.keyVersion.startsWith('gcp-kms:'))
})
