#!/usr/bin/env bash
set -euo pipefail

# Seeds the Collective Impact Labs demo — Ravah Capital Pilot in Togo
# Orgs: ILAD (operator), CIL (funder), Ravah Pilot (container), 3 businesses
# People: Cameron, Nick, Afia, Kossi, Yaw, John, Paul + Ama Tailoring Coop owner

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source <(grep -E "^[A-Z_]+=" "$ROOT_DIR/apps/web/.env" | grep -v "^#")

RPC="${RPC_URL:-http://127.0.0.1:8545}"
KEY="${DEPLOYER_PRIVATE_KEY}"
FACTORY="$AGENT_FACTORY_ADDRESS"
REL="$AGENT_RELATIONSHIP_ADDRESS"
ASSERT="$AGENT_ASSERTION_ADDRESS"
RESOLVER="$AGENT_ACCOUNT_RESOLVER_ADDRESS"

echo "=== Seeding Collective Impact Labs ==="

deploy_agent() {
  local salt=$1
  cast send "$FACTORY" "createAccount(address,uint256)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast call "$FACTORY" "getAddress(address,uint256)(address)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --from "$(cast wallet address --private-key $KEY)"
}

# ─── Deploy Agents ───────────────────────────────────────────────────
# Organizations
ILAD=$(deploy_agent 300001)
CIL=$(deploy_agent 300002)
PILOT=$(deploy_agent 300003)
BIZ_AFIA=$(deploy_agent 300004)
BIZ_KOSSI=$(deploy_agent 300005)
BIZ_AMA=$(deploy_agent 300006)

# AI Agent
TREASURY=$(deploy_agent 310001)

# Person Agents
PA_CAMERON=$(deploy_agent 320001)
PA_NICK=$(deploy_agent 320002)
PA_AFIA=$(deploy_agent 320003)
PA_KOSSI=$(deploy_agent 320004)
PA_YAW=$(deploy_agent 320005)
PA_JOHN=$(deploy_agent 320006)
PA_PAUL=$(deploy_agent 320007)

echo "Orgs: ILAD=$ILAD CIL=$CIL Pilot=$PILOT"
echo "Businesses: Afia=$BIZ_AFIA Kossi=$BIZ_KOSSI Ama=$BIZ_AMA"

# ─── Register in Resolver ────────────────────────────────────────────
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
register "$ILAD" "International Leadership and Development" "Local operator — business training, field ops, revenue validation (Togo)" "$T_ORG"
register "$CIL" "Collective Impact Labs" "Capital provider + platform sponsor — Ravah model, governance oversight" "$T_ORG"
register "$PILOT" "Ravah Capital Pilot" "Program container — Togo revenue-sharing pilot (Wave 1)" "$T_ORG"
register "$BIZ_AFIA" "Afia's Market" "Small retail shop — food staples, Lomé, Togo" "$T_ORG"
register "$BIZ_KOSSI" "Kossi Mobile Repairs" "Phone repair + resale, Lomé, Togo" "$T_ORG"
register "$BIZ_AMA" "Ama Tailoring Cooperative" "Women-led sewing group, Lomé, Togo" "$T_ORG"

register "$TREASURY" "CIL Treasury" "Capital pool management — deployment, collection, recovery" "$T_AI"

register "$PA_CAMERON" "Cameron Henrion" "Operations Lead — ILAD" "$T_PERSON"
register "$PA_NICK" "Nick Courchesne" "Reviewer — ILAD" "$T_PERSON"
register "$PA_AFIA" "Afia Mensah" "Business Owner — Afia's Market" "$T_PERSON"
register "$PA_KOSSI" "Kossi Agbeko" "Business Owner — Kossi Mobile Repairs" "$T_PERSON"
register "$PA_YAW" "Yaw" "Local Manager — ILAD field coordinator" "$T_PERSON"
register "$PA_JOHN" "John F. Kim" "Admin — Collective Impact Labs" "$T_PERSON"
register "$PA_PAUL" "Paul Martel" "Funder — Collective Impact Labs" "$T_PERSON"

# ─── Set ATL_CONTROLLER on person agents ─────────────────────────────
ATL_CONTROLLER="$(cast keccak 'atl:hasController')"
set_ctrl() {
  local agent=$1 wallet=$2
  cast send "$RESOLVER" "addMultiAddressProperty(address,bytes32,address)" "$agent" "$ATL_CONTROLLER" "$wallet" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
}
echo "Setting controllers..."
set_ctrl "$PA_CAMERON" "0x00000000000000000000000000000000000c0001"
set_ctrl "$PA_NICK" "0x00000000000000000000000000000000000c0002"
set_ctrl "$PA_AFIA" "0x00000000000000000000000000000000000c0003"
set_ctrl "$PA_KOSSI" "0x00000000000000000000000000000000000c0004"
set_ctrl "$PA_YAW" "0x00000000000000000000000000000000000c0005"
set_ctrl "$PA_JOHN" "0x00000000000000000000000000000000000c0006"
set_ctrl "$PA_PAUL" "0x00000000000000000000000000000000000c0007"

