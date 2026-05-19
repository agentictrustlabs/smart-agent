# DR2 — Backup Verification

> **Status**: DRAFT. **Backups don't exist yet** (O4 introduces them).
> Once they exist, the next gap is *verifying* they restore. A backup
> that never restores is a hope, not a backup. Silent corruption
> (incomplete dump, encryption key drift, format incompatibility on a
> Postgres major upgrade) is real and only surfaces during recovery —
> typically the worst possible moment.
>
> This document specifies the weekly automated restore-and-verify
> pipeline that catches silent corruption before incident day.
>
> **Effort**: M (1 week to build + wire).
> **Owner**: Infra lead.
> **Depends on**: O4 (backups exist), DR1 (Aurora is the source-of-truth
> being backed up).
> **Unblocks**: trust in the recovery procedure; O5 RPO commitments.

---

## 1. Today's state (honest)

| Practice | Today |
|---|---|
| Backups | None (planned per O4) |
| Restore rehearsal | Never |
| Backup integrity verification | None |
| Chaos drill (kill primary, verify failover + restore path) | Never |
| RTO/RPO measurement | None |

Once O4 lands and we have daily Postgres + Askar backups: we still
won't know they work without DR2.

This is the gap DR2 closes.

---

## 2. Goals

1. **Weekly automated restore + verify of a random backup.** Picks
   one of the last 7 days; restores to ephemeral infrastructure; runs
   smoke queries; reports.
2. **Chaos drill quarterly** (per O5 §8): kill primary, verify failover
   to standby, verify recoverable from backup if needed.
3. **Backup integrity check on every backup write** (hash, plus a
   format-readability check).
4. **Documented restore SLA** measured from the verification run,
   published on the SLO dashboard.

---

## 3. The weekly restore-and-verify pipeline

### 3.1 Lambda trigger

EventBridge cron, every Saturday 02:00 UTC:

```hcl
resource "aws_cloudwatch_event_rule" "weekly_restore_verify" {
  name                = "weekly-restore-verify"
  schedule_expression = "cron(0 2 ? * SAT *)"
}
```

Triggers `infra/terraform/lambda-restore-verify.tf` Lambda
`restore-verify-postgres`.

### 3.2 The pipeline

```
1. List all backups in S3 from the last 7 days.
   - Pick one Postgres backup per database (web, a2a_agent, person_mcp, …)
     at random.
   - Pick one Askar backup per service at random.

2. For each Postgres backup:
   a. Provision an ephemeral RDS instance (db.t4g.medium; cheap).
      Naming: sa-restore-verify-<db>-<ts>.
   b. Download the backup.
   c. Verify the hash matches the side-channel hash.
   d. Restore: pg_restore -d <ephemeral>.
   e. Run the 50-query smoke test (§3.3).
   f. On success: report success + RTO measurement.
   g. On failure: page on-call (Sev-1) + leave the instance up for
      forensic inspection.
   h. Tear down the ephemeral RDS instance.

3. For each Askar backup:
   a. Spin up an ephemeral EC2 micro instance.
   b. Download the export + wrapped key.
   c. KMS-decrypt the wrapped key.
   d. Run scripts/askar-import.ts.
   e. Run a 10-query smoke test against the imported vault.
   f. On success: report.
   g. On failure: page.
   h. Tear down.

4. Aggregate results; post to Datadog as backup_verify_success metric
   + Slack #ops-alerts summary.
```

### 3.3 50-query smoke test

`scripts/smoke-test-postgres.ts` (new). Queries are read-only and
cover:

- Row counts on every table (compared to a known floor — count > 0
  for tables expected to have data).
