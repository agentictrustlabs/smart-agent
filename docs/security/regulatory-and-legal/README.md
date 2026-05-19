# Smart Agent — Regulatory & Legal Planning Suite

> **Status**: PLANNING ARTIFACTS — NOT LEGAL ADVICE.
>
> Every document in this directory is a project plan for the legal work
> Smart Agent must commission from outside counsel before any meaningful
> customer rollout. These are written by engineering + product leadership
> to scope counsel engagements, identify the highest-blast-radius
> questions, and bound the cost and timing of the legal phase.
>
> **Nothing in this directory is legal advice. Nothing here should be
> relied upon as a substitute for counsel. All conclusions are tentative
> and may be reversed by qualified outside counsel familiar with the
> specific jurisdictions in scope.**

---

## Why this suite exists

Smart Agent is an ERC-4337 smart-account framework with three properties
that together create non-trivial regulatory exposure:

1. **Money movement.** Spec 005 (Pledge Honor + Personal Treasury) wires
   MockUSDC today and is designed to wire real USDC tomorrow. Pledges,
   honor settlements, and grant disbursements move stablecoin between
   user-owned smart accounts. The server signs (or relays) the userOps.
2. **Credential issuance.** Spec 004 (AnonCreds-Gated Marketplace Auth)
   issues AnonCreds credentials that confer eligibility to vote, submit
   proposals, and pledge. Pseudonymous-but-linkable credentials sit in a
   custodial holder wallet today (`person-mcp` Askar).
3. **Server-mediated authority.** Until Spec 007 lands, the deployer key
   co-signs many user actions. Even after Spec 007, the master signs
   bundler envelopes and session-delegation envelopes. The server is in
   the path of money movement, not adjacent to it.

Each of these triggers a different regulatory regime. None of them have
been opined on by counsel. Until they are, **Smart Agent must remain in
testnet / closed-cohort posture**.

## Reading order

| Order | Document | What it answers | Approx. counsel cost |
|------:|---|---|---|
| 1 | [`RL1-money-transmitter-license-analysis.md`](./RL1-money-transmitter-license-analysis.md) | Is Smart Agent a money transmitter under FinCEN + state law? Is the EU CASP regime in scope? What are the operational alternatives? | **$25k–$75k** for an opinion letter; $200k–$1.5M+ over 24 months if MTL path is chosen |
| 2 | [`RL2-securities-analysis.md`](./RL2-securities-analysis.md) | Are pool pledges, treasury constructs, credentials, or any future token a security under Howey? | $15k–$30k |
| 3 | [`RL3-tax-reporting-1099-and-international.md`](./RL3-tax-reporting-1099-and-international.md) | 1099-MISC / 1099-K / 1099-NEC obligations; DAC8; CARF; per-recipient roll-ups; pseudonymous-recipient edge cases | $10k–$25k initial scoping + ongoing tax counsel |
| 4 | [`RL4-ofac-sanctions-screening.md`](./RL4-ofac-sanctions-screening.md) | SDN/sanctions screening obligations; smart-contract-as-SDN risk; vendor selection (Chainalysis, TRM Labs, Elliptic) | $5k–$15k for compliance program review; $20k–$100k/yr for vendor SaaS |
| 5 | [`RL5-kyc-aml-high-risk-flows.md`](./RL5-kyc-aml-high-risk-flows.md) | Tiered KYC; AML transaction monitoring; SAR procedures; CDD/EDD; identity vendor selection | $10k–$30k for AML program build-out + ongoing |
| 6 | [`RL6-tos-privacy-acceptable-use.md`](./RL6-tos-privacy-acceptable-use.md) | TOS / Privacy / AUP / Cookie / Dispute policy drafts; GDPR + CCPA posture; click-wrap + re-accept flow | $5k–$15k for initial drafts |
| 7 | [`RL7-liability-framework.md`](./RL7-liability-framework.md) | Limitation of liability + indemnification; cyber, E&O, D&O insurance; smart-contract-risk disclosures | $5k–$10k for policy review + $20k–$200k/yr premium |

## Cross-cutting principles

- **Substrate independence (P1 from `docs/architecture/principles.md`)** —
  Smart Agent builds its own substrate. We do not get "for free" any of
  the regulatory work that Safe / Privy / MetaMask Delegation Toolkit /
  Aragon / Llama / Endaoment / Bulla have done on their own products.
  Their licenses, opinion letters, and KYC vendors do not cover us.
