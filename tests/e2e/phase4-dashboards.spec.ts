import { test, expect, type Page } from '@playwright/test'

/**
 * Phase 4 — per-mode dashboard panels.
 *
 * Each role gets a different set of mode-specific panels under the Work
 * Queue. This suite checks role → panel routing for the three rolesplaybook
 * Phase 4 promised: Multiplier/Coach (disciple mode), Dispatcher
 * (route mode), and Owner/Director (govern — no extra panels).
 */

const BASE = 'http://localhost:3000'

async function demoLogin(page: Page, userId: string) {
  await page.goto(BASE)
  const r = await page.request.post(`${BASE}/api/demo-login`, {
    data: { userId },
    headers: { origin: BASE, 'content-type': 'application/json' },
  })
  expect(r.ok()).toBeTruthy()
}

test.describe('Phase 4 — DashboardForMode', () => {
  test('Kenji (Multi-Gen Coach) sees Mentees + Oikos panels on Home', async ({ page }) => {
    test.setTimeout(120_000)
    await demoLogin(page, 'fr-user-004')
    await page.goto(`${BASE}/h/catalyst/home`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('principal-context-chip')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('my-mentees-panel')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('my-oikos-snapshot')).toBeVisible({ timeout: 30_000 })

    // Kenji coaches Rachel — at least one disciple row should appear.
    await expect(page.getByTestId('my-mentees-disciples')).toBeVisible({ timeout: 15_000 })

    // Dispatcher panel must NOT show for a disciple-mode role.
    expect(await page.getByTestId('pending-triage-panel').count()).toBe(0)
  })

  test('Brent (Dispatcher) sees PendingTriagePanel; no Mentees panel', async ({ page }) => {
    test.setTimeout(120_000)
    await demoLogin(page, 'fr-user-002')
    await page.goto(`${BASE}/h/catalyst/home`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('principal-context-chip')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('pending-triage-panel')).toBeVisible({ timeout: 30_000 })

    expect(await page.getByTestId('my-mentees-panel').count()).toBe(0)
    expect(await page.getByTestId('my-oikos-snapshot').count()).toBe(0)
  })

  test('Maria (Program Director / Govern) sees no mode-specific panels', async ({ page }) => {
    test.setTimeout(120_000)
    await demoLogin(page, 'cat-user-001')
    await page.goto(`${BASE}/h/catalyst/home`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('principal-context-chip')).toBeVisible({ timeout: 30_000 })
    // Mode is govern — none of the Phase 4 mode panels should render.
    expect(await page.getByTestId('my-mentees-panel').count()).toBe(0)
    expect(await page.getByTestId('my-oikos-snapshot').count()).toBe(0)
    expect(await page.getByTestId('pending-triage-panel').count()).toBe(0)
  })
})
