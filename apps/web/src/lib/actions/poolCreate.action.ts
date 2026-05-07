'use server'

/**
 * Treasury Phase 2.5 — Pool creation orchestration.
 *
 * End-to-end flow:
 *   1. Deploy the pool's AgentAccount (its treasury) via AgentAccountFactory.
 *   2. Persist the pool body in org-mcp via the `pool:create` MCP tool.
 *   3. Emit `sa:PoolOpenedAssertion` so the public mirror picks it up.
 *
 * Phase 2.5 simplification — the on-chain registry writes
 * (`MandateRegistry.setMandate`, `StewardEligibilityRegistry.setSteward × N`,
 * STEWARDSHIP_DELEGATION mint) are DEFERRED. The pool body in the MCP
 * carries the mandate JSON, which is what discovery queries read today;
 * registry-side enforcement only matters at disbursement time (Phase 3).
 *
 * Caller responsibilities:
 *   - Auth: server action enforces the user's session via the standard
 *     `getCurrentUser()` chain. The MCP call uses the user's delegation
 *     token (their own org's principal) to authorize `pool:create`.
 *   - Salt selection: pass a salt that hasn't been used yet for this owner.
 *     We default to a deterministic hash of the pool id so re-runs are
 *     idempotent at the factory level (existing addr returned).
 */

import { keccak256, toBytes, type Address } from 'viem'
import { deploySmartAccount, getWalletClient } from '@/lib/contracts'
import { callMcp } from '@/lib/clients/mcp-client'
import { emitPoolOpenedAssertion } from '@/lib/onchain/poolOpenedAssertion'

export interface CreatePoolInput {
  /** Canonical pool id slug (e.g. "demo-trauma-care-pool"). */
  id: string
  name: string
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
  /** Initial steward set — agent IRIs (or addresses cast to IRIs). */
  stewards: string[]
}

export interface CreatePoolResult {
  poolAgentId: string
  treasuryAddress: Address
  onChainAssertionId: string | null
}

/**
 * Create a Pool. Idempotent at the factory level (same salt → same addr);
 * the MCP `pool:create` call rejects duplicates so re-running with the
 * same id returns an error from the persistence step.
 */
export async function createPool(input: CreatePoolInput): Promise<CreatePoolResult> {
  // Deterministic salt from pool id so the address is reproducible per pool.
  const salt = BigInt(keccak256(toBytes(`pool:${input.id}`)))
  const owner = getWalletClient().account!.address as Address
  const treasuryAddress = await deploySmartAccount(owner, salt)

  // Persist the body. The MCP throws on duplicate id which is the right
  // behavior — caller can catch and surface "already exists" to the user.
  await callMcp('org', 'pool:create', {
    id: `urn:smart-agent:pool:${input.id}`,
    name: input.name,
    domain: input.domain,
    mandate: input.mandate,
    governanceModel: input.governanceModel,
    acceptedRestrictions: input.acceptedRestrictions,
    acceptedUnits: input.acceptedUnits,
    capacityCeiling: input.capacityCeiling ?? null,
    ceilingPolicy: input.ceilingPolicy,
    visibility: input.visibility,
    treasuryAddress,
    stewards: input.stewards,
    acceptsOpenCalls: true,
    addressedMembers: input.addressedMembers,
  })

  // Public-tier anchor. Private pools anchor a coarse variant via the
  // emit helper's internal bifurcation — see poolOpenedAssertion.ts.
  const onChainAssertionId = await emitPoolOpenedAssertion({
    id: input.id,
    treasuryAddress: treasuryAddress.toLowerCase(),
    governanceModel: input.governanceModel,
    acceptedUnits: input.acceptedUnits,
    acceptedKinds: input.mandate.acceptedKinds,
    acceptedGeo: input.mandate.acceptedGeo,
    ceilingPolicy: input.ceilingPolicy,
    capacityCeiling: input.capacityCeiling ?? null,
    visibility: input.visibility,
    addressedMembers: input.addressedMembers,
    stewards: input.stewards,
    openedAt: new Date().toISOString(),
  })

  // Trigger the debounced kb-sync so the pools index picks up the new
  // pool. We use scheduleKbSync (60s quiet + 30s cooldown) instead of a
  // direct sync because user-triggered writes can pile up — direct syncs
  // would hammer GraphDB and drive Cloudflare 524s. The cost: up to a
  // 60s lag before the new pool appears on /h/<hub>/pools.
  const { scheduleKbSync } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSync()

  return {
    poolAgentId: `urn:smart-agent:pool:${input.id}`,
    treasuryAddress,
    onChainAssertionId,
  }
}
