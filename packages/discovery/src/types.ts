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
