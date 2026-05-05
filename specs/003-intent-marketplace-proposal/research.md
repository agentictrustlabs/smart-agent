# Phase 0 — Research: Intent Marketplace (Proposal Lane)

## R1. Round entity shape

**Decision**: A thin first-class entity. Body lives in the **fund's org-mcp tenant** (`org_principal = fundAgentId`); public on-chain anchor via `sa:RoundOpenedAssertion` (creation) and `sa:RoundClosedAssertion` (close). Private rounds anchor a coarse on-chain assertion (no addressed-applicants list); the addressed-applicants list lives in the fund's org-mcp only.

**T-Box** — already authored by the Ontologist (Audit § 1.1). `docs/ontology/tbox/proposal.ttl` declares:
- `sa:Round subClassOf prov:Plan, p-plan:Plan`.
- `sa:operatedByFund` (functional, range `sa:Fund` — the fund-as-pool subclass introduced in spec 002).
- `sa:roundMandate` (xsd:string JSON literal — Audit § 8.2).
- `sa:milestoneTemplate`, `sa:validatorRequirements` (JSON literals).
- `sa:reportingCadence` (range `sa:ReportingCadence` C-Box).
- `sa:deadline`, `sa:decisionDate`.
- `sa:requiredCredentials` (multi-valued).
- `sa:addressedApplicants` (multi-valued; private rounds only — never appears in the public anchor).
- `sa:proposalsReceived` (derived counter).
- `sa:RoundOpenedAssertion`, `sa:RoundClosedAssertion` (on-chain anchor classes).

**Body layout** — `rounds` table in fund's org-mcp (per IA § 2.4):

```ts
rounds {
  id                  IRI primary key,
  org_principal       not null,            // = fundAgentId (org-mcp tenant key)
  mandate             json,
  milestoneTemplate   json,
  validatorRequirements json,
  reportingCadence    enum,
  deadline            timestamp,
  decisionDate        timestamp,
  requiredCredentials string[],
  visibility          enum('public','private'),
  addressedApplicants string[] nullable,
  proposalsReceived   integer,
  onChainAssertionId  IRI,
  createdAt, updatedAt
}
```

**Rationale**: Rounds need their own deadline, prior stats, and identity. Embedding inside the fund agent would force schema changes whenever round semantics evolve. Public anchor at creation is the right place — rounds are RFPs; intrinsically public for public rounds, coarse for private.

## R2. Mandate-match badge (FR-001)

**Decision**: A round is "matched" against an intent when:
- `intent.kind ∈ round.mandate.acceptedKinds` (or any parent in the SKOS taxonomy if the round mandates a parent), AND
- `intent.geoRoot ⊆ round.mandate.acceptedGeo` (geo containment), AND
- `intent.amount` is not strictly above `round.budgetCeiling` (a "soft" warning is shown if `intent.amount` is suspiciously below the ceiling, indicating wasted ask capacity, but the round still matches).

**SPARQL pattern**: a single SELECT joining `Intent` to public `sa:RoundOpenedAssertion` mirrors via mandate-overlap filters.

**Rationale**: The same overlap test drives FR-001 (badge) and FR-016 (proposer-side outcome score's domain restriction).

## R3. GrantProposal persistence shape

**Decision**: Body lives in the **proposer's MCP** (almost always `apps/org-mcp/src/db/schema.ts`; `apps/person-mcp/src/db/schema.ts` for solo human applicants) in a new `proposal_submissions` table. **No on-chain anchor in v1.** **No GraphDB mirror in v1.** Steward read access via `proposal:read_for_review` cross-delegation issued by the proposer at submit time.

**Class rename** (Audit § 2 O1, § 4 F3, § 6): the on-chain `sag:Proposal` class refers to **governance-vote** proposals (the existing org-mcp `proposals` table). To avoid the noun collision, the T-Box class for spec 003's grant-cycle artifact is `sa:GrantProposal`. **The user has authorised propagating this rename across all layers** — TS types, contracts, spec text, plan, data-model, research, quickstart all use `GrantProposal`.

**T-Box** — already authored by the Ontologist (Audit § 1.1). `docs/ontology/tbox/proposal.ttl` declares:
- `sa:GrantProposal` (single class with `sa:visibility` predicate; ALWAYS private at submission).
- `sa:proposer` (functional, subPropertyOf `prov:wasAssociatedWith`).
- `sa:targetRound` (functional; range `sa:Round`).
- `sa:fundMandate` (functional; range `sa:Fund` — directly references the Fund; **no separate Mandate entity** per Audit § 6).
- `sa:basedOnIntent` (range `saint:Intent`).
- `sa:budget`, `sa:plan`, `sa:milestones`, `sa:desiredOutcomes`, `sa:reportingObligations`, `sa:organisationalBackground` (all xsd:string JSON literals; Audit § 8.2).
- `sa:proposalSubmittedAt` (subPropertyOf `prov:generatedAtTime`).
- `sa:version`, `sa:lastEditedAt`, `sa:withdrawnAt`.
- `sa:proposalStatus` (range `sa:GrantProposalStatus` C-Box scheme: draft / submitted / withdrawn / awarded / declined).
- `sa:clonedFromProposal` (range `sa:GrantProposal`).

**SHACL backstop** (`docs/ontology/tbox/shacl/visibility.ttl`): `sa:GrantProposalAlwaysPrivateShape` enforces that no `sa:GrantProposal` carries `sa:onChainAssertionId` in v1.

**TS field → T-Box predicate mapping** (Audit § 3): TS keeps `*Id` JS conventions; T-Box predicates are bare:

| TS field | T-Box predicate |
|----------|-----------------|
| `proposerAgentId` | `sa:proposer` |
| `roundId` | `sa:targetRound` |
| `fundMandateId` | `sa:fundMandate` |
| `basedOnIntentId` | `sa:basedOnIntent` |
| `submittedAt` | `sa:proposalSubmittedAt` |
| `status` | `sa:proposalStatus` |
| `clonedFromProposalId` | `sa:clonedFromProposal` |

**Rationale** (per IA § 2.3): proposal contents include budget, organisational backing, reporting cadence, validators — all sensitive. ECFA-style stewardship requires confidential review; donors must not be able to game competing proposals by reading them. The awarded outcome (downstream) is publishable; the submitted content is not.

The downstream review/award spec MAY introduce a public anchor for *awarded* proposals — that's a future spec's call, not ours.

## R4. Required-credential gate

**Decision**: Reuse the existing AnonCreds verifier infrastructure. The Round's `requiredCredentials` is a list of credential-kind identifiers; submission validates each via the credential-registry pattern (one of the project's established patterns per CLAUDE.md memory).

