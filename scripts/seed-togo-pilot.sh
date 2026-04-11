#!/usr/bin/env bash
set -euo pipefail

# Seeds the Togo Revenue-Sharing Pilot — the actual field deployment
# This represents what the businesses and local staff would see

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source <(grep -E "^[A-Z_]+=" "$ROOT_DIR/apps/web/.env" | grep -v "^#")

RPC="${RPC_URL:-http://127.0.0.1:8545}"
KEY="${DEPLOYER_PRIVATE_KEY}"
FACTORY="$AGENT_FACTORY_ADDRESS"
REL="$AGENT_RELATIONSHIP_ADDRESS"
ASSERT="$AGENT_ASSERTION_ADDRESS"
RESOLVER="$AGENT_ACCOUNT_RESOLVER_ADDRESS"

echo "=== Seeding Togo Revenue-Sharing Pilot ==="

deploy_agent() {
  local salt=$1
  cast send "$FACTORY" "createAccount(address,uint256)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast call "$FACTORY" "getAddress(address,uint256)(address)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --from "$(cast wallet address --private-key $KEY)"
}

# Businesses (Wave 1 — 5 BDC graduates)
BIZ_KOFI=$(deploy_agent 80001)     # Coffee shop
BIZ_MAMA=$(deploy_agent 80002)     # Restaurant
BIZ_TECH=$(deploy_agent 80003)     # Phone repair
BIZ_COUD=$(deploy_agent 80004)     # Tailoring
BIZ_AGRI=$(deploy_agent 80005)     # Agriculture supply

# People
PA_KOFI=$(deploy_agent 90001)      # Kofi Adenu (coffee shop owner)
PA_AMA=$(deploy_agent 90002)       # Ama Lawson (restaurant owner)
PA_EDEM=$(deploy_agent 90003)      # Edem Togbi (phone repair)
PA_AKOS=$(deploy_agent 90004)      # Akosua Mensah (tailoring)
PA_YAO=$(deploy_agent 90005)       # Yao Agbeko (agriculture)
PA_ESSI=$(deploy_agent 90006)      # Essi Amegah (ILAD local coordinator)
PA_KOKOU=$(deploy_agent 90007)     # Kokou Abalo (BDC trainer)
PA_LAWRENCE=$(deploy_agent 90008)  # Lawrence (Training assessor)

echo "Businesses: Kofi=$BIZ_KOFI Mama=$BIZ_MAMA Tech=$BIZ_TECH Coud=$BIZ_COUD Agri=$BIZ_AGRI"

T_ORG=$(cast keccak "atl:OrganizationAgent")
T_PERSON=$(cast keccak "atl:PersonAgent")
ZERO32="0x0000000000000000000000000000000000000000000000000000000000000000"

register() {
  local agent=$1 name=$2 desc=$3 atype=$4
  local isReg=$(cast call "$RESOLVER" "isRegistered(address)(bool)" "$agent" --rpc-url "$RPC" 2>/dev/null || echo "false")
  if [ "$isReg" = "true" ]; then return; fi
  cast send "$RESOLVER" "register(address,string,string,bytes32,bytes32,string)" "$agent" "$name" "$desc" "$atype" "$ZERO32" "" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
}

echo "Registering..."
register "$BIZ_KOFI" "Café Lomé" "Artisan coffee and pastries — Tokoin market, Lomé" "$T_ORG"
register "$BIZ_MAMA" "Mama Afi Restaurant" "Traditional Togolese cuisine — Bè neighborhood" "$T_ORG"
register "$BIZ_TECH" "TechFix Lomé" "Mobile phone and electronics repair — Grand Marché" "$T_ORG"
register "$BIZ_COUD" "Couture d'Or" "Bespoke tailoring and fashion — Adawlato" "$T_ORG"
register "$BIZ_AGRI" "AgriPlus Togo" "Agricultural supplies and seeds — Agoè district" "$T_ORG"

register "$PA_KOFI" "Kofi Adenu" "Owner — Café Lomé (BDC Class 2025)" "$T_PERSON"
register "$PA_AMA" "Ama Lawson" "Owner — Mama Afi Restaurant (BDC Class 2025)" "$T_PERSON"
register "$PA_EDEM" "Edem Togbi" "Owner — TechFix Lomé (BDC Class 2024)" "$T_PERSON"
register "$PA_AKOS" "Akosua Mensah" "Owner — Couture d'Or (BDC Class 2025)" "$T_PERSON"
register "$PA_YAO" "Yao Agbeko" "Owner — AgriPlus Togo (BDC Class 2024)" "$T_PERSON"
register "$PA_ESSI" "Essi Amegah" "ILAD Local Coordinator — Lomé" "$T_PERSON"
register "$PA_KOKOU" "Kokou Abalo" "BDC Trainer — Business Development" "$T_PERSON"
register "$PA_LAWRENCE" "Lawrence" "Training Assessment Lead" "$T_PERSON"

