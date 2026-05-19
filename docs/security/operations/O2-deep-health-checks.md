# O2 — Deep Health Checks

> **Status**: DRAFT. **Most services today expose only a shallow `/health`
> endpoint (or none at all). There is no `/ready` endpoint that asserts
> the service can actually process work.** `scripts/fresh-start.sh`'s
> `wait_http` helper polls `/health` followed by `/.well-known/agent.json`
> — both confirm the process is alive but neither confirms it can sign,
> read the chain, or talk to the database.
>
> This document specifies the `/health` vs `/ready` split, the probe set,
> implementation pattern, and how the load balancer / Kubernetes
> consumes the result.
>
> **Effort**: M (1 week for all 10 services).
> **Owner**: Infra lead + each service's owner.
> **Depends on**: O3 (graceful shutdown reads `/ready` to drain).
> **Unblocks**: O1 (deploy canary uses `/ready` as the cutover gate),
> DR1 (Postgres HA failover detection).

---

## 1. Today's state (honest)

| Service | `/health` | `/ready` | Probes |
|---|---|---|---|
| `apps/web` | ✓ (returns 200 unconditionally) | ✗ | Process alive only. |
| `apps/a2a-agent` | ✓ (returns process info) | ✗ (some startup gates run at boot — see `policy-startup.ts` — but no per-request readiness check exists) | Boot-time only. |
| `apps/person-mcp` | partial (some routes return 200) | ✗ | Process alive only. |
| `apps/org-mcp` | partial | ✗ | Process alive only. |
| `apps/family-mcp` / `geo-mcp` / `verifier-mcp` / `skill-mcp` / `people-group-mcp` / `hub-mcp` | inconsistent — some have `/health`, some don't | ✗ | None. |

Compounding the gap: `scripts/fresh-start.sh:wait_http` polls `/health`
with a 30 s timeout and FALLS BACK to `/.well-known/agent.json` if
`/health` is missing. This pattern hides services that have no health
endpoint at all — they "wait" successfully because the agent card is
served by any running process.

If `apps/a2a-agent` boots but KMS is unreachable, today:
1. `/health` returns 200 (process is alive).
2. Traffic flows.
3. The first request that needs a KMS sign fails 500.
4. The user sees an unhelpful error.

This is the gap O2 closes.

---

## 2. Goals

1. **Every service has BOTH `/health` and `/ready`.** Shallow vs deep,
   no exceptions.
2. **`/health` returns 200 iff the process is alive.** It is the
   liveness probe (Kubernetes), used to decide whether to restart the
   process.
3. **`/ready` returns 200 iff the process can fulfill its job.** It is
   the readiness probe, used to decide whether to route traffic to this
   instance.
4. **Both endpoints are CHEAP** — `/health` <1 ms, `/ready` <50 ms
   typical. Neither can be the bottleneck under load.
5. **Probe failures are observable.** Each probe failure increments a
   metric and emits a structured log row.
6. **Dev parity.** The same probes run in dev. `fresh-start.sh` polls
   `/ready` (not `/health`) as the readiness gate before declaring the
   stack up.

---

## 3. `/health` — Liveness

### 3.1 Contract

```
GET /health
→ 200 OK
  Content-Type: application/json
  { "status": "alive", "service": "<name>", "version": "<git-sha>" }
```

Returned by ALL services. Trivial: the handler returns the canned response.

### 3.2 Failure mode

`/health` returns non-200 only if:
- The process is mid-shutdown (O3 — `/health` flips to 503 on SIGTERM
  receipt, after the readiness gate flips to 503).
- A fatal initialization error short-circuited the handler chain.

A `/health` failure is the signal to the orchestrator: restart this
process. NOT: drain traffic (that's `/ready`'s job).

### 3.3 Implementation

A shared `@smart-agent/sdk/health` module exports:

```typescript
// packages/sdk/src/health/liveness.ts
export function livenessHandler(service: string): Handler {
  return async (req, res) => {
    if (shutdownInProgress()) {
      return res.status(503).json({ status: 'shutting-down', service })
    }
    return res.json({
      status: 'alive',
      service,
      version: process.env.GIT_SHA ?? 'unknown',
    })
  }
}
```

Mounted in every service's `src/index.ts` as the first route:

```typescript
app.get('/health', livenessHandler('a2a-agent'))
```

---

## 4. `/ready` — Readiness

### 4.1 Contract

