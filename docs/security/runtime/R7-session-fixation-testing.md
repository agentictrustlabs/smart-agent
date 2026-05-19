# R7 — Session Fixation Testing

> **Effort**: S (3 days dev + 1 day pentest)
> **Owner**: developer (write tests) + reviewer (verify)
> **Status**: ready to assign
> **Dependencies**: none

## 1. Threat model

Session fixation is the attack where an attacker plants a session
identifier on the victim's browser **before** the victim logs in.
Because the same identifier is preserved across the login boundary, the
attacker holds a valid session token that's now bound to the victim's
authenticated identity.

### 1.1 The fix is universal and simple

> On every successful authentication, **rotate the session identifier**.
> The pre-login value is discarded; the post-login value is freshly
> generated.

R7 is mostly about **verifying** this property across every session-
issuing path. Smart Agent has multiple session surfaces; each must
rotate.

### 1.2 Session surfaces

| Cookie / token | Issued by | Issued at | Cleared at |
|----------------|-----------|-----------|------------|
| `smart-agent-session` (JWT) | `apps/web/src/lib/auth/native-session.ts` (`mintSession`) | `/api/demo-login`, `/api/auth/passkey-verify`, `/api/auth/siwe-verify`, `/api/auth/google/callback` | logout |
| `demo-user` (signed) | `apps/web/src/app/api/demo-login/route.ts:245` | demo-login | logout |
| `a2a-session` (opaque session id) | `apps/web/src/lib/actions/a2a-session.action.ts` (`bootstrapA2ASessionForUser`) | first authenticated action; demo-login bootstrap | logout / restart |
| `__Host-smart-agent-grant` (prod) / `smart-agent-grant` (dev) | `apps/web/src/lib/auth/session-cookie.ts` (`setGrantCookie`) | SessionGrant.v1 issuance | revoke / TTL |

Each of these must:

1. Be **regenerated** on every login (no pre-existing value carries
   over).
2. Have its old value **invalidated** on the server when overwritten
   (so an attacker who captured the pre-login cookie can't keep using
   it).
3. Be invalidated on logout (already covered by clear-cookie + server
   delete).

### 1.3 Current state — what we know

- **`smart-agent-session` (JWT)**: stateless. Each call to `mintSession`
  generates a fresh JWT with a fresh `jti` claim (verify in
  `native-session.ts`). New JWT replaces old in the cookie. Server-
  side revocation requires the JTI to be tracked; today it's not
  (this is a separate gap, covered by Spec 007 audit chain).
- **`demo-user`**: signed cookie of the demo userId. Doesn't change
  across the demo-login boundary (the user is who they are). This is
  not a session in the classic sense; treat as identity claim.
- **`a2a-session`**: opaque session id from
  `bootstrapA2ASessionForUser`. **MUST be regenerated** every login.
  Verify by reading the bootstrap code.
- **`__Host-smart-agent-grant`**: opaque session id. Same as a2a.

### 1.4 Concrete attack scenario

1. Attacker visits `https://smartagent.io/`. Server doesn't set any
   session cookie (no auth yet) — but suppose a bug sets a `a2a-session`
   cookie eagerly with a placeholder id.
2. Attacker captures the cookie value: `a2a-session = abc123`.
3. Attacker tricks victim into visiting `https://smartagent.io/?a2a-
   session=abc123` (with the cookie carried via CSRF or a fixation-
   reflecting URL parameter).
4. Victim logs in. If the login handler **reuses** `abc123` (e.g.
   "check if session exists, else create"), the server-side
   `sessionRecord` now binds `abc123` to victim's authenticated DID.
5. Attacker presents `abc123`; server treats them as victim.

The defense at step 4 is rotation: server discards `abc123`, mints
`xyz789`, stores xyz789-bound-to-victim, sets `a2a-session = xyz789`.

## 2. Design

R7's deliverables are **tests** (not new helpers). The tests assert the
rotation property holds across every session surface.

