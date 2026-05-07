# DAO voting + admin UI — feature plan

> Goal: turn "stewards bulk-sign one award list at close" into a real DAO governance loop with explicit per-proposal voting, configurable per round, plus admin surfaces for pool and round configuration.
>
> Design pattern: Allo Protocol's `Strategy` per round + OZ Governor lifecycle. Ship one strategy end-to-end (`steward-quorum`), leave room for `member-approval`, `quadratic`, `ranked-choice` to plug in later.

## 1. Standardized proposal lifecycle

```
Submitted ──► Under-Review ──► Voting (window=N days) ──► Decided ──► Funding ──► Reporting
                                       │                       │
                                       └──► Disputed (72h) ◄───┘
```

Every state transition emits an event + has a unique UI affordance per role:

| State | Proposer sees | Voter sees | Steward sees |
|-------|--------------|-----------|--------------|
| Submitted | "Edit / Withdraw" | nothing | nothing |
| Under-Review | "View / Edit till deadline" | nothing | "Flag concerns" |
| Voting | "View tally (live)" | **"Vote/approve/reject" + ballot button** | "View tally" + "Voter eligibility" |
| Decided | "Awarded ✓ / Declined" | "Final tally" | "Finalize awards" + "Open dispute window" |
| Funding | "Claim funds" + milestone status | — | "Disburse next tranche" |
| Reporting | "Submit attestation" | — | "Review attestations" |
| Disputed | "Disputed by X" | — | "Resolve dispute" |

State stored in `proposal_submissions.status` (already exists, expand enum).

## 2. Schema additions

### `org-mcp.rounds` — voting config (denormalized cache; on-chain SOR)

```sql
ALTER TABLE rounds ADD COLUMN voting_strategy TEXT NOT NULL DEFAULT 'steward-quorum'
  -- 'steward-quorum' | 'member-approval' | 'quadratic' | 'ranked-choice'
ALTER TABLE rounds ADD COLUMN voting_threshold INTEGER  -- N (e.g., 2 of M)
ALTER TABLE rounds ADD COLUMN voting_window_starts_at TEXT  -- ISO; usually = deadline
ALTER TABLE rounds ADD COLUMN voting_window_ends_at TEXT    -- ISO
ALTER TABLE rounds ADD COLUMN eligible_voters TEXT         -- JSON: { kind: 'stewards' | 'all-hub' | 'badge', badgeRef? }
```

### New table — `org-mcp.proposal_votes` (off-chain ballots; on-chain Merkle root only)

```sql
CREATE TABLE proposal_votes (
  id TEXT PRIMARY KEY,                  -- random uuid
  round_id TEXT NOT NULL,               -- URN form
  proposal_id TEXT NOT NULL,
  voter_agent_id TEXT NOT NULL,         -- person OR org agent
  vote TEXT NOT NULL,                   -- 'approve' | 'reject' | 'abstain'
  weight INTEGER NOT NULL DEFAULT 1,    -- 1 for approval; sqrt(amount) for quadratic
  rationale TEXT,                       -- optional 1-2 line reason
  cast_at TEXT NOT NULL,
  signature TEXT NOT NULL,              -- voter-signed EIP-712 of {round_id, proposal_id, vote, weight, cast_at}
  -- One vote per voter per proposal — enforced at the action layer
  UNIQUE (round_id, proposal_id, voter_agent_id)
);
CREATE INDEX idx_votes_round ON proposal_votes(round_id);
CREATE INDEX idx_votes_proposal ON proposal_votes(proposal_id);
```

### On-chain (FundRegistry) — already supports the result

`SA_ROUND_AWARDS_ROOT` + `SA_ROUND_DISPUTE_UNTIL` already exist. The vote tally produces the awards Merkle root that `setRoundAwardsRoot` commits. No new contract changes for `steward-quorum`.

For `quadratic` / `member-approval`, future Phase 2 may add on-chain vote-weight registry; deferred.

## 3. New MCP tools (org-mcp/src/tools/proposalVotes.ts)