```
GET /ready
→ 200 OK    if all required probes pass
→ 503       if any required probe fails
  Content-Type: application/json
  {
    "status": "ready" | "not-ready",
    "service": "<name>",
    "checks": {
      "postgres": { "ok": true, "latency_ms": 3 },
      "kms": { "ok": true, "latency_ms": 22 },
      "entrypoint": { "ok": true, "block": 12345678 },
      ...
    }
  }
```

### 4.2 Probe set per service

The probe set is service-specific. Each probe has:
- A name.
- A "required" flag — if true, failure means 503; if false, failure
  is reported but the service is still ready (used for non-blocking
  downstream dependencies).
- A timeout (default 1 s).

#### 4.2.1 `apps/a2a-agent` (Tier 1 — most demanding)

| Probe | Required | Asserts | Method |
|---|---|---|---|
| `postgres` | yes | Per-service Postgres reachable; can `SELECT 1`. | Cached pool acquire + `SELECT 1`. |
| `kms-master` | yes | Master KMS key reachable; can sign a synthetic challenge. | `kms:GetPublicKey` (cheap; cached for 30 s). |
| `kms-bundler` | yes | Bundler-signer KMS key reachable (post-Spec-007). | Same as above. |
| `kms-session-issuer` | yes | Session-issuer KMS key reachable (post-Spec-007). | Same as above. |
| `entrypoint` | yes | RPC reachable; ERC-4337 EntryPoint contract responds. | `eth_call` on `EntryPoint.balanceOf(paymaster)`. |
| `policy-registry` | yes | Tool-policy registry loaded and `assertPolicyCompleteness` passed at boot. | In-memory boolean set at boot. |
| `audit-sink` | yes | Audit-sink URL reachable (Sprint 5 P1-5 — `assertAuditSinkConfigured`). | HEAD with 1 s timeout. |
| `paymaster-deposit` | yes | EntryPoint deposit for paymaster > 0.01 ETH. | `eth_call` on `EntryPoint.balanceOf(paymaster)`. |
| `graphdb` | no | GraphDB SPARQL endpoint reachable. | HTTP HEAD to `$GRAPHDB_URL/repositories/SmartAgents/size`. Non-blocking — see DR3. |

#### 4.2.2 `apps/web`

| Probe | Required | Asserts |
|---|---|---|
| `postgres` | yes | Web's per-service Postgres reachable. |
| `a2a-agent` | yes | Companion A2A agent's `/ready` returns 200. |
| `person-mcp` | yes | Person MCP `/ready` returns 200. |
| `org-mcp` | yes | Org MCP `/ready` returns 200. |
| `chain-rpc` | yes | RPC URL reachable. |

#### 4.2.3 MCPs (`person-mcp`, `org-mcp`, `family-mcp`, etc.)

| Probe | Required | Asserts |
|---|---|---|
| `postgres` | yes | Per-MCP Postgres reachable. |
| `askar` | yes (where applicable) | Askar vault reachable (`person-mcp` reads delegation envelopes; `family-mcp` reads family-private DB). |
| `a2a-agent` | yes | A2A agent's `/ready` returns 200 — MCPs depend on the agent for inbound MAC validation. |
| `kms-mac-key` | yes | MAC key for this MCP's inter-service envelope is reachable. |

### 4.3 Probe implementation pattern

Each probe is a `ReadinessProbe`:

```typescript
// packages/sdk/src/health/readiness.ts
export interface ReadinessProbe {
  name: string
  required: boolean
  timeoutMs?: number
  check(): Promise<{ ok: boolean; latency_ms: number; detail?: string }>
}

export function readinessHandler(probes: ReadinessProbe[]): Handler {
  return async (req, res) => {
    const checks: Record<string, { ok: boolean; latency_ms: number; detail?: string }> = {}
    let allRequiredOk = true

    // Run probes IN PARALLEL with their per-probe timeout.
    await Promise.all(
      probes.map(async (probe) => {
        const start = Date.now()
        try {
          const result = await Promise.race([
            probe.check(),
            timeoutAfter(probe.timeoutMs ?? 1000),
          ])
          checks[probe.name] = { ...result, latency_ms: Date.now() - start }
          if (probe.required && !result.ok) allRequiredOk = false
        } catch (err) {
          checks[probe.name] = {
            ok: false,
            latency_ms: Date.now() - start,
            detail: (err as Error).message,
          }
          if (probe.required) allRequiredOk = false
        }
      }),
    )

    res.status(allRequiredOk ? 200 : 503).json({
      status: allRequiredOk ? 'ready' : 'not-ready',
      service: SERVICE_NAME,
      checks,
    })
  }
}
```

