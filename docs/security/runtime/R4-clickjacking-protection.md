# R4 — Clickjacking Protection

> **Effort**: S (2 days dev + 1 day verification)
> **Owner**: developer (lands together with R3)
> **Status**: ready to assign
> **Dependencies**: R3 (CSP) for the `frame-ancestors` directive; R4 is a
> focused sibling doc covering the WalletAction-specific test scenarios
> R3 doesn't dwell on.

## 1. Threat model

Clickjacking (a.k.a. UI redress) is the class of attack where the
victim's interaction with one page is silently redirected to another.
A hostile site embeds our pages in an iframe, overlays an invisible or
visually-deceptive button, and the user "clicks" something on our
page without realizing it.

### 1.1 Why it matters for Smart Agent specifically

We sign on-chain transactions. The user's most consequential UI gesture
is the **WalletAction approval** (signing a userOp; ERC-1271 challenge;
passkey assertion). If an attacker can frame our origin and trick the
user into approving a transaction:

1. **Pledge redirect**. Hostile page frames `/treasury/pledge?to=evilOrg
   &amount=1000000`, overlays a "claim free NFT" button atop the
   confirm button. User clicks; pledges $1M to attacker's org.
2. **Delegation grant hijack**. Hostile page frames a session-bootstrap
   approval. User signs an authorizing delegation; attacker captures
   the on-chain session.
3. **Org-ownership transfer**. Hostile page frames `/catalyst/steward/
   members/transfer?to=attacker`. User clicks; org ownership leaves.

All three are existential. Even with R3 in place, the specific test
coverage for "the WalletAction flow cannot be framed" is worth a
dedicated doc because the test cases are flow-specific.

### 1.2 What blocks framing today

`apps/web/next.config.ts` — no headers. **Nothing blocks framing today.**
A passable proof-of-concept can be built in 10 minutes:

```html
<iframe src="http://localhost:3000/treasury/pledge?to=0x...&amount=1000000"
        style="opacity:0.01; width:100vw; height:100vh"></iframe>
```

## 2. Defenses (layered)

### 2.1 Header layer

1. **`X-Frame-Options: DENY`** — legacy header. Most browsers honor.
   Set in middleware response.
2. **`Content-Security-Policy: frame-ancestors 'none'`** — modern
   header, supersedes `X-Frame-Options` on browsers that honor both.
   Set in middleware response.

Both are added by R3's header bundle. R4 is the **test layer** that
verifies they work end-to-end on every consequential page.

### 2.2 JavaScript fallback (defense in depth)

For older browsers and edge-case overrides, add a top-level frame-
busting script in `apps/web/src/app/layout.tsx`:

```tsx
<Script id="frame-bust" nonce={nonce} strategy="beforeInteractive">
{`
  if (window.self !== window.top) {
    try { window.top.location = window.self.location } catch {}
    document.documentElement.style.display = 'none'
  }
`}
</Script>
```

Notes:

- The `if (self !== top)` check fails in some sandboxed-iframe scenarios
  (where setting `window.top` is blocked). The fallback `display:none`
  ensures the page is at least visually empty.
- Modern browsers no longer permit cross-origin `top.location` writes
  via the same-origin policy; the `try/catch` is required.

### 2.3 Sensitive-action confirmation step (mitigation, not prevention)

Every WalletAction goes through a confirmation modal that requires:

1. A passkey assertion (`navigator.credentials.get`) — modal-bound user
   gesture, browser shows the native UI. **Native UI cannot be framed.**
