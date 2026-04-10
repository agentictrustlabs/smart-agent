#!/usr/bin/env bash
set -euo pipefail

# Seeds a rich trust graph on the local Anvil chain.
# Run AFTER deploy-local.sh.
#
# Creates:
#   5 agent accounts (3 people, 2 orgs)
#   Multiple relationship edges with multi-role sets
#   Assertions backing each edge
#
# Graph:
#   Alice ──[ceo, owner, authorized-signer]──► Agentic Trust Labs
#   Bob ──[board-member, admin, member]──────► Agentic Trust Labs
#   Carol ──[auditor, validator]─────────────► Agentic Trust Labs
#   Alice ──[member, operator]───────────────► DeFi Protocol DAO
#   Agentic Trust Labs ──[strategic-partner]─► DeFi Protocol DAO  (Alliance)
#   Carol ──[insurer]────────────────────────► Agentic Trust Labs (Insurance)
#   Bob ──[staker]───────────────────────────► DeFi Protocol DAO  (Economic Security)
#   Carol ──[service-provider]───────────────► DeFi Protocol DAO  (Service Agreement)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source <(grep -E "^[A-Z_]+=" "$ROOT_DIR/apps/web/.env" | grep -v "^#")

RPC="${RPC_URL:-http://127.0.0.1:8545}"
KEY="${DEPLOYER_PRIVATE_KEY}"
FACTORY="$AGENT_FACTORY_ADDRESS"
REL="$AGENT_RELATIONSHIP_ADDRESS"
ASSERT="$AGENT_ASSERTION_ADDRESS"

echo "=== Seeding trust graph ==="

# Deploy 5 agent accounts
deploy_agent() {
  local salt=$1
  cast send "$FACTORY" "createAccount(address,uint256)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast call "$FACTORY" "getAddress(address,uint256)(address)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC"
}

ALICE_AGENT=$(deploy_agent 1001)
BOB_AGENT=$(deploy_agent 1002)
CAROL_AGENT=$(deploy_agent 1003)
ORG_ATL=$(deploy_agent 2001)
ORG_DEFI=$(deploy_agent 2002)

echo "Alice:  $ALICE_AGENT"
echo "Bob:    $BOB_AGENT"
echo "Carol:  $CAROL_AGENT"
echo "ATL:    $ORG_ATL"
echo "DeFi:   $ORG_DEFI"

echo "(DelegationManager set automatically by factory during createAccount)"

