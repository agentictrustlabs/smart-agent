# K6 — CloudTrail Monitoring and Alerting

> **Status**: DRAFT. Alerting rules specified here. None are wired in
> CloudWatch / GuardDuty / Cloud Logging yet — wiring is part of Phase H
> (Terraform / IaC track). This doc is the source of truth for what gets
> wired and why.

## 1. Scope

Detection and alerting on KMS API activity in production. Three
detection surfaces:

| Surface | Used for | Where rules live |
|---|---|---|
| **AWS CloudTrail** | API-level audit of every KMS request. | This doc § 3. |
| **AWS GuardDuty** | Behaviour analytics / anomaly detection on top of CloudTrail. | This doc § 4. |
| **GCP Cloud Audit Logs** | GCP-side equivalent of CloudTrail. | This doc § 5. |

Detection that is NOT in scope here:

- Application-layer telemetry on signing operations (per-signature
  latency, success rate). That's K3 § 7 + part of the a2a-agent's
  metrics surface, not the KMS audit surface.
- Audit-chain integrity verification (the on-chain audit-row chain).
  Different layer; lives in `docs/security/cryptographic-posture/`.

---

## 2. Why this matters

KMS is the substrate that holds the only secrets the system has at
runtime. Any unexpected activity on KMS is a top-priority security
event because:

- Every signing operation produces an on-chain effect or an
  authorization-bearing artefact.
- A successful `kms:Sign` call by an unexpected principal is evidence
  of credential compromise.
- A change to a KMS key policy is evidence of an IAM compromise.

We need to know:

- WHO made what KMS call WHEN.
- Whether the call matched the EXPECTED behaviour pattern.
- Whether anyone changed the KMS configuration outside a planned
  change window.

The next four sections specify how.

---

## 3. AWS CloudTrail

### 3.1 What CloudTrail records for KMS

CloudTrail records every KMS API call as a JSON event. The relevant
event types:

| Event | What it indicates |
|---|---|
| **`Decrypt`** | Session-package decrypt. High volume. |
| **`Encrypt`** | (Not used by us — we generate data keys, not encrypt directly.) |
| **`GenerateDataKey`** | Session-package wrap. High volume. |
| **`GenerateDataKeyWithoutPlaintext`** | (Not used by us.) |
| **`Sign`** | EVERY signing operation. Per-userOp, per-MAC, per-relay-tx. Very high volume. |
| **`Verify`** | (Not used by us — verification is done client-side via the public key.) |
| **`GenerateMac`** | Inter-service MAC origination. Volume scales with cross-service request rate. |
| **`VerifyMac`** | Inter-service MAC inbound. Volume mirrors `GenerateMac`. |
| **`GetPublicKey`** | Boot-time public-key derivation. Very low volume (≈once per service start). |
| **`DescribeKey`** | Diagnostic / liveness. Low volume. |
| **`ListKeys`** | Should be ~zero from runtime. ANY occurrence is suspicious. |
| **`CreateKey`** | Should only occur during planned provisioning or rotation. |
| **`ScheduleKeyDeletion`** | Should be EXTREMELY rare. Every occurrence is a P1 page. |
| **`PutKeyPolicy`** | Policy changes. Should only happen during planned IaC apply. |
| **`UpdateAlias`** | Alias swaps; expected during planned rotation. |
| **`DisableKey`** / **`EnableKey`** | Expected during planned rotation. |
| **`ReplicateKey`** | Multi-region key replication; expected during planned setup. |

### 3.2 Required logging configuration

CloudTrail trail configuration (per Terraform module in Phase H):

