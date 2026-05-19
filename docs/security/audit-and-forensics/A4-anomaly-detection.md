# A4 — Anomaly Detection

> **Status**: Draft. Names the statistical baselines, the per-signal
> detectors, the false-positive budget, and the automated response policy
> (alert vs. suspend).
>
> **Effort**: M (initial detector set) + L (continuous tuning).
>
> **Owner**: security + data engineering (latter borrowed for baseline
> tuning).
>
> **Reading time**: ~20 min.

---

## 1. Goals

1. Catch what static rules miss — unusual patterns where the *individual*
   event is legitimate but the *aggregate behaviour* is suspect.
2. Auto-suspend (not just alert) when the anomaly is severe enough that
   waiting for human triage means measurable loss.
3. Keep false-positive rate inside the A3 §8 budget so the on-call team
   trusts the signal.
4. Make the baselines visible — every detector exposes the underlying
   distribution so a human can re-derive the threshold.

## 2. Approach overview

Three complementary detection layers:

| Layer | Mechanism | Use case |
|---|---|---|
| **Layer 1 — Static thresholds** | Fixed numeric thresholds. Lives in A3 §4 rules. Cheap, deterministic, easy to reason about. | Known-bad patterns where the threshold is non-controversial (e.g. delegation with 0 caveats). |
| **Layer 2 — Statistical baselines** | Datadog Watchdog forecast or manual `mean ± 3σ` rolling window. | Per-user, per-account, per-tenant rate-of-X anomalies. |
| **Layer 3 — Custom ML / SQL notebooks** | A scheduled SQL or pandas notebook run nightly that flags outliers no out-of-box tool catches. | Slow-burn anomalies, multi-signal correlations, behavioural fingerprints. |

Most detectors are Layer 2. Layer 3 is reserved for cases that justify the
ops cost.

## 3. Baseline signals

The signals we baseline + monitor. Each has: definition, the baseline
window, the 3σ-equivalent threshold, the source-of-truth log query, and
the response action.

### 3.1 Delegation issuance rate per user

- **Definition**: count of `event_type:delegation_minted` events filtered
  by `@principal_user_id_hashed:<userId>` per hour.
- **Baseline**: per-user 7-day rolling median + median absolute deviation
  (MAD; robust to outliers).
- **Threshold for alert**: > median + 5 × MAD AND > 5 events/hr absolute
  (the absolute floor prevents nuisance alerts on users with a baseline
  of 0).
- **Threshold for auto-suspend**: > 10 × baseline median sustained 15 min.
- **Response on alert**: PagerDuty P2.
- **Response on auto-suspend**: a2a-agent stops accepting new
  delegation-mint requests from this user for 15 min; user sees a
  friendly "high activity detected, please wait" UI. Operator can lift
  the suspension via the `scripts/suspend-user.ts` tool with a
  documented reason that lands in the audit chain.
- **Why this matters**: a compromised user account, a misbehaving agent
  that loops, or a malicious automation script will all manifest as a
  delegation-rate spike before they manifest as on-chain damage.

### 3.2 UserOp submission rate per agent

- **Definition**: count of `event_type:user_op_submitted @agent_id:<id>`
  per minute.
- **Baseline**: per-agent 24-hr rolling mean + standard deviation.
- **Threshold for alert**: > mean + 4σ for 5 consecutive minutes.
- **Threshold for auto-suspend**: > mean + 6σ for 1 minute OR raw rate
  > 100/min.
- **Response on auto-suspend**: bundler service refuses to accept further
  userOps from this agent for 10 minutes.
- **Why this matters**: economic abuse (gas-burning), MEV-bot exploitation
  of a session key, looped retry on an error path.

### 3.3 Cross-MCP call volume

- **Definition**: count of `event_type:mcp_call` per (source service,
  target service) pair per minute.
- **Baseline**: 7-day rolling per-pair median.
- **Threshold for alert**: > 3 × median for 10 consecutive minutes.
- **Response**: PagerDuty P3 (Slack-only); investigate whether a new
  feature shifted the baseline or whether one service is misbehaving.
