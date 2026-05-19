# O4 — Backup Procedures

> **Status**: DRAFT. **No production backups exist today.** Every
> stateful path is currently a developer-local file: SQLite databases
> in `apps/*/local.db` and Askar vaults in `apps/*/askar-stores/` —
> wiped on every `fresh-start.sh` run. There is no Postgres production
> instance yet (Spec 007 Phase F.2 introduces it), no off-machine
> backup, no recovery rehearsal.
>
> This document scopes the production backup posture: WHAT we back up,
> WHEN we back it up, WHERE we store it, HOW we recover, and how we
> KNOW the backups work.
>
> **Effort**: L (2–3 weeks: Postgres backup wiring, Askar export
> tooling, KMS metadata snapshots, restore-and-verify pipeline).
> **Owner**: Infra lead + Security reviewer.
> **Depends on**: Spec 007 Phase F.2 (Postgres exists and owns state),
> Spec 007 Phase H (Terraform manages backup buckets).
> **Unblocks**: DR2 (backup verification), O5 (RTO/RPO targets),
> DR4 (mainnet transition has a known recovery path).

---

## 1. Today's state (honest)

| Asset | Today | Production gap |
|---|---|---|
| `apps/web/local.db` | Local SQLite; wiped on fresh-start | No prod backup. Post-F.2 lives in Postgres. |
| `apps/person-mcp/person-mcp.db` | Local SQLite | No prod backup. Post-F.2 lives in Postgres. |
| `apps/org-mcp/org-mcp.db`, `org-private.db` | Local SQLite | No prod backup. Post-F.2 lives in Postgres. |
| `apps/*/askar-stores/` | Local Askar (encrypted KV) | No prod backup. AnonCred wallets; loss = unrecoverable. |
| KMS keys (AWS / GCP) | Provisioned per Sprint 5 / G-PR; no backup of metadata | KMS itself is durable; key POLICIES and ALIASES are config-as-code (Terraform) but not currently snapshotted. |
| `.env` config files (~10 services × ~30 vars) | Per-machine; no central store | Should live in cloud secret manager + IaC; not backed up today. |
| Contract source + deploy addresses | Git + `apps/web/.env` | Source is in Git (good). Deployed addresses live in env vars; lose them, lose the contract reference. |
| On-chain state | Anvil (dev); no chain yet (prod) | Mainnet is durable by construction. |
| GraphDB (graphdb.agentkg.io) | External; no fallback (DR3) | Out of scope here — see DR3. |
| Audit checkpoints | Local SQLite + `AUDIT_CHECKPOINT_SINK_URL` (Sprint 5 P1-5) | The sink IS the backup for audit chain; this doc covers the local mirror. |

If we lost the production machine today (no production exists), zero
data would be recoverable. O4 fixes this for the production we're
about to deploy.

---

## 2. Goals

1. **Every authoritative datastore has at least one automated backup
   per day** stored in a different region than primary.
2. **Backups are encrypted at rest.** Customer-managed KMS keys; the
   backup bucket is not readable by the backup writer's identity.
3. **Backups are integrity-checked.** Each backup's SHA-256 hash is
   written to a separate audit channel; restore verifies the hash.
4. **Restore is rehearsed.** A weekly automated restore-and-verify
   (DR2) catches silent backup corruption.
5. **Backup retention matches the data class.** PII data follows
   `docs/security/privacy-and-compliance/` — never longer than
   declared retention.
6. **No backup is single-sourced.** Cross-region replication is
   mandatory for Tier 1 backups.

---

## 3. Asset-by-asset backup plan

### 3.1 Postgres (per Spec 007 Phase F.2)

**Primary**: AWS RDS Postgres 16 (multi-AZ; DR1). Each per-service
database (`web`, `a2a_agent`, `person_mcp`, `org_mcp`, etc.) is its
own logical DB on the shared instance.

**Backup methods**:

1. **AWS RDS automated snapshots** — daily full backup at 04:00 UTC;
   7-day retention. Free with the RDS instance.
2. **AWS RDS continuous PITR** (point-in-time recovery) — WAL stream
   captured continuously; 35-day retention. Free with the RDS instance.
3. **Per-database `pg_dump` weekly** — Sunday 02:00 UTC; uploaded to
   S3 in the DR region (`us-west-2`). Retention: 12 months for non-PII
   databases (`a2a_agent`, `web`), 30 days for PII databases
   (`person_mcp`, `org_mcp`, `family_mcp`) per privacy policy.
