# R6 — Bot Detection

> **Effort**: S (3 days dev + 2 days tuning)
> **Owner**: developer (frontend + middleware)
> **Status**: ready to assign
> **Dependencies**: R2 (WAF) for the edge-layer bot signals;
> R5 (per-account counter) so CAPTCHA + lockout together compound the
> attacker cost.

## 1. Threat model

Automation abuse breaks down into three flavors. Each warrants a
different response.

### 1.1 Surfaces and threats

| Endpoint | Bot abuse | Cost of abuse |
|----------|-----------|---------------|
| `POST /api/demo-login` | enumerate demo users, automated account creation | high — every demo-login provisions a wallet + treasury + holder-wallet + KB sync (per `apps/web/src/app/api/demo-login/route.ts:42-205`) |
| `POST /api/auth/passkey-challenge` | infrastructure probing | low (idempotent challenge issuance) |
| `POST /api/passkey/enroll` | mass-credential pollution | medium — adds rows to AgentAccountResolver |
| `POST /a2a/session/init` | session-DB pollution | medium — per `session-init` writes a SessionRecord |
| `GET /agents`, `/discovery/*` | scraping for data harvesting | low (data is public KB) |
| `POST /api/votes/*`, `/api/proposals/*` | vote-stuffing / proposal-spam | high — affects governance state |
| any state-mutating MCP tool | content spam, e.g. mass `intents.create` | medium — clutters discovery |

### 1.2 What WAF (R2) catches

- Crude bots without a user agent (R2 rule R-002).
- Known-bad IPs (R2 rule R-003).
- Volumetric anomalies (R2 rate rules).

### 1.3 What R6 catches that WAF doesn't

- Sophisticated headless browsers with realistic UA strings.
- Distributed bots at low per-IP rate (each bot makes 3 req/min — under
  any rate threshold).
- Bots that solve simple CAPTCHAs but trip an invisible challenge.

## 2. Design

### 2.1 Vendor selection

| Vendor | Friction | Cost | Privacy | Choice |
|--------|----------|------|---------|--------|
| **Cloudflare Turnstile** | invisible by default | free, generous limits | ✔ no third-party fingerprinting | **selected** |
| hCaptcha | image-grid on suspicion | free up to 1M; paid for accessibility | ✔ no tracking | runner-up |
| reCAPTCHA v3 | invisible score | free up to 1M | ✘ Google tracking | rejected |
| Arkose Labs | enterprise | $$$ | ✔ | overkill for v1 |

Cloudflare Turnstile wins on:

- Invisible to most users (no friction).
- Privacy-preserving (no third-party tracking pixels).
- Free tier covers our scale.
- Single-vendor consolidation with R2 Cloudflare WAF.

### 2.2 Where CAPTCHA is required

The decision matrix:

- **Always-on (invisible)**: low-friction. User never sees a challenge
  unless their score is suspicious.
- **High-cost endpoints (§ 1.1 row "cost = high")**: `demo-login`,
  `votes`, `proposals`, `pledges/create`. Token is issued by Turnstile
  on the form-render side; the POST handler verifies the token via
  Turnstile's `siteverify` endpoint.
- **Medium-cost endpoints**: optional. Turn on if we observe abuse.
- **Low-cost / idempotent**: skip.

### 2.3 Server-side verification

`apps/web/src/lib/security/captcha.ts` (new):

```ts
import { z } from 'zod'

const VerifyResponse = z.object({
  success: z.boolean(),
  challenge_ts: z.string().optional(),
  hostname: z.string().optional(),
  'error-codes': z.array(z.string()).optional(),
  action: z.string().optional(),
  cdata: z.string().optional(),
})

export interface CaptchaCheckOptions {
  /** Expected action label (CSRF binding). */
  expectedAction: string
  /** Client IP, for Turnstile's risk scoring. */
  clientIp?: string
}

export async function verifyCaptcha(
  token: string | undefined,
  options: CaptchaCheckOptions,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (process.env.NODE_ENV !== 'production' && !process.env.TURNSTILE_SECRET) {
    // Dev no-op: log but allow.
    console.log(`[captcha] dev no-op for action=${options.expectedAction}`)
    return { ok: true }
  }
  if (!token) return { ok: false, reason: 'missing token' }

  const body = new URLSearchParams()
  body.set('secret', process.env.TURNSTILE_SECRET!)
  body.set('response', token)
  if (options.clientIp) body.set('remoteip', options.clientIp)

  // Use safeFetch (R1) — Turnstile endpoint is allow-listed.
  const res = await safeFetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      allowList: { hosts: ['challenges.cloudflare.com'], schemes: ['https:'] },
    },
  )
  if (!res.ok) return { ok: false, reason: `turnstile http ${res.status}` }
  const parsed = VerifyResponse.parse(await res.json())
  if (!parsed.success) return { ok: false, reason: `turnstile failed: ${(parsed['error-codes'] ?? []).join(',')}` }
  if (parsed.action !== options.expectedAction) {
    return { ok: false, reason: `action mismatch: got ${parsed.action ?? '?'} want ${options.expectedAction}` }
  }
  return { ok: true }
}
```

