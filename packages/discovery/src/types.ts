/**
 * Discovery SDK Types
 *
 * Typed interfaces for all data returned from the GraphDB knowledge base.
 */

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export interface KBAgent {
  iri: string
  address: string
  displayName: string
  /** .agent primary name (e.g., "david.fortcollins.catalyst.agent") */
  primaryName: string
  /** Name label at this level (e.g., "david") */
  nameLabel: string
  description: string
  agentType: 'person' | 'org' | 'ai' | 'hub' | 'unknown'
  aiAgentClass: string
  isActive: boolean
  capabilities: string[]
  trustModels: string[]
  controllers: string[]
  a2aEndpoint: string
  mcpServer: string
  templateId: string
  metadataURI: string
  latitude: string
  longitude: string
  outRelationshipCount: number
  inRelationshipCount: number
}

// ---------------------------------------------------------------------------
// Relationship Edge
// ---------------------------------------------------------------------------

export interface KBRelationshipEdge {
  edgeId: string
  subjectAddress: string
  subjectName: string
  objectAddress: string
  objectName: string
  relationshipType: string
  roles: string[]
  status: string
}

// ---------------------------------------------------------------------------
// Agent Detail (agent + edges)
// ---------------------------------------------------------------------------

export interface KBAgentDetail extends KBAgent {
  outEdges: KBRelationshipEdge[]
  inEdges: KBRelationshipEdge[]
}

// ---------------------------------------------------------------------------
// Query Options
// ---------------------------------------------------------------------------

export interface AgentQueryOptions {
  /** Filter by agent type */
  agentType?: 'person' | 'org' | 'ai' | 'hub'
  /** Full-text search on name/description/address */
  search?: string
  /** Filter by capability */
  capability?: string
  /** Filter by template ID */
  templateId?: string
  /** Sort field */
  sortBy?: 'name' | 'type' | 'relationships'
  /** Sort direction */
  sortDir?: 'asc' | 'desc'
  /** Pagination limit */
  limit?: number
  /** Pagination offset */
  offset?: number
}

// ---------------------------------------------------------------------------
// GraphDB Config
// ---------------------------------------------------------------------------

export interface GraphDBConfig {
  baseUrl: string
  repository: string
  username: string
  password: string
}

// ---------------------------------------------------------------------------
// Spec 003 — Intent Marketplace (Proposal Lane). Round types.
// Mirrors specs/003-intent-marketplace-proposal/contracts/round.ts; copied
// here because spec contracts are not a published package (T020).
//
// Discovery surfaces RoundListItem (mandate-match badging) for the public
// mirror reads — proposers consume RoundClient.list. We do NOT add any
// `GrantProposal` types here: proposals live in proposer MCPs and never
// reach GraphDB (IA P5 / IA § 2.3 / SHACL sa:GrantProposalAlwaysPrivateShape).
// ---------------------------------------------------------------------------

export interface RoundMandate {
  acceptedKinds: string[]
  acceptedGeo: string[]
  budgetCeiling: number
  expectedAwards: number
}

export interface RoundMilestoneTemplate {
  minMilestones?: number
  maxMilestones?: number
  trancheHints?: { atKickoff?: number; midpoint?: number; completion?: number }
}

export interface RoundValidatorRequirements {
  minValidators?: number
  acceptedValidatorKinds?: string[]
}

/** C-Box `sa:ReportingCadence` values. */
export type ReportingCadence = 'quarterly' | 'milestone' | 'annual' | 'none'

export interface RoundPriorStats {
  proposalsReceived: number
  awarded: number
  medianAward?: number
  isFirstCycle: boolean
}

export interface Round {
  id: string
  /** Human-readable display name (sa:displayName). Optional — only set
   *  by rounds that emit it via the seed or future round:open MCP tool. */
  displayName?: string
  /** Display name of the fund operating the round, when resolvable. */
  fundName?: string
  /** → sa:operatedByFund (range sa:Fund — Pool with governanceModel='fund'). */
  fundAgentId: string
  mandate: RoundMandate
  milestoneTemplate: RoundMilestoneTemplate
  validatorRequirements: RoundValidatorRequirements
  reportingCadence: ReportingCadence
  /** ISO-8601. */
  deadline: string
  /** ISO-8601. */
  decisionDate: string
  requiredCredentials: string[]
  visibility: 'public' | 'private'
  /** Private rounds only; never appears in the public anchor / mirror. */
  addressedApplicants?: string[]
  proposalsReceived: number
  priorStats: RoundPriorStats
}