# Relationships
create_rel() {
  local subject=$1 object=$2 relType=$3 metaURI=$4
  shift 4; local roles="[$1"; shift
  while [ $# -gt 0 ]; do roles="$roles,$1"; shift; done; roles="$roles]"
  local edgeId=$(cast call "$REL" "computeEdgeId(address,address,bytes32)(bytes32)" "$subject" "$object" "$relType" --rpc-url "$RPC")
  local exists=$(cast call "$REL" "edgeExists(bytes32)(bool)" "$edgeId" --rpc-url "$RPC" 2>/dev/null || echo "false")
  if [ "$exists" = "true" ]; then return; fi
  cast send "$REL" "createEdge(address,address,bytes32,bytes32[],string)" "$subject" "$object" "$relType" "$roles" "$metaURI" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast send "$REL" "setEdgeStatus(bytes32,uint8)" "$edgeId" 3 --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast send "$ASSERT" "makeAssertion(bytes32,uint8,uint256,uint256,string)" "$edgeId" 2 0 0 "" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  echo "  Edge created"
}

ORG_GOV=$(cast call "$REL" "ORGANIZATION_GOVERNANCE()(bytes32)" --rpc-url "$RPC")
ORG_MEM=$(cast call "$REL" "ORGANIZATION_MEMBERSHIP()(bytes32)" --rpc-url "$RPC")
R_OWNER=$(cast call "$REL" "ROLE_OWNER()(bytes32)" --rpc-url "$RPC")
R_MEMBER=$(cast call "$REL" "ROLE_MEMBER()(bytes32)" --rpc-url "$RPC")
R_ADVISOR=$(cast call "$REL" "ROLE_ADVISOR()(bytes32)" --rpc-url "$RPC")
R_REVIEWER=$(cast call "$REL" "ROLE_REVIEWER()(bytes32)" --rpc-url "$RPC")
REVIEW_T=$(cast call "$REL" "REVIEW_RELATIONSHIP()(bytes32)" --rpc-url "$RPC")

echo ""
echo "=== Business Owner Relationships ==="
echo "Kofi → Café Lomé (owner)"
create_rel "$PA_KOFI" "$BIZ_KOFI" "$ORG_GOV" "" "$R_OWNER"
echo "Ama → Mama Afi (owner)"
create_rel "$PA_AMA" "$BIZ_MAMA" "$ORG_GOV" "" "$R_OWNER"
echo "Edem → TechFix (owner)"
create_rel "$PA_EDEM" "$BIZ_TECH" "$ORG_GOV" "" "$R_OWNER"
echo "Akosua → Couture d'Or (owner)"
create_rel "$PA_AKOS" "$BIZ_COUD" "$ORG_GOV" "" "$R_OWNER"
echo "Yao → AgriPlus (owner)"
create_rel "$PA_YAO" "$BIZ_AGRI" "$ORG_GOV" "" "$R_OWNER"

echo ""
echo "=== Coaching Relationships ==="
echo "Kokou (trainer) → Café Lomé (advisor)"
create_rel "$PA_KOKOU" "$BIZ_KOFI" "$ORG_MEM" "" "$R_ADVISOR"
echo "Kokou → Mama Afi (advisor)"
create_rel "$PA_KOKOU" "$BIZ_MAMA" "$ORG_MEM" "" "$R_ADVISOR"
echo "Essi (coordinator) → TechFix (advisor)"
create_rel "$PA_ESSI" "$BIZ_TECH" "$ORG_MEM" "" "$R_ADVISOR"
echo "Essi → Couture d'Or (advisor)"
create_rel "$PA_ESSI" "$BIZ_COUD" "$ORG_MEM" "" "$R_ADVISOR"
echo "Essi → AgriPlus (advisor)"
create_rel "$PA_ESSI" "$BIZ_AGRI" "$ORG_MEM" "" "$R_ADVISOR"

echo ""
echo "=== Training Assessment ==="
echo "Lawrence → Café Lomé (reviewer)"
create_rel "$PA_LAWRENCE" "$BIZ_KOFI" "$REVIEW_T" "" "$R_REVIEWER"
echo "Lawrence → AgriPlus (reviewer)"
create_rel "$PA_LAWRENCE" "$BIZ_AGRI" "$REVIEW_T" "" "$R_REVIEWER"

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
  { id: 'tg-user-001', name: 'Kofi Adenu', email: 'kofi@cafelome.tg', wallet: '0x0000000000000000000000000000000000080001', privy: 'did:privy:tg-001' },
  { id: 'tg-user-002', name: 'Ama Lawson', email: 'ama@mamaafi.tg', wallet: '0x0000000000000000000000000000000000080002', privy: 'did:privy:tg-002' },
  { id: 'tg-user-003', name: 'Edem Togbi', email: 'edem@techfix.tg', wallet: '0x0000000000000000000000000000000000080003', privy: 'did:privy:tg-003' },
  { id: 'tg-user-004', name: 'Akosua Mensah', email: 'akosua@couturedior.tg', wallet: '0x0000000000000000000000000000000000080004', privy: 'did:privy:tg-004' },
  { id: 'tg-user-005', name: 'Yao Agbeko', email: 'yao@agriplus.tg', wallet: '0x0000000000000000000000000000000000080005', privy: 'did:privy:tg-005' },
  { id: 'tg-user-006', name: 'Essi Amegah', email: 'essi@ilad-togo.org', wallet: '0x0000000000000000000000000000000000080006', privy: 'did:privy:tg-006' },
  { id: 'tg-user-007', name: 'Kokou Abalo', email: 'kokou@ilad-togo.org', wallet: '0x0000000000000000000000000000000000080007', privy: 'did:privy:tg-007' },
  { id: 'tg-user-008', name: 'Lawrence', email: 'lawrence@ilad-togo.org', wallet: '0x0000000000000000000000000000000000080008', privy: 'did:privy:tg-008' },
];

