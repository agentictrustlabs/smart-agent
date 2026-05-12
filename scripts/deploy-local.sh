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
# Phase 2 — sub-delegated path enforcers
TASK_BINDING_ENFORCER=$(echo "$OUTPUT" | grep "TASK_BINDING_ENFORCER_ADDRESS=" | sed 's/.*=//')
CALLDATA_HASH_ENFORCER=$(echo "$OUTPUT" | grep "CALLDATA_HASH_ENFORCER_ADDRESS=" | sed 's/.*=//')
MCP_TOOL_SCOPE_ENFORCER=$(echo "$OUTPUT" | grep "MCP_TOOL_SCOPE_ENFORCER_ADDRESS=" | sed 's/.*=//')
# Phase 3 — session-account path
SESSION_AGENT_ACCOUNT_FACTORY=$(echo "$OUTPUT" | grep "SESSION_AGENT_ACCOUNT_FACTORY_ADDRESS=" | sed 's/.*=//')
ECDSA_SESSION_VALIDATOR=$(echo "$OUTPUT" | grep "ECDSA_SESSION_VALIDATOR_ADDRESS=" | sed 's/.*=//')
SPEND_CAP_HOOK=$(echo "$OUTPUT" | grep "SPEND_CAP_HOOK_ADDRESS=" | sed 's/.*=//')
RATE_LIMIT_HOOK=$(echo "$OUTPUT" | grep "RATE_LIMIT_HOOK_ADDRESS=" | sed 's/.*=//')
TARGET_SELECTOR_ALLOWLIST_HOOK=$(echo "$OUTPUT" | grep "TARGET_SELECTOR_ALLOWLIST_HOOK_ADDRESS=" | sed 's/.*=//')
REVOCATION_MODULE=$(echo "$OUTPUT" | grep "REVOCATION_MODULE_ADDRESS=" | sed 's/.*=//')
RELATIONSHIP=$(echo "$OUTPUT" | grep "AGENT_RELATIONSHIP_ADDRESS=" | sed 's/.*=//')
ASSERTION_ADDR=$(echo "$OUTPUT" | grep "AGENT_ASSERTION_ADDRESS=" | sed 's/.*=//')
CLASS_ASSERTION_ADDR=$(echo "$OUTPUT" | grep "CLASS_ASSERTION_ADDRESS=" | sed 's/.*=//')
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
# Treasury Phase 2 (output/onchain-treasury-plan.md § 3) — pool / round / quorum policy primitives
MANDATE_REGISTRY=$(echo "$OUTPUT" | grep "MANDATE_REGISTRY_ADDRESS=" | sed 's/.*=//')
STEWARD_ELIGIBILITY_REGISTRY=$(echo "$OUTPUT" | grep "STEWARD_ELIGIBILITY_REGISTRY_ADDRESS=" | sed 's/.*=//')
APPROVED_HASH_REGISTRY=$(echo "$OUTPUT" | grep "APPROVED_HASH_REGISTRY_ADDRESS=" | sed 's/.*=//')
POOL_MANDATE_ENFORCER=$(echo "$OUTPUT" | grep "POOL_MANDATE_ENFORCER_ADDRESS=" | sed 's/.*=//')
ROUND_DECISION_WINDOW_ENFORCER=$(echo "$OUTPUT" | grep "ROUND_DECISION_WINDOW_ENFORCER_ADDRESS=" | sed 's/.*=//')
ALLOCATION_LIMIT_ENFORCER=$(echo "$OUTPUT" | grep "ALLOCATION_LIMIT_ENFORCER_ADDRESS=" | sed 's/.*=//')
STEWARD_ELIGIBILITY_ENFORCER=$(echo "$OUTPUT" | grep "STEWARD_ELIGIBILITY_ENFORCER_ADDRESS=" | sed 's/.*=//')
QUORUM_ENFORCER=$(echo "$OUTPUT" | grep "QUORUM_ENFORCER_ADDRESS=" | sed 's/.*=//')
# Per-registry attribute storage (each registry inherits AttributeStorage)
SHAPE_REGISTRY=$(echo "$OUTPUT" | grep "SHAPE_REGISTRY_ADDRESS=" | sed 's/.*=//')
POOL_REGISTRY=$(echo "$OUTPUT" | grep "POOL_REGISTRY_ADDRESS=" | sed 's/.*=//')
FUND_REGISTRY=$(echo "$OUTPUT" | grep "FUND_REGISTRY_ADDRESS=" | sed 's/.*=//')
PROPOSAL_REGISTRY=$(echo "$OUTPUT" | grep "PROPOSAL_REGISTRY_ADDRESS=" | sed 's/.*=//')
# Spec 004 marketplace registries
VOTE_REGISTRY=$(echo "$OUTPUT" | grep "VOTE_REGISTRY_ADDRESS=" | sed 's/.*=//')
GRANT_PROPOSAL_REGISTRY=$(echo "$OUTPUT" | grep "GRANT_PROPOSAL_REGISTRY_ADDRESS=" | sed 's/.*=//')
PLEDGE_REGISTRY=$(echo "$OUTPUT" | grep "PLEDGE_REGISTRY_ADDRESS=" | sed 's/.*=//')
MATCH_INITIATION_REGISTRY=$(echo "$OUTPUT" | grep "MATCH_INITIATION_REGISTRY_ADDRESS=" | sed 's/.*=//')
# Spec 005 — dev-only MockUSDC.
MOCK_USDC=$(echo "$OUTPUT" | grep "MOCK_USDC_ADDRESS=" | sed 's/.*=//')
AGENT_NAME_ATTRIBUTE_RESOLVER=$(echo "$OUTPUT" | grep "AGENT_NAME_ATTRIBUTE_RESOLVER_ADDRESS=" | sed 's/.*=//')