2. Explicit text confirmation for high-value actions ("type CONFIRM to
   send 1000 USDC").

This is the substantive defense and is already part of the WalletAction
flow per `apps/web/src/app/api/wallet-action/dispatch/`. R4 verifies the
flow is preserved; it doesn't add it.

## 3. Inventory: pages that MUST refuse framing

Audit (`git grep` confirms paths from `apps/web/src/app/`):

| Path | Why critical |
|------|--------------|
| `/treasury/*` | money movement, pledge, settle |
| `/catalyst/steward/*` | org ownership, role assignment, governance |
| `/catalyst/governance/*` | proposal vote, grant award |
| `/passkey-enroll` | adds a credential to user's account |
| `/sign-in`, `/sign-up`, `/recover` | auth flows |
| `/api/wallet-action/dispatch` | server route — also forbid framing of its (rare) HTML error pages |
| `/onboarding/*` | initial agent provisioning |
| `/admin/*` (if any added later) | clear |

**Every** page on the app should refuse framing — even informational
ones, because framing them is a stepping-stone to clickjacking the
critical pages above. Hence the middleware applies the headers
universally and R4's job is to verify the universal coverage.

## 4. Files to create / change

```
apps/web/src/middleware.ts                EDIT — covered by R3 header bundle (DENY + frame-ancestors)
apps/web/src/app/layout.tsx               EDIT — add frame-bust script (§ 2.2)
apps/web/test/e2e/clickjacking.spec.ts   NEW  — Playwright tests below
docs/security/runtime/clickjacking-checklist.md NEW — manual review checklist
```

## 5. Implementation steps

| Day | Task |
|-----|------|
| 1 | Land R3's header bundle (this doc piggybacks). Add frame-bust script. |
| 2 | Write Playwright tests for the 8 critical paths. Run against staging. |
| 3 | Manual exploration: try to frame every page in `/catalyst/*` from a separate origin; document. |

## 6. Test plan

### 6.1 Playwright (`clickjacking.spec.ts`)

```ts
import { test, expect } from '@playwright/test'

const CRITICAL_PATHS = [
  '/treasury',
  '/treasury/pledge',
  '/catalyst/steward',
  '/catalyst/steward/members',
  '/catalyst/governance',
  '/catalyst/governance/proposals',
  '/passkey-enroll',
  '/sign-in',
  '/sign-up',
  '/recover',
  '/onboarding',
]

for (const path of CRITICAL_PATHS) {
  test(`${path} cannot be framed`, async ({ page, request }) => {
    const res = await request.get(path)
    const xfo = res.headers()['x-frame-options']
    const csp = res.headers()['content-security-policy'] ?? ''

    expect(xfo?.toUpperCase()).toBe('DENY')
    expect(csp).toMatch(/frame-ancestors 'none'/)
  })
}

test('framing-attempt page surfaces the frame bust', async ({ page }) => {
  // Test fixture: an HTML page hosted from a different origin (port)
  // that tries to iframe our app.
  const attackerOrigin = `http://localhost:${process.env.ATTACKER_PORT ?? 4444}`
  await page.goto(`${attackerOrigin}/frame-attack.html`)
  // The frame either fails to load (DENY) or our JS-bust hides it.
  const frameVisible = await page.evaluate(() => {
    const f = document.querySelector('iframe') as HTMLIFrameElement | null
    if (!f) return false
    try {
      // Same-origin policy will throw cross-origin; if we can read
      // contentDocument the frame loaded, which means DENY didn't work.
      return f.contentDocument?.body?.style.display !== 'none'
    } catch { return false }
  })
  expect(frameVisible).toBe(false)
})
```

The attacker fixture lives at `apps/web/test/fixtures/frame-attack.html`
and a tiny static server (`apps/web/test/fixtures/attacker-server.ts`)
starts on `ATTACKER_PORT` during the Playwright session.

### 6.2 Manual exploration checklist

`docs/security/runtime/clickjacking-checklist.md`:

- [ ] Open Chrome devtools → Network → check `Content-Security-Policy`
      header on each path in §3.
- [ ] Try `<iframe src="http://localhost:3000/treasury/pledge">` from
      a fiddle (jsfiddle.net counts). Confirm blocked.
- [ ] Try `<iframe sandbox="allow-scripts" src=...>` — should still
      be blocked by frame-ancestors.
- [ ] Verify the frame-bust JS runs before any interactive content
      (page is hidden during the milliseconds before bust runs).
- [ ] Confirm passkey-enroll cannot be triggered inside an iframe at
      all — browsers refuse WebAuthn calls inside cross-origin frames
      by default. (This is a strong native defense; document it.)

### 6.3 SecurityHeaders.com scan

Run https://securityheaders.com/ against the staging URL. Acceptance:
grade A or better, with no findings on X-Frame-Options or
frame-ancestors.

## 7. Acceptance criteria

- [ ] Every Playwright case in § 6.1 passes against staging and prod.
- [ ] Manual checklist § 6.2 walked once by reviewer.
- [ ] SecurityHeaders.com scan returns ≥ A grade.
- [ ] Frame-bust script is wired in `app/layout.tsx` with the R3 nonce.
- [ ] No regressions in the OAuth flow (`apps/web/src/app/api/auth/
      google/*`) — OAuth callback pages must NOT have frame-busters
      breaking the popup-window flow.

## 8. Vendor references

- MDN X-Frame-Options: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options
- MDN frame-ancestors: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors
- OWASP Clickjacking Defense Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html
- SecurityHeaders.com: https://securityheaders.com/

## 9. Open questions

- **OQ-R4-1**: Do we have any legitimate need to be framed (analytics
  iframe, embedded widget)? Survey says no today. If yes future,
  switch to `frame-ancestors 'self' https://partner.example.com`.
- **OQ-R4-2**: The OAuth popup flow technically opens our origin in a
  new window, not a frame; frame-busters shouldn't affect it. Add a
  smoke test that confirms Google sign-in still completes.

## 10. Effort summary

| Stream | Days |
|--------|------|
| Frame-bust script + integration | 0.5 |
| Playwright suite + attacker fixture | 1 |
| Manual checklist walk + SecurityHeaders scan | 0.5 |
| Code review | 0.5 |
| **Total** | **2.5 days (S)** |
