#!/usr/bin/env bash
set -euo pipefail

# Deploy all contracts to local Anvil and update apps/web/.env with addresses.
#
# Usage:
#   1. Start Anvil in another terminal:  anvil
#   2. Run this script:                  ./scripts/deploy-local.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"
WEB_ENV="$ROOT_DIR/apps/web/.env"

ANVIL_RPC="http://127.0.0.1:8545"
# Anvil default account #0 private key
ANVIL_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

echo "=== Deploying contracts to local Anvil ==="
echo ""

# Run the deploy script
cd "$CONTRACTS_DIR"
OUTPUT=$(PRIVATE_KEY="$ANVIL_KEY" forge script script/Deploy.s.sol \
  --rpc-url "$ANVIL_RPC" \
  --broadcast \
  --slow \
  --skip-simulation \
  -vvv 2>&1)

echo "$OUTPUT" | grep -E "Deployer:|Chain ID:|EntryPoint|Factory|Manager|Enforcer|impl"

# Extract addresses from the output
ENTRYPOINT=$(echo "$OUTPUT" | grep "ENTRYPOINT_ADDRESS=" | sed 's/.*=//')
FACTORY=$(echo "$OUTPUT" | grep "AGENT_FACTORY_ADDRESS=" | sed 's/.*=//')
DELEGATION=$(echo "$OUTPUT" | grep "DELEGATION_MANAGER_ADDRESS=" | sed 's/.*=//')
TIMESTAMP=$(echo "$OUTPUT" | grep "TIMESTAMP_ENFORCER_ADDRESS=" | sed 's/.*=//')
VALUE=$(echo "$OUTPUT" | grep "VALUE_ENFORCER_ADDRESS=" | sed 's/.*=//')
TARGETS=$(echo "$OUTPUT" | grep "ALLOWED_TARGETS_ENFORCER_ADDRESS=" | sed 's/.*=//')
METHODS=$(echo "$OUTPUT" | grep "ALLOWED_METHODS_ENFORCER_ADDRESS=" | sed 's/.*=//')
DATA_SCOPE=$(echo "$OUTPUT" | grep "DATA_SCOPE_ENFORCER_ADDRESS=" | sed 's/.*=//')
RELATIONSHIP=$(echo "$OUTPUT" | grep "AGENT_RELATIONSHIP_ADDRESS=" | sed 's/.*=//')
ASSERTION_ADDR=$(echo "$OUTPUT" | grep "AGENT_ASSERTION_ADDRESS=" | sed 's/.*=//')
RESOLVER=$(echo "$OUTPUT" | grep "AGENT_RESOLVER_ADDRESS=" | sed 's/.*=//')
TEMPLATE=$(echo "$OUTPUT" | grep "AGENT_TEMPLATE_ADDRESS=" | sed 's/.*=//')
ISSUER_ADDR=$(echo "$OUTPUT" | grep "AGENT_ISSUER_ADDRESS=" | sed 's/.*=//')
VALIDATION_ADDR=$(echo "$OUTPUT" | grep "AGENT_VALIDATION_ADDRESS=" | sed 's/.*=//')
REVIEW_ADDR=$(echo "$OUTPUT" | grep "AGENT_REVIEW_ADDRESS=" | sed 's/.*=//')
DISPUTE_ADDR=$(echo "$OUTPUT" | grep "AGENT_DISPUTE_ADDRESS=" | sed 's/.*=//')
TRUST_PROFILE_ADDR=$(echo "$OUTPUT" | grep "AGENT_TRUST_PROFILE_ADDRESS=" | sed 's/.*=//')
CONTROL_ADDR=$(echo "$OUTPUT" | grep "AGENT_CONTROL_ADDRESS=" | sed 's/.*=//')
MOCK_TEE_VERIFIER=$(echo "$OUTPUT" | grep "MOCK_TEE_VERIFIER_ADDRESS=" | sed 's/.*=//')
ONTOLOGY_REGISTRY=$(echo "$OUTPUT" | grep "ONTOLOGY_REGISTRY_ADDRESS=" | sed 's/.*=//')
AGENT_ACCT_RESOLVER=$(echo "$OUTPUT" | grep "AGENT_ACCOUNT_RESOLVER_ADDRESS=" | sed 's/.*=//')
UNIVERSAL_RESOLVER=$(echo "$OUTPUT" | grep "UNIVERSAL_RESOLVER_ADDRESS=" | sed 's/.*=//')
TYPE_REGISTRY=$(echo "$OUTPUT" | grep "RELATIONSHIP_TYPE_REGISTRY_ADDRESS=" | sed 's/.*=//')
REL_QUERY=$(echo "$OUTPUT" | grep "AGENT_RELATIONSHIP_QUERY_ADDRESS=" | sed 's/.*=//')
NAME_REGISTRY=$(echo "$OUTPUT" | grep "AGENT_NAME_REGISTRY_ADDRESS=" | sed 's/.*=//')
NAME_RESOLVER=$(echo "$OUTPUT" | grep "AGENT_NAME_RESOLVER_ADDRESS=" | sed 's/.*=//')
NAME_UNIVERSAL=$(echo "$OUTPUT" | grep "AGENT_NAME_UNIVERSAL_RESOLVER_ADDRESS=" | sed 's/.*=//')
NAME_SCOPE_ENFORCER=$(echo "$OUTPUT" | grep "NAME_SCOPE_ENFORCER_ADDRESS=" | sed 's/.*=//')
CRED_REGISTRY_CONTRACT=$(echo "$OUTPUT" | grep "CREDENTIAL_REGISTRY_CONTRACT_ADDRESS=" | sed 's/.*=//')
MEMBERSHIP_PROOF_ENFORCER=$(echo "$OUTPUT" | grep "MEMBERSHIP_PROOF_ENFORCER_ADDRESS=" | sed 's/.*=//')
RATE_LIMIT_ENFORCER=$(echo "$OUTPUT" | grep "RATE_LIMIT_ENFORCER_ADDRESS=" | sed 's/.*=//')
RECOVERY_ENFORCER=$(echo "$OUTPUT" | grep "RECOVERY_ENFORCER_ADDRESS=" | sed 's/.*=//')
PASSKEY_VALIDATOR=$(echo "$OUTPUT" | grep "PASSKEY_VALIDATOR_ADDRESS=" | sed 's/.*=//')
UNIVERSAL_SIG_VALIDATOR=$(echo "$OUTPUT" | grep "UNIVERSAL_SIG_VALIDATOR_ADDRESS=" | sed 's/.*=//')
GEO_FEATURE_REGISTRY=$(echo "$OUTPUT" | grep "GEO_FEATURE_REGISTRY_ADDRESS=" | sed 's/.*=//')
GEO_CLAIM_REGISTRY=$(echo "$OUTPUT" | grep "GEO_CLAIM_REGISTRY_ADDRESS=" | sed 's/.*=//')
GEO_H3_VERIFIER=$(echo "$OUTPUT" | grep "GEO_H3_INCLUSION_VERIFIER_ADDRESS=" | sed 's/.*=//')
SKILL_DEFINITION_REGISTRY=$(echo "$OUTPUT" | grep "SKILL_DEFINITION_REGISTRY_ADDRESS=" | sed 's/.*=//')
AGENT_SKILL_REGISTRY=$(echo "$OUTPUT" | grep "AGENT_SKILL_REGISTRY_ADDRESS=" | sed 's/.*=//')
SKILL_ISSUER_REGISTRY=$(echo "$OUTPUT" | grep "SKILL_ISSUER_REGISTRY_ADDRESS=" | sed 's/.*=//')
P256_VERIFIER=$(echo "$OUTPUT" | grep "P256_VERIFIER_ADDRESS=" | sed 's/.*=//')

