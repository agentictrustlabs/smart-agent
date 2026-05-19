# DR5 — Multi-Region Strategy

> **Status**: DRAFT. **Today everything is single-region.** Spec 007
> Phase F.2 + DR1 specify Aurora multi-AZ (within `us-east-1`); K3
> documents the single-region KMS posture. A regional outage today
> (real but rare: AWS us-east-1 has had multi-hour events) would take
> Smart Agent dark.
>
> This document specifies the multi-region architecture for v1 and v2,
> the cost / availability trade-offs, and the staged rollout that gets
> us there without over-investing too early.
>
> **Effort**: L (3-4 weeks for the v2 active-passive build; v1 stays
> single-region).
> **Owner**: Director of Engineering + Infra lead.
> **Depends on**: DR1 (multi-AZ inside a region first), K3 M1+M2 (KMS
> multi-region keys), O5 (RTO targets justify the investment), Spec
> 007 Phase H (Terraform manages regional deploys).
> **Unblocks**: meaningful SLA-class availability commitments;
> survival of an AWS regional outage.

---

## 1. Today's state (honest)

| Layer | Today |
|---|---|
| AWS region | `us-east-1` (every service, KMS, RDS, S3 backup primary) |
| GCP region | `us-east1` (KMS only, if used) |
| Vercel | edge multi-region (good news; not under our control) |
| Postgres | DR1 specifies multi-AZ within us-east-1 |
| Backup storage | S3 in us-west-2 (cross-region replica per O4 §5) |
| Failover capability | Within-AZ only |

If us-east-1 goes dark for 4 hours (similar to AWS us-east-1's actual
historical events):
- All Smart Agent services dark.
- Recovery happens when us-east-1 recovers.
- Tier 1 SLA breach significant; possibly customer-contract material.

This is the gap DR5 closes.

---

## 2. Goals

1. **v1 (initial production launch)**: single-region active.
   Acknowledged risk; documented limitation. Tier 1 RTO 15 min applies
   to within-region failures only.
2. **v2 (6 months post-launch, with paying customers)**: active-passive
   in a second region (`us-west-2`). Failover automated to a manual
   trigger; recovery to passive ≤30 min total RTO including DNS.
3. **v3 (future, customer-demand-driven)**: active-active across two
   regions if and only if customer pressure or regulatory pressure
   demands.

This document specifies v1 and v2; v3 is on the roadmap.

---

## 3. Architecture decision space

### 3.1 Active-active vs active-passive vs active-standby

| Mode | Description | Pros | Cons |
|---|---|---|---|
| **Active-active** | Both regions serve all traffic; data syncs continuously. | Near-zero RTO; load distribution. | Hard for consistency-sensitive workloads (auth + signing); double cost; complex routing; split-brain risk. |
| **Active-passive (warm)** | Region A serves all traffic; Region B has fully-provisioned standby (DB read replica, services running, just not routed). | Fast failover (~5-15 min for DNS + warm-up); standby is ready. | ~80% double cost; manual trigger commonly required. |
| **Active-standby (cold)** | Region A serves all traffic; Region B has only backup data, no running services. | Cheap. | RTO is hours (build region from scratch). |
| **Pilot-light** | Region B has data replicating + minimal infra; can scale up on demand. | Cheap; RTO ~1 hour. | Requires infra-as-code maturity. |

### 3.2 v1 decision

**Single region (us-east-1) for v1.** Rationale:

- No paying customers yet means SLA expectations are bounded.
- Multi-region adds significant operational complexity AND cost
  before validating any customer demand.
- K3 M1+M2 will land KMS multi-region keys early, so a regional KMS
  outage doesn't compound a regional RDS outage.
- Backups are already cross-region (O4 §5) so a Region A loss
  isn't a data loss.

Documented limitation: v1 Tier 1 SLA of 99.9% measured within-region
only. Regional outages excluded from SLA — communicated to customers
as an explicit caveat.

### 3.3 v2 decision

**Pilot-light → warm-standby in us-west-2.** Rationale:

