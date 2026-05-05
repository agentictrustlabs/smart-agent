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