echo ""
echo "=== Extracted addresses ==="
echo "EntryPoint:                $ENTRYPOINT"
echo "AgentAccountFactory:       $FACTORY"
echo "DelegationManager:         $DELEGATION"
echo "AgentRelationship:         $RELATIONSHIP"
echo "AgentAssertion:            $ASSERTION_ADDR"
echo "ClassAssertion:            $CLASS_ASSERTION_ADDR"
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
sed -i '/^CLASS_ASSERTION_ADDRESS=/d' "$WEB_ENV"
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
sed -i '/^TASK_BINDING_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^CALLDATA_HASH_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^MCP_TOOL_SCOPE_ENFORCER_ADDRESS=/d' "$WEB_ENV"
# Phase 3 — drop stale session-account addresses before re-writing
sed -i '/^SESSION_AGENT_ACCOUNT_FACTORY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^ECDSA_SESSION_VALIDATOR_ADDRESS=/d' "$WEB_ENV"
sed -i '/^SPEND_CAP_HOOK_ADDRESS=/d' "$WEB_ENV"
sed -i '/^RATE_LIMIT_HOOK_ADDRESS=/d' "$WEB_ENV"
sed -i '/^TARGET_SELECTOR_ALLOWLIST_HOOK_ADDRESS=/d' "$WEB_ENV"
sed -i '/^REVOCATION_MODULE_ADDRESS=/d' "$WEB_ENV"
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
sed -i '/^MANDATE_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^STEWARD_ELIGIBILITY_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^APPROVED_HASH_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^POOL_MANDATE_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^ROUND_DECISION_WINDOW_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^ALLOCATION_LIMIT_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^STEWARD_ELIGIBILITY_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^QUORUM_ENFORCER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^SHAPE_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^POOL_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^FUND_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^PROPOSAL_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^VOTE_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^GRANT_PROPOSAL_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^PLEDGE_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^MATCH_INITIATION_REGISTRY_ADDRESS=/d' "$WEB_ENV"
sed -i '/^MOCK_USDC_ADDRESS=/d' "$WEB_ENV"
sed -i '/^USDC_ADDRESS=/d' "$WEB_ENV"
sed -i '/^AGENT_NAME_ATTRIBUTE_RESOLVER_ADDRESS=/d' "$WEB_ENV"
sed -i '/^RPC_URL=/d' "$WEB_ENV"
sed -i '/^DEPLOYER_PRIVATE_KEY=/d' "$WEB_ENV"
# Phase 1 (delegation refactor) — ORG_MCP_EOA / D_onchain retired. No EOA
# is held by org-mcp anymore. On-chain redeems flow through a2a-agent's
# session EOA, which redeems the user's signed root delegation directly.
# Keep the cleanup of legacy keys so re-running this script on an old env
# clears them.
sed -i '/^ORG_MCP_EOA_ADDRESS=/d' "$WEB_ENV"
sed -i '/^ORG_MCP_EOA_PRIVATE_KEY=/d' "$WEB_ENV"
sed -i '/^A2A_INTERSERVICE_HMAC_KEY_ORG=/d' "$WEB_ENV"
sed -i '/^A2A_SESSION_SECRET=/d' "$WEB_ENV"