Notes:

- **Dev no-op**: when `NODE_ENV !== 'production'` AND `TURNSTILE_SECRET`
  is unset, we allow. This keeps Playwright + fresh-start working
  without forcing every dev to set a secret. If a dev wants to test
  the real verification locally, set `TURNSTILE_SECRET` to a
  Cloudflare-issued test key.
- **Action binding**: every form passes `action: 'demo-login'` etc to
  Turnstile widget; server verifies it matches the endpoint. This is
  Turnstile's CSRF-binding mechanism — a token from one form can't be
  replayed on another.
- **Token freshness**: Turnstile tokens are single-use and expire in
  5 minutes by default (configured server-side). The verify endpoint
  rejects replayed tokens.

### 2.4 Frontend widget

`apps/web/src/components/security/captcha-gate.tsx` (new):

```tsx
'use client'
import { Turnstile } from '@marsidev/react-turnstile'

interface Props {
  action: string
  onToken: (token: string) => void
  className?: string
}

export function CaptchaGate({ action, onToken, className }: Props) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  if (!siteKey) {
    // Dev no-op widget — auto-emit a fake token so onSubmit handlers
    // don't block.
    useEffect(() => { onToken('dev-no-op') }, [])
    return null
  }
  return (
    <Turnstile
      siteKey={siteKey}
      options={{ action, theme: 'auto', size: 'invisible' }}
      onSuccess={onToken}
      className={className}
    />
  )
}
```

Form usage:

```tsx
const [captchaToken, setCaptchaToken] = useState<string | undefined>()

<form onSubmit={async (e) => {
  e.preventDefault()
  if (!captchaToken) return
  await fetch('/api/demo-login', { method: 'POST', body: JSON.stringify({ userId, captchaToken }) })
}}>
  <CaptchaGate action="demo-login" onToken={setCaptchaToken} />
  <button type="submit" disabled={!captchaToken}>Sign in as demo user</button>
</form>
```

### 2.5 Behavioral signals (defense in depth, no vendor)

Beyond Turnstile, add cheap in-app heuristics for medium-cost endpoints
we don't gate with full CAPTCHA:

```ts
// apps/web/src/lib/security/bot-signals.ts
export function looksAutomated(req: Request, body: unknown): boolean {
  const ua = req.headers.get('user-agent') ?? ''
  const accept = req.headers.get('accept') ?? ''

  // 1. UA contains known headless markers.
  if (/headlesschrome|phantomjs|nightmare|selenium|puppeteer/i.test(ua)) return true
  // 2. Accept is */* AND UA suggests browser (real browsers send specific accepts).
  if (accept === '*/*' && /mozilla/i.test(ua) && !/postman|curl|wget/i.test(ua)) return true
  // 3. Missing Accept-Language entirely.
  if (!req.headers.get('accept-language')) return true
  // 4. Body shape that doesn't match the expected form.
  // (caller-specific; not in shared helper)
  return false
}
```

Routes that `looksAutomated` return true on: emit a `403` with the same
error shape as a Turnstile failure (anti-enumeration: bots can't tell
whether the block is from Turnstile or in-app).

Allowlist: Playwright tests set `User-Agent: SmartAgent-Test/<version>`
which is exempted via env `TEST_USER_AGENT_ALLOW`.

### 2.6 Endpoint integration pattern

```ts
// apps/web/src/app/api/votes/cast/route.ts (example)
export async function POST(request: Request) {
  // R5 brute-force gate first (if applicable).
  // R6 captcha gate.
  const { captchaToken, ...rest } = await request.json()
  const captchaResult = await verifyCaptcha(captchaToken, {
    expectedAction: 'votes-cast',
    clientIp: getClientIp(request.headers),
  })
  if (!captchaResult.ok) {
    return NextResponse.json(
      { error: 'captcha required', detail: captchaResult.reason },
      { status: 403 },
    )
  }
  // ... actual handler ...
}
```

## 3. Files to create / change

```
packages/sdk/src/security/
└── (note: nothing here — captcha is web-only because vendor is web-rendered)

apps/web/src/lib/security/
├── captcha.ts                            NEW — verifyCaptcha helper
├── bot-signals.ts                        NEW — looksAutomated heuristic
└── __tests__/
    ├── captcha.test.ts                   NEW
    └── bot-signals.test.ts               NEW

apps/web/src/components/security/
└── captcha-gate.tsx                      NEW — invisible Turnstile widget

apps/web/src/app/api/demo-login/route.ts                  EDIT — gate
apps/web/src/app/api/auth/passkey-challenge/route.ts      EDIT — bot-signals only (no captcha)
apps/web/src/app/api/passkey/enroll/route.ts              EDIT — gate
apps/web/src/app/api/votes/cast/route.ts                  EDIT — gate
apps/web/src/app/api/proposals/create/route.ts            EDIT — gate
apps/web/src/app/api/pledges/create/route.ts              EDIT — gate
apps/web/src/app/api/treasury/contribute/route.ts         EDIT — gate

apps/web/src/app/sign-in/page.tsx                          EDIT — add CaptchaGate
apps/web/src/app/h/[handle]/.../create/page.tsx           EDIT — add CaptchaGate where needed

infra/cloudflare/
└── turnstile.tf                          NEW — provision Turnstile site (or document manual)

.env.example                              EDIT — TURNSTILE_SECRET + NEXT_PUBLIC_TURNSTILE_SITE_KEY
```

