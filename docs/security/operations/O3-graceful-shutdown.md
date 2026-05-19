# O3 — Graceful Shutdown

> **Status**: DRAFT. **Today every service shuts down hard on SIGTERM.**
> `scripts/fresh-start.sh:stop_all` does `kill $pids` without prior
> drain. Any in-flight userOp, MAC verification, or audit-row write is
> abandoned mid-flight.
>
> This document specifies the SIGTERM handler, the drain protocol, the
> grace period, and how `/ready` (O2) flips to coordinate with the
> orchestrator.
>
> **Effort**: S (≤3 days for all 10 services).
> **Owner**: Each service's owner.
> **Depends on**: O2 (`/ready` flips false on SIGTERM).
> **Unblocks**: O1 (rolling/canary deploys can drain old pods cleanly).

---

## 1. Today's state (honest)

| Service | SIGTERM handler | Drain on shutdown | Audit-write durability |
|---|---|---|---|
| `apps/web` (Next.js) | Next.js default (immediate exit) | None | N/A |
| `apps/a2a-agent` (Hono) | None — Node default | None | At-best-effort (Sprint 5 W2 hardened the audit-write to be pre-response, but shutdown is not coordinated) |
| MCPs | None — Node default | None | None |

If a userOp is in flight when SIGTERM arrives today:
1. The Node process exits within the OS default 100 ms `kill` window.
2. The userOp may have been broadcast to the bundler but not yet
   confirmed.
3. The audit row for the userOp may have been queued but not written.
4. The client sees a connection reset and retries; the retry may
   double-submit because the audit row didn't record the first attempt.

This is the gap O3 closes.

---

## 2. Goals

1. **SIGTERM triggers an orderly drain.** No in-flight request is
   abandoned mid-flight.
2. **The drain has a bounded budget** (30 s default; tunable via
   `SHUTDOWN_GRACE_SECS`). After the budget, the process force-exits
   to avoid hanging the orchestrator.
3. **`/ready` flips to 503 immediately on SIGTERM** so the load
   balancer stops sending new traffic before the existing traffic
   drains.
4. **Audit rows complete before exit.** Spec 007 Phase F.2 requires
   pre-response audit-write durability; O3 extends that to the
   shutdown path: pending audit writes are flushed before exit.
5. **Dev parity.** The same SIGTERM handler runs in dev. Kicking a
   service via `tsx watch` (file change) triggers the drain in dev as
   well as in prod.

---

## 3. The drain protocol

```
                       T+0s                T+5s            T+30s
SIGTERM received    ──────────────────────────────────────────────►
                       │                                       │
                       │                                       │
/ready                 200 ──► 503 (immediate)                 (still 503)
                       │                                       │
new connections        accept ─► reject (immediate, conn: close)
                       │                                       │
in-flight requests     drain ──────────────────────────────►   │
                       │           ▲                           │
                       │           │ each request completes   │
                       │           │ normally, then conn       │
                       │           │ closes                    │
                       │                                       │
audit-write queue      flush ───────────────────────────────►  │
                       │                                       │
postgres pool          drain ───────────────────────────────►  │
                       │                                       │
                                                               ▼
                                                  process.exit(0)
                                                  (or force-exit on T+30s)
```

### 3.1 Step 1 — `/ready` flips to 503

```typescript
// packages/sdk/src/health/liveness.ts (shared with O2)
let _shutdownInProgress = false
export function shutdownInProgress(): boolean { return _shutdownInProgress }
export function markShutdown() { _shutdownInProgress = true }
```

The readiness handler from O2 reads this flag:

```typescript
if (shutdownInProgress()) {
  return res.status(503).json({ status: 'shutting-down', ... })
}
```

The load balancer's readiness poll (5 s cadence per O2 §5.1) sees 503
within at most 5 s. Within 2 consecutive polls (10 s), the LB removes
this instance from rotation.

### 3.2 Step 2 — refuse new connections

