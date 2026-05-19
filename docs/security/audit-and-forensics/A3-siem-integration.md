# A3 — SIEM Integration

> **Status**: Draft. Names the SIEM vendor decision, the ingest topology,
> the initial detector ruleset, and the alert routing.
>
> **Effort**: M (vendor + initial ingest) + L (ongoing rule tuning).
>
> **Owner**: security + infra.
>
> **Reading time**: ~25 min.

---

## 1. Goals

1. Centralise every security-relevant log source under one query interface.
2. Run detection rules continuously; alert on hit.
3. Page the right person within 5 minutes for P1 detections.
4. Retain detection state long enough to support post-incident review.
5. Survive a SIEM vendor outage — log copies still land in our own S3.

## 2. Vendor analysis

The five vendors we considered, scored against the criteria we care about.

| Vendor | Strengths | Weaknesses | Cost band | Verdict |
|---|---|---|---|---|
| **Datadog Security** | Already in our stack for APM/metrics; same agent collects logs + traces; out-of-box detection content; Watchdog ML; Vercel + AWS + GCP integrations native. | Per-host pricing for some signals; aggressive cost growth at scale. | $0.10–$0.30/GB ingest + $1–$3/host/mo + $0.10/event detection runs | **CHOSEN for v1** |
| **Splunk Enterprise Security** | Gold-standard SIEM; richest detection content (Splunk ES Content Updates, MITRE-mapped); deep correlation. | Heaviest weight; per-day ingest pricing; long deploy cycle; UI dated. | $4.50/GB-day (yes, day) commercial list price; we'd negotiate. Realistically $40k–$100k/yr at our scale. | Re-evaluate at 5× revenue |
| **Elastic Security** | Open-source-anchored; runnable on our own infra; broad community detection rules; powerful KQL. | Self-host = ops burden; managed cloud (Elastic Cloud) is competitive but smaller install base for SIEM specifically. | Self-host: ~$300/mo on EC2 r5.large at our scale; managed: $95–$175/mo for the SIEM tier. | Plausible alternative if Datadog cost crosses $1k/mo |
| **AWS Security Hub + GuardDuty** | Native to AWS; cheap; covers AWS-side detections (KMS abuse, IAM anomalies, GuardDuty findings) without ingest cost. | Weak on application-layer signals; not a real SIEM, more a finding aggregator; no GCP coverage. | $0.10/event for first 100k Security Hub findings/mo; GuardDuty $1.00/GB analyzed | **Use AS SUPPLEMENT** — feeds AWS findings into Datadog |
| **Sumo Logic** | Modern UI; competitive pricing; SOC2 / HIPAA out-of-box; "Cloud SIEM" tier. | Smaller community than Datadog or Splunk; integration with Vercel less polished. | $90/mo per "credit" — pricing model less transparent | Eliminated v1 |

`[DECISION]` — **Datadog Security** for SIEM v1. Justification:
- Already in stack — incremental ops + procurement zero.
- Vercel native integration — L5/L6 logs land without custom shipping.
- AWS + GCP integrations — L8 + L9 + L10 ingest is one-click.
- Watchdog ML satisfies the A4 anomaly-detection baseline use case
  without a second tool.
- Cost is the largest risk; review trigger is $1k/mo recurring.

`[DECISION]` — **AWS Security Hub + GuardDuty enabled as a supplement**.
Findings forward into Datadog via the standard EventBridge → Datadog
pipeline. Cost is dominated by GuardDuty (~$15/mo at our scale) and is
non-negotiable for AWS-account hygiene.

## 3. Ingest topology

```
┌──────────────────────────────────────────────────────────────────┐
│                    Datadog Security (Hot SIEM)                    │
│                                                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐   │
│  │ Live tail / UI  │  │ Detection rules  │  │ Watchdog ML     │   │
│  └─────────────────┘  └──────────────────┘  └─────────────────┘   │
│                                                                   │
│  Sources (via Datadog agent / native integrations):               │
│   - Vercel log drains (L5, L6, L7) — official integration         │
│   - AWS CloudTrail (L8) — Datadog integration                     │
│   - AWS Security Hub findings — EventBridge → Datadog             │
│   - GuardDuty findings — EventBridge → Datadog                    │
│   - CloudWatch / Cloud Logging (L9) — Datadog integration         │
│   - Cloudflare WAF logs (L10) — Cloudflare Logpush → Datadog HTTP │
│   - a2a-agent application JSON logs (L1 + L5) — agent collector   │
│   - person-mcp / org-mcp JSON logs (L2 + L7) — agent collector    │
│   - manager dispatch logs (L11) — agent collector                 │
│   - PagerDuty incident lifecycle (closes feedback loop)           │
│                                                                   │
│         │                                                         │
│         ▼                                                         │
│   ┌──────────────────────────────────────────────┐                │
│   │  Datadog → S3 Archive Forwarder              │                │
│   │  (A2 §4.2 — long-term retention out of SIEM) │                │
│   └──────────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────────┘
        │
        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │       S3 — smart-agent-log-archive-prod (A2 §4.1)            │
   │       Lifecycle: hot 90d → warm 365d → cold 7yr              │
   └──────────────────────────────────────────────────────────────┘
        │
        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │       Athena / ad-hoc SQL over archived logs                 │
   │       (for queries older than the 30-day Datadog hot index)  │
   └──────────────────────────────────────────────────────────────┘
```

