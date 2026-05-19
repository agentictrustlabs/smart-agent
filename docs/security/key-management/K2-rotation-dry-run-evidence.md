# K2 — Rotation Dry-Run Evidence

> **Status**: DRAFT. The LocalStack dry-run script
> (`scripts/dry-run-kms-rotation.sh`) is specified here but not yet
> implemented. The staging dry-run is contingent on having a non-prod
> AWS / GCP account, which is also not yet provisioned.
> **Purpose**: produce the evidence package an external auditor or the
> board sub-committee needs to confirm that K1 is not theoretical.

## 1. Why this exists

K1 (`./K1-rotation-procedure.md`) is the runbook. A runbook is
believable only if someone has executed it end-to-end recently. K2 is
the standing requirement that we execute K1 against non-prod KMS on a
quarterly cadence and produce evidence the procedure works as written.

Without K2:
- We have a runbook nobody has run.
- The first production rotation is a live-fire event.
- External auditors will mark "rotation procedure" as
  *not-substantiated*.

With K2:
- We have a signed report per quarter showing the time-to-rotate
  metric, the verification artefacts, and any deviation from K1.
- The first production rotation is the Nth execution of the procedure,
  not the first.
- External auditors get the report.

---

## 2. Dry-run scope

A dry-run executes K1 § 3 + § 5 (per-cloud procedure + verification)
against a NON-PRODUCTION KMS:

| Tier | KMS backend | What it validates | Status |
|---|---|---|---|
| **Tier 1: LocalStack** | `awslocal kms` (LocalStack Community) | Procedure shape, command-line syntax, env-propagation pattern, restart-order, verification command output. | Implementable today (LocalStack is already wired by `--with-kms`). |
| **Tier 2: AWS staging** | Real AWS KMS in a `smart-agent-staging` account distinct from prod. | IAM policy evaluation, real CloudTrail emission, real OIDC federation, Vercel preview-environment behaviour. | Blocked on staging account provisioning. |
| **Tier 3: GCP staging** | Real GCP Cloud KMS in a `smart-agent-staging` project distinct from prod. | GCP IAM policy evaluation, Workload Identity Federation behaviour, Cloud Audit Logs emission. | Blocked on staging project provisioning. |

Tier 1 is the BASELINE — every quarter, no exceptions. Tier 2 and
Tier 3 ADD coverage but cannot replace Tier 1 (LocalStack catches
script-level bugs cheaply; staging catches IAM bugs but is slower and
costlier).

---

## 3. LocalStack dry-run — `scripts/dry-run-kms-rotation.sh`

### 3.1 Contract

This script does NOT exist yet. The contract:

```
USAGE: scripts/dry-run-kms-rotation.sh [--key=<master|bundler|sessionIssuer|all>]
                                       [--out=<dir>]
                                       [--cleanup]

OUTPUTS:
  ./output/kms-dry-run-<YYYY-MM-DD>/
    ├── 00-precheck.json          (env / docker / awslocal availability)
    ├── 01-pre-checkpoint.json    (audit chain head hashes per table)
    ├── 02-rotation-<key>.log     (full command trace per key)
    ├── 03-post-checkpoint.json
    ├── 04-verification-<key>.json (signature sample, audit row, cast output)
    ├── 05-timings.json           (per-step elapsed; aggregate time-to-rotate)
    ├── 06-rollback-<key>.log     (rollback executed for each rotated key)
    └── REPORT.md                 (signed report; § 3.3 below)

EXIT CODES:
  0    All keys rotated + verified + rolled back cleanly.
  1    Precheck failed (missing dependency, fresh-start not run, etc.).
  2    A rotation step failed; partial state preserved for inspection.
  3    Verification failed AFTER rotation; rollback succeeded; report flags.
  4    Verification + rollback both failed; manual intervention required.

OPERATING REQUIREMENTS:
  - fresh-start.sh --with-kms must have been run within the last 1h.
  - LocalStack KMS must be healthy (curl /_localstack/health passes).
  - The a2a-agent must be reachable on $A2A_AGENT_URL.
  - Postgres connection $A2A_PG_URL must accept connections.
```

### 3.2 Per-step expected outcome

1. **Precheck** — confirm LocalStack KMS, a2a-agent, Postgres are up.
2. **Pre-checkpoint** — snapshot audit-chain head hashes per table.
3. **Per key** (master, bundler, sessionIssuer, then each MAC + tool
   executor sub-key, then envelope KEK):
   - Capture old key ID / version.
   - Execute K1 § 3.3 commands.
   - Capture new key ID / version + EVM address.
   - Restart affected services.
   - Run K1 § 5.1 (signature sample), § 5.2 (audit row), § 5.3 (cast
     spot-check where applicable).
4. **Post-checkpoint** — snapshot again.
5. **Diff checkpoints** — assert audit chain advanced cleanly (no gaps,
   no rewrites).
6. **Per key**: execute rollback per K1 § 6 to leave LocalStack in the
   same state as pre-run.