The HTTP server is told to stop accepting new connections:

```typescript
server.close((err) => {
  if (err) console.error('[shutdown] server.close error:', err)
})
```

`server.close` returns immediately; the callback fires only after all
existing connections close. In Node's HTTP server, `close` rejects new
connections but DRAINS existing ones (keep-alive sockets are closed
after their current response).

### 3.3 Step 3 — wait for in-flight requests

A request counter is incremented on every request and decremented on
response-end:

```typescript
// packages/sdk/src/lifecycle/in-flight.ts
let _inFlight = 0
export const inFlightMiddleware: Handler = async (c, next) => {
  _inFlight++
  try { await next() } finally { _inFlight-- }
}
export function inFlightCount(): number { return _inFlight }
```

Mounted as the first middleware in every service.

The shutdown handler polls `inFlightCount()` every 100 ms with a
30 s budget.

### 3.4 Step 4 — flush audit-write queue

Spec 007 Phase F.2 requires audit writes complete pre-HTTP-response. This
gives us the invariant: when `inFlightCount() === 0`, every audit row
has been INSERTed.

But the on-chain audit-checkpoint POST to `AUDIT_CHECKPOINT_SINK_URL`
(Sprint 5 P1-5) is asynchronous from the audit-row INSERT. The shutdown
handler explicitly flushes the checkpoint pending queue:

```typescript
await flushAuditCheckpointQueue({ timeoutMs: 5000 })
```

If the flush times out, log loudly and continue — losing a checkpoint
is bad, but hanging the shutdown is worse (the orchestrator's hard kill
arrives at T+30 s regardless).

### 3.5 Step 5 — drain Postgres pool

```typescript
await pgPool.end({ timeoutMillis: 2000 })
```

The pool waits for in-flight queries to finish (they should already be
done — they were tied to in-flight requests) and then closes every
connection cleanly. Postgres logs `connection terminated by client` not
`connection reset by peer` — useful for forensic distinction.

### 3.6 Step 6 — exit

```typescript
console.log(JSON.stringify({ event: 'shutdown-complete', service: SERVICE_NAME, durationMs }))
process.exit(0)
```

If the budget expired before steps 3–5 completed, exit code 1 with a
loud warning so the orchestrator and the deploy workflow can detect
incomplete drains.

---

## 4. Implementation

### 4.1 Shared SDK module

```typescript
// packages/sdk/src/lifecycle/graceful-shutdown.ts

import type { Server } from 'http'
import { markShutdown, inFlightCount } from '../health/liveness'

export interface ShutdownHooks {
  server: Server
  serviceName: string
  graceSecs?: number   // default 30
  onBeforeExit?: () => Promise<void>  // service-specific cleanup
}

export function installGracefulShutdown(hooks: ShutdownHooks) {
  const grace = (hooks.graceSecs ?? 30) * 1000
  let shuttingDown = false

  async function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    const start = Date.now()
    console.log(JSON.stringify({ event: 'shutdown-start', service: hooks.serviceName, signal }))

    // Step 1: flip /ready to 503.
    markShutdown()

    // Step 2: refuse new connections.
    hooks.server.close((err) => {
      if (err) console.error('[shutdown] server.close error:', err)
    })

    // Step 3: wait for in-flight to drain.
    const deadline = start + grace
    while (inFlightCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (inFlightCount() > 0) {
      console.warn(JSON.stringify({
        event: 'shutdown-drain-incomplete',
        service: hooks.serviceName,
        remaining: inFlightCount(),
        graceMs: grace,
      }))
    }

    // Step 4-5: service-specific cleanup (audit flush, pool drain, etc.)
    try {
      await Promise.race([
        hooks.onBeforeExit?.() ?? Promise.resolve(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('cleanup timeout')), 5000)),
      ])
    } catch (err) {
      console.error('[shutdown] cleanup failed:', err)
    }

    const durationMs = Date.now() - start
    console.log(JSON.stringify({
      event: 'shutdown-complete',
      service: hooks.serviceName,
      durationMs,
      cleanExit: inFlightCount() === 0,
    }))
    process.exit(inFlightCount() === 0 ? 0 : 1)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
```