# ─── Geospatial (Lomé, Togo) ────────────────────────────────────────
ATL_LAT="$(cast keccak 'atl:latitude')"
ATL_LON="$(cast keccak 'atl:longitude')"
ATL_CRS="$(cast keccak 'atl:spatialCRS')"
ATL_TYPE="$(cast keccak 'atl:spatialType')"

set_geo() {
  local agent=$1 lat=$2 lon=$3
  cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$agent" "$ATL_LAT" "$lat" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$agent" "$ATL_LON" "$lon" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$agent" "$ATL_CRS" "EPSG:4326" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$agent" "$ATL_TYPE" "Point" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
}

echo "Setting geospatial..."
set_geo "$ILAD" "6.1725" "1.2314"          # Lomé central
set_geo "$CIL" "6.1750" "1.2280"           # Lomé
set_geo "$PILOT" "6.1700" "1.2350"         # Lomé
set_geo "$BIZ_AFIA" "6.1680" "1.2420"      # Tokoin market
set_geo "$BIZ_KOSSI" "6.1760" "1.2180"     # Grand Marché
set_geo "$BIZ_AMA" "6.1640" "1.2500"       # Bè neighborhood

# ─── Relationships ───────────────────────────────────────────────────
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
  echo "  Edge created"
}

hash_term() {
  cast keccak "$1"
}

ORG_GOV=$(hash_term "atl:OrganizationGovernanceRelationship")
ORG_MEM=$(hash_term "atl:OrganizationMembershipRelationship")
ORG_CTRL=$(hash_term "atl:OrganizationalControlRelationship")
ALLIANCE=$(hash_term "atl:AllianceRelationship")
VALIDATION=$(hash_term "atl:ValidationTrustRelationship")
R_OWNER=$(hash_term "atl:OwnerRole")
R_MEMBER=$(hash_term "atl:MemberRole")
R_OPERATOR=$(hash_term "atl:OperatorRole")
R_BOARD=$(hash_term "atl:BoardMemberRole")
R_ADVISOR=$(hash_term "atl:AdvisorRole")
R_OPERATED=$(hash_term "atl:OperatedAgentRole")
R_PARTNER=$(hash_term "atl:StrategicPartnerRole")
R_REVIEWER=$(hash_term "atl:ReviewerRole")
R_AUDITOR=$(hash_term "atl:AuditorRole")
R_VALIDATOR=$(hash_term "atl:ValidatorRole")

echo ""
echo "=== Person → Org Relationships ==="

echo "Cameron → ILAD (owner, ops lead)"
create_rel "$PA_CAMERON" "$ILAD" "$ORG_GOV" "" "$R_OWNER"
echo "Nick → ILAD (reviewer)"
create_rel "$PA_NICK" "$ILAD" "$ORG_MEM" "" "$R_REVIEWER"
echo "Yaw → ILAD (operator, local manager)"
create_rel "$PA_YAW" "$ILAD" "$ORG_MEM" "" "$R_OPERATOR"

echo "John → CIL (owner, admin)"
create_rel "$PA_JOHN" "$CIL" "$ORG_GOV" "" "$R_OWNER"
echo "Paul → CIL (board-member, funder)"
create_rel "$PA_PAUL" "$CIL" "$ORG_GOV" "" "$R_BOARD"

echo "Afia → Afia's Market (owner)"
create_rel "$PA_AFIA" "$BIZ_AFIA" "$ORG_GOV" "" "$R_OWNER"
echo "Kossi → Kossi Mobile Repairs (owner)"
create_rel "$PA_KOSSI" "$BIZ_KOSSI" "$ORG_GOV" "" "$R_OWNER"

echo "Cameron → Pilot (operator)"
create_rel "$PA_CAMERON" "$PILOT" "$ORG_MEM" "" "$R_OPERATOR"
echo "John → Pilot (owner)"
create_rel "$PA_JOHN" "$PILOT" "$ORG_GOV" "" "$R_OWNER"