- **Why this matters**: a runaway recursion across MCPs (web → a2a-agent
  → person-mcp → a2a-agent → org-mcp → …) ate $X of CPU in a recent
  incident; catching the recursion pattern early avoids the same outage.

### 3.4 Audit-row growth rate

- **Definition**: count of new `execution_audit` rows per minute.
- **Baseline**: 7-day rolling median by minute-of-week (captures the
  weekly seasonality from scheduled jobs).
- **Threshold for alert**: > 10 × seasonal median for 10 minutes.
- **Response**: PagerDuty P2 — this is the global "something explosive is
  happening" signal.

### 3.5 Audit-row growth FLOOR (anomalously low)

- **Definition**: same source; alert direction is reversed.
- **Baseline**: same.
- **Threshold for alert**: < 0.1 × seasonal median for 30 minutes.
- **Response**: PagerDuty P2 — silently dropped audit rows are a worse
  posture than too many; might indicate a logger failure, a circular
  import that disabled the appender, or an attacker truncating.
- **Cross-ref**: this is the dual of A1's anchor-divergence detector.

### 3.6 KMS Decrypt call rate

- **Definition**: count of `kms:Decrypt` CloudTrail events per principal.
- **Baseline**: 7-day rolling median per principal.
- **Threshold for alert**: > 5 × median sustained 10 minutes.
- **Response**: PagerDuty P2; cross-reference K6 detector.
- **Why this matters**: an attacker who lifted a Vercel OIDC role
  credential and is using it to bulk-decrypt session ciphertexts will
  show up here.

### 3.7 Per-user session creation rate

- **Definition**: count of `event_type:session_create @user_id_hashed:<id>`
  per hour.
- **Baseline**: per-user 7-day rolling median.
- **Threshold for alert**: > 10 × median AND > 20 events/hr absolute.
- **Threshold for auto-suspend**: > 50 events/hr.
- **Response on alert**: PagerDuty P2; the user may have lost passkey
  reachability and is retrying — but it might also be auth abuse.
- **Why this matters**: catches session-init rate-limit bypass.

### 3.8 Treasury withdrawal rate per org

- **Definition**: count of `event_type:treasury_withdrawal @org_id:<id>`
  per hour, AND total value withdrawn per hour.
- **Baseline**: per-org 30-day rolling median (treasury activity is rare
  enough that 7 days is too short).
- **Threshold for alert (count)**: > 5 / hr.
- **Threshold for alert (value)**: > 0.5 × org's average monthly outflow
  in any 1-hour window.
- **Response**: PagerDuty P1 — financial-impact signal.

### 3.9 New-target-contract interaction rate

- **Definition**: count of `event_type:user_op_submitted @target:<addr>`
  per minute where `<addr>` was first seen < 24 hr ago.
- **Baseline**: global; threshold is absolute.
- **Threshold for alert**: > 10 / min globally.
- **Response**: PagerDuty P3 + manual review.
- **Why this matters**: catches the case where a new "approve everything"
  scam contract gains traction.

### 3.10 Manager dispatch rate per agent

- **Definition**: count of `event_type:manager_dispatch @target_agent:<id>`
  per hour.
- **Baseline**: per-agent 7-day rolling median.
- **Threshold for alert**: > 5 × median.
- **Response**: Slack #ops only — operational signal, not security.

### 3.11 Live-acknowledgement count discrepancy

- **Definition**: divergence between expected `liveAcknowledgementCount`
  in spec 001/002/003 marketplace flows and observed counts.
- **Baseline**: deterministic — every increment must have a matching
  audit row.
- **Threshold for alert**: any divergence on a daily reconciliation job.
- **Response**: PagerDuty P2.
- **Why this matters**: live-ack is the cross-MCP coordination primitive
  for intent state; silent loss would skew marketplace ranking.

## 4. Implementation per detector

Every detector lives at `infra/datadog/detectors/<detector-id>.tf` as a
Datadog Monitor resource. The Terraform module owns:

- The detector query.
- The threshold expression.
- The alert message + runbook link.
- The notification routing.

For Layer 2 (statistical-baseline) detectors, we use Datadog's
`anomaly()` and `forecast()` Monitor types where applicable, and fall
back to manual rolling-window aggregation queries where Watchdog cannot
capture the per-user dimension.

