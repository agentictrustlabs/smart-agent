# Intent Marketplace — Capabilities in the Catalyst Hub

**Status:** Implementation reference for branches `001-intent-marketplace-discovery`, `002-intent-marketplace-pool`, `003-intent-marketplace-proposal`.
**Audience:** Anyone exercising the demo as Maria Gonzalez (or any catalyst hub member) and wanting to know which surfaces are wired up, what each one does, and what the seeded data lets you click.

The marketplace is **three lanes that share one ranking formula** and one matchmaking pattern. Every lane terminates at an explicit hand-off artifact (MatchInitiation / PoolPledge / GrantProposal); allocation, disbursement, and outcome reporting are downstream specs and are deliberately out of scope here.

```
        ┌──────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────────┐
        │  Direct Lane (spec 001)  │    │   Pool Lane (spec 002)   │    │ Proposal Lane (spec 003) │
        │  many givers ↔ many      │    │  many givers : 1 pool :  │    │  many proposers : 1      │
        │  receivers (peer-to-peer)│    │  many recipients         │    │  steward : many awards   │
        └────────────┬─────────────┘    └────────────┬─────────────┘    └────────────┬─────────────┘
                     │                                │                                │
                     ▼                                ▼                                ▼
           MatchInitiation (handoff)        PoolPledge (handoff)            GrantProposal (handoff)
```

Composite rank used by all three: `0.6 * 1/(1+hops) + 0.4 * (fulfilled+1)/(fulfilled+abandoned+2)` (Laplace-smoothed, in `@smart-agent/sdk/matchmaker/ranking.ts`).

---

## 1. Direct Lane — peer-to-peer need ↔ offering matching

**Where:** `/h/catalyst/intents`, `/h/catalyst/intents/[id]`, `/h/catalyst/matches`, `/h/catalyst/discover`.

### 1.1 Browse & filter intents
`/h/catalyst/intents` shows three sections:

- **Addressed to me (inbox)** — intents directly addressed at Maria's person agent.
- **My intents (outbox)** — intents Maria has expressed.
- **Hub-wide open intents** — every other open intent in the hub.

Filter pills: **Direction** (Receive / Give / All), **Scope** (hub / network), **Type**, **Priority**, **Geo**, free-text search.

### 1.2 Intent detail with ranked candidates
`/h/catalyst/intents/[id]` shows a single intent plus its **counter-intent candidates**. For a Receive-shaped intent (a need), candidates are ranked Give-shaped offerings; for a Give-shaped intent, the inverse. Ranking uses the composite formula. Candidates only render while the intent is in `expressed` or `acknowledged` state.

### 1.3 Propose a match (the spec-001 hand-off)
From the candidate list, "Propose match" mints a **MatchInitiation** — the artifact handed to the downstream commitment/engagement spec. A public mirror of the initiation is published on-chain; the body lives in the initiator's MCP. The cross-pair check (`FR-019`) disables the propose action across all candidates while any public initiation for this intent is pending.

### 1.4 My matches inbox
`/h/catalyst/matches` lists every match where Maria is the matched agent, grouped by status (`proposed` / `accepted` / `fulfilled` / `rejected` / `stale`). The **AI matcher** button on this page asks her agent to run a matching round on her behalf.

### What's seeded for Maria today
- One Receive intent: `demo-maria-need-trauma-coaching` (mandate kind: `trauma-care`).
- One Give intent placeholder for a coach.
- One self-mode MatchInitiation for Maria.
- ⚠ **There is currently no separate counter-intent seeded by another user**, so the candidate list on Maria's need will be empty unless you express a Give intent from a second demo user. To exercise live candidate ranking, sign in as Pastor David (`cat-user-002`) and express a Give intent of type `Coaching` / `trauma-care`, then return to Maria's need.

---

## 2. Pool Lane — many givers : one pool : many recipients

**Where:** `/h/catalyst/pools`, `/h/catalyst/pools/[poolId]`, `/h/catalyst/pools/[poolId]/pledge`, `/h/catalyst/pledges`.

### 2.1 Browse active pools
`/h/catalyst/pools` lists pools available to the hub: giving funds, coaching networks, prayer chains, skills benches, hospitality networks. Each pool is a first-class agent in the trust graph. Pools may be **public** (anyone in the hub can browse) or **private** (only addressed members see them).

