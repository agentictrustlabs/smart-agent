# O9 — Cost Monitoring

> **Status**: DRAFT. **No cost monitoring exists today.** Vercel,
> GitHub, Anthropic API, OpenAI API, GraphDB hosting, and any
> developer-paid AWS / GCP usage produce monthly invoices the team
> reviews informally. Per-service or per-user cost is not measured.
> Budget alerts are not configured.
>
> This document specifies the per-service cost dashboard, the budget
> alerts, the cost-per-userOp / cost-per-active-user metrics, and the
> review cadence that prevents unit-cost surprises.
>
> **Effort**: M (1 week setup + ongoing per-month review).
> **Owner**: Director of Engineering + Infra lead.
> **Depends on**: O8 (capacity model establishes the cost-driver
> levers), DR1 / O4 (production infra exists to attribute cost to).
> **Unblocks**: pricing decisions; runway visibility.

---

## 1. Today's state (honest)

| Cost source | Visibility | Budget alert | Per-feature attribution |
|---|---|---|---|
| Vercel | Monthly invoice | None | None |
| GitHub Actions / Codespaces | Monthly invoice | None | None |
| Anthropic API (this Claude session, eventually agent-internal LLM calls) | Per-key dashboard | None | None |
| OpenAI API (where used) | Per-key dashboard | None | None |
| GraphDB hosting | Server bill | None | None |
| Developer cloud spend | Per-developer | None | None |
| Per-userOp gas (paymaster deposit drain) | Inferable from chain | None | None |
| Per-user marginal cost | Unknown | N/A | None |

If a runaway loop / mis-rolled-out feature 10×'d our LLM bill
overnight today:
- We'd find out at month-end via the invoice.
- The lost money is unrecoverable.

This is the gap O9 closes.

---

## 2. Goals

1. **Every service has its monthly spend visible on a single
   dashboard.** Per-environment (prod / staging / dev), per-cost-
   center (compute / storage / data transfer / API / KMS).
2. **Budget alerts fire BEFORE we overspend.** 50% / 80% / 100% of
   monthly budget per cost center.
3. **Two derived metrics tracked continuously**:
   - **Cost-per-userOp**: total infrastructure cost / userOps
     submitted in the period.
   - **Cost-per-active-user**: total infrastructure cost / MAUs
     (monthly active users).
4. **Per-feature attribution.** Spec-005 settlement flows can be
   attributed to specific RDS, KMS, RPC costs.
5. **Monthly review with explicit decisions.** Cost trends are
   examined; remediation actions filed.

---

## 3. Cost sources to monitor

### 3.1 Infrastructure

| Source | API | Tagging |
|---|---|---|
| AWS (RDS, S3, KMS, Lambda, EKS, ALB, CloudWatch, …) | AWS Cost Explorer + Cost & Usage Report | `Environment=prod\|staging\|dev`, `Service=a2a-agent\|person-mcp\|…`, `Component=database\|kms\|compute` |
| GCP (Cloud SQL, Cloud KMS, Cloud Logging, …) | GCP Billing API + BigQuery export | Labels: `environment`, `service`, `component` |
| Vercel | Vercel billing API | Project = `web` |
| GitHub | GitHub billing API | Workflow attribution via usage logs |

### 3.2 Vendor APIs

| Source | API | Tagging |
|---|---|---|
| Anthropic API | Anthropic dashboard CSV export | Per-API-key — one key per service/use-case |
| OpenAI (if used) | OpenAI dashboard | Same |
| Alchemy / Infura (chain RPC) | Per-app-id dashboard | Per service |
| Datadog | Datadog cost data | N/A |
| PagerDuty | PagerDuty admin | N/A |
| Better Uptime | UI | N/A |

### 3.3 On-chain

| Source | Method | Tagging |
|---|---|---|
| Paymaster gas drain | Track `EntryPoint.balanceOf(paymaster)` over time | Per network |
| Userop gas attributable to userOp.callData kind | Parse userOps post-confirmation; group by tool ID | Per tool |

### 3.4 Storage

| Source | Method |
|---|---|
| Postgres storage usage | `SELECT pg_database_size(...)` daily |
| S3 backup bucket size | CloudWatch metrics |
| GraphDB instance disk | host-level disk metrics |

---

## 4. Unified cost dashboard

### 4.1 Tool decision

| Tool | Pros | Cons | Decision |
|---|---|---|---|
| **AWS Cost Explorer alone** | Free; native | AWS-only; no cross-cloud | Insufficient. |
| **Vendor-side dashboards (Vercel + Anthropic + AWS + GCP)** | Native | No unified view | Insufficient. |
| **CloudHealth / Spot.io / Vantage** | Multi-cloud unified | $$$ | Defer until spend justifies. |
| **Datadog Cost Management** | Already a Datadog customer; integrates with infra | Doesn't see vendor-side spend natively; some manual import | Acceptable for V1. |
| **Build our own (Postgres + Grafana)** | Full control | Engineering cost | Defer; revisit at scale. |

