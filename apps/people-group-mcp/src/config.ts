import { readFileSync } from 'node:fs'

// Hand-parse .env so we don't pull dotenv as a dep. Matches org-mcp/person-mcp.
try {
  const envFile = readFileSync('.env', 'utf-8')
  for (const line of envFile.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0) {
      const k = t.slice(0, i); const v = t.slice(i + 1)
      if (!process.env[k]) process.env[k] = v
    }
  }
} catch { /* .env not found */ }

// ─── Curator allowlist (ADR-PG-2) ─────────────────────────────────────
// MUST be loaded from a non-NEXT_PUBLIC_ env var or a VCS-checked source.
// Never from runtime DB or request headers.
//
// Format: comma-separated 0x… smart-account addresses (lowercase).
// In dev/demo: defaults to the deployer address.
function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set()
  return new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
}

const DEFAULT_DENY_LIST = [
  'underground', 'persecut', 'secret', 'hidden',
  'crypto-', 'clandestine', 'at-risk', 'house church',
]

function parseDenyList(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_DENY_LIST
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

export const config = {
  port: Number(process.env.PEOPLE_GROUP_MCP_PORT ?? '3300'),
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? '31337'),
  rpcUrl: process.env.RPC_URL ?? 'http://localhost:8545',
  privateStorePath: process.env.PEOPLE_GROUP_MCP_DB_PATH ?? './people-group-mcp.db',

  // Auth foundation (delegation tokens, ERC-1271, revocation tracking).
  delegationManagerAddress: (process.env.DELEGATION_MANAGER_ADDRESS
    ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  agentAccountResolverAddress: process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined,
  agentRelationshipAddress: process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}` | undefined,

  // Cross-MCP integrity: where to ask geo-mcp whether a feature exists.
  geoMcpUrl: process.env.GEO_MCP_URL ?? 'http://localhost:3201',

  // ADR-PG-2: hard-coded curator allowlist for v1. Phase-2 migrates to
  // an on-chain sa:RegistryCurator role.
  curatorAllowlist: parseAllowlist(process.env.PEOPLE_GROUP_CURATOR_ALLOWLIST
    ?? process.env.DEPLOYER_ADDRESS),

  // ADR-PG-3: forbidden-substring deny-list for T1 displayName.
  t1DisplayNameDenyList: parseDenyList(process.env.PEOPLE_GROUP_T1_DENY_LIST),
  t1DisplayNameMaxLength: Number(process.env.PEOPLE_GROUP_T1_DISPLAY_MAX ?? '80'),

  // SEC-9: audit-log retention (days) for via='direct' rows.
  // Cross-delegation rows are kept forever.
  directAuditRetentionDays: Number(process.env.PEOPLE_GROUP_DIRECT_AUDIT_DAYS ?? '365'),
}

// Convenience for tooling that wants to know if curator gating is functional.
export const hasCuratorAllowlist = () => config.curatorAllowlist.size > 0

export type Config = typeof config
