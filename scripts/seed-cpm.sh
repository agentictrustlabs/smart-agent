#!/usr/bin/env bash
set -euo pipefail

# Seeds the Church Planting Movement demo — 5th demo community
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

echo "=== Seeding Church Planting Movement ==="

deploy_agent() {
  local salt=$1
  cast send "$FACTORY" "createAccount(address,uint256)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --private-key "$KEY" > /dev/null 2>&1
  cast call "$FACTORY" "getAddress(address,uint256)(address)" "$(cast wallet address --private-key $KEY)" "$salt" --rpc-url "$RPC" --from "$(cast wallet address --private-key $KEY)"
}

# Organizations
NETWORK=$(deploy_agent 100001)     # South Asia Movement Network
TEAM_KOL=$(deploy_agent 100002)    # Kolkata Team
GRP_BARAN=$(deploy_agent 100003)   # Baranagar Group (house church)
GRP_SALT=$(deploy_agent 100004)    # Salt Lake Group (house church)

# AI Agent
ANALYTICS=$(deploy_agent 110001)   # Movement Analytics

# Person Agents
PA_MARK=$(deploy_agent 120001)     # Mark Thompson (Network Director)
PA_PRIYA=$(deploy_agent 120002)    # Priya Sharma (Team Leader)
PA_RAJ=$(deploy_agent 120003)      # Raj Patel (Church Planter)
PA_ANITA=$(deploy_agent 120004)    # Anita Das (National Partner)
PA_DAVID=$(deploy_agent 120005)    # David Kim (Strategy Lead)
PA_SAMUEL=$(deploy_agent 120006)   # Samuel Bose (Group Leader)
PA_MEERA=$(deploy_agent 120007)    # Meera Ghosh (Group Leader)

echo "Orgs: Network=$NETWORK Team=$TEAM_KOL Baranagar=$GRP_BARAN SaltLake=$GRP_SALT"

# Register
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

echo "Registering..."
register "$NETWORK" "South Asia Movement Network" "Multi-agency CPM coordination across South Asia" "$T_ORG"
register "$TEAM_KOL" "Kolkata Team" "Church planting team focused on Bengali-speaking communities" "$T_ORG"
register "$GRP_BARAN" "Baranagar Group" "House church — Baranagar, Kolkata (G1)" "$T_ORG"
register "$GRP_SALT" "Salt Lake Group" "House church — Salt Lake City, Kolkata (G2)" "$T_ORG"

register "$ANALYTICS" "Movement Analytics" "Generational growth tracking and movement health reports" "$T_AI"

register "$PA_MARK" "Mark Thompson" "Network Director — South Asia Movement Network" "$T_PERSON"
register "$PA_PRIYA" "Priya Sharma" "Team Leader — Kolkata Team" "$T_PERSON"
register "$PA_RAJ" "Raj Patel" "Church Planter — Kolkata" "$T_PERSON"
register "$PA_ANITA" "Anita Das" "National Partner — Kolkata" "$T_PERSON"
register "$PA_DAVID" "David Kim" "Strategy Lead — South Asia" "$T_PERSON"
register "$PA_SAMUEL" "Samuel Bose" "Group Leader — Baranagar" "$T_PERSON"
register "$PA_MEERA" "Meera Ghosh" "Group Leader — Salt Lake" "$T_PERSON"

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
echo "Mark → Network (owner)"
create_rel "$PA_MARK" "$NETWORK" "$ORG_GOV" "" "$R_OWNER"
echo "David → Network (board-member)"
create_rel "$PA_DAVID" "$NETWORK" "$ORG_GOV" "" "$R_BOARD"
echo "Priya → Kolkata Team (owner)"
create_rel "$PA_PRIYA" "$TEAM_KOL" "$ORG_GOV" "" "$R_OWNER"
echo "Raj → Kolkata Team (operator)"
create_rel "$PA_RAJ" "$TEAM_KOL" "$ORG_MEM" "" "$R_OPERATOR"
echo "Anita → Kolkata Team (member)"
create_rel "$PA_ANITA" "$TEAM_KOL" "$ORG_MEM" "" "$R_MEMBER"
echo "Samuel → Baranagar Group (owner)"
create_rel "$PA_SAMUEL" "$GRP_BARAN" "$ORG_GOV" "" "$R_OWNER"
echo "Meera → Salt Lake Group (owner)"
create_rel "$PA_MEERA" "$GRP_SALT" "$ORG_GOV" "" "$R_OWNER"
echo "Priya → Baranagar (advisor)"
create_rel "$PA_PRIYA" "$GRP_BARAN" "$ORG_MEM" "" "$R_ADVISOR"
echo "Raj → Salt Lake (advisor)"
create_rel "$PA_RAJ" "$GRP_SALT" "$ORG_MEM" "" "$R_ADVISOR"

