# O8 — Capacity Planning

> **Status**: DRAFT. **No capacity model exists today.** Services have
> no documented saturation points; no load testing has been performed
> against the production target shape; auto-scaling configuration is
> ad-hoc (Vercel handles `apps/web` automatically; backend services
> have no scaling policy yet because there's no production
> deployment).
>
> This document defines the load-testing methodology, the per-service
> capacity model, the saturation indicators, and the auto-scaling
> configuration that translates the model to a self-adjusting system.
>
> **Effort**: M (1 week setup + ongoing per-feature load testing).
> **Owner**: Infra lead + per-service owner.
> **Depends on**: O2 (`/ready` provides saturation signal), Spec 007
> Phase F.2 (Postgres connection pool sized), DR1 (Postgres scales
> horizontally for reads).
> **Unblocks**: O5 (RTO assumes capacity exists), O9 (cost monitoring
> assumes capacity is bounded by configuration).

---

## 1. Today's state (honest)

| Item | Today |
|---|---|
| Capacity model per service | None |
| Load testing methodology | None — no scripts, no recurring runs |
| Saturation indicators | None instrumented |
| Auto-scaling | Vercel auto-scales web; backend services have no autoscaler |
| Postgres connection pool size | Not yet set (no production Postgres) |
| KMS rate limits | Not measured |
| Per-userOp cost / throughput | Not measured |
| Capacity headroom target | None |

If traffic doubled tomorrow:
- `apps/web` would (probably) auto-scale on Vercel and stay up.
- `apps/a2a-agent` would saturate its single instance, latency
  would climb, and userOps would queue.
- Postgres connections would exhaust quickly (defaults are 25-100
  per service; we have 9 services).
- KMS quotas could be approached.
- No automation would intervene.
- Latency SLOs (O5 §5.2) would breach.

This is the gap O8 closes.

---

## 2. Goals

1. **Every service has a documented saturation point** in
   requests-per-second or connections-per-second.
2. **A load-testing methodology is documented and reproducible.** Same
   tool, same fixtures, same metrics — every release.
3. **Auto-scaling policy is committed as IaC** (Terraform); no
   manual scale-up.
4. **Headroom target is 50%.** A service is overloaded at p95 70% of
   its saturation point; that triggers scale-up. At 90% the service is
   in red; that triggers alerts AND scale-up if scale-up hasn't
   already.
5. **Cost-aware capacity.** Capacity-driven costs (KMS calls, RPC
   calls, Postgres compute) are visible per-userOp (O9 §3).

---

## 3. Load-testing methodology

### 3.1 Tooling decision

| Tool | Pros | Cons | Decision |
|---|---|---|---|
| **k6** | TypeScript-native; integrates with our test pipeline; cheap; scriptable scenarios; OSS. | Grafana k6 Cloud has cost at scale. | **Chosen.** |
| Gatling | Powerful; Scala-based. | Different language; team is TS. | Rejected. |
| Locust | Python-based; web UI. | Heavier; less idiomatic for our stack. | Rejected. |
| JMeter | GUI; widely known. | XML config; slower iteration. | Rejected. |
| Artillery | Node-based; small. | Less mature scenario language than k6. | Considered; k6 wins on ecosystem. |

k6 scripts live in `tools/load-test/`. Each Tier 1 path has a
dedicated scenario.

### 3.2 Scenario set

| Scenario | Path | Tier | Target RPS |
|---|---|---|---|
| `auth-init.k6.ts` | `/api/auth/session/init` | 1 | 100 |
| `userop-build-and-sign.k6.ts` | `/api/onchain-redeem` (Variant A) | 1 | 50 |
| `userop-onchain-register.k6.ts` | `/api/session/init?variant=B` | 1 | 10 |
| `pledge-flow.k6.ts` | end-to-end Rail A | 1 | 20 |
| `settle-flow.k6.ts` | end-to-end Rail B | 1 | 5 |
| `registry-read-bursts.k6.ts` | `/api/discovery/agents` + assorted reads | 2 | 500 |
| `mcp-tool-bursts.k6.ts` | random MCP tool selection | 2 | 100 |

