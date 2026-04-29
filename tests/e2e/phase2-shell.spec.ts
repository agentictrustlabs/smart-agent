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

test.describe('Phase 2 — IA + shell', () => {
  test('Catalyst nav has People, Groups (renamed from Build), no Oikos as separate tab', async ({ page }) => {
    test.setTimeout(120_000)
    await demoLogin(page, 'cat-user-001')
    await page.goto(`${BASE}/h/catalyst/home`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('link', { name: /^People$/ }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('link', { name: /^Groups$/ }).first()).toBeVisible()
    expect(await page.getByRole('link', { name: /^Build$/ }).count()).toBe(0)
    expect(await page.getByRole('link', { name: /^Oikos$/ }).count()).toBe(0)
  })

  test('PrincipalContextChip renders on Home for Maria', async ({ page }) => {
    test.setTimeout(120_000)
    await demoLogin(page, 'cat-user-001')
    await page.goto(`${BASE}/h/catalyst/home`)
    await page.waitForLoadState('networkidle')
    const chip = page.getByTestId('principal-context-chip')
    await expect(chip).toBeVisible({ timeout: 30_000 })
    const text = await chip.textContent()
    expect(text).toMatch(/Working as/)
    expect(text).toMatch(/Maria/)
  })

  test('/people landing has three nav cards + NetworkChipBar', async ({ page }) => {
    test.setTimeout(120_000)
    await demoLogin(page, 'cat-user-001')
    await page.goto(`${BASE}/people`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('people-card-my-people')).toBeVisible()
    await expect(page.getByTestId('people-card-members')).toBeVisible()
    await expect(page.getByTestId('network-chip-bar')).toBeVisible()
    const chipCount = await page.locator('[data-testid="network-chip-bar"] button').count()
    expect(chipCount).toBe(5)
  })
})