# Phase 1 — shared HMAC secret between a2a-agent and org-mcp. Same value
# goes to both apps so HMAC verification works. Hardcoded for dev.
A2A_INTERSERVICE_HMAC_KEY_ORG="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
# A2A session encryption secret (required by a2a-agent for session-package
# encryption). Hardcoded for dev so fresh-start always has a valid value.
A2A_SESSION_SECRET="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

# Append new addresses
cat >> "$WEB_ENV" << EOF

# ─── Deployed Contract Addresses (local Anvil) ──────────────────────
RPC_URL=$ANVIL_RPC
DEPLOYER_PRIVATE_KEY=$ANVIL_KEY
A2A_INTERSERVICE_HMAC_KEY_ORG=$A2A_INTERSERVICE_HMAC_KEY_ORG
A2A_SESSION_SECRET=$A2A_SESSION_SECRET
ENTRYPOINT_ADDRESS=$ENTRYPOINT
AGENT_FACTORY_ADDRESS=$FACTORY
DELEGATION_MANAGER_ADDRESS=$DELEGATION
AGENT_RELATIONSHIP_ADDRESS=$RELATIONSHIP
AGENT_ASSERTION_ADDRESS=$ASSERTION_ADDR
CLASS_ASSERTION_ADDRESS=$CLASS_ASSERTION_ADDR
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
TASK_BINDING_ENFORCER_ADDRESS=$TASK_BINDING_ENFORCER
CALLDATA_HASH_ENFORCER_ADDRESS=$CALLDATA_HASH_ENFORCER
MCP_TOOL_SCOPE_ENFORCER_ADDRESS=$MCP_TOOL_SCOPE_ENFORCER
SESSION_AGENT_ACCOUNT_FACTORY_ADDRESS=$SESSION_AGENT_ACCOUNT_FACTORY
ECDSA_SESSION_VALIDATOR_ADDRESS=$ECDSA_SESSION_VALIDATOR
SPEND_CAP_HOOK_ADDRESS=$SPEND_CAP_HOOK
RATE_LIMIT_HOOK_ADDRESS=$RATE_LIMIT_HOOK
TARGET_SELECTOR_ALLOWLIST_HOOK_ADDRESS=$TARGET_SELECTOR_ALLOWLIST_HOOK
REVOCATION_MODULE_ADDRESS=$REVOCATION_MODULE
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
MANDATE_REGISTRY_ADDRESS=$MANDATE_REGISTRY
STEWARD_ELIGIBILITY_REGISTRY_ADDRESS=$STEWARD_ELIGIBILITY_REGISTRY
APPROVED_HASH_REGISTRY_ADDRESS=$APPROVED_HASH_REGISTRY
POOL_MANDATE_ENFORCER_ADDRESS=$POOL_MANDATE_ENFORCER
ROUND_DECISION_WINDOW_ENFORCER_ADDRESS=$ROUND_DECISION_WINDOW_ENFORCER
ALLOCATION_LIMIT_ENFORCER_ADDRESS=$ALLOCATION_LIMIT_ENFORCER
STEWARD_ELIGIBILITY_ENFORCER_ADDRESS=$STEWARD_ELIGIBILITY_ENFORCER
QUORUM_ENFORCER_ADDRESS=$QUORUM_ENFORCER
SHAPE_REGISTRY_ADDRESS=$SHAPE_REGISTRY
POOL_REGISTRY_ADDRESS=$POOL_REGISTRY
FUND_REGISTRY_ADDRESS=$FUND_REGISTRY
PROPOSAL_REGISTRY_ADDRESS=$PROPOSAL_REGISTRY
VOTE_REGISTRY_ADDRESS=$VOTE_REGISTRY
GRANT_PROPOSAL_REGISTRY_ADDRESS=$GRANT_PROPOSAL_REGISTRY
PLEDGE_REGISTRY_ADDRESS=$PLEDGE_REGISTRY
MATCH_INITIATION_REGISTRY_ADDRESS=$MATCH_INITIATION_REGISTRY
MOCK_USDC_ADDRESS=$MOCK_USDC
USDC_ADDRESS=$MOCK_USDC
AGENT_NAME_ATTRIBUTE_RESOLVER_ADDRESS=$AGENT_NAME_ATTRIBUTE_RESOLVER
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