echo ""
echo "=== Org → Org Relationships ==="
echo "Network → Kolkata Team (partner)"
create_rel "$NETWORK" "$TEAM_KOL" "$ALLIANCE" "" "$R_PARTNER"
echo "Kolkata Team → Baranagar (partner)"
create_rel "$TEAM_KOL" "$GRP_BARAN" "$ALLIANCE" "" "$R_PARTNER"
echo "Kolkata Team → Salt Lake (partner)"
create_rel "$TEAM_KOL" "$GRP_SALT" "$ALLIANCE" "" "$R_PARTNER"

echo ""
echo "=== AI Agent ==="
echo "Movement Analytics → Network (operated)"
create_rel "$ANALYTICS" "$NETWORK" "$ORG_CTRL" "" "$R_OPERATED"

# Seed DB
echo ""
echo "=== Seeding database ==="
cd "$ROOT_DIR/apps/web"

node -e "
const Database = require('better-sqlite3');
const db = new Database('local.db');
const ts = () => new Date().toISOString();
const id = () => require('crypto').randomUUID();

// Run migration for new tables
const fs = require('fs');
try {
  const sql = fs.readFileSync('drizzle/0002_cpm_features.sql', 'utf-8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed && trimmed.startsWith('CREATE')) {
      try { db.prepare(trimmed).run(); } catch (e) { /* already exists */ }
    }
  }
} catch {}

const users = [
  { id: 'cpm-user-001', name: 'Mark Thompson', email: 'mark@reachglobal.org', wallet: '0x00000000000000000000000000000000000a0001', privy: 'did:privy:cpm-001' },
  { id: 'cpm-user-002', name: 'Priya Sharma', email: 'priya@reachglobal.org', wallet: '0x00000000000000000000000000000000000a0002', privy: 'did:privy:cpm-002' },
  { id: 'cpm-user-003', name: 'Raj Patel', email: 'raj@localpartner.in', wallet: '0x00000000000000000000000000000000000a0003', privy: 'did:privy:cpm-003' },
  { id: 'cpm-user-004', name: 'Anita Das', email: 'anita@localpartner.in', wallet: '0x00000000000000000000000000000000000a0004', privy: 'did:privy:cpm-004' },
  { id: 'cpm-user-005', name: 'David Kim', email: 'david@sendagency.org', wallet: '0x00000000000000000000000000000000000a0005', privy: 'did:privy:cpm-005' },
  { id: 'cpm-user-006', name: 'Samuel Bose', email: 'samuel@housechurch.in', wallet: '0x00000000000000000000000000000000000a0006', privy: 'did:privy:cpm-006' },
  { id: 'cpm-user-007', name: 'Meera Ghosh', email: 'meera@housechurch.in', wallet: '0x00000000000000000000000000000000000a0007', privy: 'did:privy:cpm-007' },
];
for (const u of users) {
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(u.id);
  if (!exists) {
    db.prepare('INSERT INTO users (id,email,name,wallet_address,privy_user_id,created_at) VALUES (?,?,?,?,?,?)').run(u.id, u.email, u.name, u.wallet, u.privy, ts());
  }
}

