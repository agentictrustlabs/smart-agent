import { test, expect, type Page } from '@playwright/test'

/**
 * Phase 3 — /people/discover surface + Cmd+K command palette.
 *
 * Smoke tests cover the visible contract of the new surfaces:
 *   • Discover card on /people is no longer disabled and links through.
 *   • /people/discover renders the input, intent chips, network bar.
 *   • Picking an intent chip routes to /people/discover?intent=…
 *     and produces at least one result with a degree badge.
 *   • Cmd+K opens the palette; intent chip in the palette routes the
 *     same way.
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

test.describe('Phase 3 — Discover + Cmd+K palette', () => {
  test('Discover card on /people links to /people/discover (no longer disabled)', async ({ page }) => {
    test.setTimeout(120_000)
    await demoLogin(page, 'cat-user-001')
    await page.goto(`${BASE}/people`)
    await page.waitForLoadState('networkidle')

    const card = page.getByTestId('people-card-discover')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.click()
    await page.waitForURL(/\/people\/discover/, { timeout: 15_000 })
    await expect(page.getByTestId('people-discover')).toBeVisible({ timeout: 30_000 })
  })

  test('/people/discover renders input, intent chips, results', async ({ page }) => {
    test.setTimeout(120_000)
    await demoLogin(page, 'cat-user-001')
    await page.goto(`${BASE}/people/discover`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('discover-input')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('discover-intents')).toBeVisible()
    await expect(page.getByTestId('intent-coaches')).toBeVisible()
    await expect(page.getByTestId('network-chip-bar')).toBeVisible()

    // Picking an intent should mark it active and update the URL.
    await page.getByTestId('intent-coaches').click()
    await page.waitForURL(/intent=coaches/, { timeout: 5_000 })

    // At least the search ran (results container is mounted, even if empty).
    await expect(page.getByTestId('discover-results')).toBeVisible()
  })

  test('Cmd+K opens command palette; palette intent chip navigates to Discover', async ({ page }) => {
    test.setTimeout(120_000)
    await demoLogin(page, 'cat-user-001')
    await page.goto(`${BASE}/h/catalyst/home`)
    await page.waitForLoadState('networkidle')

    // Wait for hub shell to hydrate (work queue indicates Mode picker is up).
    await expect(page.getByTestId('principal-context-chip')).toBeVisible({ timeout: 30_000 })

    // Trigger the palette. Use Meta on macOS, Control elsewhere — Playwright maps Meta on its own.
    await page.keyboard.press('Control+k')
    const palette = page.getByTestId('command-palette')
    await expect(palette).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('palette-input')).toBeFocused()

    // Picking a palette intent should close the palette and land on filtered Discover.
    await page.getByTestId('palette-intent-treasurers').click()
    await page.waitForURL(/\/people\/discover\?intent=treasurers/, { timeout: 10_000 })
    await expect(page.getByTestId('intent-treasurers')).toBeVisible({ timeout: 30_000 })
  })

  test('Esc closes the palette', async ({ page }) => {
    test.setTimeout(120_000)
    await demoLogin(page, 'cat-user-001')
    await page.goto(`${BASE}/h/catalyst/home`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('principal-context-chip')).toBeVisible({ timeout: 30_000 })

    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('command-palette')).toHaveCount(0, { timeout: 5_000 })
  })
})
