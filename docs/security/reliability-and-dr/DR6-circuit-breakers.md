# DR6 — Circuit Breakers

> **Status**: DRAFT. **No circuit breakers anywhere today.** Every
> outbound call to GraphDB, KMS, OpenAI, Anthropic, Alchemy, the
> on-chain RPC, or another MCP service is a naked HTTP / SDK call. When
> a downstream is sick — slow, timing out, returning 5xx — the entire
> request queue piles up waiting; the upstream service saturates its
> connection pool / event loop; cascading failure.
>
> This document specifies the circuit-breaker pattern for every
> external call: library choice, thresholds, fallback behavior,
> half-open semantics, and the operational metrics.
>
> **Effort**: S (≤3 days for the SDK wrapper + first few call-sites).
> **Owner**: Backend lead.
> **Depends on**: O2 (probes incorporate circuit state; an open circuit
> may flip readiness for that downstream), DR3 (GraphDB degraded-mode
> implementation uses a circuit-breaker for the same purpose).
> **Unblocks**: surviving downstream incidents without cascading.

---

## 1. Today's state (honest)

| Downstream | Caller patterns today | Circuit breaker | Outcome on slow downstream |
|---|---|---|---|
| GraphDB | `fetch` + retry-on-error in a few places | None | All callers block; pool fills up; cascade |
| KMS (AWS / GCP) | SDK calls with built-in retry | SDK has exponential backoff but no breaker | Each retry waits; concurrency builds |
| Alchemy RPC | viem client with default retry | None | Same as GraphDB |
| Inter-MCP (a2a → person-mcp, etc.) | `fetch` | None | Same |
| Anthropic / OpenAI (where used) | SDK calls | None | Same |
| Audit-checkpoint sink | `fetch` (Sprint 5 P1-5) | None | Queue grows; sink HEAD timeout configured at 5 s for boot only |

If KMS is slow (returning in 5 s instead of 50 ms) under load today:
- Every userOp signing blocks for 5 s.
- userOp throughput collapses.
- A2A agent's in-flight count climbs.
- `/ready` may flip to red on connection-pool saturation (via O2's
  measurement of inflight) but only after significant collateral
  damage.
- Users see timeouts.

A circuit breaker would: detect that KMS is slow, fail fast for the
next ~30 s, surface a clear error, allow KMS time to recover.

This is the gap DR6 closes.

---

## 2. Goals

1. **Every external call has a circuit breaker.** Inbound calls
   (handlers) do NOT — they must serve as best they can; the breaker
   protects OUTBOUND calls.
2. **Half-open recovery.** After cooldown, one trial request probes
   whether the downstream is healthy.
3. **Failure is loud.** An open circuit returns an explicit error
   (`CircuitBreakerOpen`) — not a silent fallback.
4. **Metrics emitted.** Circuit state transitions go to Datadog;
   open events page on-call (Sev-2).
5. **Per-downstream tuning.** Different thresholds for KMS (chatty,
   reliable) vs GraphDB (less chatty, less reliable) vs Anthropic
   (very chatty, occasionally slow).

---

## 3. Library decision

| Option | Pros | Cons | Decision |
|---|---|---|---|
| **opossum** (Node) | Mature; well-documented; OSS. | One more dependency. | **Chosen.** |
| **cockatiel** | Microsoft-supported; OSS. | Less ecosystem support. | Acceptable backup. |
| **Hand-rolled** | Zero dependency. | Re-implementing well-known patterns. | Rejected. |

The breaker is a wrapper, so swapping libraries later is straightforward.

