/**
 * Discovery Service
 *
 * High-level data access class for the SmartAgents knowledge base.
 * All SPARQL queries go through this service — consumers never write
 * raw SPARQL. Returns typed results.
 */

import { GraphDBClient } from './graphdb-client'
import type {
  GraphDBConfig,
  KBAgent,
  KBAgentDetail,
  KBRelationshipEdge,
  AgentQueryOptions,
  SparqlResults,
  Round,
  RoundListItem,
  RoundListFilters,
  RoundMandate,
  RoundMilestoneTemplate,
  RoundValidatorRequirements,
  RoundPriorStats,
  ReportingCadence,
  KBCandidateIntent,
  KBMatchInitiationMirror,
  Pool,
  PoolListItem,
  PoolListFilters,
  PoolAllocationSummary,
  AcceptedRestrictions,
  CeilingPolicy,
} from './types'
import {
  listAgentsQuery,
  agentDetailQuery,
  outgoingEdgesQuery,
  incomingEdgesQuery,
  countAgentsByTypeQuery,
  countEdgesQuery,
  hopDistanceQuery,
  hopsFromAgentQuery,
} from './sparql'
import { listRoundsQuery, roundDetailQuery } from './queries/rounds'
import { listCandidatesForIntentQuery } from './queries/candidates'
import { listActiveInitiationsForIntentQuery } from './queries/matchInitiations'
import { listPoolsQuery, poolDetailQuery } from './queries/pools'
import { listRecentAllocationsQuery } from './queries/poolAllocations'

// ---------------------------------------------------------------------------
// Result Parsing Helpers
// ---------------------------------------------------------------------------

function str(binding: Record<string, { value: string }>, key: string): string {
  return binding[key]?.value ?? ''
}

function bool(binding: Record<string, { value: string }>, key: string): boolean {
  const v = binding[key]?.value
  return v === 'true' || v === '1'
}

function num(binding: Record<string, { value: string }>, key: string): number {
  return parseInt(binding[key]?.value ?? '0', 10) || 0
}

function splitPipe(binding: Record<string, { value: string }>, key: string): string[] {
  const v = binding[key]?.value
  if (!v) return []
  return v.split('||').filter(Boolean)
}

function stripClassSuffix(s: string): string {
  return s.replace(/Class$/, '').toLowerCase()
}

function parseAgentRow(row: Record<string, { value: string }>): KBAgent {
  return {
    iri: str(row, 'agent'),
    address: str(row, 'address'),
    displayName: str(row, 'name'),
    primaryName: str(row, 'primaryName'),
    nameLabel: str(row, 'nameLabel'),
    description: str(row, 'description'),
    agentType: (str(row, 'agentType') || 'unknown') as KBAgent['agentType'],
    aiAgentClass: stripClassSuffix(str(row, 'aiClass')),
    isActive: bool(row, 'isActive'),
    capabilities: splitPipe(row, 'allCaps').length > 0
      ? splitPipe(row, 'allCaps')
      : splitPipe(row, 'capabilities'),
    trustModels: splitPipe(row, 'allTrust').length > 0
      ? splitPipe(row, 'allTrust')
      : splitPipe(row, 'trustModels'),
    controllers: splitPipe(row, 'allControllers').length > 0
      ? splitPipe(row, 'allControllers')
      : splitPipe(row, 'controllers'),
    a2aEndpoint: str(row, 'a2aEndpoint'),
    mcpServer: str(row, 'mcpServer'),
    templateId: str(row, 'templateId'),
    metadataURI: str(row, 'metadataURI'),
    latitude: str(row, 'latitude'),
    longitude: str(row, 'longitude'),
    outRelationshipCount: num(row, 'outRels'),
    inRelationshipCount: num(row, 'inRels'),
  }
}

