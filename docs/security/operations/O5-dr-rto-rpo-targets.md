# O5 — DR RTO / RPO Targets

> **Status**: DRAFT. **No declared RTO / RPO targets today.** The
> project has no production deployment; recovery is undefined.
>
> This document declares the service tiers, their RTO and RPO targets,
> and the engineering investments those targets imply. Targets here are
> negotiated commitments — the team's promise to the business — not
> aspirations.
>
> **Effort**: M (1 week to declare + socialise; ongoing to maintain).
> **Owner**: Director of Engineering.
> **Depends on**: O4 (backups exist), O2 (readiness detects failures),
> Spec 007 Phase F.2 (Postgres HA), DR1 (Postgres failover).
> **Unblocks**: DR2 (validates RPO), DR4 (mainnet has known recovery
> path), the entire on-call rotation (O6 alert thresholds derive from
> these targets).

---

## 1. Today's state (honest)

| Tier | RTO declared | RPO declared | Tested |
|---|---|---|---|
| All | None | None | Never |

If a production incident occurred tomorrow:
- We'd recover *whenever we recover*.
- Data loss would be *however much we lost*.
- Both numbers would be discovered post-incident, not committed
  beforehand.

This is the gap O5 closes.

---

## 2. Glossary

- **RTO (Recovery Time Objective)**: maximum wall-clock time from
  incident detection to service restoration. "How long can users be
  down?"
- **RPO (Recovery Point Objective)**: maximum tolerated data loss
  expressed in wall-clock time. "How much recent data can we afford to
  lose?"
- **MTTR (Mean Time To Recovery)**: actual recovery time across past
  incidents. The expected MTTR should be ≤ ½ × RTO so the budget has
  headroom for the worst case.
- **Tier 1 / 2 / 3**: criticality classification. Tier 1 = mission
  critical; loss of service = direct user harm. Tier 2 = important;
  degraded UX but service continues. Tier 3 = nice-to-have; can be
  rebuilt from primary sources.

---

## 3. Service inventory + tier assignment

| Service | Tier | Rationale |
|---|---|---|
| `apps/a2a-agent` | **1** | Signs userOps, manages sessions, enforces policy. Down = no actions can be taken. |
| `apps/web` (auth surface) | **1** | Passkey + SIWE auth. Down = no sign-in. |
| `apps/person-mcp` | **1** | Holds session envelopes (Variant A delegations). Down = no action can be authorised even when a2a-agent is up. |
| `apps/org-mcp` | **2** | Holds org private state (members, treasuries). Down = org admin flows degraded but public reads succeed via on-chain registries. |
| `apps/family-mcp`, `geo-mcp`, `verifier-mcp`, `skill-mcp`, `people-group-mcp`, `hub-mcp` | **2** | Domain MCPs; specific features unavailable but no whole-system outage. |
| Postgres (per-MCP databases) | **1** for `a2a_agent`, `person_mcp`, `web`; **2** for the others. | Tier of the highest-tier service that depends on it. |
| AWS / GCP KMS | **1** | Every signing path. K3 documents the outage scenarios. |
| `apps/web` (read-only registry browser, public marketplace) | **2** | Read-only public surface. Down = users can't browse but can't lose money either. |
| GraphDB (`graphdb.agentkg.io`) | **3** | External read mirror. Down = degraded discovery; on-chain reads still work (Spec-004 R8 readers). See DR3. |
| Audit-checkpoint sink | **1** | If unavailable, audit-chain durability is degraded. Sprint 5 P1-5 requires sink presence at boot, so a sink outage during run will queue + spool locally (per O3 §5.2). |
| Synthetic-transaction probes (O1 §7.1) | **3** | Operational tooling; degraded visibility but no user impact. |

---

## 4. RTO / RPO targets

### 4.1 Targets

| Tier | RTO | RPO | Justification |
|---|---|---|---|
| **Tier 1** | **15 min** | **1 min** | Auth + signing surfaces. Users actively depending on the service. Money movement happens here — RPO must be tight. |
| **Tier 2** | **1 hour** | **15 min** | Registries + governance reads. Users notice but can continue working. |
| **Tier 3** | **24 hours** | **1 hour** | Mirrors, analytics. Rebuildable from primary; users may not notice. |

### 4.2 Detail

