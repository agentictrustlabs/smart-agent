# RL7 — Liability Framework + Insurance

> **NOT LEGAL ADVICE / NOT INSURANCE ADVICE.** This document scopes the
> liability + insurance program for counsel + an insurance broker.
>
> Cross-refs: [RL6](./RL6-tos-privacy-acceptable-use.md) — contractual
> limitations live in TOS; [RL4](./RL4-ofac-sanctions-screening.md) —
> sanctions-failure exposure; [RL5](./RL5-kyc-aml-high-risk-flows.md) —
> AML-failure exposure.

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Risk inventory](#2-risk-inventory)
3. [Contractual mitigations](#3-contractual-mitigations)
4. [Insurance overview](#4-insurance-overview)
5. [Cyber liability insurance](#5-cyber-liability-insurance)
6. [E&O / Tech E&O insurance](#6-eo--tech-eo-insurance)
7. [D&O insurance](#7-do-insurance)
8. [Crypto-specific insurance](#8-crypto-specific-insurance)
9. [Other coverages](#9-other-coverages)
10. [Broker selection](#10-broker-selection)
11. [Cost model](#11-cost-model)
12. [Bibliography](#12-bibliography)

---

## 1. Executive summary

Smart Agent's liability surface is broad: smart contract bugs ($1M–$100M+
potential losses), data breaches (millions of dollars in regulatory
penalties + remediation), credential mis-issuance (litigation by harmed
parties), failure of architecture primitives (regulator enforcement).
Insurance + contractual limitations are the primary mitigations.

**Required at launch**:

1. **Cyber liability insurance** — $1M–$10M coverage; ~$15k–$80k/yr.
2. **Tech E&O insurance** — $1M–$5M; ~$10k–$60k/yr.
3. **D&O insurance** — $1M–$5M; ~$10k–$50k/yr.
4. **Contractual limitations** in TOS (RL6 § 3.9 limitation of liability).

**Crypto-specific**:

- **Custody insurance** — only if custodial; minimal current exposure
  (no centrally-held customer funds), but post-007 + at scale, consider
  Evertas / Marsh / Aon crypto-specific products.
- **DAO/protocol cover** — emerging market (Nayms, Nexus Mutual, Sherlock
  Insurance, InsurAce) — useful for treasury-loss scenarios.

**Brokers**:

- **Coalition** ([https://www.coalitioninc.com/](https://www.coalitioninc.com/)) — tech-focused cyber
- **Beazley** ([https://www.beazley.com/](https://www.beazley.com/)) — fintech
- **Evertas** ([https://evertas.com/](https://evertas.com/)) — crypto specialist
- **Marsh** + **Aon** — large brokers with crypto practices
- **Founder Shield** ([https://www.foundershield.com/](https://www.foundershield.com/)) — startup-focused
- **Embroker** ([https://www.embroker.com/](https://www.embroker.com/)) — startup-focused
- **Vouch** ([https://www.vouch.us/](https://www.vouch.us/)) — startup-focused

**Total Year-1 insurance cost**: ~$40k–$200k for a Series A-stage
crypto startup. Scales with revenue and assets-under-management.

---

## 2. Risk inventory

### 2.1 Smart contract bug

A bug in `AgentAccount`, `DelegationManager`, `PledgeRegistry`, or any
of the marketplace registries could cause:

- Funds drained from user accounts (high-blast).
- Funds drained from pool accounts (high-blast).
- Mis-execution of disbursements.
- Mis-tagged status on chain (incorrect honored amounts).

**Likelihood**: medium (Solidity is bug-prone; we use OpenZeppelin
patterns but our own substrate has limited audit history).

**Impact**: catastrophic — could exceed insurance limits.

**Mitigations**:

- Formal verification of critical paths.
- External audit (CertiK, OpenZeppelin Audits, Trail of Bits,
  Spearbit, ChainSecurity) before public deployment.
- Bug bounty program (Immunefi).
- Time-locked upgrades (Spec 007 Phase A).
- Multi-sig on emergency-pause guardian (if any).

### 2.2 Mis-issued credential

A pool steward (or a compromised pool steward account) issues a
ProposalSubmitterCredential or RoundVoterCredential to someone who
shouldn't have it.

**Likelihood**: low (issuance gate is delegation-bound).

**Impact**: depends — could enable a malicious proposal to win + drain
the pool; or no impact if other checks catch it.

**Mitigations**:

- Issuance audit log.
- Revocation registry.
- TOS § AUP prohibits.
- E&O cover for harmed members.

### 2.3 Failed delegation redemption

A delegation chain that should redeem fails to do so — donor's
pledge-honor doesn't complete, but USDC has already left their
account.

**Likelihood**: low (with adequate engineering + monitoring).

**Impact**: medium — single-user financial loss; reputational damage.

**Mitigations**:

- Idempotent on-chain operations.
- Recovery / refund procedures.
- TOS limitation of liability.

### 2.4 Data breach (PII)

An attacker breaches `person-mcp` and exfiltrates KYC documents +
TINs + addresses.

**Likelihood**: medium (high-value target for KYC data).

**Impact**: catastrophic — millions in regulatory fines (GDPR up to
4% of global turnover or €20M; CCPA $7,500 per violation), plus
remediation, plus reputational damage.

**Mitigations**:

- Encryption at rest + in transit.
- KMS-backed key management.
- Multi-tenant isolation (Spec 007 Phase G).
- Periodic security audits.
- Bug bounty.
- Cyber liability insurance.

### 2.5 Account takeover

A user's passkey is compromised (phishing) or stolen.

**Likelihood**: medium (passkey is stronger than password but not
zero-risk).

**Impact**: single-user, but if many users are affected at once
(e.g., shared-credential phishing campaign), scales fast.

**Mitigations**:

- Passkey-only (no password) — already in place.
- WebAuthn FIDO2 hardware keys for high-value users.
- Recovery procedures (social, time-locked) — TBD.
- Monitoring for unusual access patterns.
- Insurance: cyber + crypto crime cover.

### 2.6 Service outage

Smart Agent's web app or MCPs go down, blocking users from time-
sensitive actions (e.g., voting in a closing round).

**Likelihood**: medium-high (any system has outages).

**Impact**: low–medium financial; medium reputational.

**Mitigations**:

- SLA + uptime commitments.
- Multi-region deploys.
- Graceful degradation (e.g., on-chain reads from public RPC even if
  our servers are down).
- TOS § force-majeure.

### 2.7 Sanctions failure

A sanctioned address transacts; we fail to screen.

**Likelihood**: low (with vendor screening) — medium (without).

**Impact**: civil penalties up to ~$372k per violation + 2× transaction
value; criminal exposure.

**Mitigations**:

- RL4 program.
- Fail-closed architecture.
- Cyber + Crime + Regulatory cover.
- Voluntary self-disclosure (VSD) framework.

### 2.8 AML failure

Failure to file a SAR; failure to maintain CIP records; missing TIN.

**Likelihood**: low–medium.

**Impact**: civil penalties $50k–$5M per violation depending on
severity; loss of MTL.

**Mitigations**:

- RL5 program.
- Regulatory liability cover.

### 2.9 Securities mis-classification

A construct (pool, treasury, future token) is later deemed a security
by SEC.

**Likelihood**: low (current architecture); medium (with future token).

**Impact**: enforcement action, fines, disgorgement, possible bar from
industry.

**Mitigations**:

- RL2 opinion + posture compliance.
- D&O cover.

### 2.10 Director / officer wrongful act

An officer makes a decision later challenged in court.

**Likelihood**: low.

**Impact**: large personal exposure for officer; corporate also exposed.

**Mitigations**:

- D&O cover.
- Indemnification in corporate bylaws.

### 2.11 Employment claims

Wrongful termination, discrimination, harassment.

**Likelihood**: low (small team).

**Impact**: medium ($50k–$500k typical claims).

**Mitigations**:

- EPLI (Employment Practices Liability Insurance).
- HR practices.

### 2.12 IP infringement claims

Third party claims Smart Agent infringes their patent / copyright /
trademark.

**Likelihood**: low–medium (crypto-patent landscape is messy).

**Impact**: medium–high ($100k–$5M for serious claims).

**Mitigations**:

- Patent freedom-to-operate review.
- E&O cover.
- IP-specific cover.

### 2.13 Treasury / custody loss

If we hold any custodial USDC (e.g., paymaster reserve), it could be
stolen or lost.

**Likelihood**: low.

**Impact**: limited to the custodial amount.

**Mitigations**:

- Minimize custodial holdings.
- Crypto custody insurance (Evertas).
- Multi-sig + hardware-key signing.

---

## 3. Contractual mitigations

### 3.1 TOS limitation of liability

(See RL6 § 3.9.) Caps Smart Agent liability at fees paid or $100.

Enforceability:

- US: generally enforceable for non-essential damages, subject to
  unconscionability / public-policy limits.
- EU: cannot disclaim gross negligence or willful misconduct; member-
  state rules apply.
- UK: Unfair Contract Terms Act 1977 + Consumer Rights Act 2015.

### 3.2 TOS indemnification

User indemnifies Smart Agent for claims arising from user's misuse.

### 3.3 TOS disclaimer of warranties

AS IS, AS AVAILABLE. No implied warranties.

### 3.4 Force majeure

Excuses non-performance during chain outages, RPC failures, etc.

### 3.5 Contractual exclusions

In TOS:

- No fiduciary duty.
- No guarantee of fund delivery.
- No legal / tax / financial advice.
- No assumption of risk for user's own actions.

### 3.6 Vendor indemnification

Smart Agent's TOS with users transfers risk to user. Smart Agent's
contracts WITH vendors (Persona, TRM Labs, etc.) ideally pass the risk
back when the vendor's failure causes harm.

Vendor DPAs (Data Processing Addenda) often include indemnification
for breach.

### 3.7 Audit firm indemnification

Smart contract audits include limited liability ($100k–$1M cap typical
even after a $50k audit fee). Don't expect substantial recovery from
the audit firm.

### 3.8 Insurance is the primary backstop

Contractual mitigations are valuable but not bulletproof. Courts can
invalidate or limit clauses. Insurance is the primary financial
backstop.

---

## 4. Insurance overview

### 4.1 Coverage map

| Risk | Insurance type |
|---|---|
| Data breach (PII) | Cyber Liability |
| Smart contract bug | Tech E&O + Crypto Custody (some carriers) |
| Failed delegation | Tech E&O |
| Account takeover | Cyber + Crime |
| Service outage | Business Interruption (in Cyber) |
| Sanctions / AML failure | Regulatory Defense (in Cyber or D&O) |
| Securities claim | D&O |
| Officer wrongful act | D&O |
| Employment claim | EPLI |
| IP infringement | Tech E&O |
| Treasury / custody loss | Crypto Custody (Evertas / Lloyd's) |
| Cyber crime (theft) | Crime cover |

### 4.2 Coverage trigger forms

- **Occurrence-based**: covers events that occur during the policy
  period, regardless of when reported.
- **Claims-made**: covers claims made during the policy period,
  regardless of when the event occurred.

Cyber, E&O, D&O are typically claims-made. Implications:

- "Tail coverage" needed when policy ends, to cover claims after
  end-date for events during the policy period.
- Continuous renewal required to maintain coverage.

### 4.3 Retroactive date

Claims-made policies have a retro date — the earliest date a covered
event can have occurred. For startups, set retro date to incorporation
date.

### 4.4 Deductibles + retentions

Typical retention (self-insured amount per claim) ranges:

- Small startup: $5k–$25k
- Series A/B: $25k–$100k
- Series C+: $100k–$500k

Higher retention = lower premium. Trade off based on cash position.

---

## 5. Cyber liability insurance

### 5.1 Coverage components

- **First-party** (covers the company):
  - Breach response / incident response costs
  - Forensics / IT investigation
  - Notification costs (regulatory, customers)
  - Credit monitoring / identity restoration
  - Public relations / crisis management
  - Business interruption
  - Cyber extortion (ransomware)
  - Data restoration
  - Reputation cover (some carriers)
- **Third-party** (covers claims by others):
  - Regulatory defense + fines (where insurable)
  - Privacy liability (CCPA, GDPR claim defense)
  - Network security liability
  - Multimedia / content liability
  - PCI / payment-card industry fines (if relevant)

### 5.2 Required limits

For Smart Agent at pre-Series A:

- $1M per claim / $1M aggregate — minimum.
- $5M per claim / $5M aggregate — recommended.

At Series B+ or with significant PII:

- $10M+ per claim / $10M+ aggregate.

### 5.3 Crypto carveouts

Many cyber policies EXCLUDE cryptocurrency-related losses by default.
The exclusion language to watch:

- "Theft of cryptocurrency"
- "Smart contract execution"
- "Distributed ledger technology"

Negotiate these OUT or use a crypto-specialist carrier.

### 5.4 Recommended carriers

| Carrier | URL | Strength |
|---|---|---|
| **Coalition** | [link](https://www.coalitioninc.com/) | tech-focused, real-time risk monitoring |
| **Beazley** | [link](https://www.beazley.com/) | financial institutions; FLEX consortium for fintech |
| **AIG** | [link](https://www.aig.com/) | large enterprise |
| **Chubb** | [link](https://www.chubb.com/) | broad portfolio |
| **Travelers** | [link](https://www.travelers.com/) | mid-market |
| **CFC** | [link](https://www.cfc.com/) | tech specialist |
| **At-Bay** | [link](https://www.at-bay.com/) | InsurTech, tech-focused |
| **Cowbell** | [link](https://cowbell.insure/) | AI-driven cyber |

For crypto carve-ins:

- **Evertas** ([link](https://evertas.com/)) — only Lloyd's-backed crypto specialist
- **Marsh** — large broker with crypto desk
- **Aon** — same
- **Lockton** — same

### 5.5 Cost (2026 estimates)

| Stage | Limit | Annual premium |
|---|---|---|
| Pre-Series A | $1M | $5k–$20k |
| Series A | $5M | $15k–$50k |
| Series B | $10M | $30k–$120k |
| Mature | $25M+ | $80k–$300k |

Premiums went UP in 2022–2024 (ransomware spike), STABILIZED in 2025–
2026.

### 5.6 What questions underwriters ask

- Headcount.
- Revenue.
- Industry classification.
- Geographic footprint.
- PII categories collected.
- Number of users.
- Data residency.
- Multi-factor auth on all admin accounts (must be YES).
- Endpoint protection (EDR).
- Backup + DR plan.
- Last pen-test date.
- SOC 2 status.
- Previous breaches / incidents.
- Compliance program (HIPAA / PCI / etc. as applicable).

Smart Agent should prepare a "cyber underwriting packet" before
approaching carriers — saves cycle time + sometimes gets discount.

---

## 6. E&O / Tech E&O insurance

### 6.1 Coverage

Tech E&O covers claims arising from:

- Failure of the software / service to perform as advertised.
- Errors or omissions in the code.
- Negligence claims.
- Breach of warranty / contract (limited).
- Patent + copyright defense (often a sub-limit).

### 6.2 Crypto-specific gaps

Standard Tech E&O typically EXCLUDES:

- Cryptocurrency theft / loss
- Smart contract bugs (debated; carrier-specific)
- Tokenized asset losses

Negotiate "Distributed Ledger Coverage" extension, or use a crypto
specialist.

### 6.3 Recommended carriers

Same as cyber. Many cyber + E&O are bundled (Coalition, Beazley).

### 6.4 Limits

- Pre-Series A: $1M
- Series A: $3M–$5M
- Series B+: $5M–$10M

### 6.5 Cost

| Stage | Limit | Annual premium |
|---|---|---|
| Pre-Series A | $1M | $5k–$15k |
| Series A | $5M | $15k–$50k |
| Series B+ | $10M | $30k–$120k |

---

## 7. D&O insurance

### 7.1 Coverage

D&O covers:

- **Side A**: protects individual directors / officers when company
  cannot indemnify.
- **Side B**: reimburses company for indemnification of directors /
  officers.
- **Side C**: covers the company itself for securities claims.

### 7.2 Why crypto-startups need it more

- Regulatory enforcement risk (SEC, CFTC, FinCEN).
- Securities class actions are more likely (especially if token
  contemplated).
- Investor lawsuits.
- Employee-related claims.

### 7.3 Recommended carriers

- **AIG**
- **Chubb**
- **Travelers**
- **Hiscox**
- **Beazley**
- **Argo**

### 7.4 Limits

- Pre-Series A: $1M
- Series A: $2M–$5M (often required by VCs)
- Series B+: $5M–$15M

### 7.5 Cost

| Stage | Limit | Annual premium |
|---|---|---|
| Pre-Series A | $1M | $5k–$15k |
| Series A | $5M | $15k–$50k |
| Series B+ | $10M | $30k–$100k |

### 7.6 Side A "Difference in Conditions" (DIC)

For maximum protection of individuals, add Side A DIC layer
($2M–$10M). Covers gaps in primary D&O. Cost: $5k–$20k.

---

## 8. Crypto-specific insurance

### 8.1 Custody insurance

For platforms that hold crypto assets in custody:

- **Evertas** — Lloyd's-backed; $5M–$100M+ limits typical
- **BitGo Trust** — embedded custody insurance
- **Marsh / Lockton** — broker-mediated custody policies
- **Aon Affinity**

Smart Agent's current architecture is largely non-custodial (post-007).
Need is limited to:

- Paymaster reserve (if Smart Agent operates one).
- Bundler operating ETH (very small).
- Optional treasury holdings of the operating company.

### 8.2 Smart contract insurance / DeFi cover

Newer market; covers smart contract exploits:

- **Nexus Mutual** ([link](https://nexusmutual.io/)) — mutual cover; covers specific protocols
- **Sherlock Insurance** — protocol-level
- **InsurAce** — multi-chain
- **Nayms** — Bermuda-licensed; broader product
- **Risk Harbor** — automated

For Smart Agent's smart contracts, this insurance is limited utility
unless we own the contracts as an enterprise + buy a policy on them.
Better to do audits + formal verification.

### 8.3 Lloyd's of London market

For larger limits or unusual exposures, the Lloyd's market via a
specialist broker (Marsh, Aon) provides bespoke products.

### 8.4 Cost (custody)

For custodial holdings:

| Amount held | Annual premium |
|---|---|
| <$1M | $5k–$30k |
| $1M–$10M | $30k–$150k |
| $10M+ | enterprise pricing |

Typical premium: 1–5% of insured value.

---

## 9. Other coverages

### 9.1 EPLI (Employment Practices Liability)

Covers employment-related claims (discrimination, harassment, wrongful
termination).

Cost: $1k–$10k/yr for small teams.

### 9.2 General Liability

Covers bodily injury + property damage (for office space, events).

Cost: $400–$2k/yr for small teams.

### 9.3 Commercial Property

Covers office equipment + premises.

Cost: depends on assets.

### 9.4 Workers' Compensation

State-required for employees.

Cost: ~0.5–2% of payroll.

### 9.5 Business Owner's Policy (BOP)

Bundles General Liability + Property for small businesses.

Cost: $500–$3k/yr.

### 9.6 Crime / Fidelity

Covers employee dishonesty, theft of money/securities, computer
fraud, social engineering.

Cost: $1k–$10k/yr for $250k–$1M limits.

### 9.7 Bond requirements (MTL)

If RL1 lands on MTL path, surety bonds are required per state. The
bond is a financial guarantee, not insurance per se. Premium 1.5–5%
of bond face value.

---

## 10. Broker selection

### 10.1 Why use a broker

Brokers represent the insured (you), not the carrier. They:

- Shop multiple markets.
- Negotiate terms.
- Advocate at claim time.
- Manage renewal.

### 10.2 Startup-focused brokers

- **Founder Shield** ([https://www.foundershield.com/](https://www.foundershield.com/)) — startup-focused
- **Embroker** ([https://www.embroker.com/](https://www.embroker.com/)) — digital broker
- **Vouch** ([https://www.vouch.us/](https://www.vouch.us/)) — startup specialist
- **Newfront** ([https://www.newfront.com/](https://www.newfront.com/)) — tech-focused
- **Woodruff Sawyer** — VC-stage focused

### 10.3 Crypto-experienced brokers

- **Marsh** — large broker with dedicated crypto practice
- **Aon** — same
- **Lockton** — same
- **Evertas** — direct crypto specialist
- **Coalition** — sells direct + via brokers; tech-focused

### 10.4 Selection criteria

| Criterion | Weight |
|---|---|
| Crypto-industry experience | 25% |
| Carrier relationships | 20% |
| Startup-stage understanding | 15% |
| Claims advocacy track record | 15% |
| Pricing transparency | 10% |
| Service / availability | 10% |
| Tech (online dashboards, etc.) | 5% |

### 10.5 RFP scope

```
Smart Agent — Insurance Broker RFP

Coverages requested:
  - Cyber Liability ($5M+)
  - Tech E&O ($5M+)
  - D&O ($5M)
  - EPLI ($1M)
  - Crime ($1M)
  - Crypto Custody (if applicable, $5M)

Company profile:
  - Pre-Series A crypto startup
  - 10–20 headcount
  - $X revenue
  - Y users (Y/100k)
  - Z USDC value flowing through platform

Looking for:
  - Annual program design
  - Carrier shortlist + quote comparison
  - Renewal management
  - Claims advocacy commitment

Timeline:
  - Quote in 3 weeks
  - Bind in 5 weeks
```

---

## 11. Cost model

### 11.1 Year-1 program (pre-Series A)

| Coverage | Limit | Premium |
|---|---|---|
| Cyber Liability | $1M | $5k–$20k |
| Tech E&O | $1M | $5k–$15k |
| D&O | $1M | $5k–$15k |
| EPLI | $500k | $1k–$5k |
| Crime | $500k | $1k–$5k |
| GL / BOP | basic | $500–$2k |
| Workers' Comp | per state | varies |
| **Total** | | **$17k–$62k** |

### 11.2 Year-1 program (Series A)

| Coverage | Limit | Premium |
|---|---|---|
| Cyber Liability | $5M | $15k–$50k |
| Tech E&O | $5M | $15k–$50k |
| D&O | $5M | $15k–$50k |
| EPLI | $1M | $2k–$8k |
| Crime | $1M | $3k–$10k |
| Crypto Custody (if needed) | $5M | $30k–$150k |
| GL / BOP | basic | $1k–$3k |
| **Total (no custody)** | | **$50k–$170k** |
| **Total (with custody)** | | **$80k–$320k** |

### 11.3 Year-1 program (Series B+)

| Coverage | Limit | Premium |
|---|---|---|
| Cyber Liability | $10M | $30k–$120k |
| Tech E&O | $10M | $30k–$120k |
| D&O | $10M | $30k–$100k |
| Side A DIC | $5M | $5k–$20k |
| EPLI | $3M | $5k–$25k |
| Crime | $3M | $10k–$30k |
| Crypto Custody | $10M+ | $50k–$300k |
| **Total** | | **$160k–$715k** |

### 11.4 Brokerage fees

Most brokers earn commission from carriers (15–25% of premium).
Some offer fee-based pricing instead — useful for transparency.

### 11.5 Surety bonds (if MTL)

Per RL1 § 4.6, 50-state US bonds: $240k–$475k+ initial, $50k–$200k/yr
maintenance. Premium 1.5–5% of bond face.

---

## 12. Bibliography

### Insurance carriers

- **AIG**: [link](https://www.aig.com/)
- **Beazley**: [link](https://www.beazley.com/)
- **Chubb**: [link](https://www.chubb.com/)
- **Coalition**: [link](https://www.coalitioninc.com/)
- **Travelers**: [link](https://www.travelers.com/)
- **CFC**: [link](https://www.cfc.com/)
- **At-Bay**: [link](https://www.at-bay.com/)
- **Cowbell**: [link](https://cowbell.insure/)
- **Evertas**: [link](https://evertas.com/)
- **Hiscox**: [link](https://www.hiscox.com/)
- **Argo**: [link](https://www.argogroup.com/)
- **Lloyd's of London**: [link](https://www.lloyds.com/)

### Brokers

- **Founder Shield**: [link](https://www.foundershield.com/)
- **Embroker**: [link](https://www.embroker.com/)
- **Vouch**: [link](https://www.vouch.us/)
- **Newfront**: [link](https://www.newfront.com/)
- **Marsh**: [link](https://www.marsh.com/)
- **Aon**: [link](https://www.aon.com/)
- **Lockton**: [link](https://www.lockton.com/)
- **Woodruff Sawyer**: [link](https://woodruffsawyer.com/)

### DeFi / smart contract cover

- **Nexus Mutual**: [link](https://nexusmutual.io/)
- **Sherlock Insurance**: [link](https://www.sherlock.xyz/)
- **InsurAce**: [link](https://www.insurace.io/)
- **Nayms**: [link](https://nayms.com/)
- **Risk Harbor**: [link](https://www.riskharbor.com/)

### Industry references

- **Beazley FLEX consortium** (fintech): [link](https://www.beazley.com/en-US/news-and-events/beazley-launches-new-combined-cyber-and-financial-institutions-consortium/)
- **Evertas Crypto Custody coverage**: [link](https://evertas.com/news/coverage-types-for-crypto-custodians/)
- **Coalition Excess Tech E&O**: [link](https://www.coalitioninc.com/en-gb/cyber-excess-tech-eo)
- **Beazley Cyber & Tech**: [link](https://www.beazley.com/usa/cyber_and_executive_risk/cyber_and_tech.html)

### Regulatory + claim context

- **NAIC Cybersecurity Insurance + Identity Theft Resource Center**: [link](https://www.naic.org/cipr_topics/topic_cyber_risk.htm)
- **NIST Cybersecurity Framework**: [link](https://www.nist.gov/cyberframework)

### Related internal documents

- [`README.md`](./README.md)
- [`RL1-money-transmitter-license-analysis.md`](./RL1-money-transmitter-license-analysis.md) — surety bonds
- [`RL4-ofac-sanctions-screening.md`](./RL4-ofac-sanctions-screening.md) — sanctions exposure
- [`RL5-kyc-aml-high-risk-flows.md`](./RL5-kyc-aml-high-risk-flows.md) — AML exposure
- [`RL6-tos-privacy-acceptable-use.md`](./RL6-tos-privacy-acceptable-use.md) — contractual limits
- `docs/security/threat-model.md` — engineering threat model
- `specs/007-architecture-hardening/plan.md` — substrate hardening
