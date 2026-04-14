// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentPredicates
 * @notice Well-known predicate constants for agent metadata properties.
 *
 * Each predicate is keccak256 of an ontology-aligned CURIE (Compact URI).
 * These are the "column names" of the agent property store in AgentAccountResolver.
 *
 * The full URI mapping lives in the OntologyTermRegistry and off-chain
 * in ontology/context.jsonld. For example:
 *   keccak256("atl:displayName") → https://agentictrust.io/ontology/core#displayName
 */
library AgentPredicates {
    // ─── Core identity ──────────────────────────────────────────────
    bytes32 constant RDF_TYPE = keccak256("rdf:type");
    bytes32 constant ATL_DISPLAY_NAME = keccak256("atl:displayName");
    bytes32 constant ATL_DESCRIPTION = keccak256("atl:description");
    bytes32 constant ATL_IS_ACTIVE = keccak256("atl:isActive");
    bytes32 constant ATL_VERSION = keccak256("atl:version");

    // ─── Agent classification ───────────────────────────────────────
    bytes32 constant ATL_AGENT_TYPE = keccak256("atl:agentType");
    bytes32 constant ATL_AI_AGENT_CLASS = keccak256("atl:aiAgentClass");

    // ─── Agent type values (used as agentType values) ───────────────
    bytes32 constant TYPE_PERSON = keccak256("atl:PersonAgent");
    bytes32 constant TYPE_ORGANIZATION = keccak256("atl:OrganizationAgent");
    bytes32 constant TYPE_AI_AGENT = keccak256("atl:AIAgent");
    bytes32 constant TYPE_HUB = keccak256("atl:HubAgent");

    // ─── AI agent class values ──────────────────────────────────────
    bytes32 constant CLASS_DISCOVERY = keccak256("atl:DiscoveryAgent");
    bytes32 constant CLASS_VALIDATOR = keccak256("atl:ValidatorAgent");
    bytes32 constant CLASS_EXECUTOR = keccak256("atl:ExecutorAgent");
    bytes32 constant CLASS_ASSISTANT = keccak256("atl:AssistantAgent");
    bytes32 constant CLASS_ORACLE = keccak256("atl:OracleAgent");
    bytes32 constant CLASS_CUSTOM = keccak256("atl:CustomAgent");

    // ─── Service endpoints ──────────────────────────────────────────
    bytes32 constant ATL_A2A_ENDPOINT = keccak256("atl:hasA2AEndpoint");
    bytes32 constant ATL_MCP_SERVER = keccak256("atl:hasMCPServer");
    bytes32 constant ATL_SERVICE_ENDPOINT = keccak256("atl:hasServiceEndpoint");

    // ─── Trust & capabilities ───────────────────────────────────────
    bytes32 constant ATL_SUPPORTED_TRUST = keccak256("atl:supportedTrustModel");
    bytes32 constant ATL_CAPABILITY = keccak256("atl:hasCapability");

    // ─── Relationships ──────────────────────────────────────────────
    bytes32 constant ATL_CONTROLLER = keccak256("atl:hasController");
    bytes32 constant ATL_OPERATED_BY = keccak256("atl:operatedBy");

    // ─── Metadata ───────────────────────────────────────────────────
    bytes32 constant ATL_METADATA_URI = keccak256("atl:metadataURI");
    bytes32 constant ATL_METADATA_HASH = keccak256("atl:metadataHash");
    bytes32 constant ATL_SCHEMA_URI = keccak256("atl:schemaURI");

    // ─── Geospatial (GeoSPARQL-aligned, EPSG:4326 default) ────────
    bytes32 constant ATL_LATITUDE = keccak256("atl:latitude");
    bytes32 constant ATL_LONGITUDE = keccak256("atl:longitude");
    bytes32 constant ATL_SPATIAL_CRS = keccak256("atl:spatialCRS");
    bytes32 constant ATL_SPATIAL_TYPE = keccak256("atl:spatialType");

    // ─── Hub configuration ────────────────────────────────────────────
    bytes32 constant ATL_HUB_NAV_CONFIG = keccak256("atl:hubNavConfig");
    bytes32 constant ATL_HUB_NETWORK_LABEL = keccak256("atl:hubNetworkLabel");
    bytes32 constant ATL_HUB_CONTEXT_TERM = keccak256("atl:hubContextTerm");
    bytes32 constant ATL_HUB_OVERVIEW_LABEL = keccak256("atl:hubOverviewLabel");
    bytes32 constant ATL_HUB_AGENT_LABEL = keccak256("atl:hubAgentLabel");
    /// @notice JSON map of relationship type hash → domain-specific label
    /// e.g. {"0xabc...":"Planted By","0xdef...":"Leads"}
    bytes32 constant ATL_HUB_VOCABULARY = keccak256("atl:hubVocabulary");
    /// @notice JSON map of role hash → domain-specific label
    bytes32 constant ATL_HUB_ROLE_VOCABULARY = keccak256("atl:hubRoleVocabulary");
    /// @notice JSON map of agent type hash → domain-specific label
    bytes32 constant ATL_HUB_TYPE_VOCABULARY = keccak256("atl:hubTypeVocabulary");

    // ─── ERC-4337 technical ─────────────────────────────────────────
    bytes32 constant ATL_ENTRY_POINT = keccak256("atl:entryPoint");
    bytes32 constant ATL_IMPLEMENTATION = keccak256("atl:implementation");
    bytes32 constant ATL_DELEGATION_MANAGER = keccak256("atl:delegationManager");
}
