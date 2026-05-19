# DR1 — Postgres HA

> **Status**: DRAFT. **No production Postgres exists today.** Spec 007
> Phase F.2 introduces it as the storage layer for every service-owned
> table (sessions, nonces, action counters, audit rows, credential
> metadata, …). Phase F.2 specifies the storage architecture; this
> document specifies the HA + failover posture for that architecture.
>
> **Effort**: M (1 week — Terraform + failover testing).
> **Owner**: Infra lead.
> **Depends on**: Spec 007 Phase F.2 (Postgres is the storage layer),
> O2 (`/ready` detects Postgres reachability), O4 (backups are a
> separate concern; HA is about hot failover).
> **Unblocks**: O5 Tier-1 RTO of 15 min, O6 alerting on failover.

---

## 1. Today's state (honest)

Spec 007 F.2 is locked but unimplemented. The plan calls for "AWS:
managed Postgres (RDS) … Each service's `*_PG_URL` points at its own
database on the shared RDS instance. … Managed instance details (size,
backups, HA) documented in `docs/runbooks/postgres-prod.md` (new doc,
Phase H)." That runbook does not exist yet.

If Postgres goes down today in the production we're about to deploy:
- Every service's `/ready` fails (per O2).
- Load balancers drain all instances.
- Service is fully down until manual recovery.

This is the gap DR1 closes.

---

## 2. Goals

1. **Multi-AZ Postgres**: primary in AZ-a, synchronous standby in AZ-b.
   Automatic failover on primary failure ≤2 min wall clock.
2. **Read replica in a third AZ**: serves Tier 2 read traffic; warm
   for promotion if needed.
3. **Connection failure handling**: services reconnect cleanly within
   30 s of failover.
4. **Service-tier-aware traffic routing**: Tier 1 always reads from
   primary (RPO 1 min); Tier 2 reads can use the replica (RPO ≤ replication
   lag, typically ≤1 s).
5. **No split-brain.** RDS uses quorum-based promotion; we don't
   build our own.
6. **Failover is rehearsed** quarterly (per O5 §8).

---

## 3. Architecture decision

### 3.1 Options considered

| Option | Pros | Cons | Decision |
|---|---|---|---|
| **RDS Multi-AZ (single instance, synchronous standby)** | Managed; HA out of the box; 60-120 s failover. | No read scaling. | Considered. |
| **RDS Multi-AZ with read replicas** | Managed; HA + read scaling. | Standby instance is invisible (cannot be queried); read replicas are separate instances. | Considered. |
| **RDS Aurora Postgres** | Single shared storage tier; very fast failover (<30 s); cheaper at scale; auto-scaling storage. | Vendor lock-in to Aurora's storage layer. Higher minimum cost. | **Chosen.** |
| **Self-managed Postgres + Patroni** | No lock-in; full control. | Massive operational burden. Not justified at our scale. | Rejected. |
| **GCP Cloud SQL Postgres HA** | Equivalent to RDS Multi-AZ. | If we go AWS-primary, GCP is for DR (DR5), not for primary. | Future option for DR5. |

### 3.2 Why Aurora

Aurora Postgres is RDS-compatible (same SDK), has fast failover (<30
seconds typical), supports up to 15 read replicas, and decouples
storage from compute (read replicas share the same storage tier with
the primary, so no replication lag for reads).

Substrate-independence check (P1): the Postgres wire protocol is the
interface; Aurora is an implementation. We can migrate off Aurora to
self-hosted Postgres if needed (logical replication exit). Lock-in is
to AWS the cloud, not to Aurora specifically. We accept this lock-in
because the operational savings dwarf the substitution cost.

---

## 4. Topology

