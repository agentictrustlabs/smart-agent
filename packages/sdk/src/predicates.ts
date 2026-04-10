import { keccak256, toBytes } from 'viem'

/**
 * Well-known ontology predicate constants.
 * Each is keccak256 of an ontology-aligned CURIE.
 * Matches AgentPredicates.sol in the contracts package.
 */

// ─── Core identity ──────────────────────────────────────────────────
export const RDF_TYPE = keccak256(toBytes('rdf:type'))
export const ATL_DISPLAY_NAME = keccak256(toBytes('atl:displayName'))
export const ATL_DESCRIPTION = keccak256(toBytes('atl:description'))
export const ATL_IS_ACTIVE = keccak256(toBytes('atl:isActive'))
export const ATL_VERSION = keccak256(toBytes('atl:version'))

// ─── Agent classification ───────────────────────────────────────────
export const ATL_AGENT_TYPE = keccak256(toBytes('atl:agentType'))
export const ATL_AI_AGENT_CLASS = keccak256(toBytes('atl:aiAgentClass'))

// ─── Agent type values ──────────────────────────────────────────────
export const TYPE_PERSON = keccak256(toBytes('atl:PersonAgent'))
export const TYPE_ORGANIZATION = keccak256(toBytes('atl:OrganizationAgent'))
export const TYPE_AI_AGENT = keccak256(toBytes('atl:AIAgent'))

// ─── AI agent class values ──────────────────────────────────────────
export const CLASS_DISCOVERY = keccak256(toBytes('atl:DiscoveryAgent'))
export const CLASS_VALIDATOR = keccak256(toBytes('atl:ValidatorAgent'))
export const CLASS_EXECUTOR = keccak256(toBytes('atl:ExecutorAgent'))
export const CLASS_ASSISTANT = keccak256(toBytes('atl:AssistantAgent'))
export const CLASS_ORACLE = keccak256(toBytes('atl:OracleAgent'))
export const CLASS_CUSTOM = keccak256(toBytes('atl:CustomAgent'))

// ─── Service endpoints ──────────────────────────────────────────────
export const ATL_A2A_ENDPOINT = keccak256(toBytes('atl:hasA2AEndpoint'))
export const ATL_MCP_SERVER = keccak256(toBytes('atl:hasMCPServer'))
export const ATL_SERVICE_ENDPOINT = keccak256(toBytes('atl:hasServiceEndpoint'))

// ─── Trust & capabilities ───────────────────────────────────────────
export const ATL_SUPPORTED_TRUST = keccak256(toBytes('atl:supportedTrustModel'))
export const ATL_CAPABILITY = keccak256(toBytes('atl:hasCapability'))

// ─── Relationships ──────────────────────────────────────────────────
export const ATL_CONTROLLER = keccak256(toBytes('atl:hasController'))
export const ATL_OPERATED_BY = keccak256(toBytes('atl:operatedBy'))

// ─── Metadata ───────────────────────────────────────────────────────
export const ATL_METADATA_URI = keccak256(toBytes('atl:metadataURI'))
export const ATL_METADATA_HASH = keccak256(toBytes('atl:metadataHash'))
export const ATL_SCHEMA_URI = keccak256(toBytes('atl:schemaURI'))

// ─── ERC-4337 technical ─────────────────────────────────────────────
export const ATL_ENTRY_POINT = keccak256(toBytes('atl:entryPoint'))
export const ATL_IMPLEMENTATION = keccak256(toBytes('atl:implementation'))
export const ATL_DELEGATION_MANAGER = keccak256(toBytes('atl:delegationManager'))

// ─── Human-readable labels ──────────────────────────────────────────

export const AGENT_TYPE_LABELS: Record<string, string> = {
  [TYPE_PERSON]: 'Person Agent',
  [TYPE_ORGANIZATION]: 'Organization',
  [TYPE_AI_AGENT]: 'AI Agent',
}

export const AI_CLASS_LABELS: Record<string, string> = {
  [CLASS_DISCOVERY]: 'Discovery',
  [CLASS_VALIDATOR]: 'Validator',
  [CLASS_EXECUTOR]: 'Executor',
  [CLASS_ASSISTANT]: 'Assistant',
  [CLASS_ORACLE]: 'Oracle',
  [CLASS_CUSTOM]: 'Custom',
}