### 3.1 Per-source ingest specification

| Source | Path | Format | Sample rate |
|---|---|---|---|
| L1 — `execution_audit` rows | a2a-agent emits each new row as a structured JSON log line, tag `audit_chain=true` | JSON | 100% |
| L2 — person-mcp `audit_log` | Same pattern | JSON | 100% |
| L3 — org-mcp | Same | JSON | 100% |
| L5 — a2a stdout | Vercel log drain → Datadog HTTP intake | JSON (Pino) | 100% |
| L6 — web stdout | Vercel log drain → Datadog HTTP intake | JSON | 100% |
| L7 — person-mcp / org-mcp stdout | Vercel log drain | JSON | 100% |
| L8 — KMS CloudTrail | Native Datadog AWS integration | CloudTrail format | 100% |
| L9 — Postgres logs | RDS log export → CloudWatch → Datadog | text | 100% slow queries; 1% general |
| L10 — WAF events | Cloudflare Logpush → Datadog HTTP intake | JSON | 100% blocks / challenges; 1% passes |
| L11 — manager dispatch | manager emits structured JSON log line per dispatch | JSON | 100% |
| L13 — userOp submissions | bundler service log line | JSON | 100% |

### 3.2 Common log enrichment

Every log line emitted by Smart Agent code carries these tags before it
reaches Datadog:

- `service` — a2a-agent / web / person-mcp / org-mcp / manager / bundler
- `env` — production / preview / dev
- `correlation_id` — A5 traceId
- `user_id_hashed` — sha256(userId) if present; raw never leaves the app
- `audit_chain_event` — `true` for L1/L2/L3 lines, `false` for L5/L6/L7
- `severity` — debug / info / warn / error / critical

Datadog Pipeline rules unpack these into facets so they are queryable
without table-scans.

## 4. Detection rules — initial set

Each rule below is implemented as a Datadog Security Signal Rule. The rule
ID matches the Terraform resource we will commit in
`infra/datadog/rules/<rule-id>.tf`. Severity follows Datadog's High /
Medium / Low scheme.

### 4.1 Authentication abuse

**RULE-A3-AUTH-01** — Failed-auth burst per IP
- Query: `service:web @http.status_code:401 @event_type:auth_attempt`
- Threshold: > 10 / 5 min from a single source IP
- Severity: Medium
- Alert: Datadog Signal → Slack #sec-alerts
- Action: R5 brute-force protection should already throttle; this rule
  catches throttle bypass.

**RULE-A3-AUTH-02** — Cross-tenant auth attempt (post G phase property tests)
- Query: `service:web @event_type:auth_attempt @cross_tenant_attempt:true`
- Threshold: any event
- Severity: High
- Alert: PagerDuty P2 + Slack
- Status: blocked until G phase property tests land that emit this event.

**RULE-A3-AUTH-03** — SIWE replay attempted
- Query: `service:web @event_type:siwe_verify @result:replay_detected`
- Threshold: any event
- Severity: High
- Alert: PagerDuty P2

### 4.2 Delegation / authority

**RULE-A3-DELEG-01** — Delegation creation rate spike
- Query: `service:a2a-agent @event_type:delegation_minted`
- Threshold: more than 10× the user's 7-day median in any 1-hr window
- Severity: Medium
- Implementation: Datadog Watchdog forecast + threshold; A4 §4 details
  the baseline tuning.

**RULE-A3-DELEG-02** — Delegation chain depth anomaly
- Query: `service:a2a-agent @event_type:delegation_redeem @chain_depth:>5`
- Threshold: any event (chains > 5 hops are not a normal workflow)
- Severity: High
- Alert: PagerDuty P2

**RULE-A3-DELEG-03** — Delegation with no caveats (post G phase guard)
- Query: `service:a2a-agent @event_type:delegation_minted @caveat_count:0`
- Threshold: any event (G phase mandates ≥1 caveat)
- Severity: High
- Alert: PagerDuty P1 — this implies the caveat-enforcement CI guard
  has been bypassed.

### 4.3 KMS abuse

(See `docs/security/key-management/K6` for the canonical KMS detection
ruleset. A3 lists only the wiring from CloudTrail → Datadog; the rules
themselves live there.)