### 4.2 Per-service wiring

Each service's `src/index.ts`:

```typescript
const server = app.listen(PORT, () => { ... })

installGracefulShutdown({
  server,
  serviceName: 'a2a-agent',
  graceSecs: Number(process.env.SHUTDOWN_GRACE_SECS ?? '30'),
  onBeforeExit: async () => {
    await flushAuditCheckpointQueue({ timeoutMs: 5000 })
    await pgPool.end({ timeoutMillis: 2000 })
  },
})
```

---

## 5. Special cases

### 5.1 In-flight userOps

A userOp is potentially long-running (5–30 s from submission to
inclusion). The 30 s grace budget may not be enough for every userOp
to confirm.

**Resolution**: the shutdown handler waits for the *broadcast* to
complete (userOp sent to bundler), not for *inclusion* (on-chain
confirmation). The userOp client treats inclusion as eventually-
consistent — the audit row records "submitted at timestamp T," and a
separate watcher polls for inclusion. The watcher is a separate process
that survives this service's shutdown.

### 5.2 Audit-checkpoint flush failure

If the external sink (Azure Log Analytics DCR, S3 bucket, etc.) is
unreachable during shutdown, the queue cannot be flushed. The shutdown
handler:
1. Logs a structured WARN with the pending count.
2. Writes those pending checkpoints to a local on-disk spool
   (`<service-data-dir>/audit-checkpoint-spool/`).
3. On next boot, replays the spool before declaring `/ready`.

This avoids losing audit attestation even when the sink is down at
shutdown time.

### 5.3 Postgres pool with active transaction

If a transaction is still open when shutdown starts (because a request
is in-flight in Step 3), the pool drain in Step 5 waits up to 2 s. If
the transaction doesn't commit/rollback in 2 s, the pool force-closes
and Postgres rolls back. Combined with the application-level
idempotency keys (DR7), this is safe — the client's retry hits the
same idempotency key and gets the cached result.

### 5.4 SIGKILL

If the orchestrator sends SIGKILL (rather than SIGTERM), the OS kills
the process immediately with no chance to drain. The graceful-shutdown
handler can't catch SIGKILL. The mitigation is:
- Kubernetes' `terminationGracePeriodSeconds: 35` is set to give the
  handler 30 s + 5 s slack before SIGKILL.
- Docker's default 10 s is too short — we override to 35 s via
  `docker stop -t 35`.
- The deploy workflow's container-stop command also passes `-t 35`.

---

## 6. Files to create/change

### New

- `packages/sdk/src/lifecycle/graceful-shutdown.ts` — shared handler.
- `packages/sdk/src/lifecycle/in-flight.ts` — request-counter middleware.
- `packages/sdk/src/lifecycle/audit-flush.ts` — checkpoint-queue flush helper.

### Changed

- Every service's `src/index.ts` — install the handler at boot.
- Every service's `src/middleware.ts` (or equivalent) — mount the
  in-flight middleware as the first middleware.
- `scripts/fresh-start.sh` — `stop_all` and `kill_port` send SIGTERM
  first, wait 35 s, then SIGKILL. Currently `kill_port` sends the
  default (SIGTERM) but immediately follows with `kill -9` if the
  process survives — that 1-s window is too tight.

### CI guards

- `every-service-installs-graceful-shutdown.test.ts` (Phase G) — parses
  every `apps/*/src/index.ts` and asserts `installGracefulShutdown` is
  called.
- `in-flight-middleware-mounted-first.test.ts` — parses the middleware
  chain and asserts `inFlightMiddleware` is mounted before any handler
  middleware.

---

## 7. Acceptance criteria

- [ ] SIGTERM to `apps/a2a-agent` while a userOp is in flight: the
      userOp completes; no client sees a connection reset.
