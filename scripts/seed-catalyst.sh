#!/usr/bin/env bash
set -euo pipefail

# Seeds the Catalyst Network demo — on-chain agents, relationships, resolver metadata
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

echo "=== Seeding Catalyst Network ==="

deploy_agent() {
  local salt=$1
  cast send "$FACTORY" "createAccount(address,uint256)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast call "$FACTORY" "getAddress(address,uint256)(address)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --from "$(cast wallet address --private-key $KEY)"
}

# ─── Deploy Agents ───────────────────────────────────────────────────
# Organizations
NETWORK=$(deploy_agent 200001)      # Mekong Catalyst Network
HUB_DANANG=$(deploy_agent 200002)   # Da Nang Hub
CIRCLE_SONTRA=$(deploy_agent 200003) # Son Tra Group (G1 — established)
CIRCLE_HANHOA=$(deploy_agent 200004) # Han Hoa Group (G2 — established)
CIRCLE_MYKE=$(deploy_agent 200005)   # My Khe Group (G2 — group)
CIRCLE_THANH=$(deploy_agent 200006)  # Thanh Khe Group (G1 — group)
CIRCLE_LIEN=$(deploy_agent 200007)   # Lien Chieu Group (G2 — group)
CIRCLE_NGU=$(deploy_agent 200008)    # Ngu Hanh Son Group (G3)
CIRCLE_CAM=$(deploy_agent 200009)    # Cam Le Group (G1)

# AI Agent
ANALYTICS=$(deploy_agent 210001)     # Growth Analytics

# Person Agents
PA_ELENA=$(deploy_agent 220001)      # Elena Vasquez (Program Director)
PA_LINH=$(deploy_agent 220002)       # Linh Nguyen (Hub Lead)
PA_TRAN=$(deploy_agent 220003)       # Tran Minh (Facilitator)
PA_MAI=$(deploy_agent 220004)        # Mai Pham (Community Partner)
PA_JAMES=$(deploy_agent 220005)      # James Okafor (Regional Lead)
PA_HOA=$(deploy_agent 220006)        # Hoa Tran (Group Leader — Son Tra)
PA_DUC=$(deploy_agent 220007)        # Duc Le (Group Leader — Han Hoa)

echo "Orgs: Network=$NETWORK Hub=$HUB_DANANG"
echo "Circles: SonTra=$CIRCLE_SONTRA HanHoa=$CIRCLE_HANHOA MyKhe=$CIRCLE_MYKE"

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
register "$NETWORK" "Mekong Catalyst Network" "Regional coordination for grassroots community development" "$T_ORG"
register "$HUB_DANANG" "Da Nang Hub" "Facilitator hub — community development in Da Nang" "$T_ORG"
register "$CIRCLE_SONTRA" "Son Tra Group" "Established learning group — Son Tra district (G1)" "$T_ORG"
register "$CIRCLE_HANHOA" "Han Hoa Group" "Established learning group — Han Hoa ward (G2)" "$T_ORG"
register "$CIRCLE_MYKE" "My Khe Group" "Learning group — My Khe Beach area (G2)" "$T_ORG"
register "$CIRCLE_THANH" "Thanh Khe Group" "Learning group — Thanh Khe district (G1)" "$T_ORG"
register "$CIRCLE_LIEN" "Lien Chieu Group" "Learning group — Lien Chieu district (G2)" "$T_ORG"
register "$CIRCLE_NGU" "Ngu Hanh Son Group" "Learning group — Ngu Hanh Son (G3)" "$T_ORG"
register "$CIRCLE_CAM" "Cam Le Group" "Learning group — Cam Le district (G1)" "$T_ORG"

register "$ANALYTICS" "Growth Analytics" "Tracks generational multiplication and movement health" "$T_AI"

register "$PA_ELENA" "Elena Vasquez" "Program Director — Mekong Catalyst Network" "$T_PERSON"
register "$PA_LINH" "Linh Nguyen" "Hub Lead — Da Nang Hub" "$T_PERSON"
register "$PA_TRAN" "Tran Minh" "Facilitator — Da Nang Hub" "$T_PERSON"
register "$PA_MAI" "Mai Pham" "Community Partner — Da Nang Hub" "$T_PERSON"
register "$PA_JAMES" "James Okafor" "Regional Lead — Mekong Network" "$T_PERSON"
register "$PA_HOA" "Hoa Tran" "Group Leader — Son Tra Group" "$T_PERSON"
register "$PA_DUC" "Duc Le" "Group Leader — Han Hoa Group" "$T_PERSON"