- Pilot-light initial: cheap. Aurora cross-region read replica in
  us-west-2; S3 backups cross-replicated (already done); KMS
  multi-region keys (K3 M1+M2); Terraform per-region modules ready.
- Warm-standby later: when a paying customer requires the lower
  RTO, scale up the pilot-light. Services pre-provisioned in
  us-west-2 at minReplicas; DNS routing ready.

Failover: manual trigger via `pnpm dr:failover --to=us-west-2`.
Documented in `docs/runbooks/regional-failover.md`. Expected RTO:
30 min (10 min decision + 5 min DNS + 15 min warm-up + verify).

### 3.4 v3 decision (future)

**Active-active for read paths only, if needed.** Tier 1 signing must
remain in one region (per the SessionGrant ceremony — splitting
signing across regions invites split-brain on session state).
Read paths (registry browsing, public marketplace) can fan out across
regions naturally because they're read-only.

v3 not in scope for this document; placeholder for the roadmap.

---

## 4. v1 architecture (today's target)

```
                 ┌──────────────────────────┐
                 │  AWS us-east-1           │
                 │                          │
                 │  ┌────────┐  ┌────────┐  │
                 │  │  EKS   │  │ Aurora │  │
                 │  │ a2a +  │  │ multi  │  │
                 │  │ MCPs   │  │  AZ    │  │
                 │  └────────┘  └────────┘  │
                 │      │            │      │
                 │      ▼            ▼      │
                 │  ┌────────┐  ┌────────┐  │
                 │  │  KMS   │  │  S3    │  │
                 │  │ MR-key │  │ backup │  │
                 │  └────────┘  └────────┘  │
                 └──────────┬───────────────┘
                            │ S3 CRR
                            ▼
                 ┌──────────────────────────┐
                 │  AWS us-west-2           │
                 │  S3 backup replica       │
                 │  (DR-region storage only)│
                 └──────────────────────────┘
```

Vercel edge handles `apps/web` globally. KMS multi-region key replicas
exist in `us-west-2` (per K3 M1+M2 once delivered) — same EVM
addresses — but no services run there yet.

---

## 5. v2 architecture (warm-standby, 6 months post-launch)

```
                 ┌──────────────────────────┐
   USERS         │  AWS us-east-1 (active)  │
   │             │                          │
   │ Route 53    │  ┌────────┐  ┌────────┐  │
   │ Health      │  │  EKS   │  │ Aurora │  │
   │ Check       │  │ a2a +  │  │ Primary│  │
   │ +           │  │ MCPs   │  │        │  │
   │ Failover    │  └────────┘  └────────┘  │
   │ Routing     │                          │
   ▼             └────┬──────────────┬──────┘
   Route 53           │              │
    ├── us-east-1 ←───┘              │ Aurora Global
    │   primary                      │ DB cross-region
    │   (weight 100)                 ▼ replication
    └── us-west-2 ────────────►┌──────────────────────────┐
        secondary              │  AWS us-west-2 (standby) │
        (weight 0,             │                          │
         flipped on            │  ┌────────┐  ┌────────┐  │
         failover)             │  │  EKS   │  │ Aurora │  │
                               │  │ a2a +  │  │ Read-  │  │
                               │  │ MCPs   │  │ replica│  │
                               │  │ at min │  │        │  │
                               │  │replicas│  │        │  │
                               │  └────────┘  └────────┘  │
                               └──────────────────────────┘
```

### 5.1 Data replication

- **Aurora Global Database**: cross-region asynchronous replication.
  RPO typically <1 s; designed for cross-region DR.
- **S3**: cross-region replication already in O4.
- **KMS**: multi-region keys (K3 M1+M2). The bundlerSigner +
  master-signer addresses are identical across regions.
- **Askar vaults**: replicated via S3 backup files (we don't have
  online Askar replication; we have backup-based recovery only).

### 5.2 Failover sequence (v2 manual)

