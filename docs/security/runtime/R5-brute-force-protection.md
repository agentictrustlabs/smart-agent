# R5 — Brute-Force Protection

> **Effort**: M (5 days dev + 2 days testing)
> **Owner**: developer + reviewer (for the auth-policy review)
> **Status**: ready to assign
> **Dependencies**: Spec 007 Phase F.2 (Postgres). The per-account
> counter MUST be durable across restarts and shared across instances;
> in-memory won't do.

## 1. Threat model

The auth surface accepts untrusted input and gates access to wallet
authority. Brute force takes three forms:

1. **Credential stuffing** — known username/password (or in our case,
   passkey-fingerprint / WebAuthn allowlist guesses) sprayed across our
   site from a leaked breach.
2. **Per-account brute force** — focused attack on one account: try
   many auth attempts on `user:cat-001` until something works.
3. **Enumeration** — abuse error-message differences ("user not found"
   vs "invalid password") to enumerate the user table.

### 1.1 Surfaces

| Endpoint | What is "wrong attempt"? | Today's protection |
|----------|--------------------------|--------------------|
| `POST /api/auth/passkey-challenge` | always issues a challenge — no validation. Rate-limit only. | 10/min/IP middleware |
| `POST /api/auth/passkey-verify` | WebAuthn assertion verification fails. | 10/min/IP middleware |
| `POST /api/auth/siwe-challenge` | issues nonce — no validation. | 10/min/IP middleware |
| `POST /api/auth/siwe-verify` | EIP-191 signature verification fails. | 10/min/IP middleware |
| `POST /api/demo-login` | invalid demo-user key. | 10/min/IP middleware + dev-only env guard |
| `POST /api/a2a/bootstrap/complete` | a2a bootstrap signature verification fails. | 10/min/IP middleware |
| `POST /auth/challenge` (a2a-agent) | challenge issuance — no validation. | 10/min/IP middleware |
| `POST /auth/verify` (a2a-agent) | signature verification fails. | 10/min/IP middleware |
| `POST /session/init` (a2a-agent) | session-package validation fails. | 10/min/IP middleware (separate limiter) |
| `POST /api/passkey/enroll` | enrollment-package validation fails. | (audit needed) |

### 1.2 What's missing today

- **No per-account counter**. 1000 IPs × 5 attempts/min = 5000 attempts/
  min on one account. Per-IP limiter is useless.
- **No account lockout**. Even after N failures, no automated
  hold-down.
- **No notification** to user on failures.
- **No exponential backoff** — every attempt costs the same time.
- **No CAPTCHA** (covered by R6, complementary).

### 1.3 Concrete attack scenarios

1. **Passkey credential-id leak + reverse**. Each user's
   `credentialId` is publicly readable via `AgentAccountResolver.
   getAuthMethods(account)` (per `packages/sdk/src/account.ts`). With a
   `credentialId` an attacker tries `passkey-verify` with random
   signatures: each one is a billion-to-one shot, but at 5000/min
   with no per-account ceiling, EVERY user is being tested
   continuously. The per-account counter forces the attacker to
   distribute across many user-counter buckets, multiplying their
   resource cost.
2. **SIWE replay on hijacked nonce**. If the SIWE nonce store is
   in-memory and survives a request, the user-bound nonce could be
   replayed within a window. Spec 007 P0-2 closes the replay path via
   `(scope, nonce)` UNIQUE; R5 ensures the failed-replay attempts are
   rate-limited per account.
3. **Enumeration** — `passkey-challenge` for `did:demo:nonexistent`
   returns 404 today (verify); `passkey-challenge` for a real user
   returns 200 with a challenge. Attacker enumerates the user table
   in O(n) requests. R5 closes this by making both responses look
   identical until the verify step.

## 2. Design

### 2.1 Per-account counter

New table (`apps/web/src/db/schema.ts` — landing in Postgres per Spec
007 Phase F.2):

```sql
CREATE TABLE auth_attempts (
  id              BIGSERIAL PRIMARY KEY,
  account_key     TEXT NOT NULL,            -- normalized identifier (see § 2.2)
  endpoint        TEXT NOT NULL,            -- '/api/auth/passkey-verify' etc
  client_ip       TEXT,                     -- nullable; logged for forensics
  result          TEXT NOT NULL,            -- 'success' | 'invalid_credential' | 'replay' | 'lockout' | 'rate_limited'
  user_agent      TEXT,
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX auth_attempts_account_time ON auth_attempts (account_key, attempted_at DESC);
CREATE INDEX auth_attempts_ip_time ON auth_attempts (client_ip, attempted_at DESC);

CREATE TABLE account_lockouts (
  account_key     TEXT PRIMARY KEY,
  locked_at       TIMESTAMPTZ NOT NULL,
  unlock_at       TIMESTAMPTZ NOT NULL,
  failed_count    INT NOT NULL,
  unlock_token    TEXT                       -- nullable; user-initiated unlock
);
```

