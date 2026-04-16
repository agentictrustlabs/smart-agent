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
} as const
