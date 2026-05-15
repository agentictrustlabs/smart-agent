# Marketplace and Funding Architecture

This document maps the architecture behind intents, pools, rounds, proposals, voting, commitments, pledges, and fund transfer flows.

## Domain Lifecycle

```mermaid
flowchart LR
  intent["Intent: need or offer"]
  pool["Pool: funding source"]
  round["Round: funding cycle"]
  proposal["Proposal: application"]
  vote["Vote: credential-gated"]
  award["Award: finalized result"]
  commitment["Commitment: milestone schedule"]
  evidence["Evidence and attestation"]
  release["Tranche release"]
  outcome["Outcome and fulfillment"]

  intent --> proposal
  pool --> round
  round --> proposal
  proposal --> vote
  vote --> award
  award --> commitment
  commitment --> evidence
  evidence --> release
  release --> outcome
```

## Main Components

| Area | Web routes/actions | Backend/chain |
| --- | --- | --- |
| Intents | `apps/web/src/app/h/[hubId]/(hub)/intents` | ontology, GraphDB, MCP/domain tools |
| Pools | `apps/web/src/app/h/[hubId]/(hub)/pools` | `PoolRegistry`, org-mcp |
| Rounds | `apps/web/src/app/h/[hubId]/(hub)/rounds` | `FundRegistry`, org-mcp |
| Proposals | `apps/web/src/app/h/[hubId]/(hub)/proposals` | `ProposalRegistry`, org-mcp |
| Voting | `apps/web/src/components/voting` | `VoteRegistry`, verifier-mcp, AnonCreds |
| Pledges | `apps/web/src/app/h/[hubId]/(hub)/pledges` | `PledgeRegistry`, org-mcp |
| Commitments | `apps/web/src/lib/actions/commitments.action.ts` | commitment registry, on-chain release records |
| Treasury | `apps/web/src/app/(authenticated)/treasury` | AgentAccount treasuries, USDC, chain reads |

## Pool And Round Creation

```mermaid
sequenceDiagram
  participant User as Pool or org steward
  participant Web as apps/web
  participant A2A as a2a-agent
  participant Org as org-mcp
  participant Chain as PoolRegistry and FundRegistry
  participant Hub as hub-mcp
  participant Graph as GraphDB

  User->>Web: Create pool or round
  Web->>A2A: callMcp('org', tool)
  A2A->>Org: Authorized tool call
  Org->>Chain: Create or update registry record
  Chain-->>Org: tx result
  Org-->>A2A: Domain result
  A2A-->>Web: Result
  Web->>Hub: Schedule sync
  Hub->>Graph: Mirror public facts
```

Key files:

- `apps/web/src/app/h/[hubId]/(hub)/pools/new/PoolCreateForm.tsx`
- `apps/web/src/lib/actions/poolCreate.action.ts`
- `apps/web/src/app/h/[hubId]/(hub)/rounds/new/RoundCreateForm.tsx`
- `apps/web/src/lib/actions/roundOpen.action.ts`
- `apps/org-mcp/src/tools`

## Proposal Submission

```mermaid
sequenceDiagram
  participant Applicant as Applicant
  participant Web as ProposalComposer
  participant A2A as a2a-agent
  participant Org as org-mcp
  participant Chain as ProposalRegistry
  participant Graph as GraphDB

  Applicant->>Web: Submit proposal
  Web->>Web: Validate round, budget, intent, fields
  Web->>A2A: callMcp('org', proposal tool)
  A2A->>Org: Authorized submission
  Org->>Chain: Store public proposal facts
  Org-->>A2A: Proposal result
  A2A-->>Web: Proposal id
  Web->>Graph: Sync through hub-mcp
```

Key files:

- `apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/apply/ProposalComposer.tsx`
- `apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/apply/submit/route.ts`
- `apps/web/src/lib/actions/grantProposals.action.ts`

## Voting And Eligibility

