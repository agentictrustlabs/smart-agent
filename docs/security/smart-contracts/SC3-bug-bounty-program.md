# SC3 — Bug Bounty Program

> **Status**: Draft. Activation deferred until SC1 (external audit) is
> complete and SC8 (testnet rehearsal) is in progress.
> **Audience**: security lead (owner), engineering manager (sponsor),
> board sub-committee (approves payout ceiling).
> **Document type**: Procurement plan (vendor selection) + operational
> plan (triage, SLA, payout policy).
> **Pairs with**: SC1 (a bounty programme launched before audit findings
> are public wastes researcher time on known issues).

---

## 1. Why bug bounty

Audits are point-in-time; bug bounties are continuous. A top-tier
audit finds ~80% of critical issues in scope at code-freeze. The
remaining 20% — and any new issues introduced by post-audit changes,
unexpected interactions, or auditor blind spots — surface through:

- Researcher curiosity post-launch (the bug-bounty researcher pool).
- Adversarial discovery (we want to pay researchers, not attackers).
- Coverage of categories audits historically under-find (subtle MEV,
  cross-protocol interactions, economic-incentive bugs).

For a system that holds user funds (smart-account balances, treasury
custody, paymaster deposit, pledged USDC) and authority (delegation
chains), running a bug bounty is table stakes once production volume
exists. The question is **when** and **at what bounty tier**.

[DECISION] We **DO** run a bug bounty. Programme activates after the
SC1 final report + remediation are public.

[DECISION] **Vendor: ImmuneFi** (primary), with HackerOne as a
secondary option if ImmuneFi terms become unfavourable.

---

## 2. Vendor options

### 2.1 ImmuneFi

- **What**: largest web3-focused bug bounty platform. Specialised in
  smart contract / DeFi / wallet bounties.
- **URL**: https://immunefi.com/.
- **Fee model**: typically 10% commission on bounty paid out (verify
  current rate at engagement time).
- **Strengths**: web3-native researcher community (~30k vetted
  researchers as of 2026); track record (largest publicly-known
  payouts in the space — Wormhole, Polygon, Aurora); legal /
  safe-harbor templating standard in the industry.
- **Weaknesses**: ImmuneFi adjudication can be slow on contested
  severities; project-side moderation burden non-trivial.
- **Verdict**: [DECISION] **primary choice**.

### 2.2 HackerOne

- **What**: general-purpose bug bounty platform (largest in the
  world). Less web3-specialised but has expanded coverage.
- **URL**: https://www.hackerone.com/.
- **Fee model**: subscription + commission (varies by tier).
- **Strengths**: massive researcher base (1M+); enterprise-grade
  triage tooling.
- **Weaknesses**: smart-contract expertise dilution; researcher
  population more web2-focused; less idiomatic for our domain.
- **Verdict**: secondary; consider for SDK / web-frontend scope
  later.

### 2.3 BugCrowd

- **What**: another general-purpose platform.
- **URL**: https://www.bugcrowd.com/.
- **Verdict**: out. Smaller share of the web3 researcher market.

### 2.4 Cantina / Code4rena / Sherlock (contest model)

- **What**: time-bounded contest reviews with prize pools.
- **URLs**: https://cantina.xyz/, https://code4rena.com/,
  https://www.sherlock.xyz/.
- **Strengths**: bursty intensity; useful for re-review windows
  (e.g. post-major upgrade).
- **Weaknesses**: contest != continuous bounty; researcher attention
  fades within the window.
- **Verdict**: complementary, not substitute. Consider one contest
  per major upgrade (next major upgrade after Phase A.5: a
  ~$50-100k Code4rena re-review).

### 2.5 Self-hosted

- **What**: programme run by the project's own security team.
- **Verdict**: out for v1. We do not have the researcher network or
  legal infrastructure to run safe-harbor agreements ourselves.
  Revisit at a later programme maturity stage.

---

## 3. Scope

[DECISION] Scope is published **only after** SC1 audit final report is
public. Otherwise researchers waste time on known issues.

### 3.1 In-scope contracts (P0 from SC1)

Identical to SC1 § 2.1. The bounty programme follows the audit scope
1:1 for the first year; we adjust based on findings.

In-scope on the day the programme activates:

- `AgentAccount`, `AgentAccountFactory`, `DelegationManager`.
- All 16+ caveat enforcers under `enforcers/`.
- All ERC-7579 modules under `modules/`.
- `SmartAgentPaymaster`, `MultiSendCallOnly`.
- `validators/PasskeyValidator`, `libraries/WebAuthnLib`,
  `libraries/P256Verifier`, `DaimoP256Verifier`,
  `UniversalSignatureValidator`.