echo "Yaw → Afia's Market (advisor, coach)"
create_rel "$PA_YAW" "$BIZ_AFIA" "$ORG_MEM" "" "$R_ADVISOR"
echo "Yaw → Kossi Mobile Repairs (advisor)"
create_rel "$PA_YAW" "$BIZ_KOSSI" "$ORG_MEM" "" "$R_ADVISOR"

echo ""
echo "=== Org → Org Relationships ==="

echo "ILAD ↔ CIL (strategic partner — operator ↔ capital provider)"
create_rel "$ILAD" "$CIL" "$ALLIANCE" "" "$R_PARTNER"
create_rel "$CIL" "$ILAD" "$ALLIANCE" "" "$R_PARTNER"

echo "CIL → Pilot (governance — capital provider funds pilot)"
create_rel "$CIL" "$PILOT" "$ORG_GOV" "" "$R_OWNER"

echo "ILAD → Pilot (operator of the pilot)"
create_rel "$ILAD" "$PILOT" "$ORG_MEM" "" "$R_OPERATOR"

echo "Pilot → Businesses (validation — capital deployed to businesses)"
create_rel "$PILOT" "$BIZ_AFIA" "$VALIDATION" "" "$R_VALIDATOR"
create_rel "$PILOT" "$BIZ_KOSSI" "$VALIDATION" "" "$R_VALIDATOR"
create_rel "$PILOT" "$BIZ_AMA" "$VALIDATION" "" "$R_VALIDATOR"

echo "ILAD → Businesses (training provider)"
create_rel "$ILAD" "$BIZ_AFIA" "$ALLIANCE" "" "$R_PARTNER"
create_rel "$ILAD" "$BIZ_KOSSI" "$ALLIANCE" "" "$R_PARTNER"
create_rel "$ILAD" "$BIZ_AMA" "$ALLIANCE" "" "$R_PARTNER"

echo ""
echo "=== AI Agent → Org ==="
echo "Treasury → CIL (operated agent)"
create_rel "$TREASURY" "$CIL" "$ORG_CTRL" "" "$R_OPERATED"

# ─── Hub Agent ──────────────────────────────────────────────────────
echo ""
echo "=== Hub Agent ==="
HUB_CIL=$(deploy_agent 390001)
T_HUB=$(cast keccak "atl:HubAgent")
register "$HUB_CIL" "CIL Hub" "Collective Impact Labs hub — revenue-sharing capital deployment with trust graph" "$T_HUB"
echo "Hub: $HUB_CIL"

# Set hub predicates
HUB_NAV=$(cast keccak "atl:hubNavConfig")
HUB_NET=$(cast keccak "atl:hubNetworkLabel")
HUB_CTX=$(cast keccak "atl:hubContextTerm")
HUB_OVR=$(cast keccak "atl:hubOverviewLabel")
HUB_AGT=$(cast keccak "atl:hubAgentLabel")

cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_CIL" "$HUB_NET" "Trust Network" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_CIL" "$HUB_CTX" "Operating Group" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_CIL" "$HUB_OVR" "Pilot View" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_CIL" "$HUB_AGT" "Participants" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

NAV_JSON='[{"href":"/dashboard","label":"Pilot View"},{"href":"/agents","label":"Participants"},{"href":"/network","label":"Trust Network"},{"href":"/activities","label":"Operations"},{"href":"/members","label":"Members"},{"href":"/reviews","label":"Assertions"},{"href":"/treasury","label":"Treasury"}]'
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_CIL" "$HUB_NAV" "$NAV_JSON" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# HAS_MEMBER edges: hub → all orgs, persons, and AI agents
HAS_MEMBER=$(hash_term "atl:HasMemberRelationship")
echo "Creating HAS_MEMBER edges..."
for AGENT in $ILAD $CIL $PILOT $BIZ_AFIA $BIZ_KOSSI $BIZ_AMA $TREASURY $PA_CAMERON $PA_NICK $PA_AFIA $PA_KOSSI $PA_YAW $PA_JOHN $PA_PAUL; do
  create_rel "$HUB_CIL" "$AGENT" "$HAS_MEMBER" "" "$R_MEMBER"
done

# ─── Fund Treasury ──────────────────────────────────────────────────
echo "Funding treasury..."
cast send "$TREASURY" --value 10ether --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
echo "Treasury funded: 10 ETH"

# ─── Seed DB (users only — agents are on-chain) ─────────────────────
echo ""
echo "=== Seeding database ==="
cd "$ROOT_DIR/apps/web"

node -e "
const Database = require('better-sqlite3');
const db = new Database('local.db');
const ts = () => new Date().toISOString();