const personAgents = [
  { userId: 'cpm-user-001', name: 'Mark Thompson', addr: '$PA_MARK' },
  { userId: 'cpm-user-002', name: 'Priya Sharma', addr: '$PA_PRIYA' },
  { userId: 'cpm-user-003', name: 'Raj Patel', addr: '$PA_RAJ' },
  { userId: 'cpm-user-004', name: 'Anita Das', addr: '$PA_ANITA' },
  { userId: 'cpm-user-005', name: 'David Kim', addr: '$PA_DAVID' },
  { userId: 'cpm-user-006', name: 'Samuel Bose', addr: '$PA_SAMUEL' },
  { userId: 'cpm-user-007', name: 'Meera Ghosh', addr: '$PA_MEERA' },
];
for (const p of personAgents) {
  const exists = db.prepare('SELECT id FROM person_agents WHERE user_id = ?').get(p.userId);
  if (!exists) {
    db.prepare('INSERT INTO person_agents (id,name,user_id,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), p.name, p.userId, p.addr, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
  }
}

const orgs = [
  { name: 'South Asia Movement Network', desc: 'Multi-agency CPM coordination across South Asia', addr: '$NETWORK', user: 'cpm-user-001', tpl: 'movement-network' },
  { name: 'Kolkata Team', desc: 'Church planting team — Bengali-speaking communities, Kolkata', addr: '$TEAM_KOL', user: 'cpm-user-002', tpl: 'church-planting-team' },
  { name: 'Baranagar Group', desc: 'House church — Baranagar neighborhood, Kolkata (G1)', addr: '$GRP_BARAN', user: 'cpm-user-006', tpl: 'local-group' },
  { name: 'Salt Lake Group', desc: 'House church — Salt Lake City, Kolkata (G2, started by Baranagar)', addr: '$GRP_SALT', user: 'cpm-user-007', tpl: 'local-group' },
];
for (const o of orgs) {
  const exists = db.prepare('SELECT id FROM org_agents WHERE smart_account_address = ?').get(o.addr);
  if (!exists) {
    db.prepare('INSERT INTO org_agents (id,name,description,created_by,smart_account_address,template_id,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id(), o.name, o.desc, o.user, o.addr, o.tpl, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
  }
}

const aiAgents = [
  { name: 'Movement Analytics', desc: 'Generational growth tracking and movement health reports', type: 'discovery', user: 'cpm-user-001', opBy: '$NETWORK', addr: '$ANALYTICS' },
];
for (const a of aiAgents) {
  const exists = db.prepare('SELECT id FROM ai_agents WHERE smart_account_address = ?').get(a.addr);
  if (!exists) {
    db.prepare('INSERT INTO ai_agents (id,name,description,agent_type,created_by,operated_by,smart_account_address,chain_id,salt,implementation_type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(), a.name, a.desc, a.type, a.user, a.opBy, a.addr, 31337, '0x' + Math.random().toString(16).slice(2,10), 'hybrid', 'deployed', ts());
  }
}

// ─── Generational Map Nodes ─────────────────────────────────────────
const networkAddr = '$NETWORK'.toLowerCase();
const genNodes = [
  // G0 — Priya (the missionary / initial planter)
  { id: 'gen-g0-priya', parent: null, gen: 0, name: 'Priya Initial Contact', leader: 'Priya Sharma', loc: 'Kolkata Central', health: { seekers: 5, believers: 3, baptized: 2, leaders: 2, giving: false, isChurch: false, groupsStarted: 2 }, status: 'multiplied' },
  // G1 — Groups started by Priya
  { id: 'gen-g1-baranagar', parent: 'gen-g0-priya', gen: 1, name: 'Baranagar Group', leader: 'Samuel Bose', loc: 'Baranagar', health: { seekers: 8, believers: 6, baptized: 4, leaders: 2, giving: true, isChurch: true, groupsStarted: 2 }, status: 'multiplied' },
  { id: 'gen-g1-howrah', parent: 'gen-g0-priya', gen: 1, name: 'Howrah Group', leader: 'Amit Roy', loc: 'Howrah', health: { seekers: 4, believers: 3, baptized: 1, leaders: 1, giving: false, isChurch: false, groupsStarted: 1 }, status: 'active' },
  // G2 — Groups started by G1 groups
  { id: 'gen-g2-saltlake', parent: 'gen-g1-baranagar', gen: 2, name: 'Salt Lake Group', leader: 'Meera Ghosh', loc: 'Salt Lake', health: { seekers: 6, believers: 4, baptized: 3, leaders: 1, giving: true, isChurch: true, groupsStarted: 1 }, status: 'multiplied' },
  { id: 'gen-g2-dunlop', parent: 'gen-g1-baranagar', gen: 2, name: 'Dunlop Group', leader: 'Ravi Sen', loc: 'Dunlop', health: { seekers: 3, believers: 2, baptized: 1, leaders: 0, giving: false, isChurch: false, groupsStarted: 0 }, status: 'active' },
  { id: 'gen-g2-shibpur', parent: 'gen-g1-howrah', gen: 2, name: 'Shibpur Group', leader: 'Deepa Mitra', loc: 'Shibpur', health: { seekers: 5, believers: 2, baptized: 0, leaders: 0, giving: false, isChurch: false, groupsStarted: 0 }, status: 'active' },
  // G3 — Groups started by G2 (the movement multiplying!)
  { id: 'gen-g3-newtown', parent: 'gen-g2-saltlake', gen: 3, name: 'New Town Group', leader: 'Kavita Dey', loc: 'New Town', health: { seekers: 7, believers: 3, baptized: 1, leaders: 0, giving: false, isChurch: false, groupsStarted: 0 }, status: 'active' },
  // G1 — Raj's stream (independent)
  { id: 'gen-g1-jadavpur', parent: null, gen: 0, name: 'Raj Initial Contact', leader: 'Raj Patel', loc: 'Jadavpur', health: { seekers: 4, believers: 2, baptized: 1, leaders: 1, giving: false, isChurch: false, groupsStarted: 1 }, status: 'active' },
  { id: 'gen-g1-garia', parent: 'gen-g1-jadavpur', gen: 1, name: 'Garia Group', leader: 'Sunil Das', loc: 'Garia', health: { seekers: 3, believers: 2, baptized: 0, leaders: 0, giving: false, isChurch: false, groupsStarted: 0 }, status: 'active' },
];

for (const n of genNodes) {
  const exists = db.prepare('SELECT id FROM gen_map_nodes WHERE id = ?').get(n.id);
  if (!exists) {
    db.prepare('INSERT INTO gen_map_nodes (id,network_address,group_address,parent_id,generation,name,leader_name,location,health_data,status,started_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(n.id, networkAddr, null, n.parent, n.gen, n.name, n.leader, n.loc, JSON.stringify(n.health), n.status, '2025-' + String(3 + n.gen * 2).padStart(2, '0') + '-15', ts());
  }
}
console.log('Gen map: 9 nodes seeded (G0-G3, 2 streams)');

// ─── Activity Logs ──────────────────────────────────────────────────
const teamAddr = '$TEAM_KOL'.toLowerCase();
const activities = [
  { user: 'cpm-user-002', type: 'outreach', title: 'Market outreach — Baranagar bazaar', desc: 'Shared gospel with 12 vendors. 3 expressed interest.', participants: 12, loc: 'Baranagar Bazaar', dur: 120, date: '2026-03-15' },
  { user: 'cpm-user-003', type: 'visit', title: 'Follow-up visit — Amit family', desc: 'Second visit to Amit and family. Discussed Mark 4. Wife Priti asked questions.', participants: 4, loc: 'Howrah', dur: 90, date: '2026-03-18' },
  { user: 'cpm-user-004', type: 'training', title: 'Discovery Bible Study training', desc: 'Trained 5 new believers in DBS facilitation method.', participants: 5, loc: 'Kolkata Central', dur: 180, date: '2026-03-20' },
  { user: 'cpm-user-002', type: 'coaching', title: 'Samuel coaching session', desc: 'Coached Samuel on facilitating group discussions and identifying emerging leaders.', participants: 2, loc: 'Baranagar', dur: 60, date: '2026-03-22' },
  { user: 'cpm-user-003', type: 'meeting', title: 'Garia group meeting', desc: 'First meeting of new group in Garia. Sunil facilitated. 3 seekers attended.', participants: 5, loc: 'Garia', dur: 90, date: '2026-03-25' },
  { user: 'cpm-user-006', type: 'prayer', title: 'Baranagar prayer gathering', desc: 'Weekly prayer meeting. 8 attended including 2 new seekers from the market.', participants: 8, loc: 'Baranagar', dur: 60, date: '2026-03-27' },
  { user: 'cpm-user-007', type: 'outreach', title: 'Salt Lake neighborhood outreach', desc: 'Door-to-door visits in new apartment complex. Shared with 6 families.', participants: 3, loc: 'Salt Lake', dur: 150, date: '2026-03-29' },
  { user: 'cpm-user-002', type: 'assessment', title: 'Monthly stream review', desc: 'Reviewed all groups in Priya stream. Dunlop group needs more attention. New Town group growing fast.', participants: 1, loc: 'Kolkata Central', dur: 60, date: '2026-04-01' },
  { user: 'cpm-user-004', type: 'service', title: 'Community clean-up with Baranagar group', desc: 'Group organized neighborhood cleanup. Good visibility with local community.', participants: 12, loc: 'Baranagar', dur: 120, date: '2026-04-03' },
  { user: 'cpm-user-003', type: 'follow-up', title: 'New believer follow-up — Priti', desc: 'Priti (Amit wife) shared she wants to be baptized. Connected her with Anita for discipleship.', participants: 2, loc: 'Howrah', dur: 45, date: '2026-04-05' },
];

let actCount = 0;
for (const a of activities) {
  const exists = db.prepare('SELECT id FROM activity_logs WHERE org_address = ? AND title = ?').get(teamAddr, a.title);
  if (!exists) {
    db.prepare('INSERT INTO activity_logs (id,org_address,user_id,activity_type,title,description,participants,location,lat,lng,duration_minutes,related_entity,activity_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id(), teamAddr, a.user, a.type, a.title, a.desc, a.participants, a.loc, null, null, a.dur, null, a.date, ts());
    actCount++;
  }
}
console.log('Activities: ' + actCount + ' logged');

console.log('');
console.log('=== CPM demo seeded ===');
console.log('  South Asia Movement Network — Mark (Director), David (Strategy)');
console.log('  Kolkata Team — Priya (Leader), Raj (Planter), Anita (Partner)');
console.log('  Baranagar Group — Samuel (Leader, G1)');
console.log('  Salt Lake Group — Meera (Leader, G2)');
console.log('  Gen Map: 9 nodes across G0-G3 (2 streams, 2 churches)');
console.log('  Activities: 10 logged (outreach, visits, training, coaching)');
"

echo ""
echo "=== Church Planting Movement seeded ==="