function parseJsonField<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function parseRoundRow(row: Record<string, { value: string }>): Round {
  const mandateRaw = row.mandate?.value
  const milestoneRaw = row.milestoneTemplate?.value
  const validatorRaw = row.validatorRequirements?.value
  const requiredCredsRaw = row.requiredCredentials?.value
  const addressedRaw = row.addressedApplicants?.value

  const mandate: RoundMandate = parseJsonField<RoundMandate>(mandateRaw, {
    acceptedKinds: [], acceptedGeo: [], budgetCeiling: 0, expectedAwards: 0,
  })
  const milestoneTemplate: RoundMilestoneTemplate = parseJsonField<RoundMilestoneTemplate>(
    milestoneRaw, {},
  )
  const validatorRequirements: RoundValidatorRequirements = parseJsonField<RoundValidatorRequirements>(
    validatorRaw, {},
  )
  const requiredCredentials: string[] = parseJsonField<string[]>(requiredCredsRaw, [])
  const addressedApplicants: string[] | undefined = addressedRaw
    ? parseJsonField<string[]>(addressedRaw, [])
    : undefined

  const reportingRaw = row.reportingCadence?.value as ReportingCadence | undefined
  const reportingCadence: ReportingCadence = reportingRaw && (
    reportingRaw === 'quarterly' || reportingRaw === 'milestone' ||
    reportingRaw === 'annual' || reportingRaw === 'none'
  ) ? reportingRaw : 'none'

  const visibilityRaw = row.visibility?.value
  const visibility: 'public' | 'private' = visibilityRaw === 'private' ? 'private' : 'public'

  const proposalsReceived = parseInt(row.proposalsReceived?.value ?? '0', 10) || 0
  // priorStats is empty in v1 (T023): the downstream award spec populates it.
  const priorStats: RoundPriorStats = {
    proposalsReceived,
    awarded: 0,
    isFirstCycle: true,
  }

  return {
    id: row.roundId?.value ?? row.round?.value ?? '',
    displayName: row.roundName?.value || undefined,
    fundName: row.fundName?.value || undefined,
    fundAgentId: row.fundAgentId?.value ?? '',
    mandate,
    milestoneTemplate,
    validatorRequirements,
    reportingCadence,
    deadline: row.deadline?.value ?? '',
    decisionDate: row.decisionDate?.value ?? '',
    requiredCredentials,
    visibility,
    addressedApplicants,
    proposalsReceived,
    priorStats,
  }
}

function parsePoolRow(row: Record<string, { value: string }>): Pool {
  const id = row.poolId?.value ?? row.pool?.value ?? ''
  const name = row.name?.value ?? ''
  const domain = row.domain?.value ?? ''
  const mandateRaw = row.mandate?.value ?? ''
  const governanceModel = (row.governanceModel?.value ?? 'fund') as Pool['governanceModel']

  // acceptedRestrictions stored as JSON literal in turtle; tolerate either
  // a JSON literal or a plain comma-separated value.
  const acceptedRestrictions: AcceptedRestrictions = parseJsonField<AcceptedRestrictions>(
    row.acceptedRestrictions?.value, {},
  )
  // acceptedUnits — emitted as multi-value; SPARQL may collapse to one
  // binding per row, so we accept either a JSON-array string or a single
  // value. Callers that need the full list rely on the parsed JSON form.
  const acceptedUnitsRaw = row.acceptedUnits?.value ?? ''
  let acceptedUnits: string[] = []
  if (acceptedUnitsRaw.startsWith('[')) {
    acceptedUnits = parseJsonField<string[]>(acceptedUnitsRaw, [])
  } else if (acceptedUnitsRaw) {
    acceptedUnits = [acceptedUnitsRaw]
  }

  const capacityCeilingRaw = row.capacityCeiling?.value
  const capacityCeiling = capacityCeilingRaw ? Number(capacityCeilingRaw) : undefined
  const ceilingPolicy = ((['block', 'waitlist', 'accept'] as const).find(
    p => p === row.ceilingPolicy?.value,
  ) ?? 'accept') as CeilingPolicy

  const addressedTo = row.addressedTo?.value ?? ''
  const addressedMembersRaw = row.addressedMembers?.value
  const addressedMembers = addressedMembersRaw
    ? parseJsonField<string[]>(addressedMembersRaw, [])
    : undefined

  const visibility: 'public' | 'private' = row.visibility?.value === 'private' ? 'private' : 'public'
  const stewardshipAgent = row.stewardshipAgent?.value ?? ''
  const stewardsRaw = row.stewards?.value ?? ''
  let stewards: string[] = []
  if (stewardsRaw.startsWith('[')) {
    stewards = parseJsonField<string[]>(stewardsRaw, [])
  } else if (stewardsRaw) {
    stewards = [stewardsRaw]
  }
  const acceptsOpenCalls = row.acceptsOpenCalls?.value === 'true' || row.acceptsOpenCalls?.value === '1'

  const pledgedTotal = parseInt(row.pledgedTotal?.value ?? '0', 10) || 0
  const allocatedTotal = parseInt(row.allocatedTotal?.value ?? '0', 10) || 0
  const availableTotal = parseInt(row.availableTotal?.value ?? '0', 10) || Math.max(0, pledgedTotal - allocatedTotal)

  return {
    id,
    name,
    domain,
    mandate: mandateRaw,
    governanceModel,
    acceptedRestrictions,
    acceptedUnits,
    capacityCeiling,
    ceilingPolicy,
    addressedTo,
    addressedMembers,
    visibility,
    stewardshipAgent,
    stewards,
    acceptsOpenCalls,
    pledgedTotal,
    allocatedTotal,
    availableTotal,
  }
}