```typescript
// packages/sdk/src/resilience/breaker.ts
import CircuitBreaker from 'opossum'

export interface BreakerOptions {
  name: string
  timeoutMs: number              // per-call timeout
  errorThresholdPercentage: number // open when % of recent calls failed
  resetTimeoutMs: number         // half-open after this many ms
  volumeThreshold?: number       // min request count before evaluating
}

export function createBreaker<T extends (...args: any[]) => Promise<any>>(
  call: T,
  opts: BreakerOptions,
): T {
  const breaker = new CircuitBreaker(call, {
    timeout: opts.timeoutMs,
    errorThresholdPercentage: opts.errorThresholdPercentage,
    resetTimeout: opts.resetTimeoutMs,
    volumeThreshold: opts.volumeThreshold ?? 5,
    name: opts.name,
  })

  // Emit metrics on every state change.
  breaker.on('open', () => emit('breaker.open', opts.name))
  breaker.on('halfOpen', () => emit('breaker.halfOpen', opts.name))
  breaker.on('close', () => emit('breaker.close', opts.name))
  breaker.on('reject', () => emit('breaker.reject', opts.name))
  breaker.on('timeout', () => emit('breaker.timeout', opts.name))
  breaker.on('failure', (err) => emit('breaker.failure', opts.name, err))

  return ((...args: Parameters<T>) =>
    breaker.fire(...args).catch((err) => {
      if (breaker.opened) {
        throw new CircuitBreakerOpen(opts.name, err)
      }
      throw err
    })) as T
}

export class CircuitBreakerOpen extends Error {
  constructor(name: string, cause?: unknown) {
    super(`circuit breaker '${name}' is open`)
    ;(this as Error & { cause?: unknown }).cause = cause
  }
}
```

---

## 4. Per-downstream configuration

### 4.1 KMS

```typescript
const kmsSignBreaker = createBreaker(rawKmsSign, {
  name: 'kms:sign',
  timeoutMs: 2000,               // KMS sign typically <100ms; 2s is generous
  errorThresholdPercentage: 25,  // open when 25% of last calls failed
  resetTimeoutMs: 10000,         // try again after 10s
  volumeThreshold: 10,
})
```

Rationale: KMS is reliable; we want a fairly aggressive open behavior
(low error threshold) so a regional KMS hiccup doesn't drag the whole
service down for 30 s.

### 4.2 GraphDB

```typescript
const graphdbBreaker = createBreaker(rawGraphdbQuery, {
  name: 'graphdb:query',
  timeoutMs: 5000,
  errorThresholdPercentage: 50,
  resetTimeoutMs: 30000,         // GraphDB outages tend to last longer; less frequent probing
  volumeThreshold: 5,
})
```

Combined with DR3's degraded-mode handler: an open GraphDB breaker
triggers the fallback to on-chain reads.

### 4.3 Alchemy RPC

```typescript
const rpcBreaker = createBreaker(rawRpcCall, {
  name: 'rpc:alchemy',
  timeoutMs: 3000,
  errorThresholdPercentage: 30,
  resetTimeoutMs: 15000,
  volumeThreshold: 10,
})
```

### 4.4 Inter-MCP

Each inter-MCP edge gets its own breaker, keyed by `<caller>→<callee>`.
E.g. `a2a:person-mcp`, `web:org-mcp`, etc.

```typescript
const breaker = createBreaker(rawMcpFetch, {
  name: `${caller}:${callee}`,
  timeoutMs: 5000,
  errorThresholdPercentage: 50,
  resetTimeoutMs: 15000,
  volumeThreshold: 5,
})
```

### 4.5 Anthropic / OpenAI

```typescript
const anthropicBreaker = createBreaker(rawAnthropicSDKCall, {
  name: 'anthropic:messages',
  timeoutMs: 30000,              // LLM calls are slow by nature
  errorThresholdPercentage: 50,
  resetTimeoutMs: 60000,         // LLM outages can be long
  volumeThreshold: 3,            // low volume; trip with fewer samples
})
```

### 4.6 Audit-checkpoint sink

```typescript
const sinkBreaker = createBreaker(rawSinkPost, {
  name: 'audit-sink',
  timeoutMs: 10000,
  errorThresholdPercentage: 50,
  resetTimeoutMs: 30000,
  volumeThreshold: 3,
})
```

