# Test Personas — QA Plan

## Persona 1: Alex (Org Administrator)
**Goal:** Deploy org, add team members, create governance relationships
**Flow:**
1. Connect wallet via Privy
2. Deploy Person Agent → verify 4337 account on-chain
3. Deploy Org Agent "Test Corp" → verify factory call
4. Go to Relationships → create: Alex is `owner` of Test Corp (OrganizationGovernance)
5. Go to Relationships → create: Alex is `admin, member` of Test Corp (OrganizationMembership)
6. Check Dashboard → verify org shows both edges with roles
7. Check Graph → click Alex node → verify 2 connected edges

## Persona 2: Dana (Reviewer)
**Goal:** Review an AI agent's performance
**Flow:**
1. Connect wallet
2. Deploy Person Agent
3. Go to Relationships → create: Dana is `reviewer` of Discovery AI Agent (ReviewRelationship)
4. Check Graph → click Discovery AI Agent → verify Dana appears in reviewer connections
5. Check that review has metadata URI

## Persona 3: Victor (Validator)
**Goal:** Validate agent activities
**Flow:**
1. Connect wallet
2. Deploy Person Agent
3. Go to Issuers → verify registered validators visible
4. Go to Relationships → create: Victor is `activity-validator` of Discovery AI Agent
5. Check Graph → verify Activity Validation edge appears

## Persona 4: Iris (Insurance Provider)
**Goal:** Provide insurance coverage to an org
**Flow:**
1. Connect wallet
2. Deploy Org Agent "Iris Insurance"
3. Go to Relationships → create: Iris Insurance is `insurer` of ATL (InsuranceCoverage)
4. Check Dashboard → verify insurance edge on ATL card
5. Check Graph → verify Insurance edge (purple) visible

## Persona 5: Sam (TEE Operator)
**Goal:** Verify runtime attestation chain
**Flow:**
1. Check Graph → click ATL TEE Runtime → verify attested-by TrustValidator
2. Check Graph → click Discovery TEE → verify attested-by TrustValidator
3. Verify both TEE nodes show Runtime/TEE edges
4. Check Issuers → verify TEE Runtime registered as tee-verifier issuer

## Test Matrix

| Page | Test | Expected |
|------|------|----------|
| `/` | Load landing page | Shows "Connect Wallet" or "Connected" |
| `/dashboard` | View agents | Person + Org agents with DIDs, edges, roles |
| `/deploy/person` | Deploy agent | Factory creates 4337 account, DB stores address |
| `/deploy/org` | Deploy org | Factory creates 4337 account with org name |
| `/relationships` | Create edge | 3 txns: createEdge → setEdgeStatus → makeAssertion |
| `/relationships` | View edges | Active edges table with roles and status |
| `/templates` | View templates | 6 template cards with role/type/caveats |
| `/issuers` | View issuers | 6 issuer cards with types and validation methods |
| `/graph` | Load graph | 16 nodes, 28 edges, color-coded |
| `/graph` | Click node | Detail panel shows relationships + templates |
| `/graph` | Click edge | Edge detail with roles, status, templates |
| `/api/graph` | API response | JSON with nodes, edges, templates |