### 4.4 Caching

Naïve `/ready` is expensive: a KMS call per request would cost real money
and add latency. The handler caches probe results with a 2 s TTL:

- A probe that returned `ok: true` <2 s ago is reused.
- A probe that returned `ok: false` is re-run on the next request
  (no negative caching — we want fast recovery on transient failure).

The 2 s TTL is short enough that a real failure surfaces within ~2 s of
a load-balancer poll (typically 5-10 s intervals), and long enough that
the load balancer's polling traffic doesn't burn KMS quota.

### 4.5 Saturation behavior

Under saturation, `/ready` MUST NOT be the last thing to fail. If the
pool is exhausted, `/ready` should return 503 BEFORE user-facing
requests start to fail. The handler reserves a dedicated 1-slot
connection pool for its probes (`pgPool.healthClient`).

---

## 5. Load balancer / orchestrator wiring

### 5.1 Kubernetes

```yaml
livenessProbe:
  httpGet: { path: /health, port: 3100 }
  periodSeconds: 10
  failureThreshold: 3      # 30 s of failed health → restart pod
  timeoutSeconds: 1

readinessProbe:
  httpGet: { path: /ready, port: 3100 }
  periodSeconds: 5
  failureThreshold: 2      # 10 s of failed readiness → remove from rotation
  successThreshold: 1
  timeoutSeconds: 2

startupProbe:
  httpGet: { path: /ready, port: 3100 }
  periodSeconds: 5
  failureThreshold: 60     # 5 min cold-start budget before livenessProbe kicks in
  timeoutSeconds: 2
```

### 5.2 Vercel (web)

Vercel doesn't expose ready/liveness directly. The pattern: `/api/ready`
on `apps/web` is polled by an external uptime check (Better Uptime,
StatusCake, or AWS Route53 health check) and the result wired into the
deploy workflow's canary controller.

### 5.3 AWS ALB

```hcl
resource "aws_lb_target_group" "a2a_agent" {
  health_check {
    path                = "/ready"
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 10
    timeout             = 3
    matcher             = "200"
  }
}
```

---

## 6. Files to create/change

### New

- `packages/sdk/src/health/liveness.ts` — shared liveness handler.
- `packages/sdk/src/health/readiness.ts` — shared readiness handler +
  probe interface + cache.
- `packages/sdk/src/health/probes/postgres.ts` — Postgres probe.
- `packages/sdk/src/health/probes/kms.ts` — KMS probe (covers all 3
  signer keys + MAC keys via key-id parameter).
- `packages/sdk/src/health/probes/rpc.ts` — Ethereum RPC probe.
- `packages/sdk/src/health/probes/entrypoint.ts` — EntryPoint contract probe.
- `packages/sdk/src/health/probes/graphdb.ts` — GraphDB probe
  (non-required by default per DR3).
- `packages/sdk/src/health/probes/sibling-service.ts` — generic
  "another HTTP service's `/ready` returns 200" probe.
- `packages/sdk/src/health/probes/askar.ts` — Askar vault probe.
- Per-service `src/health.ts` — wires up the probe set.

### Changed

- Every service's `src/index.ts` — mount `/health` and `/ready` as the
  first two routes. Replace any existing ad-hoc `/health` handler.