echo ""
echo "=== Extracted addresses ==="
echo "EntryPoint:                $ENTRYPOINT"
echo "AgentAccountFactory:       $FACTORY"
echo "DelegationManager:         $DELEGATION"
echo "AgentRelationship:         $RELATIONSHIP"
echo "AgentAssertion:            $ASSERTION_ADDR"
echo "AgentRelationshipResolver: $RESOLVER"
echo "AgentRelationshipTemplate: $TEMPLATE"
echo "AgentIssuerProfile:        $ISSUER_ADDR"
echo "AgentValidationProfile:    $VALIDATION_ADDR"
echo "AgentReviewRecord:         $REVIEW_ADDR"
echo "AgentDisputeRecord:        $DISPUTE_ADDR"
echo "AgentTrustProfile:         $TRUST_PROFILE_ADDR"
echo "AgentControl:              $CONTROL_ADDR"
echo "TimestampEnforcer:         $TIMESTAMP"
echo "ValueEnforcer:             $VALUE"
echo "AllowedTargetsEnforcer:    $TARGETS"
echo "AllowedMethodsEnforcer:    $METHODS"
echo "DataScopeEnforcer:         $DATA_SCOPE"
echo "MockTeeVerifier:           $MOCK_TEE_VERIFIER"
echo "OntologyTermRegistry:      $ONTOLOGY_REGISTRY"
echo "AgentAccountResolver:      $AGENT_ACCT_RESOLVER"
echo "AgentUniversalResolver:    $UNIVERSAL_RESOLVER"
echo "RelationshipTypeRegistry: $TYPE_REGISTRY"
echo "AgentRelationshipQuery:   $REL_QUERY"
echo "AgentNameRegistry:        $NAME_REGISTRY"
echo "AgentNameResolver:        $NAME_RESOLVER"
echo "AgentNameUniversalRes:    $NAME_UNIVERSAL"
echo "NameScopeEnforcer:        $NAME_SCOPE_ENFORCER"

