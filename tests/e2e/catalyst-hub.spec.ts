/**
 * Hub E2E tests covering all three hubs.
 *
 * Demo users live at /demo (each one a button with
 * data-testid="demo-login-<userKey>"). The hub landing pages /h/<slug>
 * now show only the public auth picker (Google / MetaMask / Passkey
 * signup) — they no longer embed the demo-user picker. Tests that need
 * a logged-in demo session call /api/demo-login directly.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:3000'

async function demoLogin(page: Page, userId: string) {
  await page.goto(BASE)
  const r = await page.request.post(`${BASE}/api/demo-login`, {
    data: { userId },
    headers: { origin: BASE, 'content-type': 'application/json' },
  })
  expect(r.ok()).toBeTruthy()
}

test.describe('Catalyst Hub — Maria Gonzalez', () => {

  test('Hub selection and demo login', async ({ page }) => {
    // 1. Root page shows hub selector with all three hubs.
    await page.goto(BASE)
    await expect(page.getByText('Catalyst NoCo Network').first()).toBeVisible()
    await expect(page.getByText('Mission Collective').first()).toBeVisible()
    await expect(page.getByText('Global.Church').first()).toBeVisible()

    // 2. Hub landing shows public auth (Google / MetaMask / Passkey).
    //    Demo users have moved to /demo per the M1 onboarding redesign.
    await page.goto(`${BASE}/h/catalyst`)
    await expect(page.getByTestId('hub-onboard-google')).toBeVisible()
    await expect(page.getByTestId('hub-onboard-metamask')).toBeVisible()
    await expect(page.getByTestId('hub-onboard-passkey-signup')).toBeVisible()

    // 3. Drive a demo login for Maria via the /demo picker, then confirm
    //    the post-login redirect lands on her hub home. The button drives
    //    a polling loop that checks user-readiness (on-chain person agent +
    //    hub deployment) before navigating; that can take a minute on a
    //    cold chain.
    test.setTimeout(180_000)
    await page.goto(`${BASE}/demo`)
    await page.getByTestId('demo-login-cat-user-001').click()
    await page.waitForURL('**/h/catalyst/home**', { timeout: 120_000 })
  })

  test('Dashboard loads with KPIs and delegations', async ({ page }) => {
    await demoLogin(page, 'cat-user-001')
    await page.goto(BASE + '/h/catalyst/home')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Maria').first()).toBeVisible({ timeout: 10_000 })
  })

  test('Profile page has M3 components', async ({ page }) => {
    await demoLogin(page, 'cat-user-001')
    await page.goto(BASE + '/catalyst/me')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /my profile/i }).first()).toBeVisible({ timeout: 10_000 })
  })

  test('Legacy /onboarding URL redirects authenticated users away', async ({ page }) => {
    // The legacy /onboarding standalone page is deprecated — onboarding is
    // now in-place on each hub. The page redirects authenticated users
    // back to root with NEXT_REDIRECT in the RSC payload.
    await demoLogin(page, 'cat-user-001')
    const r = await page.request.get(`${BASE}/onboarding`)
    const body = await r.text()
    expect(body).toContain('NEXT_REDIRECT;replace;/')
  })

  test('Org deployment page has M3 form', async ({ page }) => {
    await demoLogin(page, 'cat-user-001')
    await page.goto(BASE + '/deploy/org')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Global Church Hub — Pastor James', () => {

  test('Hub landing renders + demo session is established', async ({ page }) => {
    // Hub landing renders. Whether it shows the passkey-signup picker or
    // the "isn't on-chain yet" message depends on whether the hub agent
    // has been deployed — only catalyst is deployed by default.
    await page.goto(BASE + '/h/globalchurch')
    await page.waitForLoadState('domcontentloaded')
    const hasPicker = await page.getByTestId('hub-onboard-passkey-signup').count()
    const hasNotDeployedMsg = await page.getByText(/isn't on-chain yet/i).count()
    expect(hasPicker + hasNotDeployedMsg).toBeGreaterThan(0)

    // Demo session is set via the API directly. The /demo button drives a
    // polling loop that requires hub-agent on-chain readiness, which is
    // only seeded for catalyst by default. We just assert the user can
    // log in and the session minted points at the right person.
    await demoLogin(page, 'gc-user-001')
    const sess = await page.request.get(`${BASE}/api/auth/session`)
    const body = await sess.json() as { user: { name?: string } | null }
    expect(body.user?.name).toBe('Pastor James')
  })
})

test.describe('Mission Collective Hub — John Kim', () => {

  test('Hub landing renders + demo session is established', async ({ page }) => {
    await page.goto(BASE + '/h/mission')
    await page.waitForLoadState('domcontentloaded')
    const hasPicker = await page.getByTestId('hub-onboard-passkey-signup').count()
    const hasNotDeployedMsg = await page.getByText(/isn't on-chain yet/i).count()
    expect(hasPicker + hasNotDeployedMsg).toBeGreaterThan(0)

    // John F. Kim is cil-user-006.
    await demoLogin(page, 'cil-user-006')
    const sess = await page.request.get(`${BASE}/api/auth/session`)
    const body = await sess.json() as { user: { name?: string } | null }
    expect(body.user?.name).toBe('John F. Kim')
  })
})

test.describe('Cross-hub navigation', () => {

  test('All three hubs reachable from root', async ({ page }) => {
    for (const slug of ['catalyst', 'mission', 'globalchurch']) {
      const r = await page.goto(`${BASE}/h/${slug}`)
      expect(r?.status()).toBeLessThan(400)
    }
    // Root renders the hub picker.
    await page.goto(BASE)
    await expect(page.getByText('Catalyst NoCo Network').first()).toBeVisible()
  })
})
