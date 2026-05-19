# A2 — Log Retention Policy

> **Status**: Draft. The audit chain primitive exists; this doc names
> retention durations per log source, the storage tier for each
> duration band, the retrieval SLA, and the legal-hold override path.
>
> **Effort**: S (config) + M (lifecycle automation) + ongoing cost
> ($50–$200/mo at our scale; grows linearly with traffic).
>
> **Owner**: security + legal + infra.
>
> **Reading time**: ~15 min.

---

## 1. Goals

1. Every log source has a documented retention duration justified by a
   regulation, a customer commitment, or a security need.
2. Every retention duration is enforced by an automated lifecycle policy
   — not a calendar reminder.
3. Storage cost is the minimum compatible with the retention requirement
   (hot → warm → cold tiers).
4. We can put any source under **legal hold** within 1 hour of receiving
   a preservation order.
5. We can delete on schedule for sources whose retention has expired —
   delivering on data-minimisation requirements (GDPR Art 5(1)(e),
   CCPA §1798.105).

## 2. Sources inventory

The log sources Smart Agent emits, in order of forensic value:

| ID | Source | Volume estimate | Sensitivity |
|---|---|---|---|
| L1 | `execution_audit` table (a2a-agent SQLite, hash-chained) | ~5k rows/day at current scale; ~500k/day at 100× growth | High — every authority-bearing decision |
| L2 | `audit_log` table (person-mcp SQLite, hash-chained) | ~3k rows/day | High — PII access decisions |
| L3 | `audit_log` table (org-mcp, when landed) | TBD | High |
| L4 | `audit_checkpoint` rows + S3 anchor objects + ETH anchor txs | 96 rows/day local + 96/day S3 + 1/week ETH | Medium — derived from L1 |
| L5 | a2a-agent stdout / Vercel logs | ~50 MB/day | Medium — operational |
| L6 | web stdout / Vercel logs | ~30 MB/day | Medium |
| L7 | person-mcp / org-mcp stdout | ~10 MB/day each | Medium |
| L8 | KMS CloudTrail (AWS) + Cloud Logging (GCP) | bursty, ~5 MB/day | High — every KMS API call |
| L9 | Postgres slow query log + general log | ~5 MB/day (once Phase F.2 lands Postgres) | Medium |
| L10 | WAF events (Cloudflare / AWS WAF, per R2) | bursty, ~1k events/day baseline | Medium |
| L11 | Tamper-evident dispatch logs (manager → agents) | ~500 events/day | Low — internal team ops |
| L12 | Access logs (Vercel edge, ALB) | ~100k req/day | Medium |
| L13 | Bundler / userOp submission logs | ~100/day | High — payment-adjacent |
| L14 | Browser-side error / RUM (if added) | optional | Low |

## 3. Retention durations

Each row below cites the controlling requirement. Where two requirements
apply, the **longer** wins.

| ID | Retention | Controlling requirement |
|---|---|---|
| L1 | **7 years** | Financial transaction record (SEC 17a-4 analogue for crypto custody; FinCEN guidance for VASPs requires 5 yrs minimum; 7 yrs aligns with SOX §802 + IRS §6501(e) extended-statute window). |
| L2 | **7 years** | Same — person-mcp authorises PII reads that themselves feed financial flows. Conservatively classified as financial-adjacent. |
| L3 | **7 years** | Same. |
| L4 | **7 years** (S3 Object Lock retains automatically per A1 §4.3) | Same; the anchor's whole purpose is to outlast L1 attacks. |
| L5 | **90 days hot + 7 years cold** | Operational logs are tied to L1 via correlation id (A5); deleting them ahead of L1 leaves a forensic hole. 90 days hot covers customer-support window; cold is regulatory. |
| L6 | **90 days hot + 7 years cold** | Same. |
| L7 | **90 days hot + 7 years cold** | Same. |
| L8 | **7 years** | Covered by K6 — `docs/security/key-management/K6-cloudtrail-monitoring-and-alerting.md`. This row records the cross-link, not a new policy. |
| L9 | **90 days hot + 1 year cold** | Schema-change history matters for performance forensics; short cold tier is sufficient. |
| L10 | **90 days hot + 1 year cold** | DDoS / abuse forensics typically resolves within months. |
| L11 | **7 years** | Manager dispatches authorise paid actions transitively; same financial-transaction class. |
| L12 | **90 days** | GDPR data-minimisation: edge access logs contain PII (IP). Retain only as long as fraud-investigation typical window. |
| L13 | **7 years** | Financial. |
| L14 | **30 days** | Operational, no PII (sanitised before emit). |

`[DECISION]` — 7 years is the dominant retention class. The 90-day +
cold-tier pattern (L5/L6/L7) is the cost-optimisation that lets us hit
that without paying hot-tier prices for years of data we'll rarely touch.

## 4. Storage tiering

Three tiers; every long-retention log moves through them automatically.