### 2.2 Account-key normalization

`packages/sdk/src/auth/account-key.ts` (new):

```ts
export function accountKeyFromDid(did: string): string { return `did:${did.toLowerCase()}` }
export function accountKeyFromAddress(a: `0x${string}`): string { return `addr:${a.toLowerCase()}` }
export function accountKeyFromHandle(h: string): string { return `handle:${h.toLowerCase()}` }
```

Every auth endpoint maps the credential it receives onto one of these
canonical keys before the counter check. SIWE → address; passkey →
DID (resolved via credentialId → DID lookup); demo-login → DID.

### 2.3 Policy

Constants in `apps/web/src/lib/auth/brute-force-policy.ts`:

```ts
export const BRUTE_FORCE_POLICY = {
  // Trigger lockout when this many failures land in this window.
  FAILED_THRESHOLD: 5,
  WINDOW_MS: 15 * 60 * 1000,        // 15 minutes
  // Initial lockout duration. Doubles on subsequent triggers until ceiling.
  LOCKOUT_INITIAL_MS: 15 * 60 * 1000,
  LOCKOUT_MAX_MS: 4 * 60 * 60 * 1000, // 4 hours
  // Hard-cap: even with manual unlock, this many failures over 24h triggers
  // a long lockout requiring out-of-band recovery.
  HARD_CAP_24H: 25,
  HARD_LOCKOUT_MS: 24 * 60 * 60 * 1000,
}
```

Per-account exponential backoff (server-side delay before responding,
*independent* of lockout):

```
attempt 1: 0 ms
attempt 2: 250 ms
attempt 3: 500 ms
attempt 4: 1000 ms
attempt 5: 2000 ms (lockout triggers immediately after this if attempt fails)
```

The delay is added with `await sleep(...)` on the failure path only.
Successful auth returns immediately (preserves UX for legitimate users
on rare misclicks).

### 2.4 Check + record helper

`apps/web/src/lib/auth/brute-force.ts`:

```ts
export interface BruteForceCheckResult {
  ok: boolean
  retryAfterMs?: number    // populated when ok=false; the unlock_at-now delta
  reason?: 'locked' | 'rate_limited' | 'hard_capped'
}

/** Check before attempting auth. Returns ok=false if locked. */
export async function checkAccountLocked(accountKey: string): Promise<BruteForceCheckResult>

/** Record a failed attempt. Returns the resulting state (may now be locked). */
export async function recordFailedAttempt(
  accountKey: string,
  endpoint: string,
  clientIp: string | undefined,
  userAgent: string | undefined,
): Promise<BruteForceCheckResult>

/** Record a successful attempt. Resets per-account failure counter. */
export async function recordSuccessfulAttempt(
  accountKey: string,
  endpoint: string,
  clientIp: string | undefined,
): Promise<void>
```

Implementation notes:

- `checkAccountLocked` is a single indexed-row SELECT.
- `recordFailedAttempt` is a single INSERT + a windowed COUNT; if
  count exceeds `FAILED_THRESHOLD`, atomic `INSERT INTO account_lockouts
  ... ON CONFLICT (account_key) DO UPDATE SET ...`.
- All three operate inside a `BEGIN; ... COMMIT` so the counter and
  lockout are consistent.

### 2.5 Endpoint integration pattern

```ts
// example: apps/web/src/app/api/auth/passkey-verify/route.ts
export async function POST(request: Request) {
  // ... parse body, resolve credentialId → did ...
  const accountKey = accountKeyFromDid(did)

  // STEP 1 — gate.
  const gate = await checkAccountLocked(accountKey)
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'account temporarily locked', retryAfter: gate.retryAfterMs },
      { status: 423, headers: { 'Retry-After': String(Math.ceil(gate.retryAfterMs! / 1000)) } },
    )
  }

  // STEP 2 — verify signature.
  const verified = await verifyPasskeyAssertion(...)

  // STEP 3 — apply policy.
  if (!verified) {
    await sleep(backoffDelayMs(await countRecentFailures(accountKey)))
    const state = await recordFailedAttempt(accountKey, '/api/auth/passkey-verify', clientIp, ua)
    // SAME error shape regardless of why we failed (anti-enumeration).
    return NextResponse.json({ error: 'invalid credential' }, { status: 401 })
  }

  // STEP 4 — success.
  await recordSuccessfulAttempt(accountKey, '/api/auth/passkey-verify', clientIp)
  // ... mint session ...
}
```

