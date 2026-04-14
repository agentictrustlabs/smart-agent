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
export const TYPE_HUB = keccak256(toBytes('atl:HubAgent'))

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

// ─── Geospatial (GeoSPARQL-aligned, EPSG:4326 default) ─────────────
export const ATL_LATITUDE = keccak256(toBytes('atl:latitude'))
export const ATL_LONGITUDE = keccak256(toBytes('atl:longitude'))
export const ATL_SPATIAL_CRS = keccak256(toBytes('atl:spatialCRS'))
export const ATL_SPATIAL_TYPE = keccak256(toBytes('atl:spatialType'))

// ─── Hub configuration ──────────────────────────────────────────────
export const ATL_HUB_NAV_CONFIG = keccak256(toBytes('atl:hubNavConfig'))
export const ATL_HUB_NETWORK_LABEL = keccak256(toBytes('atl:hubNetworkLabel'))
export const ATL_HUB_CONTEXT_TERM = keccak256(toBytes('atl:hubContextTerm'))
export const ATL_HUB_OVERVIEW_LABEL = keccak256(toBytes('atl:hubOverviewLabel'))
export const ATL_HUB_AGENT_LABEL = keccak256(toBytes('atl:hubAgentLabel'))
/** JSON hub features flags (e.g. {"circles":true,"prayer":true}) */
export const ATL_HUB_FEATURES = keccak256(toBytes('atl:hubFeatures'))
/** JSON hub theme (e.g. {"accent":"#8b5e3c","bg":"#faf8f3"}) */
export const ATL_HUB_THEME = keccak256(toBytes('atl:hubTheme'))
/** JSON hub view modes (e.g. [{"key":"disciple","label":"Disciple"}]) */
export const ATL_HUB_VIEW_MODES = keccak256(toBytes('atl:hubViewModes'))
/** Hub greeting template (e.g. "Good day, {name}") */
export const ATL_HUB_GREETING = keccak256(toBytes('atl:hubGreeting'))
/** JSON map: relationship type hash → domain label */
export const ATL_HUB_VOCABULARY = keccak256(toBytes('atl:hubVocabulary'))
/** JSON map: role hash → domain label */
export const ATL_HUB_ROLE_VOCABULARY = keccak256(toBytes('atl:hubRoleVocabulary'))
/** JSON map: agent type hash → domain label */
export const ATL_HUB_TYPE_VOCABULARY = keccak256(toBytes('atl:hubTypeVocabulary'))

// ─── App data (JSON blobs stored per agent) ────────────────────────
export const ATL_GENMAP_DATA = keccak256(toBytes('atl:genMapData'))
export const ATL_ACTIVITY_LOG = keccak256(toBytes('atl:activityLog'))
export const ATL_TRACKED_MEMBERS = keccak256(toBytes('atl:trackedMembers'))
export const ATL_TEMPLATE_ID = keccak256(toBytes('atl:templateId'))

// ─── ERC-4337 technical ─────────────────────────────────────────────
export const ATL_ENTRY_POINT = keccak256(toBytes('atl:entryPoint'))
export const ATL_IMPLEMENTATION = keccak256(toBytes('atl:implementation'))
export const ATL_DELEGATION_MANAGER = keccak256(toBytes('atl:delegationManager'))

// ─── Human-readable labels ──────────────────────────────────────────

export const AGENT_TYPE_LABELS: Record<string, string> = {
  [TYPE_PERSON]: 'Person Agent',
  [TYPE_ORGANIZATION]: 'Organization',
  [TYPE_AI_AGENT]: 'AI Agent',
  [TYPE_HUB]: 'Hub',
}

export const AI_CLASS_LABELS: Record<string, string> = {
  [CLASS_DISCOVERY]: 'Discovery',
  [CLASS_VALIDATOR]: 'Validator',
  [CLASS_EXECUTOR]: 'Executor',
  [CLASS_ASSISTANT]: 'Assistant',
  [CLASS_ORACLE]: 'Oracle',
  [CLASS_CUSTOM]: 'Custom',
}
