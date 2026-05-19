# R8 — Cookie Security Hardening

> **Effort**: S (4 days dev + 1 day OAuth-flow validation)
> **Owner**: developer + reviewer
> **Status**: ready to assign
> **Dependencies**: Phase F.2 (Postgres) — moving the cookie-set
> defaults into a single helper is independent of the storage backend,
> but the `__Host-` prefix interacts with secure-only mode which we
> already gate on `NODE_ENV === 'production'`.

## 1. Threat model

Cookies are the credential carrier for every session surface. The
attributes on the `Set-Cookie` header determine which attacks the
browser blocks for us:

- `HttpOnly` → JavaScript can't read the cookie (XSS exfil mitigated).
- `Secure` → cookie only sent over HTTPS (network sniffing mitigated).
- `SameSite=Strict` → cookie not sent on cross-site requests at all
  (CSRF mitigated).
- `SameSite=Lax` → cookie sent on top-level GETs (allows OAuth
  callbacks); blocked on cross-site POSTs.
- `Path=/...` → cookie only sent on matching paths.
- `Domain=example.com` → cookie sent on all subdomains (broader scope).
- `__Host-` prefix → forces `Path=/`, `Secure`, no `Domain`;
  effectively pins the cookie to one origin.
- `__Secure-` prefix → forces `Secure`.

### 1.1 Current cookies (audit)

Read directly from the codebase:

| Cookie | File | Attributes today |
|--------|------|------------------|
| `smart-agent-session` (JWT) | `apps/web/src/app/api/demo-login/route.ts:238` | `path=/, maxAge=30d, httpOnly=true, sameSite=lax, secure=prod` |
| `demo-user` (signed userId) | `apps/web/src/app/api/demo-login/route.ts:245` | `path=/, maxAge=30d, httpOnly=true, secure=prod` (no sameSite — defaults to Lax) |
| `a2a-session` | `apps/web/src/app/api/demo-login/route.ts:253` | `path=/, maxAge=24h, httpOnly=true, sameSite=lax, secure=prod` |
| `__Host-smart-agent-grant` / `smart-agent-grant` (dev) | `apps/web/src/lib/auth/session-cookie.ts:30` | `path=/, httpOnly=true, sameSite=lax, secure=prod, maxAge=<hardTtl>` |

Other auth flows (passkey-verify, siwe-verify) — verify they reuse
the same defaults; if not, that's an item.

### 1.2 What hardening looks like

Target attributes per cookie:

| Cookie | HttpOnly | Secure | SameSite | Path | Domain | Prefix | TTL |
|--------|----------|--------|----------|------|--------|--------|-----|
| `smart-agent-session` | ✔ | prod only | **Strict** (was Lax) | / | none | `__Host-` in prod | 30d |
| `demo-user` | ✔ | prod only | **Strict** | / | none | `__Host-` in prod | 30d |
| `a2a-session` | ✔ | prod only | **Strict** (was Lax) | / | none | `__Host-` in prod | 24h |
| `smart-agent-grant` | ✔ | prod only | Lax (oauth-compat) | / | none | `__Host-` in prod | hard-ttl |

### 1.3 The `Strict` vs `Lax` tradeoff

`Strict` is the safest setting but breaks one important flow: **OAuth
callbacks**. When the user is redirected from `accounts.google.com` to
`/api/auth/google/callback`, the cookie is sent only if `SameSite=Lax`
(or `None` — which requires Secure and is broader). If `Strict`, the
callback handler sees no cookie and can't complete the flow.

Our solution per cookie:

- **`smart-agent-session` (Strict)**: this cookie is *set* by the
  callback, not *required* by it. Strict is safe.
- **`a2a-session` (Strict)**: this cookie is server-set after auth,
  never required during OAuth. Strict is safe.
- **`smart-agent-grant` (Lax)**: keep Lax; this cookie may need to
  survive cross-site interactions during multi-step delegation flows.
  Re-verify during implementation.
- **`demo-user` (Strict)**: only used by dev login; demo-login is a
  POST from our own form. Strict is safe.