### 2.6 Enumeration mitigation

For `passkey-challenge` and `siwe-challenge` (the "ask us for a
challenge" surfaces), the legitimate fast-path is to return 200 with a
challenge. For unknown users, today we 404; we change this to:

- 200 with a syntactically valid but cryptographically random "challenge"
  that no real account can satisfy. The verify step rejects it normally.
- This is the same defense Google / GitHub use against email
  enumeration — "always return success on `forgot password`."

Tradeoff: we generate a few extra random bytes for nonexistent users.
The 200/404 timing difference is the leak; emit identical responses
identical timing (use `crypto.randomBytes(32)` either way; record
nothing).

### 2.7 User notifications

When `account_lockouts` row inserted:

1. Best-effort attempt to notify the account's known endpoints:
   - Push notification via the agent's `/notifications/push` MCP tool
     (already exists per `apps/person-mcp/src/tools/notifications.ts`).
   - Email if `email` is on file (post Spec 007).
2. Notification content:
   "We blocked 5 failed sign-in attempts on your Smart Agent account
   from <approximate-location>. If this wasn't you, your account is
   safe — the attempts failed. To unlock now, visit /recover."
3. Notification is itself rate-limited (1 per account per hour) to
   avoid being weaponized for spam.

### 2.8 Operator dashboard

`docs/operations/brute-force-runbook.md` (new). Lists:

- How to query `auth_attempts` for forensics.
- How to manually unlock an account (delete from `account_lockouts`
  with audit-log entry).
- Grafana panels: failures-per-minute, top-10 locked accounts,
  geo-distribution of failure IPs.

## 3. Files to create / change

```
packages/sdk/src/auth/
└── account-key.ts                        NEW — normalization

apps/web/src/lib/auth/
├── brute-force-policy.ts                 NEW — constants
├── brute-force.ts                        NEW — check/record helpers
└── __tests__/
    └── brute-force.test.ts               NEW — table-driven

apps/web/src/db/schema.ts                 EDIT — auth_attempts + account_lockouts
apps/web/src/db/migrations/000X_brute_force.sql  NEW — Drizzle migration

apps/web/src/app/api/auth/passkey-verify/route.ts   EDIT — integrate gate + record
apps/web/src/app/api/auth/passkey-challenge/route.ts  EDIT — anti-enum
apps/web/src/app/api/auth/siwe-verify/route.ts        EDIT — integrate gate + record
apps/web/src/app/api/auth/siwe-challenge/route.ts     EDIT — anti-enum
apps/web/src/app/api/demo-login/route.ts              EDIT — integrate gate (dev-only path)
apps/web/src/app/api/a2a/bootstrap/complete/route.ts  EDIT — integrate gate

apps/a2a-agent/src/routes/auth.ts          EDIT — same pattern for /auth/challenge + /auth/verify
apps/a2a-agent/src/routes/session.ts       EDIT — apply to /session/init

apps/web/src/app/api/security/account-lockout-notify/route.ts  NEW — notification trigger

docs/operations/brute-force-runbook.md     NEW
```

## 4. Implementation steps

| Day | Task |
|-----|------|
| 1 | Schema + migration. account-key.ts. brute-force-policy.ts. |
| 2 | brute-force.ts with full transactional semantics. Unit tests. |
| 3 | Wire into web auth endpoints. |
| 4 | Wire into a2a-agent endpoints. Anti-enumeration timing fixes. |
| 5 | Notification path. Operator runbook. |
| 6 | Penetration tests (§ 5.3). |
| 7 | Review + merge. |

## 5. Test plan

### 5.1 Unit (`brute-force.test.ts`)

- 4 failures don't trigger lockout; 5th does.
- Lockout `unlock_at` is `WINDOW_MS` after `locked_at`.
- Backoff delay matches policy at each attempt number.
- `recordSuccessfulAttempt` resets the failure window for that account
  key.
- `checkAccountLocked` returns ok=true if `unlock_at < now()`.
- Hard-cap 24h is independent of standard lockout; 25 failures over
  24h triggers `HARD_LOCKOUT_MS` even if intervening successes occurred.

### 5.2 Integration (Playwright + Postgres)

```ts
test('5 failed passkey-verify attempts lock the account', async ({ request }) => {
  const did = 'did:demo:cat-001'
  for (let i = 0; i < 5; i++) {
    const r = await request.post('/api/auth/passkey-verify', {
      data: { /* invalid assertion bound to did */ },
    })
    expect(r.status()).toBe(401)
  }
  // 6th — locked
  const r = await request.post('/api/auth/passkey-verify', { data: { /* valid */ } })
  expect(r.status()).toBe(423)
  const body = await r.json()
  expect(body.error).toMatch(/locked/)
})

test('valid auth after window resets counter', async ({ request }) => {
  // Make 4 failures
  // Wait for WINDOW_MS to elapse (or fast-forward via DB manipulation in test)
  // Make 1 valid → should succeed
  // Make 4 failures again → should not lock (counter was reset)
})

test('per-account counter is independent across accounts', async ({ request }) => {
  // 4 failures on cat-001
  // 4 failures on cat-002
  // 1 more failure on cat-001 → cat-001 locked
  // 1 more failure on cat-002 → cat-002 locked (independent counter)
})
```

### 5.3 Penetration test

Run locally with `wrk` or `hey`:

```bash
hey -n 1000 -c 50 -m POST -T application/json \
    -d '{"credentialId":"REAL_USER_CRED_ID","response":"random"}' \
    http://localhost:3000/api/auth/passkey-verify
```

Acceptance:
- After ~5 attempts, return 423 for the rest.
- `auth_attempts` table has 1000 rows; first 5 are `invalid_credential`,
  remainder are `locked`.
- `account_lockouts` has 1 row for the target DID.
- Backoff time on attempt 5 ≥ 2000 ms (per policy).

### 5.4 Anti-enumeration test

- Time 1000 requests to `passkey-challenge` for known user.
- Time 1000 requests to `passkey-challenge` for unknown DID.
- Median latency difference < 5 ms (no timing leak).

## 6. Acceptance criteria

- [ ] Schema migration applied (idempotent against fresh-start).
- [ ] Every auth endpoint in § 1.1 integrates `checkAccountLocked` +
      `recordFailedAttempt` / `recordSuccessfulAttempt`.
- [ ] All unit + integration tests pass.
- [ ] Penetration test in § 5.3 returns the expected lockout behavior.
- [ ] Anti-enumeration test passes (median latency parity).
- [ ] Notification fires on lockout in dev (verified via test-user
      receipt of the push).
- [ ] Operator runbook + Grafana panels exist.
- [ ] Lockout is reset by `fresh-start.sh` (add to `WIPE_PATHS` /
      seed teardown).

## 7. Vendor references

- OWASP Authentication Cheat Sheet (account lockout): https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout
- NIST 800-63B (digital identity guidelines, throttling): https://pages.nist.gov/800-63-3/sp800-63b.html
- WebAuthn spec (allowCredentials enumeration): https://www.w3.org/TR/webauthn-2/#sctn-credentialrequestoptions

## 8. Open questions

- **OQ-R5-1**: Should lockout be per-{account, ip} or just per-account?
  Per-account is easier to reason about and the standard. Trade-off:
  one attacker can DoS-lock any account they know exists. Mitigation:
  `unlock_token` so legitimate user can self-unlock via passkey-bound
  challenge. Proposal: per-account v1; per-{account, ip} considered
  only if we see DoS-lockout abuse.
- **OQ-R5-2**: Unlock token delivery — push, email, both? Push works
  for the demo today; email is post Spec 007. Proposal: push-first;
  email fallback when available.
- **OQ-R5-3**: Demo-login lockout policy — same as production? Demo
  is dev-only, so the lockout's only purpose is testing the policy.
  Proposal: same policy, with `fresh-start.sh` clearing it.
- **OQ-R5-4**: Does the per-account counter also gate `siwe-challenge`?
  The challenge endpoint doesn't validate anything; only `siwe-verify`
  does. But enumeration is via challenge. Proposal: anti-enum on
  challenge (always 200); counter on verify only.

## 9. Effort summary

| Stream | Days |
|--------|------|
| Schema + helpers + tests | 2 |
| Endpoint integration | 1.5 |
| Notifications | 0.5 |
| Anti-enumeration timing fix | 0.5 |
| Pen test + ops runbook | 1 |
| Code review | 1.5 |
| **Total** | **7 days (M)** |