- **No silent fallbacks (Spec 007 Phase A goal #4)** — every regulatory
  invariant must be observable. If sanctions screening fails open, that
  is an audit-visible incident, not a `console.warn`.
- **On-chain is source of truth (P2)** — the immutability + public-ledger
  nature of the chain affects every regulatory analysis. It cuts both
  ways: easier auditability + worse data-subject-rights story.
- **Pseudonymity ≠ anonymity** — AnonCreds, nullifier-keyed rows, and
  passkey-only auth give us pseudonymity. Sanctions screening, KYC, and
  1099 reporting often require linkable identity to a real person. The
  product's privacy posture is in direct tension with these regimes.

## Counsel-engagement plan

### Phase 0 — Pre-engagement (ENGINEERING-OWNED, COMPLETE WHEN THIS SUITE LANDS)

Outputs:

- This document suite.
- A one-page "regulatory question matrix" pulled from RL1 § Decision
  Framework that frames the threshold questions for counsel.
- Activity-surface inventory from RL1 § Activity Surface — the literal
  list of code paths that move money on behalf of users.

### Phase 1 — Threshold opinion (WEEKS 1–6, $40k–$100k)

Engage one of:

- **DLA Piper** (Blockchain & Digital Assets practice;
  [https://www.dlapiper.com/en-us/insights/topics/blockchain-and-digital-assets](https://www.dlapiper.com/en-us/insights/topics/blockchain-and-digital-assets))
- **Cooley LLP** (Fintech + Blockchain;
  [https://www.cooley.com/services/practice/fintech](https://www.cooley.com/services/practice/fintech))
- **Wilson Sonsini** (Fintech & Financial Services;
  [https://www.wsgr.com/en/services/practices/financial-services-and-fintech.html](https://www.wsgr.com/en/services/practices/financial-services-and-fintech.html))
- **Anderson Kill** (specialist crypto + insurance;
  [https://www.andersonkill.com/Practice/Cryptocurrency](https://www.andersonkill.com/Practice/Cryptocurrency))
- **Steptoe** (Blockchain & Cryptocurrency;
  [https://www.steptoe.com/en/services/practices/blockchain-and-cryptocurrency.html](https://www.steptoe.com/en/services/practices/blockchain-and-cryptocurrency.html))

Deliverables from counsel:

- MTL opinion letter (RL1) — is Smart Agent a money transmitter in the
  US, in each launch state, and in the EU as a CASP?
- Securities posture memo (RL2) — short memo confirming pool / treasury
  constructs aren't currently securities; note token-future caveats.
- Tax compliance roadmap (RL3) — confirms 1099 obligations, scoping for
  TIN-collection program build, DAC8 readiness.
- AML/sanctions program design (RL4 + RL5) — formal program document
  required for any MTL application; also required if positioning as a
  technology provider to a licensed entity.

### Phase 2 — Implementation (WEEKS 6–26, $200k–$1M+)

If counsel says **"money transmitter"**: MTL application phase. Plan
$200k–$1.5M+ over 18–24 months depending on state footprint. See RL1 §
Cost Model.

If counsel says **"agent of receiver" or "non-custodial"**: still need
TOS/AUP/Privacy ($15k–$30k), KYC for high-risk flows ($30k–$80k/yr +
per-verification), sanctions screening SaaS ($20k–$100k/yr), insurance
($20k–$200k/yr).

### Phase 3 — Ongoing compliance (PER-YEAR)

Steady-state budget for compliance (assuming non-MTL outcome):

| Line item | Annual cost |
|---|---|
| Sanctions screening SaaS (Chainalysis Reactor / TRM Labs Forensics / Elliptic Navigator) | $20k–$100k |
| KYC verifications (Persona / Onfido / Jumio / Veriff) | $1–$5 per verification + $0–$2k/mo platform |
| AML transaction monitoring (often bundled with sanctions vendor) | $0–$50k |
| Outside-counsel retainer | $50k–$200k |
| Cyber + E&O + D&O insurance | $20k–$200k |
| 1099 filing service (Track1099, Tax1099, Sovos) | $1–$5 per recipient + base |
| **Steady-state floor** | **~$100k–$600k/yr** |

For MTL path add: $50k–$200k/yr per state for ongoing bonding +
exam fees + audit + state filings.

## Hard rules for engineering

Until the Phase 1 opinion lands, the following are PROJECT-WIDE
INVARIANTS:

1. **No production-network deployment of any contract that moves real
   USDC** outside of a closed-cohort testnet (Sepolia, Base Sepolia, or
   equivalent). Anvil/Hardhat local-only for development.
2. **No marketing copy** claiming Smart Agent is "the easiest way to
   donate" or "a charity platform" or "a giving app" — those framings
   make the MTL case worse. See RL1 § Marketing Posture for the safe
   vocabulary.
3. **No KYC theatre** — do NOT add a "verify your identity" form to the
   product without (a) a KYC vendor, (b) a documented retention policy,
   and (c) counsel sign-off on what we do with the collected data.
   Collecting PII without a lawful basis is a GDPR / CCPA violation in
   itself.
4. **No sanctioned-address transaction processing.** All public-network
   deployments must integrate Chainalysis / TRM Labs / Elliptic
   screening at the action layer BEFORE any signed userOp is relayed.
5. **No "we are not a money transmitter" claims** in TOS or marketing
   until counsel has issued an opinion letter to that effect. Until
   then, the TOS must be silent on regulatory status (see RL6).

## Document conventions

- Section numbers in each RL file are stable. Counsel will cite by
  section, so do not renumber without a counsel-engagement re-issue.
- Every cost figure is denoted with a range and a year (most figures are
  May 2026); future-proofing is the reader's responsibility.
- Statute citations (e.g. 31 CFR 1010.100(ff)) are stable references but
  the underlying regulations evolve — RL1's bibliography section is the
  source of truth for which version is being analyzed.
- Vendor names are recommendations, not endorsements. Engineering must
  re-evaluate before signing any contract.

## When to re-open this suite

This suite must be revisited and re-circulated when ANY of the
following changes:

- The product launches in a new jurisdiction.
- The product moves a non-USDC asset (BTC, ETH, fiat, NFT, real-world
  asset token, treasury bill, security token).
- The product introduces any token, governance token, points system,
  rewards program, or stake.
- The KYC/AML or sanctions program changes vendor or scope.
- The on-chain footprint changes (new chain, new bridge, new bundler).
- A senior architecture review surfaces a money-movement code path not
  inventoried in RL1 § Activity Surface.
- Any time a regulator (FinCEN, SEC, NY DFS, CA DFPI, OFAC, IRS,
  EU NCAs, FCA, MAS) issues new guidance affecting the model.
- After every fiscal year — at minimum to refresh 1099 / DAC8 readiness.

## Document ownership

| Document | Engineering owner | Counsel owner (TBD) |
|---|---|---|
| README (this file) | Security agent | n/a (planning artifact) |
| RL1 — MTL | Security + Product | Fintech regulatory counsel |
| RL2 — Securities | Security + Product | Securities counsel |
| RL3 — Tax | Finance lead | Tax counsel |
| RL4 — OFAC | Security | Sanctions counsel |
| RL5 — KYC/AML | Security | AML counsel |
| RL6 — TOS/Privacy | Legal-ops + Documentarian | Tech-transactions counsel |
| RL7 — Liability | Security + Finance | Insurance broker + transactions counsel |

## Related internal documents

- `docs/architecture/principles.md` — substrate independence + chain-as-truth
- `docs/security/threat-model.md` — engineering threat model (overlaps
  with RL4/RL5 on adversary capabilities)
- `docs/security/privacy-and-compliance/` — empty as of this writing;
  RL3/RL4/RL5/RL6 should backfill operational policies here
- `specs/005-pledge-honor/plan.md` — money-movement design
- `specs/004-anoncreds-marketplace-auth/plan.md` — credential design
- `specs/007-architecture-hardening/phase-H-privacy-and-iac.md` — IaC +
  AnonCreds custodial-privacy doc; this suite is the legal complement

## External references (general)

- [FinCEN Money Services Business definition](https://www.fincen.gov/money-services-business-definition)
- [31 CFR 1010.100 — General definitions (eCFR)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-A/section-1010.100)
- [FinCEN CVC Guidance (May 2019)](https://www.fincen.gov/system/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf)
- [ESMA MiCA portal](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica)
- [NY DFS Virtual Currency Business Licensing](https://www.dfs.ny.gov/virtual_currency_businesses)
- [California DFPI Digital Financial Assets](https://dfpi.ca.gov/regulated-industries/digital-financial-assets/)
- [OFAC FAQ on virtual currency](https://ofac.treasury.gov/faqs/topic/1626)
- [IRS Form 1099-K FAQ](https://www.irs.gov/newsroom/form-1099-k-faqs)
- [EU DAC8 portal](https://taxation-customs.ec.europa.eu/taxation/tax-transparency-cooperation/administrative-co-operation-and-mutual-assistance/directive-administrative-cooperation-dac/dac8_en)
- [FCA new cryptoasset regime](https://www.fca.org.uk/firms/new-regime-cryptoasset-regulation)
- [SEC/CFTC joint cryptoasset interpretation (March 2026)](https://www.federalregister.gov/documents/2026/03/23/2026-05635/application-of-the-federal-securities-laws-to-certain-types-of-crypto-assets-and-certain)
