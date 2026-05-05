# Phase 1 — Data Model: Intent Marketplace (Proposal Lane)

## Entities

### Round (new — thin first-class entity)

T-Box: `sa:Round subClassOf prov:Plan, p-plan:Plan` (Audit § 1.1). Body lives in the **fund's org-mcp tenant** (`org_principal = fundAgentId`); public on-chain anchor via `sa:RoundOpenedAssertion` / `sa:RoundClosedAssertion`.

| Field | Type | T-Box predicate | Notes |
|-------|------|-----------------|-------|
| `id` | IRI | (row IRI) | stable identifier |
| `fundAgentId` | IRI | `sa:operatedByFund` (functional) | the fund (typed `sa:Fund` — a `sa:Pool` with `governanceModel: 'fund'`) operating this round |
| `mandate` | object | `sa:roundMandate` (JSON literal) | `{ acceptedKinds: string[]; acceptedGeo: string[]; budgetCeiling: number; expectedAwards: number }` |
| `milestoneTemplate` | object | `sa:milestoneTemplate` (JSON literal) | structure of expected milestones (count bounds, tranche-percentage hints) |
| `validatorRequirements` | object | `sa:validatorRequirements` (JSON literal) | who can validate outcomes (kind/credential filters) |
| `reportingCadence` | enum | `sa:reportingCadence` (range `sa:ReportingCadence`) | `'quarterly' \| 'milestone' \| 'annual' \| 'none'` |
| `deadline` | xsd:dateTime | `sa:deadline` | submission cut-off |
| `decisionDate` | xsd:dateTime | `sa:decisionDate` | when stewards expect to decide |
| `requiredCredentials` | string[] | `sa:requiredCredentials` (multi-valued) | AnonCreds credential kinds required for submission |
| `visibility` | `'public' \| 'private'` | `sa:visibility` | privacy gate |
| `addressedApplicants` | IRI[] | `sa:addressedApplicants` (multi-valued) | private rounds only; **never appears in the on-chain assertion** (coarse anchor only); lives in fund's org-mcp |
| `proposalsReceived` | integer | `sa:proposalsReceived` | derived counter; on fund's org-mcp; bumped via `round:increment_proposals_received` system-delegation when proposers submit |
| `onChainAssertionId` | IRI | `sa:onChainAssertionId` | set on creation (always — public or coarse) |

This feature mutates `proposalsReceived` on submit/withdraw. Round authoring (creating new rounds) is **out of scope** — handled by separate fund-admin specs; this feature reads pre-seeded rounds.

---

### Fund (existing — slight extension; typed `sa:Fund subClassOf sa:Pool`)

| Field | Type | T-Box predicate | Notes |
|-------|------|-----------------|-------|
| `…` | … | (existing, see spec 002) | from spec 002's Pool/Fund entity (Fund is now a typed subclass of Pool — Audit § 4 F2) |
| `acceptsOpenCalls` | boolean | `sa:acceptsOpenCalls` | governs Q5 |

---

### GrantProposal (new — persisted in proposer's MCP; class renamed from `ProposalSubmission` per Audit § 2 O1)

The terminal artifact of this spec; consumed by the downstream review/award spec.

**Persistence model** (per IA § 2.3):
- **Body**: row in proposer's MCP `proposal_submissions` table — almost always `apps/org-mcp/src/db/schema.ts`; `apps/person-mcp/src/db/schema.ts` for solo human applicants. Owner-routed by `principal` = `proposerAgentId`.
- **No on-chain anchor in v1.** SHACL `sa:GrantProposalAlwaysPrivateShape` enforces.
- **No GraphDB mirror in v1.** No `sa:GrantProposal` IRI ever appears in GraphDB.
- **Steward read access**: via `proposal:read_for_review` cross-delegation issued by the proposer at submit time (scope: one round, or one fund-mandate for open calls). Time-bound — readable until the proposal hits a terminal state (`withdrawn` / `awarded` / `declined`).

**TS field → T-Box predicate mapping** (Audit § 3): TS keeps JS conventions; T-Box is bare:

| TS field | T-Box predicate |
|----------|-----------------|
| `proposerAgentId` | `sa:proposer` (functional, subPropertyOf `prov:wasAssociatedWith`) |
| `roundId` | `sa:targetRound` (functional, mutually exclusive with `sa:fundMandate`) |
| `fundMandateId` | `sa:fundMandate` (functional, range `sa:Fund` — no separate Mandate entity) |
| `basedOnIntentId` | `sa:basedOnIntent` |
| `budget` / `plan` / `milestones` / `desiredOutcomes` / `reportingObligations` / `organisationalBackground` | `sa:budget` / `sa:plan` / `sa:milestones` / `sa:desiredOutcomes` / `sa:reportingObligations` / `sa:organisationalBackground` (all xsd:string JSON literals) |
| `submittedAt` | `sa:proposalSubmittedAt` (subPropertyOf `prov:generatedAtTime`) |
| `version` | `sa:version` |
| `lastEditedAt` | `sa:lastEditedAt` |
| `status` | `sa:proposalStatus` (range `sa:GrantProposalStatus`) |
| `withdrawnAt` | `sa:withdrawnAt` |
| `clonedFromProposalId` | `sa:clonedFromProposal` |
| `basis` | `sa:basis` (xsd:string JSON literal — same as spec 001) |

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | IRI | yes | stable identifier |
| `proposerAgentId` | IRI | yes | must equal submitter (FR-027, no connector); equals row's MCP `principal` |
| `roundId` | IRI? | conditional | the target round, or null for open-call |
| `fundMandateId` | IRI? | conditional | required when `roundId === null`; resolves directly to a `sa:Fund` |
| `basedOnIntentId` | IRI | yes | the underlying NeedIntent |
| `budget` | object | yes | `{ lineItems: [{ name, amount, unit, justification }], total }` |
| `plan` | object | yes | `{ narrative, planArtifactRef? }` |
| `milestones` | array | yes | `[{ name, dueDate, evidenceRequired, trancheAmount }]` |
| `desiredOutcomes` | array | yes | `[{ statement, measurable, validators: IRI[] }]` |
| `reportingObligations` | object | yes | `{ cadence, format }` |
| `organisationalBackground` | object | yes | narrative + optional priorTrackRecord refs |
| `submittedAt` | xsd:dateTime | yes | |
| `version` | integer | yes | starts 0 on submission; increments on each pre-deadline edit |
| `lastEditedAt` | xsd:dateTime | yes | |
| `status` | `'draft' \| 'submitted' \| 'withdrawn' \| 'awarded' \| 'declined'` | yes | C-Box `sa:GrantProposalStatus`; discovery sets `draft`/`submitted`/`withdrawn`; downstream sets `awarded`/`declined` |
| `withdrawnAt` | xsd:dateTime? | conditional | set when status moves to `withdrawn` |
| `clonedFromProposalId` | IRI? | conditional | set if cloned (Q3) |
| `basis` | RankBasis | yes | snapshot at submission time |

#### Lifecycle

```
draft ──→ submitted ─┬─→ withdrawn   (proposer action)
                     ├─→ awarded     (downstream review/award)
                     └─→ declined    (downstream review/award)
```

This spec writes `draft`, `submitted`, `withdrawn`. `awarded`/`declined` are set downstream and exposed read-only in "your proposals".

#### Validation rules

- Exactly one of `roundId`/`fundMandateId` set (Q3 — one Proposal references one Round, or one fund for open-call).
- For `roundId !== null`: required fields per `round.milestoneTemplate` and `round.validatorRequirements`; budget total `<= round.mandate.budgetCeiling`; viewer holds all `round.requiredCredentials`.
- For `roundId === null` (open-call): `fund.acceptsOpenCalls === true`; eligibility checked against `fund.mandate` directly.
- For private rounds: submitter ∈ `round.addressedApplicants`.
- Pre-deadline edits allowed when `now <= round.deadline`; else read-only here.
- Withdrawal allowed at any time post-submission and pre-decision.
- `basedOnIntentId` must reference an existing intent the proposer expressed (or has stewardship of).
- **Always** `onChainAssertionId === null` (SHACL `sa:GrantProposalAlwaysPrivateShape`).

#### Side effects on submission

- `round.proposalsReceived` increments — proposer's MCP issues `round:increment_proposals_received` system-delegation to the fund's org-mcp.
- **`liveAcknowledgementCount` primitive** (IA § 3.10) — proposer's MCP issues `intent:bump_ack_count` (delta +1) system-delegation to the intent owner's MCP. The intent owner's MCP transitions `intent.status: 'expressed' → 'acknowledged'` when the count rises from 0 to 1.
- `basis` snapshot captured from `proposerSideSignals(proposer, round)`.
- Proposer issues `proposal:read_for_review` cross-delegation to the round's stewards (= the fund's pool-agent's org-mcp tenant).

#### Side effects on withdrawal (FR-023)

- `round.proposalsReceived` decrements — proposer's MCP issues a counter-decrement system-delegation to the fund's org-mcp.
- **`liveAcknowledgementCount` primitive** — proposer's MCP issues `intent:bump_ack_count` (delta -1) to the intent owner's MCP. The intent owner's MCP reverts `intent.status: 'acknowledged' → 'expressed'` only when the count returns to 0 — meaning if a still-pending spec 001 `MatchInitiation` exists on the same intent, the intent stays `acknowledged`.

