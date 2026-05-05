# Quickstart — Intent Marketplace (Pool Lane)

End-to-end walkthrough exercising User Stories 1–5 against the seeded demo hub.

## Setup

```bash
./scripts/fresh-start.sh
pnpm dev
```

The seed includes the **NoCo Trauma-Care Fund** (a `sa:Fund` instance — i.e., a `sa:Pool` with `sa:governanceModel "fund"`, enforced by SHACL `sa:FundGovernanceModelConsistencyShape`). It carries `sa:acceptsUnit "USD"`, accepted restrictions `kinds: ['trauma-care', 'church-planting'], geoRoots: ['us/colorado']`, and `sa:ceilingPolicy sac:CeilingPolicyAccept`. Sign in as **Maria**.

## Walkthrough

### 1. Browse pools

`http://localhost:3000/h/catalyst-noco/pools`

Expected:
- Index lists all visible pools, sourced from the GraphDB public mirror via `@smart-agent/discovery`.
- Filters: domain, governance model, geo, free-text.
- Private pools (e.g., a member-only mutual-aid fund) appear only to addressed members; private pools live entirely in their own org-mcp tenant and are surfaced via membership entitlements (no public mirror).

Apply `domain = funding`. NoCo Trauma-Care Fund appears.

### 2. View pool detail

Click the fund.

Expected:
- Mandate text rendered.
- Restrictions block lists `kinds: trauma-care, church-planting · geo: us/colorado · notForAdmin`.
- Capacity widgets: `pledged: $X · allocated: $Y · available: $Z` (cadence-aware). Public-tier aggregate read from the GraphDB mirror; private pool's aggregate read from the pool's org-mcp.
- Recent allocations: last 5 awards, anonymised per `storyPermissions`.

### 3. Submit a pledge — write path

Click **Pledge to this pool**.

Compose:
- Cadence: `monthly`
- Unit: `USD`
- Amount: `100`
- Duration: `12 months`
- Restrictions: `kinds: [trauma-care]`
- Story permissions: `shareWithSupportTeam`

Submit.

Expected sequence (per IA § 2.2):

1. **MCP write** — POST routes to Maria's person-mcp `pool_pledge:submit` tool, which writes a row to the `pool_pledges` table on Maria's MCP. Visibility derives from `pool.visibility = public` AND `storyPermissions = shareWithSupportTeam` → row visibility `public-coarse` (donor IRI omitted from public anchor; full body in Maria's MCP).
2. **Conditional on-chain anchor** — coarse `sa:PledgeAssertion` minted via `emitOnChainAssertion`. After GraphDB sync:
  ```turtle
  <urn:pl:001> a sa:PledgeAssertion ;
    sa:targetPool <noco-trauma-care> ;
    sa:pledgeAmount "100"^^xsd:decimal ;
    sa:pledgeUnit "USD" ;
    sa:pledgeCadence sac:PledgeCadenceMonthly ;
    sa:pledgeDuration "12"^^xsd:integer ;
    sa:storyPermissions sac:StoryPermissionShareWithSupportTeam ;
    sa:pledgedAt "2026-05-04T..."^^xsd:dateTime .
    # NOTE: sa:pledger OMITTED — coarse tier (donor IRI elided)
  ```
3. **Aggregate write** — Maria's MCP issues `pool:contribute_to_total` system-delegation to the pool's org-mcp (the NoCo Trauma-Care Fund's tenant), which increments `sa:pledgedTotal` by `cadenceAwareTotal = $1,200` (100 × 12).
4. **Steward read access** — Maria's MCP issues `pool:read_pledge` cross-delegation to the pool's stewards (`storyPermissions != 'anonymous'`), letting them later federate to read her full pledge body.
5. **Confirmation** — references the next step ("the fund's stewards will allocate per their mandate").

Switch the example to `storyPermissions: 'anonymous'`. Expected: **no** on-chain anchor minted (SHACL `sa:AnonymousPledgeNoAnchorShape` blocks it); **no** `pool:read_pledge` cross-delegation issued; pool's aggregate still increments via `pool:contribute_to_total`. The pool may later mint `sa:PoolPledgedTotalAssertion` (donor-less aggregate) to publish the new total to GraphDB without exposing Maria.

### 4. Amend the pledge

Open `/h/catalyst-noco/pools/pledges/<pp-001>`.

Click **Amend amount** → 150.

Expected:
- Pledge top-level `sa:pledgeAmount` becomes `150` on Maria's MCP row.
- `sa:pledgeHistory` JSON literal grows: `[{ kind: 'amount', prevValue: 100, newValue: 150, amendedAt: '...' }]`.
- Pool `sa:pledgedTotal` aggregate adjusted via re-issued `pool:contribute_to_total` (delta = +50 × 12 = +$600).

Now click **Amend cadence** → `annual` with new duration 1 year, amount 1500.

Expected:
- A second history entry is appended.
- Top-level `sa:pledgeCadence sac:PledgeCadenceAnnual`, `sa:pledgeDuration` 1, `sa:pledgeAmount` 1500.
- The cadence amendment carries `windowResetAt` per Q4.

### 5. Stop the pledge

Click **Stop**.

Expected:
- `sa:pledgeStatus sac:PledgePoolStatusStopped`.
- `sa:stoppedAt` set to now.
- Confirmation explains the Q5 rule: disbursements with `disburseAt <= stoppedAt` proceed; later disbursements cancel; allocations made before `stoppedAt` are honoured.

### 6. Auto-stop on pool closure (FR-021)

(Out-of-band: have a steward close the pool.)

Re-open "Your pledges". The donor's MCP listing tool flips affected pledges to `sac:PledgePoolStatusAutoStopped` lazily on read, with `stoppedAt` set to the pool's closure timestamp.

### 7. Ranking sanity check (User Story 4)

Re-browse pools. Pools whose stewardshipAgent is closer to Maria in the relationship graph rank higher (using the same composite formula as spec 001 — `0.6 * 1/(1+hops) + 0.4 * (fulfilled+1)/(fulfilled+abandoned+2)`). The rank cue states `proximity hops · prior outcomes`. A brand-new pool shows `no prior history yet` per Laplace smoothing.

## What this exercise covers

| Spec element | Step |
|--------------|------|
| Story 1 (browse + filter)             | 1 |
| Story 2 (pool detail)                 | 2 |
| Story 3 (pledge composer + write pipeline) | 3 |
| Story 4 (ranking)                     | 7 |
| Story 5 (manage: amend + stop)        | 4–5 |
| FR-021 (auto-stop)                    | 6 |
| Q1 (acceptedUnits gate)               | 3 (rejects non-USD attempt) |
| Q3 (ceilingPolicy default = accept)   | 3 (over-cap pledge would still succeed) |
| Q4 (amendment window semantics)       | 4 |
| Q5 (stoppedAt cut-off)                | 5 |
| Anonymous-pledge no-anchor invariant (IA § 2.2; SHACL `sa:AnonymousPledgeNoAnchorShape`) | 3 (alt path) |
| Aggregate-via-system-delegation (IA § 3.3) | 3 + 4 |