7. **Aggregate timings** — sum per-step wall-clock, emit summary JSON.
8. **Generate REPORT.md** — § 3.3 below.

### 3.3 REPORT.md shape

```markdown
# KMS Rotation Dry-Run — <YYYY-MM-DD>

- **Tier**: LocalStack
- **Operator**: <name>
- **Reviewer**: <name>
- **Total wall clock**: <HH:MM:SS>
- **Outcome**: PASS / FAIL / FAIL_ROLLED_BACK

## Per-key timings

| Key | Pre-check | Rotate | Verify | Rollback | Total |
|---|---|---|---|---|---|
| master | 0:00:02 | 0:00:18 | 0:00:09 | 0:00:11 | 0:00:40 |
| bundler | ... | ... | ... | ... | ... |
| ... | | | | | |

## Per-key verification

| Key | Signature sample | Audit row | Cast spot-check | Pass |
|---|---|---|---|---|
| master | new EVM addr 0x... | row id N+1 written | N/A | ✅ |
| bundler | new EVM addr 0x... | row id N+2 written | new addr observed | ✅ |
| sessionIssuer | new EVM addr 0x... | row id N+3 written | new addr observed | ✅ |

## Deviations from K1

(none) | <enumerated deviations with reason and follow-up task>

## Follow-up items

(none) | <issues to file>

## Signature

Operator: <name + date>
Reviewer: <name + date>
```

### 3.4 First-run plan

The first execution of this script is itself the milestone for
"K2 implementation complete":

| Action | Owner |
|---|---|
| Implement `scripts/dry-run-kms-rotation.sh` per § 3.1 contract. | Developer |
| Execute the script. | Operator |
| Review the REPORT.md. | Security + Reviewer |
| Add the REPORT.md to `output/kms-dry-runs/` (long-term archive). | Operator |
| Commit a redacted version to `docs/security/key-management/dry-run-archive/<date>.md`. | Operator |

---

## 4. Staging dry-run (Tier 2: AWS, Tier 3: GCP)

When the staging accounts exist, the same script runs against them with
two adaptations:

| LocalStack | AWS staging | GCP staging |
|---|---|---|
| `awslocal kms ...` | `aws kms ...` (with staging-OIDC role assumption) | `gcloud kms ...` (with staging-WIF impersonation) |
| `AWS_ENDPOINT_URL=http://localhost:4566` | unset; uses real STS | unset; uses real google-auth-library |
| `vercel env` against a fictional prod | `vercel env` against `smart-agent-staging` Vercel project | same |
| No CloudTrail | Real CloudTrail; K6 alert validation can piggyback here. | Real Cloud Audit Logs; K6 alert validation can piggyback here. |
| Wall-clock target: ≤2 minutes total | ≤5 minutes total (network + IAM eventual consistency) | ≤5 minutes total |

The staging dry-run includes ONE additional validation step the
LocalStack dry-run cannot do:

- **CloudTrail integrity check**: query CloudTrail for the
  `kms:UpdateAlias` and `kms:CreateKey` events emitted during the run;
  assert they are present, have the expected principal, and are
  properly signed by AWS (CloudTrail digest file present and signature
  validates).

The same applies to GCP Cloud Audit Logs.

---

## 5. Cadence

| Tier | Cadence | Trigger |
|---|---|---|
| Tier 1 (LocalStack) | **Quarterly** — first business day of each calendar quarter. | Scheduled task; failure to run within 7d of due date is a P2 alert. |
| Tier 1 (LocalStack) | **Ad-hoc** — before any change to K1, before any change to provisioning runbooks, after any KMS-adjacent SDK upgrade. | Manual trigger. |
| Tier 2 (AWS staging) | **Semi-annual** — first business day of Jan and Jul. | Scheduled. |
| Tier 3 (GCP staging) | **Semi-annual** — first business day of Apr and Oct. | Scheduled. |
| Tiers 2 & 3 | **Ad-hoc** before any production rotation. | Manual. |

The staggered semi-annual cadence on AWS / GCP staging avoids overloading
the operator with two real-cloud drills the same month.

The Tier 2 / Tier 3 drills are an explicit pre-condition for the FIRST
production rotation per cloud — production AWS rotation cannot proceed
until a passing Tier 2 report exists; same for GCP / Tier 3.

---

## 6. Evidence artefact retention

| Artefact | Retention |
|---|---|
| `output/kms-dry-runs/<date>/` (full traces) | 90 days locally; archived to S3 bucket `smart-agent-audit-evidence` for 7 years. |
| `docs/security/key-management/dry-run-archive/<date>.md` (redacted REPORT.md) | Forever (in git). |
| CloudTrail records (AWS staging) | 1 year in CloudTrail; 7 years in S3 export. |
| Cloud Audit Logs (GCP staging) | 400 days default; export to BigQuery for 7-year retention. |

Retention aligns with K6's logging policy (§ K6, Retention) and the
SOC 2 audit window.

---

## 7. CI integration

### 7.1 Pre-prod gate

Before any production-affecting deployment that touches KMS:

```yaml
# .github/workflows/pre-prod-kms-check.yml (proposed)
on:
  pull_request:
    paths:
      - 'packages/sdk/src/key-custody/**'
      - 'apps/a2a-agent/src/auth/**'
      - 'docs/security/key-management/**'
      - 'docs/operations/kms-signer-*.md'
      - 'docs/operator/gcp-kms-*.md'
      - 'scripts/provision-localstack-kms.sh'
      - 'scripts/dry-run-kms-rotation.sh'

jobs:
  kms-dry-run-localstack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/fresh-start.sh --with-kms --no-services --minimal
      - run: ./scripts/dry-run-kms-rotation.sh --key=all --cleanup
      - uses: actions/upload-artifact@v4
        with:
          name: kms-dry-run-report
          path: ./output/kms-dry-run-*/REPORT.md
```

PRs that fail this check cannot merge.

### 7.2 Scheduled CI

```yaml
# .github/workflows/scheduled-kms-drill.yml (proposed)
on:
  schedule:
    - cron: '0 9 1 1,4,7,10 *'  # 9am on the 1st of Jan/Apr/Jul/Oct
  workflow_dispatch:

jobs:
  localstack-drill:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/fresh-start.sh --with-kms
      - run: ./scripts/dry-run-kms-rotation.sh --key=all
      - run: ./scripts/post-drill-report.sh   # uploads to S3 archive
```

Failure pages on-call. The drill is mandatory; skipping it requires an
explicit Security agent override in the rotation log.

---

## 8. Time-to-rotate metric

Each dry-run reports a `time-to-rotate` per key, defined as:

```
time-to-rotate(key) = wall_clock(create_new_version + alias_swap + env_propagate
                                 + restart + signature_sample + audit_row_verify)
```

Targets:

| Key | LocalStack target | Staging target | Prod target |
|---|---|---|---|
| master (signing) | ≤30s | ≤2 min | ≤5 min (planned-outage window) |
| bundlerSigner | ≤30s | ≤2 min | ≤2 min (zero-downtime AFTER Phase A.1) |
| sessionIssuer | ≤30s | ≤2 min | ≤2 min |
| Envelope KEK | ≤10s | ≤30s | ≤30s (automatic) |
| MAC sub-key | ≤30s each | ≤2 min each | ≤2 min each |
| Tool executor signer | ≤30s each | ≤2 min each | ≤2 min each |
| **Total all keys** | **≤5 min** | **≤25 min** | **≤30 min** |

Trends matter: if quarterly LocalStack runs drift from 5 → 6 → 8 min,
something in the procedure regressed and we triage before the next
prod rotation.

---

## 9. What a "passing" dry-run looks like

The first LocalStack dry-run REPORT.md (illustrative):

```markdown
# KMS Rotation Dry-Run — 2026-07-01

- Tier: LocalStack
- Operator: SRE on-call (rotation #1)
- Reviewer: Security agent
- Total wall clock: 0:03:47
- Outcome: PASS

## Per-key timings

| Key | Rotate | Verify | Rollback | Total |
|---|---|---|---|---|
| master | 0:00:14 | 0:00:08 | 0:00:11 | 0:00:33 |
| bundler | 0:00:13 | 0:00:09 | 0:00:10 | 0:00:32 |
| sessionIssuer | 0:00:12 | 0:00:08 | 0:00:09 | 0:00:29 |
| envelope KEK | 0:00:05 | 0:00:02 | n/a | 0:00:07 |
| 5x tool executors | 0:00:55 | 0:00:30 | 0:00:40 | 0:02:05 |
| ... | | | | |
| **Total** | **0:02:50** | **0:01:00** | **0:01:30** | **0:03:47** |

## Per-key verification

(all green; details elided)

## Deviations from K1

None.

## Follow-up items

- K1-Q3 (diag endpoint) still pending; the dry-run used the
  boot-log line instead. Filed issue #142.

## Signature

Operator: <signed> 2026-07-01
Reviewer: <signed> 2026-07-02
```

---

## 10. Honest disclosure

What this doc does NOT yet substantiate, because the script does not
yet exist:

- **No empirical evidence today** of the rotation procedure working
  end-to-end. K1 has been reasoned about, not run.
- **No staging environment** for Tier 2 / Tier 3 drills.
- **No CI workflow** for either pre-prod gate or scheduled drill.
- **No archive bucket** for the 7-year evidence retention.

These are the gaps that close in this order:

1. Implement `scripts/dry-run-kms-rotation.sh` (LocalStack only).
2. Execute the FIRST dry-run; archive its REPORT.md.
3. Wire the pre-prod CI gate.
4. Wire the scheduled CI drill.
5. Provision staging AWS account; extend script to Tier 2; execute.
6. Provision staging GCP project; extend script to Tier 3; execute.
7. Provision the audit-evidence S3 bucket + retention.

Steps 1–4 are achievable within one developer-week. Steps 5–7 depend
on staging provisioning (a Phase H / Infra agent track).

Until step 2 completes, the K2 doc is a PROMISE, not EVIDENCE.

---

*Last updated: 2026-05-18.*