**Decision**: Datadog Cost Management + monthly manual import of
Anthropic / OpenAI / GitHub via `scripts/cost-import.ts`. Migrate to a
dedicated tool when monthly cloud spend exceeds $20k.

### 4.2 Dashboard contents

Datadog dashboard `infra/datadog/dashboards/cost-overview.json`:

- **Total spend**: month-to-date vs same period prior month, current
  forecast.
- **By cost center**: pie of compute, storage, data transfer, KMS,
  LLM, support.
- **By service**: stacked bar of services × cost center.
- **Per-userOp cost**: line graph of (daily spend) / (daily userOp
  count).
- **Per-active-user cost**: line graph of (daily spend) / (MAU).
- **Top growers**: services whose 30-day moving avg grew >20% MoM.

### 4.3 Per-userOp metric

```typescript
// scripts/compute-cost-per-userop.ts (new)
// Run daily; writes to Datadog custom metric `smart_agent.cost_per_userop`.
const dailySpend = await fetchAggregateSpend(yesterday)
const userOpCount = await countUserOpsFromAuditLog(yesterday)
const costPerOp = dailySpend / userOpCount
await datadog.publishMetric('smart_agent.cost_per_userop', costPerOp)
```

Target: cost-per-userOp ≤ $0.005 at steady state (informational
target — board sets the real number).

---

## 5. Budget alerts

### 5.1 Per-cost-center monthly budgets

Per Spec-008 budget planning (not yet written; this doc is the
template):

| Cost center | Monthly budget (initial) | 50% alert | 80% alert | 100% alert |
|---|---|---|---|---|
| AWS compute (EC2 / EKS / Lambda) | $1,000 | Slack | Slack | Page |
| AWS data (RDS storage, S3, transfer) | $500 | Slack | Slack | Page |
| AWS KMS | $50 | Slack | Slack | Page |
| GCP (KMS + Cloud SQL) | $200 | Slack | Slack | Page |
| Vercel | $200 | Slack | Slack | Page |
| Anthropic API | $1,000 | Slack | Slack + DoE | Page |
| OpenAI API | $200 | Slack | Slack | Page |
| Datadog | $500 | Slack | Slack | Page |
| Alchemy / Infura | $200 | Slack | Slack | Page |
| PagerDuty | $500 | (fixed) | (fixed) | (fixed) |
| Paymaster gas (on-chain) | $500 | Slack | Slack | Page |

Total initial monthly budget: ~$5,000. Subject to revision per
business plan.

### 5.2 Budget breach behavior

- 50% alert → informational; no action required.
- 80% alert → triage by Infra lead within 1 business day. May raise
  budget for the month; may identify a regression.
- 100% alert → pages on-call + DoE. Immediate investigation. Possible
  emergency actions: rate-limit a flooding source, kill a runaway
  job, disable a feature flag.

### 5.3 Anomaly detection

Datadog Anomaly Detection on the daily-spend metric flags spikes
that don't fit the historical pattern. Useful for catching a
"runaway loop" before the 50% monthly alert triggers (could be hours
into a 24-hour fire).

---

## 6. Per-feature attribution

Tags on every AWS / GCP resource carry `Service=<name>` and
`Feature=<spec-id>` where applicable.

Examples:
- RDS instance: `Service=postgres`, `Feature=spec-007-F.2`.
- S3 backup bucket: `Service=backup`, `Feature=O4`.
- KMS key `kms-bundler`: `Service=a2a-agent`, `Feature=spec-007-A`.

Cost Explorer / BigQuery cost-export queries filter by these tags.

For LLM calls: per-API-key segmentation. Issue one key per
service/agent. E.g.:
- `ANTHROPIC_KEY_A2A_AGENT` — used by the a2a-agent's internal
  reasoning.
- `ANTHROPIC_KEY_VERIFIER_MCP` — used by verifier-mcp for credential
  reasoning.
- `ANTHROPIC_KEY_TEST` — used by CI / load-test.

Anthropic dashboard groups spend by key.

---

## 7. Monthly cost review

### 7.1 Cadence

First Tuesday of each month. 30-min meeting. Owner: Infra lead.

### 7.2 Agenda

1. **Last month's spend** vs budget per cost center.
2. **Top growers** + investigation.
3. **Cost-per-userOp + cost-per-active-user** trend.
4. **Forecast** for current month based on first-week run rate.
5. **Action items**: capacity decisions (right-size RDS, request
   savings plan), feature decisions (kill a low-value high-cost
   feature flag), or budget revisions.

