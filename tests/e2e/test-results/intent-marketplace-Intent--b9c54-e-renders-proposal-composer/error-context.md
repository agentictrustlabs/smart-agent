# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: intent-marketplace.spec.ts >> Intent Marketplace — three-lane smoke test >> apply page renders proposal composer
- Location: intent-marketplace.spec.ts:92:7

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: page.goto: Test timeout of 120000ms exceeded.
Call log:
  - navigating to "http://localhost:3000/h/catalyst/rounds/demo-trauma-care-q2/apply", waiting until "load"

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e4]: Smart Agent
  - main [ref=e5]:
    - generic [ref=e6]: Loading...
```

# Test source

```ts
  1   | import { test, expect, type Page } from '@playwright/test'
  2   | 
  3   | const BASE = 'http://localhost:3000'
  4   | 
  5   | async function demoLogin(page: Page, userId: string) {
  6   |   await page.goto(BASE)
  7   |   const r = await page.request.post(`${BASE}/api/demo-login`, {
  8   |     data: { userId },
  9   |     headers: { origin: BASE, 'content-type': 'application/json' },
  10  |   })
  11  |   expect(r.ok()).toBeTruthy()
  12  | }
  13  | 
  14  | /**
  15  |  * End-to-end smoke test for the three intent-marketplace lanes shipped in
  16  |  * specs 001 / 002 / 003. Validates the seeded demo data renders on every
  17  |  * page Maria can reach as a Catalyst NoCo Network member.
  18  |  *
  19  |  * Prereqs (run in order before this spec):
  20  |  *   pnpm exec tsx scripts/sync-ontology.ts
  21  |  *   pnpm exec tsx scripts/seed-test-round.ts
  22  |  *   pnpm exec tsx scripts/seed-test-pool.ts
  23  |  *   (sign Maria in once via /demo so her users row is provisioned)
  24  |  *   pnpm exec tsx scripts/seed-test-proposal.ts
  25  |  *   pnpm exec tsx scripts/seed-test-pledge.ts
  26  |  *   pnpm exec tsx scripts/seed-test-match-initiation.ts
  27  |  *
  28  |  * Each test logs Maria in fresh via the /api/demo-login endpoint (the
  29  |  * existing demoLogin helper pattern from phase2-shell.spec.ts).
  30  |  */
  31  | test.describe('Intent Marketplace — three-lane smoke test', () => {
  32  |   // The runtime kb-sync is debounced (60s quiet + 30s cooldown); the
  33  |   // production write-paths use scheduleKbSync to protect GraphDB. For
  34  |   // the test suite we need GraphDB to reflect the latest seeded state
  35  |   // BEFORE the first read, so we force one sync once at the start of
  36  |   // the suite. Subsequent tests reuse the warm GraphDB state.
  37  |   test.beforeAll(async ({ request }) => {
  38  |     test.setTimeout(180_000)
  39  |     try {
  40  |       await request.post(`${BASE}/api/ontology-sync`, { timeout: 120_000 })
  41  |     } catch {
  42  |       // best-effort — if the sync fails the read tests will surface it
  43  |     }
  44  |   })
  45  | 
  46  |   test.beforeEach(async ({ page }) => {
  47  |     test.setTimeout(120_000)
  48  |     await demoLogin(page, 'cat-user-001') // Maria Gonzalez
  49  |   })
  50  | 
  51  |   // ─── Discover (aggregate of all three lanes) ─────────────────────────
  52  | 
  53  |   test('discover surfaces all three lanes', async ({ page }) => {
  54  |     // Streams A–E UX overhaul: the aggregate /h/{hub}/discover surface
  55  |     // was removed. The three lanes now have dedicated index pages —
  56  |     // /rounds (Open rounds), /pools (Open pools), /intents (Intents).
  57  |     // Verify the lane heads render on each.
  58  |     await page.goto(`${BASE}/h/catalyst/rounds`)
  59  |     await page.waitForLoadState('networkidle')
  60  |     await expect(page.getByText(/Open rounds/i).first()).toBeVisible({ timeout: 30_000 })
  61  | 
  62  |     await page.goto(`${BASE}/h/catalyst/pools`)
  63  |     await page.waitForLoadState('networkidle')
  64  |     await expect(page.getByText(/Open pools|Pools/i).first()).toBeVisible({ timeout: 30_000 })
  65  | 
  66  |     await page.goto(`${BASE}/h/catalyst/intents`)
  67  |     await page.waitForLoadState('networkidle')
  68  |     await expect(page.getByRole('heading', { name: /Intents/i }).first()).toBeVisible({ timeout: 30_000 })
  69  |   })
  70  | 
  71  |   // ─── Spec 003 (Proposal lane) ────────────────────────────────────────
  72  | 
  73  |   test('rounds index shows seeded round', async ({ page }) => {
  74  |     await page.goto(`${BASE}/h/catalyst/rounds`)
  75  |     await page.waitForLoadState('networkidle')
  76  |     await expect(page.getByText(/Open rounds/i).first()).toBeVisible({ timeout: 30_000 })
  77  |     // The seeded round's mandate kinds include trauma-care
  78  |     await expect(page.getByText(/trauma-care/i).first()).toBeVisible()
  79  |   })
  80  | 
  81  |   test('round detail renders eligibility + budget + milestone blocks', async ({ page }) => {
  82  |     await page.goto(`${BASE}/h/catalyst/rounds/demo-trauma-care-q2`)
  83  |     await page.waitForLoadState('networkidle')
  84  |     const body = page.locator('body')
  85  |     // Mandate kind, budget ceiling, and reporting cadence all present.
  86  |     // Use containText with one timeout instead of three brittle locators.
  87  |     await expect(body).toContainText(/trauma-care/i, { timeout: 30_000 })
  88  |     await expect(body).toContainText(/250,?000|250k/i, { timeout: 15_000 })
  89  |     await expect(body).toContainText(/quarterly|reporting/i, { timeout: 15_000 })
  90  |   })
  91  | 
  92  |   test('apply page renders proposal composer', async ({ page }) => {
> 93  |     await page.goto(`${BASE}/h/catalyst/rounds/demo-trauma-care-q2/apply`)
      |                ^ Error: page.goto: Test timeout of 120000ms exceeded.
  94  |     await page.waitForLoadState('networkidle')
  95  |     // The composer is a multi-section form — we just need a Submit button
  96  |     // and at least one input visible.
  97  |     const submit = page.getByRole('button', { name: /Submit/i }).first()
  98  |     await expect(submit).toBeVisible({ timeout: 30_000 })
  99  |   })
  100 | 
  101 |   test('proposals list shows seeded draft + submitted', async ({ page }) => {
  102 |     await page.goto(`${BASE}/h/catalyst/proposals`)
  103 |     await page.waitForLoadState('networkidle')
  104 |     // We seeded one draft + one submitted; both status badges should appear.
  105 |     await expect(page.getByText(/draft/i).first()).toBeVisible({ timeout: 30_000 })
  106 |     await expect(page.getByText(/submitted/i).first()).toBeVisible()
  107 |   })
  108 | 
  109 |   // ─── Spec 002 (Pool lane) ────────────────────────────────────────────
  110 | 
  111 |   test('pools index shows seeded pool', async ({ page }) => {
  112 |     await page.goto(`${BASE}/h/catalyst/pools`)
  113 |     await page.waitForLoadState('networkidle')
  114 |     // Page heading
  115 |     const body = page.locator('body')
  116 |     await expect(body).toContainText(/Pool|pool/i, { timeout: 30_000 })
  117 |     // Seeded pool's mandate hits trauma-care (or empty state if pool wasn't synced).
  118 |     // Either way, the page rendered without 4xx/5xx.
  119 |   })
  120 | 
  121 |   test('pledges page reachable', async ({ page }) => {
  122 |     const resp = await page.goto(`${BASE}/h/catalyst/pledges`)
  123 |     expect(resp?.status()).toBeLessThan(400)
  124 |     await page.waitForLoadState('networkidle')
  125 |     // Page heading or section title
  126 |     const body = page.locator('body')
  127 |     await expect(body).toContainText(/Pledge|pledge/i, { timeout: 30_000 })
  128 |   })
  129 | 
  130 |   // ─── Spec 001 (Direct lane) ──────────────────────────────────────────
  131 | 
  132 |   test('intents index reachable', async ({ page }) => {
  133 |     const resp = await page.goto(`${BASE}/h/catalyst/intents`)
  134 |     expect(resp?.status()).toBeLessThan(400)
  135 |     await page.waitForLoadState('networkidle')
  136 |     // The existing intents page renders direction filter chips. Just verify
  137 |     // page render didn't 5xx.
  138 |     const body = page.locator('body')
  139 |     await expect(body).toContainText(/Intent|intent|Need|need/i, { timeout: 30_000 })
  140 |   })
  141 | 
  142 |   test('intent detail with seeded need renders candidates section', async ({ page }) => {
  143 |     // Slug-style id (no colons) — see scripts/seed-test-match-initiation.ts
  144 |     // for the rationale (Next.js routes URN-style ids to 404).
  145 |     // Spec 004 v2: match_initiations SQL table was dropped and
  146 |     // seed-test-match-initiation became a no-op. The legacy seeded intent
  147 |     // 'demo-maria-need-trauma-coaching' may not exist. Both hard 404 and
  148 |     // Next.js soft-404 (status 200 + notFound() body) are acceptable
  149 |     // skip-paths until a replacement seed lands.
  150 |     const intentId = 'demo-maria-need-trauma-coaching'
  151 |     const resp = await page.goto(`${BASE}/h/catalyst/intents/${intentId}`)
  152 |     if (resp && resp.status() >= 400) {
  153 |       test.info().annotations.push({ type: 'note', description: `intent detail returned ${resp.status()}` })
  154 |       return
  155 |     }
  156 |     await page.waitForLoadState('networkidle')
  157 |     const body = page.locator('body')
  158 |     const bodyText = (await body.textContent()) ?? ''
  159 |     if (/This page could not be found/i.test(bodyText)) {
  160 |       test.info().annotations.push({ type: 'note', description: 'intent not seeded (soft 404)' })
  161 |       return
  162 |     }
  163 |     // The body should have *something* about coaching or trauma-care.
  164 |     await expect(body).toContainText(/trauma-care|Coaching|coach/i, { timeout: 30_000 })
  165 |   })
  166 | 
  167 |   // ─── Nav (Funding tab presence) ──────────────────────────────────────
  168 | 
  169 |   test('Funding nav tab is reachable from hub home', async ({ page }) => {
  170 |     await page.goto(`${BASE}/h/catalyst/home`)
  171 |     await page.waitForLoadState('networkidle')
  172 |     // The nav tab links to /h/catalyst/rounds; we just need the nav to render
  173 |     // and at least one Funding-or-rounds link to be present.
  174 |     const fundingLink = page.getByRole('link', { name: /Funding|Rounds|Grant/i }).first()
  175 |     await expect(fundingLink).toBeVisible({ timeout: 30_000 })
  176 |   })
  177 | 
  178 |   // ─── Phase 2.5 — steward / cancellation / pool-create UI ─────────────
  179 | 
  180 |   test('round detail surfaces steward "Review proposals" + "Cancel round" CTAs for fund managers', async ({ page }) => {
  181 |     // Maria manages the Catalyst NoCo Network (ROLE_OWNER edge from
  182 |     // catalyst-seed). Round detail should expose the steward affordances.
  183 |     // Streams A-E UX overhaul: the link text now embeds the proposal count
  184 |     // (e.g. "Review 2 proposals →" or "View proposals (none yet) →"),
  185 |     // and the Cancel button only renders when canCancel resolves true.
  186 |     await page.goto(`${BASE}/h/catalyst/rounds/demo-trauma-care-q2`)
  187 |     await page.waitForLoadState('networkidle')
  188 |     // Either "Review N proposals" (when proposals submitted) or
  189 |     // "View proposals" (empty state) is acceptable for steward visibility.
  190 |     await expect(
  191 |       page.getByRole('link', { name: /(Review|View).*proposal/i }).first(),
  192 |     ).toBeVisible({ timeout: 30_000 })
  193 |     await expect(page.getByRole('button', { name: /Cancel round/i })).toBeVisible()
```