- [ ] `/ready` returns 503 within 100 ms of SIGTERM. Test: `kill -TERM
      $PID && sleep 0.1 && curl -fsS http://localhost:3100/ready` returns
      503.
- [ ] After T+30 s, the process exits regardless of in-flight state.
      Test: simulate a hung request, send SIGTERM, confirm process
      exits at T+30s with exit code 1 and a structured warning.
- [ ] Postgres pool drains cleanly. Test: tail Postgres log during
      shutdown, confirm no `connection reset` entries from this service.
- [ ] Audit-checkpoint queue is flushed. Test: queue 5 checkpoints,
      SIGTERM, confirm all 5 reach the sink.
- [ ] On-disk audit-checkpoint spool replay works. Test: kill the sink,
      queue checkpoints, SIGTERM, restart service with sink restored,
      confirm spool is drained.
- [ ] Kubernetes `terminationGracePeriodSeconds: 35` configured.
- [ ] Docker `--stop-timeout 35` configured.
- [ ] CI guards `every-service-installs-graceful-shutdown.test.ts` and
      `in-flight-middleware-mounted-first.test.ts` pass.

---

## 8. Test plan

### 8.1 Unit

- `test/lifecycle/graceful-shutdown.test.ts` — exercises the handler
  with a synthetic HTTP server and mocked cleanup:
  - SIGTERM with zero in-flight → exits at T<200ms.
  - SIGTERM with 5 in-flight that complete at T+5s → exits at T~5s.
  - SIGTERM with 1 hung in-flight → exits at T+30s with code 1.
  - SIGTERM twice in quick succession → second is no-op.

### 8.2 Integration

- `test/integration/shutdown-drain.test.ts` — boots `apps/a2a-agent`,
  starts a userOp submission, sends SIGTERM mid-flight, asserts the
  userOp's HTTP response is delivered before the process exits.

### 8.3 Chaos drill

- `docs/runbooks/chaos-graceful-shutdown.md` — quarterly drill:
  1. Start a load generator (k6) at 100 RPS.
  2. SIGTERM a service.
  3. Confirm load generator sees zero connection resets.
  4. Confirm `/ready` flipped to 503 within 100 ms.
  5. Confirm process exited within 30 s.

---

## 9. Rollback

If graceful shutdown introduces issues (rare; the change is additive):

1. Set `SHUTDOWN_GRACE_SECS=0` in the service's env — the handler
   becomes a near-no-op (flip `/ready`, then exit immediately).
2. Confirm via deployment-time chaos drill that the regression is
   resolved before reverting code.

The handler itself is NEVER removed — even `graceSecs=0` is safer than
the pre-O3 state because it still flips `/ready` first.

---

## 10. Open questions

- **OQ-O3-1**: Should the 30 s budget be per-tier? Tier 1 services
  (a2a-agent) may need 60 s for userOps; MCPs may be fine with 10 s.
  Proposed: keep 30 s as the default; tune per service via
  `SHUTDOWN_GRACE_SECS`.
- **OQ-O3-2**: How do we handle long-poll WebSocket connections (none
  today, but the GraphDB sync uses long-lived connections)? Proposed:
  WebSocket handlers participate in the in-flight counter; the drain
  sends a close frame to each peer at the start of the drain so peers
  reconnect to a healthy instance.
- **OQ-O3-3**: Does Vercel honour SIGTERM at all? Vercel Functions are
  per-invocation; there's no long-running process to drain. Proposed:
  this plan applies to AWS/GCP-hosted services; Vercel-hosted
  `apps/web` relies on Vercel's own routing during deploys.
- **OQ-O3-4**: Is there a scenario where we want to force the drain
  budget to ≤5 s (e.g. a quick autoscaler scale-down on idle)?
  Proposed: yes, via `SHUTDOWN_GRACE_SECS=5`. Document the trade-off in
  the runbook.