```hcl
resource "aws_cloudtrail" "smart_agent_audit" {
  name                          = "smart-agent-audit"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  include_global_service_events = true
  is_multi_region_trail         = true
  is_organization_trail         = false
  enable_log_file_validation    = true     # digest files + signature
  enable_logging                = true

  # KMS event selectors — capture object-level events on KMS resources
  event_selector {
    read_write_type           = "All"
    include_management_events = true

    data_resource {
      type   = "AWS::KMS::Key"
      values = ["arn:aws:kms"]   # every key in account
    }
  }

  cloud_watch_logs_group_arn = aws_cloudwatch_log_group.cloudtrail.arn
  cloud_watch_logs_role_arn  = aws_iam_role.cloudtrail_to_cw.arn

  kms_key_id = aws_kms_key.cloudtrail_log_encryption.arn  # encrypt the trail itself
}

resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket = "smart-agent-cloudtrail-logs-${var.environment}"

  # Object Lock = WORM. Compliance mode = immutable for retention period.
  object_lock_configuration {
    object_lock_enabled = "Enabled"
    rule {
      default_retention {
        mode = "COMPLIANCE"
        days = 2555   # 7 years for financial transactions
      }
    }
  }
}
```

Critical properties:

| Property | Why |
|---|---|
| `is_multi_region_trail = true` | KMS calls in any region are captured even if we expand beyond us-east-1. |
| `enable_log_file_validation = true` | Daily digest files signed by AWS allow detection of after-the-fact log tampering. |
| `event_selector.data_resource` | Captures object-level data events (the `Sign`, `Decrypt`, etc., calls), not just management events. **Default trails do NOT capture data events; this is required.** |
| S3 Object Lock (Compliance mode) | The trail bucket itself becomes immutable. Even an attacker with full IAM admin cannot delete log records during the retention window. |
| Separate KMS encryption key | The trail is encrypted with a KMS key SEPARATE from the operational keys. Compromise of the operational keys does not compromise the trail. |

### 3.3 Alert rules — CloudWatch Metric Filters + Alarms

Each rule is implemented as a CloudWatch Metric Filter on the
CloudTrail log group, paired with an Alarm.

#### 3.3.1 R-KMS-1 — Unusual `kms:Sign` volume spike

```
Filter: { $.eventName = "Sign" }
Metric: smart-agent/kms-sign-rate
Period: 5 minutes
Statistic: Sum
Alarm threshold: > (baseline mean + 3 stddev) per 5 min
Treat missing data as: notBreaching
Severity: P2
```

Baseline mean / stddev is computed from the trailing 30-day window via
CloudWatch Anomaly Detection. A 3σ deviation is the "investigate but
don't immediately page" threshold; 5σ pages on-call immediately.

#### 3.3.2 R-KMS-2 — KMS call from an unexpected source IP