```
T+0   Operator confirms us-east-1 is down (multi-AZ failure within
      region OR regional event)
T+5   Operator opens war room; declares incident
T+10  Operator runs `pnpm dr:failover --to=us-west-2`
      - Promotes Aurora us-west-2 read replica to primary (1-2 min).
      - Scales EKS services in us-west-2 from minReplicas to running.
      - Updates Secrets Manager in us-west-2 with primary DB endpoint.
T+15  Services in us-west-2 pass /ready
T+20  DNS failover (Route 53 health check detects us-east-1 down;
      shifts traffic to us-west-2)
T+30  Most user traffic flowing to us-west-2; Tier 1 paths fully
      functional. Incident continues but service is recovered.
```

Some user data written to us-east-1 in the last 1-5 seconds before
the outage is replicated to us-west-2 via Aurora Global; RPO is
typically ≤1 s but could be up to ~5 s in degraded replication
conditions.

### 5.3 Failback

When us-east-1 recovers:

1. Verify us-east-1 data is consistent (Aurora rebuilds the replica
   in the recovered region).
2. Schedule a low-traffic window.
3. Switch back via the same `dr:failover --to=us-east-1` command.

Failback is a deliberate operation, NOT automatic. We don't want
flapping.

---

## 6. v2 — what we provision now, what later

### 6.1 Provision now (v1, before v2 launch)

Pilot-light foundations:
- Aurora Global Database with us-west-2 replica.
- KMS multi-region keys per K3 M1+M2.
- Route 53 health checks + failover routing rule (deployed but pinned
  to us-east-1 with weight 100).
- S3 cross-region replication (already in O4).
- Terraform modules per-region; we apply only us-east-1 modules
  initially but the code can apply us-west-2.

### 6.2 Provision at v2 launch

- EKS cluster in us-west-2.
- Deploy services at `minReplicas` (per O8).
- Secrets Manager in us-west-2 populated.
- Per-region environment configs in Vercel.

### 6.3 Operational additions for v2

- `docs/runbooks/regional-failover.md`.
- Quarterly DR drill: simulated regional outage; manual failover
  drill.
- Datadog cross-region cost dashboard.

---

## 7. Cost projection

| Item | v1 (single-region) | v2 (warm-standby) |
|---|---|---|
| Aurora primary | $212/mo | $212/mo |
| Aurora standby (within region) | $212/mo | $212/mo |
| Aurora read replica (within region) | $212/mo | $212/mo |
| Aurora cross-region replica (us-west-2) | — | $212/mo |
| EKS us-east-1 (4 c5.large) | $260/mo | $260/mo |
| EKS us-west-2 (4 c5.large at minReplicas) | — | $260/mo |
| Cross-region data transfer (estimate 100 GB/mo replication) | — | $2/mo |
| KMS multi-region keys (per K3) | $1/key/mo × 5 keys = $5/mo | same |
| Route 53 hosted zone | $0.50/mo | $0.50/mo |
| Route 53 health checks (us-east-1 + us-west-2) | — | $1/mo |

Total: v1 ~$1,000/mo for Tier-1 infrastructure. v2 ~$1,700/mo
(adding ~70% for warm standby).

For comparison, an active-active v3 would roughly double the v1
cost AGAIN (so ~$2,000/mo for Tier-1 infra).

---

## 8. Files to create/change

### v1 (provisioned now)

- `infra/terraform/regions/us-east-1/*.tf` — primary region infra.
- `infra/terraform/regions/us-west-2/backups.tf` — S3 replica only.
- `infra/terraform/regions/us-west-2/kms.tf` — multi-region keys.
- `infra/terraform/route53.tf` — failover routing config pinned to
  us-east-1.

### v2 (provisioned at v2 launch)

- `infra/terraform/regions/us-west-2/eks.tf`
- `infra/terraform/regions/us-west-2/aurora-replica.tf`
- `infra/terraform/regions/us-west-2/secrets-manager.tf`
- `scripts/dr-failover.ts` — failover driver.
- `docs/runbooks/regional-failover.md`
- `docs/runbooks/regional-failback.md`