- `SessionAgentAccountFactory`.

### 3.2 In-scope contracts (P1, after 6 months)

Registries — in-scope but at reduced bounty tier (see § 4):

- `ProposalRegistry`, `CommitmentRegistry`, `PledgeRegistry`,
  `GrantProposalRegistry`, `MatchInitiationRegistry`, `VoteRegistry`,
  `PoolRegistry`, `FundRegistry`.
- `AttributeStorage` (base; bugs here propagate).
- `OntologyTermRegistry`, `ShapeRegistry`.
- `AgentNameRegistry` family.
- `AgentSkillRegistry` family.
- `CredentialRegistry`, `MandateRegistry`.

### 3.3 Out-of-scope

- Mocks (`mocks/`, `MockTeeVerifier`).
- Test files (`test/`).
- Third-party libraries under `lib/` (we forward to upstream).
- Off-chain SDK / web frontend — handled by a separate programme.
- KMS infrastructure — handled by separate posture (see
  `output/KMS-IMPLEMENTATION-PLAN.md`).
- DoS via "send too many transactions" / gas grief unless it
  bricks the contract.

### 3.4 In-scope on-chain assets

- Smart-account funds (ETH + ERC-20 balances in user `AgentAccount`s).
- Paymaster deposit at EntryPoint.
- Pool / fund treasury balances.
- Pledged USDC in pledged-but-not-yet-honored state.

### 3.5 In-scope behaviours (severity escalation triggers)

- Theft of user funds.
- Theft of paymaster deposit.
- Theft of pledged USDC.
- Permanent freezing of user funds (unrecoverable).
- Permanent freezing of treasury funds.
- Unauthorised UUPS upgrade of any system contract.
- Unauthorised owner addition to a user account.
- Unauthorised passkey registration.
- Caveat enforcer bypass — any enforcer.
- Signature forgery against an `AgentAccount` (ECDSA or WebAuthn).
- Cross-chain replay (see SC9).

---

## 4. Reward tiers

[DECISION] Tier table:

| Severity | Description | Bounty range (USD) |
|---|---|---:|
| **Critical** | Direct loss / theft of user funds at scale; total bypass of authority. UUPS upgrade by non-owner; signature forgery; caveat enforcer fully bypassable. | **$50,000 – $250,000** |
| **High** | Loss of access; loss in narrow conditions; bypass of one specific user's authority; partial caveat-enforcer bypass under attacker-controllable conditions. | **$10,000 – $50,000** |
| **Medium** | Denial of service to a user, recoverable; gas grief above threshold; unauthorised state modification with no fund loss. | **$1,000 – $10,000** |
| **Low** | Info leak; minor state inconsistency; spec drift. | **$500 – $2,000** |

### 4.1 Critical-tier ceiling logic

The $250k Critical ceiling is calibrated to:

- Be **higher** than a researcher's expected value of selling the
  exploit elsewhere. Drainable wallet bugs trade in the $50-200k
  range on grey markets; we want to over-pay.
- Be **lower** than the realistic value at risk. Maximum value at
  risk in v1 (pre-mass-adoption) is bounded; we revisit the ceiling
  as TVL grows.
- Match industry standard for AA / wallet protocols (Safe, Privy,
  Argent all pay $100k-$250k Critical at comparable TVL).

[OWE-REVIEWER] Board sub-committee must approve the $250k Critical
ceiling and a programme-wide annual budget cap. **Proposed cap:
$500k/year**, with overflow approval required.

### 4.2 Tier escalation triggers

A Critical-tier finding escalates to the ceiling ($250k) when ANY:

- Exploit primitive scales (not just one account; many accounts).
- Exploit is silent (no on-chain event raises alarm).
- Exploit can be combined with another known-low-cost primitive
  (e.g. flash loan).
- Exploit requires no special prerequisites (no insider, no priv
  position).

### 4.3 De-duplication

If two researchers submit the same root-cause finding, the earliest
qualifying submission wins. Later submissions receive no bounty but
are publicly acknowledged.

### 4.4 Out-of-scope payments

We do NOT pay for:

- Issues found that were known and already disclosed in SC1 audit
  report (the public report is authoritative).