# Helper: create edge with roles, activate, and assert
create_relationship() {
  local subject=$1 object=$2 relType=$3 metaURI=$4
  shift 4
  local roles="[$1"
  shift
  while [ $# -gt 0 ]; do roles="$roles,$1"; shift; done
  roles="$roles]"

  # Create edge
  cast send "$REL" "createEdge(address,address,bytes32,bytes32[],string)" \
    "$subject" "$object" "$relType" "$roles" "$metaURI" \
    --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

  # Get edge ID
  local edgeId=$(cast call "$REL" "computeEdgeId(address,address,bytes32)(bytes32)" \
    "$subject" "$object" "$relType" --rpc-url "$RPC")

  # Activate
  cast send "$REL" "setEdgeStatus(bytes32,uint8)" "$edgeId" 2 \
    --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

  # Object assertion
  cast send "$ASSERT" "makeAssertion(bytes32,uint8,uint256,uint256,string)" \
    "$edgeId" 2 0 0 "" \
    --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

  echo "  Edge: ${edgeId:0:18}... [$subject → $object]"
}

# Relationship type hashes
ORG_GOV=$(cast call "$REL" "ORGANIZATION_GOVERNANCE()(bytes32)" --rpc-url "$RPC")
ORG_MEM=$(cast call "$REL" "ORGANIZATION_MEMBERSHIP()(bytes32)" --rpc-url "$RPC")
ALLIANCE_T=$(cast call "$REL" "ALLIANCE()(bytes32)" --rpc-url "$RPC")
INSURANCE=$(cast call "$REL" "INSURANCE_COVERAGE()(bytes32)" --rpc-url "$RPC")
ECON_SEC=$(cast call "$REL" "ECONOMIC_SECURITY()(bytes32)" --rpc-url "$RPC")
SVC_AGR=$(cast call "$REL" "SERVICE_AGREEMENT()(bytes32)" --rpc-url "$RPC")

# Role hashes
R_OWNER=$(cast call "$REL" "ROLE_OWNER()(bytes32)" --rpc-url "$RPC")
R_CEO=$(cast call "$REL" "ROLE_CEO()(bytes32)" --rpc-url "$RPC")
R_AUTH_SIGNER=$(cast call "$REL" "ROLE_AUTHORIZED_SIGNER()(bytes32)" --rpc-url "$RPC")
R_BOARD=$(cast call "$REL" "ROLE_BOARD_MEMBER()(bytes32)" --rpc-url "$RPC")
R_ADMIN=$(cast call "$REL" "ROLE_ADMIN()(bytes32)" --rpc-url "$RPC")
R_MEMBER=$(cast call "$REL" "ROLE_MEMBER()(bytes32)" --rpc-url "$RPC")
R_OPERATOR=$(cast call "$REL" "ROLE_OPERATOR()(bytes32)" --rpc-url "$RPC")
R_AUDITOR=$(cast call "$REL" "ROLE_AUDITOR()(bytes32)" --rpc-url "$RPC")
R_VALIDATOR=$(cast call "$REL" "ROLE_VALIDATOR()(bytes32)" --rpc-url "$RPC")
R_INSURER=$(cast call "$REL" "ROLE_INSURER()(bytes32)" --rpc-url "$RPC")
R_STAKER=$(cast call "$REL" "ROLE_STAKER()(bytes32)" --rpc-url "$RPC")
R_PARTNER=$(cast call "$REL" "ROLE_STRATEGIC_PARTNER()(bytes32)" --rpc-url "$RPC")
R_SVC_PROV=$(cast call "$REL" "ROLE_SERVICE_PROVIDER()(bytes32)" --rpc-url "$RPC")

echo ""
echo "--- Governance ---"
echo "Alice → ATL (ceo, owner, authorized-signer)"
create_relationship "$ALICE_AGENT" "$ORG_ATL" "$ORG_GOV" "" "$R_CEO" "$R_OWNER" "$R_AUTH_SIGNER"

echo "Bob → ATL (board-member)"
create_relationship "$BOB_AGENT" "$ORG_ATL" "$ORG_GOV" "" "$R_BOARD"

echo ""
echo "--- Membership ---"
echo "Bob → ATL (admin, member)"
create_relationship "$BOB_AGENT" "$ORG_ATL" "$ORG_MEM" "" "$R_ADMIN" "$R_MEMBER"

echo "Alice → DeFi DAO (member, operator)"
create_relationship "$ALICE_AGENT" "$ORG_DEFI" "$ORG_MEM" "" "$R_MEMBER" "$R_OPERATOR"

echo "Carol → ATL (auditor, validator)"
create_relationship "$CAROL_AGENT" "$ORG_ATL" "$ORG_MEM" "" "$R_AUDITOR" "$R_VALIDATOR"

echo ""
echo "--- Alliance ---"
echo "ATL ↔ DeFi DAO (strategic-partner)"
create_relationship "$ORG_ATL" "$ORG_DEFI" "$ALLIANCE_T" "" "$R_PARTNER"

echo ""
echo "--- Insurance ---"
echo "Carol → ATL (insurer)"
create_relationship "$CAROL_AGENT" "$ORG_ATL" "$INSURANCE" "ipfs://insurance-policy-001" "$R_INSURER"

echo ""
echo "--- Economic Security ---"
echo "Bob → DeFi DAO (staker)"
create_relationship "$BOB_AGENT" "$ORG_DEFI" "$ECON_SEC" "" "$R_STAKER"

echo ""
echo "--- Service ---"
echo "Carol → DeFi DAO (service-provider)"
create_relationship "$CAROL_AGENT" "$ORG_DEFI" "$SVC_AGR" "" "$R_SVC_PROV"

# ─── Delegation Authority edges ──────────────────────────────────────

DELEG=$(cast call "$REL" "DELEGATION_AUTHORITY()(bytes32)" --rpc-url "$RPC")
R_DELEG_OP=$(cast call "$REL" "ROLE_DELEGATED_OPERATOR()(bytes32)" --rpc-url "$RPC")
R_AUTH_SIGNER_2=$R_AUTH_SIGNER

echo ""
echo "--- Delegation Authority ---"
echo "Alice → ATL (delegated-operator, authorized-signer) [DelegationAuthority]"
create_relationship "$ALICE_AGENT" "$ORG_ATL" "$DELEG" "" "$R_DELEG_OP" "$R_AUTH_SIGNER_2"

echo "Bob → DeFi DAO (delegated-operator) [DelegationAuthority]"
create_relationship "$BOB_AGENT" "$ORG_DEFI" "$DELEG" "" "$R_DELEG_OP"

# ─── Create Templates ──────────────────────────────────────────────

TMPL="${AGENT_TEMPLATE_ADDRESS}"
TIMESTAMP_ENF="${TIMESTAMP_ENFORCER_ADDRESS}"
VALUE_ENF="${VALUE_ENFORCER_ADDRESS}"
TARGETS_ENF="${ALLOWED_TARGETS_ENFORCER_ADDRESS}"
METHODS_ENF="${ALLOWED_METHODS_ENFORCER_ADDRESS}"

echo ""
echo "=== Creating role templates ==="

# Template 1: CEO Treasury Authority
echo "Template: CEO Treasury Authority"
cast send "$TMPL" "createTemplate(bytes32,bytes32,string,string,(address,bool,bytes)[],string,string)" \
  "$ORG_GOV" "$R_CEO" \
  "CEO Treasury Authority" \
  "CEO may execute treasury operations with spend cap and time limits" \
  "[($TIMESTAMP_ENF,true,0x),($VALUE_ENF,true,0x),($TARGETS_ENF,false,0x)]" \
  "" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# Template 2: Board Member Signing Authority
echo "Template: Board Member Signing Authority"
cast send "$TMPL" "createTemplate(bytes32,bytes32,string,string,(address,bool,bytes)[],string,string)" \
  "$ORG_GOV" "$R_BOARD" \
  "Board Signing Authority" \
  "Board members may co-sign proposals with time-bounded sessions" \
  "[($TIMESTAMP_ENF,true,0x),($METHODS_ENF,true,0x)]" \
  "" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# Template 3: Operator Execution Authority
echo "Template: Operator Execution Authority"
cast send "$TMPL" "createTemplate(bytes32,bytes32,string,string,(address,bool,bytes)[],string,string)" \
  "$ORG_MEM" "$R_OPERATOR" \
  "Operator Execution Authority" \
  "Operators may execute approved methods on approved targets with value limits" \
  "[($TIMESTAMP_ENF,true,0x),($VALUE_ENF,true,0x),($TARGETS_ENF,true,0x),($METHODS_ENF,true,0x)]" \
  "" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# Template 4: Auditor Read-Only Access
echo "Template: Auditor Read-Only Access"
cast send "$TMPL" "createTemplate(bytes32,bytes32,string,string,(address,bool,bytes)[],string,string)" \
  "$ORG_MEM" "$R_AUDITOR" \
  "Auditor Read-Only Access" \
  "Auditors may call view functions only, time-bounded" \
  "[($TIMESTAMP_ENF,true,0x),($METHODS_ENF,true,0x)]" \
  "" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# Template 5: Staker Economic Bond
echo "Template: Staker Economic Bond"
cast send "$TMPL" "createTemplate(bytes32,bytes32,string,string,(address,bool,bytes)[],string,string)" \
  "$ECON_SEC" "$R_STAKER" \
  "Staker Economic Bond" \
  "Stakers have bonded capital backing their operations, time-limited" \
  "[($TIMESTAMP_ENF,true,0x),($VALUE_ENF,false,0x)]" \
  "" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# Template 6: Service Provider Execution
echo "Template: Service Provider Execution"
cast send "$TMPL" "createTemplate(bytes32,bytes32,string,string,(address,bool,bytes)[],string,string)" \
  "$SVC_AGR" "$R_SVC_PROV" \
  "Service Provider Execution" \
  "Service providers may call service methods with spend and time limits" \
  "[($TIMESTAMP_ENF,true,0x),($VALUE_ENF,true,0x),($TARGETS_ENF,true,0x)]" \
  "" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# Template 7: Reviewer Access
echo "Template: Reviewer Access"
REVIEW_T=$(cast call "$REL" "REVIEW_RELATIONSHIP()(bytes32)" --rpc-url "$RPC")
R_REVIEWER_ROLE=$(cast call "$REL" "ROLE_REVIEWER()(bytes32)" --rpc-url "$RPC")
cast send "$TMPL" "createTemplate(bytes32,bytes32,string,string,(address,bool,bytes)[],string,string)" \
  "$REVIEW_T" "$R_REVIEWER_ROLE" \
  "Reviewer Access" \
  "Reviewers may submit structured reviews for agents via delegation. Time-bounded, method-restricted." \
  "[($TIMESTAMP_ENF,true,0x),($METHODS_ENF,true,0x)]" \
  "" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

echo "Templates created: $(cast call $TMPL 'templateCount()(uint256)' --rpc-url $RPC)"

# ─── Deploy additional agent nodes ──────────────────────────────────

echo ""
echo "=== Deploying additional agents ==="

INSURECO=$(deploy_agent 3001)
echo "InsureCo:        $INSURECO"

STAKEPOOL=$(deploy_agent 3002)
echo "StakePool:       $STAKEPOOL"

TRUST_VALIDATOR=$(deploy_agent 3003)
echo "TrustValidator:  $TRUST_VALIDATOR"

TEE_RUNTIME=$(deploy_agent 3004)
echo "TEE Runtime:     $TEE_RUNTIME"


# ─── Register Issuers ───────────────────────────────────────────────

ISSUER_CONTRACT="${AGENT_ISSUER_ADDRESS}"
VALIDATION_CONTRACT="${AGENT_VALIDATION_ADDRESS}"

# Get issuer type hashes
IT_VALIDATOR=$(cast call "$ISSUER_CONTRACT" "ISSUER_VALIDATOR()(bytes32)" --rpc-url "$RPC")
IT_INSURER=$(cast call "$ISSUER_CONTRACT" "ISSUER_INSURER()(bytes32)" --rpc-url "$RPC")
IT_STAKING_POOL=$(cast call "$ISSUER_CONTRACT" "ISSUER_STAKING_POOL()(bytes32)" --rpc-url "$RPC")
IT_TEE=$(cast call "$ISSUER_CONTRACT" "ISSUER_TEE_VERIFIER()(bytes32)" --rpc-url "$RPC")

# Get validation method hashes
VM_VALIDATOR=$(cast call "$ISSUER_CONTRACT" "VM_VALIDATOR_VERIFIED()(bytes32)" --rpc-url "$RPC")
VM_INSURER=$(cast call "$ISSUER_CONTRACT" "VM_INSURER_ISSUED()(bytes32)" --rpc-url "$RPC")
VM_SELF=$(cast call "$ISSUER_CONTRACT" "VM_SELF_ASSERTED()(bytes32)" --rpc-url "$RPC")
VM_TEE_ONCHAIN=$(cast call "$ISSUER_CONTRACT" "VM_TEE_ONCHAIN_VERIFIED()(bytes32)" --rpc-url "$RPC")

echo ""
echo "=== Registering issuers ==="

echo "TrustValidator — type: validator"
cast send "$ISSUER_CONTRACT" "registerIssuer(address,bytes32,string,string,bytes32[],bytes32[],string)" \
  "$TRUST_VALIDATOR" "$IT_VALIDATOR" \
  "TrustValidator" "Trusted identity and compliance validator" \
  "[$VM_VALIDATOR,$VM_TEE_ONCHAIN]" \
  "[$ORG_GOV,$ORG_MEM]" \
  "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

echo "InsureCo — type: insurer"
cast send "$ISSUER_CONTRACT" "registerIssuer(address,bytes32,string,string,bytes32[],bytes32[],string)" \
  "$INSURECO" "$IT_INSURER" \
  "InsureCo" "Agent insurance and coverage provider" \
  "[$VM_INSURER]" \
  "[$INSURANCE]" \
  "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

echo "StakePool — type: staking-pool"
cast send "$ISSUER_CONTRACT" "registerIssuer(address,bytes32,string,string,bytes32[],bytes32[],string)" \
  "$STAKEPOOL" "$IT_STAKING_POOL" \
  "StakePool" "Economic security bonding pool" \
  "[$VM_SELF]" \
  "[$ECON_SEC]" \
  "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

echo "TEE Runtime — type: tee-verifier"
cast send "$ISSUER_CONTRACT" "registerIssuer(address,bytes32,string,string,bytes32[],bytes32[],string)" \
  "$TEE_RUNTIME" "$IT_TEE" \
  "ATL TEE Runtime" "AWS Nitro enclave for ATL agent execution" \
  "[$VM_TEE_ONCHAIN]" \
  "[]" \
  "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# Register MockTeeVerifier as a TEE verifier issuer
MOCK_TEE="${MOCK_TEE_VERIFIER_ADDRESS}"
IT_TEE=$(cast call "$ISSUER_CONTRACT" "ISSUER_TEE_VERIFIER()(bytes32)" --rpc-url "$RPC")
echo "MockTeeVerifier — type: tee-verifier"
cast send "$ISSUER_CONTRACT" "registerIssuer(address,bytes32,string,string,bytes32[],bytes32[],string)" \
  "$MOCK_TEE" "$IT_TEE" \
  "Mock TEE Verifier" "Development TEE attestation verifier (simulates Nitro/TDX/SGX verification)" \
  "[$VM_TEE_ONCHAIN]" \
  "[]" \
  "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

echo "Issuers registered: $(cast call $ISSUER_CONTRACT 'issuerCount()(uint256)' --rpc-url $RPC)"

# ─── Additional relationship edges ──────────────────────────────────

RUNTIME_T=$(cast call "$REL" "RUNTIME_ATTESTATION()(bytes32)" --rpc-url "$RPC")
R_RUNS_IN_TEE=$(cast call "$REL" "ROLE_RUNS_IN_TEE()(bytes32)" --rpc-url "$RPC")
R_ATTESTED_BY=$(cast call "$REL" "ROLE_ATTESTED_BY()(bytes32)" --rpc-url "$RPC")
R_CONTROLS_RT=$(cast call "$REL" "ROLE_CONTROLS_RUNTIME()(bytes32)" --rpc-url "$RPC")
R_GUARANTOR=$(cast call "$REL" "ROLE_GUARANTOR()(bytes32)" --rpc-url "$RPC")
R_INSURED=$(cast call "$REL" "ROLE_INSURED_PARTY()(bytes32)" --rpc-url "$RPC")
R_ENDORSED=$(cast call "$REL" "ROLE_ENDORSED_BY()(bytes32)" --rpc-url "$RPC")

echo ""
echo "--- Insurance (InsureCo) ---"
echo "InsureCo → ATL (insurer) [InsuranceCoverage]"
create_relationship "$INSURECO" "$ORG_ATL" "$INSURANCE" "ipfs://policy-ATL-001" "$R_INSURER"

echo "ATL → InsureCo (insured-party) [InsuranceCoverage]"
create_relationship "$ORG_ATL" "$INSURECO" "$INSURANCE" "" "$R_INSURED"

echo ""
echo "--- Economic Security (StakePool) ---"
echo "StakePool → DeFi DAO (guarantor) [EconomicSecurity]"
create_relationship "$STAKEPOOL" "$ORG_DEFI" "$ECON_SEC" "" "$R_GUARANTOR"

echo ""
echo "--- Validation ---"
echo "TrustValidator → Alice (validator) [ValidationTrust]"
create_relationship "$TRUST_VALIDATOR" "$ALICE_AGENT" "$(cast call $REL 'VALIDATION_TRUST()(bytes32)' --rpc-url $RPC)" "" "$R_VALIDATOR"

echo "TrustValidator → ATL (validator) [ValidationTrust]"
create_relationship "$TRUST_VALIDATOR" "$ORG_ATL" "$(cast call $REL 'VALIDATION_TRUST()(bytes32)' --rpc-url $RPC)" "" "$R_VALIDATOR"

echo ""
echo "--- TEE / Runtime ---"
echo "TEE Runtime → TrustValidator (attested-by) [RuntimeAttestation]"
create_relationship "$TEE_RUNTIME" "$TRUST_VALIDATOR" "$RUNTIME_T" "" "$R_ATTESTED_BY"

echo "ATL → TEE Runtime (controls-runtime) [RuntimeAttestation]"
create_relationship "$ORG_ATL" "$TEE_RUNTIME" "$RUNTIME_T" "" "$R_CONTROLS_RT"

echo ""
echo "--- Alliance extension ---"
echo "DeFi DAO → ATL (endorsed-by) [Alliance]"
create_relationship "$ORG_DEFI" "$ORG_ATL" "$ALLIANCE_T" "" "$R_ENDORSED"

# ─── AI Discovery Agent + Reviewers + Validators ────────────────────

echo ""
echo "=== Deploying AI Discovery Agent ecosystem ==="

DISCOVERY_AGENT=$(deploy_agent 4001)
echo "Discovery AI Agent: $DISCOVERY_AGENT"

DISCOVERY_TEE=$(deploy_agent 4002)
echo "Discovery TEE:      $DISCOVERY_TEE"

VALIDATOR_ALPHA=$(deploy_agent 4003)
echo "Validator Alpha:    $VALIDATOR_ALPHA"

VALIDATOR_BETA=$(deploy_agent 4004)
echo "Validator Beta:     $VALIDATOR_BETA"

REVIEWER_DAVE=$(deploy_agent 4005)
echo "Reviewer Dave:      $REVIEWER_DAVE"

REVIEWER_EVE=$(deploy_agent 4006)
echo "Reviewer Eve:       $REVIEWER_EVE"

REVIEWER_FRANK=$(deploy_agent 4007)
echo "Reviewer Frank:     $REVIEWER_FRANK"


# Get new type/role hashes
ORG_CTRL=$(cast call "$REL" "ORGANIZATIONAL_CONTROL()(bytes32)" --rpc-url "$RPC")
ACT_VAL=$(cast call "$REL" "ACTIVITY_VALIDATION()(bytes32)" --rpc-url "$RPC")
REVIEW_T=$(cast call "$REL" "REVIEW_RELATIONSHIP()(bytes32)" --rpc-url "$RPC")
R_OPERATED=$(cast call "$REL" "ROLE_OPERATED_AGENT()(bytes32)" --rpc-url "$RPC")
R_ADMINISTERS=$(cast call "$REL" "ROLE_ADMINISTERS()(bytes32)" --rpc-url "$RPC")
R_ACT_VALIDATOR=$(cast call "$REL" "ROLE_ACTIVITY_VALIDATOR()(bytes32)" --rpc-url "$RPC")
R_REVIEWER=$(cast call "$REL" "ROLE_REVIEWER()(bytes32)" --rpc-url "$RPC")

echo ""
echo "--- Org Control ---"
echo "Discovery AI Agent → ATL (operated-agent, managed-agent) [OrganizationalControl]"
R_MANAGED=$(cast call "$REL" "ROLE_MANAGED_AGENT()(bytes32)" --rpc-url "$RPC")
create_relationship "$DISCOVERY_AGENT" "$ORG_ATL" "$ORG_CTRL" "" "$R_OPERATED" "$R_MANAGED"

echo "ATL → Discovery AI Agent (administers) [OrganizationalControl]"
create_relationship "$ORG_ATL" "$DISCOVERY_AGENT" "$ORG_CTRL" "" "$R_ADMINISTERS"

echo ""
echo "--- Discovery TEE ---"
echo "Discovery AI Agent → Discovery TEE (runs-in-tee) [RuntimeAttestation]"
create_relationship "$DISCOVERY_AGENT" "$DISCOVERY_TEE" "$RUNTIME_T" "" "$R_RUNS_IN_TEE"

echo "Discovery TEE → TrustValidator (attested-by) [RuntimeAttestation]"
create_relationship "$DISCOVERY_TEE" "$TRUST_VALIDATOR" "$RUNTIME_T" "" "$R_ATTESTED_BY"

echo ""
echo "--- Activity Validators ---"
echo "Validator Alpha → Discovery AI Agent (activity-validator) [ActivityValidation]"
create_relationship "$VALIDATOR_ALPHA" "$DISCOVERY_AGENT" "$ACT_VAL" "" "$R_ACT_VALIDATOR"

echo "Validator Beta → Discovery AI Agent (activity-validator) [ActivityValidation]"
create_relationship "$VALIDATOR_BETA" "$DISCOVERY_AGENT" "$ACT_VAL" "" "$R_ACT_VALIDATOR"

echo ""
echo "--- Reviewers ---"
echo "Dave → Discovery AI Agent (reviewer) [ReviewRelationship]"
create_relationship "$REVIEWER_DAVE" "$DISCOVERY_AGENT" "$REVIEW_T" "ipfs://review-dave-001" "$R_REVIEWER"

echo "Eve → Discovery AI Agent (reviewer) [ReviewRelationship]"
create_relationship "$REVIEWER_EVE" "$DISCOVERY_AGENT" "$REVIEW_T" "ipfs://review-eve-001" "$R_REVIEWER"

echo "Frank → Discovery AI Agent (reviewer) [ReviewRelationship]"
create_relationship "$REVIEWER_FRANK" "$DISCOVERY_AGENT" "$REVIEW_T" "ipfs://review-frank-001" "$R_REVIEWER"

# Register validators as issuers
echo ""
echo "--- Register additional issuers ---"
cast send "$ISSUER_CONTRACT" "registerIssuer(address,bytes32,string,string,bytes32[],bytes32[],string)" \
  "$VALIDATOR_ALPHA" "$IT_VALIDATOR" "Validator Alpha" "Activity validation for AI agents" \
  "[$VM_VALIDATOR]" "[]" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
echo "Validator Alpha registered as issuer"

cast send "$ISSUER_CONTRACT" "registerIssuer(address,bytes32,string,string,bytes32[],bytes32[],string)" \
  "$VALIDATOR_BETA" "$IT_VALIDATOR" "Validator Beta" "Activity validation and compliance" \
  "[$VM_VALIDATOR]" "[]" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
echo "Validator Beta registered as issuer"

echo "Total issuers: $(cast call $ISSUER_CONTRACT 'issuerCount()(uint256)' --rpc-url $RPC)"

# ─── Structured Reviews ─────────────────────────────────────────────

REVIEW_CONTRACT="${AGENT_REVIEW_ADDRESS}"
DISPUTE_CONTRACT="${AGENT_DISPUTE_ADDRESS}"
TRUST_PROFILE_CONTRACT="${AGENT_TRUST_PROFILE_ADDRESS}"

# Review type and dimension hashes
RT_PERFORMANCE=$(cast call "$REVIEW_CONTRACT" "REVIEW_PERFORMANCE()(bytes32)" --rpc-url "$RPC")
RT_TRUST=$(cast call "$REVIEW_CONTRACT" "REVIEW_TRUST()(bytes32)" --rpc-url "$RPC")
RT_QUALITY=$(cast call "$REVIEW_CONTRACT" "REVIEW_QUALITY()(bytes32)" --rpc-url "$RPC")
REC_ENDORSES=$(cast call "$REVIEW_CONTRACT" "REC_ENDORSES()(bytes32)" --rpc-url "$RPC")
REC_RECOMMENDS=$(cast call "$REVIEW_CONTRACT" "REC_RECOMMENDS()(bytes32)" --rpc-url "$RPC")
REC_FLAGS=$(cast call "$REVIEW_CONTRACT" "REC_FLAGS()(bytes32)" --rpc-url "$RPC")
DIM_ACCURACY=$(cast call "$REVIEW_CONTRACT" "DIM_ACCURACY()(bytes32)" --rpc-url "$RPC")
DIM_RELIABILITY=$(cast call "$REVIEW_CONTRACT" "DIM_RELIABILITY()(bytes32)" --rpc-url "$RPC")
DIM_SAFETY=$(cast call "$REVIEW_CONTRACT" "DIM_SAFETY()(bytes32)" --rpc-url "$RPC")
DIM_TRANSPARENCY=$(cast call "$REVIEW_CONTRACT" "DIM_TRANSPARENCY()(bytes32)" --rpc-url "$RPC")
DIM_HELPFULNESS=$(cast call "$REVIEW_CONTRACT" "DIM_HELPFULNESS()(bytes32)" --rpc-url "$RPC")

echo ""
echo "=== Creating structured reviews ==="

# Dave's review — endorses, score 85 (reviewer = Dave agent)
echo "Dave reviews Discovery AI Agent: score=85, endorses"
cast send "$REVIEW_CONTRACT" \
  "createReview(address,address,bytes32,bytes32,uint8,(bytes32,uint8)[],string,string)" \
  "$REVIEWER_DAVE" "$DISCOVERY_AGENT" "$RT_PERFORMANCE" "$REC_ENDORSES" 85 \
  "[($DIM_ACCURACY,88),($DIM_RELIABILITY,82),($DIM_SAFETY,90),($DIM_TRANSPARENCY,80)]" \
  "Excellent discovery capabilities with strong safety controls" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# Eve's review — recommends, score 72 (reviewer = Eve agent)
echo "Eve reviews Discovery AI Agent: score=72, recommends"
cast send "$REVIEW_CONTRACT" \
  "createReview(address,address,bytes32,bytes32,uint8,(bytes32,uint8)[],string,string)" \
  "$REVIEWER_EVE" "$DISCOVERY_AGENT" "$RT_TRUST" "$REC_RECOMMENDS" 72 \
  "[($DIM_ACCURACY,75),($DIM_RELIABILITY,70),($DIM_HELPFULNESS,78),($DIM_TRANSPARENCY,65)]" \
  "Good trust practices but could improve transparency" "" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# Frank's review — flags, score 45 (reviewer = Frank agent)
echo "Frank reviews Discovery AI Agent: score=45, flags"
cast send "$REVIEW_CONTRACT" \
  "createReview(address,address,bytes32,bytes32,uint8,(bytes32,uint8)[],string,string)" \
  "$REVIEWER_FRANK" "$DISCOVERY_AGENT" "$RT_QUALITY" "$REC_FLAGS" 45 \
  "[($DIM_ACCURACY,50),($DIM_RELIABILITY,40),($DIM_SAFETY,55),($DIM_HELPFULNESS,35)]" \
  "Quality concerns with output reliability and helpfulness" "ipfs://evidence-frank" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

echo "Reviews created: $(cast call $REVIEW_CONTRACT 'reviewCount()(uint256)' --rpc-url $RPC)"

# Check average
AVG=$(cast call "$REVIEW_CONTRACT" "getAverageScore(address)(uint256,uint256)" "$DISCOVERY_AGENT" --rpc-url "$RPC")
echo "Average review score for Discovery Agent: $AVG"

# ─── Disputes ────────────────────────────────────────────────────────

echo ""
echo "=== Filing disputes ==="

# Frank files a dispute (FLAG type)
echo "Frank flags Discovery AI Agent"
cast send "$DISPUTE_CONTRACT" \
  "fileDispute(address,uint8,string,string)" \
  "$DISCOVERY_AGENT" 1 "Output quality below acceptable threshold in test batch #47" "ipfs://dispute-evidence-frank" \
  --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

echo "Disputes filed: $(cast call $DISPUTE_CONTRACT 'disputeCount()(uint256)' --rpc-url $RPC)"
echo "Open disputes for Discovery Agent: $(cast call $DISPUTE_CONTRACT 'getOpenDisputeCount(address)(uint256)' $DISCOVERY_AGENT --rpc-url $RPC)"

# ─── Trust Profile Check ────────────────────────────────────────────

echo ""
echo "=== Trust profile checks ==="
echo "Discovery trust for Discovery Agent:"
cast call "$TRUST_PROFILE_CONTRACT" "checkDiscoveryTrust(address)((bool,uint256,uint256,uint256,uint256,uint256))" "$DISCOVERY_AGENT" --rpc-url "$RPC"

echo "Execution trust for Discovery Agent:"
cast call "$TRUST_PROFILE_CONTRACT" "checkExecutionTrust(address)((bool,uint256,uint256,uint256,uint256,uint256))" "$DISCOVERY_AGENT" --rpc-url "$RPC"

# Seed the web app DB
echo ""
echo "=== Seeding database ==="
cd "$ROOT_DIR/apps/web"
node -e "
const Database = require('better-sqlite3');
const db = new Database('local.db');
// Only delete SEEDED agents (test-user-*), preserve user-created ones
db.prepare(\"DELETE FROM person_agents WHERE user_id LIKE 'test-user-%'\").run();
db.prepare(\"DELETE FROM org_agents WHERE created_by LIKE 'test-user-%'\").run();
try { db.prepare(\"DELETE FROM ai_agents WHERE created_by LIKE 'test-user-%'\").run(); } catch(e) {}
try { db.prepare(\"DELETE FROM review_delegations\").run(); } catch(e) {}
const ts = () => new Date().toISOString();
const id = () => require('crypto').randomUUID();

// Users (ensure test-user-001 exists)
const existing = db.prepare(\"SELECT id FROM users WHERE id = 'test-user-001'\").get();
if (!existing) {
  db.prepare('INSERT INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(
    'test-user-001','alice@example.com','Alice','0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266','did:privy:test-user-001',ts()
  );
}

// Ensure Bob and Carol users exist
const bob = db.prepare(\"SELECT id FROM users WHERE name = 'Bob'\").get();
if (!bob) {
  db.prepare('INSERT INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(
    'test-user-002','bob@example.com','Bob','0x0000000000000000000000000000000000001002','did:privy:test-user-002',ts()
  );
}
const carol = db.prepare(\"SELECT id FROM users WHERE name = 'Carol'\").get();
if (!carol) {
  db.prepare('INSERT INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(
    'test-user-003','carol@example.com','Carol','0x0000000000000000000000000000000000001003','did:privy:test-user-003',ts()
  );
}

// Person agents — all three
db.prepare('INSERT INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(),'Alice Agent','test-user-001','$ALICE_AGENT',31337,'0x1','hybrid','deployed',ts());
db.prepare('INSERT INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(),'Bob Agent','test-user-002','$BOB_AGENT',31337,'0x2','hybrid','deployed',ts());
db.prepare('INSERT INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(),'Carol Agent','test-user-003','$CAROL_AGENT',31337,'0x3','hybrid','deployed',ts());

// Org agents (actual organizations)
db.prepare('INSERT INTO org_agents VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),'Agentic Trust Labs','Agent trust, identity, and reputation research','test-user-001','$ORG_ATL',31337,'0x4','hybrid','deployed',ts());
db.prepare('INSERT INTO org_agents VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),'DeFi Protocol DAO','Decentralized finance governance','test-user-001','$ORG_DEFI',31337,'0x5','hybrid','deployed',ts());
db.prepare('INSERT INTO org_agents VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),'InsureCo','Agent insurance and coverage provider','test-user-001','$INSURECO',31337,'0x6','hybrid','deployed',ts());
db.prepare('INSERT INTO org_agents VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),'StakePool','Economic security bonding pool','test-user-001','$STAKEPOOL',31337,'0x7','hybrid','deployed',ts());

// AI Agents (autonomous agents with agent_type)
// ai_agents columns: id, name, description, agent_type, created_by, operated_by, smart_account_address, chain_id, salt, implementation_type, status, created_at
db.prepare('INSERT INTO ai_agents (id,name,description,agent_type,created_by,operated_by,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),'TrustValidator','Trusted identity and compliance validator','validator','test-user-001',null,'$TRUST_VALIDATOR',31337,'0x8','hybrid','deployed',ts());
db.prepare('INSERT INTO ai_agents (id,name,description,agent_type,created_by,operated_by,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),'ATL TEE Runtime','AWS Nitro enclave for ATL agent execution','executor','test-user-001','$ORG_ATL','$TEE_RUNTIME',31337,'0x9','hybrid','deployed',ts());
db.prepare('INSERT INTO ai_agents (id,name,description,agent_type,created_by,operated_by,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),'Discovery Agent','Autonomous trust discovery and evaluation agent - operated by ATL','discovery','test-user-001','$ORG_ATL','$DISCOVERY_AGENT',31337,'0x10','hybrid','deployed',ts());
db.prepare('INSERT INTO ai_agents (id,name,description,agent_type,created_by,operated_by,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),'Discovery TEE','TEE runtime environment for Discovery Agent','executor','test-user-001','$ORG_ATL','$DISCOVERY_TEE',31337,'0x11','hybrid','deployed',ts());
db.prepare('INSERT INTO ai_agents (id,name,description,agent_type,created_by,operated_by,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),'Validator Alpha','Activity validation for AI agents','validator','test-user-001',null,'$VALIDATOR_ALPHA',31337,'0x12','hybrid','deployed',ts());
db.prepare('INSERT INTO ai_agents (id,name,description,agent_type,created_by,operated_by,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),'Validator Beta','Activity validation and compliance','validator','test-user-001',null,'$VALIDATOR_BETA',31337,'0x13','hybrid','deployed',ts());

// Reviewer users
const dave = db.prepare(\"SELECT id FROM users WHERE name = 'Dave'\").get();
if (!dave) {
  db.prepare('INSERT INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(
    'test-user-004','dave@example.com','Dave','0x0000000000000000000000000000000000001004','did:privy:test-user-004',ts()
  );
}
const eve = db.prepare(\"SELECT id FROM users WHERE name = 'Eve'\").get();
if (!eve) {
  db.prepare('INSERT INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(
    'test-user-005','eve@example.com','Eve','0x0000000000000000000000000000000000001005','did:privy:test-user-005',ts()
  );
}
const frank = db.prepare(\"SELECT id FROM users WHERE name = 'Frank'\").get();
if (!frank) {
  db.prepare('INSERT INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(
    'test-user-006','frank@example.com','Frank','0x0000000000000000000000000000000000001006','did:privy:test-user-006',ts()
  );
}
db.prepare('INSERT INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(),'Dave Agent','test-user-004','$REVIEWER_DAVE',31337,'0x14','hybrid','deployed',ts());
db.prepare('INSERT INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(),'Eve Agent','test-user-005','$REVIEWER_EVE',31337,'0x15','hybrid','deployed',ts());
db.prepare('INSERT INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(),'Frank Agent','test-user-006','$REVIEWER_FRANK',31337,'0x16','hybrid','deployed',ts());

console.log('DB seeded: 6 person agents, 4 org agents, 6 AI agents');
"

echo ""
echo "=== Trust graph seeded ==="
echo "Agents: 16 total"
echo "  Person: Alice, Bob, Carol, Dave, Eve, Frank"
echo "  Org:    Agentic Trust Labs, DeFi Protocol DAO, InsureCo, StakePool"
echo "  AI:     TrustValidator, ATL TEE Runtime, Discovery Agent, Discovery TEE, Validator Alpha, Validator Beta"
echo "Edges: 28+ relationships across Governance, Membership, Alliance, Insurance, Economic Security, Service, Delegation, Runtime/TEE, Validation, Org Control, Activity Validation, Review"
echo "Issuers: 6 registered"
echo "Templates: 6 delegation templates"