An open sink-breaker means checkpoints queue locally (per O3 §5.2);
the local spool drains on next checkpoint success.

---

## 5. Fallback behavior

When a breaker is open, the caller has three options:

### 5.1 Fail fast (default)

The breaker throws `CircuitBreakerOpen`; the caller surfaces 503 to
the user with a "service temporarily unavailable, please try again"
message.

### 5.2 Degraded result

For paths where the downstream is enriching but not essential, the
caller catches `CircuitBreakerOpen` and returns a degraded result.
Example: GraphDB-enriched marketplace listings degrade to on-chain
reads (per DR3).

```typescript
try {
  return await graphdbEnrichedListings()
} catch (err) {
  if (err instanceof CircuitBreakerOpen) {
    return onchainOnlyListings()
  }
  throw err
}
```

### 5.3 Cached result

If a recent cache exists (per DR3 §5.2), serve from cache. The
breaker-open state implies the upstream is sick; serving slightly
stale data is preferable to nothing.

```typescript
try {
  const fresh = await getAgentDetailFromGraphDB(id)
  cache.set(id, fresh)
  return fresh
} catch (err) {
  if (err instanceof CircuitBreakerOpen && cache.has(id)) {
    return cache.get(id)
  }
  throw err
}
```

---

## 6. Half-open semantics

Opossum's default is: after `resetTimeoutMs`, the next single request
is allowed through. On success → close. On failure → re-open. This
matches the standard pattern.

The single trial request can be the first user request OR a synthetic
probe — opossum doesn't differentiate. We accept this.

Important: while the breaker is half-open, only ONE concurrent request
is in flight against the downstream. This is by design; multiple
concurrent trials might overwhelm a recovering downstream.

---

## 7. Monitoring

### 7.1 Metrics

Per breaker:
- `breaker.state` (gauge, 0=closed, 1=half-open, 2=open).
- `breaker.requests.total` (counter).
- `breaker.requests.success` (counter).
- `breaker.requests.failure` (counter).
- `breaker.requests.timeout` (counter).
- `breaker.requests.rejected` (counter — when breaker is open).
- `breaker.transitions.open` (counter; event when state goes to open).
- `breaker.transitions.close` (counter).

### 7.2 Alerts

