# DR7 — Idempotency Keys

> **Status**: DRAFT. **Mutating endpoints have no idempotency
> keys today.** If a client retries a `POST /api/pool/create` after a
> network blip, the result depends entirely on what the server saw —
> may be one pool, may be two, may be inconsistent state. Spec 007
> Phase F.2 specifies transactional nonce inserts (replay-safe) for
> the low-level inter-service nonces, but the user-facing API layer
> has no equivalent. DR1 failover, DR6 circuit breakers, and O3
> graceful shutdown all rely on safe-retry behavior at the client
> level — and that requires server-side idempotency.
>
> This document specifies the idempotency-key middleware, the storage
> contract, the policy for which endpoints participate, and the
> client-side conventions.
>
> **Effort**: M (1 week middleware + retrofit all mutating endpoints).
> **Owner**: Backend lead + per-service owner.
> **Depends on**: Spec 007 Phase F.2 (Postgres exists for the
> idempotency-store table), O3 (graceful shutdown — idempotency saves
> drained-mid-flight retries).
> **Unblocks**: every "the user double-submitted" class bug; safe
> client retries; DR1 failover correctness.

---

## 1. Today's state (honest)

| Mutating endpoint | Idempotency mechanism | Risk |
|---|---|---|
| `POST /api/pool/create` (web) | None | Double pool on retry |
| `POST /api/pledge` (web → org-mcp) | None | Double pledge |
| `POST /api/honor/settle` | None | Double settlement / double USDC transfer |
| `POST /api/vote` (org-mcp) | None | Double vote |
| `POST /api/delegation/grant` (a2a-agent) | None | Double delegation (mostly tolerable — on-chain dedupe catches it) |
| `POST /api/session/init` (a2a-agent) | None | Multiple sessions issued |
| `POST /api/onchain-redeem` (a2a-agent) | nonce-based at the userOp level | Safe at the on-chain layer; HTTP-layer retries before submission can still double-submit |

A real example: in the demo recording, the user clicks "Pledge" and
the network is slow; they click again. Today both requests reach the
server; depending on timing, either two pledges appear, or the second
errors mid-write and leaves inconsistent state.

This is the gap DR7 closes.

---

## 2. Goals

1. **Every mutating endpoint accepts an `Idempotency-Key` header.**
   Per-request UUID supplied by the client. Server stores result keyed
   by UUID for 24 hours; replay returns the same result with
   `X-Idempotency-Replay: true`.
2. **Idempotency works across DR1 failover.** The idempotency store
   is in Postgres (durable, multi-AZ).
3. **No state from a partial write survives.** If the server crashes
   mid-write before the idempotency record is committed, the client's
   retry succeeds without inheriting partial state.
4. **Mandatory for Tier 1 mutating endpoints.** Server returns 400 if
   the header is missing on a Tier-1 mutating path.
5. **Optional for Tier 2 / Tier 3 endpoints** initially; ramp to
   mandatory.
6. **Idempotency replay is observable.** Response header + audit row.

---

## 3. Protocol

### 3.1 Request shape

```
POST /api/pool/create
Idempotency-Key: 11111111-2222-3333-4444-555555555555
Content-Type: application/json

{ "name": "Catalyst Hub", "treasury": "0xabc..." }
```

### 3.2 First-time response

```
HTTP/1.1 200 OK
X-Idempotency-Replay: false

{ "poolId": "0xdef...", "status": "created" }
```

The server commits the idempotency record + the application state in
a single Postgres transaction. The transaction is what makes "no
partial state" true.

### 3.3 Replay response

```
HTTP/1.1 200 OK
X-Idempotency-Replay: true

{ "poolId": "0xdef...", "status": "created" }
```

Same body as the first call. Status codes are preserved.

### 3.4 Conflicting replay

```
POST /api/pool/create
Idempotency-Key: 11111111-2222-3333-4444-555555555555

{ "name": "Different Name" }
```

If the request body's hash differs from the stored hash for the same
key, the server returns:

```
HTTP/1.1 422 Unprocessable Entity
{ "error": "idempotency_key_conflict",
  "message": "this key was previously used for a different request" }
```

This catches the bug where a client accidentally reuses an
idempotency key for a different operation.

### 3.5 In-flight replay

If a replay arrives while the first request is still being processed
(retries can be aggressive), the server can either:
- Block until the first completes, then return the result.
- Immediately return `409 Conflict` with `Retry-After: 1`.

Decision: block-and-wait for up to 5 s; after that return 409. Block-
and-wait is the better UX; the 5 s cap prevents DoS.

---

## 4. Storage

### 4.1 Schema

```sql
-- Per-service Postgres database; lives in the service's own DB.
CREATE TABLE idempotency_keys (
  key            UUID PRIMARY KEY,
  request_hash   BYTEA NOT NULL,      -- sha256 of canonical request body
  endpoint       TEXT NOT NULL,        -- e.g. 'POST /api/pool/create'
  status_code    INTEGER NOT NULL,
  response_body  BYTEA NOT NULL,       -- compressed; can be large
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL  -- 24 h from creation
);

CREATE INDEX idempotency_keys_expires_at ON idempotency_keys(expires_at);
```