### 1.4 The `__Host-` prefix

`__Host-` requires:

1. `Secure` (HTTPS).
2. `Path=/`.
3. No `Domain` attribute.

Browsers refuse to set the cookie if any of these is violated. The
prefix is enforced at parse time, so even an attacker on a subdomain
(`evil.smartagent.io`) cannot overwrite `__Host-smart-agent-session`
on the parent — the browser binds the cookie to the exact origin.

We use `__Host-` only in production (HTTPS is required). In dev, drop
the prefix per existing pattern in `apps/web/src/lib/auth/
session-cookie.ts:18-23`.

## 2. Design

### 2.1 Single cookie-set helper

`apps/web/src/lib/auth/cookie-policy.ts` (new):

```ts
import type { NextResponse } from 'next/server'

export type CookieKind = 'session' | 'demo-user' | 'a2a-session' | 'grant'

interface CookiePolicy {
  /** Bare name in dev; '__Host-' + bare in prod. */
  bareName: string
  /** Hard TTL in seconds. */
  maxAge: number
  /** SameSite — Strict by default; Lax only if a flow demands it. */
  sameSite: 'Strict' | 'Lax'
  /** True if this cookie is permitted to survive an OAuth round-trip. */
  oauthCompatibility: boolean
}

const POLICY: Record<CookieKind, CookiePolicy> = {
  session:       { bareName: 'smart-agent-session', maxAge: 60 * 60 * 24 * 30, sameSite: 'Strict', oauthCompatibility: false },
  'demo-user':   { bareName: 'demo-user',           maxAge: 60 * 60 * 24 * 30, sameSite: 'Strict', oauthCompatibility: false },
  'a2a-session': { bareName: 'a2a-session',         maxAge: 60 * 60 * 24,      sameSite: 'Strict', oauthCompatibility: false },
  grant:         { bareName: 'smart-agent-grant',   maxAge: 60 * 60 * 4,       sameSite: 'Lax',    oauthCompatibility: true },
}

const PROD = () => process.env.NODE_ENV === 'production'

export function cookieName(kind: CookieKind): string {
  return PROD() ? `__Host-${POLICY[kind].bareName}` : POLICY[kind].bareName
}

export function setSessionCookie(
  response: NextResponse,
  kind: CookieKind,
  value: string,
  options: { maxAge?: number } = {},
): void {
  const p = POLICY[kind]
  response.cookies.set(cookieName(kind), value, {
    path: '/',
    httpOnly: true,
    secure: PROD(),
    sameSite: p.sameSite.toLowerCase() as 'strict' | 'lax',
    maxAge: options.maxAge ?? p.maxAge,
    // No 'domain' attribute — required by __Host-.
  })
}

export function clearSessionCookie(response: NextResponse, kind: CookieKind): void {
  response.cookies.set(cookieName(kind), '', {
    path: '/',
    httpOnly: true,
    secure: PROD(),
    sameSite: POLICY[kind].sameSite.toLowerCase() as 'strict' | 'lax',
    maxAge: 0,
  })
}

/** Read a cookie value — abstracts away the `__Host-` prefix flip. */
export function readSessionCookie(
  cookies: { get: (name: string) => { value: string } | undefined },
  kind: CookieKind,
): string | undefined {
  return cookies.get(cookieName(kind))?.value
}
```

### 2.2 Cookie inventory + migration

```
search:  rg "response.cookies.set\(" apps/web/src/
search:  rg "cookies\.set\(" apps/web/src/lib/
search:  rg "Set-Cookie" apps/web/src/
```

Every call site replaced with `setSessionCookie(response, <kind>, value, ...)`.
Every read site updated with `readSessionCookie(...)`.

### 2.3 Logout — clear ALL session cookies

`apps/web/src/app/api/auth/logout/route.ts` (verify exists; if not,
add). Logout calls `clearSessionCookie` for each `CookieKind`. Also
calls server-side revoke:

```ts
await revokeSession(sessionId)        // a2a-session-store invalidate
await revokeGrant(grantId)            // SessionGrant.v1
// JWT: nothing to do server-side until JTI registry lands (Spec 007)
```