for svc in org-mcp family-mcp person-mcp geo-mcp verifier-mcp people-group-mcp; do
  ENV_FILE="$ROOT_DIR/apps/$svc/.env"
  # Bootstrap missing env files so update_env_var has somewhere to write.
  if [ ! -f "$ENV_FILE" ]; then
    : > "$ENV_FILE"
  fi
  update_env_var "$ENV_FILE" RPC_URL "$ANVIL_RPC"
  update_env_var "$ENV_FILE" CHAIN_ID "31337"
  update_env_var "$ENV_FILE" CREDENTIAL_REGISTRY_CONTRACT_ADDRESS "$CRED_REGISTRY_CONTRACT"
  # Auth-relevant chain addresses needed by the MCPs' verify-delegation paths.
  update_env_var "$ENV_FILE" DELEGATION_MANAGER_ADDRESS "$DELEGATION"
  update_env_var "$ENV_FILE" AGENT_RELATIONSHIP_ADDRESS "$RELATIONSHIP"
  update_env_var "$ENV_FILE" AGENT_ACCOUNT_RESOLVER_ADDRESS "$AGENT_ACCT_RESOLVER"
  update_env_var "$ENV_FILE" TIMESTAMP_ENFORCER_ADDRESS "$TIMESTAMP"
  update_env_var "$ENV_FILE" MCP_TOOL_SCOPE_ENFORCER_ADDRESS "$MCP_TOOL_SCOPE_ENFORCER"
  # Tier 2 — pool/round registry + factory addresses, plus the ORG_MCP_EOA
  # private key so org-mcp can sign DelegationManager.redeemDelegation as the
  # delegate of D_onchain. For v1 / fresh-start this is anvil account 0; the
  # web app's mint of D_onchain reads ORG_MCP_EOA_ADDRESS to set delegate.
  update_env_var "$ENV_FILE" POOL_REGISTRY_ADDRESS "$POOL_REGISTRY"
  update_env_var "$ENV_FILE" FUND_REGISTRY_ADDRESS "$FUND_REGISTRY"
  update_env_var "$ENV_FILE" VOTE_REGISTRY_ADDRESS "$VOTE_REGISTRY"
  update_env_var "$ENV_FILE" GRANT_PROPOSAL_REGISTRY_ADDRESS "$GRANT_PROPOSAL_REGISTRY"
  update_env_var "$ENV_FILE" PLEDGE_REGISTRY_ADDRESS "$PLEDGE_REGISTRY"
  update_env_var "$ENV_FILE" MATCH_INITIATION_REGISTRY_ADDRESS "$MATCH_INITIATION_REGISTRY"
  update_env_var "$ENV_FILE" MOCK_USDC_ADDRESS "$MOCK_USDC"
  update_env_var "$ENV_FILE" USDC_ADDRESS "$MOCK_USDC"
  update_env_var "$ENV_FILE" AGENT_FACTORY_ADDRESS "$FACTORY"
  # Phase 1 — Inter-service HMAC secret + a2a-agent endpoint URL for the
  # MCPs that talk back to a2a-agent's redeem endpoints. The same secret
  # is also published to apps/web/.env (a2a-agent reads it server-side).
  update_env_var "$ENV_FILE" A2A_INTERSERVICE_HMAC_KEY_ORG "$A2A_INTERSERVICE_HMAC_KEY_ORG"
  update_env_var "$ENV_FILE" A2A_AGENT_URL "http://127.0.0.1:3100"
  # Phase 1 cleanup — the org-mcp wallet was retired. Strip leftover keys.
  sed -i '/^ORG_MCP_EOA_PRIVATE_KEY=/d' "$ENV_FILE"
  # Clear the obsolete off-chain-registry path. Harmless if absent.
  sed -i '/^CREDENTIAL_REGISTRY_PATH=/d' "$ENV_FILE"
  echo "Updated $ENV_FILE"
