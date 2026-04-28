/**
 * @smart-agent/discovery
 *
 * Knowledge base data access SDK for the Smart Agent trust graph.
 * All reads from GraphDB go through DiscoveryService — consumers
 * never write raw SPARQL or HTTP calls.
 *
 * Usage:
 *   import { DiscoveryService } from '@smart-agent/discovery'
 *   const discovery = DiscoveryService.fromEnv()
 *   const agents = await discovery.listAgents({ agentType: 'org' })
 */

export { DiscoveryService } from './discovery-service'
export { GraphDBClient, GraphDBError } from './graphdb-client'
export { PREFIXES, DATA_GRAPH } from './sparql'
export { GeoDiscoveryClient } from './geo-sparql'
export type { GeoFeatureRef } from './geo-sparql'
export { SkillDiscoveryClient } from './skill-sparql'
export type { SkillConceptRef } from './skill-sparql'

export type {
  GraphDBConfig,
  KBAgent,
  KBAgentDetail,
  KBRelationshipEdge,
  AgentQueryOptions,
  SparqlResults,
  SparqlBinding,
} from './types'