function parseEdgeRow(row: Record<string, { value: string }>, direction: 'out' | 'in'): KBRelationshipEdge {
  return {
    edgeId: str(row, 'edgeId'),
    subjectAddress: direction === 'out' ? '' : str(row, 'sourceAddress'),
    subjectName: direction === 'out' ? '' : str(row, 'sourceName'),
    objectAddress: direction === 'out' ? str(row, 'targetAddress') : '',
    objectName: direction === 'out' ? str(row, 'targetName') : '',
    relationshipType: str(row, 'relType'),
    roles: splitPipe(row, 'roles'),
    status: str(row, 'status').replace('Status', ''),
  }
}

// ---------------------------------------------------------------------------
// Discovery Service
// ---------------------------------------------------------------------------

export class DiscoveryService {
  private client: GraphDBClient

  constructor(config: GraphDBConfig) {
    this.client = new GraphDBClient(config)
  }

  /** Create from environment variables */
  static fromEnv(): DiscoveryService {
    return new DiscoveryService({
      baseUrl: process.env.GRAPHDB_BASE_URL ?? 'https://graphdb.agentkg.io',
      repository: process.env.GRAPHDB_REPOSITORY ?? 'SmartAgents',
      username: process.env.GRAPHDB_USERNAME ?? '',
      password: process.env.GRAPHDB_PASSWORD ?? '',
    })
  }

  /** Get the underlying GraphDB client for raw queries */
  getClient(): GraphDBClient {
    return this.client
  }

  /** Check if the knowledge base is reachable */
  async ping(): Promise<boolean> {
    return this.client.ping()
  }

  // ─── Agent Queries ────────────────────────────────────────────────

  /**
   * List all agents from the knowledge base.
   * Supports filtering, search, sorting, and pagination.
   */
  async listAgents(opts: AgentQueryOptions = {}): Promise<KBAgent[]> {
    const sparql = listAgentsQuery(opts)
    const results = await this.client.query(sparql)
    return results.results.bindings.map(row =>
      parseAgentRow(row as unknown as Record<string, { value: string }>),
    )
  }

  /**
   * Get a single agent by Ethereum address with full metadata.
   */
  async getAgent(address: string): Promise<KBAgent | null> {
    const sparql = agentDetailQuery(address)
    const results = await this.client.query(sparql)
    const row = results.results.bindings[0]
    if (!row) return null
    return parseAgentRow(row as unknown as Record<string, { value: string }>)
  }

  /**
   * Get a single agent with all relationships loaded.
   */
  async getAgentDetail(address: string): Promise<KBAgentDetail | null> {
    const agent = await this.getAgent(address)
    if (!agent) return null

    const [outEdges, inEdges] = await Promise.all([
      this.getOutgoingEdges(address),
      this.getIncomingEdges(address),
    ])

    return { ...agent, outEdges, inEdges }
  }

  /**
   * Count agents grouped by type.
   */
  async countAgentsByType(): Promise<Record<string, number>> {
    const results = await this.client.query(countAgentsByTypeQuery())
    const counts: Record<string, number> = {}
    for (const row of results.results.bindings) {
      const r = row as unknown as Record<string, { value: string }>
      const type = str(r, 'agentType') || 'unknown'
      counts[type] = num(r, 'count')
    }
    return counts
  }

  // ─── Relationship Queries ─────────────────────────────────────────