| Alert | Threshold | Severity |
|---|---|---|
| Any breaker open >5 min | sustained | Sev-2 |
| Any Tier-1 breaker open >1 min (e.g. KMS) | sustained | Sev-1 |
| Breaker state flapping (open→close→open within 10 min, >3 times) | | Sev-2 (signals an upstream that's marginally healthy) |
| Aggregate rejected requests >100/min across all breakers | | Sev-2 |

Each routes to a runbook (`docs/runbooks/breaker-open-<name>.md`).

### 7.3 Dashboard

`infra/datadog/dashboards/circuit-breakers.json`:
- All breakers; current state.
- Reject count over time.
- Open events overlaid with relevant deploys.

---

## 8. Files to create/change

### New

- `packages/sdk/src/resilience/breaker.ts` — shared SDK wrapper.
- `packages/sdk/src/resilience/breakers/kms.ts` — KMS-specific
  factory.
- `packages/sdk/src/resilience/breakers/graphdb.ts`
- `packages/sdk/src/resilience/breakers/rpc.ts`
- `packages/sdk/src/resilience/breakers/inter-mcp.ts`
- `packages/sdk/src/resilience/breakers/llm.ts`
- `packages/sdk/src/resilience/breakers/audit-sink.ts`
- `infra/datadog/dashboards/circuit-breakers.json`
- `infra/datadog/monitors/breaker-open-*.yaml`
- `docs/runbooks/breaker-open-<name>.md` per breaker

### Changed

- Every existing call site to a downstream — wraps the raw SDK call
  with the appropriate breaker.
- `apps/a2a-agent/src/auth/kms-signer.ts` (and the GCP equivalent) —
  uses the KMS breaker.
- `apps/a2a-agent/src/audit-checkpoint.ts` — uses the sink breaker.
- `packages/discovery/src/graphdb-client.ts` — uses the GraphDB
  breaker; integrates with DR3's degraded-mode handler.

### CI guards

- `no-raw-external-call.test.ts` — AST lint refusing direct `fetch` /
  raw-SDK calls to external services outside the breaker factory paths.

---

## 9. Acceptance criteria

- [ ] All identified downstreams have breakers wired.
- [ ] Breaker library `opossum` integrated; CircuitBreakerOpen exception
      defined.
- [ ] Datadog dashboard live.
- [ ] Alerts wired per §7.2.
- [ ] Test: simulate KMS slow-down; confirm KMS breaker opens within
      its threshold; confirm reject count climbs; confirm KMS recovers;
      confirm breaker half-opens and closes.
- [ ] Test: simulate GraphDB outage; confirm GraphDB breaker opens;
      confirm DR3 degraded-mode handler is invoked.
- [ ] CI guard refuses raw external call patterns.

---

## 10. Test plan

### 10.1 Unit

- `test/resilience/breaker.test.ts`:
  - Closed → many failures → opens at threshold.
  - Open → next call rejects immediately with `CircuitBreakerOpen`.
  - Open → cooldown elapsed → half-open.
  - Half-open + success → closes.
  - Half-open + failure → re-opens.
  - Volume-threshold semantics: fewer than `volumeThreshold` calls in
    window → breaker stays closed even with many failures (avoids
    over-tripping on low traffic).

### 10.2 Integration

- Inject a slow-server for each downstream type; verify the breaker's
  observed behavior matches the unit-test expectations.

### 10.3 Chaos drill

- Quarterly: pick a random downstream; introduce latency or failure
  injection in dev; verify the production-config breakers trip
  appropriately and the team's runbooks point at the correct
  remediation.

---

## 11. Cost

- `opossum` adds ~10 KB to bundle. Free.
- Datadog metrics: well within existing custom-metrics budget.
- Engineering: 2-3 days to wire all downstreams.

Total: $0 marginal infrastructure.

---

## 12. Rollback

Each breaker can be disabled per-downstream via an env var:

```bash
SMART_AGENT_BREAKER_DISABLE=kms:sign,graphdb:query
```

The SDK wrapper checks this env at startup and constructs a pass-
through wrapper instead of a CircuitBreaker.

Useful for incident-time "let everything through, we'll diagnose
later" — but in practice the breaker is what's keeping the system
alive during the incident. Use sparingly.

---

## 13. Open questions

- **OQ-DR6-1**: Should breaker state be shared across instances of a
  service? Today each instance has its own breaker — fine for
  uniformly-distributed failures, but a single instance might
  prematurely close before realising the downstream is still sick.
  Proposed: per-instance is fine. The volume-threshold mechanism
  mitigates the worst case.
- **OQ-DR6-2**: How do breakers interact with O3's graceful shutdown?
  Proposed: during drain, new outbound calls still respect the
  breaker. An open breaker during shutdown means "we can't drain
  cleanly through this downstream" — log + force-exit at the budget.
- **OQ-DR6-3**: Per-tenant breakers (e.g. one user is hitting an
  abusive code path that's tripping a shared breaker for everyone)?
  Proposed: not now. Add later if a real user complaint surfaces.
- **OQ-DR6-4**: Should the breaker emit a 503 with a `Retry-After`
  header pointing at `resetTimeoutMs`? Proposed: yes — well-behaved
  clients (mobile apps, etc.) will back off appropriately.
- **OQ-DR6-5**: Hystrix-style "command pattern" (separate thread
  pool per downstream) vs opossum-style (asynchronous wrapper)?
  Proposed: opossum-style — Node's event loop semantics are different
  from JVM; thread isolation isn't the right model.
