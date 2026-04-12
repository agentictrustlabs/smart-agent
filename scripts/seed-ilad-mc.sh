#!/usr/bin/env bash
set -euo pipefail

# Seeds the ILAD Mission Collective demo environment
# Run AFTER deploy-local.sh and seed-graph.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source <(grep -E "^[A-Z_]+=" "$ROOT_DIR/apps/web/.env" | grep -v "^#")

RPC="${RPC_URL:-http://127.0.0.1:8545}"
KEY="${DEPLOYER_PRIVATE_KEY}"
FACTORY="$AGENT_FACTORY_ADDRESS"
REL="$AGENT_RELATIONSHIP_ADDRESS"
ASSERT="$AGENT_ASSERTION_ADDRESS"
RESOLVER="$AGENT_ACCOUNT_RESOLVER_ADDRESS"

echo "=== Seeding ILAD Mission Collective ==="

deploy_agent() {
  local salt=$1
  cast send "$FACTORY" "createAccount(address,uint256)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast call "$FACTORY" "getAddress(address,uint256)(address)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --from "$(cast wallet address --private-key $KEY)"
}

# Organizations
CIL=$(deploy_agent 50001)
ILAD=$(deploy_agent 50002)
OOC=$(deploy_agent 50003)
BIZ_TOGOKAFE=$(deploy_agent 50004)
BIZ_SAVONAFRIQ=$(deploy_agent 50005)

# AI Agents
TREASURY_CIL=$(deploy_agent 60001)
ANALYTICS_CIL=$(deploy_agent 60002)
TRAINER_ILAD=$(deploy_agent 60003)

# Person Agents
PA_JOHN=$(deploy_agent 70001)      # John (CIL Managing Director)
PA_CAMERON=$(deploy_agent 70002)   # Cameron Henrion (ILAD Ops)
PA_NICK=$(deploy_agent 70003)      # Nick Courchesne (ILAD Ops)
PA_JOSEPH=$(deploy_agent 70004)    # Joseph (Local Manager, Togo)
PA_PAUL=$(deploy_agent 70005)      # Paul Martel (Funder)
PA_ADAMA=$(deploy_agent 70006)     # Adama Mensah (Business Owner - TogoKafe)
PA_FATOU=$(deploy_agent 70007)     # Fatou Amegah (Business Owner - SavonAfriq)

echo "Organizations: CIL=$CIL ILAD=$ILAD OOC=$OOC"
echo "Businesses: TogoKafe=$BIZ_TOGOKAFE SavonAfriq=$BIZ_SAVONAFRIQ"
echo "Treasury: CIL=$TREASURY_CIL Analytics=$ANALYTICS_CIL Trainer=$TRAINER_ILAD"

# Register in resolver
T_ORG=$(cast keccak "atl:OrganizationAgent")
T_PERSON=$(cast keccak "atl:PersonAgent")
T_AI=$(cast keccak "atl:AIAgent")
ZERO32="0x0000000000000000000000000000000000000000000000000000000000000000"

register() {
  local agent=$1 name=$2 desc=$3 atype=$4
  local isReg=$(cast call "$RESOLVER" "isRegistered(address)(bool)" "$agent" --rpc-url "$RPC" 2>/dev/null || echo "false")
  if [ "$isReg" = "true" ]; then return; fi
  cast send "$RESOLVER" "register(address,string,string,bytes32,bytes32,string)" "$agent" "$name" "$desc" "$atype" "$ZERO32" "" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
}

echo "Registering agents..."
register "$CIL" "Collective Impact Labs" "Revenue-sharing capital deployment for emerging markets" "$T_ORG"
register "$ILAD" "ILAD Togo" "Business Development Center — training and field operations" "$T_ORG"
register "$OOC" "Oversight Committee" "Quarterly governance review and accountability" "$T_ORG"
register "$BIZ_TOGOKAFE" "TogoKafe" "Artisan coffee roasting — Lomé, Togo (Wave 1)" "$T_ORG"
register "$BIZ_SAVONAFRIQ" "SavonAfriq" "Natural soap production — Lomé, Togo (Wave 1)" "$T_ORG"