  /**
   * Get outgoing relationship edges for an agent.
   */
  async getOutgoingEdges(address: string): Promise<KBRelationshipEdge[]> {
    const results = await this.client.query(outgoingEdgesQuery(address))
    return results.results.bindings.map(row =>
      parseEdgeRow(row as unknown as Record<string, { value: string }>, 'out'),
    )
  }

  /**
   * Get incoming relationship edges for an agent.
   */
  async getIncomingEdges(address: string): Promise<KBRelationshipEdge[]> {
    const results = await this.client.query(incomingEdgesQuery(address))
    return results.results.bindings.map(row =>
      parseEdgeRow(row as unknown as Record<string, { value: string }>, 'in'),
    )
  }

  /**
   * Count total edges in the knowledge base.
   */
  async countEdges(): Promise<number> {
    const results = await this.client.query(countEdgesQuery())
    const row = results.results.bindings[0]
    if (!row) return 0
    return num(row as unknown as Record<string, { value: string }>, 'count')
  }

  // ─── Hop-Distance Queries ─────────────────────────────────────────
  //
  // Trust-proximity component for the intent-marketplace ranking formula
  // (specs 001/002/003): proximityScore = 1 / (1 + hops).
  // Treats edges as undirected; depth cap = 6 (per spec 001 research R2).