#### Tier 1: RTO 15 min / RPO 1 min

**RTO 15 min** is the wall-clock budget from PagerDuty page (detection
typically ≤2 min via O2 readiness + synthetic probes) to "users can
sign in and take actions again." Component budgets:

- 2 min: detection (readiness probe + synthetic probe + alert routing).
- 5 min: on-call acknowledgement + initial diagnosis.
- 5 min: corrective action (DNS failover, container restart, rollback).
- 3 min: validation (synthetic probes return green).

This requires:
- Multi-AZ Postgres (DR1) with auto-failover ≤2 min.
- KMS multi-region keys (K3 M1+M2) so a regional KMS outage doesn't
  require a manual failover.
- Cached registry reads (Spec-004 R8) so a transient chain RPC outage
  doesn't take Tier 1 down.
- O1's auto-rollback for bad deploys.

**RPO 1 min** is the maximum data loss for a catastrophic failure of
the primary Postgres (rare; multi-AZ failover preserves data, but a
storage corruption could force PITR restore). Component budgets:

- Postgres continuous WAL captures every commit; PITR resolution ≤5 s.
- A 1-min RPO budget covers the worst-case window between a commit and
  the next WAL flush + the time to recognise corruption and roll back.

For audit-chain rows specifically, the RPO is **0 minutes** —
Spec 007 Phase F.2 requires audit writes complete pre-HTTP-response,
and the audit-checkpoint sink (Sprint 5 P1-5) provides an external
durable witness. An audit row that returned 200 to the client survives
any database catastrophe by hashing into the next checkpoint.

#### Tier 2: RTO 1 hour / RPO 15 min

**RTO 1 hour** is enough budget for a manual recovery action with
operator review (no auto-failover required). Component budgets:

- 5 min: detection.
- 15 min: on-call assessment + decision.
- 30 min: recovery action (e.g. restore from yesterday's `pg_dump`,
  redeploy the affected MCP).
- 10 min: validation.

**RPO 15 min** matches the cadence of incremental backups (continuous
PITR, 15-min snapshot promotion). At the worst case (a corruption
detected 15 min after it happened), we lose 15 min of MCP writes.

For Tier 2 MCPs (org-mcp, family-mcp, etc.), the missing 15 min of
writes typically affect a small set of in-flight admin operations.
Users retry from the UI.

#### Tier 3: RTO 24 hours / RPO 1 hour

**RTO 24 hours** acknowledges that Tier 3 services are not on the
critical path. GraphDB mirror can be rebuilt from on-chain state +
RDF-emit replay over 6-12 hours of compute; we accept that wall-clock
budget. Analytics dashboards can be 24 hours stale without harm.

**RPO 1 hour** matches the cadence of GraphDB sync (currently runs
every few minutes via debounced ontology-sync; a 1-hour RPO covers
the case where the sync queue grew during an upstream outage).

### 4.3 What we're explicitly NOT promising

- **Sub-second RTO for any service.** We are not building an
  active-active geo-distributed system. Tier 1 services are
  multi-AZ but not multi-region active-active (DR5).
- **Zero data loss across all paths.** RPO 1 min for Tier 1 means up
  to 1 min loss; only audit-chain promises RPO 0 because it has its
  own external witness.
- **Recovery from KMS material loss.** KMS material is non-exportable
  by design. If the underlying KMS key material is destroyed, we
  cannot recover that key — we re-issue a new key and re-bind every
  user account. K3 covers the operational continuity; data
  encrypted-only-by-the-lost-key is lost.
- **Recovery from a compromised deployer key**. Deployer key
  compromise mandates a full contract redeploy + namespace migration
  (DR4). RTO 24+ hours.

---

## 5. SLOs derived from the targets

The RTO / RPO targets translate to monthly SLO budgets:

### 5.1 Availability SLO

| Tier | Target | Error budget / month |
|---|---|---|
| Tier 1 | 99.9% | 43.2 min |
| Tier 2 | 99.5% | 3.6 hr |
| Tier 3 | 99% | 7.2 hr |

Within an error budget, RTO can be consumed without escalation.
Exceeding the error budget is a P1 incident and triggers a "feature
freeze" — no new features until the budget is repaid.

### 5.2 Latency SLO

