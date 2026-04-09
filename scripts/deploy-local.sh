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
sed -i '/^AGENT_RESOLVER_ADDRESS=/d' "$WEB_ENV"
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
EOF

echo ""
echo "=== Updated $WEB_ENV ==="
echo "Done. Start the web app with: pnpm dev"