#### Side effects on clone (Q3)

- New `GrantProposal` with `id` fresh, `version=0`, `status='draft'`, `submittedAt` unset, `clonedFromProposalId` set.
- All non-state fields copied; outcomes / awards / review state NOT copied.

---

## Relationships

```
GrantProposal.proposer ──→ Agent                    (sa:proposer; functional)
GrantProposal.targetRound ──→ Round                 (sa:targetRound; functional, mutually exclusive with sa:fundMandate)
GrantProposal.fundMandate ──→ Fund                  (sa:fundMandate; functional, range sa:Fund — directly references the Fund, no separate Mandate entity per Audit § 6)
GrantProposal.basedOnIntent ──→ Intent              (sa:basedOnIntent; range saint:Intent)
GrantProposal.clonedFromProposal ──→ GrantProposal  (sa:clonedFromProposal)
Round.operatedByFund ──→ Fund                       (sa:operatedByFund; functional, range sa:Fund)
Fund a sa:Fund                                      (subClassOf sa:Pool — established by spec 002)
Pool.acceptsOpenCalls : boolean                     (sa:acceptsOpenCalls)
Agent ──sa:relatesTo+──→ Agent                      (used for both ranking sides)
```

## Storage

- **Round body**: `rounds` table in fund's org-mcp tenant.
- **GrantProposal body**: `proposal_submissions` table in proposer's MCP (org-mcp for org proposers; person-mcp for solo human applicants).
- **On-chain assertions** (rounds only): `sa:RoundOpenedAssertion`, `sa:RoundClosedAssertion`. Helper at `apps/web/src/lib/onchain/roundAssertion.ts` (NEW).
- **No on-chain assertion for GrantProposal** in v1; SHACL backstop.
- **GraphDB mirror**: rounds only, populated by on-chain → GraphDB sync. Discovery reads via `packages/discovery` `listRounds(...)`.
- **T-Box**: `docs/ontology/tbox/proposal.ttl` (new — Audit § 1.1), `docs/ontology/cbox/controlled-vocabularies.ttl` (extended with `sa:GrantProposalStatus`, `sa:ReportingCadence` SKOS schemes).
- **SHACL**: `docs/ontology/tbox/shacl/visibility.ttl` — `sa:GrantProposalAlwaysPrivateShape`.

## `liveAcknowledgementCount` cross-spec invariant (IA § 3.10)

The integer `liveAcknowledgementCount` lives on the existing `intents` table in person-mcp and org-mcp. It is **NOT codified in T-Box** (Audit § 2 O5) — implementation-only primitive. It is the same column spec 001's `MatchInitiation` uses; this spec adds **one more acknowledger surface** to the increment/decrement protocol:

| Event | Issued by | Recipient | Delta |
|-------|-----------|-----------|-------|
| spec 001 `MatchInitiation.create` | initiator's MCP | each of the two intent owners' MCPs | +1 each |
| spec 001 `MatchInitiation.withdraw` / `supersede` / `consume` | initiator's MCP | each of the two intent owners' MCPs | -1 each |
| spec 003 `GrantProposal.submit` | proposer's MCP | the basedOnIntent's owner's MCP | +1 |
| spec 003 `GrantProposal.withdraw` | proposer's MCP | same | -1 |

The owning MCP transitions `intent.status: 'expressed' ⇄ 'acknowledged'` on the 0↔1 boundary of its own row's count.

## Hot-path queries

1. `listRounds(hubId, viewerAgentId, filters, viewerIntents)` — paginated; reads public mirror; mandate-match badging joins viewer's intents to round mandates.
2. `getRoundDetail(roundId, viewerAgentId)` — public-tier reads from public mirror; private-round addressee-list from fund's org-mcp.
3. `grant_proposal:submit` (proposer's MCP) — validates against round/fund constraints; persists body locally; issues the three system-delegations (`round:increment_proposals_received` to fund's org-mcp; `intent:bump_ack_count` +1 to intent owner's MCP; `proposal:read_for_review` cross-delegation to fund's stewards).
4. `grant_proposal:edit_pre_deadline` (proposer's MCP) — bumps `version`; pre-deadline only.
5. `grant_proposal:withdraw` (proposer's MCP) — transitions status; issues counter-decrement + ack-count-decrement system-delegations.
6. `grant_proposal:clone` (proposer's MCP) — duplicates non-state fields into a fresh draft.
7. `grant_proposal:read_self` (proposer's MCP) — owner-only.
8. `grant_proposal:list_for_round` (steward UI; fund's org-mcp federates across proposer MCPs via `proposal:read_for_review`).
9. (Reads of `fund.acceptsOpenCalls` come from the public agent metadata in GraphDB — no extra cross-store call.)
