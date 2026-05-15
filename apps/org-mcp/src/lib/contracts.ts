/**
 * Phase 1 — Read-only on-chain access for org-mcp.
 *
 * The org-mcp no longer holds any signing capability. On-chain writes are
 * forwarded to a2a-agent's `/session/:id/redeem-tx` and `/session/:id/deploy-agent`
 * endpoints (see `../a2a-client.ts`). This file is retained for:
 *
 *   - `getPublicClient()` — JSON-RPC reader (used by any future read paths)
 *   - `requirePoolRegistryAddress()` / `requireFundRegistryAddress()` —
 *     env wiring for the targets that callData encoders point at.
 *
 * Removed in Phase 1:
 *   - `getWalletClient()`     — wallet retired; signing is delegated to a2a-agent
 *   - `deploySmartAccount()`  — moved to a2a-agent /session/:id/deploy-agent
 *   - `requireAgentFactoryAddress()` — only used by the deleted wallet path
 */
import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from 'viem'
import { foundry, sepolia } from 'viem/chains'
import { config } from '../config.js'

function getChain() {
  if (config.chainId === 31337) return foundry
  if (config.chainId === 11155111) return sepolia
  return foundry
}

let _publicClient: PublicClient | null = null

export function getPublicClient(): PublicClient {
  if (_publicClient) return _publicClient
  _publicClient = createPublicClient({
    chain: getChain(),
    transport: http(config.rpcUrl),
  })
  return _publicClient
}

export function requirePoolRegistryAddress(): Address {
  if (!config.poolRegistryAddress) {
    throw new Error('org-mcp: POOL_REGISTRY_ADDRESS not set')
  }
  return config.poolRegistryAddress
}

export function requireFundRegistryAddress(): Address {
  if (!config.fundRegistryAddress) {
    throw new Error('org-mcp: FUND_REGISTRY_ADDRESS not set')
  }
  return config.fundRegistryAddress
}

export function requireVoteRegistryAddress(): Address {
  if (!config.voteRegistryAddress) {
    throw new Error('org-mcp: VOTE_REGISTRY_ADDRESS not set')
  }
  return config.voteRegistryAddress
}

export function requireGrantProposalRegistryAddress(): Address {
  if (!config.grantProposalRegistryAddress) {
    throw new Error('org-mcp: GRANT_PROPOSAL_REGISTRY_ADDRESS not set')
  }
  return config.grantProposalRegistryAddress
}

export function requirePledgeRegistryAddress(): Address {
  if (!config.pledgeRegistryAddress) {
    throw new Error('org-mcp: PLEDGE_REGISTRY_ADDRESS not set')
  }
  return config.pledgeRegistryAddress
}

export function requireMatchInitiationRegistryAddress(): Address {
  if (!config.matchInitiationRegistryAddress) {
    throw new Error('org-mcp: MATCH_INITIATION_REGISTRY_ADDRESS not set')
  }
  return config.matchInitiationRegistryAddress
}

export function requireCommitmentRegistryAddress(): Address {
  if (!config.commitmentRegistryAddress) {
    throw new Error('org-mcp: COMMITMENT_REGISTRY_ADDRESS not set')
  }
  return config.commitmentRegistryAddress
}

export function requireProposalRegistryAddress(): Address {
  if (!config.proposalRegistryAddress) {
    throw new Error('org-mcp: PROPOSAL_REGISTRY_ADDRESS not set')
  }
  return config.proposalRegistryAddress
}