| Tier | p99 target | Probe path |
|---|---|---|
| Tier 1 — auth | 500 ms | `/api/auth/session/init` |
| Tier 1 — sign | 1500 ms | `/api/onchain-redeem` |
| Tier 2 — registry read | 500 ms | `/api/discovery/agents` |
| Tier 2 — write | 2000 ms | `/api/pool/create` |

### 5.3 Audit-chain SLO

| Metric | Target |
|---|---|
| Audit row inclusion in next checkpoint | 100% |
| Checkpoint flush latency to external sink | p99 ≤30 s |
| Checkpoint sink reachability | 99.95% per Sprint 5 P1-5 |

---

## 6. Engineering investments required

The targets above are unachievable without these investments:

| Investment | Closes | Doc |
|---|---|---|
| Multi-AZ Postgres (RDS) | Tier 1 RTO 15 min for storage outage | DR1 |
| KMS multi-region keys | Tier 1 RTO 15 min for KMS outage | K3 M1+M2 |
| `/ready` deep health checks | Detection ≤2 min | O2 |
| Graceful shutdown | No data loss on deploy / pod restart | O3 |
| Daily backups + 35-day PITR | RPO 1 min for storage corruption | O4 |
| Weekly backup verification | Confidence in restore path | DR2 |
| Auto-rollback on canary regression | Tier 1 RTO ≤2 min for bad-deploy class | O1 |
| Synthetic probes every 5 min | Detection of silent regressions | O1 §7 |
| On-call rotation + escalation | Acknowledgement ≤5 min | O6 |
| Runbooks linked to every alert | Action ≤5 min | O7 |
| Quarterly DR drill | Test the recovery path before incident day | this doc §8 |

A target without the matching investment is performative. O5 lists the
targets, but the targets only become real once O1, O2, O3, O4, O6,
O7, DR1, DR2, and K3 land.

---

## 7. Monitoring + alerting

Targets are useless without measurement.

### 7.1 What we measure

- **Availability**: 5-min rolling success rate of `/ready` (per
  service) and synthetic probes (per Tier 1 path).
- **Latency**: p50 / p95 / p99 of each instrumented route.
- **RPO drift**: the time delta between "last successful backup" and
  "now," per asset.
- **MTTR**: time from PagerDuty page → incident-resolution timestamp,
  per incident.

### 7.2 Where we measure

- Application metrics → Datadog (with Prometheus-compatible export).
- Logs → Datadog + CloudWatch.
- Synthetic probes → Datadog Synthetics or Better Uptime.
- Backup-success metric → CloudWatch + Datadog alert if no successful
  backup in 26 hours.

### 7.3 Alerts wired to targets

| Alert | Threshold | Routes to |
|---|---|---|
| Tier 1 availability <99.9% over 5 min | error budget burn rate > 14× | PagerDuty primary |
| Tier 1 p99 latency >2× target | sustained for 3 min | PagerDuty primary |
| Tier 1 synthetic-probe failure | 2 consecutive failures | PagerDuty primary |
| Tier 2 availability <99.5% over 15 min | | PagerDuty primary |
| RPO drift Tier 1 >2 min | (RPO target is 1 min — alert at 2× the budget) | PagerDuty secondary |
| RPO drift Tier 2 >30 min | (RPO target 15 min) | Slack #ops-alerts |
| No successful Postgres backup in 26 h | | PagerDuty primary |
| DR2 restore-and-verify failure | | PagerDuty primary |
| Audit-sink unreachable >5 min | | PagerDuty primary |
| KMS quota >50% | | Slack #ops-alerts |
| KMS quota >80% | | PagerDuty primary |

Each alert has a linked runbook per O7. Each runbook references the
target it protects so the on-call knows what they're defending.

---

## 8. Testing the targets (DR drills)

A target we haven't tested isn't a target — it's a wish. O5 mandates:

### 8.1 Quarterly DR drill

Documented in `docs/runbooks/dr-drill-quarterly.md`. Schedule:
mid-quarter, 4-hour window, full team participation.

**Scenarios** (rotate):

1. **Q1: Single-AZ Postgres failure**. Force RDS to failover; measure
   RTO. Target: ≤2 min for the failover itself + ≤5 min for downstream
   reconnect + warming = ≤7 min total. Within the 15-min Tier 1 budget.
2. **Q2: KMS regional outage**. Block egress to `us-east-1` KMS; force
   failover to `us-west-2` MRK replica. Target: ≤15 min total.