### 7.3 Output

`output/cost-review-YYYY-MM.md` — committed to repo. Past reviews
serve as trend material for the next.

---

## 8. Per-tool optimisations to track

The cost dashboard surfaces the unit-cost levers; these are the
common ones to optimise:

| Lever | Mechanism | Typical impact |
|---|---|---|
| RDS reserved instances | 1- / 3-yr commit; 30-60% discount | Land once steady-state |
| AWS savings plans | Compute commit; 20-40% discount | Land once steady-state |
| S3 Intelligent-Tiering | Auto-move cold backups to Glacier | 50-70% on cold storage |
| KMS multi-region keys | Per K3 M1+M2; doubles capacity, doubles cost | Net neutral if no over-provisioning |
| LLM prompt caching | Anthropic prompt caching | 50-90% on repeated context calls |
| LLM model selection | Use cheaper model where quality permits | Variable; significant |
| RPC call batching | Multicall pattern | 80%+ on read-heavy paths |
| Postgres read-replica routing | Read traffic to replicas | Avoids primary scaling |

The dashboard's "Top growers" + monthly review surface candidates;
the optimisations themselves are PR-sized work.

---

## 9. Files to create/change

### New

- `scripts/cost-import.ts` — pulls Anthropic / OpenAI / GitHub / Vercel
  monthly invoices into Datadog as custom metrics.
- `scripts/compute-cost-per-userop.ts` — daily metric.
- `scripts/compute-cost-per-active-user.ts` — daily metric.
- `infra/datadog/dashboards/cost-overview.json`.
- `infra/datadog/monitors/budget-breach-*.yaml` — one per cost center.
- `infra/aws/cost-tags-policy.json` — IAM Service Control Policy that
  requires `Service` + `Environment` tags on new resources.
- `docs/runbooks/cost-spike-investigation.md` — runbook for the
  100% budget breach alert.

### Changed

- All Terraform modules — add `tags` block with `Service`,
  `Environment`, `Feature` keys.
- `docs/security/operations/README.md` — link to O9.

---

## 10. Acceptance criteria

- [ ] Datadog Cost dashboard exists and shows all sources in §3.
- [ ] Every cost source has a budget configured.
- [ ] 50% / 80% / 100% alerts wired and tested (test by setting an
      artificially low budget temporarily; confirm alert fires).
- [ ] Cost-per-userOp + cost-per-active-user metrics are published
      daily and visible on the dashboard.
- [ ] First monthly cost review filed in `output/cost-review-
      YYYY-MM.md`.
- [ ] Anomaly-detection monitor configured for daily spend.
- [ ] Tag-enforcement SCP active in AWS — new untagged resources
      fail provisioning.

---

## 11. Test plan

### 11.1 Pre-production

- Drop a $1 daily budget on the `dev` environment for one day. Run a
  small load test. Confirm the 100% alert fires within an hour.

### 11.2 Anomaly verification

- Manually publish a 10× daily-spend metric value to Datadog (via a
  test endpoint). Confirm anomaly alert fires.

### 11.3 Tag enforcement

- Attempt to create an untagged S3 bucket via Terraform. Confirm
  Terraform plan fails with the SCP message.

---

## 12. Rollback

The dashboard is read-only; rolling it back means deleting it (no
data lost). The budget alerts are advisory; rolling them back is just
disabling. The tag-enforcement SCP is the only "active" rollback risk
— a misconfigured SCP could block legitimate provisioning. Mitigation:
exemption list for break-glass IAM roles; on-call can disable the SCP
via console with audit trail.

---

## 13. Open questions

- **OQ-O9-1**: When do we start tracking labour cost per feature? At
  present, payroll isn't in the picture; once head-count grows,
  attributing engineer-hours to features matters for ROI conversations.
  Proposed: defer until the team is >12.
- **OQ-O9-2**: Do we tag developer cloud spend? Each developer has
  their own dev AWS account; spend tags get fuzzy. Proposed: shared
  dev account with per-engineer tags via IAM-assumed roles. Each
  engineer's dev costs are visible on the dashboard.
- **OQ-O9-3**: Per-customer cost attribution (once we have B2B
  customers)? Proposed: customer ID tag in audit rows; cost-per-
  customer derived from query → resource mapping. Significant
  engineering; defer until the first B2B contract.
- **OQ-O9-4**: How do we report cost trends to the board? Proposed:
  monthly cost review's summary one-pager goes into the monthly
  board report.
- **OQ-O9-5**: Should we publish a cost-per-userOp claim to customers?
  Proposed: yes once it's stable for 3 consecutive months; serves as
  a pricing input.