### 2.1 Test harness

`apps/web/test/security/session-fixation.test.ts` (new). Uses the test
HTTP client and a fresh cookie jar per scenario.

### 2.2 Test cases

For each session surface in § 1.2:

```ts
test('a2a-session rotates on demo-login', async () => {
  const jar = new TestCookieJar()
  // 1. Plant a pre-existing a2a-session cookie.
  jar.set('a2a-session', 'fixed-id-' + crypto.randomUUID())
  const fixedId = jar.get('a2a-session')

  // 2. Log in.
  await jar.fetch('/api/demo-login', {
    method: 'POST',
    body: JSON.stringify({ userId: 'cat-001' }),
    headers: { 'Content-Type': 'application/json' },
  })

  // 3. Assert the cookie value changed.
  expect(jar.get('a2a-session')).toBeDefined()
  expect(jar.get('a2a-session')).not.toEqual(fixedId)

  // 4. Server-side: presenting the OLD id should be rejected.
  const r = await fetch('/api/agents/me', {
    headers: { Cookie: `a2a-session=${fixedId}` },
  })
  expect(r.status).toBe(401)
})
```

Repeat the pattern for:

| Test | Cookie | Trigger |
|------|--------|---------|
| T1 | `smart-agent-session` | demo-login |
| T2 | `smart-agent-session` | passkey-verify |
| T3 | `smart-agent-session` | siwe-verify |
| T4 | `smart-agent-session` | google-oauth callback |
| T5 | `a2a-session` | demo-login bootstrap |
| T6 | `a2a-session` | passkey + bootstrap from client |
| T7 | `__Host-smart-agent-grant` | session-package issuance |
| T8 | re-login while already logged in (different user) — old cookies don't survive |
| T9 | logout — every session cookie cleared AND server-side records deleted |
| T10 | concurrent login from two devices — each gets independent session id; revoking one doesn't kill the other |

### 2.3 Server-side invalidation test

Beyond cookie rotation, the **server** must invalidate the old session
id. This requires a second test for each rotating surface:

```ts
test('a2a-session pre-login id is invalidated server-side after login', async () => {
  // 1. Bootstrap a session as user A.
  const jarA = new TestCookieJar()
  await jarA.fetch('/api/demo-login', { method: 'POST', body: JSON.stringify({ userId: 'cat-001' })})
  const idA = jarA.get('a2a-session')

  // 2. New incognito jar, plant idA as a pre-login cookie.
  const jarB = new TestCookieJar()
  jarB.set('a2a-session', idA)

  // 3. Log in as user B.
  await jarB.fetch('/api/demo-login', { method: 'POST', body: JSON.stringify({ userId: 'cat-002' })})

  // 4. Now jarB has a fresh idB. But what happened to idA on the
  //    server? It should STILL be valid for user A (B's login didn't
  //    affect A's session) but NOT bound to user B.
  const r = await fetch('/api/agents/me', { headers: { Cookie: `a2a-session=${idA}` }})
  // Either: user A is returned (idA still bound to A — correct)
  // Or:     401 (idA invalidated — also acceptable)
  // What MUST NOT happen: user B is returned.
  if (r.status === 200) {
    const body = await r.json()
    expect(body.userId).not.toBe('cat-002')
  }
})
```

### 2.4 Code audit pass

Before tests, the developer audits each session-issuing path with this
checklist (`docs/security/runtime/session-fixation-audit.md`, new):

For each of: `mintSession`, `bootstrapA2ASessionForUser`, `setGrantCookie`:

- [ ] Verify the function **always** generates a fresh identifier
      (`crypto.randomUUID()` / `getRandomValues`) — no path that
      "preserves an existing cookie value if present."
- [ ] Verify the server-side record (SessionRecord, JWT JTI registry
      if any) is keyed by the **new** identifier.