### 4.1 Example detector — 3.1 delegation issuance per user

```hcl
resource "datadog_monitor" "delegation_issuance_per_user" {
  name    = "[A4-3.1] delegation-issuance per user above 5×MAD"
  type    = "log alert"
  message = <<-EOM
    Delegation-issuance for a user exceeded baseline + 5×MAD.

    Runbook: https://docs.smart-agent.io/security/audit-and-forensics/A6#user-account-compromise

    @pagerduty-security
  EOM
  query = <<-EOQ
    logs("service:a2a-agent @event_type:delegation_minted").index("main").rollup("count").by("@principal_user_id_hashed").last("1h") > anomalies(direction="above", interval=300, percentile=99, robust=true)
  EOQ
  monitor_thresholds { critical = 1 }
  tags = ["component:audit-forensics", "owner:security"]
}
```

The actual `anomalies()` Datadog function does its own MAD-equivalent
computation; for monitors that need stricter MAD math, we fall to a
custom metric forwarded from a2a-agent.

### 4.2 Custom metric forwarding for Layer 3

For detectors where Datadog's anomaly function is too coarse (e.g. 3.5,
the audit-row-floor case), a2a-agent computes the metric itself in a
scheduled job:

```typescript
// apps/a2a-agent/src/lib/anomaly-emit.ts (sketch)
import { getAuditRowCount } from './audit'
import { sendDatadogMetric } from './observability/dd'

export async function emitAuditRowMinuteCount(): Promise<void> {
  const count = await getAuditRowCount({ sinceMinutes: 1 })
  await sendDatadogMetric({
    metric: 'smart_agent.audit.rows_per_minute',
    value: count,
    tags: [`env:${process.env.NODE_ENV}`],
  })
}
```

Datadog Monitors evaluate against `smart_agent.audit.rows_per_minute`
with `forecast()` to catch both the spike (3.4) and the floor (3.5)
cases.

## 5. Auto-suspend mechanism

Three detectors above carry a `Response on auto-suspend` clause. They
share a single mechanism:

1. Detector fires → Datadog Monitor invokes a webhook (`https://a2a-agent/security/suspend`).
2. Webhook payload includes the detector id, the subject (user / agent /
   org), the threshold violated, and the recommended suspension duration.
3. a2a-agent verifies the webhook HMAC (signed by Datadog with a shared
   secret), records the suspension in `security_suspension` table
   (TBD — new schema), and applies it via the existing rate-limiter
   layer.
4. The suspension expires automatically after the recommended duration.
5. The whole suspension event lands in the audit chain (L1) — even the
   automation has audit-trail accountability.

### 5.1 Operator override

Suspensions are reversible. Operator runs:

```
$ pnpm tsx scripts/suspension-override.ts \
    --subject user:<userId> \
    --reason "false positive on detector A4-3.1: user is legitimately bulk-issuing for a workshop" \
    --action release
```

The override itself lands in L1 with the operator's signed-in identity.

### 5.2 Why auto-suspend at all?

We considered an "alert-only, never suspend" policy. Arguments against:

- A delegation-rate spike from a stolen credential drains tokens at
  the rate of the spike, not the rate of the on-call human's response.
