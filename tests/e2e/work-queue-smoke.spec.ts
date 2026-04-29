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

async function modeBucket(page: Page, mode: string): Promise<string> {
  const txt = await page.getByTestId(`work-mode-${mode}`).textContent()
  return (txt ?? '').trim()
}

test('Maria (Program Director / on-chain owner) sees Govern as default mode', async ({ page }) => {
  test.setTimeout(120_000)
  await demoLogin(page, 'cat-user-001')
  await page.goto(`${BASE}/h/catalyst/home`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('My Work')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('work-mode-govern')).toBeVisible()
  // Govern button rendered = role classification working
  // Walk bucket non-empty = derived items working
  const walk = await modeBucket(page, 'walk')
  expect(walk).toMatch(/Walk\d+/)
})

test('Rachel (Multiplier) sees Disciple as default mode', async ({ page }) => {
  test.setTimeout(120_000)
  await demoLogin(page, 'fr-user-003')
  await page.goto(`${BASE}/h/catalyst/home`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('My Work')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('work-mode-disciple')).toBeVisible()
})