- `scripts/fresh-start.sh` — `wait_http` is replaced with `wait_ready`
  (new helper) that polls `/ready` instead of `/health`. The fallback
  to `/.well-known/agent.json` is removed (no more "ready because the
  agent card serves").
- `apps/web/src/app/api/system-readiness/route.ts` — generalised to
  fan out to each service's `/ready` and surface the per-service
  results. The current "boot-seed completed?" boolean becomes one of N
  checks.

### CI guards

- `every-service-has-health-and-ready.test.ts` (Phase G) — parses every
  `apps/*/src/index.ts` and asserts both endpoints are mounted using
  the shared SDK handlers (not hand-rolled).
- `no-hand-rolled-health-handler.test.ts` — AST lint refuses any
  `app.get('/health' | '/ready'` outside of `livenessHandler` /
  `readinessHandler` imports.

---

## 7. Acceptance criteria

- [ ] Every service in the table at §1 has both `/health` and `/ready`
      mounted via the shared SDK helpers.
- [ ] `/health` returns ≤1 ms p99 measured by `wrk -t4 -c100 -d10s`.
- [ ] `/ready` returns ≤50 ms p99 under the same load (cached probe
      path).
- [ ] Cold `/ready` (cache empty) returns ≤500 ms p99. Test: clear the
      cache, hit `/ready` once.
- [ ] Killing KMS connectivity (drop network to `kms.us-east-1.amazonaws.com`)
      causes `/ready` to return 503 within 4 s (probe TTL + retry budget).
- [ ] Killing Postgres causes `/ready` to return 503 within 2 s.
- [ ] `fresh-start.sh` polls `/ready` and waits for all services to be
      ready before declaring the stack up.
- [ ] CI guard `every-service-has-health-and-ready.test.ts` passes.
- [ ] CI guard `no-hand-rolled-health-handler.test.ts` passes.

---

## 8. Test plan

### 8.1 Unit

- `test/health/readiness.test.ts` — exercises the readiness handler
  against synthetic probes. Asserts:
  - All required green → 200.
  - One required red → 503.
  - One non-required red → 200 with the failure surfaced.
  - Probe timeout → that probe reports `ok: false` with detail
    `'timeout after Xms'`.
  - Cache hit returns within 1 ms.
  - Cache miss runs the probe.
- `test/health/probes/*.test.ts` — one per probe; uses local-stub
  servers / containers.

### 8.2 Integration

- `test/integration/ready-blocks-traffic.test.ts` — boots a service
  with a broken Postgres URL, asserts `/ready` returns 503, asserts
  `/health` still returns 200. Asserts traffic is NOT routed when the
  orchestrator simulates a probe failure.

### 8.3 Chaos drill

- `docs/runbooks/chaos-health-checks.md` — quarterly drill:
  1. Block egress to KMS for 30 s.
  2. Confirm `/ready` flips to 503 within 5 s.
  3. Confirm load balancer drains traffic.
  4. Confirm `/health` continues to return 200 throughout (process is
     alive, just not ready).
  5. Restore KMS; confirm `/ready` returns to 200 within 5 s and
     traffic resumes.

---

## 9. Cost

| Item | Cost |
|---|---|
| KMS GetPublicKey calls (cached 30 s) | ~$0.03/key/day at 10 s LB poll cadence × 3 signer keys × 10 services = ~$1/mo |
| Postgres SELECT 1 (negligible) | $0 |
| RPC eth_call (Alchemy quota) | within free tier even at full load |
| GraphDB HEAD probe | $0 (in-house instance) |
| Dev time | 1 dev-week including CI guards |

---

## 10. Rollback

If the readiness probes are too aggressive and cause unnecessary 503s:
1. Lower probe-failure threshold from `failureThreshold: 2` to `failureThreshold: 5`
   (gives 25 s of red before the LB drains).
2. Increase probe TTL from 2 s to 5 s.
3. If still too noisy, mark a specific probe as non-required (`required:
   false`) and re-enable after the upstream is more reliable.

Probes are NEVER removed entirely — a probe that's too flaky is a
signal of a real upstream problem, not a reason to disable the probe.

---

## 11. Open questions

- **OQ-O2-1**: Should `/ready` itself be authenticated? Today the
  endpoint is unauthenticated and exposes which downstreams a service
  depends on. Proposed: keep unauthenticated for the LB's sake; emit
  only `ok: bool` + `latency_ms` for each probe (no error detail) to
  unauthenticated callers, and surface the full `detail` only when an
  `X-Ops-Token: $READINESS_DEBUG_TOKEN` header matches.
- **OQ-O2-2**: How does GraphDB's "no local fallback" posture (DR3)
  interact with the GraphDB probe being non-required? Proposed: keep
  non-required for `/ready` so GraphDB outage doesn't drain a2a-agent
  traffic, but expose a separate `/ready/graphdb` endpoint that the
  DR3 status page consumes.
- **OQ-O2-3**: Do we want a third endpoint, `/started`, distinct from
  `/ready`, that flips to 200 once the boot-seed completes? Proposed:
  reuse `/ready` — boot-seed completion is just another probe (the
  `policy-registry` probe already requires `assertPolicyCompleteness`
  to have passed at boot).
- **OQ-O2-4**: Does the LB cache `/ready` responses on its side? AWS
  ALB does not; Kubernetes does for `successThreshold` consecutive
  checks. Confirm Vercel's behavior before finalising the cookbook.