# Update .env file
if [ ! -f "$WEB_ENV" ]; then
  cp "$ROOT_DIR/apps/web/.env.example" "$WEB_ENV"
fi

# Remove old contract addresses from .env
sed -i '/^ENTRYPOINT_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_FACTORY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^DELEGATION_MANAGER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_TRUST_GRAPH_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_RELATIONSHIP_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_ASSERTION_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_ACCOUNT_RESOLVER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_TEMPLATE_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_ISSUER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_VALIDATION_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_REVIEW_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_DISPUTE_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_TRUST_PROFILE_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_CONTROL_ADDRESS=/d' "$WEB_ENV"
sed -i '/^TIMESTAMP_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^VALUE_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^ALLOWED_TARGETS_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^ALLOWED_METHODS_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^DATA_SCOPE_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^MOCK_TEE_VERIFIER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^ONTOLOGY_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_ACCOUNT_RESOLVER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^UNIVERSAL_RESOLVER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^RELATIONSHIP_TYPE_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_RELATIONSHIP_QUERY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_NAME_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_NAME_RESOLVER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_NAME_UNIVERSAL_RESOLVER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^NAME_SCOPE_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^CREDENTIAL_REGISTRY_CONTRACT_ADDRESS=/d' "$WEB_ENV"
sed -i '/^MEMBERSHIP_PROOF_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^RATE_LIMIT_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^RECOVERY_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^PASSKEY_VALIDATOR_ADDRESS=/d' "$WEB_ENV"
sed -i '/^UNIVERSAL_SIG_VALIDATOR_ADDRESS=/d' "$WEB_ENV"
sed -i '/^GEO_FEATURE_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^GEO_CLAIM_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^H3_MEMBERSHIP_VERIFIER_ADDRESS=/d' "$WEB_ENV"  # legacy
sed -i '/^GEO_H3_INCLUSION_VERIFIER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^SKILL_DEFINITION_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_SKILL_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^SKILL_ISSUER_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^P256_VERIFIER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^RPC_URL=/d' "$WEB_ENV"
sed -i '/^DEPLOYER_PRIVATE_KEY=/d' "$WEB_ENV"

