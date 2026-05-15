// Load .env before reading config values
import { readFileSync } from 'fs'
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
  // For production, the EOA must be pre-funded with gas + treated as a hot wallet.
  A2A_MASTER_EOA_PRIVATE_KEY: env('A2A_MASTER_EOA_PRIVATE_KEY', '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
} as const
