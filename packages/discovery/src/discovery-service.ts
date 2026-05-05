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