**Rationale**: No new privacy primitive; we plug into the verifier set the project already has.

## R5. Pre-deadline edit gate

**Decision**: The proposer's MCP `grant_proposal:edit_pre_deadline` tool compares `now <= round.deadline` (round body read from fund's org-mcp). If `now > round.deadline`, the tool returns a 403 with a "post-deadline edits require steward consent" message; the spec leaves the steward-consent flow to the downstream review spec.

**Rationale**: Decidable from the Round's `deadline` and the proposal's `targetRound`. For open-call submissions (`targetRound == null`), edits are always allowed (no deadline) until the fund's stewards explicitly close the call (downstream).

## R6. Two-sided ranking signals (Q1, Q2)

**Decision**: Side-specific signal computation lives in `@smart-agent/sdk/matchmaker/side-signals.ts`. Each helper produces a `RankBasis` consumable by spec 001's `rankCandidates` pure function.

- *Proposer side* (Q1): `proposerSideSignals(proposer, round) → RankBasis`. `proximityHops` = hops from `proposer` to `round.operatedByFund` (the fund agent). `priorOutcomes` = (fulfilled, abandoned) over the fund's prior awards in the proposer's intent domain (per the mandate-match SKOS overlap from R2). When zero awards in domain, fall back to fund-wide outcomes.
- *Steward side* (Q2): `stewardSideSignals(fund, proposer) → RankBasis`. `proximityHops` = hops from `fund` (the fund agent) to `proposer`. `priorOutcomes` = the proposer's own (fulfilled, abandoned) ratio.

**Rationale**: One formula, two signal sources. Keeps spec 001's ranking function load-bearing.

## R7. Withdrawal effect on intent (FR-023) — `liveAcknowledgementCount` primitive

**Decision**: Use the cross-spec `liveAcknowledgementCount` primitive (IA § 3.10). On `grant_proposal:submit` the proposer's MCP issues a system-delegation `intent:bump_ack_count` (delta +1) to the intent owner's MCP. On `grant_proposal:withdraw` it issues a corresponding -1 decrement. The intent owner's MCP transitions `intent.status` `expressed → acknowledged` when the count rises from 0 to 1, and reverts `acknowledged → expressed` when the count returns to 0.

**Per Audit § 2 O5** — `liveAcknowledgementCount` is an MCP implementation primitive, intentionally NOT codified in T-Box. The ontology already expresses "intent has acknowledgement A" via the inverse predicates `sa:viewedIntent` / `sa:candidateIntent` / `sa:basedOnIntent`.

**Same primitive is used by spec 001's MatchInitiation lifecycle** — meaning a proposal's withdrawal correctly returns the intent to `expressed` only when there are no other live acknowledgements (e.g., a still-pending MatchInitiation from spec 001). No SPARQL `EXISTS` fan-out needed.

**Rationale**: Avoids fan-out queries; the intent owner's MCP is authoritative for "is my intent live-acknowledged."

## R8. Cloning semantics (Q3)

**Decision**: Clone produces a fresh artifact with `id`, `submittedAt`, `version=0`, `status='draft'`, `clonedFromProposal` set to the source ID. Outcomes, awards, review state, prior status do NOT carry across.

**Rationale**: The clone is a *seed*, not a continuation. Carrying state would conflate per-round review decisions.

## R9. Open-call eligibility gate (Q5)

**Decision**: `grant_proposal:submit` checks `targetRound`; if null, validates against `targetFundMandate` and refuses if the fund's `acceptsOpenCalls === false`. The fund's `sa:acceptsOpenCalls` predicate already exists from spec 002's pool extension (mirrored to GraphDB via the public agent metadata).

**Rationale**: Single SPARQL validation against the public mirror; no extra cross-store call.

## R10. Recency tie-breaking (FR-019)

**Decision**: Composite scores within `1e-6` are tied; tie-break on `round.deadline` desc (proposer side) or on `proposal.submittedAt` desc (steward side).

**Rationale**: Mirrors spec 001's tolerance and the "most recently expressed first" rule, adapted to the proposal-lane analogues.

## R11. Steward read across proposer MCPs (federation)

**Decision**: The fund's org-mcp does NOT hold copies of proposal bodies. The steward UI federates queries across each proposer's MCP using the `proposal:read_for_review` cross-delegation issued at submit time. Aggregation happens in the discovery service / web action layer (per IA P5 — no GraphDB joins across stores).

**Rationale**: P5 (no JOIN across stores). The fund's org-mcp does NOT hold copies of proposal bodies; it federates on demand. The cross-delegation is time-bound (until the proposal hits a terminal state — `withdrawn` / `awarded` / `declined`).