The runtime KMS principal is the Vercel OIDC-federated role. Vercel
egresses from a published IP range
(<https://vercel.com/docs/concepts/projects/overview/security#vercel-network>);
we maintain that list in `infra/vercel-egress-ranges.json` and
re-validate quarterly.

```
Filter: {
  ($.userIdentity.sessionContext.sessionIssuer.arn = "arn:aws:iam::*:role/SmartAgent*")
  &&
  !($.sourceIPAddress IN (vercel-egress-ranges))
}
Severity: P1
```

#### 3.3.3 R-KMS-3 — `kms:Decrypt` with unexpected `EncryptionContext`

Session decrypts include `EncryptionContext` keys matching the AAD
(see `crypto.ts:buildSessionAAD`). The expected set of context keys is
fixed: `{sessionId, accountAddress, chainId, expiresAt, keyVersion}`.

```
Filter: {
  ($.eventName = "Decrypt") &&
  !($.additionalEventData.encryptionContext.sessionId EXISTS)
}
Severity: P1
```

#### 3.3.4 R-KMS-4 — `kms:Sign` from a non-Vercel-OIDC principal

```
Filter: {
  ($.eventName = "Sign") &&
  ($.userIdentity.sessionContext.sessionIssuer.userName != "VercelOIDC")
}
Severity: P0
```

(P0 because this means someone is signing with our keys WITHOUT being
the Vercel-federated runtime. The only other principals that should
appear are (a) the rotation runbook operator during a rotation window
— which should be a tagged session — and (b) the diagnose / liveness
script.)

#### 3.3.5 R-KMS-5 — Failed `kms:Sign` rate spike

```
Filter: {
  ($.eventName = "Sign") &&
  ($.errorCode EXISTS)
}
Metric: smart-agent/kms-sign-failures
Alarm: > 10 failures in 5 min
Severity: P1
```

Spikes in failed signs indicate: brute-force attempts, IAM
misconfiguration, KMS service degradation, OR our SDK bug. All require
investigation.

#### 3.3.6 R-KMS-6 — Permission policy change

```
Filter: {
  ($.eventName = "PutKeyPolicy") ||
  ($.eventName = "UpdateAlias") ||
  ($.eventName = "PutResourcePolicy")
}
Severity: P1 (P0 if outside change window)
```

Combined with a "change window" tag on the operator session (set via
AWS SSO or assume-role tag), we can elevate to P0 only when the change
happens OUTSIDE a planned window.

#### 3.3.7 R-KMS-7 — `ScheduleKeyDeletion`

```
Filter: { $.eventName = "ScheduleKeyDeletion" }
Severity: P0 always
```

Every key deletion is a P0 because it CAN be cancellation-eligible
within the pending window but the alert MUST go to a human within
minutes.

#### 3.3.8 R-KMS-8 — `kms:ListKeys` from runtime principal

```
Filter: {
  ($.eventName = "ListKeys") &&
  ($.userIdentity.sessionContext.sessionIssuer.userName = "VercelOIDC")
}
Severity: P1
```

The runtime should NEVER call `ListKeys` — it knows its key ARNs from
env. Any occurrence implies (a) the SDK is misconfigured and querying
instead of using env, OR (b) an attacker is enumerating keys.

#### 3.3.9 R-KMS-9 — `kms:GetPublicKey` rate

Public key fetches happen at boot. A sudden spike implies many
deployments OR an attacker enumerating signer addresses.

```
Filter: { $.eventName = "GetPublicKey" }
Metric: smart-agent/kms-get-pub-key-rate
Alarm: > 20 per hour
Severity: P2
```

### 3.4 Alert routing

```
P0 → PagerDuty → on-call SRE phone (≤5 min ack)
P1 → PagerDuty → on-call SRE email + Slack #sre-oncall (≤30 min ack)
P2 → Slack #sre-alerts (review within 4 hours during business)
P3 → Slack #sre-alerts (review within 24 hours)
```

PagerDuty is the target; if not yet provisioned, use Opsgenie or
Vercel's built-in alerting as an interim.

---

## 4. AWS GuardDuty

GuardDuty is opt-in and provides behaviour-pattern detection on top of
CloudTrail. For KMS specifically:

| GuardDuty finding | What it catches |
|---|---|
| **CredentialAccess:IAMUser/AnomalousBehavior** | A principal (typically our Vercel OIDC role) making API calls inconsistent with its historical pattern. |
| **Stealth:S3/ServerAccessLoggingDisabled** | If anyone disables logging on the CloudTrail bucket. |
| **UnauthorizedAccess:IAMUser/MaliciousIPCaller** | API calls from known-malicious IPs. |

Enable GuardDuty in every region in our prod account (via Phase H
Terraform). Cost: ~$30/month per region for our expected event
volume.

Findings auto-route to PagerDuty via EventBridge.

---

## 5. GCP Cloud Audit Logs

The GCP-side mirror of CloudTrail. Three log categories:

| Category | Default state | What we change |
|---|---|---|
| **Admin Activity** | Always on, cannot be disabled. | n/a — used as-is. |
| **System Event** | Always on. | n/a. |
| **Data Access** | **OFF by default for most services. MUST be enabled for Cloud KMS.** | Enable for ALL Cloud KMS resources. |

### 5.1 Enabling Data Access logging

```hcl
resource "google_project_iam_audit_config" "cloudkms" {
  project = var.project_id
  service = "cloudkms.googleapis.com"

  audit_log_config {
    log_type = "ADMIN_READ"
  }
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}
```

Without this, GCP does NOT log `cryptoKeys.encrypt`, `decrypt`,
`asymmetricSign`, `macSign`, `macVerify`. With this enabled, EVERY
call is logged.

### 5.2 Log sink to long-term storage

```hcl
resource "google_logging_project_sink" "kms_audit_to_storage" {
  name        = "smart-agent-kms-audit-sink"
  destination = "storage.googleapis.com/${google_storage_bucket.audit_logs.name}"
  filter      = <<EOT
    resource.type="cloudkms_cryptokey"
    OR resource.type="cloudkms_keyring"
    OR (resource.type="audited_resource" AND protoPayload.serviceName="cloudkms.googleapis.com")
  EOT
}

resource "google_storage_bucket" "audit_logs" {
  name                        = "smart-agent-audit-logs-${var.environment}"
  location                    = "US"
  storage_class               = "ARCHIVE"
  uniform_bucket_level_access = true

  # 7-year retention
  retention_policy {
    retention_period = 220752000   # 2555 days in seconds
    is_locked        = true        # WORM
  }

  versioning {
    enabled = true
  }
}
```

### 5.3 Alert rules (Cloud Logging metric-based alert policies)

Equivalent of § 3.3 R-KMS-1..R-KMS-9 in Log-based metrics + Alerting
Policies. Specific filters:

| Rule | Log filter (Cloud Logging query language) | Severity |
|---|---|---|
| **G-KMS-1** | `protoPayload.serviceName="cloudkms.googleapis.com" AND protoPayload.methodName="AsymmetricSign"` — alert on count anomaly | P2 |
| **G-KMS-2** | `protoPayload.requestMetadata.callerIp:* AND NOT protoPayload.requestMetadata.callerIp=(<vercel-range>)` | P1 |
| **G-KMS-3** | `protoPayload.methodName="Decrypt" AND NOT protoPayload.request.additionalAuthenticatedData=*sessionId*` | P1 |
| **G-KMS-4** | `protoPayload.authenticationInfo.principalEmail!="smart-agent-a2a-prod@*"` AND a `methodName` in the signing set | P0 |
| **G-KMS-5** | `protoPayload.serviceName="cloudkms.googleapis.com" AND protoPayload.status.code!=0` — failure spike | P1 |
| **G-KMS-6** | `protoPayload.methodName=~"^(SetIamPolicy|UpdateCryptoKey|UpdateCryptoKeyVersion)$"` | P1 |
| **G-KMS-7** | `protoPayload.methodName="DestroyCryptoKeyVersion"` | P0 |
| **G-KMS-8** | `protoPayload.methodName="ListCryptoKeys"` from runtime principal | P1 |

Routing identical to AWS — PagerDuty / Opsgenie / Slack.

---

## 6. Quarterly review

The detection rules are necessary but not sufficient. Quarterly we
sample audit records and validate they match expected operator behaviour.

### 6.1 Sampling

Once per quarter, the Security agent (or a designated reviewer):

1. Pulls a representative 1-hour window of CloudTrail events from the
   prod trail (~10,000–50,000 events depending on traffic).
2. Pulls a representative 1-hour window of Cloud Audit Logs from the
   prod GCP project.
3. Tags every event with one of: EXPECTED / UNEXPECTED-BENIGN /
   UNEXPECTED-INVESTIGATE / EXPECTED-BUT-ANOMALOUS.

### 6.2 Expected distribution

| Class | Expected ratio |
|---|---|
| EXPECTED | ≥99% |
| UNEXPECTED-BENIGN | <1% |
| UNEXPECTED-INVESTIGATE | 0% |
| EXPECTED-BUT-ANOMALOUS | <0.1% |

Any UNEXPECTED-INVESTIGATE occurrence triggers an incident review.

### 6.3 Report

`docs/security/key-management/quarterly-audit-review-<YYYY-QN>.md`:

```markdown
## Quarterly Audit Review — <YYYY-QN>

- **Reviewer**: <Security agent>
- **Window sampled**: <ISO start>–<ISO end>
- **Total events**: <N>
- **By class**:
  - EXPECTED: <count> (<%>)
  - UNEXPECTED-BENIGN: <count> (<%>)
  - UNEXPECTED-INVESTIGATE: <count> (<%>)
  - EXPECTED-BUT-ANOMALOUS: <count> (<%>)
- **Investigations triggered**: <N>; details in linked incident reports.
- **Detection rule changes recommended**: <list>
- **Sign-off**: <Security + Infra + Reviewer agent>
```

Reviewed by Security + Reviewer agents.

---

## 7. Retention

Per § 1.2 of K2 (evidence retention):

| Source | Retention |
|---|---|
| CloudTrail log files (S3) | **7 years** (financial-transaction default). |
| CloudTrail digest files | **7 years** (same bucket; signed by AWS for integrity). |
| Cloud Audit Logs (GCP Storage) | **7 years**. |
| CloudWatch Logs (real-time trail mirror) | 90 days (real-time query window only). |
| Cloud Logging (real-time GCP mirror) | 30 days (Cloud Logging default; override). |
| PagerDuty incident records | 7 years. |
| Quarterly review reports | Forever (git). |

7 years aligns with SOX retention (which is the strictest of the
relevant US standards for financial-transaction logs). FedRAMP also
requires multi-year retention; 7 years covers both.

---

## 8. CI integration — guard against drift

### 8.1 Phase G CI guard: log filter sync

A CI guard that asserts the alert rules in `infra/terraform/{aws,gcp}/`
match the canonical rules in this doc. Drift fails CI.

```bash
# Proposed scripts/check-k6-alert-sync.sh
# Compare:
#   - Rules listed in docs/security/key-management/K6-cloudtrail-monitoring-and-alerting.md § 3.3
#   - Rules in infra/terraform/aws/cloudwatch-alarms.tf
# Assert: every K6 rule has a corresponding terraform resource.
```

### 8.2 Quarterly alert review

The on-call reviews the previous quarter's PagerDuty alerts and
classifies them:

- True positive → investigate; document outcome.
- False positive → tune the rule; document the change.
- Noise → consider raising the threshold.

This is the K6 anti-fatigue practice. Rules that are noisy MUST be
tuned or removed.

---

## 9. Honest disclosure

| Claim | True today? |
|---|---|
| "Every KMS call is captured in CloudTrail." | NO — default trails do not capture data events; we have not yet enabled the event_selector. |
| "Every KMS call in GCP is captured in Cloud Audit Logs." | NO — Data Access logging for cloudkms.googleapis.com is OFF by default; we have not enabled it. |
| "We page on suspicious KMS activity." | NO — no PagerDuty / Opsgenie / alert routing wired. |
| "We retain audit logs for 7 years." | NO — current LocalStack-only deployment has no audit log retention. |
| "We sample audit logs quarterly." | NO — first quarterly review has not been done. |

What this doc commits us to landing:

1. Phase H Terraform modules wire up CloudTrail with event_selector,
   Cloud Audit Logs with Data Access, log sinks to long-term WORM
   storage, retention policies.
2. Phase H wires the alert rules R-KMS-1..9 and G-KMS-1..8 in
   CloudWatch / Cloud Logging.
3. Phase H wires alert routing to PagerDuty / Opsgenie.
4. The first quarterly review happens within 3 months of prod live.

Until those land:

- We have no real-time detection of KMS misuse.
- We have no audit retention beyond LocalStack memory.
- We are not auditable.

---

## 10. Reference card

| AWS | GCP |
|---|---|
| CloudTrail event_selector on `AWS::KMS::Key` | Enable Data Access audit logs for `cloudkms.googleapis.com` |
| CloudWatch Logs + CloudWatch Alarms | Cloud Logging + Alerting Policies |
| S3 with Object Lock (WORM) | GCS bucket with retention_policy `is_locked = true` |
| GuardDuty | Security Command Center (or SCC Premium) |
| EventBridge → PagerDuty | Pub/Sub → PagerDuty |
| `aws cloudtrail lookup-events` | `gcloud logging read` |

---

*Last updated: 2026-05-18.*
