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
  ORGANIZATION_MEMBERSHIP,
  ORGANIZATION_GOVERNANCE,
  TYPE_ORGANIZATION,
} from '@smart-agent/sdk'
import { config } from '../config.js'

/**
 * Relationship-type hashes that count as "agent is affiliated with this
 * Organization" for org-overlap scoring. Mirrors the same set in the
 * web action's `getPublicOrgsForAgent`. We accept either edge direction
 * so seeds and signups that pick different directions still match.
 */
const ORG_AFFILIATION_HEXES = new Set([
  (HAS_MEMBER as string).toLowerCase(),
  (ORGANIZATION_MEMBERSHIP as string).toLowerCase(),
  (ORGANIZATION_GOVERNANCE as string).toLowerCase(),
])

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
 * Active or confirmed affiliation edges between a person agent and an
 * active Organization. Counts HAS_MEMBER (org → person), ORGANIZATION_
 * MEMBERSHIP (either direction), and ORGANIZATION_GOVERNANCE (person →
 * org, owner-style) — owners are clearly affiliated.
 *
 * Returns lowercase 0x-addresses of the Org counterparties (deduped).
 */
export async function getOnChainOrgsForPrincipal(principal: `0x${string}`): Promise<string[]> {
  const rel = relationshipAddr()
  const res = resolverAddr()
  if (!rel || !res) return []
  const c = client()

  const orgs = new Set<string>()

  async function pushIfOrg(counterparty: `0x${string}`): Promise<void> {
    try {
      const core = await c.readContract({
        address: res!, abi: agentAccountResolverAbi,
        functionName: 'getCore', args: [counterparty],
      }) as { agentType: `0x${string}`; active: boolean }
      if (core.agentType === TYPE_ORGANIZATION && core.active) {
        orgs.add(counterparty.toLowerCase())
      }
    } catch { /* skip */ }
  }

  // Incoming: principal is OBJECT, subject is the candidate counterparty.
  try {
    const incoming = await c.readContract({
      address: rel, abi: agentRelationshipAbi,
      functionName: 'getEdgesByObject', args: [principal],
    }) as `0x${string}`[]
    for (const id of incoming) {
      try {
        const edge = await c.readContract({
          address: rel, abi: agentRelationshipAbi,
          functionName: 'getEdge', args: [id],
        }) as { subject: `0x${string}`; object_: `0x${string}`; relationshipType: `0x${string}`; status: number }
        if (edge.status < 2) continue
        if (!ORG_AFFILIATION_HEXES.has((edge.relationshipType ?? '').toLowerCase())) continue
        await pushIfOrg(edge.subject)
      } catch { /* skip */ }
    }
  } catch { /* */ }

  // Outgoing: principal is SUBJECT, object is the candidate counterparty.
  try {
    const outgoing = await c.readContract({
      address: rel, abi: agentRelationshipAbi,
      functionName: 'getEdgesBySubject', args: [principal],
    }) as `0x${string}`[]
    for (const id of outgoing) {
      try {
        const edge = await c.readContract({
          address: rel, abi: agentRelationshipAbi,
          functionName: 'getEdge', args: [id],
        }) as { subject: `0x${string}`; object_: `0x${string}`; relationshipType: `0x${string}`; status: number }
        if (edge.status < 2) continue
        if (!ORG_AFFILIATION_HEXES.has((edge.relationshipType ?? '').toLowerCase())) continue
        await pushIfOrg(edge.object_)
      } catch { /* skip */ }
    }
  } catch { /* */ }

  return Array.from(orgs)
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