done

# ─── Propagate inter-service secret + session secret to a2a-agent ─────
# a2a-agent's privileged session endpoints (/session/:id/redeem-tx etc.)
# verify HMAC signatures with this secret. The session secret is used to
# encrypt session packages.
A2A_ENV_FILE="$ROOT_DIR/apps/a2a-agent/.env"
if [ ! -f "$A2A_ENV_FILE" ]; then : > "$A2A_ENV_FILE"; fi
update_env_var "$A2A_ENV_FILE" RPC_URL "$ANVIL_RPC"
update_env_var "$A2A_ENV_FILE" CHAIN_ID "31337"
update_env_var "$A2A_ENV_FILE" DELEGATION_MANAGER_ADDRESS "$DELEGATION"
update_env_var "$A2A_ENV_FILE" AGENT_FACTORY_ADDRESS "$FACTORY"
update_env_var "$A2A_ENV_FILE" POOL_REGISTRY_ADDRESS "$POOL_REGISTRY"
update_env_var "$A2A_ENV_FILE" FUND_REGISTRY_ADDRESS "$FUND_REGISTRY"
update_env_var "$A2A_ENV_FILE" VOTE_REGISTRY_ADDRESS "$VOTE_REGISTRY"
update_env_var "$A2A_ENV_FILE" GRANT_PROPOSAL_REGISTRY_ADDRESS "$GRANT_PROPOSAL_REGISTRY"
update_env_var "$A2A_ENV_FILE" PLEDGE_REGISTRY_ADDRESS "$PLEDGE_REGISTRY"
update_env_var "$A2A_ENV_FILE" MATCH_INITIATION_REGISTRY_ADDRESS "$MATCH_INITIATION_REGISTRY"
update_env_var "$A2A_ENV_FILE" MOCK_USDC_ADDRESS "$MOCK_USDC"
update_env_var "$A2A_ENV_FILE" USDC_ADDRESS "$MOCK_USDC"
update_env_var "$A2A_ENV_FILE" AGENT_ACCOUNT_RESOLVER_ADDRESS "$AGENT_ACCT_RESOLVER"
update_env_var "$A2A_ENV_FILE" AGENT_RELATIONSHIP_ADDRESS "$RELATIONSHIP"
update_env_var "$A2A_ENV_FILE" TIMESTAMP_ENFORCER_ADDRESS "$TIMESTAMP"
# Phase 2 — caveat enforcer addresses needed when a2a-agent mints D_sub.
update_env_var "$A2A_ENV_FILE" ALLOWED_TARGETS_ENFORCER_ADDRESS "$TARGETS"
update_env_var "$A2A_ENV_FILE" ALLOWED_METHODS_ENFORCER_ADDRESS "$METHODS"
update_env_var "$A2A_ENV_FILE" VALUE_ENFORCER_ADDRESS "$VALUE"
update_env_var "$A2A_ENV_FILE" TASK_BINDING_ENFORCER_ADDRESS "$TASK_BINDING_ENFORCER"
update_env_var "$A2A_ENV_FILE" CALLDATA_HASH_ENFORCER_ADDRESS "$CALLDATA_HASH_ENFORCER"
update_env_var "$A2A_ENV_FILE" MCP_TOOL_SCOPE_ENFORCER_ADDRESS "$MCP_TOOL_SCOPE_ENFORCER"
# Phase 3 — session-account path: factory + first-party modules
update_env_var "$A2A_ENV_FILE" SESSION_AGENT_ACCOUNT_FACTORY_ADDRESS "$SESSION_AGENT_ACCOUNT_FACTORY"
update_env_var "$A2A_ENV_FILE" ECDSA_SESSION_VALIDATOR_ADDRESS "$ECDSA_SESSION_VALIDATOR"
update_env_var "$A2A_ENV_FILE" SPEND_CAP_HOOK_ADDRESS "$SPEND_CAP_HOOK"
update_env_var "$A2A_ENV_FILE" RATE_LIMIT_HOOK_ADDRESS "$RATE_LIMIT_HOOK"
update_env_var "$A2A_ENV_FILE" TARGET_SELECTOR_ALLOWLIST_HOOK_ADDRESS "$TARGET_SELECTOR_ALLOWLIST_HOOK"
update_env_var "$A2A_ENV_FILE" REVOCATION_MODULE_ADDRESS "$REVOCATION_MODULE"
# Phase 3 — a2a-agent's master EOA. This wallet is the owner of all
# SessionAgentAccounts deployed by this a2a-agent instance (it signs the
# initial setup tx via SessionAgentAccountFactory.deploySession). For local
# dev, use anvil account #1 (deterministic, well-known dev key). For
# production this should be a per-instance hot wallet.
A2A_MASTER_EOA_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
update_env_var "$A2A_ENV_FILE" A2A_MASTER_EOA_PRIVATE_KEY "$A2A_MASTER_EOA_PRIVATE_KEY"
update_env_var "$A2A_ENV_FILE" ENTRYPOINT_ADDRESS "$ENTRYPOINT"
update_env_var "$A2A_ENV_FILE" A2A_INTERSERVICE_HMAC_KEY_ORG "$A2A_INTERSERVICE_HMAC_KEY_ORG"
update_env_var "$A2A_ENV_FILE" A2A_SESSION_SECRET "$A2A_SESSION_SECRET"
# Phase 2 — per-tool executor private keys. anvil accounts #5-#8 (deterministic,
# unfunded by default — we anvil_setBalance them below). Each family has a
# distinct address so a compromised key blast-radius is bounded by its policy
# envelope (ToolPolicy.allowedTargets + allowedSelectors).
TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY="0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
TOOL_EXECUTOR_DISBURSEMENT_PRIVATE_KEY="0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b341e916b"
TOOL_EXECUTOR_POOL_LIFECYCLE_PRIVATE_KEY="0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbb4ccf"
TOOL_EXECUTOR_GRANT_AWARDS_PRIVATE_KEY="0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97"
update_env_var "$A2A_ENV_FILE" TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY "$TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY"
update_env_var "$A2A_ENV_FILE" TOOL_EXECUTOR_DISBURSEMENT_PRIVATE_KEY "$TOOL_EXECUTOR_DISBURSEMENT_PRIVATE_KEY"
update_env_var "$A2A_ENV_FILE" TOOL_EXECUTOR_POOL_LIFECYCLE_PRIVATE_KEY "$TOOL_EXECUTOR_POOL_LIFECYCLE_PRIVATE_KEY"
update_env_var "$A2A_ENV_FILE" TOOL_EXECUTOR_GRANT_AWARDS_PRIVATE_KEY "$TOOL_EXECUTOR_GRANT_AWARDS_PRIVATE_KEY"
echo "Updated $A2A_ENV_FILE"