Votes should be described as credential-gated eligible-voter actions, not steward-only actions unless the configured credential actually represents steward eligibility.

```mermaid
sequenceDiagram
  participant Voter as Eligible voter
  participant Web as ProposalVotePanel
  participant Verifier as verifier-mcp
  participant A2A as a2a-agent
  participant Org as org-mcp
  participant Chain as VoteRegistry

  Voter->>Web: Cast vote
  Web->>Verifier: Verify AnonCreds presentation
  Verifier-->>Web: Proof accepted and nullifier
  Web->>A2A: Authorized vote request
  A2A->>Org: vote:cast tool or chain helper
  Org->>Chain: Record vote by nullifier
  Chain-->>Org: tx result
  Org-->>Web: Vote result
```

Key files:

- `apps/web/src/components/voting/ProposalVotePanel.tsx`
- `apps/web/src/components/voting/StewardTallySummary.tsx`
- `apps/web/src/lib/actions/proposalVotes.action.ts`
- `apps/web/src/app/api/votes/cast/route.ts`
- `apps/verifier-mcp`

## Award, Commitment, And Release

```mermaid
flowchart TD
  tally["Vote tally"]
  finalize["Finalize awards"]
  merkle["Commit award set"]
  dispute["Dispute window"]
  commitment["Create commitment"]
  milestone["Milestone due"]
  attest["Validator attestation"]
  release["Release tranche"]
  record["Record release"]

  tally --> finalize --> merkle --> dispute --> commitment --> milestone --> attest --> release --> record
```

Key files:

- `apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/admin/RoundAdminClient.tsx`
- `apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/close/route.ts`
- `apps/web/src/lib/actions/finalizeRound.action.ts`
- `apps/web/src/lib/actions/commitments.action.ts`
- `apps/web/src/app/h/[hubId]/(hub)/proposals/[proposalId]/CommitmentTimelinePanel.tsx`
- `apps/web/src/app/h/[hubId]/(hub)/tasks/page.tsx`

## Pledge Flow

```mermaid
sequenceDiagram
  participant Donor as Donor
  participant Web as Pledge UI
  participant A2A as a2a-agent
  participant Org as org-mcp
  participant Chain as PledgeRegistry
  participant Treasury as Pool Treasury

  Donor->>Web: Create pledge
  Web->>A2A: callMcp('org', pledge tool)
  A2A->>Org: Authorized pledge call
  Org->>Chain: Record pledge terms
  Chain-->>Org: Pledge id
  Org-->>Web: Pledge result
  Donor->>Web: Honor pledge payment
  Web->>Treasury: Transfer or record external payment
  Web->>Chain: Record honor event
```

Key files:

- `apps/web/src/app/h/[hubId]/(hub)/pools/[poolId]/pledge/PledgeComposer.tsx`
- `apps/web/src/app/h/[hubId]/(hub)/pledges/[pledgeId]/PledgeHonorForm.tsx`
- `apps/web/src/app/h/[hubId]/(hub)/pledges/[pledgeId]/PledgeAmendForm.tsx`
- `apps/web/src/lib/actions/pledgeHonor.action.ts`
- `apps/web/src/lib/actions/pledgeMarkPaid.action.ts`

## Treasury State Model

Funding UI should distinguish:

```mermaid
flowchart LR
  pledged["Pledged: donor commitment"]
  honored["Honored: payment received or recorded"]
  committed["Committed: award obligation"]
  released["Released: paid to recipient"]
  available["Available: funds not committed"]

  pledged --> honored
  honored --> available
  available --> committed
  committed --> released
```

## Development Guidance

- Treat “approved proposal” and “funds moved” as separate states.
- Show names, pool labels, and org labels instead of raw addresses.
- Keep the `fundAgentId` and pool AgentAccount resolvable; unresolved operator/pool labels indicate a data integrity issue.
- Make every money-moving action reviewable before signing.
- Use GraphDB as a read projection, not as the source of truth for awards or payments.
