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
  // Spec 003 — Intent Marketplace (Proposal Lane)
  Round,
  RoundListItem,
  RoundListFilters,
  RoundMandate,
  RoundMilestoneTemplate,
  RoundValidatorRequirements,
  ReportingCadence,
  RoundPriorStats,
  // Spec 001 — Intent Marketplace (Direct Lane)
  KBCandidateIntent,
  KBMatchInitiationMirror,
} from './types'

// Spec 003 query builders (rounds / fund mandate / prior stats)
export { listRoundsQuery, roundDetailQuery } from './queries/rounds'
export { fundMandateQuery } from './queries/fundMandate'
export {
  fundPriorOutcomesByDomainQuery,
  proposerPriorOutcomesQuery,
} from './queries/priorStats'

// Spec 001 query builders (candidates / match initiations)
export { listCandidatesForIntentQuery } from './queries/candidates'
export { listActiveInitiationsForIntentQuery } from './queries/matchInitiations'
