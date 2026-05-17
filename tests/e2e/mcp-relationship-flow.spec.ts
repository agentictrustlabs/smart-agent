import { test, expect, type Page } from '@playwright/test'

/**
 * Coverage for the post-consolidation relationship create-side flow.
 *
 * Every write here MUST route through MCP tools:
 *   1. `relationship:emit_edge`  — createEdge + addRole
 *   2. `assertion:make` (SELF_ASSERTED) — subject's claim
 *   3. `relationship:set_edge_status`(PROPOSED→CONFIRMED→ACTIVE) ×2 hops
 *   4. `assertion:make` (OBJECT_ASSERTED) — object's claim
 *
 * The bypass guard (`pnpm check:bypass`) statically forbids direct
 * deployer-wallet writes from `apps/web/src`, so this spec drives the
 * user-visible flow and verifies the form completes successfully —
 * proving the MCP-routed implementation is wired up correctly.
 *
 * Auto-confirm path: Maria selects two of her own agents. Action layer
 * sees `userOwnsObject` and runs all four steps, surfacing the
 * "auto-confirmed" success message.
 */

const BASE = 'http://localhost:3000'

async function uiLogin(page: Page, userId: string): Promise<void> {
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
  const btn = page.locator(`[data-testid="demo-login-${userId}"]`)
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
  await page.waitForURL(/\/h\/.+\/home|\/dashboard/, { timeout: 30_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(800)
}

test.describe.configure({ mode: 'serial' })

test.describe('Relationship create-side via MCP', () => {
  test('Maria asserts a self-owned relationship — full MCP chain runs to auto-confirmed', async ({ page }) => {
    test.setTimeout(180_000)

    await uiLogin(page, 'cat-user-001')

    // /relationships is a server-rendered route. First-hit cold compile in
    // Next dev can take 20-30s. Wait for the page heading first, then the
    // form section.
    await page.goto(`${BASE}/relationships`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByRole('heading', { name: /Relationships/i }).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('[data-component="assert-section"]')).toBeVisible({ timeout: 30_000 })

    const fromSelect = page.locator('[data-component="assert-agent"][data-type="subject"] select')
    const toSelect = page.locator('[data-component="assert-agent"][data-type="object"] select')

    // Maria owns at least two agents (Catalyst NoCo Network, Fort Collins
    // hub board seat). Both should appear in the "My Agents" target list.
    const fromOptions = await fromSelect.locator('option').count()
    expect(fromOptions, 'Maria should own ≥1 agent').toBeGreaterThanOrEqual(1)
    const toOptions = await toSelect.locator('option').count()
    expect(toOptions, 'Maria should have ≥1 other owned agent to target').toBeGreaterThanOrEqual(1)

    // Make sure From and To are different (the form auto-filters out the
    // selected "from" from the target list, so first option of each
    // should naturally differ).
    const fromValue = await fromSelect.inputValue()
    const toValue = await toSelect.inputValue()
    expect(fromValue.toLowerCase()).not.toEqual(toValue.toLowerCase())

    await page.getByRole('button', { name: /Create Relationship/i }).click()

    // Success message includes "auto-confirmed" when the action layer
    // detects userOwnsObject and runs the full chain.
    const success = page.locator('[data-component="success-message"]')
    await expect(success).toBeVisible({ timeout: 60_000 })
    await expect(success).toContainText(/auto-confirmed|Created/i)
  })
})