# Append new addresses
cat >> "$WEB_ENV" << EOF

# ─── Deployed Contract Addresses (local Anvil) ──────────────────────
RPC_URL=$ANVIL_RPC
DEPLOYER_PRIVATE_KEY=$ANVIL_KEY
ENTRYPOINT_ADDRESS=$ENTRYPOINT
AGENT_FACTORY_ADDRESS=$FACTORY
DELEGATION_MANAGER_ADDRESS=$DELEGATION
AGENT_RELATIONSHIP_ADDRESS=$RELATIONSHIP
AGENT_ASSERTION_ADDRESS=$ASSERTION_ADDR
AGENT_RESOLVER_ADDRESS=$RESOLVER
AGENT_TEMPLATE_ADDRESS=$TEMPLATE
AGENT_ISSUER_ADDRESS=$ISSUER_ADDR
AGENT_VALIDATION_ADDRESS=$VALIDATION_ADDR
AGENT_REVIEW_ADDRESS=$REVIEW_ADDR
AGENT_DISPUTE_ADDRESS=$DISPUTE_ADDR
AGENT_TRUST_PROFILE_ADDRESS=$TRUST_PROFILE_ADDR
AGENT_CONTROL_ADDRESS=$CONTROL_ADDR
TIMESTAMP_ENFORCER_ADDRESS=$TIMESTAMP
VALUE_ENFORCER_ADDRESS=$VALUE
ALLOWED_TARGETS_ENFORCER_ADDRESS=$TARGETS
ALLOWED_METHODS_ENFORCER_ADDRESS=$METHODS
DATA_SCOPE_ENFORCER_ADDRESS=$DATA_SCOPE
MOCK_TEE_VERIFIER_ADDRESS=$MOCK_TEE_VERIFIER
ONTOLOGY_REGISTRY_ADDRESS=$ONTOLOGY_REGISTRY
AGENT_ACCOUNT_RESOLVER_ADDRESS=$AGENT_ACCT_RESOLVER
UNIVERSAL_RESOLVER_ADDRESS=$UNIVERSAL_RESOLVER
RELATIONSHIP_TYPE_REGISTRY_ADDRESS=$TYPE_REGISTRY
AGENT_RELATIONSHIP_QUERY_ADDRESS=$REL_QUERY
AGENT_NAME_REGISTRY_ADDRESS=$NAME_REGISTRY
AGENT_NAME_RESOLVER_ADDRESS=$NAME_RESOLVER
AGENT_NAME_UNIVERSAL_RESOLVER_ADDRESS=$NAME_UNIVERSAL
NAME_SCOPE_ENFORCER_ADDRESS=$NAME_SCOPE_ENFORCER
CREDENTIAL_REGISTRY_CONTRACT_ADDRESS=$CRED_REGISTRY_CONTRACT
MEMBERSHIP_PROOF_ENFORCER_ADDRESS=$MEMBERSHIP_PROOF_ENFORCER
RATE_LIMIT_ENFORCER_ADDRESS=$RATE_LIMIT_ENFORCER
RECOVERY_ENFORCER_ADDRESS=$RECOVERY_ENFORCER
PASSKEY_VALIDATOR_ADDRESS=$PASSKEY_VALIDATOR
UNIVERSAL_SIG_VALIDATOR_ADDRESS=$UNIVERSAL_SIG_VALIDATOR
GEO_FEATURE_REGISTRY_ADDRESS=$GEO_FEATURE_REGISTRY
GEO_CLAIM_REGISTRY_ADDRESS=$GEO_CLAIM_REGISTRY
GEO_H3_INCLUSION_VERIFIER_ADDRESS=$GEO_H3_VERIFIER
SKILL_DEFINITION_REGISTRY_ADDRESS=$SKILL_DEFINITION_REGISTRY
AGENT_SKILL_REGISTRY_ADDRESS=$AGENT_SKILL_REGISTRY
SKILL_ISSUER_REGISTRY_ADDRESS=$SKILL_ISSUER_REGISTRY
P256_VERIFIER_ADDRESS=$P256_VERIFIER
EOF

