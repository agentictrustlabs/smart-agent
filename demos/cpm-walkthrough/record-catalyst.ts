/**
 * Catalyst Network Demo — Automated Screen Recording
 *
 * Same flow as the GAPP tutorial but with community development framing:
 *   1. Login → select Catalyst Network → pick Linh (Hub Lead)
 *   2. Log a field activity (community outreach)
 *   3. Invite a new facilitator
 *   4. Explore the generational map (learning circles multiplying)
 *
 * Usage:
 *   npx playwright test --config demos/cpm-walkthrough/playwright.config.ts --grep "Catalyst"
 */

import { test, type Page } from '@playwright/test'

const BASE = 'http://localhost:3000'
const SLOW = 55
const PAUSE = 2500

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: 'on', size: { width: 1920, height: 1080 } },
  launchOptions: { slowMo: 30 },
})

test('Catalyst Network Demo', async ({ page }) => {

  // ─── SECTION 1: LOGIN ────────────────────────────────────────────
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Click Catalyst Network community
  await page.getByText('Catalyst Network').click()
  await wait(PAUSE)

  // Click Linh Nguyen (Hub Lead — drives the most interesting demo)
  await page.locator('button', { hasText: 'Linh Nguyen' }).click()
  await page.waitForURL('**/dashboard**', { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Show the org selector — Linh sees Da Nang Hub + Mekong Catalyst Network
  const orgSelect = page.locator('[data-component="org-selector"] select')
  if (await orgSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Start on Da Nang Hub (her primary org)
    await orgSelect.selectOption({ label: 'Da Nang Hub' })
    await page.waitForLoadState('networkidle')
    await wait(PAUSE)
  }

  // ─── SECTION 2: LOG AN ACTIVITY ──────────────────────────────────
  await page.getByRole('link', { name: 'Activities' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Open the log form
  const logBtn = page.getByRole('button', { name: /Log Activity/i })
  await logBtn.click()
  await wait(1500)

  // Type = Outreach
  const typeSelect = page.locator('label:has-text("Type") select')
  await typeSelect.selectOption('outreach')
  await wait(500)

  // Participants
  await page.locator('label:has-text("Participants") input').fill('10')
  await wait(500)

  // Title
  const titleInput = page.getByPlaceholder('What happened?')
  await titleInput.click()
  await titleInput.type('Community engagement — Thanh Khe ward', { delay: SLOW })
  await wait(500)

  // Location
  const locInput = page.getByPlaceholder('Neighborhood')
  await locInput.click()
  await locInput.type('Thanh Khe, Da Nang', { delay: SLOW })
  await wait(500)

  // Duration
  await page.locator('label:has-text("Duration") input').fill('90')
  await wait(500)

  // Notes
  const notesInput = page.getByPlaceholder('Details...')
  await notesInput.click()
  await notesInput.type(
    'Introduced the program to 10 families in the ward. Three families expressed strong interest in joining a learning circle. Scheduled follow-up visits for next week.',
    { delay: 30 }
  )
  await wait(PAUSE)

  // Submit
  await page.getByRole('button', { name: 'Log Activity', exact: true }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // ─── SECTION 3: INVITE A FACILITATOR ─────────────────────────────
  await page.getByRole('link', { name: 'Organization' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Scroll to invite form
  const inviteHeading = page.getByText('Invite a New Member')
  await inviteHeading.scrollIntoViewIfNeeded()
  await wait(PAUSE)

  // Select Facilitator role
  const roleSelect = page.locator('[data-component="protocol-info"]:has-text("Invite") select')
  if (await roleSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    await roleSelect.selectOption('operator')
    await wait(1000)

    await page.getByRole('button', { name: 'Create Invitation' }).click()
    await wait(PAUSE)

    // Show the invite link
    const inviteCode = page.locator('code')
    if (await inviteCode.isVisible({ timeout: 3000 }).catch(() => false)) {
      await inviteCode.hover()
      await wait(PAUSE)
    }
  }

  // ─── SECTION 4: GENERATIONAL MAP ────────────────────────────────
  // Switch to network org for full gen map view
  if (await orgSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
    await orgSelect.selectOption({ label: 'Mekong Catalyst Network' })
    await page.waitForLoadState('networkidle')
    await wait(1500)
  }

  await page.getByRole('link', { name: 'Gen Map' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Scan metrics
  await wait(PAUSE)

  // Scroll through pipeline + tree
  await smoothScroll(page, 500)
  await wait(PAUSE)

  await smoothScroll(page, 500)
  await wait(PAUSE)

  await smoothScroll(page, 400)
  await wait(PAUSE)

  await smoothScroll(page, 300)
  await wait(1500)

  // ─── CLOSING ─────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Home' }).click()
  await page.waitForLoadState('networkidle')
  await wait(3000)
})

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function smoothScroll(page: Page, pixels: number) {
  await page.evaluate(async (px) => {
    const step = px > 0 ? 15 : -15
    const steps = Math.abs(Math.round(px / step))
    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, step)
      await new Promise(r => setTimeout(r, 16))
    }
  }, pixels)
}
