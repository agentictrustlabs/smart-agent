#!/usr/bin/env bash
set -euo pipefail

# Seeds the Catalyst NoCo Network demo — on-chain agents, relationships, resolver metadata
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

echo "=== Seeding Catalyst NoCo Network ==="

deploy_agent() {
  local salt=$1
  cast send "$FACTORY" "createAccount(address,uint256)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast call "$FACTORY" "getAddress(address,uint256)(address)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --from "$(cast wallet address --private-key $KEY)"
}

# ─── Deploy Agents ───────────────────────────────────────────────────
# Organizations
NETWORK=$(deploy_agent 200001)          # Catalyst NoCo Network
HUB_FORTCOLLINS=$(deploy_agent 200002)  # Fort Collins Hub
CIRCLE_WELLINGTON=$(deploy_agent 200003) # Wellington Circle (G1 — established)
CIRCLE_LAPORTE=$(deploy_agent 200004)    # Laporte Circle (G2 — established)
CIRCLE_TIMNATH=$(deploy_agent 200005)    # Timnath Circle (G2 — group)
CIRCLE_LOVELAND=$(deploy_agent 200006)   # Loveland Circle (G1 — group)
CIRCLE_BERTHOUD=$(deploy_agent 200007)   # Berthoud Circle (G2 — group)
CIRCLE_JOHNSTOWN=$(deploy_agent 200008)  # Johnstown Circle (G3)
CIRCLE_REDFEATHER=$(deploy_agent 200009) # Red Feather Circle (G1)

# AI Agent
ANALYTICS=$(deploy_agent 210001)         # NoCo Growth Analytics

# Person Agents
PA_MARIA=$(deploy_agent 220001)          # Maria Gonzalez (Program Director)
PA_DAVID=$(deploy_agent 220002)          # Pastor David Chen (Hub Lead)
PA_ROSA=$(deploy_agent 220003)           # Rosa Martinez (Facilitator)
PA_CARLOS=$(deploy_agent 220004)         # Carlos Herrera (Community Partner)
PA_SARAH=$(deploy_agent 220005)          # Sarah Thompson (Regional Lead)
PA_ANA=$(deploy_agent 220006)            # Ana Reyes (Group Leader — Wellington)
PA_MIGUEL=$(deploy_agent 220007)         # Miguel Santos (Group Leader — Laporte)

echo "Orgs: Network=$NETWORK Hub=$HUB_FORTCOLLINS"
echo "Circles: Wellington=$CIRCLE_WELLINGTON Laporte=$CIRCLE_LAPORTE Timnath=$CIRCLE_TIMNATH"

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
register "$NETWORK" "Catalyst NoCo Network" "Regional coordination for Hispanic outreach and community development in Northern Colorado" "$T_ORG"
register "$HUB_FORTCOLLINS" "Fort Collins Hub" "Facilitator hub — Hispanic outreach and bilingual ministry in Fort Collins" "$T_ORG"
register "$CIRCLE_WELLINGTON" "Wellington Circle" "Established outreach circle — Wellington area, ESL and family support (G1)" "$T_ORG"
register "$CIRCLE_LAPORTE" "Laporte Circle" "Established outreach circle — Laporte community, farm worker advocacy (G2)" "$T_ORG"
register "$CIRCLE_TIMNATH" "Timnath Circle" "Outreach circle — Timnath area, bilingual worship and fellowship (G2)" "$T_ORG"
register "$CIRCLE_LOVELAND" "Loveland Circle" "Outreach circle — Loveland, immigration support and ESL classes (G1)" "$T_ORG"
register "$CIRCLE_BERTHOUD" "Berthoud Circle" "Outreach circle — Berthoud, farm worker families and youth programs (G2)" "$T_ORG"
register "$CIRCLE_JOHNSTOWN" "Johnstown Circle" "Outreach circle — Johnstown, bilingual community development (G3)" "$T_ORG"
register "$CIRCLE_REDFEATHER" "Red Feather Circle" "Outreach circle — Red Feather Lakes, rural Hispanic family ministry (G1)" "$T_ORG"

register "$ANALYTICS" "NoCo Growth Analytics" "Tracks generational multiplication and movement health across NoCo" "$T_AI"