# ─── Fund tool-executor EOAs ──────────────────────────────────────────
# Each sub-delegated redeem is submitted FROM the executor EOA, so the
# address must have ETH to pay gas. anvil_setBalance is free.
TOOL_EXEC_ROUND_AWARDS_ADDR=$(cast wallet address "$TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY")
TOOL_EXEC_DISBURSEMENT_ADDR=$(cast wallet address "$TOOL_EXECUTOR_DISBURSEMENT_PRIVATE_KEY")
TOOL_EXEC_POOL_LIFECYCLE_ADDR=$(cast wallet address "$TOOL_EXECUTOR_POOL_LIFECYCLE_PRIVATE_KEY")
TOOL_EXEC_GRANT_AWARDS_ADDR=$(cast wallet address "$TOOL_EXECUTOR_GRANT_AWARDS_PRIVATE_KEY")
ONE_ETH_HEX="0xde0b6b3a7640000"   # 1 ETH
cast rpc --rpc-url "$ANVIL_RPC" anvil_setBalance "$TOOL_EXEC_ROUND_AWARDS_ADDR" "$ONE_ETH_HEX" > /dev/null
cast rpc --rpc-url "$ANVIL_RPC" anvil_setBalance "$TOOL_EXEC_DISBURSEMENT_ADDR" "$ONE_ETH_HEX" > /dev/null
cast rpc --rpc-url "$ANVIL_RPC" anvil_setBalance "$TOOL_EXEC_POOL_LIFECYCLE_ADDR" "$ONE_ETH_HEX" > /dev/null
cast rpc --rpc-url "$ANVIL_RPC" anvil_setBalance "$TOOL_EXEC_GRANT_AWARDS_ADDR" "$ONE_ETH_HEX" > /dev/null
echo "Funded tool-executor EOAs (1 ETH each):"
echo "  ROUND_AWARDS:    $TOOL_EXEC_ROUND_AWARDS_ADDR"
echo "  DISBURSEMENT:    $TOOL_EXEC_DISBURSEMENT_ADDR"
echo "  POOL_LIFECYCLE:  $TOOL_EXEC_POOL_LIFECYCLE_ADDR"
echo "  GRANT_AWARDS:    $TOOL_EXEC_GRANT_AWARDS_ADDR"