for (const u of users) {
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(u.id);
  if (!exists) {
    db.prepare('INSERT INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(u.id, u.email, u.name, u.wallet, u.privy, ts());
  }
}

const personAgents = [
  { userId: 'tg-user-001', name: 'Kofi Adenu', addr: '$PA_KOFI' },
  { userId: 'tg-user-002', name: 'Ama Lawson', addr: '$PA_AMA' },
  { userId: 'tg-user-003', name: 'Edem Togbi', addr: '$PA_EDEM' },
  { userId: 'tg-user-004', name: 'Akosua Mensah', addr: '$PA_AKOS' },
  { userId: 'tg-user-005', name: 'Yao Agbeko', addr: '$PA_YAO' },
  { userId: 'tg-user-006', name: 'Essi Amegah', addr: '$PA_ESSI' },
  { userId: 'tg-user-007', name: 'Kokou Abalo', addr: '$PA_KOKOU' },
  { userId: 'tg-user-008', name: 'Lawrence', addr: '$PA_LAWRENCE' },
];

for (const p of personAgents) {
  const exists = db.prepare('SELECT id FROM person_agents WHERE user_id = ?').get(p.userId);
  if (!exists) {
    db.prepare('INSERT INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), p.name, p.userId, p.addr, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
  }
}

const orgs = [
  { name: 'Café Lomé', desc: 'Artisan coffee and pastries — Tokoin market, Lomé (BDC Wave 1)', addr: '$BIZ_KOFI', user: 'tg-user-001', tpl: 'portfolio-business' },
  { name: 'Mama Afi Restaurant', desc: 'Traditional Togolese cuisine — Bè neighborhood (BDC Wave 1)', addr: '$BIZ_MAMA', user: 'tg-user-002', tpl: 'portfolio-business' },
  { name: 'TechFix Lomé', desc: 'Mobile phone and electronics repair — Grand Marché (BDC Wave 1)', addr: '$BIZ_TECH', user: 'tg-user-003', tpl: 'portfolio-business' },
  { name: 'Couture d Or', desc: 'Bespoke tailoring and fashion — Adawlato (BDC Wave 1)', addr: '$BIZ_COUD', user: 'tg-user-004', tpl: 'portfolio-business' },
  { name: 'AgriPlus Togo', desc: 'Agricultural supplies and seeds — Agoè district (BDC Wave 1)', addr: '$BIZ_AGRI', user: 'tg-user-005', tpl: 'portfolio-business' },
];

for (const o of orgs) {
  const exists = db.prepare('SELECT id FROM org_agents WHERE smart_account_address = ?').get(o.addr);
  if (!exists) {
    db.prepare('INSERT INTO org_agents (id,name,description,created_by,smart_account_address,template_id,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id(), o.name, o.desc, o.user, o.addr, o.tpl, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
  }
}

console.log('Togo Pilot: 8 users, 5 businesses seeded');
"

echo ""
echo "=== Togo Pilot seeded ==="
echo "  Businesses (Wave 1):"
echo "    Café Lomé — Kofi Adenu"
echo "    Mama Afi Restaurant — Ama Lawson"
echo "    TechFix Lomé — Edem Togbi"
echo "    Couture d'Or — Akosua Mensah"
echo "    AgriPlus Togo — Yao Agbeko"
echo "  Field Staff:"
echo "    Essi Amegah — Local Coordinator"
echo "    Kokou Abalo — BDC Trainer"
echo "    Lawrence — Training Assessor"