register "$PA_MARIA" "Maria Gonzalez" "Program Director — Catalyst NoCo Network" "$T_PERSON"
register "$PA_DAVID" "Pastor David Chen" "Hub Lead — Fort Collins Hub" "$T_PERSON"
register "$PA_ROSA" "Rosa Martinez" "Facilitator — Fort Collins Hub" "$T_PERSON"
register "$PA_CARLOS" "Carlos Herrera" "Community Partner — Fort Collins Hub" "$T_PERSON"
register "$PA_SARAH" "Sarah Thompson" "Regional Lead — Catalyst NoCo Network" "$T_PERSON"
register "$PA_ANA" "Ana Reyes" "Group Leader — Wellington Circle" "$T_PERSON"
register "$PA_MIGUEL" "Miguel Santos" "Group Leader — Laporte Circle" "$T_PERSON"

# Set ATL_CONTROLLER on person agents (wallet → agent mapping)
ATL_CONTROLLER="$(cast keccak 'atl:hasController')"
set_ctrl() {
  local agent=$1 wallet=$2
  cast send "$RESOLVER" "addMultiAddressProperty(address,bytes32,address)" "$agent" "$ATL_CONTROLLER" "$wallet" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
}
echo "Setting controllers..."
set_ctrl "$PA_MARIA" "0x00000000000000000000000000000000000b0001"
set_ctrl "$PA_DAVID" "0x00000000000000000000000000000000000b0002"
set_ctrl "$PA_ROSA" "0x00000000000000000000000000000000000b0003"
set_ctrl "$PA_CARLOS" "0x00000000000000000000000000000000000b0004"
set_ctrl "$PA_SARAH" "0x00000000000000000000000000000000000b0005"
set_ctrl "$PA_ANA" "0x00000000000000000000000000000000000b0006"
set_ctrl "$PA_MIGUEL" "0x00000000000000000000000000000000000b0007"

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
R_OWNER=$(hash_term "atl:OwnerRole")
R_MEMBER=$(hash_term "atl:MemberRole")
R_OPERATOR=$(hash_term "atl:OperatorRole")
R_BOARD=$(hash_term "atl:BoardMemberRole")
R_ADVISOR=$(hash_term "atl:AdvisorRole")
R_OPERATED=$(hash_term "atl:OperatedAgentRole")
R_PARTNER=$(hash_term "atl:StrategicPartnerRole")
GEN_LINEAGE=$(hash_term "atl:GenerationalLineageRelationship")
R_UPSTREAM=$(hash_term "atl:UpstreamRole")
R_DOWNSTREAM=$(hash_term "atl:DownstreamRole")

echo ""
echo "=== Person → Org Relationships ==="
echo "Maria → Network (owner, program director)"
create_rel "$PA_MARIA" "$NETWORK" "$ORG_GOV" "" "$R_OWNER"
echo "Sarah → Network (board-member, regional lead)"
create_rel "$PA_SARAH" "$NETWORK" "$ORG_GOV" "" "$R_BOARD"
echo "David → Fort Collins Hub (owner, hub lead)"
create_rel "$PA_DAVID" "$HUB_FORTCOLLINS" "$ORG_GOV" "" "$R_OWNER"
echo "David → Network (operator, hub coordinator)"
create_rel "$PA_DAVID" "$NETWORK" "$ORG_MEM" "" "$R_OPERATOR"
echo "Rosa → Fort Collins Hub (operator, facilitator)"
create_rel "$PA_ROSA" "$HUB_FORTCOLLINS" "$ORG_MEM" "" "$R_OPERATOR"
echo "Carlos → Fort Collins Hub (member, community partner)"
create_rel "$PA_CARLOS" "$HUB_FORTCOLLINS" "$ORG_MEM" "" "$R_MEMBER"
echo "Ana → Wellington Circle (owner, group leader)"
create_rel "$PA_ANA" "$CIRCLE_WELLINGTON" "$ORG_GOV" "" "$R_OWNER"
echo "Ana → Fort Collins Hub (member)"
create_rel "$PA_ANA" "$HUB_FORTCOLLINS" "$ORG_MEM" "" "$R_MEMBER"
echo "Miguel → Laporte Circle (owner, group leader)"
create_rel "$PA_MIGUEL" "$CIRCLE_LAPORTE" "$ORG_GOV" "" "$R_OWNER"
echo "Miguel → Fort Collins Hub (member)"
create_rel "$PA_MIGUEL" "$HUB_FORTCOLLINS" "$ORG_MEM" "" "$R_MEMBER"