- Issues in third-party libs we did not modify.
- Theoretical issues without PoC.
- "Best practice" / informational findings (we welcome them but
  don't bounty them).

---

## 5. Safe harbor

[DECISION] We adopt the **ImmuneFi standard safe-harbor language** with
the following clarifications:

### 5.1 Allowed

- Testnet exploitation (Sepolia or our designated rehearsal testnet
  per SC8).
- Mainnet exploitation against **accounts the researcher owns**.
- Mainnet probing that does NOT cause:
  - Loss of funds belonging to others.
  - Persistent denial of service to others.
  - PII exfiltration from MCP services.

### 5.2 Required of researchers

- Report within 24 hours of discovery.
- No public disclosure until coordinated patch.
- No further exploitation beyond what is needed to demonstrate.
- Hand back any funds that ended up in researcher control.

### 5.3 NOT covered by safe harbor

- Exploitation of third-party users' funds.
- Social engineering attacks against project staff.
- Physical attacks.
- DDoS / volumetric attacks on infrastructure.
- Exfiltration of PII from MCP services (covered by separate
  programme).

### 5.4 Legal posture

[OWE-REVIEWER] Counsel review the safe-harbor text before public
publication. We do not invent the legal language; we use ImmuneFi's
template, with our entity name + jurisdiction inserted.

---

## 6. Disclosure policy

[DECISION] **90-day coordinated disclosure**, with override clauses
for unusual severity.

### 6.1 Standard path

1. Researcher reports to ImmuneFi.
2. Project triage acknowledges within **24 hours** (SLA §7).
3. Severity confirmed within **3 business days**.
4. Patch developed; deployment timeline shared with researcher.
5. Patch deployed.
6. **30 days** after deployment, full disclosure published (post +
   on-chain reference + retro).
7. Bounty paid on bug confirmation; bonus paid post-disclosure.

Total from report to public disclosure: 60-90 days typical.

### 6.2 Override clauses

- **Critical, actively exploited**: bypass standard timeline. Patch +
  coordinate disclosure with white-hat community immediately (potentially
  within 24 hours).
- **Critical, dormant**: standard 60-90 day path.
- **High, complex remediation**: timeline extends to up to 120 days
  with researcher concurrence.
- **Medium / Low**: 30-60 days.

### 6.3 Researcher credit

- Researcher's handle credited in the public disclosure (unless they
  request anonymity).
- For Critical / High: invitation to publish a write-up under their
  byline on our security blog (optional; researcher choice).

---

## 7. Operations

### 7.1 Triage

- **Primary triager**: security lead.
- **Backup triager**: developer with contract authoring authority
  (one of the contract authors).
- **Escalation**: engineering manager.

### 7.2 SLA

| Severity | Initial acknowledgement | Severity confirmation | Patch | Disclosure |
|---|---|---|---|---|
| Critical | 24 hours | 3 business days | 7-14 days | 30 days post-patch |
| High | 48 hours | 5 business days | 30 days | 30 days post-patch |
| Medium | 5 business days | 10 business days | 90 days | After patch |
| Low | 10 business days | 20 business days | Best effort | After patch |

### 7.3 Channels

- **Submission**: ImmuneFi platform (no other intake).
- **Internal**: dedicated Slack channel `#sec-bounty` with security
  lead + backup + engineering manager.
- **Public**: published programme page on ImmuneFi + our security
  page.

### 7.4 Triage workflow

1. ImmuneFi notification → Slack alert.
2. Triager reads submission within SLA window.
3. Triager verifies PoC against testnet / fork.
4. Triager assigns severity using rubric (§4).
5. Triager creates internal ticket; engineering manager assigns
   dev for patch.
6. Patch reviewed by ≥ 1 contracts-authoring developer + security
   lead. Auditor (retainer, see SC1 §8.3) consulted for Critical /
   High.
7. Patch deployed.
8. ImmuneFi notified of resolution; bounty issued.
9. Disclosure prepared; published per §6.

### 7.5 Tooling

