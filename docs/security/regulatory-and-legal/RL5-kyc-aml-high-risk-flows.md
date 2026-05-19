# RL5 — KYC / AML for High-Risk Flows

> **NOT LEGAL ADVICE.** This document scopes the KYC/AML program for
> counsel.
>
> Cross-ref: [RL1 MTL](./RL1-money-transmitter-license-analysis.md) —
> KYC/AML is mandatory if Smart Agent is a money transmitter;
> [RL4 OFAC](./RL4-ofac-sanctions-screening.md) — sanctions overlap;
> [RL3 Tax](./RL3-tax-reporting-1099-and-international.md) — TIN
> collection overlap.

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [The legal driver](#2-the-legal-driver)
3. [Tiered KYC model](#3-tiered-kyc-model)
4. [Vendor selection](#4-vendor-selection)
5. [Customer Due Diligence (CDD)](#5-customer-due-diligence-cdd)
6. [Enhanced Due Diligence (EDD)](#6-enhanced-due-diligence-edd)
7. [Transaction monitoring](#7-transaction-monitoring)
8. [SAR filing](#8-sar-filing)
9. [Recordkeeping](#9-recordkeeping)
10. [Implementation outline](#10-implementation-outline)
11. [Tension with privacy](#11-tension-with-privacy)
12. [Counsel + vendor engagement](#12-counsel--vendor-engagement)
13. [Cost model](#13-cost-model)
14. [Bibliography](#14-bibliography)

---

## 1. Executive summary

If RL1 concludes Smart Agent is a money transmitter (FinCEN MSB / state
MTL / EU CASP), KYC/AML is **mandatory** — it's the program component
that licensing regimes require. If RL1 concludes we're NOT a
transmitter but operate as a "tech provider" to a partner, the partner
runs KYC for us — but we still collect customer identity to hand off.
Either way, identity collection is on the critical path before any
public-facing money-movement.

**Tiered approach** balances friction vs. compliance:

| Tier | Limits | What's collected | What's not |
|---|---|---|---|
| **Tier 0** | $0; demo only | passkey, email | nothing else |
| **Tier 1** | up to $1k cumulative outflow | email + phone verified | gov ID, address |
| **Tier 2** | up to $50k/yr | + government ID + proof of address | financial details |
| **Tier 3** | unlimited / high-risk | + source-of-funds + beneficial ownership | — |

**Vendors**:

- **Persona** ([https://withpersona.com/](https://withpersona.com/)) — flexible, developer-friendly
- **Onfido** ([https://onfido.com/](https://onfido.com/)) — enterprise; document verification
- **Jumio** ([https://www.jumio.com/](https://www.jumio.com/)) — enterprise; bank-grade
- **Veriff** ([https://www.veriff.com/](https://www.veriff.com/)) — fast onboarding
- **Sumsub** ([https://sumsub.com/](https://sumsub.com/)) — strong international + crypto focus
- **iDenfy** ([https://idenfy.com/](https://idenfy.com/)) — cost-leader for SMB
- **Au10tix** ([https://www.au10tix.com/](https://www.au10tix.com/)) — bank-grade

**Cost**: $1–$5 per verification + base platform fee. Annual cost
scales with user count.

**The hardest tension**: AnonCreds + nullifier-keyed rows give us
strong pseudonymity, but FinCEN expects "know your customer" — actual
identity tied to actual transactions. The compromise: KYC at the
PROVISIONING layer (when a user gets the AgentAccount that will move
real money), with the on-chain layer still using AnonCreds for action
privacy. The MCP holds the identity; the chain holds the action; the
audit trail can be reassembled by the platform (a SAR-trigger, an OFAC
match) but isn't visible to the public.

---

## 2. The legal driver

### 2.1 US — FinCEN MSB AML requirements

If FinCEN says we're an MSB (RL1 §5.1), we must:

- **Designate a BSA Officer / AML Compliance Officer.**
- **Maintain a written AML program** with:
  - Internal controls (policies + procedures)
  - Independent testing
  - Designated compliance officer
  - Training program
- **Customer Identification Program (CIP)** — 31 CFR § 1022.220 —
  collect name, DOB, address, government ID number from each customer.
- **Customer Due Diligence (CDD)** — beneficial-owner identification
  for legal-entity customers.
- **Suspicious Activity Reports (SARs)** — file via SAR-MSB form within
  30 days of detection.
- **Currency Transaction Reports (CTRs)** — for cash transactions
  $10k+ (N/A — Smart Agent doesn't take cash).
- **Information sharing** — under USA PATRIOT Act § 314(a) (responding
  to FinCEN information requests) and § 314(b) (sharing with other
  MSBs).
- **Recordkeeping** — 5 years.

### 2.2 US — State MTL AML requirements

Most state MTL regimes incorporate the federal BSA/AML framework. NY
DFS adds Part 504 (Transaction Monitoring + Filtering) requirements;
NY DFS Part 500 (cybersecurity) is also mandatory.

### 2.3 EU — AMLA + 6AMLD

- **6th Anti-Money Laundering Directive (6AMLD)** — Directive (EU)
  2018/1673 — defines AML predicate offenses.
- **EU AMLA** — Authority for Anti-Money Laundering and Countering the
  Financing of Terrorism — established by Regulation (EU) 2024/1620,
  becomes fully operational 2027.
- **6AMLR / Single Rulebook** — Regulation (EU) 2024/1624 — directly
  applicable across all member states.
- **Travel Rule** — Regulation (EU) 2023/1113 — crypto-specific
  travel-rule obligations starting December 30, 2024.

### 2.4 UK — MLR 2017

Money Laundering, Terrorist Financing and Transfer of Funds
(Information on the Payer) Regulations 2017. CDD requirements similar
to FinCEN.

### 2.5 FATF Travel Rule (Recommendation 16)

Crypto-Asset Service Providers (VASPs) must share originator +
beneficiary information for transfers above the threshold ($1k US,
EUR 1k EU, varies elsewhere).

For Smart Agent: every transfer above the threshold to/from another
VASP requires originator info exchange. This means tooling like:

- **Notabene** ([https://notabene.id/](https://notabene.id/))
- **Sumsub Travel Rule** module
- **TRP (Travel Rule Protocol)** standard
- **IVMS 101** data standard

### 2.6 OFAC Compliance overlay

RL4 — overlapping but separate from KYC/AML. Same vendors often bundle
both.

---

## 3. Tiered KYC model

### 3.1 Tier 0 — passkey / demo

**What it is**: a user signs up with a passkey or via Google OAuth. No
identity collection beyond email.

**What's allowed**:

- Pledge submission (no money moves — RL1 §2.1).
- Match initiation (no money moves — RL1 §2.8).
- Proposal submission (no money moves — RL1 §2.9).
- View public marketplace surfaces.

**What's NOT allowed**:

- Honor (Rail A; §2.3).
- Disbursement (§2.5).
- Treasury-to-treasury (§2.6).
- Personal-treasury funding above $0 outflow.

**Implementation**: existing passkey/SIWE auth path (per memory:
"Sessionless passkey + SIWE auth"). No additional KYC required.

### 3.2 Tier 1 — basic verification

**What it is**: email + phone OTP-verified. SMS or voice OTP.

**Vendor**: Twilio Verify, Auth0, or built into the KYC vendor stack.

**Cost**: $0.05–$0.20 per OTP.

**What's allowed**:

- Pledge honor up to $1,000 cumulative annual outflow.
- Receive grants up to $600/yr (below 1099 threshold).
- Light reading-marketplace activity.

**What's NOT allowed**:

- Higher-limit transactions.
- Receiving grants above $600/yr (1099 requires W-9 → Tier 2 minimum).

**Implementation**: phone-verify step at first-money-movement. Stored
in `person-mcp` as `tier1Verified: { at: timestamp, channel: 'phone' }`.

**Friction**: low — adds 30 seconds to onboarding.

### 3.3 Tier 2 — full KYC

**What it is**: government ID + proof of address. Vendor-managed
identity verification.

**Documents**:

- Government-issued photo ID (passport / driver's license / national
  ID).
- Selfie (liveness check).
- Proof of address (utility bill / bank statement, within 90 days).

**Vendors**: Persona / Onfido / Jumio / Veriff / Sumsub. All offer
sub-minute decisions via OCR + biometric matching.

**Cost**: $1–$5 per check (varies; bulk pricing lower).

**What's allowed**:

- Pledge honor up to $50,000/yr cumulative.
- Receive grants — with W-9 collection (RL3).
- Treasury management.

**What's NOT allowed without further upgrade**:

- Single transactions above $10k.
- Cumulative above $50k/yr.
- High-risk jurisdiction users.
- Crypto-source-of-funds without explanation.

**Implementation**: KYC vendor SDK in app at the point of higher-tier
action.

**Friction**: high — 2–5 minutes; document upload often fails on
first try. Conversion drop of 20–40% in industry benchmarks.

### 3.4 Tier 3 — Enhanced Due Diligence (EDD)

**What it is**: source-of-funds documentation + beneficial-owner
identification (for entities) + ongoing monitoring.

**Documents**:

- Bank statements (last 3–6 months).
- Source-of-wealth statement.
- For entities: ownership tree (everyone with ≥25% ownership).
- For high-risk jurisdictions: enhanced monitoring + management
  sign-off.

**Vendors**: same as Tier 2, with EDD modules. Sumsub + Onfido are
strong here.

**Cost**: $20–$100 per case (manual review involved).

**What's allowed**:

- Unlimited transaction value, subject to per-transaction screening.
- High-risk jurisdiction operation (if not comprehensively sanctioned).
- Entity-level pool / org operation.

**Triggers for EDD**:

- High-value transactions (>$10k single or >$50k cumulative).
- PEP (Politically Exposed Person) status.
- High-risk jurisdiction nexus.
- Adverse media match.
- Unusual transaction patterns.

**Implementation**: ticketed manual review by BSA Officer; SLA 5
business days. Block transactions during review.

**Friction**: high — manual process. Reserved for high-value /
high-risk users.

### 3.5 Tier matrix vs activity surface

| Activity (from RL1 §2) | Tier 0 | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|---|
| 2.1 Pledge submit | ✓ | ✓ | ✓ | ✓ |
| 2.3 Honor Rail A | — | ≤$1k | ≤$50k | unlimited |
| 2.4 Mark-paid Rail B | — | ≤$1k | ≤$50k | unlimited |
| 2.5 Disbursement (recipient receives) | — | ≤$600 | W-9 required ≥$600 | unlimited |
| 2.5 Disbursement (steward initiates) | — | — | ≤$50k | unlimited |
| 2.6 Treasury-to-treasury | — | — | — | ✓ |
| 2.7 Personal-treasury fund | — | ≤$1k | ≤$50k | unlimited |
| 2.8 Match init | ✓ | ✓ | ✓ | ✓ |
| 2.9 Proposal submit | ✓ | ✓ | ✓ | ✓ |

### 3.6 Tier-upgrade UX

When a user attempts an action above their current tier limit:

1. Block the action at the app layer.
2. Present a clear upgrade prompt: "This action requires verification.
   Verify your identity to proceed (about 3 minutes)."
3. Initiate the KYC flow (vendor SDK embedded).
4. On verification success: update user record; allow original action
   to proceed.
5. On failure: explain failure mode; allow retry; route to manual
   review if persistent.

---

## 4. Vendor selection

### 4.1 Comparison matrix (2026)

| Vendor | Strength | Per-check cost | Crypto experience | International | Verdict |
|---|---|---|---|---|---|
| **Persona** | developer-friendly, flexible | $1.50–$3.50 | strong | 195+ countries | Strong Phase 1 pick |
| **Onfido** | enterprise, document-strong | $2.50–$5 | strong | 195+ countries | Strong; higher cost |
| **Jumio** | bank-grade, comprehensive | $2.50–$8 | strong | 195+ countries | Higher cost; enterprise |
| **Veriff** | fast onboarding | $1.50–$3 | moderate | 230+ countries | Speed leader |
| **Sumsub** | crypto-native, travel rule | $1.20–$4 | very strong | 220+ countries | Top crypto pick |
| **iDenfy** | cost-leader | $1.00–$2.50 | moderate | 200+ countries | Budget pick |
| **Au10tix** | bank/legacy | enterprise | moderate | 100+ countries | Enterprise only |
| **Trulioo** | data verification (no doc) | $0.50–$2 | low | 195+ countries | Complementary |
| **Civic** | crypto-native ID | varies | strong | global | Niche |

### 4.2 Recommended Phase 1 pick

**Persona** for primary KYC + **Sumsub** for Travel Rule and
crypto-specific enhancements. Both are crypto-friendly, developer-API
mature, and pricing scales well from low to high volume.

### 4.3 Selection criteria

| Criterion | Weight |
|---|---|
| Crypto-industry experience | 20% |
| API/SDK quality | 15% |
| Per-check pricing transparency | 15% |
| International coverage (especially EU + UK + LatAm) | 15% |
| Travel Rule module availability | 10% |
| EDD / case management | 10% |
| Sanctions screening (RL4 overlap) | 10% |
| Time-to-decision (sub-minute) | 5% |

### 4.4 Vendor lock-in considerations

- Identity data should be vendor-portable. Persona, Onfido, Jumio,
  Sumsub all export structured data.
- Vendor-specific risk-score schemas don't port; re-screen on switch.
- Two-vendor strategy (primary + backup) reduces lock-in.

### 4.5 Vendor demo + due diligence checklist

Before signing:

- [ ] SOC 2 Type II audit report (current)
- [ ] ISO 27001 certification
- [ ] Penetration test summary
- [ ] Data-processing addendum (DPA) — GDPR, CCPA-aligned
- [ ] Data residency options
- [ ] Service Level Agreement (SLA) — uptime + decision latency
- [ ] Breach notification timing
- [ ] Audit / examination rights
- [ ] Termination + data-deletion clauses
- [ ] Indemnification scope
- [ ] Pricing model + 12-month projection
- [ ] Sandbox / staging environment
- [ ] Reference customers (3+ crypto-native)

---

## 5. Customer Due Diligence (CDD)

### 5.1 Minimum data per FinCEN CIP (31 CFR § 1022.220)

For individuals:

- Full legal name
- Date of birth
- Address (residential, not P.O. Box for US persons)
- TIN (SSN or ITIN) for US persons; passport / nat'l ID for non-US

For legal entities:

- Name
- Address
- Beneficial owners (≥25% ownership stake) + each one's CIP data
- Control person (e.g., CEO, managing partner)

### 5.2 Verification (CIP)

Identity must be VERIFIED, not just collected. Verification methods:

- **Documentary**: government-issued ID + biometric (selfie + liveness).
- **Non-documentary**: independent data sources (credit bureau, public
  records). Less common for crypto.
- **Combined**: document + selfie + database cross-check.

Most vendors handle all three.

### 5.3 Risk classification

After CIP, assign a risk score:

- **Low risk**: standard checks, periodic re-verification (1–3 years).
- **Medium risk**: enhanced monitoring; more frequent re-verification.
- **High risk**: EDD (Tier 3); ongoing supervisor review.

Risk factors:

- Geography (high-risk jurisdiction)
- PEP status (politically exposed person)
- Adverse media
- Industry (cash-intensive, sanctions-adjacent, etc.)
- Transaction patterns
- Source of funds

### 5.4 PEP screening

A **Politically Exposed Person** is someone with a prominent public
function (head of state, minister, senior judge, senior military,
senior central bank official, etc.) + their family members + close
associates.

PEP screening uses commercial databases:

- **Dow Jones Risk & Compliance**
- **Refinitiv World-Check**
- **Acuris (LSEG) PEP & Sanctions**
- **ComplyAdvantage**
- Bundled with KYC vendor (Persona, Onfido, Sumsub all include).

PEPs are not automatically blocked — they're moved to EDD (Tier 3).

### 5.5 Adverse media screening

Searches news + media databases for negative coverage related to the
user (fraud, money laundering, sanctions, etc.).

Bundled with KYC vendor or separate. ComplyAdvantage is the standalone
leader.

---

## 6. Enhanced Due Diligence (EDD)

### 6.1 When to trigger EDD

Required:

- PEP match
- High-risk jurisdiction (FATF grey/black list)
- Transaction value above $10k single or $50k cumulative annual
- Beneficial owner of an entity customer
- Cross-border high-value
- Adverse media match
- Tier 3 desired by user

Discretionary:

- Unusual transaction patterns
- Sudden volume spike
- Inconsistency between stated income and observed flows

### 6.2 EDD data

- Source of funds (where the money came from)
- Source of wealth (overall financial picture)
- Bank statements (3–6 months)
- Beneficial ownership tree (for entities; everyone ≥25%)
- Purpose of the relationship (why use Smart Agent)
- Expected volume + cadence
- Senior management sign-off

### 6.3 EDD process

- Manual case queue
- Investigator (BSA Officer or delegate) reviews
- SLA: 5 business days
- Decision: approve / deny / approve-with-conditions
- Documented decision record

### 6.4 Ongoing monitoring

Tier 2+ users monitored on rolling basis:

- Daily: sanctions list refresh against known addresses
- Weekly: PEP + adverse media refresh
- Monthly: behavioral anomaly check
- Quarterly: aggregate volume review
- Annually: full re-verification of high-risk users

---

## 7. Transaction monitoring

### 7.1 Rule-based monitoring

Define rules to flag patterns:

- **Structuring**: multiple transactions just below the $10k threshold.
- **Layering**: complex chains of transfers to obscure origin.
- **Integration**: tainted funds appearing as legitimate.
- **Rapid in/out**: deposit + immediate withdrawal pattern.
- **Velocity spike**: unusual transaction rate.
- **Geographic concentration**: many users from a single high-risk
  region.
- **Round numbers**: artificial round-dollar amounts.
- **Counterparty concentration**: many users sending to a single
  counterparty.

### 7.2 Behavioral monitoring

Machine-learning models (often vendor-provided):

- Baseline each user's typical pattern.
- Flag deviations.
- Surface for human review.

### 7.3 Vendors

Bundled with KYC vendor (Sumsub has strong TX monitoring;
Persona is weaker), OR standalone:

- **Hummingbird** — case management + monitoring
- **Featurespace** — behavioral analytics
- **Unit21** — workflow + monitoring
- **Alessa**
- **Refinitiv**

### 7.4 Investigation workflow

```
Alert → Triage:
  → Low severity: auto-closed with audit log
  → Medium: investigator review (24h SLA)
  → High: investigator + BSA Officer review (4h SLA)

Investigation:
  → Gather: tx history, sender/receiver info, counterparty,
    contextual signals
  → Document: investigation notes
  → Decide: clear / SAR / freeze / escalate

If SAR-worthy:
  → File via SAR-MSB form within 30 days
  → File supplemental SAR if pattern continues
  → Do NOT tip off the user
```

---

## 8. SAR filing

### 8.1 When to file

A Suspicious Activity Report is required when there is a "known or
suspected violation of law, money laundering, financial crime, or
suspicious transaction lacking apparent lawful purpose."

Threshold for reporting:

- **$2,000+ aggregate** transaction if MSB and the activity is
  suspicious.
- **No threshold** for terrorist financing.

### 8.2 How to file

- **SAR-MSB form** via the BSA E-Filing System.
- **30 days** from initial detection.
- **No tip-off**: confidentially. Disclosure to the subject is a
  criminal offense.

### 8.3 What goes in a SAR

- Subject information (CIP data).
- Transaction details (dates, amounts, counterparties).
- Reason for suspicion.
- Investigative actions taken.
- Supporting documents (attachments).

### 8.4 SAR record retention

- SAR + supporting documents: 5 years.
- No sharing outside FinCEN / law enforcement.
- Subject does NOT know a SAR was filed.

### 8.5 314(b) information sharing

MSBs can voluntarily share information with other 314(b)-registered
MSBs for AML purposes. Registration via FinCEN's secure system.

---

## 9. Recordkeeping

### 9.1 What to retain

- CIP data: 5 years after account closure.
- Transaction records: 5 years.
- SARs: 5 years.
- CTRs: 5 years.
- AML program documents: 5 years post-supersession.
- Training records: 5 years.
- Audit reports: 5 years.

### 9.2 Where to retain

- Identity documents: `person-mcp` (encrypted; PII).
- Transaction records: chain (public) + GraphDB mirror.
- SARs: secure, separate storage (e.g., S3 with versioned access logs +
  KMS encryption). Restricted access (BSA Officer + counsel only).
- Training + audit: `output/compliance/` document store.

### 9.3 Access controls

- Identity docs: BSA Officer + designated reviewers; full audit log.
- SARs: BSA Officer + counsel; access on need-to-know.
- All access events audit-logged.

### 9.4 Retention vs. GDPR right-to-erasure

GDPR Art. 17 (right to erasure) + CCPA-equivalent allow users to
request deletion. But BSA requires 5-year retention.

Resolution: **regulatory retention overrides erasure** for the period
required. Document the lawful basis (Art. 6(1)(c) compliance with a
legal obligation). Inform the user; delete other data; retain only the
BSA-required minimum.

---

## 10. Implementation outline

### 10.1 Architecture

```
apps/web/src/
  lib/
    kyc/
      tier-policy.ts                 // per-tier limits and gates
      tier-current.ts                // fetch current user tier
      tier-upgrade.ts                // trigger upgrade flow
      providers/
        persona.ts                   // Persona SDK + webhook
        sumsub.ts                    // Sumsub SDK
        twilio-verify.ts             // Tier 1 phone verify
      cdd/
        cip-collect.ts               // CIP data collection
        cip-verify.ts                // verification orchestration
        risk-score.ts                // risk classification
      edd/
        case-create.ts
        case-review.ts
        case-decision.ts
      tx-monitoring/
        rules.ts                     // rule definitions
        velocity-check.ts
        structuring-check.ts
        anomaly-check.ts
      sar/
        sar-draft.ts
        sar-file.ts                  // BSA E-Filing integration
      gates/
        action-gate.ts               // central tier-gate
        amount-gate.ts               // per-tier limit gate
        velocity-gate.ts             // pattern gate
        edd-gate.ts                  // EDD-required gate

apps/person-mcp/
  src/
    tools/
      kyc_store.ts                   // store CIP data (encrypted)
      kyc_read.ts                    // gated retrieval
      tier_status.ts                 // get current tier
```

### 10.2 Action-gate sketch

```typescript
async function gateAction(opts: {
  userId: string;
  action: string;           // e.g., 'honor', 'disburse', 'fundTreasury'
  amountUsd: number;
}): Promise<{ ok: true } | { ok: false; reason: string; nextStep: string }> {
  const tier = await getTier(opts.userId);
  const policy = tierPolicy[opts.action];

  if (opts.amountUsd > policy.limitsByTier[tier]) {
    return {
      ok: false,
      reason: `tier-limit-exceeded`,
      nextStep: `upgrade-to-tier-${policy.tierRequired(opts.amountUsd)}`,
    };
  }

  // Velocity check
  const velocity = await getVelocity(opts.userId, '24h');
  if (velocity + opts.amountUsd > policy.dailyLimits[tier]) {
    return {
      ok: false,
      reason: `daily-limit-exceeded`,
      nextStep: `wait-or-edd`,
    };
  }

  // Anomaly check
  const anomaly = await checkAnomaly(opts.userId, opts);
  if (anomaly.flag) {
    return {
      ok: false,
      reason: `anomaly-flagged: ${anomaly.rule}`,
      nextStep: `manual-review`,
    };
  }

  return { ok: true };
}
```

### 10.3 Persona integration sketch

```typescript
// At Tier 2 upgrade
const inquiry = await persona.inquiry.create({
  template: 'itmpl_smart_agent_kyc',
  referenceId: user.agentAccount,
  fields: { email: user.email, phone: user.phone },
});

// Frontend embeds Persona widget with inquiry.session_token

// Webhook on completion
app.post('/webhooks/persona', async (req, res) => {
  const event = verifyPersonaWebhook(req);
  if (event.type === 'inquiry.completed') {
    await applyKycResult({
      userId: event.payload.reference_id,
      tier: 2,
      result: event.payload,
    });
  }
  res.sendStatus(200);
});
```

### 10.4 Sumsub Travel Rule

```typescript
import { TravelRuleClient } from 'sumsub-trp';

const client = new TravelRuleClient({ apiKey: env.SUMSUB_KEY });

// Before sending USDC to another VASP
const beneficiaryVasp = await client.lookupVasp(beneficiaryAddress);
if (beneficiaryVasp && transferAmount > 1000) {
  await client.sendTravelRuleData({
    transactionId: tx.hash,
    originator: { fullName, nationalId, address },
    beneficiary: { fullName, address },
    amount: transferAmount,
    asset: 'USDC',
  });
}
```

### 10.5 Webhook security

Webhooks from KYC vendors must be signed. Verify signatures before
applying. NEVER trust webhook payload without verification. Each vendor
provides HMAC verification SDK.

### 10.6 Sandbox + staging

Each vendor offers a sandbox. Use it for:

- Engineering integration tests.
- Persona test inquiries (use Persona's test SSN '000-00-0000').
- Onfido test documents (vendor-provided).
- Pen-test the integration before production.

---

## 11. Tension with privacy

### 11.1 The fundamental tension

Smart Agent's privacy posture (AnonCreds, nullifier-keyed rows,
passkey-only stateless auth) is incompatible with strict KYC. The
compromise:

1. **Identity at provisioning, not at action.** KYC happens once at
   tier upgrade. Subsequent on-chain actions use AnonCreds + nullifier
   rows. The MCP layer holds the mapping; the chain holds the action.
2. **Audit reassembly.** A regulator with subpoena can reassemble the
   audit trail by querying `person-mcp`. The public + GraphDB don't see
   it.
3. **Pseudonymous third-party visibility.** Pool stewards see the
   pledger's nullifier-keyed row, not their legal name (unless
   `storyPermissions = public`, in which case the on-chain assertion
   has the linkage anyway).

### 11.2 What we sacrifice

We can't truthfully claim "Smart Agent doesn't know who you are." We
will hold KYC data for tier 2+ users. Marketing copy must be honest
about this:

> "Smart Agent uses [Vendor] to verify your identity at tier 2 and
> above. Your identity is stored in your personal MCP and encrypted at
> rest. Smart Agent's pool / org-facing surfaces use anonymous
> credentials so other users don't see your legal identity, but Smart
> Agent (the platform operator) and regulators with appropriate legal
> authority do."

### 11.3 What we preserve

- Tier 0 + Tier 1 remain quasi-pseudonymous (email + phone, no gov ID).
- On-chain actions remain nullifier-keyed; the chain doesn't expose
  legal identity.
- Pool stewards see anonymized contributor data (with privacy
  cascades).
- AnonCreds prevents cross-action linkability for the pseudonymous
  layer.

### 11.4 GDPR Article 6 lawful basis

For EU users, the lawful basis for collecting KYC data:

- **Art. 6(1)(c) — legal obligation** — if MTL/CASP says we must.
- **Art. 6(1)(f) — legitimate interests** — fallback for fraud
  prevention.
- **Art. 6(1)(a) — consent** — for non-mandatory data.

For special-category data (biometric — selfie/liveness):

- **Art. 9(2)(g) — substantial public interest** with member-state law
  basis (AML).
- **Art. 9(2)(a) — explicit consent** — best practice.

---

## 12. Counsel + vendor engagement

### 12.1 BSA / AML counsel

Same firms as RL1 + RL4 — most have integrated practices.

Engagement scope:

```
Smart Agent — AML/CTF Program Development

Background:
  Smart Agent moves USDC between user-controlled smart accounts.
  Pending RL1 opinion on MTL/CASP status; KYC/AML program design is
  required either way.

Requested deliverables:
  (a) Written AML program document (policies + procedures).
  (b) Tier-policy review + sign-off.
  (c) SAR procedures + sample SARs.
  (d) BSA Officer designation + role description.
  (e) Training curriculum + materials.
  (f) Annual program-audit framework.
  (g) Travel Rule procedures.
  (h) PEP + sanctions screening overlap with RL4.

Materials we provide:
  - RL1, RL3, RL4 (this directory)
  - Spec 005 plan
  - Tiered KYC model (this doc § 3)

Engagement model: $20k–$50k initial program; $30k–$120k/yr retainer.
```

### 12.2 BSA Officer

Required: a designated BSA Officer / AML Compliance Officer. Roles:

- Approve and maintain the AML program.
- Oversee SAR filings.
- Train staff.
- Independent reporting (not reporting to engineering or sales).
- Cite-able authority for FinCEN exams.

Early-stage Smart Agent: BSA Officer can be a fractional / outsourced
role. Vendors offering this:

- **Treliant** — fractional CCO services.
- **Confer** — AML-as-a-service.
- **Patomak Global Partners** — boutique compliance.
- **Promontory Financial Group (IBM)** — enterprise.

Cost: $50k–$200k/year for fractional; $200k–$400k/year for full-time.

### 12.3 KYC vendor engagement

(See § 4 for vendor list.)

Engagement timeline:

| Week | Activity |
|---|---|
| 0 | Identify 3–5 candidates |
| 1 | Demo + reference checks |
| 2 | Pricing requests |
| 3 | DPA + contract negotiation |
| 4–6 | Sandbox integration |
| 7–8 | Pilot with internal testers |
| 9 | Production cutover |
| 10+ | Volume scaling |

---

## 13. Cost model

### 13.1 Initial build

| Item | Cost |
|---|---|
| BSA / AML counsel (program design) | $20k–$50k |
| Engineering: tier-policy + gates | $40k–$80k |
| Engineering: KYC vendor integration | $30k–$60k |
| Engineering: transaction monitoring | $40k–$80k |
| Engineering: SAR + audit log | $20k–$40k |
| Engineering: Travel Rule | $30k–$60k |
| Engineering: identity-data storage in MCPs | $20k–$40k |
| **Total build** | **$200k–$410k** |

### 13.2 Ongoing

| Item | Annual cost |
|---|---|
| KYC vendor (per-check + base) | $20k–$200k |
| Travel Rule (Sumsub / Notabene) | $10k–$50k |
| Sanctions + PEP (overlap with RL4) | $20k–$100k |
| Adverse media | $5k–$30k |
| BSA Officer (fractional or in-house) | $80k–$300k |
| AML counsel retainer | $30k–$120k |
| Annual independent audit | $20k–$80k |
| Training + compliance materials | $5k–$20k |
| **Ongoing floor** | **~$190k–$900k/yr** |

### 13.3 Per-user economics

For 1,000 active Tier 2+ users at $5 average per-verification:
~$5,000/yr.

For 10,000 active Tier 2+ users: ~$50,000/yr in verifications + some
fraction need EDD ($20/case × 5% × 10,000 = $10k).

KYC vendor variable cost scales linearly. Operating leverage kicks in
above 100,000 users.

---

## 14. Bibliography

### Statutes & regulations

- **Bank Secrecy Act**: 31 U.S.C. §§ 5311–5336
- **USA PATRIOT Act**: Pub. L. 107-56 (2001) — §§ 312, 314, 326
- **31 CFR Chapter X** — BSA implementing regulations
- **31 CFR § 1010.610** — special measures
- **31 CFR § 1022.210–212** — MSB AML program requirements
- **31 CFR § 1022.220** — MSB CIP rules
- **31 CFR § 1010.311** — CTR thresholds
- **31 CFR § 1022.320** — MSB SAR rules
- **Regulation (EU) 2024/1620** — EU AMLA
- **Regulation (EU) 2024/1624** — EU 6AMLR Single Rulebook
- **Regulation (EU) 2023/1113** — EU Travel Rule
- **Directive (EU) 2018/1673** — 6AMLD
- **UK Money Laundering Regulations 2017** (SI 2017/692)
- **FATF Recommendations** — [link](https://www.fatf-gafi.org/en/topics/fatf-recommendations.html)
- **FATF Recommendation 16** — Travel Rule

### FinCEN guidance

- **FIN-2019-G001** — CVC business-model guidance: [PDF](https://www.fincen.gov/system/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf)
- **FinCEN MSB Registration**: [link](https://www.fincen.gov/resources/money-services-business-msb-registration)
- **BSA E-Filing System**: [link](https://bsaefiling.fincen.treas.gov/)
- **Form 107 (MSB Registration)**
- **Form 109 (SAR-MSB)**

### Practitioner analyses

- **InnReg — Fintech Compliance Checklist 2026**: [link](https://www.innreg.com/blog/fintech-compliance-checklist-essential-guide)
- **Top 10 KYC Providers 2026 (didit.me)**: [link](https://didit.me/blog/top-10-kyc-providers-in-2026-features-pricing-comparison/)
- **iDenfy — KYC Provider Comparison**: [link](https://idenfy.com/blog/best-identity-verification-software/)
- **HyperVerge — Jumio Pricing**: [link](https://hyperverge.co/blog/jumio-pricing/)
- **HyperVerge — Jumio Alternatives**: [link](https://hyperverge.co/blog/jumio-competitors/)
- **finconduit — KYC Vendor Selection for Crypto**: [link](https://finconduit.com/resources/kyc-vendor-selection-crypto-exchange)
- **Au10tix — Top 10 KYC Solutions 2026**: [link](https://www.au10tix.com/blog/top-10-kyc-solutions-reviewed/)
- **Relevant Software — Fintech Compliance 2026**: [link](https://relevant.software/blog/fintech-compliance/)
- **TrustCloud — Crypto Compliance 2026**: [link](https://www.trustcloud.ai/grc/crypto-compliance-unveiled-overcoming-regulatory-hurdles-in-the-digital-era/)

### Vendors

- **Persona**: [link](https://withpersona.com/)
- **Onfido**: [link](https://onfido.com/)
- **Jumio**: [link](https://www.jumio.com/)
- **Veriff**: [link](https://www.veriff.com/)
- **Sumsub**: [link](https://sumsub.com/)
- **iDenfy**: [link](https://idenfy.com/)
- **Au10tix**: [link](https://www.au10tix.com/)
- **Trulioo**: [link](https://www.trulioo.com/)
- **Notabene** (Travel Rule): [link](https://notabene.id/)
- **ComplyAdvantage**: [link](https://complyadvantage.com/)
- **Refinitiv World-Check**: [link](https://www.lseg.com/en/risk-intelligence/world-check)
- **Hummingbird** (case mgmt): [link](https://www.hummingbird.co/)

### Related internal documents

- [`README.md`](./README.md)
- [`RL1-money-transmitter-license-analysis.md`](./RL1-money-transmitter-license-analysis.md) — overlap
- [`RL3-tax-reporting-1099-and-international.md`](./RL3-tax-reporting-1099-and-international.md) — TIN overlap
- [`RL4-ofac-sanctions-screening.md`](./RL4-ofac-sanctions-screening.md) — sanctions overlap
- [`RL6-tos-privacy-acceptable-use.md`](./RL6-tos-privacy-acceptable-use.md) — Privacy Policy overlap
- `specs/007-architecture-hardening/phase-H-privacy-and-iac.md` — AnonCreds custodial-privacy policy
- `docs/information-architecture/` — data ownership boundaries