echo "David → Wellington Circle (advisor, mentor)"
create_rel "$PA_DAVID" "$CIRCLE_WELLINGTON" "$ORG_MEM" "" "$R_ADVISOR"
echo "Rosa → Laporte Circle (advisor, mentor)"
create_rel "$PA_ROSA" "$CIRCLE_LAPORTE" "$ORG_MEM" "" "$R_ADVISOR"
echo "Rosa → Red Feather Circle (advisor)"
create_rel "$PA_ROSA" "$CIRCLE_REDFEATHER" "$ORG_MEM" "" "$R_ADVISOR"

echo ""
echo "=== Org → Org Relationships (Network Hierarchy) ==="
echo "Network → Fort Collins Hub (strategic partner)"
create_rel "$NETWORK" "$HUB_FORTCOLLINS" "$ALLIANCE" "" "$R_PARTNER"
echo "Fort Collins Hub → Wellington Circle (partner, supervises)"
create_rel "$HUB_FORTCOLLINS" "$CIRCLE_WELLINGTON" "$ALLIANCE" "" "$R_PARTNER"
echo "Fort Collins Hub → Loveland Circle (partner)"
create_rel "$HUB_FORTCOLLINS" "$CIRCLE_LOVELAND" "$ALLIANCE" "" "$R_PARTNER"
echo "Fort Collins Hub → Red Feather Circle (partner)"
create_rel "$HUB_FORTCOLLINS" "$CIRCLE_REDFEATHER" "$ALLIANCE" "" "$R_PARTNER"
echo ""
echo "=== Generational Lineage (upstream → downstream) ==="
echo "Wellington → Laporte (generational — started by Wellington)"
create_rel "$CIRCLE_WELLINGTON" "$CIRCLE_LAPORTE" "$GEN_LINEAGE" "$R_UPSTREAM" "$R_DOWNSTREAM"
echo "Wellington → Timnath (generational)"
create_rel "$CIRCLE_WELLINGTON" "$CIRCLE_TIMNATH" "$GEN_LINEAGE" "$R_UPSTREAM" "$R_DOWNSTREAM"
echo "Loveland → Berthoud (generational)"
create_rel "$CIRCLE_LOVELAND" "$CIRCLE_BERTHOUD" "$GEN_LINEAGE" "$R_UPSTREAM" "$R_DOWNSTREAM"
echo "Laporte → Johnstown (generational — G3)"
create_rel "$CIRCLE_LAPORTE" "$CIRCLE_JOHNSTOWN" "$GEN_LINEAGE" "$R_UPSTREAM" "$R_DOWNSTREAM"

echo ""
echo "=== AI Agent → Org ==="
echo "NoCo Growth Analytics → Network (operated agent)"
create_rel "$ANALYTICS" "$NETWORK" "$ORG_CTRL" "" "$R_OPERATED"

# ─── Hub Agent ──────────────────────────────────────────────────────
echo ""
echo "=== Hub Agent ==="
HUB_CATALYST=$(deploy_agent 290001)
T_HUB=$(cast keccak "atl:HubAgent")
register "$HUB_CATALYST" "Catalyst Hub" "Catalyst NoCo Network hub — Hispanic outreach, activity tracking, multiplication mapping" "$T_HUB"
echo "Hub: $HUB_CATALYST"

# Hub predicates
HUB_NAV=$(cast keccak "atl:hubNavConfig")
HUB_NET=$(cast keccak "atl:hubNetworkLabel")
HUB_CTX=$(cast keccak "atl:hubContextTerm")
HUB_OVR=$(cast keccak "atl:hubOverviewLabel")
HUB_AGT=$(cast keccak "atl:hubAgentLabel")

cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_CATALYST" "$HUB_NET" "Partner Network" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_CATALYST" "$HUB_CTX" "Network" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_CATALYST" "$HUB_OVR" "Network View" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_CATALYST" "$HUB_AGT" "Participants" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

NAV_JSON='[{"href":"/dashboard","label":"Network View"},{"href":"/agents","label":"Participants"},{"href":"/network","label":"Partner Network"},{"href":"/genmap","label":"Lineage"},{"href":"/activities","label":"Field Activity"},{"href":"/members","label":"Members"},{"href":"/reviews","label":"Reviews"}]'
cast send "$RESOLVER" "setStringProperty(address,bytes32,string)" "$HUB_CATALYST" "$HUB_NAV" "$NAV_JSON" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1