- [ ] Verify the response `Set-Cookie` always carries the new value
      (browser overwrites the old).
- [ ] Verify there is no API or query-string parameter that lets a
      client *specify* a desired session id.

Document audit findings inline; any "no" answer becomes a code-change
item that lands as part of R7 (not deferred).

### 2.5 Penetration test

Manual run by a non-author:

1. Curl `/sign-in` with `Cookie: a2a-session=ATTACKER-FIXED-VALUE`.
2. Note the response — does the server echo our value back or assign
   its own?
3. Complete the demo-login through Playwright with that same cookie.
4. Capture the post-login cookie value.
5. Assert: post-login value != ATTACKER-FIXED-VALUE.

Document findings in `docs/security/pentest/2026-q1-session-fixation.md`.

## 3. Files to create / change

```
apps/web/test/security/
└── session-fixation.test.ts              NEW — tests T1..T10

apps/web/src/lib/auth/native-session.ts   POTENTIALLY EDIT — depends on audit
apps/web/src/lib/auth/session-cookie.ts   POTENTIALLY EDIT — depends on audit
apps/web/src/lib/actions/a2a-session.action.ts  POTENTIALLY EDIT

docs/security/runtime/session-fixation-audit.md  NEW — audit checklist
docs/security/pentest/2026-q1-session-fixation.md  NEW — pentest report
```

## 4. Implementation steps

| Day | Task |
|-----|------|
| 1 | Walk § 2.4 audit. Document each surface's rotation behavior. Any "no" → code fix item. |
| 2 | Fix any "no" items found in audit. |
| 3 | Write tests T1..T10. |
| 4 | Manual pentest. Write report. |

## 5. Test plan

The tests in § 2.2 and § 2.3 ARE the test plan. They run in CI on
every PR.

Additional coverage:

- **Property test**: with `fast-check`, generate 1000 random session
  ids; assert no collision after rotation; assert that for any pre-
  login id `p`, `p ≠ post-login id`.
- **Logout test**: after logout, every cookie cleared (value = empty,
  maxAge = 0); server-side record deleted; presenting the old id
  returns 401.

## 6. Acceptance criteria

- [ ] Audit checklist filled in for every session-issuing function.
- [ ] Any "no" answers resolved with a code change in this same PR.
- [ ] Tests T1..T10 + property test pass.
- [ ] Penetration test report at `docs/security/pentest/2026-q1-
      session-fixation.md` with sign-off.
- [ ] No code path exists that lets a client influence the session id
      (audit clean).

## 7. Vendor references

- OWASP Session Fixation: https://owasp.org/www-community/attacks/Session_fixation
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- RFC 6265 (HTTP cookies): https://datatracker.ietf.org/doc/html/rfc6265
- NIST 800-63B (session management): https://pages.nist.gov/800-63-3/sp800-63b.html#sec7

## 8. Open questions

- **OQ-R7-1**: The legacy `demo-user` cookie embeds the demo userId
  (signed). It doesn't rotate because the userId IS the identity. Is
  this a fixation concern? No — `demo-user` is a multi-step identity
  hint, not a session credential. Document this distinction in the
  audit.
- **OQ-R7-2**: JWT JTI revocation list — should R7 require a JTI
  registry so a captured-pre-login JWT can be revoked server-side?
  Per Spec 007 the audit chain provides this for high-risk paths.
  Proposal: defer to Spec 007; document the gap.
- **OQ-R7-3**: When does a user's cookies survive a re-login as a
  different demo user? Today the demo-login route overwrites
  `smart-agent-session` and `demo-user`. Verify the `a2a-session`
  bootstrap also clears any prior id from the session-store. Per
  audit.

## 9. Effort summary

| Stream | Days |
|--------|------|
| Audit + any rotation fixes | 1.5 |
| Test suite | 1 |
| Pentest + report | 0.5 |
| Code review | 0.5 |
| **Total** | **3.5 days (S)** |
