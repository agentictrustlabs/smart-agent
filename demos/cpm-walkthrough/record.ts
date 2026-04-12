/**
 * CPM Demo Walkthrough — Automated Screen Recording
 *
 * Records the full demo flow:
 *   1. Login → select community → pick user
 *   2. Log a field activity
 *   3. Invite a team member
 *   4. Explore the generational map
 *
 * Usage:
 *   npx playwright test --config demos/cpm-walkthrough/playwright.config.ts
 *
 * Output:
 *   demos/cpm-walkthrough/output/record.ts-CPM-Demo-Walkthrough/video.webm
 */

import { test, type Page } from '@playwright/test'

const BASE = 'http://localhost:3000'
const SLOW = 60   // typing speed (ms per char)
const PAUSE = 2500 // pause between sections

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: 'on', size: { width: 1920, height: 1080 } },
  launchOptions: { slowMo: 30 },
})

test('CPM Demo Walkthrough', async ({ page }) => {

  // ─── SECTION 1: LOGIN ────────────────────────────────────────────
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Click CPM community
  await page.getByText('Church Planting Movement').click()
  await wait(PAUSE)

  // Click Mark Thompson
  await page.locator('button', { hasText: 'Mark Thompson' }).click()
  await page.waitForURL('**/dashboard**', { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Switch to Kolkata Team
  const orgSelect = page.locator('[data-component="org-selector"] select')
  if (await orgSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    await orgSelect.selectOption({ label: 'Kolkata Team' })
    await page.waitForLoadState('networkidle')
    await wait(PAUSE)
  }

  // ─── SECTION 2: LOG AN ACTIVITY ──────────────────────────────────
  await page.getByRole('link', { name: 'Activities' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Open the form
  const logBtn = page.getByRole('button', { name: /Log Activity/i })
  await logBtn.click()
  await wait(1500)

  // Type dropdown — use the label text to find the right one
  const typeSelect = page.locator('label:has-text("Type") select')
  await typeSelect.selectOption('outreach')
  await wait(500)

  // Participants
  const participantsInput = page.locator('label:has-text("Participants") input')
  await participantsInput.fill('8')
  await wait(500)

  // Title
  const titleInput = page.getByPlaceholder('What happened?')
  await titleInput.click()
  await titleInput.type('Neighborhood visit — New Town area', { delay: SLOW })
  await wait(500)

  // Location
  const locInput = page.getByPlaceholder('Neighborhood')
  await locInput.click()
  await locInput.type('New Town, Kolkata', { delay: SLOW })
  await wait(500)

  // Duration
  const durInput = page.locator('label:has-text("Duration") input')
  await durInput.fill('90')
  await wait(500)

  // Notes
  const notesInput = page.getByPlaceholder('Details...')
  await notesInput.click()
  await notesInput.type(
    'Visited six families in the apartment complex. Two expressed interest in joining a study group.',
    { delay: 35 }
  )
  await wait(PAUSE)

  // Submit
  await page.getByRole('button', { name: 'Log Activity', exact: true }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // ─── SECTION 3: INVITE A USER ────────────────────────────────────
  await page.getByRole('link', { name: 'Organization' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Scroll to invite form
  const inviteHeading = page.getByText('Invite a New Member')
  await inviteHeading.scrollIntoViewIfNeeded()
  await wait(PAUSE)

  // Select Church Planter role
  const roleSelect = page.locator('[data-component="protocol-info"]:has-text("Invite") select')
  if (await roleSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    await roleSelect.selectOption('operator')
    await wait(1000)

    // Create invitation
    await page.getByRole('button', { name: 'Create Invitation' }).click()
    await wait(PAUSE)
  }

  // ─── SECTION 4: GENERATIONAL MAP ────────────────────────────────
  // Switch to network org first (gen map data is under the network)
  if (await orgSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
    await orgSelect.selectOption({ label: 'South Asia Movement Network' })
    await page.waitForLoadState('networkidle')
    await wait(1500)
  }

  await page.getByRole('link', { name: 'Gen Map' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Scan metrics
  await wait(PAUSE)

  // Scroll through the page
  await smoothScroll(page, 500)
  await wait(PAUSE)

  await smoothScroll(page, 500)
  await wait(PAUSE)

  await smoothScroll(page, 400)
  await wait(PAUSE)

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