### Always

- `docs/security/reliability-and-dr/README.md` — link to DR5.

---

## 9. Acceptance criteria

### 9.1 v1

- [ ] Aurora Global Database configured with us-west-2 replica.
- [ ] KMS multi-region keys live (K3 M1+M2 done).
- [ ] Route 53 failover record exists (pinned to us-east-1).
- [ ] Documented limitation: regional outage not covered by SLA.
- [ ] Backup cross-region replication green (O4 §5).

### 9.2 v2

- [ ] EKS cluster in us-west-2 deployed at minReplicas.
- [ ] Aurora us-west-2 replica caught up to primary (replication
      lag <5 s).
- [ ] DNS failover record updates within 60 s of trigger.
- [ ] Failover drill achieves RTO ≤30 min.
- [ ] Failback drill achieves the same.
- [ ] Drill report filed quarterly.

---

## 10. Test plan

### 10.1 v1 verification

- Cross-region S3 replica is up-to-date: pick a random recent backup;
  verify the same file exists in us-west-2 within 15 min of write.
- KMS multi-region keys: sign a sample message with each replica;
  verify identical signature output.

### 10.2 v2 failover drill (quarterly per O5 §8)

- Designate a maintenance window.
- Simulate us-east-1 outage: tear down the us-east-1 Route 53 weight.
- Confirm traffic shifts to us-west-2 within 60 s.
- Confirm Tier 1 paths function via us-west-2.
- After 30 min, switch back; confirm us-east-1 catches up.
- File report.

### 10.3 v2 disaster drill (annual)

- Real failover during low-traffic hours (e.g. Saturday 03:00 PT).
- Run for 4 hours in us-west-2 to validate steady-state operation.
- Switch back; assess.

---

## 11. Rollback

### v1

Pilot-light foundations are read-only resources (replicas). Removing
them: simple Terraform destroy. No production impact.

### v2

If the warm-standby region develops issues, we can:
1. Scale us-west-2 EKS to zero (saves money).
2. Drop us-west-2 from Route 53 failover routing.
3. Keep Aurora replica + S3 replica for data redundancy.

This is downgrading from v2 to a v1-like posture. Not abandoning DR
entirely.

---

## 12. Open questions

- **OQ-DR5-1**: Is `us-west-2` the right DR region? Considerations:
  network distance from us-east-1, AWS service availability parity,
  data-residency. Proposed: yes for US-only customer base; revisit if
  EU customers materialise (then `eu-west-1` or `eu-central-1`).
- **OQ-DR5-2**: When do we trigger v2 build-out? Proposed: 6 months
  after v1 launch OR first paying customer with a sub-15-min SLA
  contractual requirement, whichever comes first.
- **OQ-DR5-3**: Active-active for read paths (v3) — what's the
  trigger? Proposed: when read traffic exceeds 5,000 RPS sustained,
  OR when measured cross-region latency is harming user experience.
- **OQ-DR5-4**: Multi-cloud (AWS + GCP) — when? Proposed: NOT in v2.
  Multi-cloud is a 10× operational complexity multiplier; multi-region
  within AWS provides 95% of the resilience at 30% of the cost. Defer
  multi-cloud until a specific customer or regulatory requirement
  forces it (e.g. FedRAMP compliance asks).
- **OQ-DR5-5**: Vercel multi-region — Vercel already deploys to many
  edges automatically; we benefit from this for free. Caveat: Vercel
  Functions are stateless, so they're fine; the issue is the database
  endpoint that Functions connect to. v2 introduces a per-region
  Postgres endpoint for Vercel's edge Functions; switching is via
  edge-config rather than environment-variable.
- **OQ-DR5-6**: How do users in EU experience us-east-1-pinned service?
  Latency adds ~100 ms per round trip. Vercel mitigates for `apps/web`
  static + edge-cached content; doesn't help for `apps/a2a-agent`
  signing which is round-trip-heavy. Proposed: acceptable for v1; EU
  market entry would trigger an `eu-*` regional deploy (defer).