echo ""
echo "=== Updated $WEB_ENV ==="

# ─── Propagate registry wiring to issuer services ──────────────────────────
# org-mcp and family-mcp publish schemas/credDefs directly on-chain, so they
# need the RPC URL + CredentialRegistry contract address. Rewrite the two
# relevant keys in place; leave every other env key untouched.
update_env_var() {
  local file="$1" key="$2" value="$3"
  if [ ! -f "$file" ]; then return; fi
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

for svc in org-mcp family-mcp person-mcp geo-mcp verifier-mcp; do
  ENV_FILE="$ROOT_DIR/apps/$svc/.env"
  if [ -f "$ENV_FILE" ]; then
    update_env_var "$ENV_FILE" RPC_URL "$ANVIL_RPC"
    update_env_var "$ENV_FILE" CREDENTIAL_REGISTRY_CONTRACT_ADDRESS "$CRED_REGISTRY_CONTRACT"
    # Clear the obsolete off-chain-registry path. Harmless if absent.
    sed -i '/^CREDENTIAL_REGISTRY_PATH=/d' "$ENV_FILE"
    echo "Updated $ENV_FILE"
  fi
done

# ─── Fund issuer EOAs so they can publish on-chain ─────────────────────────
# The org and family issuers each derive an EOA from a deterministic private
# key in their .env. Those EOAs must pay gas for publishSchema / publishCredDef
# transactions. anvil_setBalance is cheap.
ORG_ISSUER_ADDR=$(cast wallet address 0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc)
FAMILY_ISSUER_ADDR=$(cast wallet address 0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd)
GEO_ISSUER_ADDR=$(cast wallet address 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee)
TEN_ETH_HEX="0x8ac7230489e80000"   # 10 ETH
cast rpc --rpc-url "$ANVIL_RPC" anvil_setBalance "$ORG_ISSUER_ADDR" "$TEN_ETH_HEX" > /dev/null
cast rpc --rpc-url "$ANVIL_RPC" anvil_setBalance "$FAMILY_ISSUER_ADDR" "$TEN_ETH_HEX" > /dev/null
cast rpc --rpc-url "$ANVIL_RPC" anvil_setBalance "$GEO_ISSUER_ADDR" "$TEN_ETH_HEX" > /dev/null
echo "Funded org issuer $ORG_ISSUER_ADDR, family issuer $FAMILY_ISSUER_ADDR, and geo issuer $GEO_ISSUER_ADDR with 10 ETH each"

# ─── Post-deploy registrations ──────────────────────────────────────────────
#
# These seeds register ontology predicates + relationship types against the
# *just-deployed* registry contracts. They MUST run before anything tries to
# call `setStringProperty` / `addMultiAddressProperty` on the account resolver
# (i.e. before any demo login runs the community seeds). Skipping them was
# the root cause of the "Organizations: 0 registered" failure after every
# redeploy. Running them here makes the deploy idempotent and self-healing.
#
# To skip (e.g. CI unit-test deploys that don't need the ontology), set
#   SKIP_POST_DEPLOY_SEEDS=1

if [ "${SKIP_POST_DEPLOY_SEEDS:-0}" = "1" ]; then
  echo ""
  echo "=== SKIP_POST_DEPLOY_SEEDS=1 — leaving ontology / relationship-type registries empty ==="
else
  echo ""
  echo "=== Seeding ontology predicates ==="
  "$SCRIPT_DIR/seed-ontology.sh"
  echo ""
  echo "=== Seeding relationship-type registry ==="
  "$SCRIPT_DIR/seed-type-registry.sh"
fi

echo ""
echo "Done. Start the web app with: pnpm dev"