  /**
   * Minimum hop distance between two agents in the AgentRelationship graph.
   * Returns null if the agents are unreachable within the depth cap (6).
   */
  async getHopDistance(addressA: string, addressB: string): Promise<number | null> {
    if (addressA.toLowerCase() === addressB.toLowerCase()) return 0
    const results = await this.client.query(hopDistanceQuery(addressA, addressB))
    const row = results.results.bindings[0]
    if (!row) return null
    const value = (row as unknown as Record<string, { value: string }>).minDistance?.value
    if (!value) return null
    const n = parseInt(value, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  /**
   * For a given source agent, return all agents reachable within `maxHops`,
   * each with the minimum hop distance. Sorted by distance ascending.
   * Useful for batch-ranking candidates.
   */
  async getHopsFromAgent(
    sourceAddress: string,
    maxHops = 6,
  ): Promise<Array<{ address: string; name?: string; hops: number }>> {
    const results = await this.client.query(hopsFromAgentQuery(sourceAddress, maxHops))
    return results.results.bindings.map((b) => {
      const row = b as unknown as Record<string, { value: string }>
      return {
        address: row.targetAddress?.value ?? '',
        name: row.targetName?.value || undefined,
        hops: parseInt(row.minDistance?.value ?? '0', 10) || 0,
      }
    })
  }

  // ─── Spec 003: Rounds (Intent Marketplace — Proposal Lane) ────────
  //
  // Reads the public mirror of `sa:RoundOpenedAssertion` triples populated
  // by the on-chain → GraphDB sync. Mandate-match badging joins viewer's
  // intents to round mandates per FR-001 / Research R2. Visibility gate:
  // private rounds appear in the mirror as coarse anchors (no
  // addressed-applicants list); the action layer resolves the addressed
  // list via the fund's org-mcp before rendering them to a non-addressed
  // viewer (IA § 2.4 / FR-003).

  /**
   * Build a `RoundListItem[]` for the rounds index page.
   *
   * Pipeline:
   *   1. SPARQL narrows the candidate set on what it can match server-side
   *      (deadline horizon, free-text, domain substring, includeClosed).
   *   2. Result rows are parsed into `Round` shape (JSON literals decoded).
   *   3. Budget range (FR-002) is applied here in TS — the mandate is a
   *      JSON string literal so we can't filter `budgetCeiling` server-side.
   *   4. Visibility gate (FR-003) drops private rounds whose
   *      `addressedApplicants` does not include `viewerAgentId`.
   *
   * The mandate-match `matchedIntentIds` array stays empty here; the
   * action layer computes the overlap because it has the viewer's
   * intent kinds + geo to compare against. See US1 / T032.
   */
  async listRounds(filters: RoundListFilters): Promise<RoundListItem[]> {
    const sparql = listRoundsQuery(filters, [])
    const results = await this.client.query(sparql)
    const viewer = filters.viewerAgentId.toLowerCase()
    const items: RoundListItem[] = []
    for (const row of results.results.bindings) {
      const r = row as unknown as Record<string, { value: string }>
      const round = parseRoundRow(r)

      // FR-003: private-round visibility gate. The viewer must be in
      // the addressedApplicants list for the round to be visible.
      if (round.visibility === 'private') {
        const list = (round.addressedApplicants ?? []).map(a => a.toLowerCase())
        if (!list.includes(viewer)) continue
      }

      // FR-002: budget range filter applied post-parse.
      if (
        filters.budgetMin !== undefined &&
        round.mandate.budgetCeiling < filters.budgetMin
      ) continue
      if (
        filters.budgetMax !== undefined &&
        round.mandate.budgetCeiling > filters.budgetMax
      ) continue

      items.push({
        ...round,
        matchedIntentIds: [],
        warnings: [],
      })
    }
    return items
  }

  /**
   * Fetch a single round by id. Returns null when the round does not
   * appear in the public mirror (or has been closed and `RoundClosedAssertion`
   * was emitted but the close has not yet been re-mirrored).
   *
   * FR-006: private-round addressee gate. When the round's visibility
   * is `'private'`, the method returns null unless `viewerAgentId`
   * appears in the round's `addressedApplicants` list. The action
   * layer renders a friendly "you are not addressed for this round"
   * 403-style page when this returns null + the roundId clearly
   * exists.
   */
  async getRoundDetail(roundId: string, viewerAgentId: string): Promise<Round | null> {
    const sparql = roundDetailQuery(roundId)
    const results = await this.client.query(sparql)
    const row = results.results.bindings[0]
    if (!row) return null
    const round = parseRoundRow(row as unknown as Record<string, { value: string }>)
    if (round.visibility === 'private') {
      const viewer = viewerAgentId.toLowerCase()
      const list = (round.addressedApplicants ?? []).map(a => a.toLowerCase())
      if (!list.includes(viewer)) return null
    }
    return round
  }

  // ─── Spec 001: Intent Marketplace (Direct Lane) ──────────────────
  //
  // Reads the public mirror of `sa:IntentAssertion` + `sa:MatchInitiationAssertion`
  // triples populated by the on-chain → GraphDB sync. Private-tier intents
  // and initiations live in MCPs only and never appear in these results.

  /**
   * List counter-intent candidates for the viewed intent. Returns intents in
   * the *opposite direction* on the *same kind* (object), excluding
   * self-matches (FR-008) and withdrawn/abandoned/fulfilled candidates
   * (FR-009). The visibility gate (FR-011) lives in the action layer.
   *
   * The result is intentionally narrow — proximity hops + prior outcomes
   * are hydrated by the caller before feeding the candidate to the matchmaker.
   */
  async listCandidatesForIntent(opts: {
    viewedIntentId: string
    viewedDirection: 'receive' | 'give'
    viewedKind: string
    viewedExpresser: string
    limit?: number
  }): Promise<KBCandidateIntent[]> {
    try {
      const sparql = listCandidatesForIntentQuery(opts)
      const results = await this.client.query(sparql)
      const out: KBCandidateIntent[] = []
      for (const row of results.results.bindings) {
        const r = row as unknown as Record<string, { value: string }>
        const id = r.intentId?.value
        const direction = r.direction?.value
        if (!id || (direction !== 'receive' && direction !== 'give')) continue
        out.push({
          id,
          iri: r.candidate?.value ?? `urn:smart-agent:intent:${id}`,
          direction,
          kind: r.kind?.value ?? '',
          expresserAddress: (r.expresserAddress?.value ?? '').toLowerCase(),
          summary: r.summary?.value || undefined,
          geoBucket: r.geoBucket?.value || undefined,
          visibility: (r.visibility?.value as KBCandidateIntent['visibility']) || undefined,
          onChainAssertionId: r.onChainAssertionId?.value || undefined,
        })
      }
      return out
    } catch {
      // Discovery unavailable — degrade gracefully with empty list. The
      // action layer falls back to local web SQLite for v1 demo data.
      return []
    }
  }

  /**
   * List active (status='pending') MatchInitiations referencing the given
   * intent on either side. Used by FR-019 ("view existing match" affordance):
   * if a public-tier pending initiation exists for the pair, the UI shows
   * "view existing match" instead of "propose match".
   *
   * Private-tier initiations are not visible here — they live in the
   * initiator's MCP and are surfaced via `MatchInitiationClient.listForIntent`.
   */
  async listActiveInitiationsForIntent(intentId: string): Promise<KBMatchInitiationMirror[]> {
    try {
      const sparql = listActiveInitiationsForIntentQuery(intentId)
      const results = await this.client.query(sparql)
      const out: KBMatchInitiationMirror[] = []
      for (const row of results.results.bindings) {
        const r = row as unknown as Record<string, { value: string }>
        const iri = r.initiation?.value
        if (!iri) continue
        const id = iri.replace(/^urn:smart-agent:match-initiation:/, '')
        const initiationKind = r.initiationKind?.value === 'connector' ? 'connector' : 'self'
        const status = (r.status?.value as KBMatchInitiationMirror['status']) || 'pending'
        const visibility = (r.visibility?.value === 'public-coarse' ? 'public-coarse' : 'public') as 'public' | 'public-coarse'
        out.push({
          id,
          iri,
          viewedIntentId: r.viewedIntentId?.value ?? '',
          candidateIntentId: r.candidateIntentId?.value ?? '',
          initiatorAgentId: (r.initiatorAgentId?.value ?? '').toLowerCase(),
          initiationKind,
          proposedAt: r.proposedAt?.value ?? '',
          status,
          visibility,
          onChainAssertionId: r.onChainAssertionId?.value || undefined,
        })
      }
      return out
    } catch {
      return []
    }
  }

  // ─── Spec 002: Intent Marketplace (Pool Lane) ────────────────────
  //
  // Reads the public mirror of `sa:Pool` triples (and the synthetic
  // `sa:PoolOpenedAssertion` mirror node when the on-chain anchor exists).
  // Private pools surface in the public mirror as coarse anchors WITHOUT
  // the `addressedMembers` list — the discovery layer drops private pools
  // the viewer isn't addressed to, post-parse.

  /**
   * Build a `PoolListItem[]` for the pools index page.
   *
   * Pipeline:
   *   1. SPARQL narrows on what it can match server-side (domain,
   *      governanceModel, free-text, geo).
   *   2. Result rows parsed into `Pool` shape.
   *   3. Visibility gate (FR-003) drops private pools whose
   *      `addressedMembers` does not include `viewerAgentId`.
   *   4. Capacity warnings (`capacity-near-ceiling` / `capacity-reached`)
   *      computed from pledgedTotal vs capacityCeiling.
   *
   * The discovery layer leaves `basis` undefined; the action layer
   * computes proposer-side rank signals before rendering.
   */
  async listPools(filters: PoolListFilters): Promise<PoolListItem[]> {
    const sparql = listPoolsQuery(filters)
    let results: SparqlResults
    try {
      results = await this.client.query(sparql)
    } catch {
      return []
    }
    const viewer = filters.viewerAgentId.toLowerCase()
    const items: PoolListItem[] = []
    // SPARQL with multi-valued sa:acceptsUnit / sa:steward can return one
    // row per value — collapse by pool IRI before emitting.
    const byPool = new Map<string, Pool>()
    const unitsByPool = new Map<string, Set<string>>()
    const stewardsByPool = new Map<string, Set<string>>()
    for (const row of results.results.bindings) {
      const r = row as unknown as Record<string, { value: string }>
      const poolIri = r.pool?.value
      if (!poolIri) continue
      if (!byPool.has(poolIri)) byPool.set(poolIri, parsePoolRow(r))
      const unit = r.acceptedUnits?.value
      if (unit && !unit.startsWith('[')) {
        if (!unitsByPool.has(poolIri)) unitsByPool.set(poolIri, new Set())
        unitsByPool.get(poolIri)!.add(unit)
      }
      const steward = r.stewards?.value
      if (steward && !steward.startsWith('[')) {
        if (!stewardsByPool.has(poolIri)) stewardsByPool.set(poolIri, new Set())
        stewardsByPool.get(poolIri)!.add(steward)
      }
    }
    for (const [iri, pool] of byPool) {
      const units = unitsByPool.get(iri)
      if (units && units.size > 0) pool.acceptedUnits = Array.from(units)
      const stewards = stewardsByPool.get(iri)
      if (stewards && stewards.size > 0) pool.stewards = Array.from(stewards)

      // FR-003: private-pool visibility gate.
      if (pool.visibility === 'private') {
        const list = (pool.addressedMembers ?? []).map(a => a.toLowerCase())
        if (!list.includes(viewer)) continue
      }

      // Soft capacity warnings.
      const warnings: PoolListItem['warnings'] = []
      if (pool.capacityCeiling && pool.capacityCeiling > 0) {
        const ratio = pool.pledgedTotal / pool.capacityCeiling
        if (ratio >= 1) warnings.push('capacity-reached')
        else if (ratio >= 0.9) warnings.push('capacity-near-ceiling')
      }

      items.push({ ...pool, warnings })
    }
    return items
  }

  /**
   * Fetch a single pool by id. Returns null when the pool does not appear
   * in the public mirror or when the viewer is not addressed for a private
   * pool.
   */
  async getPoolDetail(poolId: string, viewerAgentId: string): Promise<Pool | null> {
    const sparql = poolDetailQuery(poolId)
    let results: SparqlResults
    try {
      results = await this.client.query(sparql)
    } catch {
      return null
    }
    const rows = results.results.bindings
    if (rows.length === 0) return null
    // Multi-valued unit/steward — collapse to set across all rows.
    const first = rows[0] as unknown as Record<string, { value: string }>
    const pool = parsePoolRow(first)
    const units = new Set<string>()
    const stewards = new Set<string>()
    for (const row of rows) {
      const r = row as unknown as Record<string, { value: string }>
      const u = r.acceptedUnits?.value
      if (u && !u.startsWith('[')) units.add(u)
      const s = r.stewards?.value
      if (s && !s.startsWith('[')) stewards.add(s)
    }
    if (units.size > 0) pool.acceptedUnits = Array.from(units)
    if (stewards.size > 0) pool.stewards = Array.from(stewards)
    if (pool.visibility === 'private') {
      const viewer = viewerAgentId.toLowerCase()
      const list = (pool.addressedMembers ?? []).map(a => a.toLowerCase())
      if (!list.includes(viewer)) return null
    }
    return pool
  }

  /**
   * List recent allocations for a pool. v1 returns empty since the
   * downstream allocation/disbursement spec hasn't shipped — same pattern
   * as `priorStats.ts`. Once those triples exist, this method applies
   * `storyPermissions`-aware aggregation per FR-006.
   */
  async listRecentAllocations(
    poolId: string,
    viewerAgentId: string,
    limit = 5,
  ): Promise<PoolAllocationSummary[]> {
    void viewerAgentId
    try {
      const sparql = listRecentAllocationsQuery(poolId, limit)
      const results = await this.client.query(sparql)
      const out: PoolAllocationSummary[] = []
      const aggregated = new Map<string, number>() // unit → count for shareWithSupportTeam aggregation
      for (const row of results.results.bindings) {
        const r = row as unknown as Record<string, { value: string }>
        const amount = Number(r.amount?.value ?? '0') || 0
        const unit = r.unit?.value ?? ''
        const awardedAt = r.awardedAt?.value ?? ''
        const story = r.storyPermissions?.value
        const outcomeRaw = r.outcomeStatus?.value
        const outcomeStatus = outcomeRaw === 'fulfilled' || outcomeRaw === 'abandoned' || outcomeRaw === 'in-progress'
          ? outcomeRaw : undefined

        if (story === 'anonymous') {
          out.push({ amount, unit, awardedTo: 'anonymized', awardedAt, outcomeStatus })
        } else if (story === 'shareWithSupportTeam') {
          aggregated.set(unit, (aggregated.get(unit) ?? 0) + 1)
        } else {
          out.push({
            amount,
            unit,
            awardedTo: r.awardedTo?.value ?? 'anonymized',
            awardedAt,
            outcomeStatus,
          })
        }
      }
      for (const [unit, count] of aggregated) {
        out.push({
          amount: 0,
          unit,
          awardedTo: { kind: 'aggregated', count },
          awardedAt: '',
        })
      }
      return out
    } catch {
      return []
    }
  }

  // ─── Raw Query Escape Hatch ───────────────────────────────────────

  /**
   * Execute a raw SPARQL query. Use for ad-hoc or custom queries
   * not covered by the built-in methods.
   */
  async rawQuery(sparql: string): Promise<SparqlResults> {
    return this.client.query(sparql)
  }

  /**
   * Execute a raw SPARQL UPDATE.
   */
  async rawUpdate(sparql: string): Promise<void> {
    return this.client.update(sparql)
  }
}
