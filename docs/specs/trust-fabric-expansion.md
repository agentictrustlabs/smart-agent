# Trust Fabric Expansion — PM Spec

## Vision

Expand from a relationship graph into a full **Agent Trust Fabric**: nodes are agents/assets/runtimes, edges are typed relationships, assertions carry provenance from typed issuers, and validation mechanisms qualify claims for policy decisions.

## Vocabulary Taxonomy

### Node Types
| Type | Examples |
|------|---------|
| `person` | Individual human agent (4337 account) |
| `organization` | Org agent (4337 account) |
| `service` | Service/app agent |
| `validator` | Claim validation service |
| `insurer` | Insurance provider |
| `staking-pool` | Economic security pool |
| `tee-runtime` | TEE execution environment |
| `verifier` | TEE/ZK verifier contract |
| `alliance` | Consortium/network/coalition |
| `policy` | Insurance policy instrument |

### Relationship Types (8 categories)

**A. Governance / Control**
- `OrganizationGovernance` — board-member, ceo, executive, treasurer, authorized-signer, officer, chair, advisor

**B. Membership / Institutional**
- `OrganizationMembership` — admin, member, operator, employee, contractor
- `Alliance` — strategic-partner, affiliate, endorsed-by, recognized-by, subsidiary, parent

**C. Assurance / Compliance**
- `ValidationTrust` — validator, auditor, certified-by, assessed-by
- `InsuranceCoverage` — insurer, insured-party, underwriter, broker
- `Compliance` — licensed-by, accredited-by, compliant-with, monitored-by

**D. Economic Security**
- `EconomicSecurity` — staker, guarantor, backer, collateral-provider, slashable-under

**E. Service / Execution**
- `ServiceAgreement` — vendor, service-provider, delegated-operator, acts-on-behalf-of
- `DelegationAuthority` — delegated-operator, authorized-signer, session-holder

**F. Runtime / TEE**
- `RuntimeAttestation` — runs-in-tee, attested-by, verified-by, bound-to-kms
- `BuildProvenance` — built-from, deployed-from, reproduced-by

### Issuer Types
| Type | Who | What they issue |
|------|-----|-----------------|
| `self` | The subject agent | Self-asserted claims |
| `counterparty` | The object agent | Counterparty confirmation |
| `organization` | An org agent | Role assignments, membership |
| `validator` | Trusted validator service | Identity verification, compliance |
| `insurer` | Insurance provider | Coverage attestations |
| `auditor` | Audit firm | Audit reports, certifications |
| `tee-verifier` | TEE verification contract | Runtime attestations |
| `staking-pool` | Staking/bond pool | Economic security proofs |
| `governance` | Governance body | Governance decisions |
| `oracle` | Oracle service | External data attestations |

### Validation Methods
| Method | Description |
|--------|-------------|
| `self-asserted` | No external validation |
| `counterparty-confirmed` | Object confirmed |
| `mutually-confirmed` | Both parties confirmed |
| `validator-verified` | Trusted validator checked |
| `insurer-issued` | Insurance provider attested |
| `tee-onchain-verified` | TEE quote verified on-chain |
| `tee-offchain-aggregated` | TEE quote verified off-chain, signature on-chain |
| `zk-verified` | Zero-knowledge proof verified |
| `reproducible-build` | Deterministic build verified |
| `governance-approved` | Governance vote/decision |
| `oracle-attested` | Oracle data feed |

## Contract Additions

### New: `AgentIssuerProfile.sol`
Registers issuer agents with their type, supported claim types, and validation methods.

### New: `AgentValidationProfile.sol`
Records how a specific assertion was validated — verifier contract, method, evidence.

### Updated: `AgentRelationship.sol`
- Add node type awareness (nodeType field or separate node registry)
- Add new relationship type and role constants

### Updated: `AgentAssertion.sol`
- Add `issuerType` field to AssertionRecord
- Add `validationMethod` field
- Add `validationProfileId` reference

### Updated: `AgentRelationshipTemplate.sol`
- Add templates for TEE, insurance, staking patterns

### Updated: `AgentRelationshipResolver.sol`
- Add resolution profiles for governance, insurance, economic security, TEE

## Implementation Sprints

### Sprint A: Issuer & Validation Layer (contracts + SDK)
1. `AgentIssuerProfile.sol` — register issuers with types and capabilities
2. `AgentValidationProfile.sol` — record validation evidence per assertion
3. Update `AgentAssertion.sol` — add issuerType and validationMethod
4. SDK wrappers and ABIs
5. Forge tests

### Sprint B: Extended Vocabulary (contracts + seed)
1. Add all new relationship types and roles to `AgentRelationship.sol`
2. Add TEE-specific constants (RuntimeAttestation, BuildProvenance)
3. Create templates for governance, insurance, staking, TEE patterns
4. Extend seed script with full example graph
5. Forge tests

### Sprint C: Web App — Issuer & Template Management
1. Issuers page — view registered issuers with types and capabilities
2. Templates page — extended with new categories
3. Create relationship page — expanded role/type selectors
4. Graph visualization — show issuer types, validation methods, node types

### Sprint D: Web App — Trust Resolution UI
1. Trust query page — "Does agent X have valid insurance?" / "Is this TEE attested?"
2. Resolution mode selector — pick qualification level
3. Trust path visualization — show which edges, assertions, and validations contribute
4. Dashboard trust score summary

## Example Full Graph (seed target)

```
=== People ===
Alice (Person) ──[ceo, owner, auth-signer]──► ATL (Org)         Governance
Bob (Person)   ──[board-member]──────────────► ATL               Governance  
Bob            ──[admin, member]─────────────► ATL               Membership
Carol (Person) ──[auditor, validator]────────► ATL               Membership

=== Delegation ===
Alice ──[delegated-op, auth-signer]──► ATL                      Delegation
Bob   ──[delegated-operator]─────────► DeFi DAO                 Delegation

=== Alliance ===
ATL ──[strategic-partner]──► DeFi DAO                           Alliance

=== Insurance ===
InsureCo (Insurer) ──[insurer]──► ATL                           InsuranceCoverage
ATL ──[insured-party]──► InsureCo                               InsuranceCoverage

=== Economic Security ===
Bob ──[staker]──► StakePool (Pool)                              EconomicSecurity
StakePool ──[guarantor]──► DeFi DAO                             EconomicSecurity

=== Validation ===
TrustValidator (Validator) ──[validator]──► Alice               ValidationTrust
TrustValidator ──[validator]──► ATL                             ValidationTrust

=== TEE / Runtime ===
ATL-Runtime (TEE) ──[runs-in-tee]──► NitroVerifier (Verifier)  RuntimeAttestation
ATL-Runtime ──[attested-by]──► TrustValidator                   RuntimeAttestation
ATL ──[controls-runtime]──► ATL-Runtime                         RuntimeAttestation

=== Issuers ===
TrustValidator — type: validator, methods: [validator-verified, tee-onchain-verified]
InsureCo — type: insurer, methods: [insurer-issued]
StakePool — type: staking-pool, methods: [self-asserted]
```
