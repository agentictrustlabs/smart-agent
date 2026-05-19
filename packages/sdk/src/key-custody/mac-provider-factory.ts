/**
 * KMS migration K3-extension — per-side MAC provider factory.
 *
 * The ten HMAC keys in the system today are static env secrets:
 *   - `WEB_TO_A2A_HMAC_KEY`              — web → a2a-agent
 *   - `A2A_INTERSERVICE_HMAC_KEY_PERSON` — person-mcp → a2a-agent
 *   - `A2A_INTERSERVICE_HMAC_KEY_ORG`    — org-mcp → a2a-agent
 *   - `A2A_INTERSERVICE_HMAC_KEY_FAMILY`
 *   - `A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP`
 *   - `A2A_INTERSERVICE_HMAC_KEY_VERIFIER`
 *   - `A2A_INTERSERVICE_HMAC_KEY_SKILL`
 *   - `A2A_INTERSERVICE_HMAC_KEY_GEO`
 *   - `A2A_INTERSERVICE_HMAC_KEY_HUB`    — a2a-agent → hub-mcp (#132 bypass:
 *                                          /mcp/hub/* gateway + KB sync)
 *   - `OAUTH_SALT_HMAC_KEY`              — google-oauth email → smart-account
 *                                          deterministic salt (Sprint S2.6;
 *                                          web-internal, no inter-service hop)
 *
 * After K3-extension lands, each is an INDEPENDENT AWS KMS HMAC key
 * (`KeySpec=HMAC_256`, `KeyUsage=GENERATE_VERIFY_MAC`). The canonical
 * message format (`${ts}|${nonce}|${path}|${sha256(body)}`) is unchanged
 * — only the signing primitive swaps.
 *
 * This module exports the canonical `MacKeyId` typebrand, the env-var
 * mapping table both halves of the system use, and two narrow factories:
 *
 *   - `buildMcpMacProvider(mcpName, env)` — used by every MCP's
 *     `a2a-client.ts`; returns the provider scoped to THAT MCP's outbound
 *     a2a-to-X key (defense-in-depth: person-mcp never holds org-mcp's
 *     secret).
 *   - `buildWebMacProvider(env)` — used by the web app's signing clients;
 *     returns the provider scoped to web-to-a2a.
 *
 * a2a-agent has its OWN factory in `apps/a2a-agent/src/auth/mac-provider.ts`
 * that constructs all eight providers (it's the only process that verifies
 * inbound MACs and also signs outbound MACs to MCPs in the future).
 *
 * Backend selection is by `A2A_KMS_BACKEND` (kept identical to the K2/K4
 * selector so deployments still have one switch to flip):
 *   - `local-aes`     → `createLocalHmacProvider` reading the legacy env var
 *   - `aws-kms`       → `createAwsKmsMacProvider` reading the per-MAC-key
 *                       AWS env var (e.g. `AWS_KMS_MAC_KEY_ID_WEB_TO_A2A`)
 *   - `gcp-kms`       → `createGcpKmsMacProvider` reading the per-MAC-key
 *                       GCP env var (e.g. `GCP_KMS_MAC_WEB_TO_A2A_VERSION`)
 *                       (G-PR-5). The `'vault-transit'` deferred-sibling
 *                       case was removed in G-PR-1 (orchestrator decision:
 *                       AWS + GCP only).
 *
 * Production guard mirrors the rest of the family: `local-aes` in prod throws.
 */
import { createAwsKmsMacProvider, type KmsMacProvider } from './aws-kms-mac'
import { createGcpKmsMacProvider } from './gcp-kms-mac'
import { createLocalHmacProvider } from './local-hmac'
import type { GcpAuthEnv } from './gcp-auth'

/**
 * The ten MAC keys in the system. The string identifiers are stable —
 * they appear in env var names, IAM policy resource conditions, and logs.
 *
 * The first nine are the inter-service K3-extension keys (the ninth,
 * `a2a-to-hub`, was added by #132 — `/mcp/hub/*` bypass + KB sync). The
 * tenth, `oauth-salt`, is a web-internal MAC key introduced by Sprint
 * S2.6: it replaces the legacy `SERVER_PEPPER` symmetric env secret that
 * deterministically salted google-oauth email → smart-account derivation.
 * Same shape (HMAC_SHA_256, kms:GenerateMac / kms:VerifyMac), same env
 * conventions; not used for any inter-service hop.
 */
export const MAC_KEY_IDS = [
  'web-to-a2a',
  'a2a-to-person',
  'a2a-to-org',
  'a2a-to-family',
  'a2a-to-people-group',
  'a2a-to-verifier',
  'a2a-to-skill',
  'a2a-to-geo',
  'a2a-to-hub',
  'oauth-salt',
] as const