4. **`pg_dump` of full schema (no data)** — daily at 04:30 UTC;
   uploaded to S3 + Git. Schema drift detection.

```bash
# scripts/backup-postgres.sh (new)
set -euo pipefail

DB="$1"            # e.g. person_mcp
PG_URL="${PG_URL:?missing}"
S3_BUCKET="${S3_BUCKET:-smart-agent-backups-us-west-2}"
KMS_KEY_ID="${BACKUP_KMS_KEY_ID:?missing}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
TMPFILE="$(mktemp)"

pg_dump --format=custom --compress=9 --no-owner --no-acl \
  "$PG_URL/$DB" > "$TMPFILE"

SHA="$(sha256sum "$TMPFILE" | awk '{print $1}')"
KEY="postgres/$DB/$TS.dump"

aws s3 cp "$TMPFILE" "s3://$S3_BUCKET/$KEY" \
  --sse aws:kms \
  --sse-kms-key-id "$KMS_KEY_ID" \
  --metadata "sha256=$SHA"

# Hash → separate audit channel (write-once log).
aws s3 cp - "s3://$S3_BUCKET-hashes/postgres/$DB/$TS.hash" \
  --sse aws:kms --sse-kms-key-id "$KMS_KEY_ID" <<< "$SHA  $KEY"

rm "$TMPFILE"
```

Schedule: GitHub Actions cron OR AWS EventBridge → Lambda. Lambda is
preferred (no external dependency for backup execution).

**Restore time**: ~10 min for `person_mcp` (estimated 5 GB at 1 yr of
growth); ~5 min for smaller DBs. PITR restore: ~15 min for a 1-week-
old recovery point.

### 3.2 Askar vault (AnonCred wallets)

