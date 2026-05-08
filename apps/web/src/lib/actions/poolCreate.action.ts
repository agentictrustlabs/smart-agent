'use server'

/**
 * Pool creation orchestration (Phase 0.3 — on-chain attribute store).
 *
 * Flow:
 *   1. Deploy the pool's AgentAccount (its treasury) via AgentAccountFactory.
 *   2. Call PoolRegistry.open(...) — body lives on chain in the shared
 *      registry's own typed-attribute storage. ShapeRegistry validates the write.
 *   3. Initialize the aggregate-counter row in org-mcp (per IA P4 § 8.2 the
 *      high-frequency aggregates stay in MCP as a debounced cache).
 *   4. Trigger debounced kb-sync so the public mirror picks up the new pool.
 *
 * The body — domain, governance, mandate, accepted kinds/units, ceiling
 * policy, stewards, visibility — is NOT written to org-mcp. The only thing
 * the MCP holds is the pledged/allocated/available counters keyed by the
 * pool agent address.
 *
 * The legacy `sa:PoolOpenedAssertion` emit is dropped — the registry's
 * PoolOpened event + on-chain attribute writes are the new public mirror
 * source. GraphDB sync walks the attribute store directly.
 */

import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem'
import { deploySmartAccount, getWalletClient, getPublicClient } from '@/lib/contracts'
import { PoolRegistryClient, normalizeGovernance } from '@smart-agent/sdk'

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
  /** Optional addressed-members list for private pools (kept for the MCP counter row). */
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
  const registryAddr = process.env.POOL_REGISTRY_ADDRESS as Address | undefined
  if (!registryAddr) throw new Error('POOL_REGISTRY_ADDRESS not set')

  // Deterministic salt per pool id so the address is reproducible.
  const salt = BigInt(keccak256(toBytes(`pool:${input.id}`)))
  const owner = getWalletClient().account!.address as Address
  const treasuryAddress = await deploySmartAccount(owner, salt)

  // Hash the canonical mandate JSON so the on-chain entry has an integrity
  // anchor for the (off-chain) full mandate document.
  const mandateJson = JSON.stringify({
    acceptedKinds: input.mandate.acceptedKinds,
    acceptedGeo: input.mandate.acceptedGeo,
    budgetCeiling: input.mandate.budgetCeiling ?? null,
    expectedAwards: input.mandate.expectedAwards ?? null,
    acceptedRestrictions: input.acceptedRestrictions,
  })
  const mandateHash = keccak256(toHex(mandateJson))

  const client = new PoolRegistryClient({
    registryAddress: registryAddr,
    walletClient: getWalletClient(),
    publicClient: getPublicClient(),
  })
  const txHash = await client.open({
    poolAgent: treasuryAddress,
    domain: input.domain,
    governanceModel: normalizeGovernance(input.governanceModel),
    mandateHash,
    mandateURI: '',
    acceptedUnits: input.acceptedUnits,
    acceptedKinds: input.mandate.acceptedKinds,
    ceilingPolicy: input.ceilingPolicy,
    capacityCeiling: input.capacityCeiling != null ? BigInt(input.capacityCeiling) : 0n,
    stewards: input.stewards,
    visibility: input.visibility,
    acceptedRestrictions: JSON.stringify(input.acceptedRestrictions ?? {}),
    slug: input.id,
  })

  // Pool body lives ON CHAIN via PoolRegistry.open above. Counters
  // (pledged/allocated/available) are DERIVED at read time from the
  // pool_pledges table sums — no SQL cache to seed.

  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()

  return {
    poolAgentId: `urn:smart-agent:pool:${input.id}`,
    treasuryAddress,
    txHash,
  }
}