register "$TREASURY_CIL" "CIL Treasury" "Capital pool management and revenue collection" "$T_AI"
register "$ANALYTICS_CIL" "Portfolio Analytics" "Business health monitoring and funder reporting" "$T_AI"
register "$TRAINER_ILAD" "Training Tracker" "BDC training completion and certification tracking" "$T_AI"

register "$PA_JOHN" "John" "CIL Managing Director" "$T_PERSON"
register "$PA_CAMERON" "Cameron Henrion" "ILAD Operations Lead" "$T_PERSON"
register "$PA_NICK" "Nick Courchesne" "ILAD Operations" "$T_PERSON"
register "$PA_JOSEPH" "Joseph" "Local Manager — Lomé, Togo" "$T_PERSON"
register "$PA_PAUL" "Paul Martel" "Funder / Impact Investor" "$T_PERSON"
register "$PA_ADAMA" "Adama Mensah" "Business Owner — TogoKafe" "$T_PERSON"
register "$PA_FATOU" "Fatou Amegah" "Business Owner — SavonAfriq" "$T_PERSON"

# Set ATL_CONTROLLER on person agents
ATL_CONTROLLER="$(cast keccak 'atl:hasController')"
set_ctrl() {
  local agent=$1 wallet=$2
  cast send "$RESOLVER" "addMultiAddressProperty(address,bytes32,address)" "$agent" "$ATL_CONTROLLER" "$wallet" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
}
echo "Setting controllers..."
set_ctrl "$PA_JOHN" "0x0000000000000000000000000000000000050001"
set_ctrl "$PA_CAMERON" "0x0000000000000000000000000000000000050002"
set_ctrl "$PA_NICK" "0x0000000000000000000000000000000000050003"
set_ctrl "$PA_JOSEPH" "0x0000000000000000000000000000000000050004"
set_ctrl "$PA_PAUL" "0x0000000000000000000000000000000000050005"
set_ctrl "$PA_ADAMA" "0x0000000000000000000000000000000000050006"
set_ctrl "$PA_FATOU" "0x0000000000000000000000000000000000050007"

# Fund treasury
echo "Funding treasury..."
cast send "$TREASURY_CIL" --value 25ether --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
echo "CIL Treasury funded: 25 ETH"

