# Agent Trust Fabric — Product Backlog

## Prioritized by PM — answers four trust questions:
1. **Who controls this agent?** (governance, leadership, org control)
2. **What runtime/assurance environment?** (TEE, provenance, deployment chain)
3. **Who validates, reviews, insures, backs, governs?** (issuers, reviewers, validators)
4. **What facts count toward trust in context?** (resolver profiles, trust policies)

---

## P1 — Already Implemented

| # | Feature | Status |
|---|---------|--------|
| 1 | AgentAccount + Factory (ERC-4337) | Done |
| 2 | DelegationManager + 4 caveat enforcers | Done |
| 3 | AgentRelationship (multi-role edges) | Done |
| 4 | AgentAssertion (provenance/claims) | Done |
| 5 | AgentRelationshipResolver (5 resolution modes) | Done |
| 6 | AgentRelationshipTemplate (role→delegation mapping) | Done |
| 7 | AgentIssuerProfile (typed claim issuers) | Done |
| 8 | AgentValidationProfile (TEE arch, verifier, evidence) | Done |
| 9 | 12 relationship types, 40+ roles | Done |
| 10 | Seeded graph: 16 nodes, 28 edges, 6 issuers, 6 templates | Done |
| 11 | Web app: dashboard, deploy, relationships, templates, issuers, graph | Done |

---

## P2 — Next Sprint (High Value)

### 2a. Runtime & Deployment Chain
- [ ] `realized-by-runtime`, `hosts-endpoint-for`, `uses-kms`, `bound-to-key`, `bound-to-session-account`
- [ ] Build provenance links: `built-from-source`, `linked-to-commit`, `verified-build-of`, `derived-from-image`
- [ ] Key/custody: `controls-key-for`, `custodies-key-for`, `session-key-for`, `binds-key-to-runtime`

### 2b. Structured Reviews & Reputation
- [ ] Review dimensions: accuracy, reliability, responsiveness, compliance, safety, transparency
- [ ] Review claim types: `recommends`, `endorses`, `flags`, `disputes`
- [ ] Review aggregation in resolver (average score, threshold checks)
- [ ] Web UI: review submission form, review display on agent detail

### 2c. Dispute & Adverse Signals
- [ ] Negative relationship types: `disputed-by`, `flagged-by`, `sanctioned-by`, `suspended-by`, `revoked-by`
- [ ] Dispute resolution workflow
- [ ] Graph visualization: red edges for disputes/flags

### 2d. Trust Resolver Profiles
- [ ] Named trust profiles: discovery, execution, governance, insurance, economic, runtime
- [ ] Each profile defines: required relationship types, required issuer types, required validation methods
- [ ] Web UI: "Trust Query" page — select agent + profile → see pass/fail with contributing evidence

---

## P3 — Following Sprint

### 3a. Activity-Level Trust
- [ ] Activity tracking: `performed-activity`, `validated-activity`, `reviewed-activity`
- [ ] Output attestation: `generated-output`, `approved-output`, `attested-output`
- [ ] Activity-specific assertions (link assertion to activity ID)

### 3b. Capability & Authority Graph
- [ ] `acts-on-behalf-of`, `authorized-for`, `session-for`, `can-execute-template`, `can-use-toolset`
- [ ] Connect to delegation templates (template → capability → relationship)

### 3c. Expanded Institutional Network
- [ ] `member-of-network`, `recognized-by`, `subsidiary-of`, `parent-of`
- [ ] Alliance trust propagation in resolver

### 3d. Extended Assurance & Compliance
- [ ] `accredited-by`, `assessed-by`, `monitored-by`
- [ ] Compliance attestation schema

---

## P4 — Future

### 4a. Broader Node Types
- [ ] Explicit node type registry: person, org, agent, runtime, app, TEE, verifier, validator, reviewer, insurer, pool, policy, alliance, credential, evidence
- [ ] Node type icons in graph visualization

### 4b. Trust Score Computation
- [ ] Weighted trust score per agent per profile
- [ ] Dashboard trust summary (traffic light: green/yellow/red per trust dimension)

### 4c. Governance Depth
- [ ] Full leadership chain visualization
- [ ] Board composition display
- [ ] Governance approval workflows

### 4d. Cross-Chain Trust
- [ ] Trust assertions that reference agents on other chains
- [ ] Bridge/relay patterns for cross-chain trust resolution

---

## Taxonomy Reference

### Relationship Types (15 total)
| Category | Types |
|----------|-------|
| Governance | OrganizationGovernance, OrganizationalControl |
| Institutional | OrganizationMembership, Alliance |
| Assurance | ValidationTrust, InsuranceCoverage, Compliance |
| Economic | EconomicSecurity |
| Service | ServiceAgreement, DelegationAuthority |
| Runtime | RuntimeAttestation, BuildProvenance |
| Feedback | ActivityValidation, ReviewRelationship |

### Roles (47 total)
| Category | Roles |
|----------|-------|
| Governance | owner, board-member, ceo, executive, treasurer, authorized-signer, officer, chair, advisor |
| Control | operated-agent, managed-agent, administers |
| Membership | admin, member, operator, employee, contractor |
| Assurance | auditor, validator, insurer, insured-party, underwriter, certified-by, licensed-by |
| Economic | staker, guarantor, backer, collateral-provider |
| Alliance | strategic-partner, affiliate, endorsed-by, subsidiary, parent-org |
| Service | vendor, service-provider, delegated-operator |
| Runtime | runs-in-tee, attested-by, verified-by, bound-to-kms, controls-runtime, built-from, deployed-from |
| Validation | activity-validator, validated-performer |
| Review | reviewer, reviewed-agent |

### Issuer Types (10)
self, counterparty, organization, validator, insurer, auditor, tee-verifier, staking-pool, governance, oracle

### Validation Methods (11)
self-asserted, counterparty-confirmed, mutually-confirmed, validator-verified, insurer-issued, tee-onchain-verified, tee-offchain-aggregated, zk-verified, reproducible-build, governance-approved, oracle-attested