# Set ATL_CONTROLLER on person agents (wallet → agent mapping)
ATL_CONTROLLER="$(cast keccak 'atl:hasController')"
set_ctrl() {
  local agent=$1 wallet=$2
  cast send "$RESOLVER" "addMultiAddressProperty(address,bytes32,address)" "$agent" "$ATL_CONTROLLER" "$wallet" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
}
echo "Setting controllers..."
set_ctrl "$PA_ELENA" "0x00000000000000000000000000000000000b0001"
set_ctrl "$PA_LINH" "0x00000000000000000000000000000000000b0002"
set_ctrl "$PA_TRAN" "0x00000000000000000000000000000000000b0003"
set_ctrl "$PA_MAI" "0x00000000000000000000000000000000000b0004"
set_ctrl "$PA_JAMES" "0x00000000000000000000000000000000000b0005"
set_ctrl "$PA_HOA" "0x00000000000000000000000000000000000b0006"
set_ctrl "$PA_DUC" "0x00000000000000000000000000000000000b0007"

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

ORG_GOV=$(cast call "$REL" "ORGANIZATION_GOVERNANCE()(bytes32)" --rpc-url "$RPC")
ORG_MEM=$(cast call "$REL" "ORGANIZATION_MEMBERSHIP()(bytes32)" --rpc-url "$RPC")
ORG_CTRL=$(cast call "$REL" "ORGANIZATIONAL_CONTROL()(bytes32)" --rpc-url "$RPC")
ALLIANCE=$(cast call "$REL" "ALLIANCE()(bytes32)" --rpc-url "$RPC")
R_OWNER=$(cast call "$REL" "ROLE_OWNER()(bytes32)" --rpc-url "$RPC")
R_MEMBER=$(cast call "$REL" "ROLE_MEMBER()(bytes32)" --rpc-url "$RPC")
R_OPERATOR=$(cast call "$REL" "ROLE_OPERATOR()(bytes32)" --rpc-url "$RPC")
R_BOARD=$(cast call "$REL" "ROLE_BOARD_MEMBER()(bytes32)" --rpc-url "$RPC")
R_ADVISOR=$(cast call "$REL" "ROLE_ADVISOR()(bytes32)" --rpc-url "$RPC")
R_OPERATED=$(cast call "$REL" "ROLE_OPERATED_AGENT()(bytes32)" --rpc-url "$RPC")
R_PARTNER=$(cast call "$REL" "ROLE_STRATEGIC_PARTNER()(bytes32)" --rpc-url "$RPC")

echo ""
echo "=== Person → Org Relationships ==="
echo "Elena → Network (owner, program director)"
create_rel "$PA_ELENA" "$NETWORK" "$ORG_GOV" "" "$R_OWNER"
echo "James → Network (board-member, regional lead)"
create_rel "$PA_JAMES" "$NETWORK" "$ORG_GOV" "" "$R_BOARD"
echo "Linh → Da Nang Hub (owner, hub lead)"
create_rel "$PA_LINH" "$HUB_DANANG" "$ORG_GOV" "" "$R_OWNER"
echo "Linh → Network (operator, hub coordinator)"
create_rel "$PA_LINH" "$NETWORK" "$ORG_MEM" "" "$R_OPERATOR"
echo "Tran → Da Nang Hub (operator, facilitator)"
create_rel "$PA_TRAN" "$HUB_DANANG" "$ORG_MEM" "" "$R_OPERATOR"
echo "Mai → Da Nang Hub (member, community partner)"
create_rel "$PA_MAI" "$HUB_DANANG" "$ORG_MEM" "" "$R_MEMBER"
echo "Hoa → Son Tra Group (owner, group leader)"
create_rel "$PA_HOA" "$CIRCLE_SONTRA" "$ORG_GOV" "" "$R_OWNER"
echo "Hoa → Da Nang Hub (member)"
create_rel "$PA_HOA" "$HUB_DANANG" "$ORG_MEM" "" "$R_MEMBER"
echo "Duc → Han Hoa Group (owner, group leader)"
create_rel "$PA_DUC" "$CIRCLE_HANHOA" "$ORG_GOV" "" "$R_OWNER"
echo "Duc → Da Nang Hub (member)"
create_rel "$PA_DUC" "$HUB_DANANG" "$ORG_MEM" "" "$R_MEMBER"

