// Load .env
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

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/**
 * Defense-in-depth defaults applied by the WalletAction verifier when the
 * minted SessionGrant.v1 omits `scope.maxActions` / `scope.maxActionsPerMinute`.
 *
 * Sprint 2 S2.1 — `SessionGrant.v1` declares these fields but the verifier
 * used to ignore them. A compromised session could replay actions up to the
 * TTL window with no ceiling. We now enforce the field's value when present,
 * and these conservative defaults when absent.
 */
const DEFAULT_MAX_ACTIONS = 1000
const DEFAULT_MAX_ACTIONS_PER_MINUTE = 60

export const config = {
  /** DelegationManager contract address — REQUIRED for on-chain delegation verification */
  delegationManagerAddress: requireEnv('DELEGATION_MANAGER_ADDRESS') as `0x${string}`,

  /** JSON-RPC URL for on-chain verification */
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',

  /** Chain ID */
  chainId: Number(process.env.CHAIN_ID ?? '31337'),

  /** AgentAccountResolver contract address (optional, for on-chain lookups) */
  agentAccountResolverAddress: process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as
    | `0x${string}`
    | undefined,

  /** AgentRelationship contract address (for cross-principal edge discovery) */
  agentRelationshipAddress: process.env.AGENT_RELATIONSHIP_ADDRESS as
    | `0x${string}`
    | undefined,

  /** AgentAssertion contract address (for assertion:make tool) */
  agentAssertionAddress: process.env.AGENT_ASSERTION_ADDRESS as
    | `0x${string}`
    | undefined,
} as const

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid integer for env ${name}: "${raw}"`)
  }
  return n
}

/**
 * Sprint 2 S2.1 — action-counter defaults. Read at call time (not at
 * module-init) so test harnesses that mutate process.env before
 * invoking the verifier see fresh values. Per-grant fields in
 * `SessionGrant.v1.scope` always win when present.
 *
 * @returns The default total-action cap (env `SESSION_DEFAULT_MAX_ACTIONS`).
 */
export function sessionDefaultMaxActions(): number {
  return parseIntEnv('SESSION_DEFAULT_MAX_ACTIONS', DEFAULT_MAX_ACTIONS)
}

/**
 * @returns The default per-minute action cap (env `SESSION_DEFAULT_MAX_ACTIONS_PER_MINUTE`).
 */
export function sessionDefaultMaxActionsPerMinute(): number {
  return parseIntEnv('SESSION_DEFAULT_MAX_ACTIONS_PER_MINUTE', DEFAULT_MAX_ACTIONS_PER_MINUTE)
}