# HAS_MEMBER edges
HAS_MEMBER=$(hash_term "atl:HasMemberRelationship")
echo "Creating HAS_MEMBER edges..."
for AGENT in $NETWORK $HUB_FORTCOLLINS $CIRCLE_WELLINGTON $CIRCLE_LAPORTE $CIRCLE_TIMNATH $CIRCLE_LOVELAND $CIRCLE_BERTHOUD $CIRCLE_JOHNSTOWN $CIRCLE_REDFEATHER $ANALYTICS $PA_MARIA $PA_DAVID $PA_ROSA $PA_CARLOS $PA_SARAH $PA_ANA $PA_MIGUEL; do
  create_rel "$HUB_CATALYST" "$AGENT" "$HAS_MEMBER" "" "$R_MEMBER"
done

# ─── Seed DB ─────────────────────────────────────────────────────────
echo ""
echo "=== Seeding database ==="
cd "$ROOT_DIR/apps/web"

node -e "
const Database = require('better-sqlite3');
const db = new Database('local.db');
const ts = () => new Date().toISOString();
const id = () => require('crypto').randomUUID();

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
      if (cleaned && cleaned.includes('CREATE')) {
        const safe = cleaned.replace(/CREATE TABLE \x60/g, 'CREATE TABLE IF NOT EXISTS \x60')
          .replace(/CREATE UNIQUE INDEX \x60/g, 'CREATE UNIQUE INDEX IF NOT EXISTS \x60');
        try { db.prepare(safe).run(); } catch {}
      }
    }
  }
}

// Users
const users = [
  { id: 'cat-user-001', name: 'Maria Gonzalez', email: 'maria@catalystnoco.org', wallet: '0x00000000000000000000000000000000000b0001', privy: 'did:privy:cat-001' },
  { id: 'cat-user-002', name: 'Pastor David Chen', email: 'david@catalystnoco.org', wallet: '0x00000000000000000000000000000000000b0002', privy: 'did:privy:cat-002' },
  { id: 'cat-user-003', name: 'Rosa Martinez', email: 'rosa@nocohispanic.org', wallet: '0x00000000000000000000000000000000000b0003', privy: 'did:privy:cat-003' },
  { id: 'cat-user-004', name: 'Carlos Herrera', email: 'carlos@nocohispanic.org', wallet: '0x00000000000000000000000000000000000b0004', privy: 'did:privy:cat-004' },
  { id: 'cat-user-005', name: 'Sarah Thompson', email: 'sarah@catalystnoco.org', wallet: '0x00000000000000000000000000000000000b0005', privy: 'did:privy:cat-005' },
  { id: 'cat-user-006', name: 'Ana Reyes', email: 'ana@circle-wellington.org', wallet: '0x00000000000000000000000000000000000b0006', privy: 'did:privy:cat-006' },
  { id: 'cat-user-007', name: 'Miguel Santos', email: 'miguel@circle-laporte.org', wallet: '0x00000000000000000000000000000000000b0007', privy: 'did:privy:cat-007' },
];
for (const u of users) {
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(u.id))
    db.prepare('INSERT OR IGNORE INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(u.id, u.email, u.name, u.wallet, u.privy, ts());
}

// Legacy DB tables (person_agents, org_agents, ai_agents, gen_map_nodes, agent_index) removed.
// All agent identity is on-chain. The TypeScript seed handles DB user rows on login.

















































































































console.log('Catalyst NoCo Network seeded:');
console.log('  7 users, 7 person agents');
console.log('  9 org agents (1 network + 1 hub + 7 circles)');
console.log('  1 AI agent (NoCo Growth Analytics)');
console.log('  17 agent_index entries');
console.log('  12 activity logs');
"

echo ""
echo "=== Catalyst NoCo Network seeded ==="
echo "  On-chain: 13 person→org edges, 8 org→org edges, 1 AI→org edge"
echo "  22 total relationship edges with roles and assertions"
echo "  All agents registered in resolver with metadata"
echo ""
echo "  Org hierarchy:"
echo "    Catalyst NoCo Network"
echo "      └─ Fort Collins Hub"
echo "           ├─ Wellington Circle (G1, established)"
echo "           │    ├─ Laporte Circle (G2, established)"
echo "           │    │    └─ Johnstown Circle (G3)"
echo "           │    └─ Timnath Circle (G2)"
echo "           ├─ Loveland Circle (G1)"
echo "           │    └─ Berthoud Circle (G2)"
echo "           └─ Red Feather Circle (G1)"