echo "Linh → Son Tra Group (advisor, mentor)"
create_rel "$PA_LINH" "$CIRCLE_SONTRA" "$ORG_MEM" "" "$R_ADVISOR"
echo "Tran → Han Hoa Group (advisor, mentor)"
create_rel "$PA_TRAN" "$CIRCLE_HANHOA" "$ORG_MEM" "" "$R_ADVISOR"
echo "Tran → Cam Le Group (advisor)"
create_rel "$PA_TRAN" "$CIRCLE_CAM" "$ORG_MEM" "" "$R_ADVISOR"

echo ""
echo "=== Org → Org Relationships (Network Hierarchy) ==="
echo "Network → Da Nang Hub (strategic partner)"
create_rel "$NETWORK" "$HUB_DANANG" "$ALLIANCE" "" "$R_PARTNER"
echo "Da Nang Hub → Son Tra Group (partner, supervises)"
create_rel "$HUB_DANANG" "$CIRCLE_SONTRA" "$ALLIANCE" "" "$R_PARTNER"
echo "Da Nang Hub → Thanh Khe Group (partner)"
create_rel "$HUB_DANANG" "$CIRCLE_THANH" "$ALLIANCE" "" "$R_PARTNER"
echo "Da Nang Hub → Cam Le Group (partner)"
create_rel "$HUB_DANANG" "$CIRCLE_CAM" "$ALLIANCE" "" "$R_PARTNER"
echo "Son Tra Group → Han Hoa Group (generational — started by Son Tra)"
create_rel "$CIRCLE_SONTRA" "$CIRCLE_HANHOA" "$ALLIANCE" "" "$R_PARTNER"
echo "Son Tra Group → My Khe Group (generational)"
create_rel "$CIRCLE_SONTRA" "$CIRCLE_MYKE" "$ALLIANCE" "" "$R_PARTNER"
echo "Thanh Khe → Lien Chieu Group (generational)"
create_rel "$CIRCLE_THANH" "$CIRCLE_LIEN" "$ALLIANCE" "" "$R_PARTNER"
echo "Han Hoa → Ngu Hanh Son Group (generational — G3)"
create_rel "$CIRCLE_HANHOA" "$CIRCLE_NGU" "$ALLIANCE" "" "$R_PARTNER"

echo ""
echo "=== AI Agent → Org ==="
echo "Growth Analytics → Network (operated agent)"
create_rel "$ANALYTICS" "$NETWORK" "$ORG_CTRL" "" "$R_OPERATED"

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
  { id: 'cat-user-001', name: 'Elena Vasquez', email: 'elena@catalystglobal.org', wallet: '0x00000000000000000000000000000000000b0001', privy: 'did:privy:cat-001' },
  { id: 'cat-user-002', name: 'Linh Nguyen', email: 'linh@catalystglobal.org', wallet: '0x00000000000000000000000000000000000b0002', privy: 'did:privy:cat-002' },
  { id: 'cat-user-003', name: 'Tran Minh', email: 'tran@community.vn', wallet: '0x00000000000000000000000000000000000b0003', privy: 'did:privy:cat-003' },
  { id: 'cat-user-004', name: 'Mai Pham', email: 'mai@community.vn', wallet: '0x00000000000000000000000000000000000b0004', privy: 'did:privy:cat-004' },
  { id: 'cat-user-005', name: 'James Okafor', email: 'james@impactfund.org', wallet: '0x00000000000000000000000000000000000b0005', privy: 'did:privy:cat-005' },
  { id: 'cat-user-006', name: 'Hoa Tran', email: 'hoa@circle-sontra.vn', wallet: '0x00000000000000000000000000000000000b0006', privy: 'did:privy:cat-006' },
  { id: 'cat-user-007', name: 'Duc Le', email: 'duc@circle-hanhoa.vn', wallet: '0x00000000000000000000000000000000000b0007', privy: 'did:privy:cat-007' },
];
for (const u of users) {
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(u.id))
    db.prepare('INSERT OR IGNORE INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(u.id, u.email, u.name, u.wallet, u.privy, ts());
}

