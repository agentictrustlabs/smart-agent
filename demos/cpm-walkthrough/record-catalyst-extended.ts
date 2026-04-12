/**
 * Catalyst Network Extended Demo — Matches GAPP Tutorial Depth
 *
 * Covers ALL major features in ~5-8 minutes:
 *   1. Login + Dashboard with analytics
 *   2. View activity feed + calendar view
 *   3. Log a new activity (full form)
 *   4. Edit an existing activity
 *   5. View team members + invite a facilitator
 *   6. Build the generational map — add a new node interactively
 *   7. Edit an existing node's health markers
 *   8. Explore the gen map tree + metrics
 *   9. Switch orgs (show multi-org)
 *   10. Return to dashboard
 */

import { test, type Page } from '@playwright/test'

const BASE = 'http://localhost:3000'
const TYPE = 45  // typing delay ms
const PAUSE = 2000
const LOOK = 3000 // longer pause for "look at this" moments

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: 'on', size: { width: 1920, height: 1080 } },
  launchOptions: { slowMo: 20 },
})

test('Catalyst Extended Demo', async ({ page }) => {

  // ─── 1. LOGIN + DASHBOARD ────────────────────────────────────────
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // Select community
  await page.getByText('Catalyst Network').click()
  await wait(PAUSE)

  // Login as Linh
  await page.locator('button', { hasText: 'Linh Nguyen' }).click()
  await page.waitForURL('**/dashboard**', { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Switch to Mekong Catalyst Network for analytics view
  const orgSelect = page.locator('[data-component="org-selector"] select')
  if (await orgSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    await orgSelect.selectOption({ label: 'Mekong Catalyst Network' })
    await page.waitForLoadState('networkidle')
    await wait(LOOK)
  }

  // Scroll through dashboard — show analytics
  await smoothScroll(page, 400)
  await wait(PAUSE) // Activity trend chart

  await smoothScroll(page, 400)
  await wait(PAUSE) // Type breakdown + multiplication stats

  await smoothScroll(page, 400)
  await wait(PAUSE) // Recent activity feed

  await smoothScroll(page, 400)
  await wait(PAUSE) // Members table

  // Scroll back to top
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await wait(PAUSE)

  // Switch to Da Nang Hub for activity logging
  await orgSelect.selectOption({ label: 'Da Nang Hub' })
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // ─── 2. ACTIVITIES — FEED VIEW ───────────────────────────────────
  await page.getByRole('link', { name: 'Activities' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // Scan summary cards
  await wait(PAUSE)

  // Scroll to see the activity feed
  await smoothScroll(page, 300)
  await wait(PAUSE)

  // Show a few activities
  await smoothScroll(page, 300)
  await wait(PAUSE)

  // ─── 3. ACTIVITIES — CALENDAR VIEW ───────────────────────────────
  // Switch to calendar
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await wait(1000)
  const calBtn = page.locator('button', { hasText: 'Calendar' })
  await calBtn.click()
  await wait(LOOK) // Show calendar with dots

  // ─── 4. LOG A NEW ACTIVITY ───────────────────────────────────────
  // Switch back to feed
  await page.locator('button', { hasText: 'Activity Feed' }).click()
  await wait(1000)

  // Open form
  await page.getByRole('button', { name: /Log Activity/i }).click()
  await wait(1500)

  // Fill form step by step
  const typeSelect = page.locator('label:has-text("Type") select')
  await typeSelect.selectOption('visit')
  await wait(500)

  await page.locator('label:has-text("Participants") input').fill('6')
  await wait(500)

  const titleInput = page.getByPlaceholder('What happened?')
  await titleInput.click()
  await titleInput.type('Follow-up visit — Thanh Khe families', { delay: TYPE })
  await wait(500)

  const locInput = page.getByPlaceholder('Neighborhood')
  await locInput.click()
  await locInput.type('Thanh Khe, Da Nang', { delay: TYPE })
  await wait(500)

  await page.locator('label:has-text("Duration") input').fill('75')
  await wait(500)

  const notesInput = page.getByPlaceholder('Details, observations, follow-up needed...')
  await notesInput.click()
  await notesInput.type(
    'Visited three families from last week outreach. Two families very engaged — Hien family wants to host a weekly learning session. Thanh family introduced us to neighbors. Scheduled group session for next Tuesday.',
    { delay: 25 }
  )
  await wait(PAUSE)

  // Submit
  await page.getByRole('button', { name: 'Log Activity', exact: true }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK) // Show new activity in feed

  // ─── 5. EDIT AN EXISTING ACTIVITY ────────────────────────────────
  // Find an activity and click Edit
  const editBtn = page.locator('button', { hasText: 'Edit' }).first()
  if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await editBtn.click()
    await wait(1500)

    // Change participants count
    const partInput = page.locator('label:has-text("Participants") input')
    await partInput.fill('12')
    await wait(500)

    // Update
    await page.getByRole('button', { name: 'Update Activity' }).click()
    await page.waitForLoadState('networkidle')
    await wait(PAUSE)
  }

  // ─── 6. TEAM + INVITE ────────────────────────────────────────────
  await page.getByRole('link', { name: 'Organization' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // Scroll through members
  await smoothScroll(page, 300)
  await wait(PAUSE)

  // Scroll to invite
  await smoothScroll(page, 400)
  await wait(PAUSE)

  // Find invite form
  const inviteHeading = page.getByText('Invite a New Member')
  if (await inviteHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
    await inviteHeading.scrollIntoViewIfNeeded()
    await wait(1000)

    const roleSelect = page.locator('[data-component="protocol-info"]:has-text("Invite") select')
    if (await roleSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Browse roles
      await roleSelect.selectOption('operator')
      await wait(1000)

      // Create
      await page.getByRole('button', { name: 'Create Invitation' }).click()
      await wait(LOOK)

      // Hover invite link
      const code = page.locator('code')
      if (await code.isVisible({ timeout: 2000 }).catch(() => false)) {
        await code.hover()
        await wait(PAUSE)
      }
    }
  }

  // ─── 7. GEN MAP — VIEW + METRICS ────────────────────────────────
  // Switch to network org for full gen map
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await wait(500)
  if (await orgSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
    await orgSelect.selectOption({ label: 'Mekong Catalyst Network' })
    await page.waitForLoadState('networkidle')
    await wait(1500)
  }

  await page.getByRole('link', { name: 'Gen Map' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK) // Metrics

  // Scroll to pipeline
  await smoothScroll(page, 400)
  await wait(LOOK) // Generation pipeline G0-G3

  // Scroll to tree
  await smoothScroll(page, 400)
  await wait(PAUSE)

  // ─── 8. GEN MAP — ADD A NEW NODE ────────────────────────────────
  // Find a "+ Child" button on an active node and click it
  const addChildBtn = page.locator('button', { hasText: '+ Child' }).first()
  if (await addChildBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await addChildBtn.click()
    await wait(1500)

    // Fill the form
    const nameInput = page.locator('input[placeholder="Circle name"]')
    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameInput.click()
      await nameInput.type('Hoi An Circle', { delay: TYPE })
      await wait(500)

      const leaderInput = page.locator('input[placeholder="Leader name"]')
      await leaderInput.click()
      await leaderInput.type('Bao Nguyen', { delay: TYPE })
      await wait(500)

      const locationInput = page.locator('input[placeholder="Location"]')
      await locationInput.click()
      await locationInput.type('Hoi An', { delay: TYPE })
      await wait(500)

      // Fill health markers
      const prospectInput = page.locator('label:has-text("Prospects") input')
      if (await prospectInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await prospectInput.fill('5')
        await wait(300)

        const participantInput = page.locator('label:has-text("Participants") input').last()
        await participantInput.fill('3')
        await wait(300)

        const certInput = page.locator('label:has-text("Certified") input')
        await certInput.fill('1')
        await wait(300)
      }

      // Show the circle preview
      await wait(LOOK)

      // Create
      await page.getByRole('button', { name: 'Create Node' }).click()
      await page.waitForLoadState('networkidle')
      await wait(LOOK) // Show new node in tree
    }
  }

  // ─── 9. GEN MAP — EDIT A NODE ───────────────────────────────────
  // Scroll to see tree
  await smoothScroll(page, 300)
  await wait(PAUSE)

  // Click Edit on an existing node
  const editNodeBtn = page.locator('button', { hasText: 'Edit' }).first()
  if (await editNodeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await editNodeBtn.click()
    await wait(1500)

    // Scroll to form
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await wait(1000)

    // Update health — mark as established
    const estCheckbox = page.locator('label:has-text("Established") input[type="checkbox"]')
    if (await estCheckbox.isVisible({ timeout: 1000 }).catch(() => false)) {
      if (!(await estCheckbox.isChecked())) {
        await estCheckbox.check()
        await wait(500)
      }
    }

    // Update groups started
    const gsInput = page.locator('label:has-text("Groups Started") input')
    if (await gsInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await gsInput.fill('1')
      await wait(500)
    }

    // Show preview with solid circle
    await wait(LOOK)

    // Update
    await page.getByRole('button', { name: 'Update' }).click()
    await page.waitForLoadState('networkidle')
    await wait(LOOK)
  }

  // Scroll through updated tree
  await smoothScroll(page, 400)
  await wait(PAUSE)
  await smoothScroll(page, 400)
  await wait(PAUSE)
  await smoothScroll(page, 300)
  await wait(PAUSE)

  // ─── 10. CLOSING — BACK TO DASHBOARD ─────────────────────────────
  await page.getByRole('link', { name: 'Home' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK) // Final dashboard view

  await smoothScroll(page, 300)
  await wait(PAUSE)

  await wait(3000) // Hold for closing narration
})

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function smoothScroll(page: Page, pixels: number) {
  await page.evaluate(async (px) => {
    const step = px > 0 ? 12 : -12
    const steps = Math.abs(Math.round(px / step))
    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, step)
      await new Promise(r => setTimeout(r, 16))
    }
  }, pixels)
}
