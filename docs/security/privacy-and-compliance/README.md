# Privacy and Compliance — Document Set

> **Status: DRAFT — internal review.**
> **Intended audience: external counsel, board / advisory committee, prospective enterprise customers.**
> **Last updated: 2026-05-18.**
>
> **Every legal interpretation in this document set MUST be reviewed by qualified counsel licensed in the jurisdictions where Smart Agent operates (EU, UK, US-federal, US-state) before any customer-facing commitment is made.**

## Purpose

Smart Agent is an **Agent Smart Account Kit** with two privacy properties that are unusually load-bearing:

1. **Custodial wallet model.** Person-MCP holds each user's AnonCreds vault, link secret, profile data, prayer/oikos/relationship records, intents, and notifications. Users do **not** self-custody credentials in v1. This means Smart Agent is a **data controller and joint-processor** for almost every category of personal data we touch — not a passive conduit.
2. **On-chain immutability.** Smart accounts, delegations, role assignments, geo claims, intent assertions, pledges, votes, attestations, and disbursements live on a permissioned EVM chain (Anvil in dev; permissioned L2 in prod). They **cannot be deleted**. This sits in fundamental tension with GDPR Article 17 (right to erasure).

This document set specifies how we resolve that tension, what we commit to customers, and what controls and procedures we implement to remain compliant with GDPR, CCPA / CPRA, UK GDPR, and (where applicable) HIPAA + COPPA + sectoral US laws (BSA, GLBA).

## Reading order

Read in numeric order on first pass. P1, P3, and P5 are the most legally complex.

| # | Title | Length target | Topic |
|---|---|---|---|
| [P1](./P1-gdpr-article-17-right-to-erasure.md) | GDPR Article 17 — Right to Erasure | 700–1100 lines | On-chain immutability vs erasure right; pseudonymization defense; deletion SOP |
| [P2](./P2-data-residency.md) | Data Residency | 500–800 lines | Where each store actually lives; EU vs US recipes; SCCs and adequacy |
| [P3](./P3-pii-classification-per-service.md) | PII Classification per Service | 800–1200 lines | Per-table, per-column classification across web, person-MCP, org-MCP, geo-MCP, A2A, GraphDB |
| [P4](./P4-data-retention-policies.md) | Data Retention Policies | 500–800 lines | Per-class retention windows; automated purge; legal hold |
| [P5](./P5-consent-ux-for-delegation-grants.md) | Consent UX for Delegation Grants | 600–1000 lines | What the user sees before authorizing delegation; revocation UX; high-risk action confirmations |
| [P6](./P6-right-of-access-export.md) | Right of Access — Data Export | 500–800 lines | GDPR Article 15 / CCPA §1798.110 SOP and implementation |
| [P7](./P7-portability-did-credential-export.md) | Portability — DID / Credential Export | 500–800 lines | GDPR Article 20; W3C DID + VC export targets; AnonCreds portability |
| [P8](./P8-data-minimization-audit.md) | Data Minimization Audit | 500–800 lines | Quarterly audit cadence and template; initial punch list |
| [P9](./P9-sub-processor-inventory.md) | Sub-Processor Inventory | 400–600 lines | Vercel, AWS, GCP, GraphDB.agentkg.io, etc.; DPA status |
| [P10](./P10-soc2-type2-readiness.md) | SOC 2 Type 2 Readiness | 700–1100 lines | AICPA TSC mapping; auditor selection; cost; timeline |
| [P11](./P11-breach-notification-procedures.md) | Breach Notification Procedures | 500–800 lines | GDPR Art 33/34, US state SLAs, internal IR runbook |
| [P12](./P12-special-categories-and-hipaa.md) | Special Categories and HIPAA | 400–600 lines | GDPR Art 9 special categories; HIPAA applicability; COPPA |

## Cross-cutting themes (the four threads)

Every document below weaves these threads.

### 1. Custodial wallet model

Person-MCP holds the AnonCreds vault on the server. The link secret — the cryptographic secret that binds every credential to a single holder identity and underpins selective-disclosure unlinkability — sits in the Askar wallet on the MCP host. The user has no separate keystore; their session is what authorizes person-MCP to act on their behalf.