// Person agents
const personAgents = [
  { userId: 'cat-user-001', name: 'Elena Vasquez', addr: '$PA_ELENA' },
  { userId: 'cat-user-002', name: 'Linh Nguyen', addr: '$PA_LINH' },
  { userId: 'cat-user-003', name: 'Tran Minh', addr: '$PA_TRAN' },
  { userId: 'cat-user-004', name: 'Mai Pham', addr: '$PA_MAI' },
  { userId: 'cat-user-005', name: 'James Okafor', addr: '$PA_JAMES' },
  { userId: 'cat-user-006', name: 'Hoa Tran', addr: '$PA_HOA' },
  { userId: 'cat-user-007', name: 'Duc Le', addr: '$PA_DUC' },
];
for (const p of personAgents) {
  if (!db.prepare('SELECT id FROM person_agents WHERE user_id = ?').get(p.userId))
    db.prepare('INSERT OR IGNORE INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), p.name, p.userId, p.addr, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
}

// Org agents — Network, Hub, AND each Circle as a proper org agent
const orgs = [
  { name: 'Mekong Catalyst Network', desc: 'Regional coordination for grassroots community development across the Mekong Delta', addr: '$NETWORK', user: 'cat-user-001', tpl: 'catalyst-network' },
  { name: 'Da Nang Hub', desc: 'Facilitator hub — community development in Da Nang and central Vietnam', addr: '$HUB_DANANG', user: 'cat-user-002', tpl: 'facilitator-hub' },
  // Each circle is a proper org agent (local-group template)
  { name: 'Son Tra Group', desc: 'Established learning group — Son Tra district, Da Nang (G1)', addr: '$CIRCLE_SONTRA', user: 'cat-user-006', tpl: 'local-group' },
  { name: 'Han Hoa Group', desc: 'Established learning group — Han Hoa ward, Da Nang (G2, started by Son Tra)', addr: '$CIRCLE_HANHOA', user: 'cat-user-007', tpl: 'local-group' },
  { name: 'My Khe Group', desc: 'Learning group — My Khe Beach area (G2)', addr: '$CIRCLE_MYKE', user: 'cat-user-002', tpl: 'local-group' },
  { name: 'Thanh Khe Group', desc: 'Learning group — Thanh Khe district (G1)', addr: '$CIRCLE_THANH', user: 'cat-user-003', tpl: 'local-group' },
  { name: 'Lien Chieu Group', desc: 'Learning group — Lien Chieu district (G2)', addr: '$CIRCLE_LIEN', user: 'cat-user-003', tpl: 'local-group' },
  { name: 'Ngu Hanh Son Group', desc: 'Learning group — Ngu Hanh Son (G3 — movement multiplication)', addr: '$CIRCLE_NGU', user: 'cat-user-002', tpl: 'local-group' },
  { name: 'Cam Le Group', desc: 'Learning group — Cam Le district (G1)', addr: '$CIRCLE_CAM', user: 'cat-user-003', tpl: 'local-group' },
];
for (const o of orgs) {
  if (!db.prepare('SELECT id FROM org_agents WHERE smart_account_address = ?').get(o.addr))
    db.prepare('INSERT OR IGNORE INTO org_agents (id,name,description,created_by,smart_account_address,template_id,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id(), o.name, o.desc, o.user, o.addr, o.tpl, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
}

// AI agent
if (!db.prepare(\"SELECT id FROM ai_agents WHERE name = 'Growth Analytics' AND operated_by = ?\").get('$NETWORK'))
  db.prepare('INSERT OR IGNORE INTO ai_agents (id,name,description,agent_type,created_by,operated_by,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(), 'Growth Analytics', 'Tracks generational multiplication and movement health', 'discovery', 'cat-user-001', '$NETWORK', '$ANALYTICS', 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());

// Gen map nodes — reference actual org agent addresses
const networkAddr = '$NETWORK'.toLowerCase();
const genNodes = [
  { id: 'cat-g0-linh', parent: null, gen: 0, name: 'Linh — Pilot Program', leader: 'Linh Nguyen', loc: 'Da Nang Central', groupAddr: null, health: { seekers: 6, believers: 4, baptized: 3, leaders: 2, giving: false, isChurch: false, groupsStarted: 2, attenders: 6, peoplGroup: 'Vietnamese Kinh' }, status: 'multiplied', started: '2025-02-10' },
  { id: 'cat-g1-sontra', parent: 'cat-g0-linh', gen: 1, name: 'Son Tra Group', leader: 'Hoa Tran', loc: 'Son Tra District', groupAddr: '$CIRCLE_SONTRA', health: { seekers: 9, believers: 7, baptized: 5, leaders: 3, giving: true, isChurch: true, groupsStarted: 2, attenders: 9, peoplGroup: 'Vietnamese Kinh', baptismSelf: true, teachingSelf: true }, status: 'multiplied', started: '2025-04-20' },
  { id: 'cat-g1-thanh', parent: 'cat-g0-linh', gen: 1, name: 'Thanh Khe Group', leader: 'Binh Vo', loc: 'Thanh Khe', groupAddr: '$CIRCLE_THANH', health: { seekers: 5, believers: 3, baptized: 1, leaders: 1, giving: false, isChurch: false, groupsStarted: 1, attenders: 5, peoplGroup: 'Vietnamese Kinh' }, status: 'active', started: '2025-05-15' },
  { id: 'cat-g2-hanhoa', parent: 'cat-g1-sontra', gen: 2, name: 'Han Hoa Group', leader: 'Duc Le', loc: 'Han Hoa Ward', groupAddr: '$CIRCLE_HANHOA', health: { seekers: 7, believers: 5, baptized: 3, leaders: 1, giving: true, isChurch: true, groupsStarted: 1, attenders: 7, peoplGroup: 'Vietnamese Kinh', baptismSelf: true, teachingSelf: true }, status: 'multiplied', started: '2025-08-12' },
  { id: 'cat-g2-myke', parent: 'cat-g1-sontra', gen: 2, name: 'My Khe Group', leader: 'Anh Bui', loc: 'My Khe Beach', groupAddr: '$CIRCLE_MYKE', health: { seekers: 4, believers: 2, baptized: 1, leaders: 0, giving: false, isChurch: false, groupsStarted: 0, attenders: 4 }, status: 'active', started: '2025-09-30' },
  { id: 'cat-g2-lien', parent: 'cat-g1-thanh', gen: 2, name: 'Lien Chieu Group', leader: 'Phuong Dang', loc: 'Lien Chieu', groupAddr: '$CIRCLE_LIEN', health: { seekers: 6, believers: 2, baptized: 0, leaders: 0, giving: false, isChurch: false, groupsStarted: 0, attenders: 6 }, status: 'active', started: '2025-11-05' },
  { id: 'cat-g3-ngu', parent: 'cat-g2-hanhoa', gen: 3, name: 'Ngu Hanh Son Group', leader: 'Khoa Phan', loc: 'Ngu Hanh Son', groupAddr: '$CIRCLE_NGU', health: { seekers: 8, believers: 3, baptized: 1, leaders: 0, giving: false, isChurch: false, groupsStarted: 0, attenders: 8, peoplGroup: 'Vietnamese Kinh' }, status: 'active', started: '2026-01-15' },
  { id: 'cat-g0-tran', parent: null, gen: 0, name: 'Tran — Hai Chau Pilot', leader: 'Tran Minh', loc: 'Hai Chau', groupAddr: null, health: { seekers: 5, believers: 3, baptized: 1, leaders: 1, giving: false, isChurch: false, groupsStarted: 1, attenders: 5, peoplGroup: 'Vietnamese Kinh' }, status: 'active', started: '2025-06-01' },
  { id: 'cat-g1-cam', parent: 'cat-g0-tran', gen: 1, name: 'Cam Le Group', leader: 'Thao Ngo', loc: 'Cam Le', groupAddr: '$CIRCLE_CAM', health: { seekers: 4, believers: 2, baptized: 0, leaders: 0, giving: false, isChurch: false, groupsStarted: 0, attenders: 4 }, status: 'active', started: '2025-12-01' },
];

// Clear old gen map nodes for this network and re-seed with org references
db.prepare('DELETE FROM gen_map_nodes WHERE network_address = ?').run(networkAddr);
for (const n of genNodes) {
  db.prepare('INSERT OR IGNORE INTO gen_map_nodes (id,network_address,group_address,parent_id,generation,name,leader_name,location,health_data,status,started_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(n.id, networkAddr, n.groupAddr ? n.groupAddr.toLowerCase() : null, n.parent, n.gen, n.name, n.leader, n.loc, JSON.stringify(n.health), n.status, n.started, ts());
}

// Activity logs
const hubAddr = '$HUB_DANANG'.toLowerCase();
const existingAct = db.prepare('SELECT count(*) as c FROM activity_logs WHERE org_address = ?').get(hubAddr);
if (!existingAct || existingAct.c === 0) {
  const activities = [
    { user: 'cat-user-002', type: 'outreach', title: 'Community needs assessment — Son Tra market', desc: 'Surveyed 15 vendors about vocational training needs. 4 expressed interest in joining a learning group.', participants: 15, loc: 'Son Tra Market', dur: 120, date: '2026-03-12' },
    { user: 'cat-user-003', type: 'visit', title: 'Home visit — Binh family follow-up', desc: 'Second visit to Binh and family. Discussed financial literacy module.', participants: 4, loc: 'Hai Chau', dur: 90, date: '2026-03-15' },
    { user: 'cat-user-004', type: 'training', title: 'Facilitator skills workshop', desc: 'Trained 6 emerging facilitators in discussion-based learning methods.', participants: 6, loc: 'Da Nang Central', dur: 180, date: '2026-03-18' },
    { user: 'cat-user-002', type: 'coaching', title: 'Hoa coaching session', desc: 'Coached Hoa on managing group dynamics and identifying potential new group leaderers.', participants: 2, loc: 'Son Tra', dur: 60, date: '2026-03-20' },
    { user: 'cat-user-003', type: 'meeting', title: 'Cam Le circle weekly session', desc: 'First regular session of the new Cam Le circle. Thao facilitated. 4 new participants.', participants: 6, loc: 'Cam Le', dur: 90, date: '2026-03-23' },
    { user: 'cat-user-006', type: 'meeting', title: 'Son Tra weekly circle', desc: 'Weekly learning session. 9 attended including 3 newcomers from the market outreach.', participants: 9, loc: 'Son Tra', dur: 75, date: '2026-03-25' },
    { user: 'cat-user-007', type: 'outreach', title: 'Han Hoa neighborhood engagement', desc: 'Door-to-door visits in new housing development. Introduced the program to 8 families.', participants: 3, loc: 'Han Hoa Ward', dur: 150, date: '2026-03-27' },
    { user: 'cat-user-002', type: 'assessment', title: 'Monthly impact review', desc: 'Reviewed all circles across both streams. My Khe needs more support. Ngu Hanh Son growing well.', participants: 1, loc: 'Da Nang Central', dur: 60, date: '2026-04-01' },
    { user: 'cat-user-004', type: 'service', title: 'Community cleanup with Son Tra circle', desc: 'Circle organized beach cleanup event. Great community visibility and engagement.', participants: 14, loc: 'Son Tra Beach', dur: 120, date: '2026-04-03' },
    { user: 'cat-user-003', type: 'follow-up', title: 'New participant onboarding — Lan', desc: 'Lan completed orientation. Connected her with Mai for ongoing mentorship.', participants: 2, loc: 'Hai Chau', dur: 45, date: '2026-04-05' },
    { user: 'cat-user-002', type: 'training', title: 'Leadership development — Hoa and Duc', desc: 'Monthly leader development session. Covered identifying emerging facilitators.', participants: 3, loc: 'Da Nang Central', dur: 120, date: '2026-04-07' },
    { user: 'cat-user-006', type: 'meeting', title: 'Son Tra Saturday session', desc: 'Full circle session. 7 participants, 3 prospects. Digital literacy module. One prospect asked about starting own circle.', participants: 10, loc: 'Son Tra', dur: 90, date: '2026-04-09' },
  ];
  for (const a of activities) {
    db.prepare('INSERT OR IGNORE INTO activity_logs (id,org_address,user_id,activity_type,title,description,participants,location,lat,lng,duration_minutes,related_entity,activity_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id(), hubAddr, a.user, a.type, a.title, a.desc, a.participants, a.loc, null, null, a.dur, null, a.date, ts());
  }
}

// Agent index (minimal off-chain index into on-chain agents)
function upsertIdx(addr, kind, userId, createdBy, operatedBy, templateId) {
  const key = addr.toLowerCase();
  if (!db.prepare('SELECT smart_account_address FROM agent_index WHERE smart_account_address = ?').get(key)) {
    db.prepare('INSERT OR IGNORE INTO agent_index (smart_account_address,agent_kind,user_id,created_by,operated_by,template_id,created_at) VALUES (?,?,?,?,?,?,?)').run(key, kind, userId, createdBy, operatedBy, templateId, ts());
  }
}

// Person agents
upsertIdx('$PA_ELENA', 'person', 'cat-user-001', 'cat-user-001', null, null);
upsertIdx('$PA_LINH', 'person', 'cat-user-002', 'cat-user-002', null, null);
upsertIdx('$PA_TRAN', 'person', 'cat-user-003', 'cat-user-003', null, null);
upsertIdx('$PA_MAI', 'person', 'cat-user-004', 'cat-user-004', null, null);
upsertIdx('$PA_JAMES', 'person', 'cat-user-005', 'cat-user-005', null, null);
upsertIdx('$PA_HOA', 'person', 'cat-user-006', 'cat-user-006', null, null);
upsertIdx('$PA_DUC', 'person', 'cat-user-007', 'cat-user-007', null, null);

// Org agents
upsertIdx('$NETWORK', 'org', null, 'cat-user-001', null, 'catalyst-network');
upsertIdx('$HUB_DANANG', 'org', null, 'cat-user-002', null, 'facilitator-hub');
upsertIdx('$CIRCLE_SONTRA', 'org', null, 'cat-user-006', null, 'local-group');
upsertIdx('$CIRCLE_HANHOA', 'org', null, 'cat-user-007', null, 'local-group');
upsertIdx('$CIRCLE_MYKE', 'org', null, 'cat-user-002', null, 'local-group');
upsertIdx('$CIRCLE_THANH', 'org', null, 'cat-user-003', null, 'local-group');
upsertIdx('$CIRCLE_LIEN', 'org', null, 'cat-user-003', null, 'local-group');
upsertIdx('$CIRCLE_NGU', 'org', null, 'cat-user-002', null, 'local-group');
upsertIdx('$CIRCLE_CAM', 'org', null, 'cat-user-003', null, 'local-group');

// AI agent
upsertIdx('$ANALYTICS', 'ai', null, 'cat-user-001', '$NETWORK', null);

console.log('Catalyst Network seeded:');
console.log('  7 users, 7 person agents');
console.log('  9 org agents (1 network + 1 hub + 7 groups)');
console.log('  1 AI agent (Growth Analytics)');
console.log('  17 agent_index entries');
console.log('  12 activity logs');
"

echo ""
echo "=== Catalyst Network seeded ==="
echo "  On-chain: 13 person→org edges, 8 org→org edges, 1 AI→org edge"
echo "  22 total relationship edges with roles and assertions"
echo "  All agents registered in resolver with metadata"
echo ""
echo "  Org hierarchy:"
echo "    Mekong Catalyst Network"
echo "      └─ Da Nang Hub"
echo "           ├─ Son Tra Group (G1, established)"
echo "           │    ├─ Han Hoa Group (G2, established)"
echo "           │    │    └─ Ngu Hanh Son Group (G3)"
echo "           │    └─ My Khe Group (G2)"
echo "           ├─ Thanh Khe Group (G1)"
echo "           │    └─ Lien Chieu Group (G2)"
echo "           └─ Cam Le Group (G1)"