3. **Q3: Bad deploy**. Push a deliberately-broken canary; confirm O1
   auto-rollback fires within 60 s.
4. **Q4: Full DR — restore from backup**. Spin up a new environment
   from yesterday's backups; verify smoke tests pass. Target: ≤4 hours
   (this is well within Tier 1 RTO when measured per-tier; the wall-
   clock here covers re-provisioning a full environment).

### 8.2 Drill report

Each drill produces `output/dr-drill-YYYY-QN.md`:

- Scenario.
- Detection time.
- Acknowledgement time.
- Recovery action(s).
- Recovery time (compare to RTO target).
- Data loss (compare to RPO target).
- What worked.
- What broke.
- Action items (filed as GitHub issues with `dr-drill-action` label).

---

## 9. Files to create/change

### New

- `docs/security/operations/O5-dr-rto-rpo-targets.md` — this file.
- `docs/runbooks/dr-drill-quarterly.md` — drill template.
- `docs/runbooks/dr-drill-q1-postgres-failover.md`
- `docs/runbooks/dr-drill-q2-kms-regional-outage.md`
- `docs/runbooks/dr-drill-q3-bad-deploy.md`
- `docs/runbooks/dr-drill-q4-full-restore.md`
- `infra/datadog/dashboards/sla-overview.json` — SLO dashboard.
- `infra/datadog/monitors/tier-1-availability.yaml`
- `infra/datadog/monitors/tier-1-latency.yaml`
- `infra/datadog/monitors/rpo-drift-tier-1.yaml`
- (etc. per §7.3)

### Changed

- `docs/security/operations/README.md` — referenced from the
  cross-cutting principles.
- `docs/security/operations/O6-on-call-rotation.md` — references
  these tiers + targets to set escalation thresholds.

---

## 10. Acceptance criteria

- [ ] Every service is assigned a tier in §3.
- [ ] RTO / RPO targets are committed in this document and signed off
      by the Director of Engineering, Head of Product, and Security
      reviewer.
- [ ] SLO dashboard exists and shows the current consumption of the
      error budget per tier.
- [ ] Every alert in §7.3 is wired with the threshold listed and
      linked to a runbook (per O7).
- [ ] DR drill Q1 (Postgres failover) completes within the 15-min RTO
      target.
- [ ] DR drill Q4 (full restore) completes within the 4-hour budget.
- [ ] Drill reports filed in `output/dr-drill-YYYY-QN.md` for each
      quarter.

---

## 11. Rollback

These targets are commitments, not code. "Rollback" means walking the
target back. That requires Director of Engineering sign-off and a
written justification: "We're moving Tier 1 RTO from 15 to 30 min
because X." Such a move is communicated to the business and to users
where they have an SLA expectation.

Targets cannot be relaxed silently — every relaxation lands as a PR
to this file and is reviewed.

---

## 12. Open questions

- **OQ-O5-1**: Do we need an even tighter Tier 0 (RTO 1 min) for the
  audit-checkpoint sink? Proposed: no — the sink's RPO is the critical
  metric, not RTO. Sprint 5 P1-5 ensures audit rows queue + spool
  locally if the sink is briefly unreachable.
- **OQ-O5-2**: Tier 1 services include money-movement-adjacent flows.
  Should we declare an explicit "money-movement SLA" separately from
  the technical RTO/RPO? Proposed: yes — `docs/security/operations/
  O5-dr-rto-rpo-targets.md` covers technical recovery; legal /
  customer-facing SLA lives in a customer agreement once the company
  has customers.
- **OQ-O5-3**: Should we publish a public status page? Proposed: yes
  (Better Uptime; ~$30/mo). Surfaces Tier 1 availability + planned
  maintenance windows. Required for any B2B customer.
- **OQ-O5-4**: Error-budget enforcement teeth — what actually happens
  when a tier exceeds its budget? Proposed: any further Tier-1
  feature work is blocked at PR-review until the budget is repaid
  (M2 branch protection rule). The DoE can override with a documented
  justification.
- **OQ-O5-5**: Do we differentiate "scheduled maintenance" from
  unavailability? Proposed: scheduled maintenance counts against the
  error budget. Forces honest planning rather than pretending users
  don't experience downtime when we plan it.
