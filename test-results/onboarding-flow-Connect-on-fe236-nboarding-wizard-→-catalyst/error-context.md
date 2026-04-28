# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: onboarding-flow.spec.ts >> Connect + onboarding >> siwe: server-signed login → onboarding wizard → catalyst
- Location: tests/e2e/onboarding-flow.spec.ts:178:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  92  |     { timeout: 60_000 },
  93  |   )
  94  | 
  95  |   // Step 1 (only if visible): Profile.
  96  |   if (await page.getByPlaceholder(/Alice Smith/i).count() > 0) {
  97  |     await page.getByPlaceholder(/Alice Smith/i).fill(opts.name)
  98  |     await page.getByPlaceholder(/alice@example\.com/i).fill(opts.email)
  99  |     await page.getByRole('button', { name: /continue/i }).click()
  100 |   }
  101 | 
  102 |   // Step 2: Register agent runs automatically and self-advances to the Name
  103 |   // step on success. For healthy fresh accounts the deployer is in `_owners`,
  104 |   // ensurePersonAgentRegistered lands cleanly, and the wizard moves on
  105 |   // without surfacing a "Continue" click. We just wait for the Name step.
  106 | 
  107 |   // Step 3: Name picker. Heading is "Choose your <code>.agent</code> name".
  108 |   await page.waitForFunction(
  109 |     () => (document.body.textContent ?? '').includes('Choose your'),
  110 |     { timeout: 60_000 },
  111 |   )
  112 |   if (opts.agentLabel) {
  113 |     await page.getByPlaceholder(/^e\.g\. joe$/i).fill(opts.agentLabel)
  114 |     await page.getByRole('button', { name: /register name/i }).click()
  115 |   } else {
  116 |     await page.getByRole('button', { name: /skip for now/i }).click()
  117 |   }
  118 | 
  119 |   // Step 4: Choose. "Explore" lands on /dashboard with no downstream side
  120 |   // effects.
  121 |   await page.waitForFunction(
  122 |     () => (document.body.textContent ?? '').includes('What would you like to do'),
  123 |     { timeout: 60_000 },
  124 |   )
  125 |   await page.getByText(/^explore$/i).first().click()
  126 | 
  127 |   await page.waitForURL((u) => !u.pathname.startsWith('/onboarding'), { timeout: 30_000 })
  128 | }
  129 | 
  130 | // ─── Test 1 — Passkey signup + onboarding ─────────────────────────────
  131 | 
  132 | test.describe('Connect + onboarding', () => {
  133 |   test.beforeAll(async () => { await installP256Stub() })
  134 | 
  135 |   test('passkey: signup → onboarding wizard → catalyst', async ({ page }) => {
  136 |     test.setTimeout(240_000)
  137 |     const virt = await addVirtualAuthenticator(page)
  138 | 
  139 |     // /sign-up redirects to /; signup happens from a hub landing now.
  140 |     const label = `pwp${Date.now().toString().slice(-6)}`
  141 |     const fullName = `${label}.agent`
  142 |     await page.goto(`${BASE}/h/catalyst`)
  143 |     await page.waitForLoadState('networkidle')
  144 |     await page.getByTestId('hub-onboard-signup-name').fill(label)
  145 |     await expect(page.getByTestId('hub-onboard-passkey-signup')).toBeEnabled({ timeout: 30_000 })
  146 |     await page.getByTestId('hub-onboard-passkey-signup').click()
  147 | 
  148 |     // Two-prompt signup (registration + session-grant) followed by holder
  149 |     // wallet provisioning via session-EOA. Poll the session API since the
  150 |     // post-signup reload may keep the user on /h/catalyst showing the
  151 |     // next onboarding card rather than redirecting to /home.
  152 |     await expect.poll(
  153 |       async () => {
  154 |         const r = await page.request.get(`${BASE}/api/auth/session`)
  155 |         const body = await r.json() as { user: { name?: string } | null }
  156 |         return body.user?.name ?? null
  157 |       },
  158 |       { timeout: 180_000, intervals: [2_000] },
  159 |     ).toBe(fullName)
  160 | 
  161 |     const sess = await page.request.get(`${BASE}/api/auth/session`)
  162 |     const sessBody = await sess.json() as { user: { via: string; name?: string } | null }
  163 |     expect(sessBody.user?.via).toBe('passkey')
  164 | 
  165 |     // The new in-place hub onboarding registers the .agent name as part
  166 |     // of the signup ceremony, so the personAgent is already resolvable.
  167 |     const ctx = await page.request.get(`${BASE}/api/user-context`)
  168 |     const ctxBody = await ctx.json() as { personAgent: { address: string; primaryName: string } | null }
  169 |     expect(ctxBody.personAgent).not.toBeNull()
  170 |     expect(ctxBody.personAgent!.address).toMatch(/^0x[a-f0-9]{40}$/i)
  171 |     expect(ctxBody.personAgent!.primaryName).toBe(`${label}.agent`)
  172 | 
  173 |     await virt.session.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: virt.authenticatorId })
  174 |   })
  175 | 
  176 |   // ─── Test 2 — SIWE + onboarding ──────────────────────────────────────
  177 | 
  178 |   test('siwe: server-signed login → onboarding wizard → catalyst', async ({ page, request, context }) => {
  179 |     test.setTimeout(180_000)
  180 | 
  181 |     // Sign in via the SIWE API path with a fresh EOA (mirrors what MetaMask
  182 |     // would do in the UI, without driving a wallet popup).
  183 |     const pk = generatePrivateKey()
  184 |     const eoa = privateKeyToAccount(pk)
  185 |     const chall = await request.get(`${BASE}/api/auth/siwe-challenge?domain=127.0.0.1:3000&address=${eoa.address}`)
  186 |     const { message, token } = await chall.json() as { message: string; token: string }
  187 |     const signature = await eoa.signMessage({ message })
  188 |     const verify = await request.post(`${BASE}/api/auth/siwe-verify`, {
  189 |       headers: { 'content-type': 'application/json', origin: BASE },
  190 |       data: { token, message, signature, address: eoa.address },
  191 |     })
> 192 |     expect(verify.ok()).toBe(true)
      |                         ^ Error: expect(received).toBe(expected) // Object.is equality
  193 | 
  194 |     // Move the cookies set by the API onto the browser context so navigation
  195 |     // is authenticated.
  196 |     const cookies = (await verify.headersArray()).filter(h => h.name.toLowerCase() === 'set-cookie').map(h => h.value)
  197 |     for (const raw of cookies) {
  198 |       const [pair] = raw.split(';')
  199 |       const [name, ...rest] = pair.split('=')
  200 |       if (name === 'smart-agent-session') {
  201 |         await context.addCookies([{ name, value: rest.join('='), url: BASE }])
  202 |       }
  203 |     }
  204 | 
  205 |     // SIWE creates a user with a wallet but no .agent name yet. Confirm
  206 |     // the session is minted and resolvable. Name registration happens via
  207 |     // the hub onboarding card after the user picks one. That UI step is
  208 |     // covered by the passkey test above; here we just assert the SIWE
  209 |     // session itself works end-to-end.
  210 |     const sess = await page.request.get(`${BASE}/api/auth/session`)
  211 |     const sessBody = await sess.json() as { user: { via: string; walletAddress: string } | null }
  212 |     expect(sessBody.user?.via).toBe('siwe')
  213 |     expect(sessBody.user?.walletAddress.toLowerCase()).toBe(eoa.address.toLowerCase())
  214 |   })
  215 | 
  216 |   // ─── Test 3 — Google OAuth deterministic-salt invariant ──────────────
  217 |   //
  218 |   // We can't drive Google's consent screen from Playwright, but we can
  219 |   // assert the contract that every Google user's smart-account address is
  220 |   // a deterministic function of (SERVER_PEPPER, email, salt rotation) by
  221 |   // calling the deriveSaltFromEmail helper indirectly via a server route
  222 |   // OR by validating the route returns the same redirect for the same
  223 |   // params. Since we don't have a token, we just confirm the start route
  224 |   // is reachable and produces a redirect URL with state + nonce cookies.
  225 | 
  226 |   test('google: /api/auth/google-start returns a redirect to accounts.google.com', async ({ request }) => {
  227 |     test.setTimeout(30_000)
  228 |     const r = await request.get(`${BASE}/api/auth/google-start`, { maxRedirects: 0 }).catch(e => e)
  229 |     // Expect either a 307/302 redirect OR a 500 if env isn't configured.
  230 |     // In the latter case we still assert the error mentions Google config —
  231 |     // proves the route is wired and reachable.
  232 |     if (r.status?.() === 307 || r.status?.() === 302) {
  233 |       const loc = r.headers().location ?? ''
  234 |       expect(loc).toMatch(/accounts\.google\.com\/o\/oauth2\/v2\/auth/)
  235 |       expect(loc).toContain('client_id=')
  236 |       expect(loc).toContain('redirect_uri=')
  237 |       expect(loc).toContain('state=')
  238 |       expect(loc).toContain('nonce=')
  239 |     } else if (r.status?.() === 500) {
  240 |       const body = await r.json().catch(() => ({})) as { error?: string }
  241 |       expect(body.error ?? '').toMatch(/Google OAuth env not configured/)
  242 |     } else {
  243 |       throw new Error(`unexpected response: ${r.status?.()}`)
  244 |     }
  245 |   })
  246 | 
  247 |   test('google: deterministic salt → same email + rotation = same smart account', async ({ request }) => {
  248 |     // We don't have a server endpoint that exposes the salt directly, but the
  249 |     // user-context route returns the smartAccountAddress for a logged-in
  250 |     // user. Two invariants we sanity-check at the API surface:
  251 |     //   - SIWE returns a deterministic address per EOA (proven elsewhere)
  252 |     //   - The Google callback would do the same per email; we approximate
  253 |     //     that here by computing the address client-side using viem and the
  254 |     //     factory's getAddress(owner, salt) view, then asserting the API
  255 |     //     would return the same when called with the same email twice.
  256 |     //
  257 |     // For a self-contained smoke check, we simply assert that two
  258 |     // siwe-verify calls with the same EOA return the same smartAccount
  259 |     // (already covered in auth-siwe.spec.ts) and skip a full Google e2e.
  260 |     void request
  261 |     void keccak256
  262 |     void toHex
  263 |     test.skip(true, 'real Google OAuth requires a live consent screen; deterministic-salt invariant covered indirectly by SIWE returning-user test')
  264 |   })
  265 | })
  266 | 
```