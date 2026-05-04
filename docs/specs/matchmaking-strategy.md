# Matchmaking Strategy

**Status:** Strategic design doc
**Companion to:** `grants-fund-architecture.md`, `funding-models-survey.md`, `gitcoin-grants-deep-dive.md`
**Purpose:** Lay out how matching works across all funding models, where it runs, what data it needs, what trade-offs different approaches make. The matcher is the runtime piece that turns the publish-and-discover protocol into a useful product.

---

## 1. Reframing: matchmaking is *strategic surfacing*, not pairwise matching

The OpenSea-style framing of "find the buyer for this seller" is the wrong mental model. In a publish-and-discover marketplace mediated by funds, matchmaking has to answer:

> Given who I am (donor / recipient / fund-admin / mediator) and what I'm trying to do, what *strategic action* should I take next, and which counterparties / mandates / strategies make sense to consider?

The matcher's output is a **set of action cards**, each carrying:
- An action verb ("Pledge to fund X", "Submit proposal to fund Y", "Propose meeting with Z")
- The counterparty or mandate it concerns
- Predicted outcome ("your $25 could become $X via QF", "high trust match")
- Cost / effort signal ("requires 1-page proposal", "single-tap pledge")
- Caveats ("identity verification needed for QF eligibility")

The job isn't pairing — it's *surfacing the right options at the right time with the right context.* This frames every design choice below.

---

## 2. Three matching primitives

Every match-card production goes through three stages. Each stage trades off privacy vs accuracy vs latency.

### 2.1 Filter — eligibility check

Given a mandate (or all mandates) and an intent (or all intents), which combinations are *eligible*?

```
mandate.acceptsGiftKinds      ⊇  giftIntent.kind ?
mandate.fundsNeedKinds         ⊇  needIntent.kind ?
mandate.geoRoot                ⊑  intent.geoRoot ?         (prefix)
mandate.eligibilityRules.* match intent.attributes ?
mandate.identityRequirement    satisfied by caller credentials ?
```

This is the cheap, deterministic filter. Returns "eligible" or "not eligible." Most matching ends here for direct matches; for fund-mediated matches, eligible mandates flow to scoring.

**Privacy:** Filter runs entirely on public data (mandate is public; intent is public if `visibility ≥ public-coarse`). Caller-side execution is fine.

### 2.2 Score — predicted-impact ranking

Among eligible candidates, order them by predicted impact / fit. Inputs:

