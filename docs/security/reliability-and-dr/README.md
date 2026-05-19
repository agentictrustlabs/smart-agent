# Reliability and DR Plans — DR1..DR7

> **Scope**: board-presentable, developer-actionable plans for the
> mid-stack failure modes that operations docs (`docs/security/operations/`)
> assume are addressed. Operations tell you HOW the team runs the
> system; these docs tell you WHAT the system has to do when something
> upstream breaks.
>
> Each doc is an implementation plan, not a survey. Each names files,
> vendors, costs, and acceptance criteria.

## Why this exists

Today the project ships:

- A working dev stack (`scripts/fresh-start.sh`) that's not designed
  for failure modes.
- A single Postgres + a single external GraphDB instance assumed at
  the production target (per Spec 007 Phase F.2 + DR3).
- A single AWS region for KMS + (eventually) RDS (per K3's "today's
  state" honesty).
- No circuit-breakers; downstream failures cascade.
- No idempotency keys; client retries can double-charge / double-pledge.

What it does NOT ship (and what these plans address):

| Gap | Plan |
|---|---|
| Postgres has no HA; failure = unavailable until manual restore | DR1 |
| Backups exist (O4) but are unverified | DR2 |
| GraphDB has no fallback path, no SLA | DR3 |
| No path from anvil dev → testnet → mainnet | DR4 |
| Single-region only; regional outage = service-wide outage | DR5 |
| External calls (KMS, GraphDB, OpenAI) have no failure isolation | DR6 |
| Mutating endpoints have no idempotency; retries cause duplicates | DR7 |

## Reading order

| # | Doc | Risk class | Effort | Status |
|---|-----|-----------|--------|--------|
| DR7 | [Idempotency Keys](./DR7-idempotency-keys.md) | Duplicate state on retry | M | Draft |
| DR6 | [Circuit Breakers](./DR6-circuit-breakers.md) | Cascading failure | S | Draft |
| DR1 | [Postgres HA](./DR1-postgres-ha.md) | Storage outage | M | Draft |
| DR2 | [Backup Verification](./DR2-backup-verification.md) | Silent backup corruption | M | Draft |
| DR3 | [GraphDB SLA](./DR3-graphdb-sla.md) | Discovery outage | M | Draft |
| DR4 | [Mainnet Transition](./DR4-mainnet-transition.md) | Chain transition foot-gun | L | Draft |
| DR5 | [Multi-Region Strategy](./DR5-multi-region-strategy.md) | Regional outage | L | Draft |

Effort tags: **S** = ≤3 days, **M** = 1 week, **L** = 2-3 weeks.

## Cross-cutting principles

1. **Substrate independence (P1)**. Postgres, KMS, GraphDB are
   substrate. Each plan ensures we can survive (or quickly migrate
   away from) any vendor or instance failure. See
   `docs/architecture/principles.md`.

2. **No silent fallbacks**. A circuit-broken external call fails
   loud; an idempotency-key collision returns the cached result
   explicitly with a `x-idempotency-replay: true` header. Mirrors
   Spec 007 north-star goal #4.

3. **Failure-mode tested**. Every plan has a chaos drill in §test-plan.
   A failure path that's never exercised is unreliable by default.

4. **Tier-aware response**. Tier 1 (auth, signing, money) gets
   millisecond-level isolation and sub-minute failover. Tier 3 (graphdb
   mirror) is allowed to be down for an hour.

## Cross-reference

- Operations: `docs/security/operations/` (O1..O11). DR1 needs O2's
  readiness probes; DR4 needs O1's deploy procedure; DR7 needs O3's
  graceful shutdown.
- Maintainability: `docs/security/maintainability/` (M1..M7).
- Runtime security: `docs/security/runtime/` (R1..R10).
- KMS outage: `docs/security/key-management/K3-break-glass-and-kms-outage.md` —
  has its own outage matrix; DR5 references it for the cross-region
  KMS multi-region key story.

## Glossary

| Term | Definition |
|---|---|
| **HA** | High Availability — multi-instance / multi-AZ; failover automatic. |
| **DR** | Disaster Recovery — survive a region or vendor outage. |
| **PITR** | Point-In-Time Recovery — restore database to a specific past timestamp. |
| **Failover** | Promote the standby instance to primary on failure of the original primary. |
| **Switchover** | Planned promotion of standby to primary (e.g. for maintenance). |
| **Split-brain** | Two instances both think they're primary. Catastrophic. Avoided by quorum-based promotion. |
| **Idempotency key** | Client-supplied UUID identifying a logical request; server returns the same result for duplicate keys. |
| **Circuit breaker** | Wrapper around a downstream call that "opens" (fast-fails) when the downstream is unhealthy, to protect both upstream resources and the downstream's recovery. |