### 2.4 OAuth compatibility audit

For each route that ends an OAuth round-trip
(`apps/web/src/app/api/auth/google/callback/route.ts`):

- [ ] The callback DOESN'T require `smart-agent-session` to exist
      before it runs (because Strict mode strips it on cross-site
      navigation). It only reads short-lived OAuth state cookies.
- [ ] The OAuth state cookie itself uses `SameSite=Lax` — it must
      survive the redirect from accounts.google.com. Add a separate
      `kind: 'oauth-state'` with policy `{ sameSite: 'Lax', oauthCompatibility: true }`.

If any callback ALSO requires a session cookie, it MUST be a Lax
cookie (we'd add a separate `session-lax` kind). Audit will tell us.

### 2.5 Cross-cookie consistency check

Add `scripts/check-cookie-policy.sh` (new) — CI guard that greps for
`response.cookies.set(` outside the policy helper and fails. Allowlist:
the helper itself, and any one-off cookie that's documented in this
doc.

### 2.6 Documentation

`docs/security/runtime/cookie-inventory.md` (new) — the table from §
1.1 kept current. Pre-merge gate: any PR adding a new cookie must
update this table AND go through this doc's helper.

## 3. Files to create / change

```
apps/web/src/lib/auth/
├── cookie-policy.ts                      NEW — POLICY map + helpers
├── __tests__/cookie-policy.test.ts       NEW — unit tests for name flip, attribute set
└── session-cookie.ts                     EDIT — delegate to cookie-policy

apps/web/src/app/api/demo-login/route.ts                  EDIT — use helpers
apps/web/src/app/api/auth/passkey-verify/route.ts         EDIT — use helpers
apps/web/src/app/api/auth/siwe-verify/route.ts            EDIT — use helpers
apps/web/src/app/api/auth/google/callback/route.ts        EDIT — verify OAuth state cookie kind
apps/web/src/app/api/auth/logout/route.ts                 EDIT or NEW — clear all session cookies
apps/web/src/lib/auth/native-session.ts                   EDIT — read via helper
apps/web/src/middleware.ts                                EDIT — read via helper
apps/web/src/lib/actions/a2a-session.action.ts            EDIT — set a2a-session via helper

scripts/check-cookie-policy.sh            NEW — CI guard
docs/security/runtime/cookie-inventory.md  NEW — living table
```

## 4. Implementation steps

| Day | Task |
|-----|------|
| 1 | Write `cookie-policy.ts` + tests. Document the policy table. |
| 2 | Replace every call site with `setSessionCookie` / `readSessionCookie` / `clearSessionCookie`. |
| 3 | Add `logout/route.ts` (or update). CI guard script. |
| 4 | OAuth compatibility audit + Playwright E2E to verify Google login still completes. |
| 5 | Code review. |

## 5. Test plan

### 5.1 Unit (`cookie-policy.test.ts`)

| Input | Expectation |
|-------|-------------|
| `cookieName('session')` in prod | `__Host-smart-agent-session` |
| `cookieName('session')` in dev | `smart-agent-session` |
| `setSessionCookie(res, 'session', 'jwt')` in prod | response has `Set-Cookie: __Host-smart-agent-session=jwt; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000` (no Domain) |
| `setSessionCookie(res, 'grant', 'id')` | SameSite=Lax (OAuth compat) |
| `clearSessionCookie(res, 'session')` | response sets cookie with `Max-Age=0; Path=/; HttpOnly` |

### 5.2 E2E (Playwright)

```ts
test('session cookies have hardened attributes in production-mode build', async ({ page, context }) => {
  if (process.env.CI_MODE !== 'prod-like') test.skip()
  await page.goto('/sign-in')
  await page.click('text=Catalyst Coordinator (Hannah)')
  const cookies = await context.cookies()
  const sessionCookie = cookies.find(c => c.name === '__Host-smart-agent-session')
  expect(sessionCookie).toBeDefined()
  expect(sessionCookie!.httpOnly).toBe(true)
  expect(sessionCookie!.secure).toBe(true)
  expect(sessionCookie!.sameSite).toBe('Strict')
  expect(sessionCookie!.path).toBe('/')
  expect(sessionCookie!.domain).toBe('smartagent.io') // exact origin
})

test('Google OAuth login completes with hardened cookies', async ({ page }) => {
  // Live test against staging w/ Google test account. Asserts the
  // SameSite=Strict on smart-agent-session doesn't break the callback
  // (because the callback SETS the cookie, doesn't require it).
})

test('logout clears every session cookie', async ({ page, context }) => {
  await page.goto('/sign-in')
  await page.click('text=Catalyst Coordinator (Hannah)')
  await page.click('text=Sign out')
  const cookies = await context.cookies()
  expect(cookies.find(c => c.name.endsWith('smart-agent-session'))).toBeUndefined()
  expect(cookies.find(c => c.name.endsWith('a2a-session'))).toBeUndefined()
  expect(cookies.find(c => c.name === 'demo-user')).toBeUndefined()
})
```

### 5.3 CI guard

`scripts/check-cookie-policy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ALLOW_FILE="apps/web/src/lib/auth/cookie-policy.ts"
DENIED=$(rg -l 'response\.cookies\.set\(|res\.cookies\.set\(|cookieStore\.set\(' \
  --type ts apps/web/src | grep -v "^${ALLOW_FILE}$" || true)
if [ -n "$DENIED" ]; then
  echo "FAIL: direct cookies.set usage outside cookie-policy.ts:"
  echo "$DENIED"
  exit 1
fi
```

Wired into `.github/workflows/security.yml` (new or existing).

### 5.4 Manual cross-browser check

Verify on Chrome, Firefox, Safari that the `__Host-` cookies are
accepted (browsers refuse to set if attributes are wrong; if they
refuse, login is broken — Playwright catches this).

## 6. Acceptance criteria

- [ ] `cookie-policy.ts` is the single source of truth for cookie
      attributes; CI guard prevents bypass.
- [ ] Every existing cookie call site migrated.
- [ ] Logout clears every session cookie + revokes server-side
      records.
- [ ] Production cookies use `__Host-` prefix; dev cookies use bare
      names.
- [ ] All cookies are `HttpOnly`; session cookies are `Secure` +
      `SameSite=Strict` (except `grant` which is Lax for OAuth).
- [ ] Playwright E2E confirms Google OAuth login still completes.
- [ ] `docs/security/runtime/cookie-inventory.md` is current.

## 7. Vendor references

- MDN Set-Cookie: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
- MDN `__Host-` prefix: https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#__host-_prefix
- MDN SameSite: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- RFC 6265bis (cookie hardening): https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/

## 8. Open questions

- **OQ-R8-1**: SameSite=Strict on `smart-agent-session` — does this
  break any current flow? Audit needed for any cross-site embeds
  (e.g. an external site linking to `/dashboard` directly). Proposal:
  flip to Strict + run full Playwright suite + check OAuth callback.
- **OQ-R8-2**: Should the `a2a-session` cookie's path be tightened
  from `/` to `/api/`? Today it's read by middleware on every page
  (memory: `feedback_a2a_agent_localhost_dns.md`). Proposal: keep
  `/` until middleware change.
- **OQ-R8-3**: 30-day TTL on `smart-agent-session` is long. NIST
  guidance for sensitive sessions is 12-24 hours. Compromise: 30d
  with idle-timeout (refresh extends to 30d from last activity).
  Proposal: defer to Spec 007 audit chain; today 30d.
- **OQ-R8-4**: Do we need a partitioned cookie experimental flag
  (`Partitioned`)? Required by Chrome's third-party cookie deprecation
  for cross-site iframe use cases. We don't have any third-party
  iframes; defer.

## 9. Effort summary

| Stream | Days |
|--------|------|
| Policy helper + tests | 1 |
| Migrate call sites | 1.5 |
| Logout + OAuth audit | 1 |
| CI guard + Playwright | 0.5 |
| Code review | 1 |
| **Total** | **5 days (S)** |