- **Trust scores** (caller's perspective): how much do I trust this fund/counterparty? From `TrustDeposit` ledger.
- **Capacity** (fund-side): does this fund have capital available, or is it overcommitted?
- **Allocation algorithm** (mandate-specific): for QF mandates, what's the predicted match if I pledge $X? For single-coach, what's the historical approval rate?
- **Geo proximity / community overlap**: how aligned are the parties on community membership?
- **Outcome track record** (counterparty-specific): has this recipient delivered on past awards?

Score is a number ∈ [0, 1] or a multi-dimensional rank.

**Privacy:** Some inputs are public (TrustDeposit, allocation history); some are private (caller's own intent priorities). Score *can* run caller-side because the caller's session has all needed data.

### 2.3 Surface — render as action card

Combine filter + score into a card with:
- Action verb
- Counterparty/mandate identity
- Predicted impact narrative
- Required steps
- Caveat warnings

Then sort by score, paginate, render in `/discover` UI.

---

## 3. Where the matcher runs (timing axis)

Three options:

| Timing | When matching computes | Pros | Cons |
|---|---|---|---|
| **Publish-time** | Whenever a new public intent or mandate is published, eagerly compute matches and persist | Fast read on /discover; precomputed | Matches go stale; storage overhead per user; needs cross-tenant write to push matches into recipient's MCP (violates owner-routing) |
| **Request-time** | On every visit to /discover, the caller's session computes matches live | Always fresh; respects owner-routing perfectly; no cross-tenant writes | Slow if many candidates (cache mitigates); each user pays compute |
| **Scheduled** | Periodic batch (e.g. every hour) computes matches per user | Fresh-enough; spreads compute | Same cross-tenant write problem as publish-time; needs background worker per user |

**Recommendation: request-time with caller-session cache.**

The recommendation falls out of the architecture invariant: the matcher runs in the caller's session, reads only the caller's MCP + public on-chain data, and never writes to another agent's MCP. This is *only* tenable if the matcher computes on demand.

**Cache mitigation:** memoize per-session for ~5 minutes. Caller's MCP doesn't change in 5 minutes; public on-chain assertions don't change in 5 minutes (assertion mints are infrequent). A 5-minute cache reduces compute to ~12 evaluations/hour per active user.

**Edge case:** when a new public intent or mandate is minted, callers don't see it for up to 5 minutes. Acceptable for this kind of marketplace (these aren't HFT trades).

---

## 4. Where the matcher runs (locality axis)

Two options:

| Locality | Where compute happens | Pros | Cons |
|---|---|---|---|
| **Caller-side** (in caller's session, server-rendered for them) | Web app server-action runs the match in caller's request context | Honors owner-routing; no shared matcher process; trivially scales horizontally | Each caller pays compute; can't run cross-user algorithms (QF) |
| **Fund-side** (in fund principal's session) | Fund's own MCP/server runs match-listing for itself (admin queue) | Centralized fund admin view; can run round-close allocation algorithms (QF, COCM) | Fund only sees its own pledges/proposals (via cross-deleg) — natural isolation |
| **Centralized matcher service** | A neutral process indexes everything and pushes matches | Best for cross-fund optimization | Violates owner-routing (would need cross-tenant reads); single point of compromise |

**Recommendation:** Caller-side for direct matches and fund-mediated discovery; **fund-side** for round-close allocation algorithms (QF, COCM, multisig vote tallying).

This is a clean split:
- *"What should I do?"* (caller's perspective) → caller-side
- *"How should this round allocate?"* (fund's perspective) → fund-side

Neither requires a centralized matcher.

---

## 5. Mandate as filter vs Mandate as scoring weight

A subtle but important decision: mandates can act as **hard filters** (reject ineligible) OR **soft scoring inputs** (still surface, with low score).

| Approach | When | Pros | Cons |
|---|---|---|---|
| **Hard filter** | Geo / kind / membership constraints | Clean rejection; fast | Marginal cases get hidden |
| **Soft score** | Eligibility predicates with confidence | Surfaces edge cases for human judgment | Cognitive load; spam of low-quality matches |

**Recommendation:**
- **Hard filter** on: kind mismatch, hard geo bound (if mandate says us/colorado, exclude us/oregon), expired window, identity-credential missing, capacity exhausted.
- **Soft score** on: confidence of geo prefix match (us/colorado/wellington vs us/colorado/loveland — both eligible, geo-distance affects rank), trust-score thresholds, capability tag overlap.

The matcher's filter pass produces a candidate set; the score pass orders within that set; the surface pass picks the top N.

---

## 6. Identity / Sybil resistance integration

QF and any matching pool requires identity assurance. Without it, one human creates 100 fake donors and harvests 100x the match. Our existing AnonCreds rails do this.

### 6.1 The credential-based identity policy

Mandate field:

```yaml
FundMandate:
  identityRequirement:
    minPassportScore: 5                # weighted aggregate
    requiredCredentials:               # AND-of these
      - { type: "VerifiedHuman", issuer: "*" }
      - { type: "ResidentOf", issuer: "geo-mcp", value: "us/colorado" }   # for geo-bound funds
    bonusCredentials:                  # contribute to score, not required
      - { type: "VerifiedReviewer", issuer: "trust-network", weight: 0.3 }
      - { type: "GitCoinPassportStamp", issuer: "passport.gitcoin.co", weight: 0.5 }
```

### 6.2 Verifier plumbing

Existing `verifier-mcp` handles the proof verification. The matcher (caller-side) calls it once per user-session to compute a "trust certificate":

```ts
async function computeIdentityScore(callerPrincipal): TrustCertificate {
  const credentials = await listMyCredentials(callerPrincipal)   // existing tool
  const verified = await verifierMcp.batchVerify(credentials)
  const passport_score = sum(verified.where(in mandates' bonusCredentials).map(c => c.weight))
  return { passport_score, satisfiedRequirements, bonusScore: ... }
}
```

The certificate is cached per session (~5 min TTL). When the matcher evaluates a fund-mediated card, it checks the certificate against the mandate's `identityRequirement`. If failed, the card includes `caveat: "requires VerifiedHuman credential"` with a CTA to complete the credential issuance flow.

### 6.3 Sybil-resistance model summary

| Layer | Defense |
|---|---|
| **Credential-based** | AnonCreds proofs of humanity; passport-style aggregation |
| **Trust-staked** (Phase 5) | TrustDeposit on identity assertions — slashing on Sybil discovery |
| **Cluster-aware allocation** (Phase 5) | COCM discount on within-cluster contributions |
| **Manual review** (always) | Fund governance can reject suspect proposals/pledges |

Layered defense; each addresses a different attack class.

---

## 7. Trust scores and how they enter matching

The smart-agent codebase has `TrustDeposit` for staked claims about agents. Trust is *bounded* (you can't have unlimited trust without staking) and *historical* (prior validations leave deposits that decay).

**For matching:**

| Where trust score enters | How |
|---|---|
| Donor → Fund | Display fund's trust score; rank funds by trust × mandate-fit |
| Recipient → Fund | Display fund's track record (validated outcomes / total awards) |
| Fund admin → Recipient | Display recipient's trust score; weight in allocation decisions |
| Donor → Recipient (direct match) | Display recipient's trust score |
| Validator → Outcome | Validator's own trust deposits affect their validation weight |

**Implementation:** Trust scores are public (chain-readable); querying is free. Each match card surfaces a normalized trust badge (low/medium/high/verified). Fund-admin queues sort proposals by recipient trust score by default.

---

## 8. Cluster awareness (COCM-style)

This is interesting because it's the place where matching gets *strategic* in our framework.

**Catalyst-context example.** Wellington Circle has 10 active members. If all 10 pledge to a Wellington-only project, vanilla QF treats that as 10 distinct donors. COCM detects the tight clustering ("these 10 are all members of the same circle") and discounts their joint contribution to projects within their cluster.

**Implementation prerequisites:**

- A donor-similarity graph. Edges based on:
  - Co-membership in a hub or circle
  - Co-location (same geo features)
  - Co-pledging (donating to same projects historically)
- A clustering algorithm (Louvain or similar; well-known O(n log n) graph partitioner).
- An allocation algorithm that pools contributions within cluster before applying QF math.

**Privacy:** The donor-similarity graph is built from public on-chain data (HUB_HAS_MEMBER, residentOf claims, prior pledge events). No private data needed.

**Phase:** Defer to Phase 5. Vanilla QF first; COCM as a refinement.

---

## 9. The matcher state machine

Here's the canonical algorithm for caller-side matching:

```ts
async function findMatchesFor(caller, callerKind: 'donor' | 'recipient' | 'fundAdmin'): MatchCard[] {
  // Step 1: gather caller's inputs
  const myIntents = await listMyIntents(caller)        // person-mcp own
  const myCredentials = await listMyCredentials(caller)
  const identityScore = await computeIdentityScore(caller, myCredentials)

  const cards: MatchCard[] = []

  // Step 2: direct matches
  for (const intent of myIntents) {
    const opposite = inverseDirection(intent.direction)
    const candidates = await listExpressedIntents({
      direction: opposite,
      kind: matchableKinds(intent.kind),
      geoRoot: intent.geoRoot,
      excludePrincipal: caller,
    })
    for (const c of candidates) {
      cards.push({
        kind: 'direct-match',
        score: scoreDirectMatch(intent, c, identityScore),
        action: { verb: 'Propose meeting', target: c.principal },
        ...
      })
    }
  }

  // Step 3: fund-mediated for receivers
  if (myIntents.some(i => i.direction === 'receive')) {
    const eligibleFunds = await listFundMandates({
      fundsAnyKind: receiveKinds(myIntents),
      geoOverlap: anyOf(receiveGeos(myIntents)),
    })
    for (const f of eligibleFunds) {
      if (!satisfiesIdentityRequirement(identityScore, f.mandate.identityRequirement)) {
        cards.push({
          kind: 'fund-mediated:submit-proposal-needs-credentials',
          score: 0.3,
          action: { verb: 'Get credential to submit', target: f.fundPrincipal },
          caveat: 'requires VerifiedHuman credential',
          ...
        })
        continue
      }
      cards.push({
        kind: 'fund-mediated:submit-proposal',
        score: scoreFundMatch(myIntents, f, identityScore),
        action: { verb: 'Submit proposal', target: f.fundPrincipal, mandate: f.mandate },
        ...
      })
    }
  }

  // Step 4: fund-mediated for givers
  if (myIntents.some(i => i.direction === 'give' && isCapitalKind(i.kind))) {
    const eligibleFunds = await listFundMandates({
      acceptsAnyGiftKind: capitalGiftKinds(myIntents),
      geoOverlap: anyOf(myIntents.geoRoot),
    })
    for (const f of eligibleFunds) {
      const predictedMatchMultiplier = computeMatchMultiplier(f, identityScore)
      cards.push({
        kind: 'fund-mediated:pledge',
        score: scorePledgeMatch(myIntents, f, predictedMatchMultiplier),
        action: { verb: 'Pledge to fund', target: f.fundPrincipal },
        narrative: `Your $25 could become $${25 * predictedMatchMultiplier} via QF`,
        ...
      })
    }
  }

  // Step 5: fund-admin queue (if caller is a fund principal)
  if (callerKind === 'fundAdmin') {
    const myFunds = await listFundsIAdmin(caller)
    for (const f of myFunds) {
      const proposals = await listReceivedProposals(f.fundPrincipal)
      const pledges = await listReceivedPledges(f.fundPrincipal)
      const outcomesPending = await listPendingOutcomes(f.fundPrincipal)
      cards.push(adminQueueCard(f, proposals, pledges, outcomesPending))
    }
  }

  return cards.sort((a, b) => b.score - a.score)
}
```

The key invariants:

- Reads only `caller`'s data (`listMyIntents`, `listMyCredentials`, `listFundsIAdmin`)
- All other reads are public (`listExpressedIntents`, `listFundMandates`, `listReceivedProposals` *as the fund-admin*)
- No cross-tenant writes anywhere
- Cards are computed inline, not persisted

---

## 10. Round-close allocation (fund-admin side)

For QF / COCM / DAO-vote / matching-pool / retro-vote, the *fund* runs the allocation when a round closes. This is fund-side compute, not caller-side.

```ts
async function closeRoundAndAllocate(fundAdmin, round): Allocation[] {
  // Authorization: caller must be fund principal or governance member
  await requireFundGovernance(fundAdmin, round.fundId)

  const proposals = await listReceivedProposals(round.fundId, round.id)
  const pledges = await listReceivedPledges(round.fundId, round.id)
  const mandate = await getFundMandate(round.fundId)

  const strategy = STRATEGY_REGISTRY[mandate.governance.model]
  const allocations = await strategy.allocate(proposals, pledges, mandate, round)

  for (const alloc of allocations) {
    await mintAwardAgreement(round.fundId, alloc.proposalId, alloc.amount)
    await createEngagement(round.fundId, alloc.proposalId, alloc.tranches)
  }

  await closeRound(round.id)
  return allocations
}
```

The strategies are pluggable. v1 ships `single-coach` and `multisig`. Phase 5 adds `quadratic`, `cluster-quadratic`, `retro-vote`, `donor-advised`, `dao-vote`.

---

## 11. Match-card surface — three viewer modes

What each user sees on `/discover`:

### 11.1 Donor view

```
┌─────────────────────────────────────────────────────────────────┐
│ Matches for your gift intents                                   │
├─────────────────────────────────────────────────────────────────┤
│ 🤝 Direct: Sofia (Wellington Circle) needs a coach             │
│    [Propose meeting]                                            │
├─────────────────────────────────────────────────────────────────┤
│ 💰 Fund: NoCo Trauma-Care Fund matches your gift kind          │
│    Single-coach (Maria); $50k cap                               │
│    Your $25 funds 1 trauma-trainer-week                         │
│    [Pledge $25] [Pledge other amount]                          │
├─────────────────────────────────────────────────────────────────┤
│ 🌐 Fund: NoCo Pluralistic Round (Q2 QF round)                  │
│    Round closes in 12d • Matching pool: $20,000                 │
│    Your $25 could become $80-$200 depending on broad support    │
│    ⚠ Requires VerifiedHuman credential — [Get credential]      │
│    [Pledge $25 to a project]                                   │
├─────────────────────────────────────────────────────────────────┤
│ 🌍 Fund: CIL Capital Pool                                       │
│    Geo: Togo • Restriction: capital only                        │
│    [Pledge to fund]                                             │
└─────────────────────────────────────────────────────────────────┘
```

### 11.2 Recipient view

```
┌─────────────────────────────────────────────────────────────────┐
│ Eligible funds for your need: Trauma-care training              │
├─────────────────────────────────────────────────────────────────┤
│ 🎯 NoCo Trauma-Care Fund                                        │
│    Mandate match: 92%   Single-coach approval                   │
│    Predicted award: high (recent track record: 8/10 funded)     │
│    Required: 2-page proposal + budget + milestones              │
│    [Submit proposal]  [Save for later]                          │
├─────────────────────────────────────────────────────────────────┤
│ 🌐 NoCo Pluralistic Round (QF)                                 │
│    Round closes in 12d                                          │
│    Mandate match: 71%   Estimated allocation: $300-$8000       │
│    Requires public proposal + community engagement              │
│    [Submit + activate community]                                │
├─────────────────────────────────────────────────────────────────┤
│ 📜 RetroPGF Q3 (Phase 5)                                        │
│    Submit hypercert claim of completed trauma-care work         │
│    [Submit retro claim]                                         │
├─────────────────────────────────────────────────────────────────┤
│ 🤝 Direct: Maria offers coaching                                │
│    Trust score: 9.4   Last validated: 2026-04-15               │
│    [Propose meeting]                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 11.3 Fund-admin view

```
┌─────────────────────────────────────────────────────────────────┐
│ NoCo Trauma-Care Fund — admin queue (Maria as steward)         │
├─────────────────────────────────────────────────────────────────┤
│ Proposals pending review (4)                                    │
│   • Ana — "Trauma-care training Wellington" — 8.7 trust        │
│     [Review]  [Approve]  [Decline]                              │
│   • Hannah — "Berthoud G2 cohort" — 6.2 trust                  │
│   • ...                                                          │
├─────────────────────────────────────────────────────────────────┤
│ Pledged but unallocated: $45,000 (4 donors)                    │
├─────────────────────────────────────────────────────────────────┤
│ Outcomes pending validation (2)                                 │
│   • Q1 award #12 — 6/8 milestones complete                     │
│     [Review evidence]  [Validate]                               │
├─────────────────────────────────────────────────────────────────┤
│ Round configuration                                              │
│   Current round: Q2 2026 — 12d remaining                        │
│   Strategy: single-coach (you)                                  │
│   [Open new round]  [Run allocation preview]                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 12. Trade-off summary

| Dimension | Option A | Option B | Recommendation |
|---|---|---|---|
| **When matching runs** | publish-time (eager) | request-time (lazy) | request-time + 5-min cache |
| **Where matching runs** | centralized service | caller-side + fund-side | distributed (caller / fund) |
| **Mandate filter posture** | hard reject | soft score | hard filter on hard rules; soft score on quality |
| **Identity layer** | none | full passport-stamp ecosystem | AnonCreds-based, scoped per mandate |
| **Sybil defense** | identity only | identity + cluster + trust-stake | identity v1; cluster + stake Phase 5 |
| **Allocation strategy** | hardcoded per fund | pluggable registry | registry from day one (Allo lesson) |
| **Round semantics** | continuous-only | round-based-only | both supported; mandate.schedule.kind |
| **Match-card surface** | one card type | per-role views | three viewer modes (donor / recipient / admin) |
| **Compute privacy** | private (caller-side) | shared service | caller-side for direct & fund-discovery; fund-side for round-close |
| **Failure mode** | matcher returns empty | matcher caches stale | request-time means failure surfaces immediately |

---

## 13. v1 matcher scope

Minimum to ship a usable Discover panel:

- **Caller-side matcher** computing direct matches + fund-mediated cards on `/discover` request
- **Filter** on kind, geo (prefix), and identity-requirement satisfaction
- **Score** as `trust × mandate-fit × recency`
- **Three card kinds**: direct-match, fund-mediated:submit-proposal, fund-mediated:pledge
- **Fund-admin queue** card (when caller is fund principal)
- **Cache** per-session, 5-min TTL

That's roughly the F3+F4+F8 commits in the architecture doc, augmented with strategy-registry pattern from Gitcoin so we don't paint ourselves into a corner.

## 14. Phase 5 matcher additions

- **QF allocation algorithm** (round-close fund-side compute)
- **COCM clustering** for capture-resistant matching
- **Retro-vote allocation** (vote-weighted)
- **Trust-staked identity** (TrustDeposit on identity assertions)
- **Match-multiplier prediction** ("your $25 could become $X")
- **Round-cap enforcement** (hard reject pledges over cap; waitlist)
- **Conditional-pledge state machine** (crowdfunding-style threshold)
- **Cluster-aware fund-discovery** (recipients in same circle see different matches than recipients across circles)

---

## 15. Open strategic questions

1. **How aggressive should soft scoring be?** A weak match could still surface as "consider this." Risk: spam. Mitigation: render only top N + paginate with explicit "show all eligible." Recommendation: top 5 cards per kind by default.

2. **Cross-fund proposal strategy.** A recipient could submit the same proposal to multiple funds. Some funds may approve it; others may reject. Should the matcher *encourage* multi-submission ("apply to 3 funds in parallel") or warn against it ("don't double-submit")? Recommendation: encourage; mandate approval policies make explicit "we accept proposals also submitted elsewhere" flag.

3. **Stale-data handling.** Mandate updates (e.g. fund changes its criteria) invalidate cached matches. Detection: subscribe to `atl:fundMandate` updates via on-chain events. Force cache invalidation on mandate change.

4. **Match-card persistence.** If a user sees a match and dismisses it, should it stay dismissed across sessions? Storage: per-user dismissal list in their MCP. Honor across sessions.

5. **Adversarial matchmaking.** A bad-actor fund could publish a deceptive mandate ("we fund X" when really we fund Y). Defense: trust score on the fund itself, validated by reviewers; bad-actor mandate becomes low-trust fund and ranks last.

---

## 16. Architectural take-away

The matcher **doesn't need to be smart in v1** — it needs to be *correctly framed*:

1. *Strategic surfacing*, not pairwise matching.
2. Per-viewer-mode (donor, recipient, fund-admin) — not one-size-fits-all.
3. Caller-side compute + fund-side allocation — not centralized.
4. Pluggable strategies — even if v1 ships only two.
5. Cards as the unit of UI, not rows in a table.
6. Privacy-preserving: read caller's MCP + public on-chain data only.
7. Refresh on demand with a small cache; no push-based propagation.

Get those seven right and the matcher composes with every funding model in the survey. Add the QF/COCM algorithms in Phase 5 and we have a state-of-the-art grants pipeline.

The Gitcoin lesson: *don't try to be smart; try to be configurable.* Mandate-as-policy, strategy-as-plugin, card-as-surface. Every smart funding model becomes a configuration of these primitives. That's how we get from `matchesProposed: () => []` to a full grants marketplace without ever rewriting the matcher core.