### 2.2 Pool detail
`/h/catalyst/pools/[poolId]` shows mandate kinds, restrictions (geo / kind / not-for-admin), current capacity, and recent allocations.

### 2.3 Pledge into a pool (the spec-002 hand-off)
`/h/catalyst/pools/[poolId]/pledge` — pledge with optional restrictions (kind / geo / not-for-admin), cadence (one-time / monthly / annual), and `storyPermissions` (public attribution vs anonymous). The committed pledge becomes a **PoolPledge** artifact handed to downstream allocation/disbursement specs. v1 only allows the donor to pledge for themselves (no connector-style pledging on someone else's behalf).

### 2.4 Manage pledges
`/h/catalyst/pledges` lists Maria's own pledges; `/h/catalyst/pledges/[pledgeId]` shows a single pledge's detail.

### What's seeded for Maria today
- One pool: `demo-trauma-care-pool` operated by Catalyst NoCo Network.
- One pledge: `demo-maria-trauma-care-pledge` (12 × $100 monthly, totaling $1200; visible in the pool's recent-allocations rollup).

---

## 3. Proposal Lane — many proposers : one steward (round) : many awards

**Where:** `/h/catalyst/rounds`, `/h/catalyst/rounds/[roundId]`, `/h/catalyst/rounds/[roundId]/apply`, `/h/catalyst/proposals`.

### 3.1 Browse open rounds
`/h/catalyst/rounds` lists open grant rounds eligible for Maria's intents. Rounds have a mandate (kind + geo), a budget envelope (ceiling + expected awards + tranche template), a milestone template, validator requirements, reporting cadence, and a schedule (submission deadline + decision date).

### 3.2 Round detail
`/h/catalyst/rounds/[roundId]` shows full eligibility / budget / milestones / reporting / schedule blocks plus a "Draft a proposal" CTA. Stewards can also reach the per-round proposal review surface via `/h/catalyst/rounds/[roundId]/proposals` (steward sub-route).

### 3.3 Draft & submit a Proposal (the spec-003 hand-off)
`/h/catalyst/rounds/[roundId]/apply` is a multi-section composer that produces a **GrantProposal** artifact. Drafts persist privately in the proposer's MCP; submitted proposals trigger the steward review surface but the body remains private until the round closes.

### 3.4 Manage proposals
`/h/catalyst/proposals` lists Maria's drafts and submitted proposals; `/h/catalyst/proposals/[proposalId]` shows a single proposal's detail.

### What's seeded for Maria today
- One round: `demo-trauma-care-q2` (mandate: `trauma-care`, ceiling: $250k, 6 expected awards, quarterly reporting).
- Two GrantProposals for Maria — one **draft**, one **submitted**.

---

## 4. Discover — aggregate landing surface

**Where:** `/h/catalyst/discover`.

The Discover page composes pieces of all three lanes for the signed-in viewer:

- Hub headline counts.
- **Top open needs** (priority-sorted, top 5 — direct-lane projection).
- **My proposed matches** (proposed matches assigned to my agent — direct-lane outcome).
- **Match candidate previews** for the viewer's expressed intents (direct-lane spec-001 ranking — top 2 per intent, up to 4 intents).
- **Open grant rounds** mandate-matched against the viewer's intents (proposal-lane spec-003).
- **Open pools** (pool-lane spec-002).
- CTAs out to `/needs`, `/offerings`, `/rounds`.

---

## 5. Persistence pattern (constant across all three lanes)

Every artifact follows the same write path:

```
Owner's MCP (private body) ──→ on-chain assertion (public mirror, conditional)
                                        │
                                        ▼
                          GraphDB mirror (via on-chain → KB sync)
```

The MCP→GraphDB pipe is **forbidden** (Information-Architecture P4). GraphDB only ever holds an instance of a public assertion class if a public on-chain assertion published it first. SHACL shapes (`docs/ontology/tbox/shacl/visibility.ttl`) cascade visibility rules — for example, anonymous pledges have no on-chain anchor; submitted-but-unawarded GrantProposals stay private.

Cross-spec invariants:

- **`liveAcknowledgementCount`** primitive on intents (FR-023) — coordinates intent state across MCPs via system-delegation increments. Intentionally NOT codified in T-Box (Audit § 2 O5).
- All three lanes reuse the composite ranking formula in `@smart-agent/sdk/matchmaker/ranking.ts`; only the side-specific signal computation differs.

---

## 6. Why Maria might see "nothing matching" today

The seed in `CATALYST_SEED_MODE=minimal` provisions only **Maria + Pastor David + Catalyst NoCo Network + Fort Collins Network + Catalyst Hub**. Every lane's *own* artifacts are seeded, but **direct-lane counter-intents are not** — there is no second demo user expressing a Give intent of type `Coaching/trauma-care` for Maria's need to match against. To exercise live ranking:

1. Sign out of Maria.
2. Sign in as Pastor David (`cat-user-002`).
3. Express a Give intent (object: `resourceType:Coaching`, mandate: `trauma-care`).
4. Sign back in as Maria.
5. Open `/h/catalyst/intents/demo-maria-need-trauma-coaching` — David's offering should now appear in the candidates section, ranked by the composite formula (with David at hops=1 from Maria via the network/hub edges seeded by the minimal seed, so `proximityScore = 0.5`; outcomeScore is `0.5` for any new agent, so the composite is `0.6*0.5 + 0.4*0.5 = 0.5`).

If we want the demo to show a live match without that two-step, the next seed change is to extend `seed-test-match-initiation.ts` (or add a sibling `seed-test-counter-offering.ts`) so a give-shape intent for Coaching/trauma-care is published from David at boot time. That would land Maria on her need and immediately see at least one ranked candidate.

---

## 7. Quick reference — every shipped page

| Path | Lane | Purpose |
|---|---|---|
| `/h/catalyst/discover` | All | Aggregate landing (needs / matches / rounds / pools / candidates) |
| `/h/catalyst/home` | — | Hub home / nav |
| `/h/catalyst/intents` | Direct | Inbox / outbox / hub-open |
| `/h/catalyst/intents/new` | Direct | Express a new intent |
| `/h/catalyst/intents/[id]` | Direct | Detail + ranked candidates |
| `/h/catalyst/matches` | Direct | My matches grouped by status |
| `/h/catalyst/matches/[id]` | Direct | Single match detail |
| `/h/catalyst/needs` | Direct (legacy) | Hub needs index |
| `/h/catalyst/needs/[id]` | Direct (legacy) | Single need + matching |
| `/h/catalyst/offerings` | Direct | Mine vs hub offerings |
| `/h/catalyst/pools` | Pool | Active pools index |
| `/h/catalyst/pools/[poolId]` | Pool | Pool detail |
| `/h/catalyst/pools/[poolId]/pledge` | Pool | Pledge composer (PoolPledge hand-off) |
| `/h/catalyst/pledges` | Pool | My pledges list |
| `/h/catalyst/pledges/[pledgeId]` | Pool | Single pledge detail |
| `/h/catalyst/rounds` | Proposal | Open rounds index |
| `/h/catalyst/rounds/[roundId]` | Proposal | Round detail |
| `/h/catalyst/rounds/[roundId]/apply` | Proposal | Proposal composer (GrantProposal hand-off) |
| `/h/catalyst/rounds/[roundId]/proposals` | Proposal | Steward review surface |
| `/h/catalyst/proposals` | Proposal | My proposals list |
| `/h/catalyst/proposals/[proposalId]` | Proposal | Single proposal detail |
| `/h/catalyst/entitlements` | — | Entitlement registry |

---

## 8. Source material

- `docs/specs/generalized-intent-matchmaking.md` — the universal BDI loop the three lanes specialize.
- `docs/specs/faith-funding-and-stewardship.md` — Lane 1 / 2 / 3 narrative.
- `specs/001-intent-marketplace-discovery/spec.md` — Direct lane spec.
- `specs/002-intent-marketplace-pool/spec.md` — Pool lane spec.
- `specs/003-intent-marketplace-proposal/spec.md` — Proposal lane spec.
- `docs/information-architecture/10-intent-marketplace-classification.md` — canonical persistence rules per artifact.
- `docs/ontology/INTENT_MARKETPLACE_AUDIT.md` — T-Box codification (incl. ProposalSubmission → GrantProposal rename, `Pool subClassOf OrganizationAgent`, `Fund subClassOf Pool`).
- `docs/ontology/tbox/shacl/visibility.ttl` — SHACL visibility cascade.