- Slack integration with ImmuneFi (per
  https://docs.immunefi.com/projects/how-to-use-immunefi).
- Severity rubric checklist as a Slack workflow.
- Triage timer auto-tracker (e.g. PagerDuty integration for the
  Critical 24-hour SLA).

---

## 8. Activation criteria

[DECISION] Programme activates when ALL of:

- [ ] SC1 final report published.
- [ ] SC1 remediation deployed.
- [ ] SC4 upgrade governance multisig deployed and operational on
      mainnet.
- [ ] SC8 testnet rehearsal in progress (or complete).
- [ ] Programme page drafted, legal review complete.
- [ ] Triage team trained (one practice run with a synthetic
      submission).
- [ ] ImmuneFi vault funded — see §9.

### 8.1 Pre-activation testnet bounty (optional)

We can run a **testnet-only** bounty during SC8 (rehearsal) at a 10%
of mainnet tier. This:

- Surfaces bugs cheaply before mainnet.
- Trains the triage team.
- Builds researcher familiarity.

[DECISION] Yes — run testnet-only programme during SC8 at the 10%
tier. Critical = $25k, High = $5k, Medium = $500, Low = $100.

---

## 9. Funding model

### 9.1 Programme vault

ImmuneFi requires the programme to have an on-vault balance equal to
the maximum payout the programme might issue. For our tier table:

- **Worst case**: 2 Critical payouts at $250k each = **$500,000**.
- **Realistic**: 1 Critical + 2 High = **$350,000**.
- **Recommended vault: $500,000.**

[OWE-REVIEWER] Decide funding mechanism:

- Option A: $500k directly to ImmuneFi escrow.
- Option B: $250k to ImmuneFi escrow + $250k held by us, replenished
  on draw.
- Option C: Insurance policy (some firms offer bounty insurance —
  research current 2026 market).

[DECISION] Option A — full $500k to ImmuneFi at activation, with
$200k annual top-up cadence. This avoids the "we promised $250k but
need a treasury vote to release it" credibility risk.

### 9.2 Annual budget

| Line | Amount |
|---|---:|
| Initial vault | $500,000 |
| Annual replenishment | $200,000 / year |
| Platform fee (10% of payouts) | ~$30,000 / year |
| Triage team time (≈ 0.2 FTE security lead) | ~$60,000 / year loaded |
| Disclosure / blog support | ~$10,000 / year |
| **Total Year 1** | **~$800,000** |
| **Total Year 2+** | **~$300,000 / year** |

### 9.3 Cost vs benefit

A single drained user account at v1 deployment scale (low) is bounded
by per-account TVL; at higher TVL, a single Critical bug can drain
hundreds of accounts. The programme pays for itself the first time it
catches a Critical that would have otherwise been exploited.

---

## 10. Programme growth

### 10.1 Initial scope (Day 1)

P0 contracts only (§3.1). $500k vault.

### 10.2 6 months post-activation

Expand to P1 (§3.2). Revisit tier ceilings.

### 10.3 12 months post-activation

- Add SDK to scope.
- Add web frontend to scope (lower tiers; web bugs typically Low /
  Medium).
- Consider a periodic Code4rena / Cantina contest in parallel.

### 10.4 Steady state

- Annual programme review with security lead.
- Tier adjustment based on TVL growth.
- Vendor review every 24 months.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| B1 | Programme activates with audit findings still embargoed; researchers report duplicates. | §8 activation criteria requires SC1 final report public first. |
| B2 | We can't pay a Critical bounty (vault drained). | §9 keeps vault at $500k minimum; replenishment SLA is 30 days. |
| B3 | Researcher publishes 0-day before patch ready. | §6 safe-harbor requires coordinated disclosure; violation forfeits bounty + risks legal action. Mitigation only goes so far — keep patch tooling fast. |
| B4 | Triage burnout — high submission volume during first month. | §7 has primary + backup triager; consider hiring a temp triage contractor for the first 90 days. |
| B5 | Severity disputes. | ImmuneFi adjudication is the tie-breaker per their TOS; we accept their ruling. |
| B6 | Researcher attempts mainnet exploitation during PoC. | Safe-harbor §5.1 forbids it; we coordinate testnet PoC instead; legal recourse for violators. |
| B7 | Programme attracts SEO-driven low-quality submissions ("not a bug" spam). | ImmuneFi has spam-filtering tooling; we rate-limit submitters. |
| B8 | Researcher refuses NDA / wants immediate disclosure. | §6 has override clauses; we accommodate exceptional cases but maintain coordinated norm. |

---

## 12. Acceptance criteria

SC3 is complete (programme is live) when ALL of:

- [ ] Programme page published on ImmuneFi.
- [ ] Programme page mirrored on our security site.
- [ ] $500k vault funded.
- [ ] Safe-harbor legal review complete.
- [ ] Triage team trained.
- [ ] One internal-only practice submission run end-to-end.
- [ ] Board sub-committee approves annual cap.
- [ ] SLA + workflow documented in our internal runbook.

---

## 13. Next actions

1. Engineering manager: ratify $500k initial vault + $200k annual
   budget with CFO.
2. Security lead: draft programme page text using ImmuneFi template;
   send to counsel for safe-harbor review.
3. Developer: set up Slack integration + triage Slack workflow.
4. Security lead: schedule practice triage exercise (synthetic
   submission, one round).
5. After SC1 final report public + SC4 deployed: activate.
