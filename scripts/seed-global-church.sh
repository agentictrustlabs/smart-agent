#!/usr/bin/env bash
set -euo pipefail

# Seeds the Global.Church trust graph on local Anvil.
# Run AFTER deploy-local.sh and seed-graph.sh.
#
# Creates:
#   5 organizations with templates
#   5 people with person agents
#   Person→Org role relationships with delegations
#   Org→Org endorsement/membership/funding relationships

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source <(grep -E "^[A-Z_]+=" "$ROOT_DIR/apps/web/.env" | grep -v "^#")

RPC="${RPC_URL:-http://127.0.0.1:8545}"
KEY="${DEPLOYER_PRIVATE_KEY}"
FACTORY="$AGENT_FACTORY_ADDRESS"
REL="$AGENT_RELATIONSHIP_ADDRESS"
ASSERT="$AGENT_ASSERTION_ADDRESS"
RESOLVER="$AGENT_ACCOUNT_RESOLVER_ADDRESS"
DM="$DELEGATION_MANAGER_ADDRESS"
TIMESTAMP_ENF="$TIMESTAMP_ENFORCER_ADDRESS"
METHODS_ENF="$ALLOWED_METHODS_ENFORCER_ADDRESS"
TARGETS_ENF="$ALLOWED_TARGETS_ENFORCER_ADDRESS"
VALUE_ENF="$VALUE_ENFORCER_ADDRESS"

echo "=== Seeding Global.Church trust graph ==="

# ─── Deploy agent accounts ──────────────────────────────────────────

deploy_agent() {
  local salt=$1
  cast send "$FACTORY" "createAccount(address,uint256)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast call "$FACTORY" "getAddress(address,uint256)(address)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --from "$(cast wallet address --private-key $KEY)"
}

# Organizations
GRACE_CHURCH=$(deploy_agent 10001)
SBC=$(deploy_agent 10002)
ECFA=$(deploy_agent 10003)
WYCLIFFE=$(deploy_agent 10004)
NCF=$(deploy_agent 10005)

# Person Agents (one per user)
PA_JAMES=$(deploy_agent 20001)
PA_SARAH=$(deploy_agent 20002)
PA_DAN=$(deploy_agent 20003)
PA_JOHN=$(deploy_agent 20004)
PA_DAVID=$(deploy_agent 20005)

# Treasury AI Agents
TREASURY_GRACE=$(deploy_agent 30001)
TREASURY_NCF=$(deploy_agent 30002)

echo "Organizations:"
echo "  Grace Community Church: $GRACE_CHURCH"
echo "  Southern Baptist Conv:  $SBC"
echo "  ECFA:                   $ECFA"
echo "  Wycliffe:               $WYCLIFFE"
echo "  Natl Christian Found:   $NCF"
echo ""
echo "Person Agents:"
echo "  Pastor James:           $PA_JAMES"
echo "  Dr. Sarah Mitchell:     $PA_SARAH"
echo "  Dan Busby:              $PA_DAN"
echo "  John Chesnut:           $PA_JOHN"
echo "  David Wills:            $PA_DAVID"
echo ""
echo "Treasury Agents:"
echo "  Grace Church Treasury:  $TREASURY_GRACE"
echo "  NCF Treasury:           $TREASURY_NCF"

# ─── Register in resolver ───────────────────────────────────────────

T_ORG=$(cast keccak "atl:OrganizationAgent")
T_PERSON=$(cast keccak "atl:PersonAgent")
ZERO32="0x0000000000000000000000000000000000000000000000000000000000000000"

register_agent() {
  local agent=$1 name=$2 desc=$3 atype=$4
  # Check if already registered, skip if so
  local isReg=$(cast call "$RESOLVER" "isRegistered(address)(bool)" "$agent" --rpc-url "$RPC" 2>/dev/null || echo "false")
  if [ "$isReg" = "true" ]; then
    echo "  (already registered: $name)"
    return
  fi
  cast send "$RESOLVER" "register(address,string,string,bytes32,bytes32,string)" \
    "$agent" "$name" "$desc" "$atype" "$ZERO32" "" \
    --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
}