// Run migrations
const fs = require('fs');
const path = require('path');
const migrDir = path.resolve(process.cwd(), 'drizzle');
if (fs.existsSync(migrDir)) {
  for (const file of fs.readdirSync(migrDir).filter(f => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(migrDir, file), 'utf-8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const lines = stmt.split('\n').filter(l => !l.trimStart().startsWith('--'));
      const cleaned = lines.join('\n').trim();
      if (cleaned && (cleaned.includes('CREATE') || cleaned.includes('ALTER'))) {
        const safe = cleaned.replace(/CREATE TABLE \x60/g, 'CREATE TABLE IF NOT EXISTS \x60')
          .replace(/CREATE UNIQUE INDEX \x60/g, 'CREATE UNIQUE INDEX IF NOT EXISTS \x60');
        try { db.prepare(safe).run(); } catch {}
      }
    }
  }
}

// Users (only DB table needed)
const users = [
  { id: 'cil-user-001', name: 'Cameron Henrion', email: 'cameron@ilad.org', wallet: '0x00000000000000000000000000000000000c0001', privy: 'did:privy:cil-001' },
  { id: 'cil-user-002', name: 'Nick Courchesne', email: 'nick@ilad.org', wallet: '0x00000000000000000000000000000000000c0002', privy: 'did:privy:cil-002' },
  { id: 'cil-user-003', name: 'Afia Mensah', email: 'afia@market.tg', wallet: '0x00000000000000000000000000000000000c0003', privy: 'did:privy:cil-003' },
  { id: 'cil-user-004', name: 'Kossi Agbeko', email: 'kossi@repairs.tg', wallet: '0x00000000000000000000000000000000000c0004', privy: 'did:privy:cil-004' },
  { id: 'cil-user-005', name: 'Yaw', email: 'yaw@ilad-togo.org', wallet: '0x00000000000000000000000000000000000c0005', privy: 'did:privy:cil-005' },
  { id: 'cil-user-006', name: 'John F. Kim', email: 'john@cil.org', wallet: '0x00000000000000000000000000000000000c0006', privy: 'did:privy:cil-006' },
  { id: 'cil-user-007', name: 'Paul Martel', email: 'paul@funder.org', wallet: '0x00000000000000000000000000000000000c0007', privy: 'did:privy:cil-007' },
];
for (const u of users) {
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(u.id))
    db.prepare('INSERT OR IGNORE INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(u.id, u.email, u.name, u.wallet, u.privy, ts());
}

// Deprecated org_agents for backward compat pages
const orgs = [
  { name: 'ILAD', desc: 'Local operator — business training, field ops, revenue validation', addr: '$ILAD', user: 'cil-user-001', tpl: 'cil-operator' },
  { name: 'Collective Impact Labs', desc: 'Capital provider + platform sponsor — Ravah model', addr: '$CIL', user: 'cil-user-006', tpl: 'cil-funder' },
  { name: 'Ravah Capital Pilot', desc: 'Togo revenue-sharing pilot (Wave 1)', addr: '$PILOT', user: 'cil-user-006', tpl: 'cil-pilot' },
  { name: \"Afia's Market\", desc: 'Small retail shop — food staples, Lomé', addr: '$BIZ_AFIA', user: 'cil-user-003', tpl: 'cil-business' },
  { name: 'Kossi Mobile Repairs', desc: 'Phone repair + resale, Lomé', addr: '$BIZ_KOSSI', user: 'cil-user-004', tpl: 'cil-business' },
  { name: 'Ama Tailoring Cooperative', desc: 'Women-led sewing group, Lomé', addr: '$BIZ_AMA', user: 'cil-user-005', tpl: 'cil-business' },
];
const id = () => require('crypto').randomUUID();
for (const o of orgs) {
  if (!db.prepare('SELECT id FROM org_agents WHERE smart_account_address = ?').get(o.addr))
    db.prepare('INSERT OR IGNORE INTO org_agents (id,name,description,created_by,smart_account_address,template_id,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id(), o.name, o.desc, o.user, o.addr, o.tpl, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
}

console.log('CIL: 7 users, 6 orgs seeded');
"

echo ""
echo "=== Collective Impact Labs seeded ==="
echo "  ILAD (Operator) — Cameron (Lead), Nick (Reviewer), Yaw (Local Mgr)"
echo "  CIL (Funder) — John (Admin), Paul (Funder)"
echo "  Ravah Capital Pilot — Wave 1 container"
echo "  Businesses: Afia's Market, Kossi Mobile Repairs, Ama Tailoring Coop"
echo "  Relationships: 20+ edges (person→org, org→org, validation, alliance)"
echo "  Treasury: 10 ETH funded"
echo "  Geospatial: All agents in Lomé, Togo (EPSG:4326)"
