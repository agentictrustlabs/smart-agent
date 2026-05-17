/**
 * KMS migration K3-extension — per-side MAC provider factory.
 *
 * The eight inter-service HMAC keys today are static env secrets:
 *   - `WEB_TO_A2A_HMAC_KEY`              — web → a2a-agent
 *   - `A2A_INTERSERVICE_HMAC_KEY_PERSON` — person-mcp → a2a-agent
 *   - `A2A_INTERSERVICE_HMAC_KEY_ORG`    — org-mcp → a2a-agent
 *   - `A2A_INTERSERVICE_HMAC_KEY_FAMILY`
 *   - `A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP`
 *   - `A2A_INTERSERVICE_HMAC_KEY_VERIFIER`
 *   - `A2A_INTERSERVICE_HMAC_KEY_SKILL`
 *   - `A2A_INTERSERVICE_HMAC_KEY_GEO`
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
 *   - `vault-transit` → throws "not implemented (sibling)"
 *
 * Production guard mirrors the rest of the family: `local-aes` in prod throws.
 */
import { createAwsKmsMacProvider, type KmsMacProvider } from './aws-kms-mac'
import { createLocalHmacProvider } from './local-hmac'

/**
 * The eight MAC keys in the system. The string identifiers are stable —
 * they appear in env var names, IAM policy resource conditions, and logs.
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
] as const

export type MacKeyId = (typeof MAC_KEY_IDS)[number]

/** The seven MCP role names that talk to a2a-agent. */
export type McpName =
  | 'person'
  | 'org'
  | 'family'
  | 'people-group'
  | 'verifier'
  | 'skill'
  | 'geo'

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
}

/**
 * Map a `MacKeyId` to its env-var name pair.
 *
 *   - Legacy (`local-aes`): the existing static-secret env var
 *     (`WEB_TO_A2A_HMAC_KEY`, `A2A_INTERSERVICE_HMAC_KEY_<MCP>`).
 *   - AWS KMS (`aws-kms`):  the per-key `AWS_KMS_MAC_KEY_ID_<MAC_KEY_ID>`
 *     env var (e.g. `AWS_KMS_MAC_KEY_ID_WEB_TO_A2A`).
 */
export function envKeyForMacKeyId(macKeyId: MacKeyId): {
  legacy: string
  awsKms: string
} {
  switch (macKeyId) {
    case 'web-to-a2a':
      return { legacy: 'WEB_TO_A2A_HMAC_KEY', awsKms: 'AWS_KMS_MAC_KEY_ID_WEB_TO_A2A' }
    case 'a2a-to-person':
      return { legacy: 'A2A_INTERSERVICE_HMAC_KEY_PERSON', awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON' }
    case 'a2a-to-org':
      return { legacy: 'A2A_INTERSERVICE_HMAC_KEY_ORG', awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_ORG' }
    case 'a2a-to-family':
      return { legacy: 'A2A_INTERSERVICE_HMAC_KEY_FAMILY', awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_FAMILY' }
    case 'a2a-to-people-group':
      return { legacy: 'A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP', awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_PEOPLE_GROUP' }
    case 'a2a-to-verifier':
      return { legacy: 'A2A_INTERSERVICE_HMAC_KEY_VERIFIER', awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER' }
    case 'a2a-to-skill':
      return { legacy: 'A2A_INTERSERVICE_HMAC_KEY_SKILL', awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_SKILL' }
    case 'a2a-to-geo':
      return { legacy: 'A2A_INTERSERVICE_HMAC_KEY_GEO', awsKms: 'AWS_KMS_MAC_KEY_ID_A2A_TO_GEO' }
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
    case 'vault-transit':
      throw new Error(
        `buildMacProvider(${macKeyId}): 'vault-transit' MAC provider not implemented (sibling)`,
      )
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
 * Build the MAC provider scoped to web → a2a-agent. Used in the web app's
 * signing clients (session-store, wallet-action dispatch).
 */
export function buildWebMacProvider(env: McpMacProviderEnv): KmsMacProvider {
  return buildProviderForMacKeyId('web-to-a2a', env)
}