**Implications:**
- Smart Agent is a **custodian of identity material**, not merely of profile data. A person-MCP compromise is approximately as severe as a password-manager compromise plus a wallet compromise plus a credential vault compromise.
- AnonCreds' selective-disclosure and predicate-proof properties are still cryptographically present, but the **anti-correlation benefit to the user** is partially eroded — the custodian sees every presentation. We address this in P3 (classification) and P5 (consent UX).
- "Self-custody" is on the roadmap (see Phase H, open question H2) but is **not v1**.

### 2. On-chain immutability

Items written on chain include:

| Artifact | Contract | Deletable? |
|---|---|---|
| `AgentAccount` deployment | `AgentAccountFactory` | **No.** Bytecode is permanent at the CREATE2 address. |
| `AgentName → address` mapping | `AgentNameResolver` | Can be **reassigned** (resolver writes), not deleted from history. |
| Trust relationships | `AgentRelationship` | Can be **revoked** (new edge), not deleted from history. |
| Delegations | `DelegationManager` | Can be **revoked** (`revokeDelegation`), not deleted. |
| Geo claims | `GeoClaimRegistry` | Can be **superseded**, not deleted. |
| Intent assertions, pool pledges, grant proposals, votes | spec 001–004 registries | Status transitions only; cannot remove the record. |
| AnonCreds credential definitions, schema definitions, revocation registries | registry contracts | Cannot delete; only mark revoked. |

**Implications:**
- We **must disclose at signup** that on-chain records are permanent (P1, P5).
- We rely on **pseudonymization** (off-chain identifier → on-chain address mapping severance) as our primary erasure response for on-chain records (P1).
- Some on-chain records also serve as financial / audit records subject to **mandatory retention** (US BSA: 5 years; SOX-adjacent: 7 years). Even if erasure were technically possible, regulatory retention would override.

### 3. Cross-jurisdictional

