#!/usr/bin/env bash
set -euo pipefail

# Seeds the OntologyTermRegistry with all predicate terms.
# Must run after deploy (needs ONTOLOGY_REGISTRY_ADDRESS in .env).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source <(grep -E "^[A-Z_]+=" "$ROOT_DIR/apps/web/.env" | grep -v "^#")

RPC="${RPC_URL:-http://127.0.0.1:8545}"
KEY="${DEPLOYER_PRIVATE_KEY}"
ONTOLOGY="${ONTOLOGY_REGISTRY_ADDRESS}"

echo "=== Seeding Ontology Term Registry ==="

register_term() {
  local curie=$1 uri=$2 label=$3 dtype=$4
  local id=$(cast keccak "$curie")
  cast send "$ONTOLOGY" "registerTerm(bytes32,string,string,string,string)" \
    "$id" "$curie" "$uri" "$label" "$dtype" \
    --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1 || echo "  (already registered: $curie)"
}

BASE="https://agentictrust.io/ontology/core#"

# Core identity
register_term "rdf:type" "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" "RDF Type" "string"
register_term "atl:displayName" "${BASE}displayName" "Display Name" "string"
register_term "atl:description" "${BASE}description" "Description" "string"
register_term "atl:isActive" "${BASE}isActive" "Is Active" "bool"
register_term "atl:version" "${BASE}version" "Version" "string"

# Agent classification
register_term "atl:agentType" "${BASE}agentType" "Agent Type" "string"
register_term "atl:aiAgentClass" "${BASE}aiAgentClass" "AI Agent Class" "string"

# Service endpoints
register_term "atl:hasA2AEndpoint" "${BASE}hasA2AEndpoint" "A2A Endpoint" "string"
register_term "atl:hasMCPServer" "${BASE}hasMCPServer" "MCP Server" "string"
register_term "atl:hasServiceEndpoint" "${BASE}hasServiceEndpoint" "Service Endpoint" "string"

# Trust & capabilities
register_term "atl:supportedTrustModel" "${BASE}supportedTrustModel" "Supported Trust Model" "string[]"
register_term "atl:hasCapability" "${BASE}hasCapability" "Capability" "string[]"

# Relationships
register_term "atl:hasController" "${BASE}hasController" "Controller" "address[]"
register_term "atl:operatedBy" "${BASE}operatedBy" "Operated By" "address"

# Metadata
register_term "atl:metadataURI" "${BASE}metadataURI" "Metadata URI" "string"
register_term "atl:metadataHash" "${BASE}metadataHash" "Metadata Hash" "bytes32"
register_term "atl:schemaURI" "${BASE}schemaURI" "Schema URI" "string"

# ERC-4337 technical
register_term "atl:entryPoint" "${BASE}entryPoint" "Entry Point" "string"
register_term "atl:implementation" "${BASE}implementation" "Implementation" "string"
register_term "atl:delegationManager" "${BASE}delegationManager" "Delegation Manager" "string"

# Geospatial (GeoSPARQL-aligned)
register_term "atl:latitude" "${BASE}latitude" "Latitude" "string"
register_term "atl:longitude" "${BASE}longitude" "Longitude" "string"
register_term "atl:spatialCRS" "${BASE}spatialCRS" "Spatial CRS" "string"
register_term "atl:spatialType" "${BASE}spatialType" "Spatial Type" "string"

# App data (JSON blobs per agent)
register_term "atl:genMapData" "${BASE}genMapData" "Gen Map Data" "string"
register_term "atl:activityLog" "${BASE}activityLog" "Activity Log" "string"
register_term "atl:trackedMembers" "${BASE}trackedMembers" "Tracked Members" "string"
register_term "atl:templateId" "${BASE}templateId" "Template ID" "string"

# Hub configuration
register_term "atl:hubNavConfig" "${BASE}hubNavConfig" "Hub Navigation Config" "string"
register_term "atl:hubNetworkLabel" "${BASE}hubNetworkLabel" "Hub Network Label" "string"
register_term "atl:hubContextTerm" "${BASE}hubContextTerm" "Hub Context Term" "string"
register_term "atl:hubOverviewLabel" "${BASE}hubOverviewLabel" "Hub Overview Label" "string"
register_term "atl:hubAgentLabel" "${BASE}hubAgentLabel" "Hub Agent Label" "string"
register_term "atl:hubVocabulary" "${BASE}hubVocabulary" "Hub Vocabulary" "string"
register_term "atl:hubRoleVocabulary" "${BASE}hubRoleVocabulary" "Hub Role Vocabulary" "string"
register_term "atl:hubTypeVocabulary" "${BASE}hubTypeVocabulary" "Hub Type Vocabulary" "string"

TERM_COUNT=$(cast call "$ONTOLOGY" 'termCount()(uint256)' --rpc-url "$RPC")
echo "=== Ontology terms registered: $TERM_COUNT ==="
