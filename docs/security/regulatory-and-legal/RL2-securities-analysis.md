# RL2 — Securities Law Analysis

> **NOT LEGAL ADVICE.** This document scopes the securities question for
> counsel. Engineering hypotheses are tentative.
>
> Cross-ref: [RL1 Money Transmitter](./RL1-money-transmitter-license-analysis.md)
> for the overlapping fund-movement analysis.

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [The Howey test in 2026](#2-the-howey-test-in-2026)
3. [Per-construct analysis](#3-per-construct-analysis)
4. [Specific risk areas](#4-specific-risk-areas)
5. [The future-token question](#5-the-future-token-question)
6. [SEC + CFTC March 2026 interpretive release](#6-sec--cftc-march-2026-interpretive-release)
7. [Specific recommendations + terminology fixes](#7-specific-recommendations--terminology-fixes)
8. [International securities regimes](#8-international-securities-regimes)
9. [Counsel engagement](#9-counsel-engagement)
10. [Cost model](#10-cost-model)
11. [Bibliography](#11-bibliography)

---

## 1. Executive summary

Smart Agent's current product surface is unlikely to trigger US
securities regulation, *under the SEC + CFTC joint interpretive release
issued March 17, 2026* and *if the marketing posture stays away from
investment-pool framing*. The strongest argument: pledges + pool
contributions are framed as charitable / civic commitments with no
expectation of profit; AnonCreds credentials are eligibility tokens with
no economic right; governance over pool spending is intra-organizational
governance, not an investment-contract relationship.

**However**, several constructs sit close to the line:

- **"Pool"** as a term is dangerous. Investment pools are securities.
- **"Treasury"** as a term has been scrutinized by the SEC in DAO
  contexts (the LBRY enforcement, the Wells notices against multiple
  DAOs in 2024–2025).
- **Stewardship** (pool stewards' discretion over disbursement) creates
  the "managerial efforts of others" prong of Howey if pledgers expect
  to benefit financially.
- **Any future token** — a SmartAgent governance token, a points system,
  a rewards program — flips the analysis dramatically.

Counsel should issue a short memo confirming:

1. Current pool / treasury / pledge / proposal constructs are not
   securities (with rationale).
2. The marketing language to avoid (RL2 § 7).
3. What product changes would trigger re-analysis.
4. The future-token boundary.

Cost: $15k–$30k for the memo. Re-engage if/when a token is contemplated.

---

## 2. The Howey test in 2026

The investment-contract test from *SEC v. W.J. Howey Co.*, 328 U.S. 293
(1946), defines a "security" as a transaction involving:

1. **An investment of money** (or other value).
2. **In a common enterprise.**
3. **With a reasonable expectation of profits.**
4. **Derived from the managerial efforts of others.**

All four prongs must be satisfied.

### 2.1 The 2026 joint SEC + CFTC interpretation

On March 17, 2026, SEC + CFTC issued a joint interpretive release
([Federal Register](https://www.federalregister.gov/documents/2026/03/23/2026-05635/application-of-the-federal-securities-laws-to-certain-types-of-crypto-assets-and-certain),
[K&L Gates analysis](https://www.klgates.com/Howeys-Cryptonite-A-Deep-Dive-on-Digital-Asset-Classification-4-20-2026))
that:

- Establishes a "securities taxonomy" for crypto-assets.
- **Confirms governance tokens are NOT securities** by virtue of carrying
  governance rights alone. "The existence of governance features does
  not transform a digital commodity into a security." This is a
  significant shift from the prior SEC posture (e.g., the *Telegram* and
  *LBRY* cases).
- Supersedes the SEC Staff's 2019 Framework for "Investment Contract"
  Analysis of Digital Assets.
- Applies the four Howey prongs but with refined criteria.

The release is a major liberalization vs. 2018–2024. But it does NOT
mean "crypto is never a security." The release reaffirms that tokens
sold with investment-of-money + common-enterprise + expectation-of-
profits + managerial-efforts still ARE securities.

### 2.2 Where Smart Agent sits

| Prong | Smart Agent posture | Assessment |
|---|---|---|
| 1. Investment of money | Pledgers pay USDC into a pool's AgentAccount | YES (USDC is "money" or "other value") |
| 2. Common enterprise | Pool pools resources for shared purpose | **Probably yes** if pledgers expect benefit |
| 3. Expectation of profits | Charitable / civic; donor does NOT expect return | **PROBABLY NO** in current framing |
| 4. Managerial efforts of others | Pool stewards / round operators manage | YES if (3) is YES |

Smart Agent is rescued by prong 3. Donors do not expect a financial
return from contributing to a hub's catalyst pool. They expect the pool
to disburse to good causes (recipient orgs), which they may benefit
from indirectly (civic / spiritual / community), but the indirect
benefit is not "profits" in the Howey sense.

This works **only if the product stays charitable / civic in framing**.
The moment Smart Agent is positioned as an investment vehicle, or the
pool starts generating yield, or pledgers expect their money back with
return, prong 3 flips and prong 4 immediately follows.

---

## 3. Per-construct analysis

### 3.1 Pool pledges (PoolPledge / Spec 002 / PledgeRegistry)

**Construct**: a user commits USDC to a pool's AgentAccount, with a
cadence (one-time, monthly, annual), unit, amount, and optional
restriction/story-permissions metadata.

**Howey analysis**:

- (1) Investment of money: YES.
- (2) Common enterprise: borderline. The pool pools resources from
  multiple pledgers. *Horizontal commonality* (pledgers' fortunes are
  tied together via the pool) is plausibly present. *Vertical
  commonality* (pledgers' fortunes are tied to the pool steward's
  efforts) is also plausible.
- (3) Expectation of profits: NO in current framing. Pledgers donate;
  they expect no money back.
- (4) Managerial efforts: YES — the pool steward (and the proposal
  voting members) decide where the money goes.

**Conclusion**: NOT a security, BECAUSE prong 3 fails. But this is the
fragile prong. Marketing copy that promises "you'll see how your
contribution grows" or "the pool's returns" would flip it.

**Anti-investment framing to maintain**:

- Pledges are commitments to a cause, not investments.
- No yield is generated on pooled USDC (the USDC sits idle until
  disbursed; no staking, no lending, no yield-farming).
- No share of pool returns to pledgers.
- Pledgers do not receive any token, share, or financial claim in
  exchange.
- Disbursements go to recipient orgs (proposals), NOT back to pledgers.

### 3.2 Treasury (org-AgentAccount as treasury / Spec 005 Personal Treasury)

**Construct**: an organization's smart account holds USDC. The
organization (or its members via governance) decides spending. Same for
"personal treasury" (Spec 005) — the donor's smart account holds USDC
before honoring pledges.

**Howey analysis**:

- (1) Investment of money: arguably YES if outsiders fund the treasury.
  NO if the treasury is funded only by the org's own members and used
  only for the org's own purposes.
- (2) Common enterprise: borderline. An org's treasury is for the org's
  members; the org IS the enterprise.
- (3) Expectation of profits: NO — treasury funds are spent on org
  operations / grants, not returned to depositors.
- (4) Managerial efforts: depends on governance model.

**Conclusion**: NOT a security in the current charitable / civic
framing. Personal treasury (single-user) clearly NOT — it's the user's
own smart-account wallet.

**SEC DAO-treasury enforcement context**:

The SEC pursued several DAO matters in 2023–2025 (Mango Markets DAO,
Friends With Benefits DAO, etc.), some of which centered on the DAO
TREASURY as a pooled investment vehicle. The 2026 interpretive release
liberalizes the governance-token side but does NOT immunize all DAO
treasuries. If a treasury is funded by sale of a token that confers
governance + economic rights, the token AND the treasury could both be
in scope.

Smart Agent's treasuries are funded by pledges (charitable) or by the
user themselves (personal). Neither involves a token sale. So the
DAO-treasury enforcement risk is low. But terminology matters — see § 7.

### 3.3 Grant proposals (GrantProposal / Spec 003 / GrantProposalRegistry)

**Construct**: a member submits a proposal to receive a grant from a
pool; members vote; the pool steward disburses to the winning proposal.

**Howey analysis**:

- (1) Investment of money by the recipient: NO — they receive money.
- (3) Expectation of profits by the recipient: NO — they receive a
  grant, which is a transfer for stated purpose, not an investment
  return.

**Conclusion**: NOT a security. Recipients are GRANTEES, not investors.

**Tax implication**: see RL3 — grants > $600 may trigger 1099-MISC /
1099-NEC.

### 3.4 AnonCreds credentials (Spec 004)

**Construct**: an issuer (pool steward, round operator) issues an
AnonCreds credential to a holder; the holder presents it
zero-knowledge-style to gain authorization to vote / submit / pledge.

**Howey analysis**:

- (1) Investment of money: NO — credentials are issued, not sold.
- (3) Expectation of profits: NO — credentials confer eligibility, not
  economic right.

**Conclusion**: NOT a security. AnonCreds are access credentials, akin
to a country-club membership card or a software license. They carry no
financial claim.

**Caveat**: if credentials were ever sold for cash (a "pay $10 to vote"
model), the analysis flips. Don't do that.

### 3.5 Match initiations (Spec 001)

**Construct**: a discovery-lane match between two intents (e.g., a
seeker and a provider). No money moves at match.

**Howey analysis**: trivially NOT a security — no money element.

### 3.6 Reviews + reputation (AgentReviewRecord / AgentTrustProfile)

**Construct**: members rate other agents; a trust signal is derived.

**Howey analysis**: trivially NOT a security. Reputation is not money.

### 3.7 Composite ranking output

**Construct**: a Laplace-smoothed score over (hops, fulfilled,
abandoned) used in matchmaker.

**Howey analysis**: NOT a security. It's a search-ranking signal.

---

## 4. Specific risk areas

### 4.1 "Pool" terminology

Investment pools are securities. Smart Agent calls its primary catalyst
construct a "pool." This is dangerous BRANDING even though it's not
dangerous SUBSTANCE.

**Cases**:

- *SEC v. Mango Markets* — Avraham Eisenberg case treated certain
  positions on the Mango DAO as commodity pool-style.
- *In re Stoner Cats* — NFT-as-security case where "common enterprise"
  framing centered on shared upside.
- *SEC v. LBRY* — software platform with token treated as a security.

**Mitigation**: use "pool" carefully, always paired with "catalyst /
charitable / community / giving" qualifier, or rename.

**Renaming candidates**:

- "Catalyst" (already used; widen its scope to replace "pool")
- "Fund" (used in `FundRegistry`; carries its own securities baggage —
  "investment fund" is a term of art)
- "Co-op" or "Cooperative" (carries cooperative-law overhead but is
  charitable-coded)
- "Circle" (already used elsewhere; memory says "Oikos not circles")
- "Commons" (community-coded)
- "Drive" (as in "fundraising drive" / "donation drive")
- "Campaign"
- "Round" (already used for grant rounds — could expand)

Recommendation: keep "pool" in technical contracts (`PledgeRegistry`,
`Pool` ontology class) but in user-facing copy lean toward "catalyst,"
"fund drive," or "community giving pool." Always add a charitable
qualifier.

### 4.2 "Treasury" terminology

Same issue. DAO treasuries have had SEC scrutiny.

**Mitigation**:

- For the personal treasury (Spec 005): rename to "personal funding
  account" or "personal smart account" in user-facing copy.
- For org / pool treasuries: rename to "pool funds" or "org operating
  funds."
- Keep "treasury" in internal docs / contracts where it's a term of
  art.

### 4.3 "Stewardship" + voting

The voting model is fine (governance ≠ security per the 2026
interpretive release). But the language of "you vote on what to do with
the pool's money" gets close to "shareholder vote on dividends," which
is securities-coded.

**Mitigation**:

- Frame votes as "community choice for grant recipients," not
  "shareholder votes."
- No language like "your stake in the pool."

### 4.4 Restriction-tagged pledges

A donor pledge can include `restrictions` (e.g., "only for youth
programs"). This is a CONDITIONAL gift, not an investment. Charitable
law allows restricted gifts.

**Mitigation**: none needed; this is fine. Just don't let the
restrictions be expressed as expected returns.

### 4.5 Story permissions

Pledges have `storyPermissions` (public / shareWithSupportTeam /
anonymous). Privacy-coded, not securities-coded.

### 4.6 Honor + mark-paid

Settlement events. Not securities-coded.

### 4.7 Mock USDC

In dev only. Never on public networks. Not securities-coded as it never
trades.

### 4.8 The "fund" class (`sa:Fund subClassOf sa:Pool`)

Per the ontology audit, `sa:Fund` is a subclass of `sa:Pool` which is a
subclass of `sa:OrganizationAgent`. The English word "fund" carries
investment connotations — "mutual fund," "hedge fund," "fund of funds."

**Mitigation**: in user-facing copy, use "fund drive" (campaign-coded),
"community fund" (charitable-coded), or "grant fund" (grant-coded).
Never "investment fund," "growth fund," or any term that implies return.

---

## 5. The future-token question

A SmartAgent-platform token would significantly change the analysis.

### 5.1 Reasons we don't have a token today

- Spec 005 + Spec 007 do not introduce a token.
- USDC is used for value transfer (not a "Smart Agent token").
- AnonCreds are non-economic (§3.4).
- The architecture works without a token.

### 5.2 Reasons engineering might propose a token

- Decentralized governance over `AgentImplementationOwner` upgrades.
- Token-based access to premium features.
- Token-based bundler/paymaster fee structure.
- Token rewards for graph-trust contributions.
- Token-as-membership for hubs.
- Tokenized equity for funded recipients.

### 5.3 Token Howey analysis

A future Smart Agent token would likely satisfy prongs 1, 2, and 4. The
question is whether buyers have an expectation of profits.

**Likely outcomes by sub-design**:

| Token design | Likely securities status |
|---|---|
| Pure governance (no economic) | Probably NOT (per 2026 interpretation) |
| Governance + treasury share | Probably YES |
| Reward token earned by usage | Possibly NOT if non-transferable |
| Reward token tradeable on DEX | Probably YES |
| Stablecoin issued by Smart Agent | YES + RL1 regulated stablecoin |
| NFT for hub membership | Maybe NOT (Stoner Cats said maybe yes) |
| Token sale (ICO) | YES — almost always |
| Pre-mine with VC allocation | YES |

### 5.4 Hard rule

**NO token, points system, rewards program, or stake should be designed
or implemented without a fresh securities opinion.** Re-engage counsel.
Budget $25k–$60k for a token-specific opinion.

### 5.5 SAFT / Reg D / Reg S framings

If a token IS pursued:

- **SAFT** (Simple Agreement for Future Tokens) — used to sell
  pre-launch token rights to accredited investors under Reg D.
- **Reg D 506(b) / 506(c)** — exemption for sales to accredited
  investors (with restrictions).
- **Reg S** — exemption for offshore offerings.
- **Reg A+** — small public offering ($75M/yr cap).
- **Reg CF** — crowdfunding ($5M/yr cap).

Each has its own filing, disclosure, and lockup obligations. Counsel
must structure.

---

## 6. SEC + CFTC March 2026 interpretive release

### 6.1 What the release does

- Establishes a securities taxonomy for crypto-assets.
- Defines four categories: "digital commodities," "digital
  securities," "stablecoins," and "investment contracts."
- Confirms governance rights alone don't make a token a security.
- Provides a framework for how each agency (SEC vs. CFTC) takes
  jurisdiction.
- Supersedes the 2019 SEC Staff Framework.

### 6.2 Implications for Smart Agent

- **AnonCreds credentials**: clearly non-securities under the new
  framework. Confirmed.
- **A future governance token**: explicitly safer than under prior
  framework — but the carve-out is narrow. Token must NOT confer
  economic right (treasury share, fee distribution, yield).
- **Stablecoins**: stablecoin issuers are explicitly covered. We don't
  issue stablecoin; we use USDC. Circle (USDC's issuer) bears that
  regulatory burden, not us.
- **Investment contracts**: pool pledges in current framing don't meet
  the test. Confirmed.

### 6.3 What's not changed by the release

- State-level securities laws (blue sky laws) — still apply.
- State-level money transmission laws — see RL1.
- AML / sanctions — see RL4 / RL5.
- Tax — see RL3.
- The investment-contract analysis when there IS an expectation of
  profits — still applies.

---

## 7. Specific recommendations + terminology fixes

### 7.1 Marketing copy review

| Term | Risk | Recommendation |
|---|---|---|
| "Pool" | medium | OK in technical; add charitable qualifier in user copy |
| "Treasury" | medium | "Funding account" or "operating funds" in user copy |
| "Fund" | medium | "Fund drive" or "grant fund" in user copy |
| "Stake" | high | NEVER USE |
| "Yield" | high | NEVER USE |
| "Return" | high | NEVER USE in financial sense |
| "Invest" | high | NEVER USE |
| "Earn" | high | Avoid — implies financial return |
| "Tokenholder" | high | NEVER USE |
| "Distribution" | medium | OK for "grant distribution," not "yield distribution" |
| "Allocation" | low | OK in proposal-allocation context |
| "Vote" | low | OK |
| "Govern" | low | OK |
| "Pledge" | low | Charitable-coded — OK |
| "Donate" / "give" | low | Charitable-coded — OK |
| "Grant" | low | Charitable-coded — OK |
| "Catalyst" | low | OK |
| "Steward" | low | OK |

### 7.2 Product copy templates

Bad:

> "Stake your USDC in the Catalyst Pool and earn a share of the
> community's growth."

Good:

> "Pledge to the Catalyst Pool to commit charitable support; your
> pledge is honored when you transfer the funds to the pool."

Bad:

> "Treasury holders vote on yield distribution every month."

Good:

> "Pool members vote on grant recipients each round."

Bad:

> "Earn governance tokens by completing trust-graph interactions."

Good:

> "Build your reputation in the trust graph through verified
> interactions."

### 7.3 Smart contract naming (internal)

Keep the technical names — `PledgeRegistry`, `Pool`, `Fund`, etc. — in
the contract layer; counsel will review. The contract names are not the
risk; the user-facing copy is.

### 7.4 Ontology naming

The `sa:Pool subClassOf sa:OrganizationAgent` typing is fine; it's
ontology, not consumer copy. Same for `sa:PledgeAssertion`,
`sa:PoolPledge`, etc.

### 7.5 Disclaimers in TOS

The TOS (see RL6) should include securities disclaimers:

- "Smart Agent is not an investment platform."
- "No representation is made about the financial value of any
  contribution."
- "Smart Agent does not facilitate the sale of securities."
- "Pledges are charitable / civic commitments, not investments."
- "AnonCreds credentials are eligibility credentials and carry no
  economic right."

### 7.6 In-product disclaimers

Each pledge / honor flow should include a one-line disclaimer:

> "This is a charitable commitment, not an investment. No financial
> return is offered or implied."

Each pool / fund creation flow should include:

> "This pool is for charitable / civic purposes. Smart Agent is not an
> investment platform."

---

## 8. International securities regimes

### 8.1 EU — MiFID II + MiCA + Prospectus Regulation

- **MiFID II**: financial instruments. Securities-equivalent. Mostly
  doesn't apply unless we issue something tokenized.
- **MiCA**: covered in RL1. The "crypto-assets" framework explicitly
  EXCLUDES financial instruments (which fall under MiFID II); MiCA
  covers the rest.
- **Prospectus Regulation** (EU) 2017/1129: if Smart Agent ever issues a
  security in the EU, a prospectus is required unless an exemption
  applies.

### 8.2 UK — FSMA + Cryptoasset regime

The UK's evolving regime (see RL1) covers "specified investment
cryptoassets" + "qualifying cryptoassets." If Smart Agent issued
anything fitting these classes, FCA authorization is required.

### 8.3 Singapore — Securities and Futures Act (SFA)

MAS regulates digital tokens as "capital markets products" if they have
investment-contract characteristics. The MAS Guide to Digital Token
Offerings is the operative document.

### 8.4 Switzerland — FINMA token classification

FINMA classifies tokens as payment, utility, or asset tokens. Asset
tokens are securities; payment tokens are AML-only; utility tokens are
generally OK.

### 8.5 Japan — JFSA

JFSA categorizes tokens under the Payment Services Act (crypto assets)
or the Financial Instruments and Exchange Act (Type I security tokens).

### 8.6 Implication

International securities regimes are not in immediate scope (no token),
but become major when one is added. The opinion letter scope should
include a paragraph on international securities posture if international
launch is planned.

---

## 9. Counsel engagement

### 9.1 Engagement scope (for RFP)

```
Smart Agent — Securities Posture Memo

Background:
  Smart Agent is an ERC-4337 smart-account framework with charitable /
  civic-coded constructs (pools, pledges, grant proposals, AnonCreds
  credentials). No platform token. Money movement uses USDC.

Requested deliverables:
  (a) Short memo (10–20 pages) confirming or refuting:
      - Pool pledges are not securities under Howey (charitable framing).
      - Pool / treasury constructs are not securities.
      - AnonCreds credentials are not securities.
      - Grant proposals + grant disbursements are not securities.
  (b) Specific marketing-copy DO/DON'T list to maintain non-security
      framing.
  (c) Identification of any product changes (current or planned)
      that would trigger a re-analysis.
  (d) Brief note on international securities regimes (EU, UK, SG, JP,
      CH) — sufficient for high-level posture, not full opinion.

Materials we provide:
  - Spec 002 / 003 / 005 plans
  - This document (RL2)
  - RL1 (MTL analysis — overlap)
  - Marketing copy samples
  - Ontology classifications

Engagement model:
  - Fixed fee, $15k–$30k
  - Senior associate + partner review
  - 3–5 week turnaround
  - Privileged + confidential
```

### 9.2 Counsel candidates

(Subset of RL1's list; securities-strong practices.)

- **Cooley LLP** Securities Practice
- **Wilson Sonsini** Securities Practice
- **Davis Polk** Digital Assets Practice
- **Latham & Watkins** Digital Asset Practice
- **K&L Gates** — strong crypto-securities expertise; authors of the
  "Howey's Cryptonite" analysis
- **Perkins Coie** Blockchain Technology & Digital Currency Group

### 9.3 Re-engagement triggers

Re-open this analysis when:

- A token / points / rewards system is contemplated.
- The product introduces yield-bearing pool USDC.
- Pool funds are deployed into DeFi protocols (lending, AMM, etc.).
- The product introduces tokenized real-world assets.
- The product introduces tokenized membership.
- An international launch is contemplated.
- A new SEC / CFTC chair changes the interpretive posture.

---

## 10. Cost model

| Phase | Item | Cost |
|---|---|---|
| Phase 1 | Posture memo from counsel | $15k–$30k |
| Phase 1 | Marketing-copy review | $5k–$10k |
| Phase 2 | International posture appendix | $10k–$25k |
| Phase 2 | Token-design opinion (if/when) | $25k–$60k |
| Phase 2 | SAFT structuring (if/when) | $50k–$150k |
| Ongoing | Quarterly re-check with counsel | $10k–$30k/yr |

Steady-state floor: $10k–$30k/yr until a token is contemplated.

---

## 11. Bibliography

### Statutes & regulations

- **Securities Act of 1933** — primary US securities law
- **Securities Exchange Act of 1934** — secondary market regulation
- **15 U.S.C. § 77b(a)(1)** — definition of "security"
- **Regulation D** — exemption for accredited investor sales
- **Regulation S** — offshore exemption
- **Regulation A+** — small public offering
- **Regulation Crowdfunding (CF)** — crowdfunding exemption
- **Prospectus Regulation (EU) 2017/1129** — EU prospectus requirements

### Cases

- **SEC v. W.J. Howey Co.**, 328 U.S. 293 (1946) — investment-contract
  test
- **SEC v. Edwards**, 540 U.S. 389 (2004) — fixed-return investment
  contracts
- **SEC v. Telegram Group Inc.**, No. 19-cv-9439 (S.D.N.Y. 2020)
- **SEC v. LBRY, Inc.**, No. 21-cv-260 (D.N.H. 2022)
- **SEC v. Ripple Labs** (S.D.N.Y. 2023, partial summary judgment)
- **SEC v. Coinbase**, No. 23-cv-4738 (S.D.N.Y. 2023)
- **In re Stoner Cats** (NFT-as-security SEC enforcement, 2023)

### Releases & guidance

- **SEC + CFTC Joint Interpretive Release** (March 17, 2026):
  [Federal Register](https://www.federalregister.gov/documents/2026/03/23/2026-05635/application-of-the-federal-securities-laws-to-certain-types-of-crypto-assets-and-certain)
- **SEC Staff Framework for Investment Contract Analysis of Digital
  Assets** (April 2019) — superseded by 2026 release:
  [PDF](https://www.sec.gov/files/dlt-framework.pdf)
- **The DAO Report**, SEC Investigative Report, July 2017

### Practitioner analyses

- **K&L Gates — Howey's Cryptonite** (April 2026):
  [link](https://www.klgates.com/Howeys-Cryptonite-A-Deep-Dive-on-Digital-Asset-Classification-4-20-2026)
- **National Law Review — Securities Taxonomy Deep Dive**:
  [link](https://natlawreview.com/article/howeys-cryptonite-deep-dive-digital-asset-classification)
- **Chapman — SEC + CFTC Clarification**:
  [link](https://www.chapman.com/publication-sec-and-cftc-clarify-crypto-asset-taxonomy-and-the-application-of-federal-securities-laws)
- **Cryptonomist — SEC + CFTC interpretation**:
  [link](https://en.cryptonomist.ch/2026/03/18/crypto-asset-regulation-us-framework/)

### Related internal documents

- [`README.md`](./README.md)
- [`RL1-money-transmitter-license-analysis.md`](./RL1-money-transmitter-license-analysis.md) — overlapping fund-movement analysis
- [`RL6-tos-privacy-acceptable-use.md`](./RL6-tos-privacy-acceptable-use.md) — TOS disclaimers
- `specs/002-intent-marketplace-pool/plan.md`
- `specs/003-intent-marketplace-proposal/plan.md`
- `specs/005-pledge-honor/plan.md`
- `docs/ontology/INTENT_MARKETPLACE_AUDIT.md`