export type MacKeyId = (typeof MAC_KEY_IDS)[number]

/** The eight MCP role names that talk to a2a-agent. */
export type McpName =
  | 'person'
  | 'org'
  | 'family'
  | 'people-group'
  | 'verifier'
  | 'skill'
  | 'geo'
  | 'hub'

/**
 * `McpName → MacKeyId`. The MCP knows its own role; the factory picks the
 * MAC key from this table. No string concatenation at call sites.
 */
export const MCP_TO_MAC_KEY_ID: Record<McpName, MacKeyId> = {
  person: 'a2a-to-person',
  org: 'a2a-to-org',
  family: 'a2a-to-family',
  'people-group': 'a2a-to-people-group',
  verifier: 'a2a-to-verifier',
  skill: 'a2a-to-skill',
  geo: 'a2a-to-geo',
  hub: 'a2a-to-hub',
}

/**
 * Map a `MacKeyId` to its env-var name triple.
 *
 *   - Legacy (`local-aes`): the existing static-secret env var
 *     (`WEB_TO_A2A_HMAC_KEY`, `A2A_INTERSERVICE_HMAC_KEY_<MCP>`).
 *   - AWS KMS (`aws-kms`):  the per-key `AWS_KMS_MAC_KEY_ID_<MAC_KEY_ID>`
 *     env var (e.g. `AWS_KMS_MAC_KEY_ID_WEB_TO_A2A`).
 *   - GCP KMS (`gcp-kms`):  the per-key `GCP_KMS_MAC_<MAC_KEY_ID>_VERSION`
 *     env var (e.g. `GCP_KMS_MAC_WEB_TO_A2A_VERSION`). Carries a
 *     fully-versioned cryptoKeyVersion resource path because GCP MAC
 *     versions are independent secrets (see G-PR-5).
 */
