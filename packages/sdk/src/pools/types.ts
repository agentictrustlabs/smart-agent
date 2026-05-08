/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pool types.
 *
 * Mirrors `specs/002-intent-marketplace-pool/contracts/pool.ts` verbatim.
 * The spec contract is not a published package, so the SDK carries the
 * runtime-importable copy (same convention as spec 003 Round / spec 003
 * GrantProposal types).
 *
 * T-Box mapping (Audit § 2 O3, § 4 F2, § 8.1):
 *   sa:Pool subClassOf sa:OrganizationAgent  — formal typing for pool agents
 *   sa:Fund subClassOf sa:Pool                — fund-shaped pools (governanceModel=fund)
 *   sa:acceptsUnit (multi-valued)             — pool's accepted units (Q1 open enum)
 *   sa:ceilingPolicy                          — block | waitlist | accept
 *   sa:capacityCeiling                        — optional cap
 *   sa:pledgedTotal / sa:availableTotal       — derived aggregates
 */

export type PoolDomain =
  | 'funding'
  | 'coaching'
  | 'prayer'
  | 'skills'
  | 'hospitality'
  | string

export type PoolGovernanceModel =
  | 'DAF'
  | 'giving-circle'
  | 'mission-cooperative'
  | 'mutual-aid'
  | 'faith-promise'
  | 'fund'

export interface AcceptedRestrictions {
  kinds?: string[]
  geoRoots?: string[]
  notForAdmin?: boolean
  notForDiscretionary?: boolean
}

export type CeilingPolicy = 'block' | 'waitlist' | 'accept'

/**
 * Base Pool type. The body lives in the pool's org-mcp tenant
 * (org_principal = id); the public agent-profile fields are mirrored to
 * GraphDB by the on-chain → GraphDB sync.
 */
export interface Pool {
  id: string
  name: string
  domain: PoolDomain
  mandate: string
  governanceModel: PoolGovernanceModel
  acceptedRestrictions: AcceptedRestrictions
  acceptedUnits: string[]
  capacityCeiling?: number
  ceilingPolicy: CeilingPolicy
  addressedTo: string
  /** Private pools only. */
  addressedMembers?: string[]
  visibility: 'public' | 'private'
  stewardshipAgent: string
  /** Hex address of the on-chain treasury agent (parsed from sa:treasuryAgent IRI). */
  treasuryAddress: string
  stewards: string[]
  /** Used by spec 003 — funds with acceptsOpenCalls=true accept open-call
   *  grant proposals (no roundId). */
  acceptsOpenCalls: boolean
  pledgedTotal: number
  allocatedTotal: number
  availableTotal: number
}

/** Fund — Pool with `governanceModel === 'fund'` (SHACL-enforced). */
export type Fund = Pool & { governanceModel: 'fund' }

export interface PoolListFilters {
  hubId: string
  domain?: PoolDomain
  governanceModel?: PoolGovernanceModel
  geo?: string
  search?: string
  /** For visibility gating on private pools. */
  viewerAgentId: string
}

export interface PoolAllocationSummary {
  amount: number
  unit: string
  awardedTo: string | 'anonymized' | { kind: 'aggregated'; count: number }
  /** ISO-8601. */
  awardedAt: string
  outcomeStatus?: 'fulfilled' | 'abandoned' | 'in-progress'
}

/** Optional rank cue + match warnings appended at the action layer. */
export type PoolListItem = Pool & {
  /**
   * RankBasis from `@smart-agent/sdk/matchmaker` — kept as `unknown` here
   * to avoid a runtime dep cycle. Consumers cast to `RankBasis` at use
   * sites, same convention as spec 003's `RoundListItem.basis`.
   */
  basis?: unknown
  warnings: Array<'capacity-near-ceiling' | 'capacity-reached'>
}