- The 5–15 minute auto-suspend windows are short enough that a true FP
  is recoverable with minimal user friction (we surface a "high activity
  — please wait 5 min" UI), and an operator override is < 2 min.
- The audit-trail-able nature of automated suspensions makes them
  defensible to customers and regulators.

`[DECISION]` — three of the eleven detectors carry auto-suspend. The
others remain alert-only. We will revisit after 90 days of production
data.

## 6. False-positive budget

A4's FP budget tracks the A3 §8 table — same severities, same budgets.
A4-specific addendum: any detector exceeding its FP budget two quarters
in a row is **automatically demoted** to Slack-only (severity Low) until
re-tuned. This prevents an unowned noisy detector from dulling on-call
response.

## 7. Tuning workflow

```
┌───────────────────────────────────────────────┐
│ Weekly anomaly-detection sync (security lead) │
└───────────────────────────────────────────────┘
            │
            ▼
   ┌──────────────────────────────────────┐
   │ Review Datadog Monitor state         │
   │ - Open vs closed signals             │
   │ - FP-tag count per detector          │
   │ - Auto-suspend events per detector   │
   └──────────────────────────────────────┘
            │
            ▼
   ┌──────────────────────────────────────┐
   │ For each detector exceeding budget:  │
   │   1. Inspect raw events              │
   │   2. Choose: retune / retire / fix   │
   │      source-of-truth log emit        │
   │   3. PR the change                   │
   └──────────────────────────────────────┘
            │
            ▼
   ┌──────────────────────────────────────┐
   │ Land changes; track in CHANGELOG     │
   │ at infra/datadog/detectors/CHANGELOG │
   └──────────────────────────────────────┘
```

Quarterly: review the whole detector set against the current threat
model. Retire detectors whose threats have been mitigated upstream.

## 8. Baseline storage and visibility

Each detector's *current* baseline (median, MAD, σ, etc.) is exposed
through a Datadog Dashboard at
`https://app.datadoghq.com/dashboard/smart-agent-anomaly-baselines`.
Every detector's threshold expression is committed to git; reviewers can
re-derive the threshold from the dashboard and the threshold expression
without running anything themselves.

`[OWE-REVIEWER]` — the dashboard URL is included in the standard
customer security-questionnaire response packet.

## 9. Cost estimate

| Component | Cost |
|---|---|
| Datadog Monitor evaluations (anomaly + forecast types are pricier than threshold) | $20–$60/mo at our scale |
| Custom metric forwarding (smart_agent.* metrics) | included in Datadog ingest |
| Per-detector evaluation overhead in a2a-agent | negligible |
| **Total over A3 baseline** | **+$20–$60/mo** |

`[COST]` — bundled into the A3 SIEM budget.

## 10. Open questions

- `[OPEN] A4-1`: Should the `liveAcknowledgementCount` reconciliation
  detector (3.11) live in A4 or in the marketplace-spec-level monitoring?
  Currently A4 because the audit trail is shared; revisit when spec 001/2/3
  agents have a clearer ops home.
- `[OPEN] A4-2`: Privacy of per-user baselines. Datadog stores the
  user-id hash; we never store raw user id. Confirm this satisfies the
  privacy section of P3 (when written).
- `[OPEN] A4-3`: Auto-suspend duration tuning. Currently 5–15 min
  windows are guesses. Re-derive from production data after 60 days.

## 11. Implementation tasks

| # | Task | Owner | Effort |
|---|---|---|---|
| A4-T1 | Custom metric emitters in a2a-agent (smart_agent.audit.rows_per_minute, smart_agent.delegation.minted_per_hour, etc.) | developer | M |
| A4-T2 | Terraform `infra/datadog/detectors/` module with all 11 detectors | infra + security | M |
| A4-T3 | `apps/a2a-agent/src/security/suspend.ts` route handler + HMAC verification + `security_suspension` table | developer | M |
| A4-T4 | `scripts/suspension-override.ts` CLI | developer | S |
| A4-T5 | Baseline dashboard | infra | S |
| A4-T6 | Weekly tuning sync set up on calendar | security | S |
| A4-T7 | Customer-facing baseline visibility blurb in security-questionnaire response packet | security | S |

## 12. Acceptance criteria

- [ ] All 11 §3 detectors deployed (shadow or promoted)
- [ ] Custom metric forwarding verified — every metric appears in Datadog
- [ ] Three auto-suspend paths tested end-to-end with synthetic events
- [ ] Operator override CLI tested
- [ ] First quarterly tuning sync completed; CHANGELOG updated
- [ ] FP budget §6 instrumented in the dashboard

## 13. Cross-references

- A3 — ingest topology + rule lifecycle
- A5 — correlation_id joins anomalies to provenance chains
- A6 §3 (user account compromise), §4 (smart contract bug) reference
  these detectors
- K6 — KMS-specific anomaly detection (3.6 above is the wiring; the
  detection logic is shared)

---

*Last updated: 2026-05-18. Owner: Security agent + Data engineering.*
