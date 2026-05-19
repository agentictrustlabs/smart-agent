# RL4 — OFAC Sanctions Screening

> **NOT LEGAL ADVICE.** This document scopes the sanctions program.
>
> Cross-ref: [RL1 MTL](./RL1-money-transmitter-license-analysis.md)
> for the money-transmitter overlay; [RL5 KYC/AML](./RL5-kyc-aml-high-risk-flows.md)
> for identity overlap.

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Sanctions framework overview](#2-sanctions-framework-overview)
3. [Smart Agent's sanctions exposure](#3-smart-agents-sanctions-exposure)
4. [Lists to screen against](#4-lists-to-screen-against)
5. [On-chain screening](#5-on-chain-screening)
6. [On-platform screening](#6-on-platform-screening)
7. [Smart contract integration](#7-smart-contract-integration)
8. [Implementation outline](#8-implementation-outline)
9. [False positive handling](#9-false-positive-handling)
10. [Vendor selection](#10-vendor-selection)
11. [Operational procedures](#11-operational-procedures)
12. [Cost model](#12-cost-model)
13. [Bibliography](#13-bibliography)

---

## 1. Executive summary

OFAC sanctions compliance is **NON-OPTIONAL for any US-touching crypto
platform**. Violations carry strict liability under the International
Emergency Economic Powers Act (IEEPA) — civil penalties up to ~$372k
per violation (2026, indexed annually) or 2× transaction value, plus
potential criminal exposure for willful violations.

Smart Agent's exposure surfaces at four chokepoints:

1. **User onboarding** — block users in sanctioned jurisdictions; block
   users on the SDN list.
2. **AgentAccount address creation** — refuse to CREATE2-deploy an
   AgentAccount for a sanctioned key.
3. **Pre-userOp screening** — before relaying any userOp that moves
   USDC, screen sender + recipient + counter-party addresses.
4. **Real-time monitoring** — ongoing surveillance for post-onboarding
   exposure (a user's address gets added to SDN later).

**Required vendors**: one of Chainalysis, TRM Labs, or Elliptic for
blockchain analytics; combined with platform-level screening (the
vendor's web API + their on-chain oracle).

**Cost**: $20k–$100k/year for SaaS + $5k–$15k implementation.

**Hard rule** (from Spec 007 goal #4 — no silent fallbacks): if the
sanctions oracle is unreachable, the platform FAILS CLOSED. No userOp
relays. No new account deploys. Failure is visible to the user as an
HTTP 503, not as a silent skip.

---

## 2. Sanctions framework overview

### 2.1 OFAC's legal authority

- **International Emergency Economic Powers Act (IEEPA)**: 50 U.S.C. §§
  1701–1707 — authority to impose sanctions during national emergencies.
- **Trading with the Enemy Act (TWEA)**: 50 U.S.C. App. §§ 1–44 — used
  for Cuba sanctions.
- **National Emergencies Act**: 50 U.S.C. § 1601 et seq.
- **31 CFR Chapter V**: OFAC's regulations.

Sanctions are imposed by Executive Order, then implemented by OFAC via
Specially Designated Nationals (SDN) list designations + jurisdiction-
based sanctions programs.

### 2.2 Strict liability

OFAC enforces **strict liability** — intent is not required. A platform
that processes a transaction with a sanctioned address can be liable
even if it didn't know.

Mitigating factors: a robust compliance program reduces penalties.
OFAC's Enforcement Guidelines (Appendix A to 31 CFR Part 501) outline
the factors.

### 2.3 Reporting blocked transactions

When a transaction is BLOCKED (because counterparty is sanctioned),
the entity must:

- Report to OFAC within 10 business days (annual report; quarterly for
  some categories).
- Maintain blocked property report (TD-F 90-22.50 form).
- Retain blocked property for the duration of sanctions (often
  indefinite).

For crypto: "blocking" means refusing to process. The funds remain in
the user's smart account; we don't seize. We DO refuse to relay the
userOp and notify OFAC.

### 2.4 The 50% rule

OFAC's "50 Percent Rule": entities owned 50%+ by SDNs are themselves
treated as SDN-blocked, even if not specifically listed. This requires
beneficial-ownership knowledge → KYC tier-2+ (RL5).

### 2.5 Sectoral sanctions

Some programs (Russia, Iran, Venezuela) include SECTORAL identifications
that don't block all transactions but restrict specific activities (debt
financing, certain technologies). Less relevant for Smart Agent's
charitable/civic surface, but counsel must confirm.

---

## 3. Smart Agent's sanctions exposure

### 3.1 Direct exposure paths

| Path | What's screened | What happens if positive |
|---|---|---|
| User onboarding (signup) | User's IP, email, declared country | Reject signup |
| AgentAccount creation | The owner key address(es) | Refuse to deploy |
| Pre-userOp (action layer) | All addresses in the userOp | Refuse to relay |
| Recipient address (disbursement) | Recipient AgentAccount address | Refuse to disburse |
| Periodic re-screen | All known user addresses | Block + report |

### 3.2 Indirect exposure paths

| Path | Risk |
|---|---|
| Smart-contract interaction with sanctioned protocol (e.g., Tornado Cash post-2026 re-listing) | If Smart Agent's contracts call a sanctioned protocol, OFAC violation |
| User receives funds from sanctioned address | "Tainted" funds — not directly our violation but creates a downstream issue |
| Cross-chain bridges | Bridge counterparty may be sanctioned |

### 3.3 The Tornado Cash story

OFAC sanctioned Tornado Cash in August 2022, designating the smart
contract addresses themselves as SDNs. This was unprecedented: a smart
contract — software, not a person — was on the SDN list.

In March 2025, OFAC formally DELISTED Tornado Cash following a Fifth
Circuit Court decision that the smart contracts were not "property"
subject to OFAC blocking authority (*Van Loon v. Treasury*, 23-50669
(5th Cir. 2024)).

But on November 8, 2025, OFAC RE-DESIGNATED Tornado Cash citing ties to
the DPRK Lazarus Group. The redesignation cites different legal
authorities and is narrower in scope.

**Implication for Smart Agent**:

- We do NOT integrate with mixers / privacy protocols.
- If users self-direct USDC to/from sanctioned addresses, we screen.
- AnonCreds privacy (Spec 004) is FOR USER PRIVACY but is NOT a mixer
  — there's no value-mixing function, just credential issuance.
- A user who anonymously pledges to a pool via AnonCreds is NOT in
  Tornado-Cash-like territory; nullifier-keyed rows don't obscure value
  flow.

Sources: [Chainalysis Tornado Cash analysis](https://www.chainalysis.com/blog/tornado-cash-sanctions-challenges/),
[Crypto Sanctions 2026](https://www.chainalysis.com/blog/crypto-sanctions-2026/).

### 3.4 The 2026 Iran enforcement actions

On April 24, 2026, OFAC blacklisted two crypto wallets directly tied to
Iran's Central Bank, triggering an immediate freeze of ~$344.2M in
Tether USDT. In January 2026, OFAC blacklisted Zedcex and Zedxion (UK-
registered exchanges) over ~$1B in stablecoin flows linked to IRGC.

**Implication**: Iran-linked addresses are an active enforcement
priority. Screening must update in near-real-time.

Sources: [Crowdfund Insider — OFAC Iran USDT freeze](https://www.crowdfundinsider.com/2026/04/275454-ofac-sanctions-cryptocurrency-addresses-linked-to-central-bank-of-iran-freezes-344m-analysis/),
[CoinDesk — Treasury probes Iran sanctions evasion](https://www.coindesk.com/policy/2026/02/03/u-s-treasury-probes-crypto-exchanges-over-iran-sanctions-evasion-trm-labs-says).

### 3.5 Comprehensively sanctioned jurisdictions (as of May 2026)

- Cuba (TWEA — comprehensive)
- Iran (IEEPA — comprehensive)
- North Korea / DPRK (IEEPA — comprehensive)
- Syria (IEEPA — comprehensive)
- Russia (various — sectoral + targeted; some regions like Crimea,
  Donetsk, Luhansk, Kherson, Zaporizhzhia are comprehensive)
- Belarus (various)
- Venezuela (sectoral)
- Myanmar / Burma (limited)

Smart Agent should geofence comprehensively sanctioned jurisdictions
out entirely. Other jurisdictions screened transaction-by-transaction.

---

## 4. Lists to screen against

### 4.1 US lists (primary)

| List | Maintainer | What it contains | URL |
|---|---|---|---|
| **SDN List** | OFAC | Specially Designated Nationals | [link](https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists) |
| **Sectoral Sanctions Identifications (SSI)** | OFAC | Sectoral targets | [link](https://ofac.treasury.gov/consolidated-sanctions-list) |
| **Consolidated Sanctions List** | OFAC | All OFAC non-SDN | [link](https://ofac.treasury.gov/consolidated-sanctions-list) |
| **Denied Persons List** | BIS | Export Administration violators | [link](https://www.bis.doc.gov/index.php/policy-guidance/lists-of-parties-of-concern/denied-persons-list) |
| **Entity List** | BIS | Foreign parties subject to export licensing | [link](https://www.bis.doc.gov/index.php/policy-guidance/lists-of-parties-of-concern/entity-list) |
| **Unverified List** | BIS | Foreign parties of national security concern | [link](https://www.bis.doc.gov/index.php/policy-guidance/lists-of-parties-of-concern/unverified-list) |
| **Debarred List** | State Dept | DDTC defense services debarred | [link](https://www.pmddtc.state.gov/ddtc_public/ddtc_public?id=ddtc_kb_article_page&sys_id=c22d1833dbb8d300d0a370131f9619f0) |
| **PEP Lists** | Various | Politically Exposed Persons | Multiple commercial sources |

### 4.2 International lists

| List | Jurisdiction | URL |
|---|---|---|
| **UN Security Council Consolidated List** | UN | [link](https://www.un.org/securitycouncil/content/un-sc-consolidated-list) |
| **EU Consolidated List** | EU | [link](https://www.sanctionsmap.eu/) |
| **UK Sanctions List** | UK OFSI | [link](https://www.gov.uk/government/publications/the-uk-sanctions-list) |
| **Australia Consolidated List** | AU DFAT | [link](https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list) |
| **Canada Sanctions List** | Global Affairs CA | [link](https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx) |
| **Japan Foreign End User List** | METI | [link](https://www.meti.go.jp/policy/anpo/law05.html) |
| **FATF Grey/Black List** | FATF | [link](https://www.fatf-gafi.org/) — high-risk jurisdictions |

### 4.3 On-chain SDN identifications

OFAC began adding digital currency addresses to the SDN list in
November 2018. The SDN list includes addresses for Bitcoin, Ethereum,
Litecoin, XRP, and others under "Digital Currency Address" identifier
type.

OFAC explicitly notes that SDN address listings "are not likely to be
exhaustive." Vendor analytics (Chainalysis, TRM, Elliptic) add
INFERRED addresses (clusters that share custody with SDN addresses).

### 4.4 Update cadence

- OFAC SDN: updated daily (sometimes intra-day on emergency designations).
- Vendor lists: updated continuously; typically <1 hour from OFAC update.
- Internal cache: refresh AT LEAST DAILY; ideally hourly.

Smart Agent must use VENDOR streaming/webhook updates, not just a
periodic OFAC fetch.

---

## 5. On-chain screening

### 5.1 What it covers

Vendor blockchain-analytics tools maintain databases of:

- Direct SDN addresses (from OFAC).
- "Same-cluster" addresses (clustering heuristics).
- Funds-flow taint (X hops downstream from SDN).
- Counterparty risk scores.
- Smart contract risk (e.g., sanctioned protocol contracts).

### 5.2 Vendor APIs

**Chainalysis** ([https://www.chainalysis.com/](https://www.chainalysis.com/)):

- **Address Screening API** — POST address → risk score
- **Transaction Screening API** — screen specific tx
- **Sanctions API** — boolean is-sanctioned check
- **Wallet Reactor** — investigative UI
- **KYT (Know Your Transaction)** — real-time monitoring
- **Crypto Compliance Oracle** — on-chain queryable
- Pricing: enterprise contract; typical $30k–$200k/year

**TRM Labs** ([https://www.trmlabs.com/](https://www.trmlabs.com/)):

- **Forensics** — investigative
- **TRM Tactical** — enterprise compliance
- **TRM Wallet Screening** — pre-tx
- **Sanctions API** — pre-tx
- **Real-time alerts**
- Pricing: enterprise; $30k–$150k/year typical

**Elliptic** ([https://www.elliptic.co/](https://www.elliptic.co/)):

- **Navigator** — pre-tx screening
- **Investigator** — forensic
- **Lens** — risk profiling
- **Discovery** — supplemental data
- Pricing: $25k–$120k/year typical

### 5.3 Choice criteria

| Criterion | Chainalysis | TRM Labs | Elliptic |
|---|---|---|---|
| Established | 2014 (oldest) | 2018 | 2013 |
| US gov contracts | extensive | extensive | moderate |
| Coverage chains | 30+ chains | 30+ chains | 20+ chains |
| Real-time API | yes | yes | yes |
| On-chain oracle | yes | yes (Chainabuse) | no |
| Pricing transparency | low | moderate | moderate |
| Demo / sandbox | yes | yes | yes |

Recommended Phase 1: **TRM Labs** or **Chainalysis**. Both are
acceptable to US regulators. Choose based on demo + price quote.

### 5.4 Free / public alternatives

Inferior to commercial but useful as backup:

- **OFAC SDN search**: [https://sanctionssearch.ofac.treas.gov/](https://sanctionssearch.ofac.treas.gov/)
- **Etherscan label cloud**: includes some sanctions tags
- **Open Sanctions** ([https://www.opensanctions.org/](https://www.opensanctions.org/)):
  free aggregated SDN/UN/EU lists with API access; not crypto-specific
- **Chainalysis on-chain oracle (free)**:
  contract `0x40C57923924B5c5c5455c48D93317139ADDaC8fb` on Ethereum
  mainnet — boolean `isSanctioned(address)` view

Engineering recommendation: USE the free Chainalysis oracle as a
LAST-LINE backup, plus a paid TRM Labs / Chainalysis full subscription
for primary screening.

---

## 6. On-platform screening

### 6.1 User-identity screening (RL5 overlap)

At KYC onboarding (Tier 1+), screen the user's:

- Legal name
- DOB
- Address
- Government ID
- Email / phone

Against name-based sanctions lists. Most KYC vendors (Persona, Onfido,
Jumio, Veriff — see RL5) bundle sanctions screening as a default add-on.

### 6.2 IP-geolocation

Block IP addresses from comprehensively sanctioned jurisdictions
(Cuba, Iran, DPRK, Syria, certain Russian regions).

Vendors:

- **MaxMind GeoIP2** — [https://www.maxmind.com/en/geoip-databases](https://www.maxmind.com/en/geoip-databases) — $50–$500/year
- **IPinfo** — [https://ipinfo.io/](https://ipinfo.io/) — $99–$999/month
- **DigitalElement NetAcuity**
- **IP2Location**

VPN/proxy detection adds a layer:

- **Castle Risk API**
- **IPQualityScore**

### 6.3 Declared-country screening

At signup, ask user to declare country. Block declared-country in
sanctioned jurisdictions. The user can lie, but the declaration
combined with IP-geo + KYC provides multiple gates.

### 6.4 Periodic re-screening

Already-onboarded users should be re-screened periodically:

- Daily for OFAC list updates against known addresses (cheap; just
  hash-compare the cached lists).
- Weekly full re-screen of all user identities (more expensive; vendor
  bills per check).
- Triggered re-screen on any high-risk event (e.g., transaction to
  known mixer cluster).

### 6.5 Address-cluster screening

If a user receives funds from a sanctioned cluster, their address is
now "tainted." Even if the user is innocent, OFAC compliance requires
careful handling.

Most vendors flag clusters; we accept a tunable risk-score threshold
(e.g., 0–100 scale; block at 75+).

---

## 7. Smart contract integration

### 7.1 Optional on-chain enforcer

Engineering can add an `OFACScreeningEnforcer` to the caveat enforcer
list:

```solidity
// packages/contracts/src/enforcers/OFACScreeningEnforcer.sol
// (planned, not yet implemented)

import "./ICaveatEnforcer.sol";

/**
 * @notice Calls an on-chain sanctions oracle to verify
 *         counterparty addresses before allowing a delegation
 *         redeem.
 */
contract OFACScreeningEnforcer is ICaveatEnforcer {
    address public immutable ORACLE;

    constructor(address oracle) { ORACLE = oracle; }

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        ModeCode mode,
        bytes calldata executionCallData,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external view override {
        address counterparty = abi.decode(terms, (address));
        bool sanctioned = ISanctionsOracle(ORACLE).isSanctioned(counterparty);
        require(!sanctioned, "OFAC: counterparty sanctioned");
    }
    // ... rest
}
```

The Chainalysis on-chain oracle (free) at
`0x40C57923924B5c5c5455c48D93317139ADDaC8fb` provides a public
`isSanctioned(address) returns (bool)` view function on Ethereum
mainnet (and similar on L2s).

### 7.2 Pros + cons

**Pros**:

- Defense in depth: even if the app-layer screen fails open, the
  on-chain enforcer blocks.
- Public verifiable: anyone can confirm the screen is in place.
- Reduces our regulator-narrative risk: the substrate enforces.

**Cons**:

- Adds gas cost.
- The on-chain oracle is a single point of failure / oracle-dependency.
- The oracle's list may lag the OFAC update by hours.
- Off-chain screening still required for non-on-chain identifiers
  (declared name, IP, etc.).

### 7.3 Recommendation

Implement the on-chain enforcer as **defense in depth**, not as
primary screen. Primary screen is app-layer. The contract enforcer
catches an app-layer slip.

Use the free Chainalysis oracle for on-chain checks. Bonus: free.

### 7.4 Per-action enforcer composition

Different actions get different enforcer chains. For high-stakes
disbursement (§2.5 in RL1):

```
[
  TimestampEnforcer,
  ValueEnforcer,
  AllowedTargetsEnforcer,
  AllowedMethodsEnforcer,
  OFACScreeningEnforcer(recipientAddr),  // <-- NEW
]
```

For low-stakes pledge submission (§2.1): no OFAC enforcer needed (no
money moves).

---

## 8. Implementation outline

### 8.1 Architecture

```
apps/web/src/
  lib/
    compliance/
      sanctions-screening.ts        // single entry point
      providers/
        trm-labs.ts                  // primary provider
        chainalysis.ts               // fallback / dual-screen
        opensanctions.ts             // free name-list provider
        onchain-oracle.ts            // Chainalysis free oracle
      cache/
        sdn-list-cache.ts            // local cache, refreshed hourly
        risk-score-cache.ts          // per-address risk score
      gates/
        signup-gate.ts               // at user onboarding
        deploy-gate.ts               // at AgentAccount deploy
        userop-gate.ts               // pre-relay
        disbursement-gate.ts         // at grant disbursement
      monitoring/
        periodic-rescreen.ts         // daily job
        blocked-tx-report.ts         // OFAC 10-day reporting

apps/a2a-agent/src/
  routes/
    onchain-redeem.ts                 // HOOK: call sanctions-screening here
```

### 8.2 The single entry point

```typescript
// apps/web/src/lib/compliance/sanctions-screening.ts

export interface ScreeningResult {
  ok: boolean;
  reason?: string;
  details?: {
    list?: string;        // e.g., "OFAC SDN"
    matchScore?: number;
    matchedEntries?: string[];
    riskScore?: number;
    flaggedClusters?: string[];
  };
  providerCalls: ProviderCall[];
}

export async function screenAddressForUserOp(opts: {
  address: string;
  context: 'sender' | 'recipient' | 'counterparty';
  riskThreshold?: number;  // default 75 / 100
}): Promise<ScreeningResult>;

export async function screenIdentity(opts: {
  legalName: string;
  dateOfBirth?: string;
  country?: string;
  identityDocs?: string[];
}): Promise<ScreeningResult>;
```

### 8.3 Fail-closed posture

```typescript
async function relayUserOp(op: UserOperation) {
  // 1. Sanctions check
  const sender = op.sender;
  const recipient = decodeRecipient(op.callData);

  const senderResult = await screenAddressForUserOp({
    address: sender, context: 'sender' });
  if (!senderResult.ok) {
    await reportBlockedTx({ op, reason: 'sender-sanctioned', result: senderResult });
    throw new HttpError(403, 'sanctions-block', senderResult);
  }

  if (recipient) {
    const recipientResult = await screenAddressForUserOp({
      address: recipient, context: 'recipient' });
    if (!recipientResult.ok) {
      await reportBlockedTx({ op, reason: 'recipient-sanctioned', result: recipientResult });
      throw new HttpError(403, 'sanctions-block', recipientResult);
    }
  }

  // 2. Proceed with relay
  return await entryPoint.handleOps([op], beneficiary);
}
```

NO silent catch. If the screening provider is unreachable, fail closed:

```typescript
async function screenAddressForUserOp(opts) {
  try {
    const trmResult = await trmLabs.check(opts.address);
    return { ok: trmResult.risk < (opts.riskThreshold ?? 75), ... };
  } catch (err) {
    // No fallback to "approve." Fail closed.
    log.error('TRM Labs unreachable', err);
    return { ok: false, reason: 'screening-unavailable', ... };
  }
}
```

### 8.4 Reporting blocked transactions

Annual OFAC report uses Form TD-F 90-22.50. Vendor (TRM Labs,
Chainalysis) typically provides tooling to draft this. Engineering
maintains the audit log; legal-ops files the form.

Required fields per blocked transaction:

- Date blocked
- Property description (USDC amount + token)
- Beneficial owner (if known)
- Country of origin/destination
- Reason for blocking (SDN match, jurisdiction, etc.)
- Reference number

### 8.5 Audit log

Every screening call, every block, every override is logged. Required
fields:

- Timestamp
- Caller identity (user, action, request ID)
- Screened identifier (address, name, country)
- Provider(s) called
- Result returned
- Action taken (allow / block / quarantine for human review)

Retention: 5 years per BSA.

---

## 9. False positive handling

### 9.1 Sources of false positives

- **Name similarity**: "Mohammed Ali" — common name, many false matches.
- **Cluster spillover**: an address receives 0.001 ETH from a flagged
  cluster as "dust attack" — false positive.
- **Stale data**: an address was delisted but cache hasn't refreshed.

### 9.2 Workflow

```
Match → Risk-score >= threshold?
  → YES: BLOCK + queue for human review (within 24h SLA)
  → NO: ALLOW with audit log

Human review:
  → Confirmed match: maintain block + report to OFAC
  → False positive: clear + allow + add to allowlist (with reason)
  → Ambiguous: hold + escalate to counsel
```

### 9.3 Allowlist mechanism

A reviewed-and-cleared address goes on an internal allowlist for, say,
30 days. The allowlist short-circuits future matches for the same
address. But it's REVIEWED against fresh data each time the OFAC list
updates.

### 9.4 User communication

When a user is blocked, communicate carefully:

- DO NOT say "you are on the SDN list" — that's potentially defamatory
  and may also be an OFAC "tipping" violation if it lets a user evade.
- DO say "we are unable to process this transaction at this time" with
  a vague reason.
- Provide a contact path: legal@smart-agent.example for review request.

### 9.5 Review SLA

Initial response: 24 hours.

Resolution: 5 business days (extended to 30 days for complex matches).

Counsel involvement: any genuine match.

---

## 10. Vendor selection

### 10.1 Phase 1 (MVP)

Single provider: pick ONE of Chainalysis / TRM Labs / Elliptic.
Recommended: **TRM Labs** — strong gov reputation, transparent pricing,
clean API.

### 10.2 Phase 2 (mature)

Dual provider: TRM Labs (primary) + Chainalysis (secondary, validation).
For high-risk transactions, both must clear; for low-risk, primary
alone.

### 10.3 Phase 3 (scale)

Full triple-redundancy: TRM + Chainalysis + Elliptic + on-chain oracle.
Cross-validation surfaces vendor inconsistencies.

### 10.4 Selection criteria

| Criterion | Weight |
|---|---|
| US gov references / OFAC relationship | 20% |
| Coverage of chains we operate on (ETH, Base, OP, ARB) | 15% |
| Real-time API + on-chain oracle | 15% |
| Price | 15% |
| API quality (REST, GraphQL, latency) | 10% |
| False-positive rate | 10% |
| Integration ease | 10% |
| Customer support | 5% |

### 10.5 RFP scope

```
Smart Agent — Blockchain Analytics RFP

Scope:
  - Address risk screening API (sub-second response).
  - Sanctions match API.
  - On-chain oracle (boolean is-sanctioned, free or low-cost).
  - Cluster + counterparty risk analysis.
  - Real-time webhook for new sanctions designations.
  - Investigative UI for human review.
  - Historical audit + compliance reporting.

Volume:
  - Phase 1: 10k–100k screen calls/month.
  - Phase 2: 100k–1M screen calls/month.

Required:
  - Coverage of Ethereum + Base + Optimism + Arbitrum.
  - 99.9% API uptime.
  - SOC 2 Type II.
  - Sandbox environment.

Pricing:
  - Annual contract.
  - Per-call pricing OR volume tier.
```

---

## 11. Operational procedures

### 11.1 Sanctions Compliance Officer

Designate a Sanctions Compliance Officer (SCO). For early-stage Smart
Agent, may be the same person as the BSA Officer (RL5) and Privacy
Officer (RL6). At scale, separate roles.

Responsibilities:

- Approve the program written policy.
- Oversee vendor selection + contract.
- Review all blocked-transaction reports.
- File OFAC reports.
- Train staff on sanctions program.
- Annual program audit.

### 11.2 Written program

OFAC's "Framework for OFAC Compliance Commitments" (May 2019) outlines
program components:

1. **Management commitment** — board / leadership endorsement.
2. **Risk assessment** — periodic.
3. **Internal controls** — policies + procedures.
4. **Testing + auditing** — independent.
5. **Training** — staff awareness.

Smart Agent's written program documents:

- `docs/security/privacy-and-compliance/sanctions-policy.md` (TODO)
- `docs/security/privacy-and-compliance/sanctions-procedures.md` (TODO)
- `docs/security/privacy-and-compliance/sanctions-training.md` (TODO)

### 11.3 Training

Annual training for all engineering + support staff who handle user
data. Topics:

- What OFAC is.
- What our program does.
- How to recognize a flagged transaction.
- How to escalate.
- What NOT to say to a flagged user.

### 11.4 Testing

Annual independent audit:

- Sample of screening calls reviewed.
- Confirm screening is on for all paths.
- Confirm no silent fallbacks.
- Confirm blocked tx reports filed.

### 11.5 Periodic OFAC self-assessment

OFAC encourages "voluntary self-disclosure" (VSD) of compliance lapses.
Mitigates penalties significantly. If we miss a screen, disclose
quickly.

---

## 12. Cost model

### 12.1 Initial build

| Item | Cost |
|---|---|
| Sanctions counsel (program review) | $10k–$30k |
| Vendor selection + contract | $5k–$15k |
| Engineering: screening service | $20k–$40k |
| Engineering: gates at each chokepoint | $15k–$30k |
| Engineering: on-chain enforcer | $10k–$25k |
| Engineering: audit log + reporting | $15k–$30k |
| Engineering: human-review UI | $20k–$40k |
| **Total build** | **$95k–$210k** |

### 12.2 Ongoing

| Item | Annual cost |
|---|---|
| TRM Labs / Chainalysis SaaS | $25k–$150k |
| IP-geolocation (MaxMind / IPinfo) | $1k–$10k |
| Free Chainalysis oracle | $0 (gas only) |
| Sanctions counsel retainer | $30k–$80k |
| SCO part-time (or share) | $50k–$200k |
| Annual independent audit | $10k–$30k |
| **Ongoing floor** | **~$120k–$470k/yr** |

### 12.3 Penalty avoidance

OFAC civil penalty per violation (2026): up to ~$372k per violation
(adjusted annually for inflation) or 2× the transaction value,
WHICHEVER IS GREATER. Multiple violations stack.

A program failure exposing 100 sanctioned transactions could create
$37M+ in civil exposure, plus criminal exposure for willful violations.
Compliance investment cost is dwarfed by the penalty risk.

---

## 13. Bibliography

### Statutes & regulations

- **International Emergency Economic Powers Act (IEEPA)**: 50 U.S.C. §§
  1701–1707
- **Trading with the Enemy Act (TWEA)**: 50 U.S.C. App. §§ 1–44
- **National Emergencies Act**: 50 U.S.C. § 1601 et seq.
- **31 CFR Chapter V** — OFAC regulations
- **Appendix A to 31 CFR Part 501** — OFAC Enforcement Guidelines
- **Executive Order 13848** — Imposing Certain Sanctions in the Event
  of Foreign Interference

### Cases

- **Van Loon v. Treasury**, 23-50669 (5th Cir. 2024) — Tornado Cash
  delisting case

### OFAC guidance

- **A Framework for OFAC Compliance Commitments** (May 2019):
  [PDF](https://ofac.treasury.gov/media/16331/download?inline)
- **OFAC FAQs**: [link](https://ofac.treasury.gov/faqs)
- **FAQ Topic — Virtual Currency**: [link](https://ofac.treasury.gov/faqs/topic/1626)
- **FAQ 562 — virtual currency screening**: [link](https://ofac.treasury.gov/faqs/562)
- **SDN List (human readable)**: [link](https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists)
- **Sanctions List Search**: [link](https://sanctionssearch.ofac.treas.gov/)

### Practitioner analyses

- **Chainalysis Crypto Sanctions 2026 Crime Report**:
  [link](https://www.chainalysis.com/blog/crypto-sanctions-2026/)
- **Chainalysis — OFAC Sanctions Tracker**:
  [link](https://www.chainalysis.com/blog/ofac-sanctions/)
- **Chainalysis — Tornado Cash compliance challenges**:
  [link](https://www.chainalysis.com/blog/tornado-cash-sanctions-challenges/)
- **TRM Labs — Tornado Cash response**:
  [link](https://www.trmlabs.com/resources/blog/how-defi-platforms-are-using-data-from-trm-labs-to-respond-to-tornado-cash-sanctions)
- **Elliptic — Crypto sanctions basics**:
  [link](https://www.elliptic.co/blockchain-basics/what-are-ofac-crypto-sanctions)
- **DEV.to — OFAC Sanctions Screening for DeFi developers**:
  [link](https://dev.to/easysolutions906/ofac-sanctions-screening-for-crypto-and-defi-a-developers-guide-3fj1)
- **Global Legal Insights — OFAC sanctions & digital assets**:
  [link](https://www.globallegalinsights.com/practice-areas/blockchain-cryptocurrency-laws-and-regulations/ofac-sanctions-and-digital-assets-regulation-compliance-and-recent-developments/)
- **Sanctions Lawyers — OFAC Cryptocurrency Sanctions 2026**:
  [link](https://sanctionslawyers.net/ofac-lawyers/ofac-cryptocurrency-sanctions/)

### Vendors

- **TRM Labs**: [link](https://www.trmlabs.com/)
- **Chainalysis**: [link](https://www.chainalysis.com/)
- **Elliptic**: [link](https://www.elliptic.co/)
- **MaxMind GeoIP2**: [link](https://www.maxmind.com/en/geoip-databases)
- **IPinfo**: [link](https://ipinfo.io/)
- **Open Sanctions**: [link](https://www.opensanctions.org/)
- **Chainalysis On-Chain Oracle** (free contract on Ethereum mainnet):
  [Etherscan](https://etherscan.io/address/0x40C57923924B5c5c5455c48D93317139ADDaC8fb)

### Related internal documents

- [`README.md`](./README.md)
- [`RL1-money-transmitter-license-analysis.md`](./RL1-money-transmitter-license-analysis.md)
- [`RL5-kyc-aml-high-risk-flows.md`](./RL5-kyc-aml-high-risk-flows.md) — KYC integration
- [`RL7-liability-framework.md`](./RL7-liability-framework.md) — insurance for sanctions failures
- `docs/security/threat-model.md` — sanctions-failure as adversary