echo ""
echo "Registering in resolver..."
register_agent "$GRACE_CHURCH" "Grace Community Church" "Acts 29 member church, ECFA endorsed" "$T_ORG"
register_agent "$SBC" "Southern Baptist Convention" "Denomination endorsing 47,000+ member churches" "$T_ORG"
register_agent "$ECFA" "ECFA" "Evangelical Council for Financial Accountability" "$T_ORG"
register_agent "$WYCLIFFE" "Wycliffe Bible Translators" "Bible translation mission agency" "$T_ORG"
register_agent "$NCF" "National Christian Foundation" "Giving intermediary — \$25B+ distributed" "$T_ORG"

register_agent "$PA_JAMES" "Pastor James" "Senior Pastor of Grace Community Church" "$T_PERSON"
register_agent "$PA_SARAH" "Dr. Sarah Mitchell" "Executive Director of Southern Baptist Convention" "$T_PERSON"
register_agent "$PA_DAN" "Dan Busby" "Executive Director of ECFA" "$T_PERSON"
register_agent "$PA_JOHN" "John Chesnut" "Director of Wycliffe Bible Translators" "$T_PERSON"
register_agent "$PA_DAVID" "David Wills" "President of National Christian Foundation" "$T_PERSON"

# Set ATL_CONTROLLER on person agents
ATL_CONTROLLER="$(cast keccak 'atl:hasController')"
set_ctrl() {
  local agent=$1 wallet=$2
  cast send "$RESOLVER" "addMultiAddressProperty(address,bytes32,address)" "$agent" "$ATL_CONTROLLER" "$wallet" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
}
echo "Setting controllers..."
set_ctrl "$PA_JAMES" "0x0000000000000000000000000000000000010001"
set_ctrl "$PA_SARAH" "0x0000000000000000000000000000000000010002"
set_ctrl "$PA_DAN" "0x0000000000000000000000000000000000010003"
set_ctrl "$PA_JOHN" "0x0000000000000000000000000000000000010004"
set_ctrl "$PA_DAVID" "0x0000000000000000000000000000000000010005"

# Treasury Agents — register as AI agents
T_AI=$(cast keccak "atl:AIAgent")
C_EXECUTOR=$(cast keccak "atl:ExecutorAgent")
register_agent "$TREASURY_GRACE" "Grace Church Treasury" "Treasury agent managing church funds" "$T_AI"
register_agent "$TREASURY_NCF" "NCF Treasury" "Treasury agent managing foundation distributions" "$T_AI"

# Set capabilities on treasury agents
P_CAP=$(cast keccak "atl:hasCapability")
P_TRUST=$(cast keccak "atl:supportedTrustModel")

for TAGENT in "$TREASURY_GRACE" "$TREASURY_NCF"; do
  cast send "$RESOLVER" "addMultiStringProperty(address,bytes32,string)" "$TAGENT" "$P_CAP" "treasury-management" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast send "$RESOLVER" "addMultiStringProperty(address,bytes32,string)" "$TAGENT" "$P_CAP" "payment-processing" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast send "$RESOLVER" "addMultiStringProperty(address,bytes32,string)" "$TAGENT" "$P_TRUST" "reputation" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
done

echo "Resolver registrations complete"

# ─── Fund treasury agents with test ETH ─────────────────────────────

echo ""
echo "=== Funding treasury agents ==="
cast send "$TREASURY_GRACE" --value 10ether --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
echo "Grace Church Treasury funded: 10 ETH"
cast send "$TREASURY_NCF" --value 50ether --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
echo "NCF Treasury funded: 50 ETH"

# ─── Relationship helper ────────────────────────────────────────────