```typescript
'vote:cast'              // POST a ballot (one per voter per proposal); enforces uniqueness, validates eligibility
'vote:list_for_round'    // steward query: all ballots for a round (for tally)
'vote:list_for_proposal' // proposer + voter query: ballots on a single proposal
'vote:tally_for_round'   // computed: per-proposal {approve, reject, abstain} counts + weight totals
'vote:eligibility'       // returns { canVote: boolean, weight: number, reason?: string } for a viewer + round
```

Auth: `vote:cast` requires the voter's delegation (the voter's own MCP issues the ballot, mirrored to the fund's MCP — same dual-write pattern as proposals). Stewards-strategy = only stewards can cast.

## 4. Strategy abstraction (web action layer)

```typescript
// apps/web/src/lib/voting/strategies/index.ts
interface VotingStrategy {
  name: 'steward-quorum' | 'member-approval' | 'quadratic' | 'ranked-choice'
  voterEligibility(viewerAgent: string, round: Round): Promise<{ canVote: boolean; weight: number }>
  decide(ballots: Ballot[], proposals: Proposal[]): { winners: Proposal[]; tally: TallyByProposal }
  uiCopy: { ballotLabel: string; tallyLabel: string; resultLabel: string }
}

const STRATEGIES: Record<string, VotingStrategy> = {
  'steward-quorum': stewardQuorumStrategy,
  // others stub for now
}
```

The action layer + UI both consume the strategy interface. Adding `member-approval` later = drop in another file; the surfaces don't change.

## 5. UI surfaces (in build order)

### 5.1 Pool admin — `/h/<hub>/pools/<poolId>/admin`

Tabs:
- **Mandate** — display current mandate hash + URI; "Update mandate" button → calls `PoolRegistry.updateMandate`
- **Stewards** — list current stewards; "Add steward" / "Remove steward" → calls `PoolRegistry.rotateStewards` (recomputes the array)
- **Capacity** — capacity ceiling, ceiling policy, accepted units/kinds — read on chain, edit via `PoolRegistry.open` or a future `updateMeta` setter
- **Discretionary disbursement** *(deferred to Phase 2.7)* — per-action cap + per-day cap

Auth: viewer must be in `pool.stewards` OR own the pool's stewardshipAgent.

### 5.2 Round admin — `/h/<hub>/rounds/<roundId>/admin`

Tabs:
- **Config** — voting strategy (dropdown), threshold (N-of-M), voting window start/end, eligible voters (kind + optional badge ref) — editable until status='under-review'
- **Lifecycle** — current state, transition buttons:
  - `Submitted → Under-Review` (close submissions early)
  - `Under-Review → Voting` (open ballots)
  - `Voting → Decided` (close round, finalize awards from tally)
  - `Cancel round` (existing, unchanged)
- **Live tally** — only when state ∈ {Voting, Decided} — per-proposal counts + winner highlighting

Auth: viewer must `canManageAgent(round.fundAgent)` (existing gate).

### 5.3 Per-proposal review/vote — `/h/<hub>/rounds/<roundId>/proposals/<proposalId>` (new individual proposal review page)

Sections:
- **Proposal body** (existing — budget, plan, milestones, basis snapshot)
- **Voter eligibility check** (calls `vote:eligibility`) — banner: "You can vote (weight=1)" or "You're not eligible (reason: …)"
- **Cast ballot** form — Approve / Reject / Abstain radio, optional rationale, "Submit ballot" → calls `vote:cast`
- **Live tally** — visible to all once ≥ 1 ballot cast; updates on each new ballot
- **Existing ballots list** (when viewer is steward or proposer) — voter agent, vote, rationale, cast_at

For multi-winner rounds (most rounds), this page handles a single proposal at a time. For ranked-choice, a separate "Submit ranked ballot" page would replace this — out of scope for v1.

### 5.4 Steward proposals overview — refactor of existing page

Replaces the bulk "Award winning proposals" form with:
- **Per-proposal vote summary cards** (count of approve/reject + visual bar)
- **Bulk vote** action — "Approve all" / "Reject all" buttons (steward shortcut for routine slates)
- **Finalize awards** button — auto-fills the close-round form from the live tally (the existing CloseRoundForm becomes a confirmation step rather than the input)

