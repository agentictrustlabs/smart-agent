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

export type RoundListItem = Round & {
  /** Empty array when nothing in the viewer's intent set overlaps the round mandate. */
  matchedIntentIds: string[]
  /** Soft signals; see FR-001 + Research R2. */
  warnings: Array<'budget-below-intent' | 'deadline-imminent'>
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
