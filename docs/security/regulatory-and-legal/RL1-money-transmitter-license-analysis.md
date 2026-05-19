# RL1 — Money Transmitter License Analysis

> **STATUS**: PRODUCT-EXISTENTIAL. The conclusion of this document
> determines whether Smart Agent can ship to public users at all, and if
> so on what timeline, in what jurisdictions, with what license cost.
>
> **NOT LEGAL ADVICE.** Counsel must opine. This document scopes the
> question for counsel.

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Activity surface — every money-movement code path](#2-activity-surface)
3. [The legal question — Is Smart Agent a money transmitter?](#3-the-legal-question)
4. [State-by-state landscape (US)](#4-state-by-state-landscape-us)
5. [Federal landscape (US)](#5-federal-landscape-us)
6. [International landscape](#6-international-landscape)
7. [Decision framework](#7-decision-framework)
8. [Operational alternatives to MTL](#8-operational-alternatives-to-mtl)
9. [Recommended counsel engagement](#9-recommended-counsel-engagement)
10. [Cost model](#10-cost-model)
11. [Recommendation + go/no-go gate](#11-recommendation--gono-go-gate)
12. [Marketing posture](#12-marketing-posture)
13. [Bibliography](#13-bibliography)

---

## 1. Executive summary

Smart Agent's product surface — pool pledges, treasury-held USDC, on-
behalf-of-user disbursements, and server-relayed userOps — sits squarely
inside the analytical zone where US states have aggressively asserted
money-transmitter jurisdiction since 2018. The federal FinCEN test
(31 CFR 1010.100(ff)(5)) has no transaction threshold; the moment Smart
Agent's server submits a userOp that causes USDC to move from a user-
controlled smart account to a pool-controlled smart account, the
"transfer of funds" element of the money-transmitter definition is
plausibly met. Whether Smart Agent itself is *the* transmitter, or merely
provides software that the user uses to self-transmit, depends on
counsel's read of (a) custody of keys, (b) custody of the contract-level
"owner" relationship, and (c) the discretion the server has over which
calls to submit.

**Tentative engineering hypothesis** (subject to counsel verification):

- **FinCEN MSB**: probably YES we must register, because the master and
  deployer keys still sit in the userOp path until Spec 007 Phase A/B/C
  lands. Even after 007, the server signs the bundler envelope and may
  sign the session-issuance envelope — that is "transfer of funds on
  behalf of others."
- **New York DFS BitLicense**: YES if we serve NY residents. The
  BitLicense definition covers "transmission of Virtual Currency."
- **California DFPI DFAL**: YES if we serve CA residents, by July 1,
  2026. DFAL added an explicit crypto regime.
- **Texas**: possibly NO under Supervisory Memorandum 1037 *if* we only
  move non-stablecoin crypto. But we move USDC, which IS stablecoin, and
  Texas explicitly designated stablecoin transmission as money
  transmission in 2019. So: probably YES in Texas too.
- **EU CASP under MiCA**: YES if we serve EU residents. Custody +
  transfer = "providing custody and administration of crypto-assets on
  behalf of clients" (one of the eight CASP activities).
- **UK FCA**: NEW REGIME triggers October 2027, gateway opens September
  2026. YES if we serve UK residents.
- **Singapore MAS DPT licence**: YES if we serve SG residents AND
  monthly volumes exceed SGD 3M OR we hold customer digital tokens in
  custody.

**Implication**: A public US-wide launch (and certainly a global launch)
without an MTL/MSB/CASP path is not legally feasible. A closed-cohort
testnet-only launch (where no real money moves) sidesteps every regime
above and is the recommended posture for the foreseeable future.

---

## 2. Activity surface

This section inventories every code path in the current repo that causes
USDC (or any value) to move on behalf of a user. Counsel's analysis must
cover EVERY entry on this list. Items marked TODAY are live in code;
items marked PLANNED are in spec but not implemented.

### 2.1 Pledge submission (Spec 002 / Spec 005 prep)

- **Code path**: `apps/web/src/lib/onchain/poolPledgeAssertion.ts` +
  `apps/org-mcp/src/tools/poolPledges.ts` →
  `packages/contracts/src/PledgeRegistry.sol::submit()`.
- **Today**: writes a pledge ROW to chain via the org-mcp's session-
  delegation-relayed call. NO MoneyEvent — pledges are commitments, not
  transfers.
- **Money moves?** NO at submit. The pledge is "I commit $50/month
  to this pool." Money moves at honor (§2.3) or markPaid (§2.4).
- **Regulatory exposure**: probably none at submit; the pledge is more
  like an unsecured promise.

### 2.2 Pool treasury seeding (dev only — Spec 005 Phase 2)

- **Code path**: `forge script` mints MockUSDC to a pool's AgentAccount
  during fresh-start; PRODUCTION never mints — this is `chainId ===
  31337` gated.
- **Money moves?** NO in production; in dev, MockUSDC is non-monetary.
- **Regulatory exposure**: none.

### 2.3 Honor (cryptographic settlement; Spec 005 Rail A)

- **Code path**: user web action →
  `AgentAccount.executeBatch([USDC.transfer(poolAgent, amount),
  PledgeRegistry.recordHonor(...)])`.
- **Today**: MockUSDC only. PLANNED: real USDC on public chain.
- **Money moves?** YES — `USDC.transfer()` moves stablecoin from donor's
  AgentAccount to pool's AgentAccount.
- **Who signs?** The donor's AgentAccount executes the batch. Auth
  is via session-delegation redeemed through `DelegationManager`. The
  bundler signer (master key) submits the userOp to the EntryPoint.
- **Regulatory exposure**: **HIGH**. This is the central code path that
  triggers the money-transmitter analysis. Even if the donor is the
  ultimate decision-maker, Smart Agent's server (a) holds the keys that
  validate session ownership, (b) submits the userOp, (c) operates the
  pool agent's account on the other end. The transfer happens through
  Smart Agent's substrate end to end.

### 2.4 Mark-paid (attested settlement; Spec 005 Rail B)

- **Code path**: pool steward web action →
  `PledgeRegistry.markPaid(pledgeSubj, token, amount, rail,
  evidenceHash)`.
- **Today**: PLANNED (Spec 005 Phase 5).
- **Money moves?** NO on chain — markPaid is an attestation that
  off-chain payment occurred. The evidence (e.g., a wire receipt) lives
  in org-mcp.
- **Regulatory exposure**: **MEDIUM**. Attestation that money moved
  through some external rail is not in itself money transmission. But it
  IS a record-keeping system for off-chain payments, which creates AML/
  KYC obligations on the pool steward (who SHE is, who the recipient
  is). Smart Agent doesn't move the money but does create the audit
  trail that a regulator will inspect.

### 2.5 Grant disbursement (Spec 006 / disbursementAssertion)

- **Code path**: pool steward web action →
  `AgentAccount.executeBatch([USDC.transfer(recipientAddr, amount),
  ClassAssertion.emit(DisbursementAssertion)])` →
  `apps/web/src/lib/onchain/disbursementAssertion.ts`.
- **Today**: Phase 1 emits only — no USDC.transfer yet. PLANNED for
  Phase 3.
- **Money moves?** YES at Phase 3 — USDC moves from pool's AgentAccount
  to recipient's address (which may be an AgentAccount or an EOA).
- **Regulatory exposure**: **HIGH**. This is "transmission" to a third
  party — the recipient is not the sender. Even if the recipient is
  named in the proposal and selected via vote, the actual movement of
  funds is at the steward's direction through Smart Agent's substrate.
  This is the classical money-transmitter scenario.

### 2.6 Treasury-to-treasury transfers (Spec 005 v2 backlog)

- **Code path**: PLANNED. An org's AgentAccount calls
  `USDC.transfer(otherOrgAgent, amount)` via session-delegation.
- **Today**: not implemented.
- **Regulatory exposure**: HIGH; same analysis as §2.5.

### 2.7 Personal treasury funding (Spec 005 Phase 6)

- **Code path**: donor funds their own AgentAccount (their "personal
  treasury") with USDC; could be via on-ramp, bridge, or direct
  ETH/USDC deposit.
- **Today**: in dev, MockUSDC.mint(donorAgent, amount); in prod, the
  donor brings their own USDC.
- **Money moves?** YES from external wallet to donor's AgentAccount.
- **Who controls?** The donor — their AgentAccount is owned by their
  passkey / EOA / demo EOA (post-007).
- **Regulatory exposure**: **LOW** — this looks like a self-hosted-
  wallet deposit. The donor controls the destination key. Smart Agent
  is software, not a custodian for this leg.
- **Caveat**: until Spec 007 lands, the master key is a co-owner of every
  AgentAccount. That co-ownership might make Smart Agent a custodian
  for the deposit too. RESOLVE BY LANDING 007.

### 2.8 Match-initiation lane (Spec 001)

- **Code path**: writes a MatchInitiation row on chain; no money moves.
- **Regulatory exposure**: none for now. But if "matching" later carries
  a fee or routes money, this becomes §2.3-like.

### 2.9 Proposal lane (Spec 003)

- **Code path**: writes a GrantProposal row on chain; no money moves
  until §2.5.
- **Regulatory exposure**: none for now.

### 2.10 Inter-agent / A2A / inter-MCP money flows

- **Code path**: any future "agent pays another agent" flow over A2A or
  MCP would trigger the same money-transmitter analysis.
- **Today**: not implemented.
- **Regulatory exposure**: HIGH the moment it's wired.

### 2.11 The bundler relay

- **Code path**: `apps/a2a-agent/src/routes/onchain-redeem.ts` →
  `EntryPoint.handleOps()`. The master/bundler key pays gas to the
  EntryPoint for the user's userOp.
- **Money moves?** Indirectly — the user's userOp transfers value; the
  bundler pays the gas in ETH; the bundler may be reimbursed via the
  paymaster.
- **Regulatory exposure**: **MEDIUM** — gas-relay services are not
  per-se money transmitters (FinCEN has not pronounced on this
  specifically for ERC-4337), but a regulator could view the bundler as
  a transmitter of value if reimbursement flows back. The 1Inch /
  Stackup / Pimlico / Alchemy bundler operators have been operating in
  regulatory grey for 2 years. We must NOT be in their shoes — we want
  a licensed third-party bundler (e.g. Pimlico, Stackup) for production.

### 2.12 Paymaster

- **Code path**: PLANNED — see `output/PAYMASTER-INTEGRATION-PLAN.md`.
- **Regulatory exposure**: HIGH if Smart Agent operates the paymaster
  (we are sponsoring gas, possibly being reimbursed in USDC). Use a
  licensed third-party paymaster.

### Summary table

| # | Path | Today | Real money moves? | Reg exposure |
|---|---|---|---|---|
| 2.1 | Pledge submit | live | no | none |
| 2.2 | MockUSDC mint | dev-only | no | none |
| 2.3 | Honor (Rail A) | MockUSDC | YES (planned) | **HIGH** |
| 2.4 | Mark-paid (Rail B) | planned | no on-chain | medium |
| 2.5 | Disbursement | Phase1 emit | YES (planned) | **HIGH** |
| 2.6 | Treasury-to-treasury | planned | YES | HIGH |
| 2.7 | Personal treasury fund | live | YES at deposit | low (post-007) |
| 2.8 | MatchInitiation | live | no | none |
| 2.9 | Proposal | live | no | none |
| 2.10 | Inter-agent A2A | planned | unknown | HIGH if wired |
| 2.11 | Bundler relay | live | gas only | medium |
| 2.12 | Paymaster | planned | YES | HIGH |

The four HIGH paths (§2.3, §2.5, §2.6, §2.10+2.12) collectively define
the regulatory perimeter. Any opinion letter must explicitly cover all
four.

---

## 3. The legal question

### 3.1 The FinCEN money-transmitter definition

31 CFR 1010.100(ff)(5) defines "money transmitter" as a person that
provides money transmission services, where money transmission services
means:

> "the acceptance of currency, funds, or other value that substitutes for
> currency from one person and the transmission of currency, funds, or
> other value that substitutes for currency to another location or
> person by any means."

Key features:

- **No transaction threshold** — FinCEN's MSB definition explicitly
  states "no activity threshold applies to the definition of money
  transmitter." (See [FinCEN MSB Definition](https://www.fincen.gov/money-services-business-definition).)
- **"Other value that substitutes for currency"** — FinCEN's 2013 and
  2019 CVC guidance explicitly includes convertible virtual currency
  (CVC). USDC is a stablecoin pegged to USD and redeemable for USD; it
  is CVC and almost certainly meets the test.
- **"From one person"** — the donor is the sender.
- **"To another person"** — the pool steward / recipient is the receiver.
- **"By any means"** — covers blockchain transactions.

### 3.2 The "user controls the keys" argument (anti-transmitter)

The defense is: the donor signs the userOp authorization (via passkey or
EOA); the donor's smart account executes the transfer; Smart Agent is
just software the donor uses. This is the "self-hosted wallet" argument
that has been broadly accepted for MetaMask, Rabby, Frame, etc.

**Where this argument WORKS**:

- The donor's smart account is owned by the donor's keys ONLY (post-007).
- The donor authorizes each transfer via passkey/EOA — no server-side
  policy can move funds without donor signature.
- Smart Agent's server merely RELAYS (like Infura relaying a tx) — does
  not have unilateral authority.

**Where this argument FAILS**:

- Master key is currently an `_owner` on every AgentAccount — Smart
  Agent has unilateral authority to move funds even without the user.
  Spec 007 Phase A removes this; until then, the argument fails on its
  face.
- Session-delegation flows let Smart Agent's server submit transfers
  within a caveat envelope, without per-action user signature. Even with
  caveats, this is "discretion to move funds under a policy" — different
  from a pure relay.
- The pool's AgentAccount is owned by the pool steward, but Smart
  Agent's server holds the relay keys + the GraphDB record of who the
  pool steward is + the org-mcp's session-delegation envelope. It is
  hard to argue Smart Agent is "just software" when Smart Agent
  operates every leg of the system.

### 3.3 The "rails not transmitter" argument (anti-transmitter)

The defense is: Smart Agent provides rails (smart contracts, indexing,
UI). It does not take custody. Compare to Visa providing rails for card
transactions — Visa is not the money transmitter, the issuing bank is.

**Why this might work**: Smart Agent's smart contracts are open-source
and on-chain; anyone can call them. Smart Agent's UI is convenience,
not custody. There is no Smart Agent bank account holding funds in
flight.

**Why this might fail**:

- The contracts ARE Smart Agent's substrate (P1 in `principles.md`). We
  built them, deployed them, control upgrades to them via the
  AgentControl + AgentImplementationOwner system.
- The session-delegation chain is signed by Smart Agent's master.
- The bundler is operated by Smart Agent (or operated by a third party
  under Smart Agent's contract).
- The donor's smart account is initialized by Smart Agent's deployer
  (CREATE2 from `AgentAccountFactory`).

### 3.4 The "agent of receiver" argument

A more nuanced argument: when Smart Agent moves USDC from a donor to a
pool, Smart Agent is the AGENT of the receiver (the pool / the
recipient). Some state regimes exempt "agents of the payee."

**Examples**:

- Florida Money Transmitter Act § 560.103(23) exempts "agent of a
  payee" under defined conditions.
- California's MTL regime has narrow agent-of-payee carve-outs.
- Texas Memo 1037 does not directly address this.

**Why this might work**: if the pool / recipient designates Smart Agent
as its collection agent, and the donor knows this, the receipt by Smart
Agent is constructive receipt by the pool.

**Why this might fail**:

- "Agent of payee" exemptions vary by state and most require an explicit
  written agreement between the agent and the payee.
- It does not solve the problem at the federal level — FinCEN does NOT
  have an "agent of payee" exemption.

### 3.5 The "non-custodial" claim

If Smart Agent could honestly claim "Smart Agent never holds keys that
can move user funds," then most regimes would not apply.

**Why this is hard**:

- Master key is currently a co-owner (pre-007).
- Even post-007, master signs session-delegation envelopes that AUTHORIZE
  fund movement.
- Bundler key submits userOps that EXECUTE fund movement.
- The deployer key initializes user accounts in such a way that the
  factory + implementation contracts are upgradable by Smart Agent.

**What would make it true**: a substantially different architecture
where (a) user owns their account with no Smart Agent co-owner, (b) all
session-delegation chains are signed by the user only, (c) the bundler
is a public good (Pimlico, Stackup) not operated by Smart Agent, (d) the
contracts are immutable or upgradable only by user vote.

This is the architecture Spec 007 + a hypothetical Spec 008 (paymaster
externalization + bundler externalization) would yield. It is a
multi-month transformation, not a flag flip.

### 3.6 The hybrid view

Most likely counsel outcome: Smart Agent is a money transmitter for
SOME of the activity surface (§2.3, §2.5, §2.6) and NOT for others
(§2.1, §2.7, §2.8, §2.9). Counsel may recommend product-design changes
to push the HIGH paths into a partner-managed (e.g., Stripe Issuing,
Circle, BVNK, Wyre/MoonPay/Transak) or licensed-third-party model.

---

## 4. State-by-state landscape (US)

### 4.1 California — DFPI Digital Financial Assets Law (DFAL)

- **Statute**: California Financial Code Division 1.25 (DFAL), enacted
  October 2023, in force July 1, 2025; license applications open
  March 9, 2026 via NMLS; compliance deadline July 1, 2026.
- **What triggers it**: "digital financial asset business activity"
  including "exchanging, transferring, storing, or issuing" a digital
  financial asset for or on behalf of California residents.
- **Bond**: minimum $500,000 surety bond or trust account.
- **Application fee**: TBD by DFPI (modeled on MTL fee structure).
- **Capital**: minimum capital + liquidity per DFPI determination.
- **Separation from MTL**: DFAL is in addition to the California Money
  Transmission Act (CMTA); a company holding customer fiat AND digital
  assets may need both.
- **In scope?** **YES** if Smart Agent serves CA residents and moves
  USDC. Stablecoin transfer = "transferring a digital financial asset."
- **Implication**: either geofence California out, or apply by July 1,
  2026 deadline.

Source: [DFPI Digital Financial Assets](https://dfpi.ca.gov/regulated-industries/digital-financial-assets/),
[Womble Bond Dickinson DFAL alert](https://www.womblebonddickinson.com/us/insights/alerts/californias-new-digital-financial-assets-law-requires-application-cryptocurrency).

### 4.2 New York — DFS BitLicense

- **Statute**: 23 NYCRR Part 200 (BitLicense regulation, 2015).
- **What triggers it**: "Virtual Currency Business Activity" including
  "transmission of Virtual Currency," "storing, holding, or maintaining
  custody or control of Virtual Currency on behalf of others," and
  "performing exchange services."
- **Application fee**: $5,000 (2026).
- **Surety bond / trust fund**: starting at $500,000 (volume-scaled).
- **CISO required**: every licensee.
- **Biennial exam**: every two years.
- **Cybersecurity**: 23 NYCRR Part 500 (extended to BitLicensees);
  penetration tests, vulnerability scans, real-time blockchain analytics.
- **Approved**: fewer than 50 entities as of 2026.
- **2026 enforcement**: NYDFS issued cease-and-desist + civil penalties
  ($100k–$500k each) to three crypto platforms operating without a
  BitLicense.
- **In scope?** **YES** if Smart Agent serves NY residents.

Source: [NY DFS Virtual Currency Business Licensing](https://www.dfs.ny.gov/virtual_currency_businesses),
[BitLicense Wikipedia](https://en.wikipedia.org/wiki/BitLicense).

### 4.3 Texas — Memo 1037

- **Statute**: Texas Finance Code Chapter 152 (Money Services Act); TDB
  Supervisory Memorandum 1037 (originally 2014, revised April 2019 and
  later).
- **Key 2019 amendment**: stablecoins were brought INTO the definition
  of "money" under Texas Finance Code § 152.003(19). A stablecoin is
  treated as money if it: (a) is pegged to a sovereign currency, (b) is
  fully backed by reserves, (c) grants the holder a right to redeem for
  sovereign currency.
- **USDC**: meets all three criteria.
- **Implication**: USDC transmission in Texas IS money transmission.
  Non-stablecoin crypto (BTC, ETH not pegged) is NOT money transmission
  in Texas — the original Memo 1037 carve-out remains.
- **MTL bond**: typically $300k–$2M based on volume.
- **In scope?** **YES** for USDC pathways.

Source: [Texas Virtual Currency Guidance](https://www.dob.texas.gov/consumer-information/virtual-currency-guidance),
[Supervisory Memorandum 1037](https://www.dob.texas.gov/public/uploads/files/consumer-information/sm1037.pdf).

### 4.4 Wyoming

- **Special Purpose Depository Institution (SPDI)** charter (2019) —
  allows custody of digital assets without a traditional banking
  charter. Available to entities serving institutional customers.
- **No state MTL needed** for SPDI-chartered institutions.
- **For unchartered entities**: WY MTL still applies; bond ~$10k–$500k.
- **In scope?** YES under MTL unless chartered.

### 4.5 Florida

- **Statute**: Florida Money Services Businesses Act, F.S. Chapter 560.
- **Agent-of-payee exemption**: F.S. § 560.103(23)(a)(1).
- **Crypto-specific**: 2023 amendments brought "virtual currency" into
  the money-transmitter definition.
- **Bond**: $100k base.
- **In scope?** YES, but agent-of-payee may apply for grant
  disbursements (§2.5).

### 4.6 Other states (illustrative, not exhaustive)

| State | MTL needed for USDC? | Bond | Notes |
|---|---|---|---|
| Alabama | YES | $100k+ | Net worth $25k min |
| Alaska | varies | — | Less defined for crypto |
| Arizona | YES | $25k | |
| Colorado | YES | **$1M** flat | High bond burden |
| Connecticut | YES | $300k–$1M | Volume-scaled |
| Delaware | YES | $25k | |
| Georgia | YES | $100k | |
| Illinois | YES | $25k | |
| Kansas | YES | $200k–$1M | Volume-scaled |
| Kentucky | YES | $500k–$5M | High bond burden |
| Massachusetts | YES | $50k | |
| Michigan | YES | $500k | |
| Minnesota | YES | $25k | |
| New Hampshire | YES | $100k | |
| New Jersey | YES | $100k | |
| Oregon | YES | $25k | |
| Pennsylvania | YES | $1M | |
| Tennessee | YES | $500k | |
| Vermont | YES | $50k | |
| Virginia | YES | $25k | |
| Washington | YES | $550k | |
| **Montana** | **NO MTL regime** | $0 | Only state without MTL |

Cumulative: a 50-state + DC footprint runs $240k–$475k+ in application
+ initial bonding; $225k–$280k/yr in maintenance. Add legal: 50-state
filings are $500k–$1.5M total over 18–24 months.

Source: [Money Transmitter License Costs (Brico)](https://www.brico.ai/post/how-much-do-mtls-cost),
[Money Transmitter License Requirements by State (Ridgeway)](https://www.ridgewayfs.com/money-transmitter-license-requirements-by-state/).

### 4.7 NMLS — the unified application portal

The Nationwide Multistate Licensing System (NMLS) is the system of
record for most state MTL applications. A 50-state filing through NMLS
typically takes 12–24 months end-to-end. NMLS uses harmonized forms
(MU1, MU2, MU3) but each state retains its own approval discretion +
its own bond amount + its own exam.

---

## 5. Federal landscape (US)

### 5.1 FinCEN MSB registration

- **Statute**: 31 CFR Chapter X; specifically § 1010.100(ff) defines
  MSB; § 1010.380 requires registration; §§ 1022.210–212 set the AML
  program requirements.
- **Fee**: $0 to register; ongoing program cost = staff + tooling.
- **Registration form**: FinCEN Form 107 (filed via the BSA E-Filing
  System).
- **Trigger**: providing money transmission services as defined above.
- **AML program required**: written program with (a) internal controls,
  (b) independent testing, (c) designated compliance officer, (d)
  training.
- **CTRs**: Currency Transaction Reports for cash $10k+ — N/A for
  crypto-only.
- **SARs**: Suspicious Activity Reports — filed via SAR-MSB form, due
  within 30 days of detection.
- **Records retention**: 5 years.
- **In scope?** **YES** if Smart Agent is a money transmitter for any
  US activity surface item.

Source: [FinCEN MSB Registration](https://www.fincen.gov/resources/money-services-business-msb-registration),
[31 CFR 1010.100 (eCFR)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-A/section-1010.100).

### 5.2 FinCEN CVC Guidance (2019)

The May 2019 FinCEN guidance ([FIN-2019-G001](https://www.fincen.gov/system/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf))
is the most directly relevant interpretive guidance.

Key categories:

- **Administrator**: a person engaged as a business in issuing CVC and
  who has the authority to redeem CVC. (Not us — we don't issue USDC.)
- **Exchanger**: a person engaged as a business in the exchange of CVC
  for currency or other CVC. (Not us — we don't exchange.)
- **User**: a person that obtains CVC to purchase goods or services on
  the user's own behalf. (Donors are users; pool stewards are users.)
- **Money transmitter (sub-category of exchanger / administrator OR
  separately)**: "A person that accepts and transmits value that
  substitutes for currency by any means."

The guidance EXPLICITLY identifies as money transmitters:

- **Hosted wallets** that have total independent control over CVC.
- **Multi-sig wallets** where the wallet provider has additional
  signature authority.
- **Anonymizing services** (mixers, tumblers).
- **DApp developers** if the DApp is itself an MSB activity (transfer
  of value for/from third parties).

Smart Agent is closest to "multi-sig wallet provider with additional
signature authority" (pre-007). Post-007 we move closer to "self-hosted
wallet" but the bundler / paymaster / session-delegation envelopes keep
us in scope.

### 5.3 FinCEN proposed rule on unhosted wallets (FinCEN-2020-0020)

A proposed FinCEN rule (December 2020) would require MSBs to collect
counterparty information for transactions with unhosted wallets above
certain thresholds. The rule has been in limbo since 2021. If finalized,
it changes the operational requirements significantly. Counsel should
flag the status as of engagement date.

### 5.4 SEC, CFTC, OCC, Federal Reserve

- **SEC**: covered in RL2 (securities analysis).
- **CFTC**: cryptocurrency commodities (BTC, ETH, etc.); USDC may be
  scrutinized as a derivative if "synthetic dollar" framing is used.
  Not an immediate issue for Smart Agent.
- **OCC**: bank chartering; SPDI-equivalent at federal level (proposed
  but not finalized).
- **Federal Reserve**: master account access for crypto-native banks.
  Not relevant to Smart Agent unless we pursue a bank charter.

### 5.5 The 2026 SEC/CFTC joint cryptoasset interpretation

On March 17, 2026, SEC + CFTC issued a joint interpretive release
([Federal Register](https://www.federalregister.gov/documents/2026/03/23/2026-05635/application-of-the-federal-securities-laws-to-certain-types-of-crypto-assets-and-certain))
establishing a securities taxonomy for crypto-assets. It does not
directly cover money transmission, but it clarifies that "governance
rights" alone do not turn a digital commodity into a security. See RL2.

---

## 6. International landscape

### 6.1 EU — MiCA + DAC8

**Markets in Crypto-Assets Regulation (EU) 2023/1114** ("MiCA"):

- **Effective**: stablecoin provisions June 30, 2024; CASP provisions
  December 30, 2024.
- **Transitional period**: pre-existing CASPs can operate under national
  law until July 1, 2026 or earlier approval/denial.
- **Eight CASP activities**: custody, exchange of crypto-assets for
  funds, exchange for other crypto-assets, operation of a trading
  platform, execution of orders, placing of crypto-assets, reception
  and transmission of orders, advice + portfolio management, **transfer
  services**.
- **Smart Agent's profile**: custody (pool-AgentAccount holds USDC) +
  transfer services (pool → recipient disbursement) = at least two CASP
  activities.
- **Capital requirements**: €50k (advisory), €125k (trading platform),
  €150k (high-impact: custody, exchange).
- **Single authorization passports across 27 EU member states.**
- **Issuance**: issued by the National Competent Authority (NCA) of the
  member state of establishment — e.g., BaFin (Germany), AMF (France),
  CSSF (Luxembourg), MFSA (Malta), CySEC (Cyprus).
- **Timeline**: 6–12 months for authorization.
- **In scope?** YES if Smart Agent serves EU residents.

Source: [ESMA MiCA portal](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica),
[Dechert MiCA CASP](https://www.dechert.com/knowledge/onpoint/2025/1/application-of-second-part-of-mica---regulation-of-casps-and-oth.html).

### 6.2 UK — FCA cryptoasset regime

- **Statute**: Financial Services and Markets Act 2000 (Cryptoassets)
  Regulations 2026, made February 4, 2026.
- **In force**: October 25, 2027 (expected).
- **Gateway**: September 30, 2026 to February 28, 2027 for applications.
- **What triggers it**: dealing, arranging, advising, managing,
  issuing stablecoins, **safeguarding qualifying cryptoassets**,
  operating a trading platform, intermediation, staking.
- **Custody trigger**: holding client cryptoassets for 24+ hours.
- **In scope?** YES if Smart Agent serves UK residents. The 24-hour
  custody trigger likely catches pool-AgentAccount holdings.

Source: [FCA new cryptoasset regime](https://www.fca.org.uk/firms/new-regime-cryptoasset-regulation).

### 6.3 Singapore — MAS Payment Services Act

- **Statute**: Payment Services Act 2019, as amended; Digital Token
  Service Provider (DTSP) provisions added 2023.
- **Licenses**: Standard Payment Institution (SPI) — for limited volumes;
  Major Payment Institution (MPI) — for higher volumes; DTSP — for
  crypto-specific services.
- **MPI threshold**: SGD 3 million/month volume OR holding customer
  funds/digital tokens in custody.
- **DPT services**: dealing, providing custody, transfer.
- **In scope?** YES if Smart Agent serves SG residents.

Source: [MAS Payment Services Act](https://www.mas.gov.sg/regulation/acts/payment-services-act).

### 6.4 Switzerland — FINMA

- **Framework**: VASP regime under AMLA (Anti-Money Laundering Act).
- **Self-regulatory organization (SRO) membership**: many crypto firms
  affiliate with VQF, PolyReg, or similar SROs.
- **In scope?** YES if Smart Agent serves CH residents.

### 6.5 Canada — FINTRAC

- **Statute**: Proceeds of Crime (Money Laundering) and Terrorist
  Financing Act (PCMLTFA).
- **Registration**: as a Money Services Business (MSB) at the federal
  level; some provinces add separate requirements (e.g., Quebec AMF).
- **In scope?** YES if Smart Agent serves CA residents.

### 6.6 Australia — AUSTRAC

- **Statute**: Anti-Money Laundering and Counter-Terrorism Financing Act
  2006; Digital Currency Exchange registration.
- **In scope?** YES if Smart Agent serves AU residents.

### 6.7 Japan — JFSA

- **Statute**: Payment Services Act + Financial Instruments and
  Exchange Act.
- **Crypto Asset Exchange Service Provider (CAESP) registration**
  required.
- **In scope?** YES if Smart Agent serves JP residents.

### 6.8 Other jurisdictions

A non-exhaustive list of jurisdictions with cryptoasset licensing
regimes: Hong Kong (SFC), South Korea (FSC), UAE (VARA), Brazil (CVM),
Mexico (CNBV), South Africa (FSCA), Israel (CMA), India (FIU-IND under
PMLA).

### 6.9 OFAC overlay

OFAC sanctions apply globally to US-touch transactions. See RL4.

---

## 7. Decision framework

### 7.1 The threshold questions

Counsel must answer:

1. **Q1**. Is Smart Agent a "money transmitter" under FinCEN's
   definition for any of the activity-surface paths in §2?
2. **Q2**. Does the post-Spec-007 architecture change the answer to Q1?
3. **Q3**. For each US state in scope, what is the state's
   crypto-specific regime, and does Smart Agent trigger it?
4. **Q4**. For each non-US jurisdiction in scope, what is the regime?
5. **Q5**. Are there per-path exemptions that apply (agent-of-payee,
   technology-provider, etc.)?
6. **Q6**. What re-architecture or product-design changes would shift
   us out of scope?

### 7.2 Launch-jurisdiction matrix

Engineering proposes the following matrix for Phase 1 counsel discussion:

| Jurisdiction | Phase 1 launch? | Regime | Decision |
|---|---|---|---|
| US — California | NO (defer) | DFAL + CMTA | Geofence until license or partner model |
| US — New York | NO (defer) | BitLicense | Geofence until license or partner model |
| US — Texas | NO (defer) | Memo 1037 | Geofence until USDC question is resolved |
| US — Wyoming | possibly YES | WY MTL or SPDI | Counsel to evaluate WY-first |
| US — Florida | NO (defer) | F.S. 560 | Geofence; revisit agent-of-payee |
| US — Montana | possibly YES | No state MTL | Federal-only burden; counsel evaluate |
| US — other 45 | NO (defer) | Various MTL | Geofence pending counsel |
| EU 27 | NO (defer) | MiCA CASP | Geofence until CASP license |
| UK | NO (defer) | FCA regime | Geofence until 2027 license |
| Singapore | NO (defer) | MAS MPI/DTSP | Geofence until license |
| Switzerland | possibly YES | FINMA / SRO | Counsel evaluate (lower cost) |
| Canada | NO (defer) | FINTRAC MSB | Geofence |
| Other | NO | Various | Geofence |

The "possibly YES" jurisdictions are candidates for a closed-cohort
pilot. None should ship without counsel.

### 7.3 Activity-surface gating

Even within a permissible jurisdiction, gate which activity-surface paths
are open:

| Path | Risk | Phase 1 gate |
|---|---|---|
| §2.1 Pledge | none | open |
| §2.2 MockUSDC dev | none | open (dev only) |
| §2.3 Honor Rail A | HIGH | **closed in production** until counsel |
| §2.4 Mark-paid Rail B | medium | open with KYC + recordkeeping |
| §2.5 Disbursement | HIGH | **closed in production** until counsel |
| §2.6 Treasury-to-treasury | HIGH | **closed in production** until counsel |
| §2.7 Personal-treasury deposit | low | open (post-007) |
| §2.8 MatchInitiation | none | open |
| §2.9 Proposal | none | open |
| §2.10 A2A money | HIGH | **not implemented** |
| §2.11 Bundler relay | medium | open with third-party bundler |
| §2.12 Paymaster | HIGH | open with third-party paymaster |

### 7.4 Go / no-go gate language

**Phase 0 (NOW — engineering complete)**: this document.

**Phase 1 gate (counsel-issued)**: BEFORE any of §2.3 / §2.5 / §2.6 ship
to public production, counsel must issue a written opinion confirming
EITHER:

- Smart Agent is not a money transmitter for that path (and the rationale),
  OR
- Smart Agent has obtained the necessary licenses for the launch
  jurisdictions, OR
- Smart Agent has restructured the path (e.g., agent-of-payee, partner-
  managed transmitter, non-custodial redesign) such that the path no
  longer triggers transmitter requirements.

**Phase 2 gate (operational)**: BEFORE any of §2.3 / §2.5 / §2.6 ship,
the following operational primitives must be in place:

- OFAC sanctions screening (RL4) — automated, no-silent-fallback.
- KYC for any user above tier-0 (RL5) — automated, vendor-integrated.
- 1099 / DAC8 readiness (RL3) — TIN collection at recipient onboarding.
- TOS/Privacy/AUP (RL6) — accepted at signup; re-accept on changes.
- Cyber + E&O insurance (RL7) — bound and active.

---

## 8. Operational alternatives to MTL

### 8.1 Non-custodial redesign (Option A — the architecture path)

**Concept**: Smart Agent never holds keys that can authorize fund
movement. User self-custody upstream. The chain executes; Smart Agent is
software.

**Required changes**:

- Spec 007 Phase A — drop master co-ownership. ALREADY PLANNED.
- New Spec — externalize the bundler. Use Pimlico / Stackup / Alchemy
  Bundler as third-party gas relay.
- New Spec — externalize the paymaster. Use Pimlico Paymaster or similar.
- New Spec — eliminate the deployer-fallback signing for passkey/SIWE
  users (currently a workaround for stateless auth — Spec 007 Phase C).
- New Spec — make AgentAccount upgrades user-controlled only (governance
  by AgentAccount owners, not by Smart Agent admin).
- User key recovery moves to user-held social-recovery setup, not
  Smart-Agent-held recovery.

**Cost**: 3–6 months engineering, $300k–$600k. Eliminates most MTL
exposure but does not eliminate sanctions screening or 1099 obligations
(those still apply to "money transmitter" + many "facilitator" / "DApp"
+ technology-provider contexts).

**Risk**: even after non-custodial redesign, FinCEN guidance on
DeFi/DApps remains evolving. The 2020 proposed unhosted-wallet rule
shows the direction.

### 8.2 Money-transmitter partnership (Option B — the partnership path)

**Concept**: a licensed entity (e.g., Circle, BVNK, Bridge.xyz,
Conduit Pay, Stripe Issuing, Wyre) acts as the money transmitter. Smart
Agent is positioned as a technology provider to the licensed entity.

**Required changes**:

- Pick a partner. Negotiate a referral / technology-provider agreement.
- Restructure §2.3 / §2.5 such that the partner moves the funds, not
  Smart Agent's substrate.
- Partner does KYC + sanctions + AML; Smart Agent passes through user
  identity (which means we collect identity — see RL5).

**Cost**: 1–3 months integration, $100k–$300k. Partner takes 0.5–2.0%
revenue share. Speeds time to market by 12–24 months.

**Risk**: regulatory framing of "tech provider" is grey — counsel must
ensure the framing holds up. The "Bonifii / Cross River Bank" model has
been broadly accepted for fintech; the crypto equivalent is less
established.

**Candidate partners** (illustrative, not endorsed):

- [Circle](https://www.circle.com/) — USDC issuer with Account & Payments
  APIs; CASP authorization (Bermuda + EU subsidiary).
- [Bridge.xyz](https://bridge.xyz/) (acquired by Stripe Oct 2024) —
  stablecoin orchestration; partners can leverage Stripe's MTL footprint.
- [BVNK](https://bvnk.com/) — stablecoin payments infrastructure; UK FCA
  registered + EU CASP authorization in flight.
- [Conduit Pay](https://www.conduit.financial/) — stablecoin transfer
  rails.
- [Wyre](https://www.sendwyre.com/) — legacy on/off-ramp (status varies
  — verify current operations).
- [MoonPay](https://www.moonpay.com/) — on/off-ramp.
- [Transak](https://transak.com/) — on/off-ramp.

### 8.3 Agent-of-receiver model (Option C — narrow legal carve)

**Concept**: position Smart Agent as the AGENT of the receiving pool /
recipient, not of the sender. Many state regimes (FL, IL, MA, etc.)
exempt "agents of the payee."

**Required changes**:

- Written agency agreement between Smart Agent and each receiving
  pool/org.
- Disclosure to senders: "Smart Agent is acting as agent of the
  receiver."
- Product-design changes so receipt by Smart Agent's contracts is
  constructive receipt by the pool.

**Cost**: $30k–$80k legal documentation.

**Risk**: FinCEN does NOT recognize agent-of-payee. State exemptions
have caveats. Not a federal solution.

### 8.4 Geofencing (Option D — interim until license)

**Concept**: block users from regulated jurisdictions at the application
layer.

**Required changes**:

- IP-geolocation at signup + per-action.
- SDN list screening (OFAC requires this regardless — see RL4).
- ToS prohibition on accessing from blocked jurisdictions.
- Smart-contract-level geographic restrictions (impossible directly, but
  the application layer can refuse to relay).

**Cost**: $5k–$15k implementation; ongoing IP-database SaaS ($1k–$5k/yr
for MaxMind GeoIP2 or IPinfo).

**Risk**: VPN circumvention. Regulators tend to view geofencing
favorably if it's a good-faith effort, but it is not a complete defense
if the firm "should have known" a user was in a restricted jurisdiction.

### 8.5 Closed cohort / testnet only (Option E — current posture)

**Concept**: only run on testnet (Sepolia, Base Sepolia, OP Sepolia)
where no real value moves. Closed cohort of researchers / employees /
specifically-invited users.

**Required changes**: none from current state.

**Cost**: $0 incremental.

**Risk**: not a product launch. Useful as a development posture; not a
go-to-market.

### 8.6 Charitable / 501(c)(3) wrapper (Option F — vertical-specific)

**Concept**: if Smart Agent's primary use case is charitable giving (the
catalyst / hub demo positions it this way), establish a parent 501(c)(3)
that acts as the legal "donor-advised fund" (DAF) operator. Pool pledges
become DAF contributions; disbursements become DAF grants.

**Required changes**:

- Form a 501(c)(3) non-profit.
- Operate Smart Agent platform under non-profit's umbrella.
- DAF compliance: distribution requirements, anti-self-dealing,
  IRS Form 990.
- Smart Agent platform = tech provider to the 501(c)(3).

**Cost**: $30k–$80k legal formation; $80k–$200k/yr ongoing operations.

**Reference**: [Endaoment](https://endaoment.org/) operates a
501(c)(3) DAF wrapper for crypto donations. Smart Agent could either
partner with Endaoment, or replicate the structure.

**Risk**: limits the product to charitable use cases; rules out
commercial use cases (paid services, payroll, p2p).

### 8.7 Bank-charter / SPDI (Option G — long term)

**Concept**: Smart Agent itself obtains a bank charter or Wyoming SPDI.

**Required changes**: substantial — capital requirements, regulatory
exam, board governance, etc.

**Cost**: $5M–$20M over 18–36 months.

**Risk**: outsized for a startup; only relevant at scale.

---

## 9. Recommended counsel engagement

### 9.1 Counsel candidates

Specialist crypto + fintech regulatory practices:

- **DLA Piper Blockchain & Digital Assets** —
  [https://www.dlapiper.com/en-us/insights/topics/blockchain-and-digital-assets](https://www.dlapiper.com/en-us/insights/topics/blockchain-and-digital-assets)
- **Cooley Fintech** —
  [https://www.cooley.com/services/practice/fintech](https://www.cooley.com/services/practice/fintech)
- **Wilson Sonsini Financial Services & Fintech** —
  [https://www.wsgr.com/en/services/practices/financial-services-and-fintech.html](https://www.wsgr.com/en/services/practices/financial-services-and-fintech.html)
- **Anderson Kill** (specialist in crypto + insurance) —
  [https://www.andersonkill.com/Practice/Cryptocurrency](https://www.andersonkill.com/Practice/Cryptocurrency)
- **Steptoe** —
  [https://www.steptoe.com/en/services/practices/blockchain-and-cryptocurrency.html](https://www.steptoe.com/en/services/practices/blockchain-and-cryptocurrency.html)
- **K&L Gates** — see [Howey's Cryptonite](https://www.klgates.com/Howeys-Cryptonite-A-Deep-Dive-on-Digital-Asset-Classification-4-20-2026)
- **Perkins Coie Blockchain Technology & Digital Currency Group**
- **Latham & Watkins Digital Asset Practice**
- **Davis Polk Digital Assets Practice**

Mid-market alternatives (lower cost):

- **Polsinelli** Fintech & Cryptocurrency
- **Brown Rudnick** Digital Commerce Initiative
- **Foley Hoag** Blockchain & Cryptocurrency

Boutique:

- **Anderson P.C.** (NY) — securities + crypto
- **Wong Fleming** — narrow crypto practice
- **CipherLaw Group** — boutique crypto firm

### 9.2 Engagement scope (for RFP)

```
Smart Agent — Money Transmitter / CASP Opinion Engagement

Background:
  Smart Agent is an ERC-4337 smart-account framework with an active
  product feature (Spec 005) that wires USDC transfers between user-
  controlled smart accounts on Ethereum-compatible chains. The product
  is currently in closed-cohort / testnet posture. A go-to-market
  decision requires resolving the money-transmitter / CASP question
  before any meaningful customer rollout.

Requested deliverables:
  (a) Written opinion on whether Smart Agent is a "money transmitter"
      under FinCEN 31 CFR 1010.100(ff)(5) for the activity-surface
      paths inventoried at [doc URL].
  (b) Per-state analysis for [LIST: CA, NY, TX, FL, WY, MT, GA, IL,
      MA, CO, CT, KY, PA, WA] — with bond/cost estimate per state
      where in-scope.
  (c) EU MiCA CASP applicability analysis; recommended NCA for
      establishment if license is required.
  (d) UK FCA crypto regime applicability + timing.
  (e) Recommendation: license, partner, restructure, or geofence —
      with rationale per jurisdiction.
  (f) If restructure: specific product-design changes that would shift
      Smart Agent out of scope.

Materials we provide:
  - Spec 005 plan (money-movement design)
  - Spec 007 plan (architecture hardening — affects custody question)
  - Activity-surface inventory (this doc § 2)
  - Smart contract source (PledgeRegistry, DelegationManager, etc.)
  - SDK source (delegation chain, session-key model)
  - Architecture principles doc (substrate independence)

Engagement model:
  - Fixed fee, $25k–$75k range, 4–6 weeks turnaround
  - Senior partner + 2 associates
  - Privileged + confidential
```

### 9.3 Counsel-engagement timeline

| Week | Activity |
|---|---|
| 0 | Issue RFP to 3 candidate firms |
| 1 | Receive proposals; reference checks |
| 2 | Select firm; engagement letter signed; retainer |
| 3 | Kickoff call; document handover |
| 4–5 | Counsel draft analysis |
| 6 | Counsel deliver draft; engineering review |
| 7 | Counsel finalize; deliver opinion |
| 8+ | Implement counsel recommendations |

---

## 10. Cost model

### 10.1 Counsel + opinion (Phase 1)

| Item | Cost |
|---|---|
| MTL/CASP opinion letter | $25k–$75k |
| Per-state appendix (50 states) | $30k–$80k |
| EU MiCA appendix | $15k–$30k |
| UK FCA appendix | $10k–$20k |
| **Phase 1 total** | **$80k–$205k** |

### 10.2 Licensing path (if pursued, Phase 2)

If counsel concludes MTL/CASP is required:

| Item | Cost |
|---|---|
| FinCEN MSB registration | $0 fee + $30k–$60k AML program build |
| Single state MTL application | $10k–$50k application + $25k–$2M bond |
| 50-state MTL filing (NMLS) | $240k–$475k applications + $500k–$1.5M legal + bonds |
| EU CASP authorization (single NCA) | €150k capital + €100k–€300k legal |
| EU CASP (subsequent passports) | €0 application + admin |
| UK FCA registration | £50k–£200k legal |
| Singapore MPI | SGD 100k–SGD 500k legal + capital |
| **Phase 2 floor (single state US)** | **$80k–$300k** |
| **Phase 2 ceiling (50-state US + EU + UK + SG)** | **$3M–$8M** |

Plus ongoing:

| Item | Annual cost |
|---|---|
| 50-state US bond maintenance | $50k–$200k (premium @ 1.5–5% of bond) |
| 50-state US exam + filing fees | $100k–$200k |
| EU CASP supervision fees | €50k–€200k |
| FinCEN annual program | $50k–$150k staff |
| Compliance officer (BSA Officer) | $150k–$300k salary |
| **Ongoing floor** | **$400k–$1M/yr** |

### 10.3 Partner path (Option B, Phase 2)

| Item | Cost |
|---|---|
| Partner selection + negotiation | $30k–$80k legal |
| Integration engineering | $100k–$300k |
| Partner revenue share | 0.5%–2.0% of moved value |
| Partner KYC pass-through | $1–$5 per verification |

Materially cheaper than licensing path; faster time to market; less
control.

### 10.4 Non-custodial path (Option A, Phase 2)

| Item | Cost |
|---|---|
| Spec 007 + 008 engineering | $300k–$600k |
| Counsel re-opinion post-redesign | $15k–$40k |
| Externalized bundler/paymaster integration | $50k–$150k |
| **Total** | **$365k–$790k** |

Then steady-state is lower because compliance burden is reduced — but
NOT zero (sanctions, 1099, TOS, etc. still apply).

---

## 11. Recommendation + go/no-go gate

### 11.1 Engineering recommendation

**DO NOT** launch Smart Agent to public production users outside of
closed-cohort testnet without a counsel-issued opinion on MTL
applicability and a documented mitigation plan.

**DO** proceed with Spec 007 (architecture hardening) — it improves the
non-custodial argument significantly and is on the critical path
regardless of which counsel-recommendation lands.

**DO** keep Spec 005 in MockUSDC-only mode in dev; do NOT wire real
USDC to mainnet until Phase 1 counsel is complete.

**DO** plan the closed-cohort pilot in a low-risk jurisdiction:

- Geographic scope: Wyoming + Montana (US) + Cayman Islands (test
  jurisdiction) — verify with counsel.
- User scope: invitee-only; ≤100 users for Phase 0 pilot.
- Volume scope: ≤$10k per user per month; ≤$100k aggregate.
- Mandatory: OFAC screening (RL4), basic KYC at $1k+ (RL5).

### 11.2 Go/no-go gate (explicit)

The following MUST be true before §2.3 / §2.5 / §2.6 production
deployment:

- [ ] Phase 1 counsel opinion delivered, dated, signed.
- [ ] Counsel's recommendation implemented (license / partner /
      restructure / geofence).
- [ ] Spec 007 Phase A merged and on production network.
- [ ] OFAC screening in production action layer; CI gate proves it.
- [ ] KYC vendor integrated; tier-0 / tier-1 / tier-2 / tier-3 (RL5).
- [ ] TOS / Privacy / AUP / Cookie / Dispute policy live + click-
      through (RL6).
- [ ] Cyber + E&O insurance bound (RL7).
- [ ] BSA / AML officer designated (if MTL or partner path) or
      DPO designated (if EU residents).
- [ ] 1099 / DAC8 readiness — TIN collection live (RL3).

### 11.3 Failure-mode posture

If Phase 1 counsel says "yes you are a money transmitter, no easy way
out":

- Pause public launch indefinitely.
- Pivot to Option A (non-custodial redesign) OR Option B (partner) OR
  Option F (charitable wrapper).
- Re-engage counsel after each pivot; Phase 1A opinion on revised model.

If counsel says "yes BUT here's a path" (most likely outcome):

- Execute the path.
- Phased rollout (single jurisdiction first; expand).
- Re-open this document quarterly.

If counsel says "no, you are not a money transmitter":

- This is the best case but is the LEAST LIKELY outcome given the
  current architecture.
- Still maintain OFAC + KYC + TOS + insurance as baseline.

---

## 12. Marketing posture

The framing of the product affects the regulatory analysis. Some
phrasings make the MTL case worse:

| Avoid | Why |
|---|---|
| "Send money instantly" | Direct money-transmitter framing |
| "Donate" / "give" with $-symbol | Money-movement primacy |
| "Cash out your pledge" | Cashout = transmission |
| "Wallet for your charity" | Wallet → custody |
| "Stablecoin payments made easy" | Payment processor framing |
| "We move money for you" | Direct admission |
| "Treasury" (without qualification) | DAO-treasury SEC scrutiny |
| "Pool" (without qualification) | Investment-pool framing |
| "Investment opportunity" | Howey |
| "Returns" / "yield" | Howey |

Prefer:

| Use | Why |
|---|---|
| "Smart accounts for agents" | Tooling framing |
| "Programmable delegation" | Substrate framing |
| "Coordinate commitments" | Commitment ≠ payment |
| "Pledge tracking" | Bookkeeping framing |
| "Honor your pledge" (as user verb) | User action, not platform action |
| "Self-custody" / "non-custodial" (POST-007 ONLY) | Custody disclaimer |
| "Identity infrastructure" | Identity, not money |
| "Trust graph" | Graph, not money |

Until counsel signs off:

- No claims that Smart Agent IS or IS NOT a money transmitter.
- No claims about being "compliant."
- No claims about being "regulated" or "unregulated."
- No comparisons to specific licensed entities ("like Stripe but for
  X") — invites the question "and you have Stripe's licenses?"
- All product copy reviewed by Security agent + Legal-ops agent.

---

## 13. Bibliography

### Statutes & regulations

- **31 CFR 1010.100** — FinCEN general definitions, including (ff) MSB:
  [eCFR](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-A/section-1010.100),
  [LII](https://www.law.cornell.edu/cfr/text/31/1010.100)
- **31 CFR 1010.380** — registration of MSBs
- **31 CFR 1022.210–212** — AML program requirements for MSBs
- **California Financial Code Division 1.25** (Digital Financial Assets
  Law) — see [DFPI](https://dfpi.ca.gov/regulated-industries/digital-financial-assets/)
- **23 NYCRR Part 200** — NY DFS BitLicense regulation
- **23 NYCRR Part 500** — NY DFS cybersecurity (applies to BitLicensees)
- **Texas Finance Code Chapter 152** — Money Services Act; Supervisory
  Memorandum 1037: [PDF](https://www.dob.texas.gov/public/uploads/files/consumer-information/sm1037.pdf)
- **Florida Money Services Businesses Act** — F.S. Chapter 560
- **Regulation (EU) 2023/1114** — MiCA: [ESMA](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica)
- **UK Financial Services and Markets Act 2000 (Cryptoassets) Regulations 2026** — [FCA](https://www.fca.org.uk/firms/new-regime-cryptoasset-regulation)
- **Singapore Payment Services Act 2019** — [MAS](https://www.mas.gov.sg/regulation/acts/payment-services-act)

### FinCEN guidance

- **FIN-2013-G001** (initial CVC guidance, March 2013)
- **FIN-2019-G001** (CVC business-model guidance, May 2019):
  [PDF](https://www.fincen.gov/system/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf)
- **FIN-2014-R001** (gambling administrative ruling, January 2014):
  [PDF](https://www.fincen.gov/system/files/shared/FIN-2014-R001.pdf)
- **FinCEN MSB Definition** page: [link](https://www.fincen.gov/money-services-business-definition)
- **FinCEN MSB Registration** page: [link](https://www.fincen.gov/resources/money-services-business-msb-registration)

### Practitioner analyses

- **Katten Muchin Rosenman — FinCEN CVC Guidance summary**:
  [link](https://katten.com/fincen-publishes-guidance-pertaining-to-certain-business-models-involving-convertible-virtual-currencies)
- **Womble Bond Dickinson — California DFAL alert**:
  [link](https://www.womblebonddickinson.com/us/insights/alerts/californias-new-digital-financial-assets-law-requires-application-cryptocurrency)
- **Brico — MTL Costs**:
  [link](https://www.brico.ai/post/how-much-do-mtls-cost)
- **Ridgeway Financial Services — MTL State Reqs**:
  [link](https://www.ridgewayfs.com/money-transmitter-license-requirements-by-state/)
- **Dechert — MiCA Part 2**:
  [link](https://www.dechert.com/knowledge/onpoint/2025/1/application-of-second-part-of-mica---regulation-of-casps-and-oth.html)
- **InnReg — BitLicense Overview**:
  [link](https://www.innreg.com/blog/bitlicense-new-york)
- **Steptoe — Texas Stablecoin Guidance**:
  [link](https://www.steptoe.com/en/news-publications/blockchain-blog/a-regulatory-fork-for-stablecoins-is-new-texas-guidance-a-sign-of-things-to-come.html)

### Related internal documents

- [`README.md`](./README.md) — counsel engagement plan
- [`RL2-securities-analysis.md`](./RL2-securities-analysis.md) — securities
- [`RL3-tax-reporting-1099-and-international.md`](./RL3-tax-reporting-1099-and-international.md) — tax
- [`RL4-ofac-sanctions-screening.md`](./RL4-ofac-sanctions-screening.md) — sanctions
- [`RL5-kyc-aml-high-risk-flows.md`](./RL5-kyc-aml-high-risk-flows.md) — KYC
- [`RL6-tos-privacy-acceptable-use.md`](./RL6-tos-privacy-acceptable-use.md) — TOS
- [`RL7-liability-framework.md`](./RL7-liability-framework.md) — insurance
- `specs/005-pledge-honor/plan.md` — money-movement design
- `specs/007-architecture-hardening/plan.md` — Phase A removes master co-ownership
- `docs/architecture/principles.md` — substrate independence (P1)
