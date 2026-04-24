/**
 * SSI Wallet E2E — real browser click-through.
 *
 * Preconditions:
 *   - anvil + all six app services (web/a2a/person/ssi/org/family) running
 *   - contracts deployed, ontology + type registry seeded
 *   - a clean web DB (boot-seed will pre-provision everything)
 *
 * The boot-seed rule: the banner only goes green once every demo user + org
 * has a real on-chain agent. We wait for that before doing anything else.
 */

import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:3000'

/** Wait for the readiness banner to flip to data-ready="true". */
async function waitUntilSystemReady(page: Page, timeoutMs = 300_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = await page.request.get(`${BASE}/api/system-readiness`)
    if (r.ok()) {
      const body = await r.json() as { allReady: boolean; bootPhase?: string }
      if (body.allReady) return
    }
    await page.waitForTimeout(2000)
  }
  throw new Error(`system did not become ready within ${timeoutMs}ms`)
}

async function demoLogin(page: Page, userId: string): Promise<void> {
  await page.goto(BASE)
  const resp = await page.request.post(`${BASE}/api/demo-login`, {
    data: { userId },
    headers: { origin: BASE, 'content-type': 'application/json' },
  })
  expect(resp.ok()).toBeTruthy()
}

test.describe('SSI wallet — Catalyst flows', () => {

  test.beforeAll(async ({ request }) => {
    // Kick the boot-seed so the community is pre-provisioned before any test
    // touches /wallet. Fire-and-forget; the readiness poll below actually
    // waits for completion.
    await request.get(`${BASE}/api/boot-seed`).catch(() => {})
  })

  test('system-readiness reports fully ready (infra + services + community + user)', async ({ page }) => {
    await demoLogin(page, 'cat-user-001')  // Maria — triggers session + user check
    await waitUntilSystemReady(page)

    // Hit the readiness API directly so we can assert the shape.
    const r = await page.request.get(`${BASE}/api/system-readiness`)
    const body = await r.json() as {
      infra: Array<{ ok: boolean }>
      services: Array<{ ok: boolean }>
      community: Array<{ ok: boolean; label: string; detail?: string }>
      user: Array<{ ok: boolean }>
      allReady: boolean
    }
    expect(body.allReady).toBeTruthy()
    expect(body.community.every(c => c.ok)).toBeTruthy()
    // Specific community checks: user count, on-chain count, boot seed.
    expect(body.community.find(c => c.label === 'All demo users provisioned')?.ok).toBeTruthy()
    expect(body.community.find(c => c.label === 'Community agents registered on-chain')?.ok).toBeTruthy()
    expect(body.community.find(c => c.label === 'Boot seed')?.ok).toBeTruthy()
  })

  test('Maria can accept a credential into a context (auto-provisions if needed)', async ({ page }) => {
    await demoLogin(page, 'cat-user-001')
    await waitUntilSystemReady(page)

    await page.goto(`${BASE}/wallet?context=professional`)
    await page.waitForLoadState('networkidle')

    // The Accept button is always present; acceptCredentialAction provisions
    // the wallet automatically if it doesn't exist yet. No need to branch on
    // the provision-state indicator.
    const acceptBtn = page.getByTestId('accept-membership')
    await expect(acceptBtn).toBeVisible({ timeout: 10_000 })
    await acceptBtn.click()
    await expect(page.getByTestId('accept-ok')).toBeVisible({ timeout: 60_000 })

    // After refresh, the provisioned banner + credential row are both there.
    await expect(page.getByText(/Holder wallet provisioned/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('OrgMembershipCredential').first()).toBeVisible()
  })

  test('Guardian proof to coach verifies', async ({ page }) => {
    await demoLogin(page, 'cat-user-001')
    await waitUntilSystemReady(page)

    // Put a guardian credential in Maria's default wallet.
    await page.goto(`${BASE}/wallet?context=default`)
    const provisionBtn = page.getByTestId('provision-button')
    if (await provisionBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await provisionBtn.click()
      await expect(page.getByText(/Holder wallet provisioned/i)).toBeVisible({ timeout: 30_000 })
    }
    const acceptGuardian = page.getByTestId('accept-guardian')
    await acceptGuardian.click()
    await expect(page.getByTestId('accept-ok')).toBeVisible({ timeout: 60_000 })

    // Present to coach.
    await page.goto(`${BASE}/verify/coach`)
    const presentBtn = page.locator('button', { hasText: 'Present to coach' }).first()
    await expect(presentBtn).toBeVisible({ timeout: 10_000 })
    await presentBtn.click()
    await expect(page.getByText(/Coach accepted the proof/i)).toBeVisible({ timeout: 60_000 })
  })
})
