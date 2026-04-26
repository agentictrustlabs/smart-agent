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
// Geographic place tags — coarse text labels stored on agents that the
// geo-overlap.v1 scorer reads as a quick path before any GeoSPARQL /
// GeoFeatureRegistry lookup. Same agent should also have ATL_LATITUDE /
// ATL_LONGITUDE for the precise path.
export const ATL_CITY    = keccak256(toBytes('atl:city'))
export const ATL_REGION  = keccak256(toBytes('atl:region'))    // state/province
export const ATL_COUNTRY = keccak256(toBytes('atl:country'))   // ISO 3166-1 alpha-2
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

// ─── Naming (.agent namespace) ─────────────────────────────────────
/** The agent's primary fully-qualified name (e.g., "david.fortcollins.catalyst.agent") */
export const ATL_PRIMARY_NAME = keccak256(toBytes('atl:primaryName'))
/** The label for this agent at its level in the namespace (e.g., "david") */
export const ATL_NAME_LABEL = keccak256(toBytes('atl:nameLabel'))

// ─── ERC-4337 technical ─────────────────────────────────────────────
export const ATL_ENTRY_POINT = keccak256(toBytes('atl:entryPoint'))
export const ATL_IMPLEMENTATION = keccak256(toBytes('atl:implementation'))
export const ATL_DELEGATION_MANAGER = keccak256(toBytes('atl:delegationManager'))

// ─── Namespace kinds (multi-root NameRegistry) ──────────────────────
// Tags AgentNameRegistry stamps on each TLD root via initializeRoot's
// `kind` parameter. Resource binders (GeoFeatureRegistry for .geo, the
// future PgRegistry for .pg) dispatch on these.
export const KIND_AGENT        = keccak256(toBytes('namespace:Agent'))
export const KIND_GEO          = keccak256(toBytes('namespace:Geo'))
export const KIND_PEOPLE_GROUP = keccak256(toBytes('namespace:PeopleGroup'))

// ─── Geo feature kinds (GeoFeatureRegistry) ─────────────────────────
export const GEO_KIND_PLANET       = keccak256(toBytes('geo:Planet'))
export const GEO_KIND_COUNTRY      = keccak256(toBytes('geo:Country'))
export const GEO_KIND_STATE        = keccak256(toBytes('geo:State'))
export const GEO_KIND_COUNTY       = keccak256(toBytes('geo:County'))
export const GEO_KIND_MUNICIPALITY = keccak256(toBytes('geo:Municipality'))
export const GEO_KIND_NEIGHBORHOOD = keccak256(toBytes('geo:Neighborhood'))
export const GEO_KIND_ZIPCODE      = keccak256(toBytes('geo:ZipCode'))
export const GEO_KIND_CUSTOM       = keccak256(toBytes('geo:Custom'))

// ─── Geo claim relations (GeoClaimRegistry) ─────────────────────────
export const GEO_REL_SERVES_WITHIN          = keccak256(toBytes('geo:servesWithin'))
export const GEO_REL_OPERATES_IN            = keccak256(toBytes('geo:operatesIn'))
export const GEO_REL_LICENSED_IN            = keccak256(toBytes('geo:licensedIn'))
export const GEO_REL_COMPLETED_TASK_IN      = keccak256(toBytes('geo:completedTaskIn'))
export const GEO_REL_VALIDATED_PRESENCE_IN  = keccak256(toBytes('geo:validatedPresenceIn'))
export const GEO_REL_STEWARD_OF             = keccak256(toBytes('geo:stewardOf'))
export const GEO_REL_RESIDENT_OF            = keccak256(toBytes('geo:residentOf'))
export const GEO_REL_ORIGIN_IN              = keccak256(toBytes('geo:originIn'))

/** Geo claim visibility — must match `enum Visibility` in GeoClaimRegistry. */
export const GEO_VISIBILITY = {
  Public: 0,
  PublicCoarse: 1,
  PrivateCommitment: 2,
  PrivateZk: 3,
  OffchainOnly: 4,
} as const
export type GeoVisibility = typeof GEO_VISIBILITY[keyof typeof GEO_VISIBILITY]

/**
 * Pure namehash for a top-level label (parent = bytes32(0)). Mirrors
 * AgentNameRegistry.namehashRoot so off-chain code can compute root
 * nodes deterministically.
 */
export function namehashRoot(label: string): `0x${string}` {
  const labelHash = keccak256(toBytes(label))
  // namehash(label) = keccak256(bytes32(0) ‖ keccak256(label))
  const ZERO = '0x' + '0'.repeat(64)
  return keccak256(`${ZERO}${labelHash.slice(2)}` as `0x${string}`)
}

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