- Foreign-key integrity check on a representative set of joins.
- Index health (`SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0`
  flags unused indexes but isn't a verify failure; informational).
- A "representative-record" lookup: for each table, fetch the most
  recent row by primary key (assumes the snapshot has that row).
- `SELECT NOW()` works.
- Schema version (latest Drizzle migration applied).

Queries are kept simple — DR2 is about "is this dump structurally
intact?" not "is the application running well." The latter is O8's
load test against staging.

### 3.4 Askar smoke test

`scripts/smoke-test-askar.ts` (new):

- Open the imported vault with the decrypted export key.
- `Store.listProfiles()` returns >=1 profile.
- For one randomly-selected profile, list categorised records:
  - `category: 'credential'` — count >=1 if this is a holder service.
  - `category: 'session'` — count >=1.
- Decrypt one random record using its KEK; assert decryption succeeds.

### 3.5 RTO measurement

The pipeline records:
- Time to download backup from S3.
- Time to provision ephemeral instance.
- Time to restore the dump.
- Time to run the smoke test.
- Total elapsed.

The "Total elapsed" is the de-facto RTO under the simplifying
assumption "fresh infra is provisioned." It's an UPPER BOUND on the
real RTO in production where the target infra is already running and
just needs a `pg_restore`.

Reported as Datadog metric `backup_verify.rto_seconds`. Tier 1
target: ≤30 min for `person_mcp`-class DB. Alert at 45 min.

---

## 4. Backup integrity on write

Per O4, every backup write computes its SHA-256 hash and writes it to
a separate audit channel. DR2 adds two more checks per backup:

### 4.1 Format-readability probe

Immediately after upload, a Lambda streams the backup from S3 and:
- Postgres: runs `pg_restore --list` on the dump. Succeeds = the dump
  header is valid + the TOC is parseable.
- Askar: opens the export file header; verifies the magic bytes +
  declared version.

Probe failure → page on-call (the backup didn't write correctly;
re-run before the dev-team starts the day).

### 4.2 Differential size check

If today's backup is >20% smaller OR >50% larger than yesterday's,
alert. Sudden shrinkage may indicate a backup of an empty database
(catastrophic — operator misconfigured `pg_dump`); sudden growth may
indicate a stuck transaction holding storage.

---

## 5. Quarterly DR drill

Documented in `docs/runbooks/dr-drill-q4-full-restore.md` (per O5 §8.1).

Once per quarter, the team executes a full-environment restore:

1. Operator picks a backup from a week ago.
2. Operator provisions a new VPC + Aurora cluster + all services.
3. Operator restores every database from the picked backup.
4. Operator restores every Askar vault.
5. Operator runs the production smoke-test suite (synthetic transactions
   from O1 §7.1) against the restored environment.
6. Time-stamped milestones are recorded.
7. Report filed in `output/dr-drill-YYYY-Q4.md`.

Target: full-environment restore <4 hours. Demonstrates we can recover
from a full-region loss.

---

## 6. Chaos for failover (DR1) — referenced here

Independent of restore-from-backup, the quarterly chaos drill kills
the primary instance and validates failover:

1. `aws rds failover-db-cluster --db-cluster-identifier sa-prod`.
2. Measure: time from failover-initiated to applications reconnected.
3. Verify: no committed-transaction data loss.
4. Verify: in-flight transactions safely retried via idempotency
   keys (DR7).
5. Report filed in `output/dr-drill-YYYY-QN.md`.

This belongs to DR1's verification surface; mentioned here because
the chaos drill set is unified.

---

## 7. Files to create/change

### New

- `infra/terraform/lambda-restore-verify.tf` — Lambda + IAM + cron.
- `infra/terraform/lambda-format-probe.tf` — Lambda for §4.1.
- `scripts/restore-verify-postgres.ts` — driver script.
- `scripts/restore-verify-askar.ts` — driver script.
- `scripts/smoke-test-postgres.ts` — 50-query suite.
- `scripts/smoke-test-askar.ts` — 10-query suite.
- `docs/runbooks/restore-verify-failure.md` — runbook for when a
  weekly run fails.
- `infra/datadog/dashboards/backup-verify.json` — dashboard with RTO
  per service, success rate, last successful date.

### Changed

- O4's backup scripts — emit the side-channel hash file in the
  exact location DR2 expects.

---

## 8. Cost

| Item | Cost |
|---|---|
| Lambda invocations (4-12 / week) | <$1/mo |
| Ephemeral RDS instances (T4g.medium × ~3 hours × weekly) | $0.07 × 3 × 4 = ~$1/mo |
| Ephemeral EC2 instances (t3.micro × ~30 min × weekly) | <$1/mo |
| S3 GETs + cross-region transfer | $1-2/mo |
| Datadog custom metrics | included |

Total marginal: <$10/mo for full weekly restore-and-verify across all
backed-up assets.

---

## 9. Acceptance criteria

- [ ] Weekly restore-verify Lambda runs every Saturday 02:00 UTC.
- [ ] Each weekly run picks one random backup per DB + per Askar
      service, restores, verifies, tears down.
- [ ] Backup-write format probe runs on every backup upload.
- [ ] Differential size alert wired and fires on >20% size delta.
- [ ] Quarterly full-restore drill scheduled in DoE's calendar.
- [ ] RTO measurement metric published per service.
- [ ] Restore SLA documented per service in `docs/security/operations/
      O5-dr-rto-rpo-targets.md`.
- [ ] First 4 weekly runs successful before this plan is marked
      complete.

---

## 10. Test plan

### 10.1 Pre-production

- Deliberately corrupt a test backup (truncate the file). Run the
  format probe; confirm it fails and alerts.
- Deliberately backup an empty database. Run the differential-size
  alert; confirm it fires.

### 10.2 First-month operational

- Run the pipeline 4 consecutive Saturdays.
- For week 5, deliberately introduce a smoke-query that expects
  a row that's been deleted. Confirm the failure pages on-call.

---

## 11. Rollback

The verification Lambda is idempotent and stateless. Disabling it is
a one-line Terraform change. Doing so means we're back to "untested
backups," which is the pre-DR2 state and unacceptable for production.

---

## 12. Open questions

- **OQ-DR2-1**: Should verification ever WRITE to the restored DB
  (e.g. test an `INSERT`)? Proposed: no — keep verification read-only
  to avoid any chance of contaminating other tests. INSERT tests
  belong to integration tests, not backup verification.
- **OQ-DR2-2**: Do we verify backups stored in the DR region too?
  Proposed: yes — once a month verify from the cross-region replica
  (DR5).
- **OQ-DR2-3**: Should the verification randomly sample a backup more
  than 7 days old occasionally (e.g. once a month verify a 30-day-old
  backup)? Proposed: yes — once a month a "deep" run that picks a
  backup from 14-35 days back (within PITR retention). Catches issues
  where a backup ages out of recoverability.
- **OQ-DR2-4**: Notification spam — if the same backup fails 3 weeks
  in a row, do we keep paging? Proposed: dedupe by hash of the
  failure mode for 7 days; resume paging if not resolved.
- **OQ-DR2-5**: Cost ceiling — at scale, ephemeral RDS provisioning
  could grow. Proposed: when total verify cost exceeds $50/mo,
  rationalise (skip smaller DBs; restore on a shared verify host
  rather than per-DB instance).