export interface RoundListFilters {
  hubId: string
  domain?: string
  deadlineHorizon?: 'this-week' | 'this-month' | 'this-quarter' | 'all'
  budgetMin?: number
  budgetMax?: number
  search?: string
  includeClosed?: boolean
  viewerAgentId: string
  /** For mandate-match badging — joined to round.mandate.acceptedKinds/Geo. */
  viewerIntentIds?: string[]
}

// ---------------------------------------------------------------------------
// Spec 002 — Intent Marketplace (Pool Lane). Pool types.
// Mirrors specs/002-intent-marketplace-pool/contracts/pool.ts; copied here
// because spec contracts are not a published package (same convention as
// the spec 003 Round mirror above).
//
// Discovery surfaces PoolListItem (capacity warnings) for the public mirror
// reads — donors consume PoolClient.list. PoolPledge bodies live in donor
// MCPs and never reach GraphDB unless public + non-anonymous (anchored as
// sa:PledgeAssertion).
// ---------------------------------------------------------------------------

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
  addressedMembers?: string[]
  visibility: 'public' | 'private'
  stewardshipAgent: string
  /** Hex address of the on-chain treasury agent (parsed from sa:treasuryAgent IRI). */
  treasuryAddress: string
  stewards: string[]
  acceptsOpenCalls: boolean
  pledgedTotal: number
  allocatedTotal: number
  availableTotal: number
}

export interface PoolListFilters {
  hubId: string
  domain?: PoolDomain
  governanceModel?: PoolGovernanceModel
  geo?: string
  search?: string
  viewerAgentId: string
}

export type PoolListItem = Pool & {
  basis?: unknown
  warnings: Array<'capacity-near-ceiling' | 'capacity-reached'>
}

export interface PoolAllocationSummary {
  amount: number
  unit: string
  awardedTo: string | 'anonymized' | { kind: 'aggregated'; count: number }
  awardedAt: string
  outcomeStatus?: 'fulfilled' | 'abandoned' | 'in-progress'
}

export type RoundListItem = Round & {
  /** Empty array when nothing in the viewer's intent set overlaps the round mandate. */
  matchedIntentIds: string[]
  /** Soft signals; see FR-001 + Research R2. */
  warnings: Array<'budget-below-intent' | 'deadline-imminent'>
  /**
   * US4 (T049) — proposer-side basis snapshot driving the rank cue. Optional
   * because round listings can be assembled without rank data (e.g., when the
   * action layer skips ranking on cold-start).
   *
   * The shape matches `RankBasis` from `@smart-agent/sdk/matchmaker`; we use
   * `unknown` here to keep `@smart-agent/discovery` free of a runtime
   * dependency on the sdk. Consumers cast to `RankBasis` at use sites.
   */
  basis?: unknown
  /** True when outcomes were filtered by the proposer's intent domains. */
  domainMatch?: boolean
}

// ---------------------------------------------------------------------------
// Spec 001 — Intent Marketplace (Direct Lane). Candidate / MatchInitiation
// mirror types. Discovery surfaces these for the candidates section on
// intent-detail and the FR-019 "view existing match" affordance.
// ---------------------------------------------------------------------------

/**
 * A candidate counter-intent surfaced from the public mirror. The shape is
 * intentionally narrow — the action layer hydrates additional context (hop
 * distance, prior outcomes) before feeding the candidate to the matchmaker.
 */
export interface KBCandidateIntent {
  id: string
  /** IRI form, when known. */
  iri: string
  direction: 'receive' | 'give'
  kind: string
  expresserAddress: string
  summary?: string
  geoBucket?: string
  visibility?: 'public' | 'public-coarse' | 'private' | 'off-chain'
  onChainAssertionId?: string
}

/**
 * A `pending` MatchInitiation surfaced from the public mirror (private-tier
 * initiations never reach GraphDB).
 */
export interface KBMatchInitiationMirror {
  id: string
  iri: string
  viewedIntentId: string
  candidateIntentId: string
  initiatorAgentId: string
  initiationKind: 'self' | 'connector'
  proposedAt: string
  status: 'pending' | 'superseded' | 'consumed'
  visibility: 'public' | 'public-coarse'
  onChainAssertionId?: string
}

// ---------------------------------------------------------------------------
// SPARQL Result Types
// ---------------------------------------------------------------------------

export interface SparqlBinding {
  type: 'uri' | 'literal' | 'bnode'
  value: string
  datatype?: string
  'xml:lang'?: string
}

export interface SparqlResults {
  head: { vars: string[] }
  results: {
    bindings: Array<Record<string, SparqlBinding>>
  }
}
