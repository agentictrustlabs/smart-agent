import { readFileSync } from 'node:fs'
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

const requiredAddress = process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS
if (!requiredAddress) {
  throw new Error('CREDENTIAL_REGISTRY_CONTRACT_ADDRESS env is required')
}

// Phase 1 — org-mcp owns NO wallet/signer. All on-chain redeems are forwarded
// to a2a-agent's privileged session endpoints (see lib/a2a-client.ts). The
// previous ORG_MCP_EOA path was retired alongside the D_onchain side-channel.
export const config = {
  port: Number(process.env.ORG_MCP_PORT ?? '3400'),
  displayName: process.env.ORG_DISPLAY_NAME ?? 'Catalyst NoCo Network',
  privateKey: (process.env.ORG_PRIVATE_KEY ?? ('0x' + 'c'.repeat(64))) as `0x${string}`,
  chainId: Number(process.env.ORG_CHAIN_ID ?? '31337'),
  rpcUrl: process.env.RPC_URL ?? 'http://localhost:8545',
  credentialRegistryAddress: requiredAddress as `0x${string}`,
  privateStorePath: process.env.ORG_PRIVATE_STORE_PATH ?? './org-private.db',
  issuerBaseUrl: process.env.ORG_ISSUER_BASE_URL ?? 'http://localhost:3400',
  // Auth foundation (delegation tokens, ERC-1271, JTI tracking) — required for tool gating
  delegationManagerAddress: (process.env.DELEGATION_MANAGER_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  agentAccountResolverAddress: process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined,
  agentRelationshipAddress: process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}` | undefined,
  // Phase 1 — read-only target addresses (callData encoders + DiscoveryService).
  // Pool/round on-chain writes route via a2a-agent inter-service endpoints,
  // which independently validate target/selector against TOOL_POLICIES.
  poolRegistryAddress: process.env.POOL_REGISTRY_ADDRESS as `0x${string}` | undefined,
  fundRegistryAddress: process.env.FUND_REGISTRY_ADDRESS as `0x${string}` | undefined,
  // Spec 004 — on-chain marketplace registries.
  voteRegistryAddress: process.env.VOTE_REGISTRY_ADDRESS as `0x${string}` | undefined,
  grantProposalRegistryAddress: process.env.GRANT_PROPOSAL_REGISTRY_ADDRESS as `0x${string}` | undefined,
  pledgeRegistryAddress: process.env.PLEDGE_REGISTRY_ADDRESS as `0x${string}` | undefined,
  matchInitiationRegistryAddress: process.env.MATCH_INITIATION_REGISTRY_ADDRESS as `0x${string}` | undefined,
}