| Tier | Latency | Cost (per GB-month, AWS as ref) | Use |
|---|---|---|---|
| **Hot** (Datadog / Splunk / a2a SQLite + Vercel logs) | < 1 s search | $1.50–$3.00 hot SIEM ingest; $0 SQLite (disk) | Last 90 days; daily operational use; SIEM detection rules. |
| **Warm** (S3 Standard) | seconds (API GET) | $0.023 | 90 days – 1 year, or 90 days – 7 years for L5/L6/L7. |
| **Cold** (S3 Glacier Instant Retrieval) | seconds (API GET, same SDK call) | $0.004 | 1 yr – 7 yr (or wherever the long-tail starts). |
| **Deep cold** (S3 Glacier Deep Archive) | 12 h retrieval | $0.00099 | Optional — only for L5/L6/L7 cold band if cost matters. |

Citations:
- AWS S3 pricing: <https://aws.amazon.com/s3/pricing/>.
- Glacier Instant Retrieval pricing: same page (IR launched Nov 2021).
- NIST SP 800-92 §4.3.2 "Log Storage" recommends tiered storage with
  documented retrieval SLAs: <https://csrc.nist.gov/publications/detail/sp/800-92/final>.

### 4.1 Lifecycle policy template (S3)

Applied to the application-log archive bucket (NOT the audit-anchor
bucket — that has a flat 7-yr Object Lock per A1):

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "log_archive" {
  bucket = aws_s3_bucket.log_archive.bucket

  rule {
    id     = "app-logs-tier"
    status = "Enabled"
    filter { prefix = "app-logs/" }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = 365
      storage_class = "GLACIER_IR"
    }
    expiration {
      days = 2555  # ~7 yrs
    }
  }

  rule {
    id     = "edge-access-logs"
    status = "Enabled"
    filter { prefix = "edge-access/" }
    expiration {
      days = 90  # L12 — strict 90 days
    }
  }
}
```

### 4.2 Per-source storage routing

| ID | Hot | Cold archive |
|---|---|---|
| L1, L2, L3 | a2a/person/org-mcp SQLite + Datadog (live tail) | Daily dump to S3 `app-logs/audit-chain/<service>/<yyyy-mm-dd>/` — encrypted, lifecycle-managed |
| L4 | local `audit_checkpoint` table (30-day GC) | S3 Object Lock (A1) — independently retained |
| L5, L6, L7 | Vercel log drains → Datadog Logs | Datadog → S3 archive forwarder, lifecycle as 4.1 |
| L8 | CloudTrail Lake (AWS) / Cloud Logging (GCP) | Same — CloudTrail Lake supports 7-yr retention natively |
| L9 | Postgres `log_statement` → CloudWatch / GCP logging | S3 archive forwarder |
| L10 | Cloudflare / AWS WAF dashboards | S3 archive |
| L11 | manager-local SQLite | Daily S3 dump |
| L12 | Vercel access logs | 90-day S3 retention, then expire |
| L13 | bundler service logs → Datadog | S3 archive |
| L14 | Datadog RUM (built-in 30d) | none |

## 5. Retrieval SLA per tier

| Tier | SLA |
|---|---|
| Hot | Operator query result in < 5 s (interactive) |
| Warm | Operator can present the data within 15 minutes (API fetch + parse) |
| Cold (Glacier IR) | Within 1 hour |
| Deep cold (Deep Archive) | Within 24 hours |

These are also the SLAs we commit to in DPAs / SLAs / regulatory
responses. If a customer is on a contract with a faster retrieval clause,
that contract overrides — and the customer's data set is held in a higher
tier for the contract duration.

`[OWE-REVIEWER]` — name the retrieval SLA in the standard MSA template.

## 6. Cost projection

At current load (~50 MB/day across all sources combined into S3, growing
to ~500 MB/day at 10× scale):

| Tier | Volume at full retention | Cost/mo |
|---|---|---|
| Hot (Datadog Logs, 30d) | ~1.5 GB/mo | ~$30 (Datadog Logs ingest @ ~$0.10/GB + index) |
| Warm (S3 Standard, days 90–365) | ~14 GB total | $0.30/mo |
| Cold (Glacier IR, years 1–7) | ~125 GB total | $0.50/mo |
| **Sub-total at current scale** |  | **~$31/mo** |
| **Sub-total at 10× scale** |  | **~$300/mo** (Datadog dominates) |

`[DECISION]` — keep Datadog ingest the only meaningful line item. If
Datadog cost exceeds $1k/mo, consider running OpenSearch / ELK on AWS
directly. R&D effort to migrate ≈ 4 dev-weeks.

`[OPEN] A2-1`: Should we negotiate annual commitment with Datadog for the
~30% discount? Probably yes once we're past $500/mo recurring.

## 7. Legal hold override

When we receive a preservation order (subpoena, civil discovery,
regulatory inquiry, internal-investigation hold), the affected sources
move to **legal-hold mode**:

1. **Within 1 hour**: incident commander (A6 §1) creates a hold record
   in `docs/security/legal-holds/<YYYY-MM-DD>-<short-name>.md` describing
   scope, requesting party, sources affected, and expected duration.
2. **Within 4 hours**: infra runs `scripts/apply-legal-hold.sh
   <hold-id> --sources L1,L5,L12`. This:
   - Suspends the affected lifecycle rule (Terraform-driven; PR opened).
   - Tags every relevant S3 object with `legal-hold=<hold-id>` (
     `s3:PutObjectLegalHold` API).
   - Tags relevant Datadog logs with `@legal_hold:<hold-id>`.
   - Pauses any database-level retention scrubber for the affected
     table (Postgres `pg_cron` for L9 — Phase F.2).
3. **Until release**: scheduled deletion is **blocked**. Routine queries
   continue normally — hold is non-disruptive.
4. **Release**: same script with `--release <hold-id>`. Tagged objects
   return to normal lifecycle.

The 1-hour and 4-hour SLAs are tabletop-tested quarterly in A6 §9.

### 7.1 Why S3 Object Lock is not enough for legal hold

Object Lock retention is **time-based**, not event-based. A legal hold
can be indefinite. We use S3's separate `s3:PutObjectLegalHold` API
(distinct from `s3:PutObjectRetention`), which holds the object until
explicit release. The two stack — Object Lock guarantees minimum 7 yrs;
legal hold extends as needed.

Citation: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-overview.html#object-lock-legal-holds>.

## 8. Deletion on expiry

Where retention has lapsed AND no legal hold applies, the data is
deleted by automated lifecycle policy. The deletion event is itself
logged — to `execution_audit` for application-controlled deletions, and
to S3 Server Access Logs for bucket-level deletions. The deletion log
itself is retained 7 yrs (NIST SP 800-53 SI-12).

`[OWE-REVIEWER]` — add a CI test that fixtures a synthetic 7-year-old
object and asserts the lifecycle rule expires it on the next sweep.

## 9. Implementation tasks

| # | Task | Owner | Effort |
|---|---|---|---|
| A2-T1 | Provision `smart-agent-log-archive-prod` S3 bucket (Terraform, Phase H) | infra | S |
| A2-T2 | Wire Vercel log drains → Datadog for L5/L6/L7 | infra | S |
| A2-T3 | Wire Datadog → S3 archive forwarder | infra | S |
| A2-T4 | Daily SQLite → S3 dump for L1/L2/L3 with hash-chain verification before upload | developer | M |
| A2-T5 | Lifecycle policies per §4.1 | infra | S |
| A2-T6 | `scripts/apply-legal-hold.sh` + paired release script + dry-run mode | developer + infra | M |
| A2-T7 | `docs/security/legal-holds/` directory + template | security + legal | S |
| A2-T8 | Quarterly tabletop on the 1-hr SLA | security | S (recurring) |
| A2-T9 | Update standard MSA / DPA to cite §3 retentions + §5 SLAs | legal | M |
| A2-T10 | Cost dashboard with month-to-date archive spend per source | infra | S |

## 10. Acceptance criteria

- [ ] Terraform module for the log-archive bucket landed; CI policy-snapshot
      test asserts Object Lock + lifecycle config match this doc
- [ ] Datadog → S3 archive verified producing one file/day per source
- [ ] Daily SQLite-dump script landed + scheduled (GH Actions cron 03:00 UTC)
- [ ] Hash chain verified between local SQLite and S3 dump before any
      local truncate is permitted (we don't currently truncate L1 locally,
      but the verifier is a guard against future cost-control temptations)
- [ ] Legal-hold runbook tested end-to-end in a tabletop: < 1 hr to apply,
      < 1 hr to release
- [ ] Cost dashboard visible to engineering manager + security lead
- [ ] L12 (edge access logs) confirmed expiring at 90 days

## 11. Open questions

- `[OPEN] A2-1`: Datadog annual commit decision (see §6).
- `[OPEN] A2-2`: Do we surface a "data subject access request" tool to
  customers that searches by user id across L1/L2/L5/L6/L7? Required by
  GDPR Art 15; the SAR mechanism is in `docs/security/privacy-and-compliance/`
  (P3, future). Cross-link once that doc exists.
- `[OPEN] A2-3`: Where do we land on the cold-tier retention for L5/L6/L7
  — 7 yrs is conservative; if storage cost goes >$500/mo, consider
  reducing to 3 yrs (still beats most operational forensic needs) with
  legal review.

## 12. Glossary

- **Hot tier**: log search is interactive (< 5 s) and indexed.
- **Warm tier**: log retrieval is API-driven (seconds), not indexed.
- **Cold tier**: archival; retrieval seconds–hours depending on class.
- **Legal hold**: indefinite preservation override invoked on
  preservation-order receipt; outranks lifecycle expiry.
- **Lifecycle policy**: S3 server-side rule that transitions / expires
  objects on a schedule. Idempotent and auditable.

---

*Last updated: 2026-05-18. Owner: Security agent + Legal liaison (TBD).*