We expect users from:
- **EU member states** — GDPR (Regulation (EU) 2016/679) applies.
- **United Kingdom** — UK GDPR + DPA 2018 applies; substantially mirrors EU GDPR.
- **United States — California** — CCPA (Cal. Civ. Code §§ 1798.100 et seq.) as amended by CPRA (effective 2023-01-01, fully enforced 2024-03-29) applies.
- **United States — other states with comprehensive privacy laws (2024–2026)** — Virginia (VCDPA), Colorado (CPA), Connecticut (CTDPA), Utah (UCPA), Texas (TDPSA, effective 2024-07-01), Oregon (OCPA, effective 2024-07-01), Montana (MTCDPA, effective 2024-10-01), Iowa, Tennessee, Delaware (effective 2025-01-01), and others.
- **United States — sectoral** — BSA (where financial), GLBA (where financial-services), HIPAA (where health), COPPA (where children).
- **Togo + West Africa** — Loi n°2019-014 du 29 octobre 2019 relative à la protection des données à caractère personnel (Togo's data-protection law) and ECOWAS Supplementary Act A/SA.1/01/10. Onboarding from this region is part of the project's intended demographic.

**Implications:**
- We pick a **single high-water-mark** posture (GDPR-equivalent) and apply it globally for technical controls; we then surface jurisdiction-specific rights (CCPA "Do Not Sell or Share," Virginia "Right to Opt-Out of Profiling") in the consent UX.
- We need **cross-border transfer mechanisms** (Standard Contractual Clauses / UK IDTA / Togo bilateral adequacy) where data flows between regions (P2, P9).

### 4. AnonCreds privacy properties

AnonCreds (Hyperledger Indy / AnonCreds 2.0) provides:
- **Selective disclosure** — present a subset of attributes without revealing the others.
- **Predicate proofs** — prove `age >= 18` without revealing date of birth.
- **Unlinkability** — two presentations of the same credential to two different verifiers are cryptographically unlinkable, *if the link secret is held by the user*.

**The custodial model erodes property #3** because Smart Agent holds the link secret, so we can correlate presentations across verifiers internally. This is the central privacy trade-off of the v1 product. P3 marks affected fields and P5 requires explicit disclosure.

## Glossary

| Term | Definition |
|---|---|
| **AnonCreds** | Hyperledger zero-knowledge credential format (v1.0 / v2.0). |
| **Article 17** | GDPR Article 17, "Right to erasure (right to be forgotten)." |
| **Askar** | Hyperledger Aries secure-storage wallet ([github.com/hyperledger/aries-askar](https://github.com/hyperledger/aries-askar)). |
| **CCPA / CPRA** | California Consumer Privacy Act / California Privacy Rights Act. |
| **DID** | W3C Decentralized Identifier ([w3.org/TR/did-core](https://www.w3.org/TR/did-core/)). |
| **DPA** | Data Processing Agreement (GDPR Article 28). |
| **DPIA** | Data Protection Impact Assessment (GDPR Article 35). |
| **DSAR** | Data Subject Access Request (GDPR Article 15 / CCPA § 1798.110). |
| **GLBA** | Gramm-Leach-Bliley Act (US financial-services privacy). |
| **HIPAA** | Health Insurance Portability and Accountability Act + Privacy Rule (45 CFR §§ 160, 164). |
| **Link secret** | AnonCreds master secret binding all credentials to a single holder. |
| **Person-MCP** | Per-user MCP server holding profile, vault, oikos, intents — see `apps/person-mcp/`. |
| **Org-MCP** | Per-org MCP server holding org-private data — see `apps/org-mcp/`. |
| **PII** | Personally Identifiable Information. |
| **SCC** | Standard Contractual Clauses (EU Commission Decision 2021/914 for international transfers). |
| **TSC** | Trust Services Criteria (AICPA SOC 2 framework). |
| **VC** | W3C Verifiable Credential ([w3.org/TR/vc-data-model](https://www.w3.org/TR/vc-data-model-2.0/)). |

## Status of each document

| # | Status | Owner draft | Counsel review | Board review |
|---|---|---|---|---|
| P1 | Draft | Security agent | Pending | Pending |
| P2 | Draft | Security agent | Pending | Pending |
| P3 | Draft | Security agent | Pending | Pending |
| P4 | Draft | Security agent | Pending | Pending |
| P5 | Draft | Security agent + UX | Pending | Pending |
| P6 | Draft | Security agent | Pending | Pending |
| P7 | Draft | Security agent + Ontologist | Pending | Pending |
| P8 | Draft | Security agent | Pending | Pending |
| P9 | Draft | Security + Infra | Pending | Pending |
| P10 | Draft | Security agent | Pending | Pending |
| P11 | Draft | Security agent | Pending | Pending |
| P12 | Draft | Security agent | Pending | Pending |

## Related internal documents

- **Architecture** — [`docs/architecture/principles.md`](../../architecture/principles.md), [`docs/architecture/11-production-threat-model.md`](../../architecture/11-production-threat-model.md), [`docs/architecture/12-production-boundary-change-plan.md`](../../architecture/12-production-boundary-change-plan.md)
- **Information Architecture** — [`docs/information-architecture/09-privacy-audit.md`](../../information-architecture/09-privacy-audit.md)
- **Security posture** — [`docs/security/cryptographic-posture/`](../cryptographic-posture/), [`docs/security/key-management/`](../key-management/), [`docs/security/runtime/`](../runtime/), [`docs/security/smart-contracts/`](../smart-contracts/)
- **Hardening plan** — [`specs/007-architecture-hardening/phase-H-privacy-and-iac.md`](../../../specs/007-architecture-hardening/phase-H-privacy-and-iac.md)
- **Implementation plans** — [`output/KMS-IMPLEMENTATION-PLAN.md`](../../../output/KMS-IMPLEMENTATION-PLAN.md), [`output/GCP-KMS-IMPLEMENTATION-PLAN.md`](../../../output/GCP-KMS-IMPLEMENTATION-PLAN.md)

## How to update

This document set is **versioned**. Material changes require:
1. PR with red-line diff against the prior version.
2. Sign-off from Security agent + IA agent + Documentarian.
3. Counsel review on any clause marked **[CONSULT COUNSEL]** in the text.
4. Board / advisory-committee review for jurisdictional commitments (P2 residency map, P9 sub-processor list, P11 breach SLAs).

The version history of this set is captured in `git log -- docs/security/privacy-and-compliance/`. The current revision is whatever `HEAD` shows.

## A note on residual risk

Every document below ends with a **Residual risk** section. We are honest: privacy law and immutable infrastructure do not yet fit together neatly. We document the gap, we choose a defensible posture, we mitigate where we can, and we disclose the rest. Anyone using this document set as a sales artifact MUST preserve the residual-risk sections — stripping them is misrepresentation.
