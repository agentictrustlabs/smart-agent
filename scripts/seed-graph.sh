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

# Seed the web app DB
echo ""
echo "=== Seeding database ==="
cd "$ROOT_DIR/apps/web"
node -e "
const Database = require('better-sqlite3');
const db = new Database('local.db');
db.prepare('DELETE FROM person_agents').run();
db.prepare('DELETE FROM org_agents').run();
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
db.prepare('INSERT INTO person_agents VALUES (?,?,?,?,?,?,?,?)').run(id(),'test-user-001','$ALICE_AGENT',31337,'0x1','hybrid','deployed',ts());
db.prepare('INSERT INTO person_agents VALUES (?,?,?,?,?,?,?,?)').run(id(),'test-user-002','$BOB_AGENT',31337,'0x2','hybrid','deployed',ts());
db.prepare('INSERT INTO person_agents VALUES (?,?,?,?,?,?,?,?)').run(id(),'test-user-003','$CAROL_AGENT',31337,'0x3','hybrid','deployed',ts());

// Org agents
db.prepare('INSERT INTO org_agents VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),'Agentic Trust Labs','Agent trust, identity, and reputation research','test-user-001','$ORG_ATL',31337,'0x4','hybrid','deployed',ts());
db.prepare('INSERT INTO org_agents VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),'DeFi Protocol DAO','Decentralized finance governance','test-user-001','$ORG_DEFI',31337,'0x5','hybrid','deployed',ts());

console.log('DB seeded: 3 people (Alice, Bob, Carol), 2 orgs');
"

echo ""
echo "=== Trust graph seeded ==="
echo "Agents: Alice, Bob, Carol, ATL, DeFi DAO"
echo "Edges: 9 relationships across Governance, Membership, Alliance, Insurance, Economic Security, Service"
