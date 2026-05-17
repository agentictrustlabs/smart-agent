// Load .env before reading config values
import { readFileSync } from 'fs'
import {
  TOOL_EXECUTOR_IDS,
  toolEnvKeyName,
  MAC_KEY_IDS,
  envKeyForMacKeyId,
} from '@smart-agent/sdk/key-custody'
try {
  const envFile = readFileSync('.env', 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx)
      const val = trimmed.slice(eqIdx + 1)
      if (!process.env[key]) process.env[key] = val
    }
  }
} catch { /* .env not found */ }

function env(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function requireSecret(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required secret: ${key}. The A2A agent will not start without it.`)
  }
  if (value.includes('change-in-production') || value.length < 16) {
    throw new Error(`Weak secret detected for ${key}. Use a strong random value (32+ hex chars).`)
  }
  return value
}

export const config = {
  PORT: parseInt(env('PORT', '3100'), 10),
  RPC_URL: env('RPC_URL', 'http://127.0.0.1:8545'),
  CHAIN_ID: parseInt(env('CHAIN_ID', '31337'), 10),
  A2A_SESSION_SECRET: requireSecret('A2A_SESSION_SECRET'),
  // KMS migration K0+K1+K2 — backend selector for the session-package
  // data-key provider. Defaults to 'local-aes' for dev. Production must
  // set this to 'aws-kms' (K2 v1 target; KMS-IMPLEMENTATION-PLAN.md §3.2a)
  // or, when adopted, 'vault-transit' (§3.2b sibling). `buildKeyProvider`
  // refuses 'local-aes' when NODE_ENV=production.
  A2A_KMS_BACKEND: env('A2A_KMS_BACKEND', 'local-aes'),
  // K2 v1 — AWS KMS routing identifiers. Read here but validated lazily
  // by `buildKeyProvider` on first use so dev/test runs without these set
  // still work as long as A2A_KMS_BACKEND='local-aes'. NONE of these are
  // secrets — see KMS-IMPLEMENTATION-PLAN.md §12.
  AWS_REGION: env('AWS_REGION', ''),
  AWS_ROLE_ARN: env('AWS_ROLE_ARN', ''),
  AWS_KMS_KEY_ID: env('AWS_KMS_KEY_ID', ''),
  // K4 PR-2 — AWS KMS asymmetric `ECC_SECG_P256K1` signing key. SEPARATE
  // from `AWS_KMS_KEY_ID` (the K2 symmetric envelope key): different key
  // spec, different IAM permissions (kms:Sign + kms:GetPublicKey vs
  // kms:GenerateDataKey + kms:Decrypt). Validated below when
  // `A2A_KMS_BACKEND='aws-kms'`.
  AWS_KMS_SIGNER_KEY_ID: env('AWS_KMS_SIGNER_KEY_ID', ''),
  // Host suffix this process matches when extracting agent slugs from the
  // `Host` header (e.g. `rich-pedersen.agent.localhost` → slug `rich-pedersen`).
  // The `.localhost` TLD resolves all subdomains to 127.0.0.1 by spec, so we
  // don't need DNS or a reverse proxy for local dev. Override only when running
  // behind a domain like `agent.example.com`.
  A2A_HOST_BASE: env('A2A_HOST_BASE', 'agent.localhost'),
  AGENT_ACCOUNT_RESOLVER_ADDRESS: env('AGENT_ACCOUNT_RESOLVER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  DELEGATION_MANAGER_ADDRESS: env('DELEGATION_MANAGER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  TIMESTAMP_ENFORCER_ADDRESS: env('TIMESTAMP_ENFORCER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  AGENT_RELATIONSHIP_ADDRESS: env('AGENT_RELATIONSHIP_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  // Phase 2 (sub-delegated path) — caveat enforcer addresses needed for D_sub mints.
  // Values come from packages/contracts deploy script and are propagated by scripts/deploy-local.sh.
  ALLOWED_TARGETS_ENFORCER_ADDRESS: env('ALLOWED_TARGETS_ENFORCER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  ALLOWED_METHODS_ENFORCER_ADDRESS: env('ALLOWED_METHODS_ENFORCER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  VALUE_ENFORCER_ADDRESS: env('VALUE_ENFORCER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  TASK_BINDING_ENFORCER_ADDRESS: env('TASK_BINDING_ENFORCER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  CALLDATA_HASH_ENFORCER_ADDRESS: env('CALLDATA_HASH_ENFORCER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  // Phase 3 (stateful session-account path) — set only when the deploy script
  // includes SessionAgentAccountFactory and the first-party modules.
  ENTRYPOINT_ADDRESS: env('ENTRYPOINT_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  SESSION_AGENT_ACCOUNT_FACTORY_ADDRESS: env('SESSION_AGENT_ACCOUNT_FACTORY_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  ECDSA_SESSION_VALIDATOR_ADDRESS: env('ECDSA_SESSION_VALIDATOR_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  SPEND_CAP_HOOK_ADDRESS: env('SPEND_CAP_HOOK_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  RATE_LIMIT_HOOK_ADDRESS: env('RATE_LIMIT_HOOK_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  TARGET_SELECTOR_ALLOWLIST_HOOK_ADDRESS: env('TARGET_SELECTOR_ALLOWLIST_HOOK_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  REVOCATION_MODULE_ADDRESS: env('REVOCATION_MODULE_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  // The master EOA that owns the SessionAgentAccounts created by this a2a-agent.
  // For local dev this is a deterministic key (anvil account #1 by convention).
  // For production, this is the AWS KMS asymmetric `ECC_SECG_P256K1` key
  // (K4 PR-2) — the env var is only the dev fallback, read by
  // `createLocalSecp256k1Signer` when `A2A_KMS_BACKEND='local-aes'`.
  //
  // KMS K4 PR-1: renamed from `A2A_MASTER_EOA_PRIVATE_KEY` to
  // `A2A_MASTER_PRIVATE_KEY`. The "EOA" suffix is misleading once the key
  // lives in KMS (KMS-resident keys are still EOAs on-chain). The old name
  // is read as a fallback for one release cycle; PR-5 removes it. Deploys
  // running only the old name receive a deprecation warning on boot.
  A2A_MASTER_PRIVATE_KEY: (process.env.A2A_MASTER_PRIVATE_KEY
    ?? process.env.A2A_MASTER_EOA_PRIVATE_KEY
    ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
} as const

// ─── Deprecation: A2A_MASTER_EOA_PRIVATE_KEY → A2A_MASTER_PRIVATE_KEY ─
// One-cycle backwards-compat. PR-5 of the K4 migration removes the old
// name from the codebase entirely. Emit a single warning at boot so
// operators can update their .env files before the next cutover.
if (process.env.A2A_MASTER_EOA_PRIVATE_KEY && !process.env.A2A_MASTER_PRIVATE_KEY) {
  console.warn(
    '[config] A2A_MASTER_EOA_PRIVATE_KEY is deprecated; rename to A2A_MASTER_PRIVATE_KEY ' +
      '(K4 PR-1; the old name is removed in PR-5).',
  )
}

// ─── KMS backend fail-fast validation ────────────────────────────────
// When A2A_KMS_BACKEND='aws-kms' (or 'vault-transit' once adopted), every
// required env var must be present and well-formed at process boot.
// `buildKeyProvider` performs the same checks lazily on first use, but
// failing here gives the operator a clean startup error rather than a
// runtime 503 on the first /session/init call.
if (config.A2A_KMS_BACKEND === 'aws-kms') {
  if (!config.AWS_REGION) {
    throw new Error("config: AWS_REGION is required when A2A_KMS_BACKEND='aws-kms'")
  }
  if (!config.AWS_ROLE_ARN) {
    throw new Error("config: AWS_ROLE_ARN is required when A2A_KMS_BACKEND='aws-kms'")
  }
  if (!/^arn:aws:iam::\d+:role\/.+$/.test(config.AWS_ROLE_ARN)) {
    throw new Error(
      "config: AWS_ROLE_ARN must match 'arn:aws:iam::<account>:role/<name>'",
    )
  }
  if (!config.AWS_KMS_KEY_ID) {
    throw new Error("config: AWS_KMS_KEY_ID is required when A2A_KMS_BACKEND='aws-kms'")
  }
  // Permissive: accept key ARN, bare UUID, or alias.
  const keyIdPattern =
    /^(arn:aws:kms:[a-z0-9-]+:\d+:key\/[a-zA-Z0-9-]+|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|alias\/.+)$/
  if (!keyIdPattern.test(config.AWS_KMS_KEY_ID)) {
    throw new Error(
      "config: AWS_KMS_KEY_ID must be a key ARN, UUID, or alias when A2A_KMS_BACKEND='aws-kms'",
    )
  }
  // K4 PR-2 — also require the asymmetric signer key (separate from above).
  if (!config.AWS_KMS_SIGNER_KEY_ID) {
    throw new Error(
      "config: AWS_KMS_SIGNER_KEY_ID is required when A2A_KMS_BACKEND='aws-kms' " +
        '(K4 PR-2; the asymmetric ECC_SECG_P256K1 signing key — separate from AWS_KMS_KEY_ID).',
    )
  }
  if (!keyIdPattern.test(config.AWS_KMS_SIGNER_KEY_ID)) {
    throw new Error(
      "config: AWS_KMS_SIGNER_KEY_ID must be a key ARN, UUID, or alias when A2A_KMS_BACKEND='aws-kms'",
    )
  }
  // K5 — per-tool executor KMS keys. Each tool family has its OWN
  // asymmetric `ECC_SECG_P256K1` CMK; a leaked agent process can sign
  // only with the keys whose ARNs the IAM role has `kms:Sign` on. The
  // canonical list lives in `@smart-agent/sdk/key-custody` so we import
  // and iterate. This block fails-fast at boot if any tool's KMS key
  // id is missing or malformed.
  for (const toolId of TOOL_EXECUTOR_IDS) {
    const envName = toolEnvKeyName(toolId, 'aws-kms')
    const keyId = process.env[envName]
    if (!keyId) {
      throw new Error(
        `config: ${envName} is required when A2A_KMS_BACKEND='aws-kms' ` +
          `(K5; each tool family has a SEPARATE KMS key for defense in depth).`,
      )
    }
    if (!keyIdPattern.test(keyId)) {
      throw new Error(
        `config: ${envName} must be a key ARN, UUID, or alias when A2A_KMS_BACKEND='aws-kms'`,
      )
    }
  }
}
