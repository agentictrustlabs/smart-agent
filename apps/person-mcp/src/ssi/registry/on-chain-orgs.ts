/**
 * Read-only helpers for resolving the on-chain org-membership set of a
 * person agent. Uses the AgentRelationship + AgentAccountResolver contracts
 * directly via viem — no SDK side-effects, no wallet client.
 *
 * Returns canonicalised lowercase 0x-addresses; callers run them through
 * `canonicalOrgId` (from @smart-agent/privacy-creds) before commit hashing.
 */

import { createPublicClient, http, type PublicClient } from 'viem'
import {
  agentRelationshipAbi,
  agentAccountResolverAbi,
  HAS_MEMBER,
  TYPE_ORGANIZATION,
} from '@smart-agent/sdk'
import { config } from '../config.js'

const HAS_MEMBER_HEX = (HAS_MEMBER as string).toLowerCase()

let _client: PublicClient | null = null
function client(): PublicClient {
  if (!_client) {
    _client = createPublicClient({
      chain: { id: config.chainId, name: 'sa', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } },
      transport: http(config.rpcUrl),
    })
  }
  return _client
}

function relationshipAddr(): `0x${string}` | null {
  const a = process.env.AGENT_RELATIONSHIP_ADDRESS
  return a ? (a as `0x${string}`) : null
}

function resolverAddr(): `0x${string}` | null {
  const a = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS
  return a ? (a as `0x${string}`) : null
}

/**
 * Active or confirmed HAS_MEMBER edges where the candidate is the object
 * (the member) and the subject is an Organization. Returns lowercase
 * 0x-addresses of the Org subjects.
 */
export async function getOnChainOrgsForPrincipal(principal: `0x${string}`): Promise<string[]> {
  const rel = relationshipAddr()
  const res = resolverAddr()
  if (!rel || !res) return []
  const c = client()

  let edgeIds: `0x${string}`[]
  try {
    edgeIds = (await c.readContract({
      address: rel,
      abi: agentRelationshipAbi,
      functionName: 'getEdgesByObject',
      args: [principal],
    })) as `0x${string}`[]
  } catch { return [] }

  const out: string[] = []
  for (const id of edgeIds) {
    try {
      const edge = await c.readContract({
        address: rel,
        abi: agentRelationshipAbi,
        functionName: 'getEdge',
        args: [id],
      }) as { subject: `0x${string}`; relationshipType: `0x${string}`; status: number }
      if (edge.status < 2) continue
      if ((edge.relationshipType ?? '').toLowerCase() !== HAS_MEMBER_HEX) continue
      const core = await c.readContract({
        address: res,
        abi: agentAccountResolverAbi,
        functionName: 'getCore',
        args: [edge.subject],
      }) as { agentType: `0x${string}`; active: boolean }
      if (core.agentType === TYPE_ORGANIZATION && core.active) {
        out.push(edge.subject.toLowerCase())
      }
    } catch { /* skip bad edge */ }
  }
  return out
}

/**
 * Same shape, but for any candidate (the public-set lookup that the web
 * search action used to do per-candidate). Lets the MCP build the public
 * set itself if a future flow chooses to skip the web's pre-computed list.
 */
export async function getPublicOrgsForAgent(agent: `0x${string}`): Promise<string[]> {
  return getOnChainOrgsForPrincipal(agent)
}

/** Extract the address from a `did:ethr:<chainId>:<addr>` issuerId. */
export function addrFromDidEthr(issuerId: string): `0x${string}` | null {
  const m = /^did:ethr:\d+:(0x[0-9a-fA-F]{40})$/.exec(issuerId)
  return m ? (m[1].toLowerCase() as `0x${string}`) : null
}
