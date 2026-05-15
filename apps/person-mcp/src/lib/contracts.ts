/**
 * Phase 4 — Read-only on-chain access for person-mcp.
 *
 * Person-mcp holds no signing capability. Any read it needs (e.g., to
 * resolve relationship edges before issuing an emit-edge MCP write) goes
 * through this public client; any write forwards to a2a-agent via
 * `../lib/a2a-client.ts`.
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

export function requireAgentRelationshipAddress(): Address {
  if (!config.agentRelationshipAddress) {
    throw new Error('person-mcp: AGENT_RELATIONSHIP_ADDRESS not set')
  }
  return config.agentRelationshipAddress
}

export function requireAgentAccountResolverAddress(): Address {
  if (!config.agentAccountResolverAddress) {
    throw new Error('person-mcp: AGENT_ACCOUNT_RESOLVER_ADDRESS not set')
  }
  return config.agentAccountResolverAddress
}