Targets are based on the current dev experience scaled to a realistic
small-customer-base (10,000 active users, 1% active-at-any-moment).

### 3.3 Phases

Each scenario runs in 4 phases:

1. **Ramp (5 min)**: 1 RPS → target RPS linearly. Detects cold-start
   issues.
2. **Soak (30 min)**: target RPS held. Detects leak / drift / queue
   buildup.
3. **Burst (5 min)**: 2× target RPS. Detects saturation behavior.
4. **Cool-down (5 min)**: target RPS → 0. Detects unwind issues.

### 3.4 Metrics captured

For each phase, k6 reports:
- HTTP success rate.
- p50 / p95 / p99 latency.
- Errors by type.

Plus from the SUT side (Datadog):
- CPU / memory utilisation.
- Postgres connection pool utilisation.
- KMS call count + latency.
- RPC call count + latency.
- In-flight request count (via O3's counter).

### 3.5 Pass/fail criteria

A scenario passes if:
- HTTP success rate ≥99.9% (Tier 1) / 99.5% (Tier 2).
- p99 latency ≤ SLO target (O5 §5.2).
- No CPU/memory saturation (<80%).
- No connection-pool exhaustion.

Burst phase: 2× target RPS may exceed SLO p99 (acceptable in burst);
but the soak phase MUST hold SLO throughout. Burst phase failure is a
warning; soak phase failure is a hard regression.

### 3.6 Cadence

- **Per-PR**: a smoke-load test (1 min, 10% target RPS) runs on PRs
  that touch a service's hot path. Catches obvious regressions.
- **Per-release**: full scenario suite runs on the canary cohort
  before progressing past the 25% stage (O1 §5.1).
- **Nightly**: full scenario suite runs against a soak environment.
- **Monthly**: full scenario suite at 1.5× current production RPS to
  confirm headroom.

---

## 4. Per-service capacity model

### 4.1 `apps/a2a-agent`

| Resource | Limit | Saturation indicator |
|---|---|---|
| CPU | 1 vCPU per instance | utilisation >70% sustained |
| Memory | 1 GiB per instance | RSS >800 MiB |
| In-flight requests (O3) | 100 per instance | counter >70 |
| Postgres connections | 25 per instance × N instances | pool wait time >10 ms |
| KMS calls (master sign) | ~50/s per region (AWS default) | latency >150 ms p99 |
| RPC calls (Alchemy) | 300 CU/s on growth plan | rate-limit responses >0 |

**Saturation point**: ~50 RPS per instance for the userOp-signing
path (limited by KMS p99 latency × concurrency). Empirically validated
by `userop-build-and-sign.k6.ts`.

**Scaling**: horizontal. 2 instances minimum (Tier 1 HA), scale up at
35 RPS-per-instance sustained over 5 min. Scale down after 30 min
below 15 RPS-per-instance.

### 4.2 `apps/web`

| Resource | Limit | Saturation indicator |
|---|---|---|
| Vercel function concurrency | 1,000 per region | invocation duration >2 s for >5% of requests |
| Postgres connections | 10 per instance × edge regions | unknown until measured |

**Saturation point**: Vercel handles via auto-scale. Postgres
connection management is the bottleneck — `apps/web` connects from
many edge instances, so we need a connection pooler in front of
Postgres (PgBouncer or RDS Proxy).

**Scaling**: Vercel auto. PgBouncer max connections set to
`(web instances) * 5 + (other services) * 25` with a 10% headroom.

### 4.3 MCPs (person-mcp, org-mcp, etc.)

| Resource | Limit | Saturation indicator |
|---|---|---|
| CPU | 0.5 vCPU per instance | utilisation >70% sustained |
| Memory | 512 MiB per instance | RSS >400 MiB |
| Postgres connections | 15 per instance × N instances | pool wait time >10 ms |
| Askar I/O | sequential per vault file | file lock contention errors |

**Saturation point**: ~200 tool-call-RPS per instance for read-heavy
paths; ~50 RPS for write-heavy paths (Askar lock-bound).

**Scaling**: horizontal. 2 instances minimum. Scale up at 140 RPS-per-
instance.

### 4.4 Postgres (RDS)

| Resource | Limit | Saturation indicator |
|---|---|---|
| `db.r6g.large` (2 vCPU, 16 GiB) | ~500 mixed-workload RPS | CPU >70%; replication lag >1 s |
| Connections | 1,000 (default) but practically limited by mem/conn | conn count >700 |
| IOPS | 3,000 baseline + burst | latency >5 ms p95 |

**Scaling**: vertical (instance size up) for primary; horizontal
(read replicas) for reads. DR1 covers HA + read replica setup.

### 4.5 KMS

| Resource | Limit | Saturation indicator |
|---|---|---|
| AWS KMS Sign RPS | 100 default (per region per key) | ThrottlingException responses |
| AWS KMS GenerateMac RPS | 100 default | same |
| GCP KMS asymmetric Sign RPS | 60 default | rate-limit responses |

**Scaling**: request a quota increase (K3 M6) before traffic
projects. Multi-region keys (K3 M1+M2) double effective capacity.

---

## 5. Auto-scaling configuration

### 5.1 Kubernetes HPA (backend services)

```yaml
# infra/k8s/a2a-agent-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: a2a-agent
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: a2a-agent
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60        # scale at 60% to leave headroom
    - type: Pods
      pods:
        metric:
          name: inflight_requests
        target:
          type: AverageValue
          averageValue: "50"            # scale when 70 of the 100 inflight slots used
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Percent
          value: 100                    # double the pod count if needed
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300   # 5-min cooldown before scaling down
      policies:
        - type: Percent
          value: 25                     # max 25% scale-down per minute
          periodSeconds: 60
```

`inflight_requests` is exposed via Prometheus from O3's counter.

### 5.2 Vercel (web)

Vercel auto-scales Functions; no config needed. The configuration we
DO control:

- Function timeout: 60 s (default 10 s — extended for synchronous
  signing flows).
- Memory: 1024 MiB (default).
- Edge config: regional pinning for low-latency auth.

### 5.3 PgBouncer (Postgres pooler)

```
pool_mode = transaction
max_client_conn = 2000
default_pool_size = 50
reserve_pool_size = 5
```

Translates Vercel's many connections into a smaller fixed pool to RDS.

---

## 6. Capacity reviews

### 6.1 Monthly

Owner: Infra lead. Output: `output/capacity-review-YYYY-MM.md`:

1. Current RPS per service (95th percentile of last 30 days).
2. Headroom (current / saturation point) per service.
3. Trend (last 3 months MoM growth).
4. Forecast next 3 months at current growth rate.
5. Required actions (request KMS quota increase, scale up Postgres
   instance, add read replica, etc.).

### 6.2 Pre-launch / pre-feature

Before any feature that may shift the load shape (Spec 005 launching
real Rail B, KMS migration completing, marketplace launch), a
capacity review is triggered:

- Re-run full load test scenarios at expected post-launch shape.
- Identify any saturation points hit.
- Land scaling adjustments.

---

## 7. Files to create/change

### New

- `tools/load-test/scenarios/auth-init.k6.ts`
- `tools/load-test/scenarios/userop-build-and-sign.k6.ts`
- `tools/load-test/scenarios/userop-onchain-register.k6.ts`
- `tools/load-test/scenarios/pledge-flow.k6.ts`
- `tools/load-test/scenarios/settle-flow.k6.ts`
- `tools/load-test/scenarios/registry-read-bursts.k6.ts`
- `tools/load-test/scenarios/mcp-tool-bursts.k6.ts`
- `tools/load-test/lib/auth.ts` — synthetic-user auth setup.
- `tools/load-test/README.md` — how to run, where dashboards live.
- `infra/k8s/a2a-agent-hpa.yaml`
- `infra/k8s/person-mcp-hpa.yaml` (etc. per MCP)
- `infra/k8s/pgbouncer.yaml`
- `infra/datadog/dashboards/capacity-overview.json`
- `docs/runbooks/capacity-saturation.md`
- `output/capacity-review-2026-05.md` (first review)

### Changed

- `package.json` — add `test:load` scripts.
- `.github/workflows/deploy.yml` (per O1) — invoke smoke load test
  pre-canary.
- `docs/security/operations/README.md` — link to O8.

---

## 8. Acceptance criteria

- [ ] Every service in §4 has a saturation-point measurement, captured
      in a load-test report.
- [ ] Auto-scaling HPA configured for every backend service.
- [ ] PgBouncer deployed in front of Postgres.
- [ ] Per-PR smoke load test wired into CI for hot-path changes.
- [ ] Nightly full load test runs and posts results to Datadog.
- [ ] Monthly capacity review filed in `output/capacity-review-YYYY-MM.md`.
- [ ] First capacity review identifies the headroom envelope and
      surfaces any near-saturation services.
- [ ] Datadog "capacity overview" dashboard shows headroom per service.

---

## 9. Test plan

### 9.1 Load test self-verification

- Each scenario is unit-tested for correctness against a stubbed
  service (assert the script makes the requests it claims, with the
  payloads it claims, at the rate it claims). Otherwise a bug in the
  load test produces misleading capacity numbers.

### 9.2 Saturation drill

- Quarterly: deliberately scale a service DOWN to its minReplicas
  while running a 70%-of-saturation load. Confirm HPA scales it back
  up within the configured window. If HPA doesn't react fast enough,
  the policy is too conservative.

---

## 10. Cost

| Item | Cost |
|---|---|
| k6 Cloud (optional; nightly distributed runs) | $200/mo on the Pro tier |
| Self-hosted k6 (GitHub Actions runners) | within existing CI minutes |
| Datadog APM hosts + custom metrics | included in existing Datadog spend |
| PgBouncer (managed via RDS Proxy or self-hosted on EKS) | $0 self-hosted; $0.015/ACU-hour for RDS Proxy |

Total marginal: $0-200/mo depending on cloud-k6 decision.

---

## 11. Rollback

Capacity additions (HPA, PgBouncer) are additive. Rollback is
straightforward: delete the HPA, the service falls back to its base
replica count. PgBouncer can be bypassed by direct-pointing services
at Postgres (env var change). Neither rollback discards data.

A load test that breaks production (rare; load tests run against
canary cohort or soak env) — kill the k6 runner and the load
disappears.

---

## 12. Open questions

- **OQ-O8-1**: Where does the load test run from? Proposed: GitHub-
  Actions-hosted k6 binary in the production VPC for full-soak;
  on-laptop for ad-hoc. AWS Distributed Load Testing for >5 region
  simulation deferred.
- **OQ-O8-2**: Should we capture an APM trace for every Nth load-test
  request? Useful for diagnosis. Datadog does this automatically with
  trace sampling; we just tune sample rate.
- **OQ-O8-3**: When does load testing become a customer-facing claim
  (e.g. "supports X RPS")? Proposed: once we publish a status page
  (O5 OQ-3), include the latest "tested up to N RPS" metric.
- **OQ-O8-4**: Do we test with realistic data shapes (10,000 users
  with realistic relationship-graph density) or synthetic minimal
  shapes? Proposed: both — minimal for fast PR-gate smoke; realistic
  for nightly soak. The realistic dataset is generated by a new
  `scripts/seed-load-test-realistic.ts`.
- **OQ-O8-5**: How do we capacity-plan for a viral burst (e.g. a news
  article)? Proposed: a separate "burst surge" scenario at 10×
  steady-state RPS for 5 min, run quarterly. Saturation may be
  acceptable for 5 min — the question is "does the system degrade
  gracefully?"