Askar is the encrypted KV store for AnonCred holder + issuer state.
Loss = unrecoverable credentials (the issuer's private signing key
lives here; holders' link secrets live here).

**Backup method**:

Askar exposes `Store.export` which produces an encrypted Aries Askar
export file. The export key is a fresh symmetric key per export; the
key itself is sealed to the backup KMS key.

```bash
# scripts/backup-askar.sh (new)
SERVICE="$1"      # e.g. person-mcp
ASKAR_PATH="apps/$SERVICE/askar-stores"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

# Generate ephemeral export key.
EXPORT_KEY="$(openssl rand -hex 32)"

# Export the vault.
pnpm exec tsx scripts/askar-export.ts \
  --in "$ASKAR_PATH" \
  --out "/tmp/askar-$SERVICE-$TS.aks" \
  --key "$EXPORT_KEY"

# Seal the export key to KMS.
WRAPPED_KEY=$(aws kms encrypt \
  --key-id "$BACKUP_KMS_KEY_ID" \
  --plaintext "$EXPORT_KEY" \
  --output text --query CiphertextBlob)

# Upload both.
aws s3 cp "/tmp/askar-$SERVICE-$TS.aks" \
  "s3://$S3_BUCKET/askar/$SERVICE/$TS.aks" \
  --sse aws:kms --sse-kms-key-id "$KMS_KEY_ID"
aws s3 cp - \
  "s3://$S3_BUCKET/askar/$SERVICE/$TS.wrapkey" \
  --sse aws:kms --sse-kms-key-id "$KMS_KEY_ID" <<< "$WRAPPED_KEY"

rm "/tmp/askar-$SERVICE-$TS.aks"
```

**Cadence**: daily at 04:00 UTC + on-demand before any Askar schema
change.

**Retention**: 90 days for active services. 1 year for closed/sunset
services (allows post-shutdown credential recovery requests).

**Restore time**: ~2 min per service (Askar import is fast).

### 3.3 KMS key metadata

KMS keys themselves are durable (AWS / GCP guarantees). What we back
up is the **metadata**: key aliases, key policies, IAM grants, rotation
schedules, audit trail of key usage.

This is config-as-code (Terraform per Spec 007 Phase H). The backup IS
the Git repo. Additionally:

```bash
# scripts/backup-kms-metadata.sh (new)
# Snapshot of every key + policy + alias in our two clouds.
TS="$(date -u +%Y%m%dT%H%M%SZ)"

for REGION in us-east-1 us-west-2; do
  aws kms list-keys --region $REGION | jq -r '.Keys[].KeyId' | while read KEY_ID; do
    OUT="/tmp/kms-$REGION-$KEY_ID-$TS.json"
    aws kms describe-key --key-id $KEY_ID --region $REGION > "$OUT"
    aws kms list-aliases --key-id $KEY_ID --region $REGION > "$OUT.aliases"
    aws kms get-key-policy --key-id $KEY_ID --policy-name default --region $REGION > "$OUT.policy"
    # Upload.
    aws s3 cp "$OUT"        "s3://$S3_BUCKET/kms-metadata/$REGION/$KEY_ID/$TS.describe.json"
    aws s3 cp "$OUT.aliases" "s3://$S3_BUCKET/kms-metadata/$REGION/$KEY_ID/$TS.aliases.json"
    aws s3 cp "$OUT.policy"  "s3://$S3_BUCKET/kms-metadata/$REGION/$KEY_ID/$TS.policy.json"
  done
done
```

Cadence: daily. Retention: 7 years (audit lineage).

KMS key MATERIAL is never backed up — that's the entire point of KMS
(non-exportable). Recovery from "key material lost" is not a backup
problem; it's a re-issue + re-bind problem (K3 break-glass).

### 3.4 Configuration (`.env`, Terraform state, secrets)

**Today**: `.env` files per service on each developer's machine. No
prod equivalent.

**Production**:
- Application config → AWS SSM Parameter Store (or GCP Secret Manager).
- Terraform state → S3 with versioning + KMS encryption.
- Per-environment manifest → Git (in `infra/terraform/environments/`).

**Backup**: SSM Parameter Store backed up via Terraform state (which
itself is in S3, versioned + KMS-encrypted, cross-region replicated to
DR region). Restore: `terraform apply` from a previous Git SHA + state
snapshot.

### 3.5 Contract source + deploy addresses

**Source**: Git. Backed up by GitHub (Microsoft-operated, multi-region)
and by daily `git push --mirror` to a secondary remote (S3 backup or
self-hosted Gitea).

**Deploy addresses**: today in `apps/web/.env`. Post-Spec-007 Phase H:
in SSM Parameter Store, mirrored to Git as `infra/contracts/<chain>/<env>/addresses.json`.

Backup retention: forever. A contract address from 2026 may still need
to be referenced in 2036 (immutable smart contracts).

### 3.6 Audit chain

Spec 005 + Sprint 5 P1-5 already define this: every audit row is
hash-chained, and `AUDIT_CHECKPOINT_SINK_URL` flushes a witness to an
external sink. The sink IS the backup.

This doc adds:
1. **Local audit-row mirror to S3** — daily incremental upload of new
   audit rows since the last upload. Allows fast forensic queries
   without hitting the external sink's query API.
2. **Cross-region replication** of the audit-chain S3 bucket.

### 3.7 On-chain state

Mainnet: durable by construction. No backup needed (the chain itself
is the backup). For non-mainnet (anvil dev, testnet), we don't back up
— state is regenerated by replay.

### 3.8 Logs

Service logs go to AWS CloudWatch (default 30-day retention) and are
shipped to Datadog for 15-month retention. Both are managed; no
additional backup needed. Per O7, runbooks rely on log access for ≥30
days of incidents.

---

## 4. Cadence summary

| Asset | Full backup | Incremental / PITR | Retention | Cross-region |
|---|---|---|---|---|
| Postgres (managed snapshots) | Daily 04:00 UTC | Continuous WAL | 35 days PITR | RDS automated |
| Postgres (`pg_dump`) | Weekly Sun 02:00 UTC | — | 12 mo (non-PII) / 30 d (PII) | S3 cross-region |
| Postgres schema-only | Daily 04:30 UTC | — | 1 year | S3 + Git |
| Askar vaults | Daily 04:00 UTC | — | 90 days active / 1 yr closed | S3 cross-region |
| KMS metadata | Daily | — | 7 years | S3 cross-region |
| Terraform state | Per-apply | Versioned | Forever | S3 cross-region |
| SSM Parameter Store | Snapshot via Terraform | — | Per version, 1 yr | S3 cross-region |
| Audit chain (mirror) | Continuous (1 min lag) | — | 7 years | S3 cross-region |
| Logs (CloudWatch + Datadog) | Continuous | — | 30 d (CW) / 15 mo (DD) | Datadog handles |

---

## 5. Storage layout

```
s3://smart-agent-backups-us-west-2/
├── postgres/
│   ├── web/          YYYYMMDDTHHMMSSZ.dump
│   ├── a2a_agent/
│   ├── person_mcp/
│   ├── org_mcp/
│   └── ...
├── askar/
│   ├── person-mcp/   YYYYMMDDTHHMMSSZ.aks
│   ├── person-mcp/   YYYYMMDDTHHMMSSZ.wrapkey
│   └── ...
├── kms-metadata/
│   ├── us-east-1/
│   └── us-west-2/
├── audit-mirror/
│   └── YYYY/MM/DD/HH/<hashprefix>.jsonl
├── terraform-state/
│   └── (versioned + cross-region replicated)
└── schemas/
    └── YYYYMMDD.sql

s3://smart-agent-backups-us-west-2-hashes/
└── postgres/
    ├── web/          YYYYMMDDTHHMMSSZ.hash
    └── ...

s3://smart-agent-backups-eu-west-1/ (cross-region replica)
└── (mirror of us-west-2)
```

Buckets:
- Object Lock (compliance mode, 7-day legal hold default; longer for
  audit chain) — prevents ransomware / insider deletion.
- KMS-encrypted (customer-managed key in a separate AWS account if
  feasible; minimum: separate IAM role).
- Versioning enabled.
- Cross-region replication to `eu-west-1` (different cloud provider
  region per AWS-account-suspension scenario in K3 O2).

---

## 6. Restore procedures

Each asset has a documented restore procedure with target RTO. See
also DR2 for the verification pipeline.

### 6.1 Postgres — full restore

```bash
# scripts/restore-postgres.sh (new)
DB="$1"                  # e.g. person_mcp
BACKUP_KEY="$2"          # e.g. postgres/person_mcp/20260518T040000Z.dump
TARGET_URL="$3"          # e.g. postgres://restore-host:5432/

aws s3 cp "s3://$S3_BUCKET/$BACKUP_KEY" "/tmp/restore.dump"

# Verify hash.
EXPECTED_HASH=$(aws s3 cp "s3://$S3_BUCKET-hashes/${BACKUP_KEY%.dump}.hash" -)
ACTUAL_HASH=$(sha256sum /tmp/restore.dump | awk '{print $1}')
[[ "$EXPECTED_HASH" =~ ^"$ACTUAL_HASH" ]] || { echo "hash mismatch" >&2; exit 1; }

# Restore.
createdb -h restore-host -U postgres "$DB-restored"
pg_restore --no-owner --no-acl \
  -h restore-host -U postgres \
  -d "$DB-restored" \
  /tmp/restore.dump
```

Target RTO: 10 min for `person_mcp`-class DB (5 GB). Includes download
from S3, hash verify, and restore.

### 6.2 Postgres — PITR

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier smart-agent-prod \
  --target-db-instance-identifier smart-agent-prod-pitr-$(date +%s) \
  --restore-time "2026-05-18T03:45:00Z"
```

Target RTO: 15-30 min (RDS creates a new instance).

### 6.3 Askar — full restore

```bash
# scripts/restore-askar.sh (new)
SERVICE="$1"
TS="$2"
TARGET="apps/$SERVICE/askar-stores"

aws s3 cp "s3://$S3_BUCKET/askar/$SERVICE/$TS.aks" /tmp/restore.aks
WRAPPED=$(aws s3 cp "s3://$S3_BUCKET/askar/$SERVICE/$TS.wrapkey" -)

# Unwrap export key.
EXPORT_KEY=$(aws kms decrypt --ciphertext-blob fileb:///dev/stdin \
  --output text --query Plaintext <<< "$WRAPPED" | base64 -d)

# Import.
pnpm exec tsx scripts/askar-import.ts \
  --in /tmp/restore.aks \
  --out "$TARGET" \
  --key "$EXPORT_KEY"
```

Target RTO: 5 min.

### 6.4 Configuration — restore from Terraform

```bash
cd infra/terraform/environments/prod
git checkout <last-known-good-sha>
terraform init
terraform apply -auto-approve
```

Target RTO: 30 min (Terraform plan/apply for a multi-service
environment).

### 6.5 Full-disaster restore

If the entire production environment is gone (AWS account suspended,
region-wide event, etc.), DR4 covers the failover to the alternate
region or alternate cloud. O4 provides the data; DR4 provides the
runbook.

---

## 7. Verification (forward to DR2)

A backup we haven't restored is a hope, not a backup. DR2 specifies
the weekly automated restore-and-verify pipeline:

1. Pick a random backup from the last 7 days.
2. Restore to an ephemeral RDS instance + Askar staging path.
3. Run a 50-query smoke test (counts, well-known-row reads).
4. Report success/failure to PagerDuty.
5. Tear down the ephemeral resources.

See `docs/security/reliability-and-dr/DR2-backup-verification.md` for
the detail.

---

## 8. Files to create/change

### New scripts

- `scripts/backup-postgres.sh`
- `scripts/backup-askar.sh`
- `scripts/backup-kms-metadata.sh`
- `scripts/restore-postgres.sh`
- `scripts/restore-askar.sh`
- `scripts/askar-export.ts`
- `scripts/askar-import.ts`

### New infrastructure (Terraform, per Spec 007 Phase H)

- `infra/terraform/backup/s3-buckets.tf` — backup + hash + DR-region
  buckets, Object Lock, KMS, cross-region replication.
- `infra/terraform/backup/lambda-postgres-backup.tf` — Lambda + cron.
- `infra/terraform/backup/lambda-askar-backup.tf` — Lambda + cron.
- `infra/terraform/backup/kms-backup-key.tf` — customer-managed KMS
  key for backup encryption (separate from operational KMS keys).

### Runbooks

- `docs/runbooks/restore-postgres.md`
- `docs/runbooks/restore-askar.md`
- `docs/runbooks/restore-from-disaster.md`

### Memory

- Memory: `project_o4_backup_posture.md` summarising the cadence +
  retention matrix.

---

## 9. Cost

| Item | Cost |
|---|---|
| S3 Standard storage (1 TB) × 2 regions | $46/mo |
| S3 Object Lock | $0 (no upcharge) |
| S3 cross-region replication transfer (estimate 50 GB/mo) | ~$1/mo |
| Lambda invocations (10/day) | $0 (well within free tier) |
| KMS key (1 customer-managed) | $1/mo |
| RDS automated snapshots | $0 (free with RDS) |
| RDS PITR | $0 (free with RDS) |
| Datadog log retention (15 mo) | $0.10/GB-mo ingested |

Total marginal: ~$60–100/mo at current data shape; scales linearly
with data growth.

---

## 10. Acceptance criteria

- [ ] Every asset in §3 has an automated daily backup (or continuous
      for PITR-eligible assets).
- [ ] Every backup has its SHA-256 hash written to a separate audit
      channel.
- [ ] Every backup bucket has cross-region replication enabled.
- [ ] Every backup bucket has Object Lock enabled in compliance mode.
- [ ] Every backup bucket is encrypted with a customer-managed KMS
      key.
- [ ] Each restore procedure is documented in `docs/runbooks/`.
- [ ] DR2's weekly restore-and-verify pipeline is wired and green for
      4 consecutive weeks before this plan is marked complete.
- [ ] PII retention matches the privacy policy.

---

## 11. Test plan

### 11.1 Unit / integration

- `test/backup/postgres-backup.test.ts` — exercises the backup script
  against a local Postgres; asserts the dump is restorable and the
  hash matches.
- `test/backup/askar-export-import.test.ts` — round-trips an Askar
  vault through export + import; asserts byte-for-byte equality of
  exported records.

### 11.2 Operational rehearsals

- Monthly: manual restore of one random Postgres backup to a staging
  instance. Smoke-test 5 representative queries.
- Quarterly: full disaster-recovery drill per `docs/runbooks/restore-
  from-disaster.md`. Time the recovery; record in
  `output/dr-drill-YYYY-MM.md`.

---

## 12. Rollback

If a backup mechanism causes production issues (e.g. lock contention
from `pg_dump`):

1. Switch from `pg_dump` to RDS-only snapshots (RDS snapshots are
   crash-consistent with no lock pressure).
2. Disable Lambda cron via Terraform.
3. Investigate root cause; re-enable when fixed.

RDS automated snapshots are the never-disable foundation; everything
else is incremental risk reduction on top.

---

## 13. Open questions

- **OQ-O4-1**: Do we need a customer-export feature (GDPR Right to
  Data Portability) backed by the backup buckets? Proposed: no — that's
  a separate live-export from `person-mcp`, not from backups. Keep
  backups operator-only.
- **OQ-O4-2**: How long should we keep audit-chain backups? Sox
  recommends 7 years; we're not Sox-bound. Proposed: 7 years to match
  banking-adjacent expectation and the K-management chain retention.
- **OQ-O4-3**: Should we encrypt with a HSM-rooted KMS for the backup
  key (vs SoftHSM-default)? Proposed: HSM-rooted matches K4's stance;
  cost is $1/key/mo and worth it for the backup root.
- **OQ-O4-4**: Cross-cloud backup (S3 → GCS for true vendor-independent
  recovery)? Proposed: deferred to DR4 + DR5; not required for v1
  production launch.
- **OQ-O4-5**: Who has access to restore? Proposed: only the
  `backup-restore` IAM role, assumable by Director of Engineering +
  Security reviewer + on-call lead. Restore actions audit-logged with
  ticket reference.