### 4.2 Lifecycle

- INSERT happens in the same transaction as the application state
  change.
- Reads happen via `SELECT ... FOR UPDATE` to coordinate with concurrent
  retries (for the in-flight-replay case).
- A daily cron deletes expired rows.

### 4.3 Storage cost

Average row: ~5 KB (response body compressed). At 100 requests/min and
24-hour retention, ~700 MB per service. Modest.

---

## 5. Middleware

```typescript
// packages/sdk/src/resilience/idempotency.ts
import type { Context, Next } from 'hono'
import { canonicalize } from './canonicalize-body'
import { sha256 } from '@noble/hashes/sha256'

export interface IdempotencyOptions {
  required: boolean              // 400 if missing
  ttlSeconds?: number            // default 86400
  blockWaitMs?: number           // default 5000
}

export function idempotencyMiddleware(
  pg: PostgresClient,
  opts: IdempotencyOptions,
) {
  return async (c: Context, next: Next) => {
    const key = c.req.header('idempotency-key')
    if (!key) {
      if (opts.required) {
        return c.json({ error: 'idempotency_key_required' }, 400)
      }
      return next()
    }
    if (!isUuid(key)) {
      return c.json({ error: 'idempotency_key_malformed' }, 400)
    }

    const body = await c.req.text()
    const hash = sha256(canonicalize(body))

    // Atomic upsert + check.
    const existing = await pg`
      SELECT request_hash, status_code, response_body
      FROM idempotency_keys WHERE key = ${key} FOR UPDATE
    `
    if (existing.length > 0) {
      const row = existing[0]
      if (!bufferEqual(row.request_hash, hash)) {
        return c.json(
          { error: 'idempotency_key_conflict' },
          422,
        )
      }
      c.header('X-Idempotency-Replay', 'true')
      return c.body(row.response_body, row.status_code)
    }

    // First time. Run the handler.
    await next()

    // After handler completes, persist the result.
    const status = c.res.status
    const responseBody = await c.res.clone().text()

    await pg`
      INSERT INTO idempotency_keys
        (key, request_hash, endpoint, status_code, response_body, expires_at)
      VALUES
        (${key}, ${hash}, ${c.req.method + ' ' + c.req.path}, ${status},
         ${Buffer.from(responseBody)}, now() + interval '${opts.ttlSeconds ?? 86400} seconds')
    `

    c.header('X-Idempotency-Replay', 'false')
  }
}
```

Mounted per-route:

```typescript
app.post(
  '/api/pool/create',
  idempotencyMiddleware(pg, { required: true }),
  poolCreateHandler,
)
```

### 5.1 Transactional integration

The middleware's `INSERT` and the handler's mutations MUST happen in
the same transaction. The simplest pattern: the middleware initiates a
transaction; the handler runs inside it; the middleware commits.

A failure inside the handler rolls everything back — including the
idempotency record. So a failed first attempt allows a retry with the
same key.

---

## 6. Client conventions

### 6.1 UUID per request

Clients generate a fresh UUID v4 per logical request. The same UUID is
sent on every retry of that same logical request.

```typescript
// apps/web/src/lib/api-client.ts
const idempotencyKey = crypto.randomUUID()
async function call() {
  return fetch('/api/pool/create', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, treasury }),
  })
}
```

### 6.2 Generation timing

The key is generated BEFORE the first attempt and reused for retries.
This is the entire point — generating a new key per attempt defeats
the idempotency.

### 6.3 Retry policy

```typescript
async function callWithRetry() {
  const key = crypto.randomUUID()
  for (let i = 0; i < 3; i++) {
    try {
      return await call(key)
    } catch (err) {
      if (i === 2) throw err
      await sleep(2 ** i * 1000)
    }
  }
}
```

---

## 7. Audit

Idempotency replays are auditable:
- Successful first calls write a regular audit row (via `auditAppend`).
- Replays write an additional audit row with `errorReason:
  'idempotency-replay'` so a reviewer can distinguish "the action
  happened twice on the client" from "the action happened twice on
  the server."

---

## 8. Endpoint inventory

Mandatory (Tier 1 mutating; 400 if no key):

- `POST /api/pool/create`
- `POST /api/pool/:id/pledge`
- `POST /api/honor/settle`
- `POST /api/honor/mark-paid`
- `POST /api/proposal/submit`
- `POST /api/proposal/:id/award`
- `POST /api/vote`
- `POST /api/delegation/grant`
- `POST /api/session/init`
- `POST /api/onchain-redeem`
- `POST /api/orgs/create`
- `POST /api/family/create`

Optional initially (Tier 2 / Tier 3):

- Read-side write-through caches (no harm if duplicated).
- Idempotent-by-nature ops (e.g. `PUT /api/profile` — replays are
  semantically identical to the first call).

The list of mandatory endpoints is enforced by a CI guard:

```typescript
// scripts/check-idempotency-coverage.ts
const mandatoryEndpoints = [
  'POST /api/pool/create',
  // ...
]
// AST-walks route files; refuses to merge a PR that adds a mandatory
// endpoint without the idempotency middleware.
```

---

## 9. Files to create/change

### New

- `packages/sdk/src/resilience/idempotency.ts` — middleware + types.
- `packages/sdk/src/resilience/canonicalize-body.ts` — request-body
  canonicalization (sorted keys; consistent number/string handling).
- Per-service migration: `apps/<service>/drizzle/NNNN_idempotency_keys.sql`.
- `infra/cron/idempotency-cleanup.ts` — daily delete-expired-rows job.
- `scripts/check-idempotency-coverage.ts` — CI guard.
- `docs/runbooks/idempotency-conflict.md` — runbook for 422 spikes
  (indicates a client bug; needs investigation).

### Changed

- Every mutating endpoint — mounts the middleware.
- `packages/sdk/src/client/` — client-side wrappers add the
  `Idempotency-Key` header automatically.
- `apps/web/src/lib/api-client.ts` — generates UUIDs per logical
  request.

### CI guards

- `scripts/check-idempotency-coverage.ts` — enforces middleware on
  mandatory endpoints. Wired into `pnpm check:all`.
- `no-bare-fetch-of-mutating-route.test.ts` — refuses any `fetch()`
  call to a mutating route without an `Idempotency-Key` header.

---

## 10. Acceptance criteria

- [ ] Middleware exported from `@smart-agent/sdk`.
- [ ] `idempotency_keys` table exists per service (per-service
      Postgres database per F.2).
- [ ] Every endpoint in §8 (mandatory) uses the middleware.
- [ ] Client-side UUID generation in `apps/web` + every other client.
- [ ] CI guard `scripts/check-idempotency-coverage.ts` green.
- [ ] CI guard `no-bare-fetch-of-mutating-route.test.ts` green.
- [ ] Test: duplicate POST returns the same response with replay header.
- [ ] Test: duplicate POST with different body returns 422.
- [ ] Test: replay during in-flight returns either the result or 409
      after the 5 s wait cap.
- [ ] Test: failover (kill primary mid-request, retry from client) —
      idempotency record + state change are consistent post-failover.

---

## 11. Test plan

### 11.1 Unit

- `test/resilience/idempotency.test.ts` — middleware-level:
  - First call → INSERT + handler runs + replay header false.
  - Duplicate → no handler run; replay true; same body.
  - Conflict (same key, different body) → 422.
  - In-flight retry → block + return.
  - In-flight retry beyond timeout → 409.
  - Expired record → handler runs again (TTL elapsed).

### 11.2 Integration

- `test/integration/idempotent-pledge.test.ts`:
  - Pledge $10 with key K; assert 1 pledge in DB.
  - Pledge $10 with key K again; assert still 1 pledge.
  - Pledge $20 with key K (different amount); assert 422.

### 11.3 Chaos drill

- Quarterly: while a pledge is mid-flight (introduce artificial
  latency on the server side), kill the Postgres primary. Verify
  the retry-by-client lands cleanly post-failover with the same
  outcome.

---

## 12. Cost

- Postgres storage: ~1 GB per service after a year of operation.
  Negligible.
- Cleanup job: trivial Lambda.
- Engineering: 1 dev-week including CI guards.

Total: <$5/mo marginal infra.

---

## 13. Rollback

The middleware can be disabled per-endpoint via an env var. Doing so
returns to pre-DR7 behavior (no idempotency, possible double-writes
on retry). Not advisable.

If the middleware itself has a bug (rare; well-trodden pattern):
revert the relevant routes to no-middleware; investigate; redeploy.

---

## 14. Open questions

- **OQ-DR7-1**: Should `idempotency_keys` table be shared across
  services (one global table) or per-service (Spec 007 F.2 isolation)?
  Proposed: per-service — matches the F.2 isolation invariant. An
  idempotency-key namespace clash between services is fine because
  the key is scoped by (service, endpoint).
- **OQ-DR7-2**: What's the right TTL? 24 h is generous; some shops
  use 7 days. Proposed: 24 h initial; observe replay rate; tune. A
  retry beyond 24 h is rare and the user can recover from a duplicate
  via UX (e.g. "delete duplicate pledge" flow).
- **OQ-DR7-3**: How do we handle endpoints that signal "go go go"
  but want client-side dedup separately (e.g. polling)? Proposed: GET
  endpoints don't need idempotency. POST endpoints that are idempotent
  by nature (e.g. PUT-equivalent semantics) get optional middleware.
- **OQ-DR7-4**: Idempotency-key collisions across users? Cryptographic
  UUID v4 collision probability is negligible. The PRIMARY KEY enforces
  uniqueness; a collision would 422 the second user (rare and
  recoverable).
- **OQ-DR7-5**: Per-user rate limits on idempotency-key generation?
  Not in scope; rate limits are at the auth/edge layer. A user
  generating millions of UUIDs would still be rate-limited at the
  edge.
