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

  test('Dashboard loads with KPIs and delegations', async ({ page }) => {
    // Login as Maria
    await page.goto(BASE + '/api/demo-login', {
      waitUntil: 'networkidle',
    })
    await page.evaluate(async () => {
      await fetch('/api/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'cat-user-001' }),
      })
    })
    await page.goto(BASE + '/catalyst')
    await page.waitForLoadState('networkidle')

    // Verify dashboard elements
    await expect(page.getByText('Good')).toBeVisible({ timeout: 10000 }) // greeting
    await expect(page.getByText('Maria')).toBeVisible()
  })

  test('Profile page has M3 components', async ({ page }) => {
    // Login
    await page.evaluate(async () => {
      await fetch('/api/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'cat-user-001' }),
      })
    })
    await page.goto(BASE + '/catalyst/me')
    await page.waitForLoadState('networkidle')

    // Check M3 Card components are present
    await expect(page.getByText('Personal Information')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Address')).toBeVisible()
    await expect(page.getByText('Language')).toBeVisible()
    await expect(page.getByText('Save Profile')).toBeVisible()
    await expect(page.getByText('Manage Data Sharing')).toBeVisible()
  })

  test('Onboarding page has M3 stepper', async ({ page }) => {
    await page.goto(BASE + '/onboarding')
    await page.waitForLoadState('networkidle')

    // M3 elements should be present
    await expect(page.getByText('Complete Your Profile')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Continue')).toBeVisible()
  })

  test('Org deployment page has M3 form', async ({ page }) => {
    // Login first
    await page.evaluate(async () => {
      await fetch('/api/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'cat-user-001' }),
      })
    })
    await page.goto(BASE + '/deploy/org')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Deploy Organization Agent')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('What you get')).toBeVisible()
    await expect(page.getByText('Organization Name')).toBeVisible()
    await expect(page.getByText('Multi-Sig Governance')).toBeVisible()
  })
})

test.describe('Global Church Hub — Pastor James', () => {

  test('Hub landing and login', async ({ page }) => {
    await page.goto(BASE + '/h/globalchurch')
    await expect(page.getByText('Global.Church')).toBeVisible()
    await expect(page.getByText('Pastor James')).toBeVisible()

    // Select Pastor James
    await page.locator('button', { hasText: 'Pastor James' }).click()
    await page.waitForURL('**/h/globalchurch/home**', { timeout: 30000 })
  })
})

test.describe('Mission Collective Hub — John Kim', () => {

  test('Hub landing and login', async ({ page }) => {
    await page.goto(BASE + '/h/mission')
    await expect(page.getByText('Mission Collective')).toBeVisible()
    await expect(page.getByText('John F. Kim')).toBeVisible()

    // Select John
    await page.locator('button', { hasText: 'John F. Kim' }).click()
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