**RULE-A3-KMS-01** — KMS Decrypt outside expected principal set
- Source: CloudTrail event `kms:Decrypt` filtered by principal not in
  the whitelist (KMS user federated role, the verifier CLI role).
- Severity: High
- Cross-ref: K6 §4.1.

### 4.4 Audit-chain integrity

**RULE-A3-CHAIN-01** — Audit-chain hash mismatch detected
- Query: `service:a2a-agent @event_type:audit_chain_verify_failed`
- Threshold: any event
- Severity: **Critical** — this is the smoke alarm for tampering
- Alert: PagerDuty P1 + on-call phone call + Slack @here

**RULE-A3-CHAIN-02** — Checkpoint sink failures sustained
- Query: `service:a2a-agent @event_type:audit_checkpoint @sink_status:failed*`
- Threshold: > 0 in any 60-min window after the 3-retry backoff
- Severity: High
- Alert: PagerDuty P2

**RULE-A3-CHAIN-03** — S3 Object Lock anchor PUT failure
- Query: `service:a2a-agent @event_type:audit_anchor_s3 @status:failed`
- Threshold: any event
- Severity: High
- Alert: PagerDuty P2 — A1 §6

**RULE-A3-CHAIN-04** — Weekly Ethereum anchor missed
- Query: scheduled Datadog Synthetics check against the anchor contract:
  "an `Anchored` event exists with `block.timestamp` in the last 8 days"
- Threshold: false (no event)
- Severity: High
- Alert: PagerDuty P2

### 4.5 Cross-tenant data access

**RULE-A3-TENANT-01** — Cross-tenant SELECT attempt (post G phase)
- Query: `service:web OR service:person-mcp @event_type:tenant_check_failed`
- Threshold: any event
- Severity: Critical
- Alert: PagerDuty P1
- Status: requires the property tests in Phase G to emit this event when
  they detect a cross-tenant scope leak.

### 4.6 Silent-catch invocation

**RULE-A3-SILENT-01** — Silent-catch invocation in production
- Query: `service:* @event_type:silent_catch_warn @env:production`
- Threshold: any event
- Severity: Medium
- Alert: Slack #sec-alerts (no page; signal for triage)
- Status: requires the no-silent-catch CI guard (per `feedback_seed_footguns`)
  to be additionally instrumented to emit a runtime log when a known
  silent-catch site fires. Tracking issue: A3-T9.

### 4.7 KMS + signing anomalies

**RULE-A3-SIGN-01** — Signer used with foreign actionId pattern
- Query: `service:a2a-agent @event_type:kms_sign @actionId:checkpoint:* @caller_path:!auth/sign-checkpoint`
- Threshold: any event (the only legitimate caller of a `checkpoint:`
  prefixed actionId is the audit-checkpoint emitter)
- Severity: High

### 4.8 Service auth

**RULE-A3-SRVAUTH-01** — Inter-service MAC verification failure spike
- Query: `service:* @event_type:inter_service_mac @result:invalid`
- Threshold: > 5 in 5 min (typically zero)
- Severity: High

**RULE-A3-SRVAUTH-02** — Host-context exempt route called with mismatched host
- Query: `service:a2a-agent @event_type:host_context_check @result:reject`
- Threshold: > 50 in 5 min (low-level baseline noise from misconfigured
  external scanners is expected; sustained spikes are not)
- Severity: Medium

## 5. Alert routing

| Severity | Channel | Acknowledgement SLA | Notes |
|---|---|---|---|
| Critical | PagerDuty P1 + phone call + Slack @here + SMS to security lead | 5 min | A6 §2 — incident commander engaged |
| High | PagerDuty P2 + Slack #sec-alerts | 15 min | A6 §3 if not resolved in 30 min |
| Medium | Slack #sec-alerts | next business day | Batch-triaged daily |
| Low | Datadog UI only, no alert | weekly review | Trend signal only |

### 5.1 PagerDuty schedule

- **Primary on-call**: security team rotation, weekly handoff Mondays 09:00 PT.
- **Secondary on-call**: infra team rotation, mirrors primary cadence.
- **Escalation**: 5 min unacked → secondary; 15 min unacked → security
  lead direct; 30 min → CEO.
- **Override schedule**: published quarterly; updated within 24h of
  team changes.

`[OWE-REVIEWER]` — PagerDuty schedule itself is a separate Terraform
module under `infra/pagerduty/` (Phase H).

## 6. Cost estimate

| Component | Cost band |
|---|---|
| Datadog Logs ingest (~50 GB/mo at current scale) | $5–$15/mo |
| Datadog Security Signals (priced per indexed log) | $25–$75/mo at current scale |
| Datadog APM hosts (already in stack — not double-counted) | — |
| AWS GuardDuty | $15/mo |
| AWS Security Hub | $5/mo |
| PagerDuty (5 users) | $40/mo |
| Cloudflare Logpush (no per-event fee on our plan) | $0 |
| **Total** | **~$90–$150/mo at current scale** |
| **Projected at 10× scale** | **~$1k–$3k/mo** |