export function envKeyForMacKeyId(macKeyId: MacKeyId): {
  legacy: string
  awsKms: string
  gcpKms: string
} {
  switch (macKeyId) {
    case 'web-to-a2a':
      return {
        legacy: 'WEB_TO_A2A_HMAC_KEY',
        awsKms: 'AWS_KMS_MAC_KEY_ID_WEB_TO_A2A',
        gcpKms: 'GCP_KMS_MAC_WEB_TO_A2A_VERSION',
      }
    case 'a2a-to-person':
      return {
        legacy: 'A2A_INTERSERVICE_HMAC_KEY_PERSON',
        awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON',
        gcpKms: 'GCP_KMS_MAC_A2A_TO_PERSON_VERSION',
      }
    case 'a2a-to-org':
      return {
        legacy: 'A2A_INTERSERVICE_HMAC_KEY_ORG',
        awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_ORG',
        gcpKms: 'GCP_KMS_MAC_A2A_TO_ORG_VERSION',
      }
    case 'a2a-to-family':
      return {
        legacy: 'A2A_INTERSERVICE_HMAC_KEY_FAMILY',
        awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_FAMILY',
        gcpKms: 'GCP_KMS_MAC_A2A_TO_FAMILY_VERSION',
      }
    case 'a2a-to-people-group':
      return {
        legacy: 'A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP',
        awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_PEOPLE_GROUP',
        gcpKms: 'GCP_KMS_MAC_A2A_TO_PEOPLE_GROUP_VERSION',
      }
    case 'a2a-to-verifier':
      return {
        legacy: 'A2A_INTERSERVICE_HMAC_KEY_VERIFIER',
        awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER',
        gcpKms: 'GCP_KMS_MAC_A2A_TO_VERIFIER_VERSION',
      }
    case 'a2a-to-skill':
      return {
        legacy: 'A2A_INTERSERVICE_HMAC_KEY_SKILL',
        awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_SKILL',
        gcpKms: 'GCP_KMS_MAC_A2A_TO_SKILL_VERSION',
      }
    case 'a2a-to-geo':
      return {
        legacy: 'A2A_INTERSERVICE_HMAC_KEY_GEO',
        awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_GEO',
        gcpKms: 'GCP_KMS_MAC_A2A_TO_GEO_VERSION',
      }
    case 'a2a-to-hub':
      return {
        legacy: 'A2A_INTERSERVICE_HMAC_KEY_HUB',
        awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_HUB',
        gcpKms: 'GCP_KMS_MAC_A2A_TO_HUB_VERSION',
      }
    case 'oauth-salt':
      // Sprint S2.6 — replaces the legacy `SERVER_PEPPER` symmetric env
      // secret. Dev path reads `OAUTH_SALT_HMAC_KEY` (hex); prod path
      // reads `AWS_KMS_MAC_KEY_ID_OAUTH_SALT` (KMS HMAC key ARN) or
      // `GCP_KMS_MAC_OAUTH_SALT_VERSION` (GCP MAC key version path).
      return {
        legacy: 'OAUTH_SALT_HMAC_KEY',
        awsKms: 'AWS_KMS_MAC_KEY_ID_OAUTH_SALT',
        gcpKms: 'GCP_KMS_MAC_OAUTH_SALT_VERSION',
      }
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = macKeyId
      throw new Error(`envKeyForMacKeyId: unknown macKeyId: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Env shape consumed by the MCP / web factories. Same shape as
 * `KeyProviderEnv` in a2a-agent so callers can pass `process.env` directly.
 */
export interface McpMacProviderEnv {
  A2A_KMS_BACKEND?: string
  NODE_ENV?: string
  AWS_REGION?: string
  AWS_ROLE_ARN?: string
  /** Allow arbitrary env-var keys for the per-MAC-key lookups. */
  [key: string]: string | undefined
}

function buildProviderForMacKeyId(
  macKeyId: MacKeyId,
  env: McpMacProviderEnv,
): KmsMacProvider {
  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'
  const { legacy, awsKms, gcpKms } = envKeyForMacKeyId(macKeyId)

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
      // GCP-KMS G-PR-5 — sibling cloud arm. The MCP/web factories on this
      // side perform identifier-only env validation (the production
      // forbidden-static-keys guard lives in the a2a-agent factory at
      // `apps/a2a-agent/src/auth/mac-provider.ts`, which is the only
      // process that holds the union of all keys + auth env).
      const requiredAuth: Array<keyof GcpAuthEnv> = [
        'GCP_PROJECT_ID',
        'GCP_PROJECT_NUMBER',
        'GCP_WORKLOAD_IDENTITY_POOL_ID',
        'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
        'GCP_SERVICE_ACCOUNT_EMAIL',
      ]
      for (const key of requiredAuth) {
        if (!env[key]) {
          throw new Error(
            `buildMacProvider(${macKeyId}): ${key} is required for 'gcp-kms' backend`,
          )
        }
      }
      const keyVersionPath = env[gcpKms]
      if (!keyVersionPath) {
        throw new Error(
          `buildMacProvider(${macKeyId}): ${gcpKms} is required for 'gcp-kms' backend`,
        )
      }
      return createGcpKmsMacProvider(
        {
          GCP_PROJECT_ID: env.GCP_PROJECT_ID as string,
          GCP_PROJECT_NUMBER: env.GCP_PROJECT_NUMBER as string,
          GCP_WORKLOAD_IDENTITY_POOL_ID: env.GCP_WORKLOAD_IDENTITY_POOL_ID as string,
          GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:
            env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID as string,
          GCP_SERVICE_ACCOUNT_EMAIL: env.GCP_SERVICE_ACCOUNT_EMAIL as string,
          keyVersionPath,
        },
        macKeyId,
      )
    }
    default:
      throw new Error(`buildMacProvider: unknown A2A_KMS_BACKEND: ${backend}`)
  }
}

/**
 * Build the MAC provider scoped to a single MCP's outbound traffic to
 * a2a-agent. Used in each MCP's `a2a-client.ts`.
 *
 * @example
 *   const macProvider = buildMcpMacProvider('person', process.env)
 *   const { mac } = await macProvider.generateMac({ canonicalMessage })
 */
export function buildMcpMacProvider(
  mcpName: McpName,
  env: McpMacProviderEnv,
): KmsMacProvider {
  const macKeyId = MCP_TO_MAC_KEY_ID[mcpName]
  if (!macKeyId) {
    throw new Error(`buildMcpMacProvider: unknown mcpName: ${String(mcpName)}`)
  }
  return buildProviderForMacKeyId(macKeyId, env)
}

/**
 * Build the MAC provider scoped to one of the web-side MAC keys.
 *
 * Two callers today:
 *   - `'web-to-a2a'` (default) — session-store + wallet-action dispatch
 *     envelopes between Next.js and a2a-agent.
 *   - `'oauth-salt'` (S2.6) — deterministic salt for google-oauth email →
 *     smart-account derivation (`apps/web/src/lib/auth/oauth-salt.ts`).
 *     A web-internal MAC, never traverses the wire.
 *
 * The `macKeyId` parameter is restricted to the web-side keys at the type
 * level so an MCP key id can't accidentally be requested through this
 * factory. Adding a new web-side MAC means extending this union here.
 */
export type WebMacKeyId = Extract<MacKeyId, 'web-to-a2a' | 'oauth-salt'>

export function buildWebMacProvider(
  env: McpMacProviderEnv,
  macKeyId: WebMacKeyId = 'web-to-a2a',
): KmsMacProvider {
  return buildProviderForMacKeyId(macKeyId, env)
}