```
                            ┌─────────────────────────┐
                            │   Aurora Postgres 16    │
                            │   Cluster: sa-prod      │
                            │                         │
                            │  ┌──────┐    ┌──────┐  │
                            │  │ AZ-a │    │ AZ-b │  │  
                            │  │primry│sync│stby1 │  │
                            │  └──┬───┘    └──┬───┘  │
                            │     │           │      │
                            │     └─── shared ┘      │
                            │     ┌──────┐           │
                            │     │ AZ-c │           │
                            │     │ read │           │
                            │     │ rep  │           │
                            │     └──────┘           │
                            └──────────┬──────────────┘
                                       │
                                       ▼
                                   PgBouncer
                                  (per service)
                                       │
            ┌────────────┬─────────────┼─────────────┬────────────┐
            ▼            ▼             ▼             ▼            ▼
        a2a-agent     web        person-mcp      org-mcp   other-mcps
```

### 4.1 Cluster configuration

| Setting | Value |
|---|---|
| Instance class (primary + standby) | `db.r6g.large` initial (2 vCPU, 16 GiB). Scale per O8. |
| Replica class | `db.r6g.large`. |
| Storage | Aurora-default (shared, auto-scaling). |
| Backup retention | 35 days (matches Spec 007's stated PITR retention). |
| Encryption | KMS-encrypted; customer-managed key (per O4 §3.7). |
| Parameter group | Custom: `log_min_duration_statement=1000`, `log_lock_waits=on`, `shared_preload_libraries=pg_stat_statements`. |
| Maintenance window | Sunday 06:00-07:00 UTC. |
| Major version upgrade | Manual; CAB approval (O11 §6). |
| Minor version upgrade | Auto-applied during maintenance window. |
| Performance Insights | Enabled (free for 7-day retention). |
| Enhanced Monitoring | Enabled, 30s granularity. |
| Deletion protection | Enabled. |
| Apply immediately for changes | False (changes apply during maintenance window). |

### 4.2 Database isolation (per Spec 007 F.2)

Each per-service database (`web`, `a2a_agent`, `person_mcp`,
`org_mcp`, `people_group_mcp`, `family_mcp`, `geo_mcp`, `verifier_mcp`,
`skill_mcp`) is its own logical DB on the shared cluster.

Each service connects with its own database user, granted only on its
own database (Spec 007 F.2 open question F1 — proposed answer locked
in here):

```sql
-- per-service initialization (Terraform)
CREATE DATABASE person_mcp;
CREATE USER person_mcp_user WITH ENCRYPTED PASSWORD '<from-secret-manager>';
GRANT ALL PRIVILEGES ON DATABASE person_mcp TO person_mcp_user;
REVOKE CONNECT ON DATABASE person_mcp FROM PUBLIC;
```

A leaked connection string for `person_mcp_user` exposes only the
`person_mcp` database — not `org_mcp` or `a2a_agent`. Cross-database
joins are impossible.

### 4.3 PgBouncer

Per Spec 007 F.2 / O8, PgBouncer pools connections in front of the
cluster. One PgBouncer per service for connection-limit fairness:

```
[databases]
person_mcp = host=sa-prod.cluster-xxxx.us-east-1.rds.amazonaws.com port=5432 dbname=person_mcp

[pgbouncer]
listen_port = 6432
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
reserve_pool_size = 5
server_lifetime = 3600
server_idle_timeout = 600
```

PgBouncer itself is HA: two instances behind an internal NLB; if one
dies, traffic shifts.

---

## 5. Failover behavior

### 5.1 Triggers

RDS auto-failover triggers when:
- Primary instance becomes unreachable from its monitoring agent
  (typically a hardware or OS failure).
- AZ-level outage.
- Manual failover initiated (planned maintenance).

### 5.2 Sequence

```
T+0     primary fails
T+5s    RDS monitoring detects via heartbeat loss
T+30s   RDS initiates failover; standby is promoted
T+60s   DNS record (sa-prod.cluster-xxxx... → primary)
        updates; some clients still see the old IP cached
T+90s   most clients reconnect to the new primary
T+120s  long-tail clients reconnect
```

### 5.3 Application-side reconnect

`postgres.js` (the chosen driver per Spec 007 F.2) handles connection
loss + reconnect natively. Configuration:

```typescript
import postgres from 'postgres'

const sql = postgres(process.env.PERSON_MCP_PG_URL!, {
  max: 25,
  idle_timeout: 30,
  connect_timeout: 5,
  prepare: true,
  // Retry policy: 5 attempts with exponential backoff.
  connection: { application_name: 'person-mcp' },
  onnotice: () => {},
  // No retries on application errors (they should fail loud);
  // retries on transport errors only.
})
```

The application code does NOT retry queries explicitly — when a
connection is force-closed mid-query, postgres.js throws, and the
caller surfaces it to the user. The user retry (or the client's
idempotency-key retry per DR7) hits a fresh connection.

### 5.4 In-flight transactions

Transactions in flight at failover time are rolled back. Combined
with idempotency keys (DR7), this is safe — the client retries with
the same key and gets the correctly-processed result.

For long-running transactions (e.g. a bulk on-chain sync writing to
GraphDB mirror), the application uses smaller batches so a rollback
costs ≤10 s of work.

### 5.5 No-data-loss guarantee

Aurora's synchronous-standby model guarantees the standby has every
committed transaction. Failover does not lose committed data. The
2-min unavailability window is for in-flight transactions only.

---

## 6. Read replica usage

Tier 2 reads route to the replica via separate connection strings:

```
PERSON_MCP_PG_URL=postgres://...@sa-prod.cluster-xxxx... (writer endpoint)
PERSON_MCP_PG_URL_READONLY=postgres://...@sa-prod.cluster-ro-xxxx... (reader endpoint)
```

The application picks based on call type:
- Writes + reads-that-must-see-own-writes: writer endpoint.
- Read-only listings (e.g. "list all skills"): reader endpoint.

For Tier 1 surfaces (auth, signing), we always use the writer
endpoint to avoid replication-lag surprises.

Read-replica reads cost less (the replica is a separate compute that
serves only reads), and offload the primary.

---

## 7. Monitoring + alerts

| Metric | Alert | Severity |
|---|---|---|
| Primary CPU >80% sustained 5 min | Slack | Sev-2 |
| Primary CPU >95% sustained 1 min | PagerDuty | Sev-1 |
| Replication lag >5 s | Slack | Sev-2 |
| Replication lag >30 s | PagerDuty | Sev-1 |
| Failed connection count (per service) >10/min | Slack | Sev-2 |
| Connection saturation >80% of pool | PagerDuty | Sev-1 |
| Failover initiated | PagerDuty | Sev-1 |
| Backup failed | PagerDuty | Sev-1 |
| Storage full >85% | Slack | Sev-2 |
| Long-running query >5 min | Slack | Sev-2 |

Each routes to a runbook per O7 (`docs/runbooks/postgres-prod.md`,
`docs/runbooks/postgres-failover.md`, …).

---

## 8. Files to create/change

### New

- `infra/terraform/aurora-postgres.tf` — Aurora cluster + parameter
  group + monitoring.
- `infra/terraform/pgbouncer.tf` — PgBouncer service per backend.
- `infra/terraform/secrets-postgres.tf` — Secrets Manager rotation
  for per-service users.
- `docs/runbooks/postgres-prod.md` — production runbook (referenced
  in Spec 007 F.2).
- `docs/runbooks/postgres-failover.md` — failover diagnostic + recovery.
- `docs/runbooks/postgres-storage-full.md` — disk-full handling.
- `docs/runbooks/dr-drill-q1-postgres-failover.md` — DR drill procedure.

### Changed

- Each service's `src/db/pool.ts` — both `WRITER_URL` and
  `READER_URL` if applicable.
- `scripts/fresh-start.sh` — Docker Postgres becomes a 2-node cluster
  via `postgresql-ha` image OR (more likely) a single-node dev
  Postgres + a Compose-defined "fake replica" Postgres for testing
  the dual-URL code paths.

### CI guards

- `service-uses-writer-url-for-writes.test.ts` — AST lint: any code
  path that calls `INSERT` / `UPDATE` / `DELETE` uses the writer URL,
  never the reader URL.

---

## 9. Cost

| Item | Cost (AWS us-east-1) |
|---|---|
| Aurora primary `db.r6g.large` | $0.29/hour × 730 = $212/mo |
| Aurora standby (same class, synchronous) | $212/mo |
| Aurora read replica (same class) | $212/mo |
| Storage (Aurora-managed, $0.10/GB-mo) | $5/mo for first 50 GB |
| IOPS (Aurora $0.20 per 1M req) | ~$5-20/mo initial |
| PgBouncer (2 t3.small instances) | $30/mo |
| Backups (auto + retention) | included |
| Cross-region read replica (deferred to DR5) | not yet |

Total: ~$680/mo initial. Scales with instance size + replica count.

Reserved Instances 1-yr saves ~30% once steady-state.

---

## 10. Acceptance criteria

- [ ] Aurora cluster live in `us-east-1` with 1 primary + 1
      synchronous standby + 1 read replica.
- [ ] Per-service databases + users created via Terraform.
- [ ] PgBouncer deployed and serving all services.
- [ ] Failover drill (O5 §8 Q1) completes within Tier 1 RTO (15 min).
- [ ] Applications reconnect cleanly within 30 s of failover.
- [ ] Monitoring dashboards exist; alerts wired per §7.
- [ ] Read-replica usage for at least one Tier 2 read path is
      validated (org-mcp listing tools, perhaps).
- [ ] CI guard `service-uses-writer-url-for-writes.test.ts` passes.

---

## 11. Test plan

### 11.1 Pre-production

- Deploy Aurora cluster in a staging environment.
- Run smoke tests + load tests (per O8).
- Forced failover via `aws rds failover-db-cluster --db-cluster-identifier
  sa-staging`; measure: time to standby promotion, time to client
  reconnect, in-flight transaction loss.

### 11.2 Quarterly DR drill (per O5 §8)

- Trigger an AZ failure simulation: stop the primary instance.
- Measure RTO.
- Verify zero data loss for committed transactions.
- Verify in-flight transactions safely retry via idempotency keys
  (DR7).

### 11.3 Chaos

- Kill the connection between PgBouncer and Aurora for 30 s. Verify
  the services' `/ready` flips to 503 (per O2), then back to 200 when
  restored. Verify no zombie connections persist.

---

## 12. Rollback

Cluster topology changes (e.g. removing the read replica) are
straightforward via Terraform. Stepping down from Aurora to a single-
instance setup requires schema migration; not a casual operation.
PgBouncer can be bypassed via DNS change (services connect directly
to Aurora) for emergency.

The "rollback Postgres entirely" scenario is not addressed by DR1 —
that would mean abandoning Spec 007 F.2's decision, which the user
explicitly rejected.

---

## 13. Open questions

- **OQ-DR1-1**: Aurora Postgres pricing assumes us-east-1; do we
  multi-region from day one? Proposed: no — DR5 covers regional DR.
  Day one is single-region.
- **OQ-DR1-2**: Aurora Serverless v2 instead of provisioned? Lower
  base cost; auto-scale. Considered; rejected for v1 because
  cold-start latency on infrequent paths (e.g. audit-row writes during
  a quiet period) is poorly tolerated by users. Re-evaluate after
  6 months of operation.
- **OQ-DR1-3**: Connection-string rotation: who owns it? Proposed:
  AWS Secrets Manager auto-rotation; service reads from Secrets
  Manager at boot (and on `SIGHUP`).
- **OQ-DR1-4**: Encryption-at-rest with HSM-rooted KMS key? Proposed:
  yes — see O4 §3.7 and K4 (HSM stance).
- **OQ-DR1-5**: Replica lag SLO? Proposed: <1 s p99 in steady state;
  alert at 5 s; page at 30 s.