# Phase 3 — fund the a2a-agent master EOA so it can deploy SessionAgentAccounts
# and submit UserOps as the self-bundler.
A2A_MASTER_EOA_ADDR=$(cast wallet address "$A2A_MASTER_EOA_PRIVATE_KEY")
TEN_ETH_HEX="0x8ac7230489e80000" # 10 ETH
cast rpc --rpc-url "$ANVIL_RPC" anvil_setBalance "$A2A_MASTER_EOA_ADDR" "$TEN_ETH_HEX" > /dev/null
echo "Funded a2a-master EOA (10 ETH): $A2A_MASTER_EOA_ADDR"

# Tier 2 — surface the additional caveat enforcer addresses to apps/web so
# bootstrapA2ASessionForUser can build D_onchain. (POOL_REGISTRY /
# FUND_REGISTRY are already in the cat-EOF block above.)
ensure_web_var() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$WEB_ENV"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$WEB_ENV"
  fi
}
ensure_web_var "ALLOWED_TARGETS_ENFORCER_ADDRESS" "$TARGETS"
ensure_web_var "ALLOWED_METHODS_ENFORCER_ADDRESS" "$METHODS"

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
  echo ""
  echo "=== Seeding spec-004 / spec-005 sa: predicates + shapes ==="
  # AttributeStorage on the marketplace registries reverts every write with
  # PredicateNotActive() unless the curies are registered in
  # OntologyTermRegistry. Deploy.s.sol seeds Pool/Fund/Round/Proposal; this
  # batch covers Vote/GrantProposal/Pledge/MatchInitiation + the Spec 005
  # honor extensions (sa:hasPersonalTreasury + pledge settlement attrs).
  (cd "$ROOT_DIR/apps/web" && pnpm exec tsx "$SCRIPT_DIR/seed-spec004-ontology.ts") \
    || echo "  ⚠ seed-spec004-ontology failed — marketplace writes will revert"
fi

echo ""
echo "Done. Start the web app with: pnpm dev"
