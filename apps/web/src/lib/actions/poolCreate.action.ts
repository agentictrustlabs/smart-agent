'use server'

/**
 * Pool creation orchestration — Phase 1 (delegation refactor) thin proxy.
 *
 * Single user root delegation now powers BOTH MCP auth and on-chain redemption.
 * The web action just forwards form input to `callMcp('org', 'pool:create', input)`.
 * The org-mcp tool calls a2a-agent's `/session/:id/redeem-tx` for PoolRegistry.open
 * and `/session/:id/deploy-agent` for the pool treasury — no D_onchain side-channel.
 */

import { type Address, type Hex } from 'viem'
import { callMcp } from '@/lib/clients/mcp-client'

export interface CreatePoolInput {
  /** Canonical pool id slug (e.g. 'demo-trauma-care-pool'). */
  id: string
  name: string
  /** Free-text domain slug (e.g. 'faith-network', 'coaching-network'). */
  domain: string
  /** Mandate JSON: { acceptedKinds[], acceptedGeo[], budgetCeiling?, expectedAwards? } */
  mandate: {
    acceptedKinds: string[]
    acceptedGeo: string[]
    budgetCeiling?: number
    expectedAwards?: number
  }
  governanceModel: 'fund' | 'coaching-network' | 'prayer-chain' | 'skills-bench' | 'hospitality-network'
  acceptedRestrictions: { kinds?: string[]; geoRoots?: string[]; notForAdmin?: boolean; notForDiscretionary?: boolean }
  acceptedUnits: string[]
  capacityCeiling?: number | null
  ceilingPolicy: 'block' | 'waitlist' | 'accept'
  visibility: 'public' | 'private'
  /** Optional addressed-members list for private pools. */
  addressedMembers?: string[]
  /** Initial steward addresses. */
  stewards: Address[]
}

export interface CreatePoolResult {
  poolAgentId: string
  treasuryAddress: Address
  txHash: Hex
}

export async function createPool(input: CreatePoolInput): Promise<CreatePoolResult> {
  // The MCP tool re-uses the same field names. `name` is web-only metadata
  // (it lives in GraphDB once the on-chain → KB sync runs); strip it so we
  // don't carry an unknown field across the wire.
  const result = await callMcp<CreatePoolResult>('org', 'pool:create', {
    id: input.id,
    domain: input.domain,
    governanceModel: input.governanceModel,
    mandate: input.mandate,
    acceptedRestrictions: input.acceptedRestrictions,
    acceptedUnits: input.acceptedUnits,
    acceptedKinds: input.mandate.acceptedKinds,
    capacityCeiling: input.capacityCeiling ?? null,
    ceilingPolicy: input.ceilingPolicy,
    visibility: input.visibility,
    stewards: input.stewards,
    addressedMembers: input.addressedMembers,
  })

  // Targeted per-pool sync (replaces full-graph PUT). Splices just this
  // pool's triples into the data graph via SPARQL DELETE+INSERT, so the
  // page we redirect to finds the new pool without the multi-MB rebuild
  // that crashed the GraphDB instance under seed load.
  try {
    const { syncPoolToGraphDB } = await import('@/lib/ontology/graphdb-sync')
    const r = await syncPoolToGraphDB(result.treasuryAddress, input.id)
    if (!r.ok) console.warn('[poolCreate] per-pool sync failed:', r.message)
  } catch (err) {
    console.warn('[poolCreate] per-pool sync threw:', err instanceof Error ? err.message : err)
  }

  return result
}