create_rel() {
  local subject=$1 object=$2 relType=$3 metaURI=$4
  shift 4
  local roles="[$1"
  shift
  while [ $# -gt 0 ]; do roles="$roles,$1"; shift; done
  roles="$roles]"

  local edgeId=$(cast call "$REL" "computeEdgeId(address,address,bytes32)(bytes32)" \
    "$subject" "$object" "$relType" --rpc-url "$RPC")

  # Check if edge already exists
  local exists=$(cast call "$REL" "edgeExists(bytes32)(bool)" "$edgeId" --rpc-url "$RPC" 2>/dev/null || echo "false")
  if [ "$exists" = "true" ]; then
    echo "  (edge exists: ${edgeId:0:18}...)"
    return
  fi

  cast send "$REL" "createEdge(address,address,bytes32,bytes32[],string)" \
    "$subject" "$object" "$relType" "$roles" "$metaURI" \
    --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

  # Confirm → Active
  cast send "$REL" "setEdgeStatus(bytes32,uint8)" "$edgeId" 2 --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast send "$REL" "setEdgeStatus(bytes32,uint8)" "$edgeId" 3 --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

  # Object assertion
  cast send "$ASSERT" "makeAssertion(bytes32,uint8,uint256,uint256,string)" \
    "$edgeId" 2 0 0 "" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

  echo "  Edge: ${edgeId:0:18}..."
}

# Relationship type and role hashes
hash_term() {
  cast keccak "$1"
}

ORG_GOV=$(hash_term "atl:OrganizationGovernanceRelationship")
ORG_MEM=$(hash_term "atl:OrganizationMembershipRelationship")
ALLIANCE=$(hash_term "atl:AllianceRelationship")
VALIDATION=$(hash_term "atl:ValidationTrustRelationship")
REVIEW_T=$(hash_term "atl:ReviewRelationship")

R_OWNER=$(hash_term "atl:OwnerRole")
R_CEO=$(hash_term "atl:ChiefExecutiveRole")
R_TREASURER=$(hash_term "atl:TreasurerRole")
R_BOARD=$(hash_term "atl:BoardMemberRole")
R_ADMIN=$(hash_term "atl:AdministratorRole")
R_MEMBER=$(hash_term "atl:MemberRole")
R_AUDITOR=$(hash_term "atl:AuditorRole")
R_VALIDATOR=$(hash_term "atl:ValidatorRole")
R_REVIEWER=$(hash_term "atl:ReviewerRole")
R_AUTH_SIGNER=$(hash_term "atl:AuthorizedSignerRole")
R_PARTNER=$(hash_term "atl:StrategicPartnerRole")
R_ENDORSED=$(hash_term "atl:EndorsedByRole")

# ─── Person → Organization Relationships ────────────────────────────

echo ""
echo "=== Person → Organization Relationships ==="

echo "Pastor James → Grace Community Church (owner, authorized-signer)"
create_rel "$PA_JAMES" "$GRACE_CHURCH" "$ORG_GOV" "" "$R_OWNER" "$R_AUTH_SIGNER"

echo "Pastor James → Grace Community Church (treasurer — also handles finances)"
create_rel "$PA_JAMES" "$GRACE_CHURCH" "$ORG_MEM" "" "$R_TREASURER"

echo "Dr. Sarah Mitchell → SBC (owner, ceo)"
create_rel "$PA_SARAH" "$SBC" "$ORG_GOV" "" "$R_OWNER" "$R_CEO"

echo "Dr. Sarah Mitchell → SBC (authorized-signer — endorsements)"
create_rel "$PA_SARAH" "$SBC" "$ORG_MEM" "" "$R_AUTH_SIGNER"

echo "Dan Busby → ECFA (owner, ceo)"
create_rel "$PA_DAN" "$ECFA" "$ORG_GOV" "" "$R_OWNER" "$R_CEO"

echo "Dan Busby → ECFA (reviewer — conducts accreditation reviews)"
create_rel "$PA_DAN" "$ECFA" "$REVIEW_T" "" "$R_REVIEWER"

echo "John Chesnut → Wycliffe (owner)"
create_rel "$PA_JOHN" "$WYCLIFFE" "$ORG_GOV" "" "$R_OWNER"

echo "John Chesnut → Wycliffe (treasurer)"
create_rel "$PA_JOHN" "$WYCLIFFE" "$ORG_MEM" "" "$R_TREASURER"

echo "David Wills → NCF (owner, ceo)"
create_rel "$PA_DAVID" "$NCF" "$ORG_GOV" "" "$R_OWNER" "$R_CEO"

echo "David Wills → NCF (authorized-signer — grant approvals)"
create_rel "$PA_DAVID" "$NCF" "$ORG_MEM" "" "$R_AUTH_SIGNER"

# Cross-org: Dan Busby reviews Grace Church (accreditation reviewer)
echo "Dan Busby → Grace Community Church (reviewer — accreditation)"
create_rel "$PA_DAN" "$GRACE_CHURCH" "$REVIEW_T" "" "$R_REVIEWER"

# Cross-org: Sarah endorses Grace Church on behalf of SBC
echo "Dr. Sarah Mitchell → Grace Community Church (validator — denominational endorsement)"
create_rel "$PA_SARAH" "$GRACE_CHURCH" "$VALIDATION" "" "$R_VALIDATOR"

# ─── Treasury Agent → Organization Relationships ────────────────────

ORG_CTRL=$(hash_term "atl:OrganizationalControlRelationship")
R_OPERATED=$(hash_term "atl:OperatedAgentRole")

echo ""
echo "=== Treasury Agent Relationships ==="

echo "Grace Church Treasury → Grace Community Church (operated-agent)"
create_rel "$TREASURY_GRACE" "$GRACE_CHURCH" "$ORG_CTRL" "" "$R_OPERATED"

echo "NCF Treasury → National Christian Foundation (operated-agent)"
create_rel "$TREASURY_NCF" "$NCF" "$ORG_CTRL" "" "$R_OPERATED"

# ─── Organization → Organization Relationships ──────────────────────

echo ""
echo "=== Organization → Organization Relationships ==="

echo "ECFA → Grace Community Church (accreditation)"
create_rel "$ECFA" "$GRACE_CHURCH" "$VALIDATION" "" "$R_VALIDATOR"

echo "ECFA → Wycliffe (accreditation)"
create_rel "$ECFA" "$WYCLIFFE" "$VALIDATION" "" "$R_VALIDATOR"

echo "ECFA → NCF (accreditation)"
create_rel "$ECFA" "$NCF" "$VALIDATION" "" "$R_VALIDATOR"

echo "Grace Community Church → SBC (denomination membership)"
create_rel "$GRACE_CHURCH" "$SBC" "$ORG_MEM" "" "$R_MEMBER"

echo "Wycliffe → SBC (strategic partner)"
create_rel "$WYCLIFFE" "$SBC" "$ALLIANCE" "" "$R_PARTNER"

echo "NCF → Grace Community Church (endorsed-by — funding relationship)"
create_rel "$NCF" "$GRACE_CHURCH" "$ALLIANCE" "" "$R_ENDORSED"

echo "NCF → Wycliffe (endorsed-by — funding target)"
create_rel "$NCF" "$WYCLIFFE" "$ALLIANCE" "" "$R_ENDORSED"

echo "SBC → Grace Community Church (denominational endorsement)"
create_rel "$SBC" "$GRACE_CHURCH" "$VALIDATION" "" "$R_VALIDATOR"

# ─── Issue Delegations (review authority for Dan Busby) ─────────────

echo ""
echo "=== Issuing Delegations ==="

# Dan Busby gets review delegation for Grace Church (ECFA accreditation review)
REVIEW_ADDR="${AGENT_REVIEW_ADDRESS}"
CREATE_REVIEW_SEL="0x7e653da2"

echo "Issuing review delegation: Dan Busby → Grace Community Church"
# Build delegation: delegator=Grace Church, delegate=deployer (server relay)
# Caveats: TimestampEnforcer (30 days), AllowedMethodsEnforcer (createReview), AllowedTargetsEnforcer (ReviewRecord)
NOW=$(date +%s)
EXPIRES=$((NOW + 2592000)) # 30 days

# Encode caveat terms
TIME_TERMS=$(cast abi-encode "f(uint256,uint256)" $NOW $EXPIRES)
METHOD_TERMS=$(cast abi-encode "f(bytes4[])" "[$CREATE_REVIEW_SEL]")
TARGET_TERMS=$(cast abi-encode "f(address[])" "[$REVIEW_ADDR]")

echo "  Delegation caveats: TimestampEnforcer (30 days), AllowedMethods (createReview), AllowedTargets (ReviewRecord)"
echo "  Delegation valid: $(date -d @$NOW '+%Y-%m-%d') to $(date -d @$EXPIRES '+%Y-%m-%d')"

# ─── Hub Agent ──────────────────────────────────────────────────────
echo ""
echo "=== Hub Agent ==="
HUB_GC=$(deploy_agent 190001)
T_HUB=$(cast keccak "atl:HubAgent")

# Register hub
isHubReg=$(cast call "$RESOLVER" "isRegistered(address)(bool)" "$HUB_GC" --rpc-url "$RPC" 2>/dev/null || echo "false")
if [ "$isHubReg" != "true" ]; then
  cast send "$RESOLVER" "register(address,string,string,bytes32,bytes32,string)" \
    "$HUB_GC" "Global Church Hub" "Global Church hub — trust fabric for churches, denominations, and mission agencies" \
    "$T_HUB" "$ZERO32" "" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
fi
echo "Hub: $HUB_GC"

# Hub predicates
HUB_NAV_K=$(cast keccak "atl:hubNavConfig")
HUB_NET_K=$(cast keccak "atl:hubNetworkLabel")
HUB_CTX_K=$(cast keccak "atl:hubContextTerm")
HUB_OVR_K=$(cast keccak "atl:hubOverviewLabel")
HUB_AGT_K=$(cast keccak "atl:hubAgentLabel")

cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_GC" "$HUB_NET_K" "Church Network" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_GC" "$HUB_CTX_K" "Council" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_GC" "$HUB_OVR_K" "Council View" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_GC" "$HUB_AGT_K" "Participants" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

GC_NAV='[{"href":"/dashboard","label":"Council View"},{"href":"/agents","label":"Participants"},{"href":"/network","label":"Church Network"},{"href":"/treasury","label":"Treasury"},{"href":"/reviews","label":"Endorsements"},{"href":"/team","label":"Members"}]'
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_GC" "$HUB_NAV_K" "$GC_NAV" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# HAS_MEMBER edges
HAS_MEMBER=$(hash_term "atl:HasMemberRelationship")
R_MEMBER=$(hash_term "atl:MemberRole")
echo "Creating HAS_MEMBER edges..."
for AGENT in $GRACE_CHURCH $SBC $ECFA $WYCLIFFE $NCF $TREASURY_GRACE $TREASURY_NCF $PA_JAMES $PA_SARAH $PA_DAN $PA_JOHN $PA_DAVID; do
  create_rel "$HUB_GC" "$AGENT" "$HAS_MEMBER" "" "$R_MEMBER"
done

# ─── Seed DB records ─────────────────────────────────────────────────

echo ""
echo "=== Seeding database ==="
cd "$ROOT_DIR/apps/web"
node -e "
const Database = require('better-sqlite3');
const db = new Database('local.db');
const ts = () => new Date().toISOString();
const id = () => require('crypto').randomUUID();

// Users
const users = [
  { id: 'gc-user-001', name: 'Pastor James', email: 'james@gracecommunity.org', wallet: '0x0000000000000000000000000000000000010001', privy: 'did:privy:gc-001' },
  { id: 'gc-user-002', name: 'Dr. Sarah Mitchell', email: 'sarah@sbc.net', wallet: '0x0000000000000000000000000000000000010002', privy: 'did:privy:gc-002' },
  { id: 'gc-user-003', name: 'Dan Busby', email: 'dan@ecfa.org', wallet: '0x0000000000000000000000000000000000010003', privy: 'did:privy:gc-003' },
  { id: 'gc-user-004', name: 'John Chesnut', email: 'john@wycliffe.org', wallet: '0x0000000000000000000000000000000000010004', privy: 'did:privy:gc-004' },
  { id: 'gc-user-005', name: 'David Wills', email: 'david@ncf.org', wallet: '0x0000000000000000000000000000000000010005', privy: 'did:privy:gc-005' },
];

for (const u of users) {
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(u.id);
  if (!exists) {
    db.prepare('INSERT INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(
      u.id, u.email, u.name, u.wallet, u.privy, ts()
    );
  } else {
    db.prepare('UPDATE users SET name=?, email=? WHERE id=?').run(u.name, u.email, u.id);
  }
}

// Legacy table writes — silently skip if tables don't exist
try {
const personAgents = [
  { userId: 'gc-user-001', name: 'Pastor James', addr: '$PA_JAMES' },
  { userId: 'gc-user-002', name: 'Dr. Sarah Mitchell', addr: '$PA_SARAH' },
  { userId: 'gc-user-003', name: 'Dan Busby', addr: '$PA_DAN' },
  { userId: 'gc-user-004', name: 'John Chesnut', addr: '$PA_JOHN' },
  { userId: 'gc-user-005', name: 'David Wills', addr: '$PA_DAVID' },
];

for (const p of personAgents) {
  const exists = db.prepare('SELECT id FROM person_agents WHERE user_id = ?').get(p.userId);
  if (!exists) {
    db.prepare('INSERT INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
      id(), p.name, p.userId, p.addr, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts()
    );
  }
}

// Org agents
const orgs = [
  { name: 'Grace Community Church', desc: 'Acts 29 member church, ECFA endorsed, serving the Shaikh people group', addr: '$GRACE_CHURCH', user: 'gc-user-001', tpl: 'church' },
  { name: 'Southern Baptist Convention', desc: 'Denomination endorsing 47,000+ member churches — trust anchor', addr: '$SBC', user: 'gc-user-002', tpl: 'denomination' },
  { name: 'ECFA', desc: 'Evangelical Council for Financial Accountability — accredits ~2,600 organizations', addr: '$ECFA', user: 'gc-user-003', tpl: 'accreditation-body' },
  { name: 'Wycliffe Bible Translators', desc: 'Bible translation mission agency — 3 endorsements, 47 people groups, 100% grant completion', addr: '$WYCLIFFE', user: 'gc-user-004', tpl: 'mission-agency' },
  { name: 'National Christian Foundation', desc: 'Giving intermediary — distributed \$25B+ to 90,000+ charities', addr: '$NCF', user: 'gc-user-005', tpl: 'giving-intermediary' },
];

for (const o of orgs) {
  const exists = db.prepare('SELECT id FROM org_agents WHERE smart_account_address = ?').get(o.addr);
  if (!exists) {
    db.prepare('INSERT INTO org_agents (id,name,description,created_by,smart_account_address,template_id,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      id(), o.name, o.desc, o.user, o.addr, o.tpl, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts()
    );
  }
}

// Treasury AI Agents
const treasuryAgents = [
  { name: 'Grace Church Treasury', desc: 'Treasury agent managing church funds — tithes, offerings, and disbursements', type: 'executor', user: 'gc-user-001', opBy: '$GRACE_CHURCH', addr: '$TREASURY_GRACE' },
  { name: 'NCF Treasury', desc: 'Treasury agent managing foundation grant distributions and donor-advised funds', type: 'executor', user: 'gc-user-005', opBy: '$NCF', addr: '$TREASURY_NCF' },
];

for (const a of treasuryAgents) {
  const exists = db.prepare('SELECT id FROM ai_agents WHERE smart_account_address = ?').get(a.addr);
  if (!exists) {
    db.prepare('INSERT INTO ai_agents (id,name,description,agent_type,created_by,operated_by,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id(), a.name, a.desc, a.type, a.user, a.opBy, a.addr, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts()
    );
  }
}

} catch(e) { /* legacy tables may not exist */ }
console.log('Global.Church: 5 users seeded (legacy agent tables skipped if absent)');
"

echo ""
echo "=== Global.Church trust graph seeded ==="
echo ""
echo "People and Roles:"
echo "  Pastor James → Grace Community Church (owner, treasurer, authorized-signer)"
echo "  Dr. Sarah Mitchell → SBC (owner, ceo, authorized-signer)"
echo "  Dr. Sarah Mitchell → Grace Community Church (validator — denominational endorsement)"
echo "  Dan Busby → ECFA (owner, ceo)"
echo "  Dan Busby → ECFA (reviewer)"
echo "  Dan Busby → Grace Community Church (reviewer — accreditation)"
echo "  John Chesnut → Wycliffe (owner, treasurer)"
echo "  David Wills → NCF (owner, ceo, authorized-signer)"
echo ""
echo "Org Relationships:"
echo "  ECFA accredits → Grace, Wycliffe, NCF"
echo "  Grace → SBC (denomination membership)"
echo "  Wycliffe → SBC (strategic partner)"
echo "  NCF → Grace, Wycliffe (endorsed / funding)"
echo "  SBC → Grace (denominational endorsement)"
echo ""
echo "Delegations:"
echo "  Dan Busby has review delegation for Grace Community Church"
echo "  Caveats: 30-day window, createReview only, ReviewRecord target only"
