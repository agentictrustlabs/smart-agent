# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/e2e/grant-flow-full-ui-demo.spec.ts >> Full UI grant lifecycle — Maria → David → Sarah → Maria
- Location: tests/e2e/grant-flow-full-ui-demo.spec.ts:375:5

# Error details

```
Error: page.goto: net::ERR_EMPTY_RESPONSE at http://localhost:3000/demo
Call log:
  - navigating to "http://localhost:3000/demo", waiting until "networkidle"

```

# Test source

```ts
  300 |     // 90s timeout — the default 30s isn't enough when boot-seed is still
  301 |     // hammering the deployer-lock with hub-relationship edges. Demo-login
  302 |     // contends for the same lock when it provisions Maria's treasury, and
  303 |     // can sit waiting >30s during peak seed churn.
  304 |     await w.request.post(`${BASE}/api/demo-login`, {
  305 |       data: { userId },
  306 |       headers: { origin: BASE, 'content-type': 'application/json' },
  307 |       timeout: 90_000,
  308 |     })
  309 |   }
  310 |   // Use a known seeded pool/round/proposal to warm the dynamic-route
  311 |   // compiles ahead of the recording — Next.js dev compiles `/pools/[id]`
  312 |   // etc. on first hit, and those compiles add 5-10s mid-chapter if we
  313 |   // don't pre-trigger them here.
  314 |   const seedPoolUrn = 'urn:smart-agent:pool:demo-trauma-care-pool'
  315 |   const seedPoolEnc = encodeURIComponent(seedPoolUrn)
  316 |   const seedRoundEnc = encodeURIComponent('urn:smart-agent:round:demo-trauma-care-q2')
  317 |   const warmUrls = [
  318 |     `${BASE}/demo`,
  319 |     `${BASE}/`,
  320 |     `${BASE}/h/${bs.hubSlug}/home`,
  321 |     `${BASE}/wallet`,
  322 |     `${BASE}/h/${bs.hubSlug}/pools`,
  323 |     `${BASE}/h/${bs.hubSlug}/pools/new`,
  324 |     `${BASE}/h/${bs.hubSlug}/pools/${seedPoolEnc}`,
  325 |     `${BASE}/h/${bs.hubSlug}/pools/${seedPoolEnc}/pledge`,
  326 |     `${BASE}/h/${bs.hubSlug}/rounds`,
  327 |     `${BASE}/h/${bs.hubSlug}/rounds/new`,
  328 |     `${BASE}/h/${bs.hubSlug}/rounds/${seedRoundEnc}`,
  329 |     `${BASE}/h/${bs.hubSlug}/rounds/${seedRoundEnc}/apply`,
  330 |     `${BASE}/h/${bs.hubSlug}/rounds/${seedRoundEnc}/admin`,
  331 |     `${BASE}/h/${bs.hubSlug}/intents`,
  332 |     `${BASE}/h/${bs.hubSlug}/intents/new`,
  333 |     `${BASE}/h/${bs.hubSlug}/proposals`,
  334 |     `${BASE}/h/${bs.hubSlug}/tasks`,
  335 |     `${BASE}/agents/${bs.fortCollins}`,
  336 |   ]
  337 |   // Next.js compile is route-keyed, not user-keyed — one user's warm
  338 |   // pass covers every subsequent visitor's first hit.
  339 |   await warmLogin('cat-user-001')
  340 |   for (const url of warmUrls) {
  341 |     try {
  342 |       await w.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  343 |       await w.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
  344 |     } catch { /* non-fatal */ }
  345 |   }
  346 |   await ctx.close()
  347 |   console.log('[full-demo] pre-warm complete')
  348 | 
  349 |   // Record before-balance for the finale assertion.
  350 |   // The recipient treasury is Fort Collins's sa:hasTreasury — we resolve
  351 |   // by reading the resolver property directly here so we don't need it
  352 |   // from bootstrap.
  353 |   recipientTreasury = await resolveOrgTreasury(bs.fortCollins)
  354 |   balanceBefore = await readUsdcBalance(recipientTreasury)
  355 |   console.log(`[full-demo] Fort Collins Treasury balance before: $${(Number(balanceBefore) / 1_000_000).toLocaleString()}`)
  356 | })
  357 | 
  358 | async function resolveOrgTreasury(orgSa: Address): Promise<Address> {
  359 |   const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address
  360 |   const resolverAbi = [
  361 |     { type: 'function', name: 'getAddressProperty', stateMutability: 'view',
  362 |       inputs: [{ name: 'a', type: 'address' }, { name: 'k', type: 'bytes32' }],
  363 |       outputs: [{ type: 'address' }] },
  364 |   ] as const
  365 |   const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
  366 |   const { keccak256, toBytes } = viemMod
  367 |   const SA_HAS_TREASURY = keccak256(toBytes('sa:hasTreasury'))
  368 |   const t = await pub.readContract({
  369 |     address: resolver, abi: resolverAbi,
  370 |     functionName: 'getAddressProperty', args: [orgSa, SA_HAS_TREASURY],
  371 |   }) as Address
  372 |   return t && t !== '0x0000000000000000000000000000000000000000' ? t : orgSa
  373 | }
  374 | 
  375 | test('Full UI grant lifecycle — Maria → David → Sarah → Maria', async ({ browser }) => {
  376 |   test.setTimeout(1_800_000) // 30 min cap — full UI walk + cold Next.js compile lulls
  377 | 
  378 |   const ctx: BrowserContext = await browser.newContext({
  379 |     viewport: { width: 1440, height: 900 },
  380 |     recordVideo: { dir: path.resolve(__dirname, 'demo-output'), size: { width: 1440, height: 900 } },
  381 |   })
  382 |   await ctx.addInitScript(CHROME_SCRIPT)
  383 |   const page = await ctx.newPage()
  384 |   // Auto-accept native confirm() dialogs (used by "Finalize awards").
  385 |   page.on('dialog', d => { void d.accept() })
  386 | 
  387 |   const pause = (ms: number) => page.waitForTimeout(ms)
  388 |   const READ = 2400  // banner-read pause
  389 |   const SETTLE = 1100 // post-action visual settle
  390 | 
  391 |   // Unique slug suffix per run so re-runs don't collide.
  392 |   const RUN_SUFFIX = Math.floor(Date.now() / 1000).toString(36)
  393 |   const POOL_NAME  = `Demo Grant Pool ${RUN_SUFFIX}`
  394 |   const POOL_SLUG  = `demo-grant-pool-${RUN_SUFFIX}`
  395 |   const ROUND_NAME = `Demo Grant Round ${RUN_SUFFIX}`
  396 |   const ROUND_SLUG = `demo-grant-round-${RUN_SUFFIX}`
  397 |   const PROPOSAL_TITLE = `Trauma-care training cohort ${RUN_SUFFIX}`
  398 | 
  399 |   // ── Chapter 1: Maria signs in ───────────────────────────────────────
> 400 |   await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
      |              ^ Error: page.goto: net::ERR_EMPTY_RESPONSE at http://localhost:3000/demo
  401 |   await setBanner(page, 1, TOTAL_CHAPTERS,
  402 |     'Maria signs in',
  403 |     'Demo users are real on-chain principals — same flow as a passkey/SIWE production user.',
  404 |     "Welcome to Smart Agent. We're walking through a complete grant lifecycle, end to end. Maria, the steward of Catalyst NoCo Network, is signing in. In production this is a passkey or sign-in-with-Ethereum flow; the demo user picker is just a shortcut into the same on-chain principal.",
  405 |   )
  406 |   await pause(READ)
  407 |   {
  408 |     const btn = page.locator(`[data-testid="demo-login-cat-user-001"]`)
  409 |     await btn.scrollIntoViewIfNeeded()
  410 |     await btn.hover(); await pause(700)
  411 |     await btn.click()
  412 |     await page.waitForURL(/\/h\/.+\/home|\/dashboard/, { timeout: 30_000 }).catch(() => {})
  413 |     await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  414 |   }
  415 |   await pause(SETTLE)
  416 | 
  417 |   // ── Chapter 2: review wallet — $1M treasury ─────────────────────────
  418 |   await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' })
  419 |   await setBanner(page, 2, TOTAL_CHAPTERS,
  420 |     'Maria\'s wallet — $1M USDC in her treasury',
  421 |     'Money never sits on her smart account. A separate Treasury Service Agent custodies USDC.',
  422 |     "This is Maria's wallet. She has one million dollars in USDC, but notice it's held in a separate Treasury Service Agent, not on her person account. Money never sits on a person's smart account directly — that separation is a core safety property of the platform.",
  423 |   )
  424 |   await pause(READ + 800)
  425 | 
  426 |   // ── Chapter 3: create a new pool ────────────────────────────────────
  427 |   await page.goto(`${BASE}/h/${bs.hubSlug}/pools/new`, { waitUntil: 'networkidle' })
  428 |   await setBanner(page, 3, TOTAL_CHAPTERS,
  429 |     'Maria creates a new grant pool',
  430 |     'The pool\'s AgentAccount is co-owned by Catalyst NoCo Network so stewards = org owners.',
  431 |     "Maria opens the pool create form. The pool is its own on-chain agent — its account is co-owned by the Catalyst NoCo organisation, so stewards equal org owners. She fills in display name, slug, and visibility, then signs the deploy transaction.",
  432 |   )
  433 |   await pause(READ)
  434 |   await fillPoolForm(page, { displayName: POOL_NAME, slug: POOL_SLUG })
  435 |   await pause(700)
  436 |   // Sprint-2 UX: pool form's primary button is now "Review and create" —
  437 |   // it opens a ConfirmActionModal before signing. Click both, then wait
  438 |   // for the redirect to the pool detail.
  439 |   await page.getByRole('button', { name: /Review and create|Create pool/i }).first().click()
  440 |   await pause(500)
  441 |   const confirmBtn = page.getByRole('button', { name: /Create pool|Confirm|Sign/i }).last()
  442 |   if (await confirmBtn.count() > 0) {
  443 |     await confirmBtn.click({ timeout: 10_000 }).catch(() => {})
  444 |   }
  445 |   // Exclude `/pools/new` and `/pools/new/...` — those are the form URLs;
  446 |   // we want the pool detail page after a successful create. Without this,
  447 |   // a slow submit (40+s) leaves us on /pools/new and the test's downstream
  448 |   // chapter-4 fallback nav goes to /pools/new/pledge → 404.
  449 |   await page.waitForURL(/\/pools\/(?!new(\/|$))/, { timeout: 120_000 })
  450 |   await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  451 |   await pause(SETTLE + 800)
  452 | 
  453 |   // Capture the resulting pool detail URL so we can navigate back later.
  454 |   const poolDetailUrl = page.url()
  455 |   if (/\/pools\/new(\/|$)/.test(poolDetailUrl)) {
  456 |     throw new Error(`Pool creation did not redirect to a pool detail page; still at ${poolDetailUrl}`)
  457 |   }
  458 | 
  459 |   // ── Chapter 4: pledge $30k ──────────────────────────────────────────
  460 |   await setBanner(page, 4, TOTAL_CHAPTERS,
  461 |     'Maria pledges $30,000 to the pool',
  462 |     'PledgeRegistry records the commitment. The honor step (next chapter) actually moves USDC.',
  463 |     "With the pool live, Maria pledges thirty thousand dollars to back this round. The pledge is recorded in PledgeRegistry, but no USDC has moved yet — that's a separate honor step she'll take next.",
  464 |   )
  465 |   await pause(READ)
  466 |   let pledgeDetailUrl: string | null = null
  467 |   {
  468 |     const pledgeBtn = page.getByRole('link', { name: /Pledge to this pool/i })
  469 |       .or(page.getByRole('button', { name: /Pledge/i }))
  470 |     await pledgeBtn.first().click().catch(async () => {
  471 |       // Fallback — direct navigation if button isn't found.
  472 |       await page.goto(poolDetailUrl + '/pledge', { waitUntil: 'networkidle' })
  473 |     })
  474 |     await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  475 |     await pause(800)
  476 |     await fillPledgeForm(page, '30000')
  477 |     await pause(600)
  478 |     await page.getByRole('button', { name: /Submit pledge/i }).first().click()
  479 |     // After submit, the composer fires a POST and follows the 303 via
  480 |     // `router.push(res.url)`. Wait specifically for the pledge detail URL
  481 |     // pattern — matching `/pools/` here would resolve instantly because
  482 |     // the current URL is `/h/<hub>/pools/<id>/pledge`, which ALSO contains
  483 |     // `/pools/`. We only care about the post-redirect URL.
  484 |     await page.waitForURL(/\/pledges\/0x[0-9a-fA-F]+/, { timeout: 60_000 }).catch(() => {})
  485 |     await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  486 |     const finalUrl = page.url()
  487 |     if (/\/pledges\/[^/?]+/.test(finalUrl)) {
  488 |       pledgeDetailUrl = finalUrl
  489 |     }
  490 |   }
  491 |   await pause(SETTLE + 600)
  492 | 
  493 |   // ── Chapter 5: honor the pledge ─────────────────────────────────────
  494 |   // If pledge submit redirected to the detail page, we're already there.
  495 |   // Otherwise navigate via the pool detail's pledges section.
  496 |   if (pledgeDetailUrl) {
  497 |     await page.goto(pledgeDetailUrl, { waitUntil: 'networkidle' })
  498 |   } else {
  499 |     // Fallback — go to pool detail, find the most recent pledge link.
  500 |     await page.goto(poolDetailUrl, { waitUntil: 'networkidle' })
```