## 4. Implementation steps

| Day | Task |
|-----|------|
| 1 | Create Cloudflare Turnstile site key. Document in `.env.example`. Write `verifyCaptcha` + tests. |
| 2 | Build `CaptchaGate` component. Wire into demo-login form. Manual smoke test. |
| 3 | Roll out across the gate-required endpoints in § 2.2. |
| 4 | Add `bot-signals.ts` + integration on medium-cost endpoints. |
| 5 | Tune. Monitor failure rates on dashboards. |

## 5. Test plan

### 5.1 Unit (`captcha.test.ts`)

Mock the Turnstile siteverify endpoint:

| Response | expectedAction | Result |
|----------|----------------|--------|
| `{success: true, action: 'demo-login'}` | `demo-login` | ok |
| `{success: true, action: 'demo-login'}` | `votes-cast` | fail (action mismatch) |
| `{success: false, 'error-codes': ['invalid-input-response']}` | * | fail |
| token absent | * | fail "missing token" |
| dev mode + no secret | * | ok (no-op) |

### 5.2 E2E (Playwright)

```ts
test('demo-login form gates on Turnstile token', async ({ page }) => {
  await page.goto('/sign-in')
  // In dev no-op mode, the CaptchaGate emits 'dev-no-op' immediately.
  await page.click('text=Catalyst Coordinator (Hannah)')
  await expect(page).toHaveURL('/dashboard')
})

test('demo-login without token returns 403', async ({ request }) => {
  // Bypass the form; call the endpoint directly without captchaToken.
  // Note: in dev no-op mode this passes; we test in prod-mode CI lane only.
  if (process.env.CI_MODE !== 'prod-like') test.skip()
  const r = await request.post('/api/demo-login', { data: { userId: 'cat-001' } })
  expect(r.status()).toBe(403)
})
```

### 5.3 Bot-signals tests

Table-driven: 20 sample UA + Accept combinations. Asserts the
classifier matches the labeled expectation. Add Playwright UA to the
allowlist.

### 5.4 Tuning week

Watch Turnstile dashboard for:
- Challenge issuance rate.
- Solve rate (legitimate users).
- Failure rate.

Acceptance: solve rate ≥ 99 % for legitimate traffic over 7 days. If
below, suspect over-aggressive challenges and switch to "managed" mode
on Cloudflare's dashboard.

## 6. Acceptance criteria

- [ ] Turnstile site key provisioned for production + staging.
- [ ] `verifyCaptcha` + `CaptchaGate` exist with unit + E2E tests.
- [ ] Every high-cost endpoint in § 2.2 has CAPTCHA verification.
- [ ] Dev no-op path verified — Playwright suite passes without a
      Turnstile secret.
- [ ] `bot-signals` integrated on medium-cost endpoints; Playwright UA
      allowlisted.
- [ ] 7-day tuning window shows ≥ 99 % solve rate on real traffic.
- [ ] Dashboards: Turnstile failures-per-minute, top failure reasons.

## 7. Vendor references

- Cloudflare Turnstile docs: https://developers.cloudflare.com/turnstile/
- Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- React Turnstile (community wrapper): https://github.com/marsidev/react-turnstile
- hCaptcha (alternative): https://docs.hcaptcha.com/

## 8. Open questions

- **OQ-R6-1**: For SIWE / passkey paths (no UI to embed Turnstile in
  WalletConnect flows), is CAPTCHA appropriate? Proposal: rely on R5
  per-account counter for those paths; CAPTCHA only on form-bound
  endpoints.
- **OQ-R6-2**: Should the dev no-op require an explicit env override
  to suppress (e.g. `BYPASS_CAPTCHA_IN_DEV=true`)? Today we infer
  from absence of `TURNSTILE_SECRET`. Proposal: keep inference;
  fail-loud if `NODE_ENV === 'production'` and secret is unset.
- **OQ-R6-3**: Accessibility audit — Turnstile's invisible mode is
  WCAG-friendly, but if it falls back to a managed challenge, screen
  readers must work. Verify with axe.
- **OQ-R6-4**: Demo-login is dev-only per existing `requireDev()` guard
  (`apps/web/src/app/api/demo-login/route.ts:24`). Does it need
  CAPTCHA? Argue yes — staging is dev-flagged but internet-facing.

## 9. Effort summary

| Stream | Days |
|--------|------|
| Helper + widget + tests | 1.5 |
| Endpoint integration | 1 |
| Bot signals | 0.5 |
| Tuning | 0.5 (calendar) + 0.5 (active dev) |
| Code review | 1 |
| **Total** | **4 days dev + 1 week tuning (S)** |
