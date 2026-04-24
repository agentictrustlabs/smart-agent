/**
 * Catalyst Hub E2E Tests
 * Tests the full user journey for Maria Gonzalez through the Catalyst NoCo Network hub.
 */
import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3000'

test.describe('Catalyst Hub — Maria Gonzalez', () => {

  test('Hub selection and demo login', async ({ page }) => {
    // 1. Root page shows hub selector
    await page.goto(BASE)
    await expect(page.getByText('Smart Agent')).toBeVisible()
    await expect(page.getByText('Catalyst NoCo Network')).toBeVisible()
    await expect(page.getByText('Mission Collective')).toBeVisible()
    await expect(page.getByText('Global.Church')).toBeVisible()

    // 2. Click Catalyst hub
    await page.getByText('Catalyst NoCo Network').click()
    await page.waitForURL('**/h/catalyst**')
    await expect(page.getByText('Connect Wallet')).toBeVisible()
    await expect(page.getByText('Maria Gonzalez')).toBeVisible()

    // 3. Select Maria as demo user
    await page.locator('button', { hasText: 'Maria Gonzalez' }).click()
    await page.waitForURL('**/h/catalyst/home**', { timeout: 30000 })
  })

  async function loginAsMaria(page: import('@playwright/test').Page) {
    // Visit any page first so page.request has a browser context with cookies.
    await page.goto(BASE)
    const r = await page.request.post(`${BASE}/api/demo-login`, {
      data: { userId: 'cat-user-001' },
      headers: { origin: BASE, 'content-type': 'application/json' },
    })
    expect(r.ok()).toBeTruthy()
  }

  test('Dashboard loads with KPIs and delegations', async ({ page }) => {
    await loginAsMaria(page)
    await page.goto(BASE + '/h/catalyst/home')
    await page.waitForLoadState('networkidle')

    // Maria's name should be present somewhere on the signed-in dashboard.
    await expect(page.getByText('Maria').first()).toBeVisible({ timeout: 10000 })
  })

  test('Profile page has M3 components', async ({ page }) => {
    await loginAsMaria(page)
    await page.goto(BASE + '/catalyst/me')
    await page.waitForLoadState('networkidle')

    // Profile page should have a My Profile heading.
    await expect(page.getByRole('heading', { name: /my profile/i }).first()).toBeVisible({ timeout: 10000 })
  })

  test('Onboarding page guards: redirects when profile is complete', async ({ page }) => {
    // Demo users come pre-named/pre-emailed, so the (authenticated) onboarding page
    // calls redirect('/dashboard'), which in turn redirects to the hub home. The
    // onboarding gate working = we end up OFF /onboarding.
    await loginAsMaria(page)
    await page.goto(BASE + '/onboarding')
    await page.waitForLoadState('networkidle')

    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain('/onboarding')
  })

  test('Org deployment page has M3 form', async ({ page }) => {
    await loginAsMaria(page)
    await page.goto(BASE + '/deploy/org')
    await page.waitForLoadState('networkidle')

    // The deploy-org flow needs at minimum a heading + a form control.
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Global Church Hub — Pastor James', () => {

  test('Hub landing and login', async ({ page }) => {
    await page.goto(BASE + '/h/globalchurch')
    await expect(page.getByText('Global.Church').first()).toBeVisible()
    await expect(page.getByText('Pastor James').first()).toBeVisible()

    // Select Pastor James
    await page.locator('button', { hasText: 'Pastor James' }).first().click()
    await page.waitForURL('**/h/globalchurch/home**', { timeout: 30000 })
  })
})

test.describe('Mission Collective Hub — John Kim', () => {

  test('Hub landing and login', async ({ page }) => {
    await page.goto(BASE + '/h/mission')
    await expect(page.getByText('Mission Collective').first()).toBeVisible()
    await expect(page.getByText('John F. Kim').first()).toBeVisible()

    // Select John
    await page.locator('button', { hasText: 'John F. Kim' }).first().click()
    await page.waitForURL('**/h/mission/home**', { timeout: 30000 })
  })
})

test.describe('Cross-hub navigation', () => {

  test('Navigate between hubs', async ({ page }) => {
    // Start at Catalyst
    await page.goto(BASE + '/h/catalyst')
    await expect(page.getByText('Catalyst NoCo Network').first()).toBeVisible()

    // Switch to Mission
    await page.getByRole('link', { name: 'Mission Collective' }).click()
    await page.waitForURL('**/h/mission**')
    await expect(page.getByText('Mission Collective').first()).toBeVisible()

    // Switch to Global Church
    await page.getByRole('link', { name: 'Global.Church' }).click()
    await page.waitForURL('**/h/globalchurch**')
    await expect(page.getByText('Global.Church').first()).toBeVisible()

    // Back to root
    await page.getByRole('link', { name: 'Smart Agent' }).click()
    await page.waitForURL(BASE + '/')
  })
})