### 5.5 Proposer "my proposals" page — add live tally widgets

Each proposal card shows a small ballot tally + state badge. Already partially exists; needs the tally widget.

## 6. Sequencing — 3 sprints

### Sprint A — schema + steward-quorum end-to-end (≈1 week)

1. Schema migration: `proposal_votes` table + `voting_*` columns on rounds (drop + recreate org-mcp.db; user is OK with no migration)
2. MCP tools: `vote:cast`, `vote:list_for_round`, `vote:list_for_proposal`, `vote:tally_for_round`, `vote:eligibility`
3. Strategy module with `steward-quorum` impl
4. Per-proposal vote UI on existing steward proposals page (drop the bulk award form for now)
5. Update `roundOpen.action.ts` to write `voting_strategy='steward-quorum'`, `voting_threshold=2`, default windows

### Sprint B — admin surfaces (≈1 week)

6. Pool admin page + the three tabs
7. Round admin page + lifecycle transitions
8. Update `RoundCreateForm` to include strategy + threshold + window pickers (default to steward-quorum)

### Sprint C — finalize + funding handoff (≈1 week)

9. Refactor close-round flow to consume strategy.decide(ballots) result
10. Treasury Phase 3 prerequisites for funding stage (USDC custody scaffold, claim flow stub)
11. Playwright suite — full lifecycle E2E: open round → submit proposals → cast votes → finalize → award

## 7. Out of scope for v1

- `member-approval` / `quadratic` / `ranked-choice` strategies (deferred — ship one end-to-end first)
- On-chain vote-weight registry (only needed for non-steward strategies)
- Cross-MCP federated read for ballots (single-process dual-write to fund's MCP, same as proposals)
- Vote delegation (you can vote yourself OR delegate; v1 is direct only)
- Quadratic Sybil-resistance (would need AnonCreds badge gating)
- Vote privacy (v1 ballots are public to other voters + stewards; private ballots require commit-reveal)

## 8. DAO governance influences

| Pattern | What we lift |
|---------|--------------|
| Allo Protocol (Gitcoin) | Per-round Strategy abstraction |
| OZ Governor | Lifecycle states + clear transitions |
| MolochDAO | Sponsored proposals + rage-quit pattern (deferred) |
| Snapshot | Off-chain ballots with on-chain commitment (Merkle root) |
| Octant | Epoch-based rounds + matched funding |
| Conviction Voting | Time-weighted votes (deferred — would replace flat weight) |

## 9. Decisions to confirm before Sprint A

- **Threshold semantics**: is "2-of-3 stewards" the count of approve votes OR the count of approves minus rejects?
- **Voter set for `steward-quorum`**: just the on-chain `pool.stewards` list, OR also include `pool.stewardshipAgent` owners (delegated stewards)?
- **Voting window default**: 7 days post-deadline, or aligned with `decisionDate - 24h` to give stewards a day to finalize?
- **Tally visibility during voting**: live (every voter sees running counts) or commit-reveal (counts hidden until window closes)?
- **One vote per proposal per voter**: confirmed by the `UNIQUE` index — but stewards may want to CHANGE their vote pre-finalize. Allow update vs append-with-superseding-flag?

## 10. Risks

- **Scope creep**: easy to grow this past 3 sprints if we try to ship `quadratic` from day one. Discipline = `steward-quorum` first.
- **Cross-MCP federation**: voting requires the same dual-write the proposals path now uses. Watch for proposer-vs-voter MCP fan-out drift.
- **Vote weight in on-chain awards root**: `setRoundAwardsRoot` only commits {proposalIRI, recipient, totalAmount}. If `quadratic` produces fractional matching amounts, they get baked into `totalAmount` server-side; the on-chain commit doesn't know about weights. Document that the strategy is responsible for translating votes → final award amounts.
- **Steward review fatigue**: explicit per-proposal voting is more clicks than the bulk award form. Mitigate with the "Approve all" bulk action in 5.4.
- **Conflict between pool steward set and round eligible voters**: if a pool rotates stewards mid-round, who can vote? Decision: snapshot eligible voters at `Under-Review → Voting` transition; cache in `proposal_votes` lookups.
