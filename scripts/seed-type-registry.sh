#!/usr/bin/env bash
set -euo pipefail

# Seeds the RelationshipTypeRegistry with semantic metadata for all relationship types.
# Must run after deploy (needs RELATIONSHIP_TYPE_REGISTRY_ADDRESS in .env).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source <(grep -E "^[A-Z_]+=" "$ROOT_DIR/apps/web/.env" | grep -v "^#")

RPC="${RPC_URL:-http://127.0.0.1:8545}"
KEY="${DEPLOYER_PRIVATE_KEY}"
REGISTRY="$RELATIONSHIP_TYPE_REGISTRY_ADDRESS"

echo "=== Seeding Relationship Type Registry ==="

register_type() {
  local type_hash=$1
  local label=$2
  local hierarchical=$3
  local transitive=$4
  local symmetric=$5
  echo "  Registering: $label (hierarchical=$hierarchical, transitive=$transitive, symmetric=$symmetric)"
  cast send "$REGISTRY" "registerType(bytes32,string,bool,bool,bool)" \
    "$type_hash" "$label" "$hierarchical" "$transitive" "$symmetric" \
    --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1 || echo "    (already registered)"
}

# Compute type hashes
OG=$(cast keccak "atl:OrganizationGovernanceRelationship")
OM=$(cast keccak "atl:OrganizationMembershipRelationship")
AL=$(cast keccak "atl:AllianceRelationship")
VT=$(cast keccak "atl:ValidationTrustRelationship")
IC=$(cast keccak "atl:InsuranceCoverageRelationship")
CO=$(cast keccak "atl:ComplianceRelationship")
ES=$(cast keccak "atl:EconomicSecurityRelationship")
SA=$(cast keccak "atl:ServiceAgreementRelationship")
DA=$(cast keccak "atl:DelegationAuthorityRelationship")
RA=$(cast keccak "atl:RuntimeAttestationRelationship")
BP=$(cast keccak "atl:BuildProvenanceRelationship")
OC=$(cast keccak "atl:OrganizationalControlRelationship")
AV=$(cast keccak "atl:ActivityValidationRelationship")
RR=$(cast keccak "atl:ReviewRelationship")
HM=$(cast keccak "atl:HasMemberRelationship")
GL=$(cast keccak "atl:GenerationalLineageRelationship")
NC=$(cast keccak "atl:NamespaceContainsRelationship")

# Register all types with semantic properties
# Args: hash, label, isHierarchical, isTransitive, isSymmetric

register_type "$OG" "Organization Governance" true  false false
register_type "$OM" "Organization Membership" true  false false
register_type "$AL" "Alliance"                false false true
register_type "$VT" "Validation Trust"        false false false
register_type "$IC" "Insurance Coverage"      false false false
register_type "$CO" "Compliance"              false false false
register_type "$ES" "Economic Security"       false false false
register_type "$SA" "Service Agreement"       false false false
register_type "$DA" "Delegation Authority"    true  true  false
register_type "$RA" "Runtime Attestation"     false false false
register_type "$BP" "Build Provenance"        false false false
register_type "$OC" "Organizational Control"  true  true  false
register_type "$AV" "Activity Validation"     false false false
register_type "$RR" "Review Relationship"     false false false
register_type "$HM" "Hub Membership"          true  true  false
register_type "$GL" "Generational Lineage"   true  true  false
register_type "$NC" "Namespace Contains"    true  true  false

echo "=== Type Registry seeded: 17 relationship types ==="