# Relationships
create_rel() {
  local subject=$1 object=$2 relType=$3 metaURI=$4
  shift 4; local roles="[$1"; shift
  while [ $# -gt 0 ]; do roles="$roles,$1"; shift; done; roles="$roles]"
  local edgeId=$(cast call "$REL" "computeEdgeId(address,address,bytes32)(bytes32)" "$subject" "$object" "$relType" --rpc-url "$RPC")
  local exists=$(cast call "$REL" "edgeExists(bytes32)(bool)" "$edgeId" --rpc-url "$RPC" 2>/dev/null || echo "false")
  if [ "$exists" = "true" ]; then echo "  (exists)"; return; fi
  cast send "$REL" "createEdge(address,address,bytes32,bytes32[],string)" "$subject" "$object" "$relType" "$roles" "$metaURI" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast send "$REL" "setEdgeStatus(bytes32,uint8)" "$edgeId" 3 --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast send "$ASSERT" "makeAssertion(bytes32,uint8,uint256,uint256,string)" "$edgeId" 2 0 0 "" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  echo "  Edge: ${edgeId:0:18}..."
}

ORG_GOV=$(cast call "$REL" "ORGANIZATION_GOVERNANCE()(bytes32)" --rpc-url "$RPC")
ORG_MEM=$(cast call "$REL" "ORGANIZATION_MEMBERSHIP()(bytes32)" --rpc-url "$RPC")
ORG_CTRL=$(cast call "$REL" "ORGANIZATIONAL_CONTROL()(bytes32)" --rpc-url "$RPC")
ALLIANCE=$(cast call "$REL" "ALLIANCE()(bytes32)" --rpc-url "$RPC")
VALIDATION=$(cast call "$REL" "VALIDATION_TRUST()(bytes32)" --rpc-url "$RPC")
R_OWNER=$(cast call "$REL" "ROLE_OWNER()(bytes32)" --rpc-url "$RPC")
R_CEO=$(cast call "$REL" "ROLE_CEO()(bytes32)" --rpc-url "$RPC")
R_ADMIN=$(cast call "$REL" "ROLE_ADMIN()(bytes32)" --rpc-url "$RPC")
R_MEMBER=$(cast call "$REL" "ROLE_MEMBER()(bytes32)" --rpc-url "$RPC")
R_OPERATOR=$(cast call "$REL" "ROLE_OPERATOR()(bytes32)" --rpc-url "$RPC")
R_BOARD=$(cast call "$REL" "ROLE_BOARD_MEMBER()(bytes32)" --rpc-url "$RPC")
R_AUTH_SIGNER=$(cast call "$REL" "ROLE_AUTHORIZED_SIGNER()(bytes32)" --rpc-url "$RPC")
R_OPERATED=$(cast call "$REL" "ROLE_OPERATED_AGENT()(bytes32)" --rpc-url "$RPC")
R_PARTNER=$(cast call "$REL" "ROLE_STRATEGIC_PARTNER()(bytes32)" --rpc-url "$RPC")
R_AUDITOR=$(cast call "$REL" "ROLE_AUDITOR()(bytes32)" --rpc-url "$RPC")
R_ADVISOR=$(cast call "$REL" "ROLE_ADVISOR()(bytes32)" --rpc-url "$RPC")
R_VALIDATOR=$(cast call "$REL" "ROLE_VALIDATOR()(bytes32)" --rpc-url "$RPC")

echo ""
echo "=== Person → Org Relationships ==="

echo "John → CIL (owner, ceo, authorized-signer)"
create_rel "$PA_JOHN" "$CIL" "$ORG_GOV" "" "$R_OWNER" "$R_CEO" "$R_AUTH_SIGNER"

echo "Cameron → ILAD (owner, operator)"
create_rel "$PA_CAMERON" "$ILAD" "$ORG_GOV" "" "$R_OWNER"
create_rel "$PA_CAMERON" "$ILAD" "$ORG_MEM" "" "$R_OPERATOR"

echo "Nick → ILAD (operator)"
create_rel "$PA_NICK" "$ILAD" "$ORG_MEM" "" "$R_OPERATOR"

echo "Joseph → ILAD (member — local manager)"
create_rel "$PA_JOSEPH" "$ILAD" "$ORG_MEM" "" "$R_MEMBER"

echo "Paul Martel → CIL (advisor — funder)"
create_rel "$PA_PAUL" "$CIL" "$ORG_GOV" "" "$R_ADVISOR"

echo "Adama → TogoKafe (owner)"
create_rel "$PA_ADAMA" "$BIZ_TOGOKAFE" "$ORG_GOV" "" "$R_OWNER"

echo "Fatou → SavonAfriq (owner)"
create_rel "$PA_FATOU" "$BIZ_SAVONAFRIQ" "$ORG_GOV" "" "$R_OWNER"

echo "John → OOC (board-member, chair)"
create_rel "$PA_JOHN" "$OOC" "$ORG_GOV" "" "$R_BOARD" "$R_OWNER"

echo "Cameron → OOC (board-member)"
create_rel "$PA_CAMERON" "$OOC" "$ORG_GOV" "" "$R_BOARD"

echo "Paul → OOC (board-member)"
create_rel "$PA_PAUL" "$OOC" "$ORG_GOV" "" "$R_BOARD"

echo ""
echo "=== AI Agent → Org Relationships ==="

echo "CIL Treasury → CIL (operated-agent)"
create_rel "$TREASURY_CIL" "$CIL" "$ORG_CTRL" "" "$R_OPERATED"

echo "Portfolio Analytics → CIL (operated-agent)"
create_rel "$ANALYTICS_CIL" "$CIL" "$ORG_CTRL" "" "$R_OPERATED"

echo "Training Tracker → ILAD (operated-agent)"
create_rel "$TRAINER_ILAD" "$ILAD" "$ORG_CTRL" "" "$R_OPERATED"

echo ""
echo "=== Org → Org Relationships ==="

echo "CIL → ILAD (strategic partner)"
create_rel "$CIL" "$ILAD" "$ALLIANCE" "" "$R_PARTNER"

echo "CIL → TogoKafe (capital — revenue-sharing)"
create_rel "$CIL" "$BIZ_TOGOKAFE" "$VALIDATION" "" "$R_VALIDATOR"

echo "CIL → SavonAfriq (capital — revenue-sharing)"
create_rel "$CIL" "$BIZ_SAVONAFRIQ" "$VALIDATION" "" "$R_VALIDATOR"

echo "ILAD → TogoKafe (training provider)"
create_rel "$ILAD" "$BIZ_TOGOKAFE" "$ALLIANCE" "" "$R_PARTNER"

echo "ILAD → SavonAfriq (training provider)"
create_rel "$ILAD" "$BIZ_SAVONAFRIQ" "$ALLIANCE" "" "$R_PARTNER"

echo "OOC → CIL (governance oversight)"
create_rel "$OOC" "$CIL" "$VALIDATION" "" "$R_VALIDATOR"

# Seed DB
echo ""
echo "=== Seeding database ==="
cd "$ROOT_DIR/apps/web"
node -e "
const Database = require('better-sqlite3');
const db = new Database('local.db');
const ts = () => new Date().toISOString();
const id = () => require('crypto').randomUUID();

const users = [
  { id: 'mc-user-001', name: 'John', email: 'john@collectiveimpactlabs.org', wallet: '0x0000000000000000000000000000000000050001', privy: 'did:privy:mc-001' },
  { id: 'mc-user-002', name: 'Cameron Henrion', email: 'cameron@ilad.org', wallet: '0x0000000000000000000000000000000000050002', privy: 'did:privy:mc-002' },
  { id: 'mc-user-003', name: 'Nick Courchesne', email: 'nick@ilad.org', wallet: '0x0000000000000000000000000000000000050003', privy: 'did:privy:mc-003' },
  { id: 'mc-user-004', name: 'Joseph', email: 'joseph@ilad-togo.org', wallet: '0x0000000000000000000000000000000000050004', privy: 'did:privy:mc-004' },
  { id: 'mc-user-005', name: 'Paul Martel', email: 'paul@funder.org', wallet: '0x0000000000000000000000000000000000050005', privy: 'did:privy:mc-005' },
  { id: 'mc-user-006', name: 'Adama Mensah', email: 'adama@togokafe.tg', wallet: '0x0000000000000000000000000000000000050006', privy: 'did:privy:mc-006' },
  { id: 'mc-user-007', name: 'Fatou Amegah', email: 'fatou@savonafriq.tg', wallet: '0x0000000000000000000000000000000000050007', privy: 'did:privy:mc-007' },
];

for (const u of users) {
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(u.id);
  if (!exists) {
    db.prepare('INSERT INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(u.id, u.email, u.name, u.wallet, u.privy, ts());
  }
}

const personAgents = [
  { userId: 'mc-user-001', name: 'John', addr: '$PA_JOHN' },
  { userId: 'mc-user-002', name: 'Cameron Henrion', addr: '$PA_CAMERON' },
  { userId: 'mc-user-003', name: 'Nick Courchesne', addr: '$PA_NICK' },
  { userId: 'mc-user-004', name: 'Joseph', addr: '$PA_JOSEPH' },
  { userId: 'mc-user-005', name: 'Paul Martel', addr: '$PA_PAUL' },
  { userId: 'mc-user-006', name: 'Adama Mensah', addr: '$PA_ADAMA' },
  { userId: 'mc-user-007', name: 'Fatou Amegah', addr: '$PA_FATOU' },
];

for (const p of personAgents) {
  const exists = db.prepare('SELECT id FROM person_agents WHERE user_id = ?').get(p.userId);
  if (!exists) {
    db.prepare('INSERT INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), p.name, p.userId, p.addr, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
  }
}

const orgs = [
  { name: 'Collective Impact Labs', desc: 'Revenue-sharing capital deployment for emerging market businesses', addr: '$CIL', user: 'mc-user-001', tpl: 'impact-investor' },
  { name: 'ILAD Togo', desc: 'Business Development Center — training 80+ graduates in Lomé', addr: '$ILAD', user: 'mc-user-002', tpl: 'field-agency' },
  { name: 'Oversight Committee', desc: 'Quarterly governance review for the Togo pilot', addr: '$OOC', user: 'mc-user-001', tpl: 'oversight-committee' },
  { name: 'TogoKafe', desc: 'Artisan coffee roasting — Lomé, Togo (BDC graduate, Wave 1)', addr: '$BIZ_TOGOKAFE', user: 'mc-user-006', tpl: 'portfolio-business' },
  { name: 'SavonAfriq', desc: 'Natural soap production — Lomé, Togo (BDC graduate, Wave 1)', addr: '$BIZ_SAVONAFRIQ', user: 'mc-user-007', tpl: 'portfolio-business' },
];

for (const o of orgs) {
  const exists = db.prepare('SELECT id FROM org_agents WHERE smart_account_address = ?').get(o.addr);
  if (!exists) {
    db.prepare('INSERT INTO org_agents (id,name,description,created_by,smart_account_address,template_id,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id(), o.name, o.desc, o.user, o.addr, o.tpl, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
  }
}

const aiAgents = [
  { name: 'CIL Treasury', desc: 'Capital pool management — deployment, collection, recovery', type: 'executor', user: 'mc-user-001', opBy: '$CIL', addr: '$TREASURY_CIL' },
  { name: 'Portfolio Analytics', desc: 'Business health monitoring, wave progression, funder projections', type: 'discovery', user: 'mc-user-001', opBy: '$CIL', addr: '$ANALYTICS_CIL' },
  { name: 'Training Tracker', desc: 'BDC training completion, certification, performance correlation', type: 'validator', user: 'mc-user-002', opBy: '$ILAD', addr: '$TRAINER_ILAD' },
];

for (const a of aiAgents) {
  const exists = db.prepare('SELECT id FROM ai_agents WHERE smart_account_address = ?').get(a.addr);
  if (!exists) {
    db.prepare('INSERT INTO ai_agents (id,name,description,agent_type,created_by,operated_by,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(), a.name, a.desc, a.type, a.user, a.opBy, a.addr, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
  }
}

console.log('ILAD MC: 7 users, 5 orgs, 3 AI agents seeded');
"

echo ""
echo "=== ILAD Mission Collective seeded ==="
echo "  CIL (Impact Investor) — John (MD), Paul (Funder/Advisor)"
echo "  ILAD Togo (Field Agency) — Cameron (Ops Lead), Nick (Ops), Joseph (Local Mgr)"
echo "  OOC (Oversight) — John (Chair), Cameron, Paul (Members)"
echo "  TogoKafe — Adama Mensah (Owner)"
echo "  SavonAfriq — Fatou Amegah (Owner)"
echo "  AI: CIL Treasury (25 ETH), Portfolio Analytics, Training Tracker"
