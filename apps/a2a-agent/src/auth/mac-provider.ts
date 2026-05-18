/**
 * Selector for the active per-key `KmsMacProvider` family (KMS migration
 * K3-extension).
 *
 * Mirrors the shape of `key-provider.ts`'s `buildSignerBackend`:
 *
 *   - `MAC_KEY_IDS` enumerates every MAC key in the system.
 *   - `buildMacProvider(macKeyId, env)` selects on `env.A2A_KMS_BACKEND`
 *     and returns the matching `KmsMacProvider` for that one key.
 *   - The middleware (`requireInterServiceAuth`, `requireServiceAuth`)
 *     wraps `buildMacProvider` in a per-MacKeyId Map so the provider is
 *     constructed exactly once per process lifetime, lazily on first use.
 *
 * a2a-agent holds the verifier for all eight keys (it terminates every
 * inbound HMAC envelope). MCPs and the web app only hold their own
 * outbound key. The defense-in-depth posture is preserved by the per-key
 * IAM scoping in production — see `docs/operations/kms-signer-setup.md`
 * § "Inter-service MAC keys".
 */
import type { KmsMacProvider, MacKeyId } from '@smart-agent/sdk/key-custody'
import {
  createAwsKmsMacProvider,
  createLocalHmacProvider,
  envKeyForMacKeyId,
  MAC_KEY_IDS,
} from '@smart-agent/sdk/key-custody'
import {
  assertNoForbiddenStaticKeys,
  type KeyProviderEnv,
} from './key-provider'
import { createGcpAuthClient, GCP_AUTH_ENV_KEYS } from '@smart-agent/sdk/key-custody'

export type { MacKeyId }
export { MAC_KEY_IDS }

export interface MacProviderEnv {
  A2A_KMS_BACKEND?: string
  NODE_ENV?: string
  AWS_REGION?: string
  AWS_ROLE_ARN?: string
  /** Per-key env vars (both legacy `*_HMAC_KEY` and `AWS_KMS_MAC_KEY_ID_*`). */
  [key: string]: string | undefined
}

/**
 * Build the MAC provider for a single key id. The factory is intentionally
 * narrow — one MacKeyId in, one provider out. Caching lives in the
 * middleware so the cache scope is the process, not module load.
 *
 * @throws if the env shape required for the chosen backend is incomplete.
 */
export function buildMacProvider(
  macKeyId: MacKeyId,
  env: MacProviderEnv,
): KmsMacProvider {
  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'
  const { legacy, awsKms } = envKeyForMacKeyId(macKeyId)

  if (env.NODE_ENV === 'production' && backend === 'local-aes') {
    throw new Error(
      `buildMacProvider(${macKeyId}): refusing to instantiate 'local-aes' in production. ` +
        "Set A2A_KMS_BACKEND='aws-kms' and provision per-key KMS HMAC keys.",
    )
  }

  switch (backend) {
    case 'local-aes':
      return createLocalHmacProvider({
        envKey: legacy,
        NODE_ENV: env.NODE_ENV,
        env,
      })
    case 'aws-kms': {
      if (!env.AWS_REGION) {
        throw new Error(`buildMacProvider(${macKeyId}): AWS_REGION is required for 'aws-kms'`)
      }
      if (!env.AWS_ROLE_ARN) {
        throw new Error(`buildMacProvider(${macKeyId}): AWS_ROLE_ARN is required for 'aws-kms'`)
      }
      const keyId = env[awsKms]
      if (!keyId) {
        throw new Error(
          `buildMacProvider(${macKeyId}): ${awsKms} is required for 'aws-kms' backend`,
        )
      }
      return createAwsKmsMacProvider({
        AWS_REGION: env.AWS_REGION,
        AWS_ROLE_ARN: env.AWS_ROLE_ARN,
        AWS_KMS_MAC_KEY_ID: keyId,
      })
    }
    case 'gcp-kms': {
      // GCP-KMS G-PR-1 stub for the per-side inter-service MAC provider.
      // Same validate → build-auth-client → throw pattern as the other
      // factories. The MAC-specific identifier is per MacKeyId:
      // `GCP_KMS_MAC_<MAC_KEY_ID>_VERSION`. Implementation lands in G-PR-5.
      for (const key of GCP_AUTH_ENV_KEYS) {
        if (!env[key]) {
          throw new Error(
            `buildMacProvider(${macKeyId}): ${key} is required for 'gcp-kms' backend ` +
              '(GCP-KMS-IMPLEMENTATION-PLAN.md § G1).',
          )
        }
      }
      if (env.NODE_ENV === 'production') {
        // The MAC factory accepts a narrower env shape than the
        // KeyProviderEnv used by the other three factories — coerce via
        // an indexed read so the shared production-guard helper still
        // works.
        assertNoForbiddenStaticKeys(env as KeyProviderEnv, 'gcp-kms')
      }
      // Build the auth client so auth-env errors surface before the
      // staged marker.
      createGcpAuthClient({
        GCP_PROJECT_ID: env.GCP_PROJECT_ID as string,
        GCP_PROJECT_NUMBER: env.GCP_PROJECT_NUMBER as string,
        GCP_WORKLOAD_IDENTITY_POOL_ID: env.GCP_WORKLOAD_IDENTITY_POOL_ID as string,
        GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:
          env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID as string,
        GCP_SERVICE_ACCOUNT_EMAIL: env.GCP_SERVICE_ACCOUNT_EMAIL as string,
      })
      const gcpVersionEnvName = `GCP_KMS_MAC_${macKeyId
        .replace(/-/g, '_')
        .toUpperCase()}_VERSION`
      if (!env[gcpVersionEnvName]) {
        throw new Error(
          `buildMacProvider(${macKeyId}): ${gcpVersionEnvName} is required for 'gcp-kms' backend ` +
            '(GCP-KMS-IMPLEMENTATION-PLAN.md § G5).',
        )
      }
      throw new Error(
        `GCP backend not yet implemented for MAC provider "${macKeyId}" (G-PR-5). ` +
          'See output/GCP-KMS-IMPLEMENTATION-PLAN.md § G5.',
      )
    }
    default:
      throw new Error(`buildMacProvider: unknown A2A_KMS_BACKEND: ${backend}`)
  }
}

/**
 * Lazy per-process cache so each unique MacKeyId constructs its provider
 * exactly once. Exported as a factory so tests can spin up an isolated
 * cache per-test (avoids leaking provider state across tests).
 */
export function createMacProviderCache(env: MacProviderEnv): {
  get: (macKeyId: MacKeyId) => KmsMacProvider
} {
  const cache = new Map<MacKeyId, KmsMacProvider>()
  return {
    get(macKeyId: MacKeyId): KmsMacProvider {
      const cached = cache.get(macKeyId)
      if (cached) return cached
      const provider = buildMacProvider(macKeyId, env)
      cache.set(macKeyId, provider)
      return provider
    },
  }
}

/**
 * Module-level cache that reads `process.env` once per resolve and reuses
 * providers across requests. The middleware uses this — every request goes
 * through `defaultMacProviderCache.get(macKeyId)`.
 */
export const defaultMacProviderCache = createMacProviderCache(
  process.env as MacProviderEnv,
)