`[COST]` — `[OPEN] A3-1`: trigger Splunk vs Elastic re-evaluation at
sustained $1.5k/mo Datadog spend.

## 7. Detection rule lifecycle

A4 (anomaly detection) handles the *adaptive* class of rules. A3's rules
are the static threshold + signature rules. Both classes follow the same
lifecycle:

1. **Propose** — author opens a PR adding the rule under
   `infra/datadog/rules/<rule-id>.tf`. The PR body cites the threat the
   rule addresses and the expected false-positive rate.
2. **Shadow mode** — rule deployed with severity Low (no page) for 14
   days. Daily report counts FPs / TPs.
3. **Promote** — if FP rate is acceptable (per §8), rule severity is
   bumped to the intended level via a second PR.
4. **Review** — quarterly review by security lead. Rules with sustained
   high FP rates are retired or rewritten.
5. **Retire** — rule severity set to Low, then deleted when usefulness
   has clearly expired (e.g. the underlying vuln has been fully fixed).

The lifecycle is enforced by a CI check that requires every rule file to
carry `# shadow_until=<ISO>` or `# promoted_at=<ISO>` metadata.

## 8. False-positive budget

| Severity | FP rate budget |
|---|---|
| Critical | < 1 per quarter |
| High | < 1 per week |
| Medium | < 5 per week |
| Low | unbounded — signal only |

Exceeding the budget triggers a rule review at the next sync.

## 9. Implementation tasks

| # | Task | Owner | Effort |
|---|---|---|---|
| A3-T1 | Datadog Security tier activated; org-level SSO; per-team scoping | infra | S |
| A3-T2 | Vercel log drains for L5/L6/L7 routed to Datadog | infra | S |
| A3-T3 | Datadog AWS integration enabled; CloudTrail ingest verified | infra | S |
| A3-T4 | Datadog GCP integration enabled (parallel for GCP-backend) | infra | S |
| A3-T5 | Cloudflare Logpush → Datadog HTTP intake | infra | S |
| A3-T6 | a2a-agent / person-mcp / org-mcp emit structured JSON for L1/L2/L3 alongside the SQLite insert (Pino transport) | developer | M |
| A3-T7 | Terraform module `infra/datadog/rules/` with §4 ruleset | infra + security | M |
| A3-T8 | PagerDuty schedules + override automation | infra | S |
| A3-T9 | Runtime silent-catch instrumentation hooked into the CI guard sites | developer | M |
| A3-T10 | Datadog → S3 archive forwarder (A2 dependency satisfied here) | infra | S |
| A3-T11 | Athena workgroup + queries for archived-log access | infra | M |
| A3-T12 | Onboard the on-call team to the §5 routing | security | S |

## 10. Acceptance criteria

- [ ] All 14 §4 rules deployed (in shadow or promoted state)
- [ ] PagerDuty P1 page tested end-to-end (synthetic Critical signal fires
      a real page; ack closes the signal)
- [ ] Datadog → S3 archive validated by sampling a record from 7d ago
- [ ] FP-rate budget §8 reviewed in the first quarterly cycle
- [ ] Datadog cost dashboard shows month-to-date spend trending under
      the §6 estimate
- [ ] Runbook reference in A6 for every Critical / High rule

## 11. Open questions

- `[OPEN] A3-1`: Splunk / Elastic re-evaluation trigger (see §6).
- `[OPEN] A3-2`: Do we surface a subset of detection rules in a
  customer-facing trust portal? Some are competitive intel; others build
  customer confidence. Defer; revisit with marketing post-MVP launch.
- `[OPEN] A3-3`: How long do we keep individual Datadog Signals (the
  detection-result records)? Datadog retention default is 15 months;
  for High/Critical we want full 7-yr S3 archive. Cross-check A2.

## 12. Cross-references

- A1 — anchor signals feed RULE-A3-CHAIN-02/03/04
- A2 — Datadog → S3 archive forwarder is a shared resource
- A4 — anomaly detection inherits this ingest pipeline
- A5 — correlation_id is the join key for cross-source queries
- A6 — runbook references for each Critical / High rule
- K6 — KMS-specific detection rules
- R2 — WAF event ingest

## 13. Glossary

- **Signal** — a Datadog Security event raised by a rule. Distinct from
  a log line.
- **Watchdog** — Datadog's built-in ML anomaly engine.
- **Shadow mode** — rule deployed at severity Low so it generates signals
  but does not page.
- **Logpush** — Cloudflare's log-export service.

---

*Last updated: 2026-05-18. Owner: Security agent + Infra agent.*
