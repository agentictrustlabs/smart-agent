/**
 * Full Demo — Matches GAPP Tutorial Flow (~5-8 min)
 *
 * Follows the exact GAPP video structure with different names:
 *   1. Login → Dashboard with analytics
 *   2. Create a new circle (church formation equivalent) with health markers
 *   3. Create a daughter circle under it
 *   4. Show solid vs dashed circle distinction
 *   5. Log a chained activity (Entry → Gospel → Discipleship)
 *   6. View calendar
 *   7. Team management + invite a facilitator
 *   8. Switch to Map View and Table View
 *   9. Gen Map — expand/collapse, pin a circle
 *   10. Edit a circle's health markers
 *   11. Return to dashboard
 */

import { test, type Page } from '@playwright/test'

const BASE = 'http://localhost:3000'
const TYPE = 40
const PAUSE = 2000
const LOOK = 3000

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: 'on', size: { width: 1920, height: 1080 } },
  launchOptions: { slowMo: 15 },
})

test('Full GAPP-Style Demo', async ({ page }) => {

  // ─── 1. LOGIN ────────────────────────────────────────────────────
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  await page.getByText('Catalyst Network').click()
  await wait(PAUSE)

  await page.locator('button', { hasText: 'Linh Nguyen' }).click()
  await page.waitForURL('**/dashboard**', { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Show dashboard — switch to network for analytics
  const org = page.locator('[data-component="org-selector"] select')
  if (await org.isVisible({ timeout: 3000 }).catch(() => false)) {
    await org.selectOption({ label: 'Mekong Catalyst Network' })
    await page.waitForLoadState('networkidle')
    await wait(LOOK)
  }

  // Scroll through analytics
  await smoothScroll(page, 400); await wait(PAUSE)
  await smoothScroll(page, 400); await wait(PAUSE)
  await smoothScroll(page, 400); await wait(PAUSE)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await wait(PAUSE)

  // ─── 2. CREATE A NEW CIRCLE (Gen Map) ────────────────────────────
  await page.getByRole('link', { name: 'Gen Map' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // Show metrics
  await smoothScroll(page, 400); await wait(PAUSE)

  // Show generation pipeline
  await smoothScroll(page, 300); await wait(LOOK)

  // Add a new root circle
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await wait(500)
  await page.getByRole('button', { name: '+ New Root' }).click()
  await wait(1500)

  // Fill form — this is the "Church Formation" equivalent
  await page.locator('input[placeholder="Circle name"]').type('Demo Home Circle', { delay: TYPE })
  await wait(300)
  await page.locator('input[placeholder="Leader name"]').type('Linh Nguyen', { delay: TYPE })
  await wait(300)
  await page.locator('input[placeholder="City or area"]').type('Da Nang Central', { delay: TYPE })
  await wait(500)

  // Mark as established (solid circle)
  const estSelect = page.locator('label:has-text("Is it established") select')
  await estSelect.selectOption('yes')
  await wait(500)

  // Meeting frequency
  const freqSelect = page.locator('label:has-text("Meeting Frequency") select')
  await freqSelect.selectOption('multiple')
  await wait(300)

  // People group
  await page.locator('input[placeholder="e.g. Vietnamese"]').type('Vietnamese Kinh', { delay: TYPE })
  await wait(500)

  // Health markers
  const attInput = page.locator('label:has-text("Attenders") input')
  if (await attInput.isVisible().catch(() => false)) {
    await attInput.fill('8')
    await wait(200)
    await page.locator('label:has-text("Believers") input').last().fill('5')
    await wait(200)
    await page.locator('label:has-text("Baptized") input').last().fill('3')
    await wait(200)
    await page.locator('label:has-text("Leaders") input').last().fill('2')
    await wait(200)
  }

  // Self-functioning markers
  const bapSelf = page.locator('label:has-text("Baptism (self)") input')
  if (await bapSelf.isVisible().catch(() => false)) {
    await bapSelf.check(); await wait(200)
    await page.locator('label:has-text("Teaching (self)") input').check(); await wait(200)
    await page.locator('label:has-text("Practicing giving") input').check(); await wait(200)
  }

  // Show the circle preview
  await wait(LOOK)

  // Create
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // ─── 3. CREATE A DAUGHTER CIRCLE (group, not established) ────────
  // Find the "+Child" button on our new circle
  await smoothScroll(page, 400); await wait(1000)
  const lastChild = page.locator('button:has-text("+Child")').last()
  if (await lastChild.isVisible().catch(() => false)) {
    await lastChild.click()
    await wait(1500)

    // Scroll to form
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await wait(500)

    await page.locator('input[placeholder="Circle name"]').type('Hai Chau Study Group', { delay: TYPE })
    await wait(300)
    await page.locator('input[placeholder="Leader name"]').type('Tran Minh', { delay: TYPE })
    await wait(300)
    await page.locator('input[placeholder="City or area"]').type('Hai Chau District', { delay: TYPE })
    await wait(300)

    // Leave as NOT established (dashed circle)
    // Just add some basic health
    const att2 = page.locator('label:has-text("Attenders") input')
    if (await att2.isVisible().catch(() => false)) {
      await att2.fill('4')
      await wait(200)
      await page.locator('label:has-text("Believers") input').last().fill('2')
      await wait(200)
    }

    await page.locator('input[placeholder="e.g. Vietnamese"]').type('Vietnamese Kinh', { delay: TYPE })
    await wait(PAUSE)

    // Show dashed circle preview
    await wait(LOOK)

    await page.getByRole('button', { name: 'Create' }).click()
    await page.waitForLoadState('networkidle')
    await wait(LOOK)
  }

  // ─── 4. SHOW THE TREE — solid vs dashed ─────────────────────────
  await smoothScroll(page, 500); await wait(LOOK)

  // ─── 5. COLLAPSE AND EXPAND ──────────────────────────────────────
  const collapseBtn = page.locator('button:has-text("Collapse All")')
  if (await collapseBtn.isVisible().catch(() => false)) {
    await collapseBtn.click()
    await wait(LOOK)
    await page.locator('button:has-text("Expand All")').click()
    await wait(LOOK)
  }

  // ─── 6. SWITCH VIEWS — Map View + Table View ────────────────────
  const mapBtn = page.locator('button:has-text("Map View")')
  if (await mapBtn.isVisible().catch(() => false)) {
    await mapBtn.click()
    await wait(LOOK)

    await page.locator('button:has-text("Table View")').click()
    await wait(LOOK)

    // Scroll table
    await smoothScroll(page, 200); await wait(PAUSE)

    // Back to Gen Map
    await page.locator('button:has-text("Gen Map")').first().click()
    await wait(PAUSE)
  }

  // ─── 7. PIN A CIRCLE ────────────────────────────────────────────
  const pinBtn = page.locator('button:has-text("Pin")').first()
  if (await pinBtn.isVisible().catch(() => false)) {
    await pinBtn.click()
    await wait(LOOK)
  }

  // ─── 8. LOG CHAINED ACTIVITIES ──────────────────────────────────
  // Switch to hub for activities
  if (await org.isVisible().catch(() => false)) {
    await org.selectOption({ label: 'Da Nang Hub' })
    await page.waitForLoadState('networkidle')
    await wait(1000)
  }

  await page.getByRole('link', { name: 'Activities' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Log an Entry (prayer walk) activity
  await page.getByRole('button', { name: /Log Activity/i }).click()
  await wait(1000)

  const typeSelect = page.locator('label:has-text("Type") select')
  await typeSelect.selectOption('outreach')
  await wait(300)

  await page.locator('label:has-text("Participants") input').fill('4')
  await wait(300)

  await page.getByPlaceholder('What happened?').type('Outreach walk — Hai Chau neighborhood', { delay: TYPE })
  await wait(300)

  await page.getByPlaceholder('Neighborhood').type('Hai Chau, Da Nang', { delay: TYPE })
  await wait(300)

  await page.locator('label:has-text("Duration") input').fill('60')
  await wait(300)

  await page.getByPlaceholder('Details, observations, follow-up needed...').type(
    'Walked through Hai Chau ward. Met 4 families. Two very open — the Nguyen family invited us to return.',
    { delay: 20 }
  )
  await wait(PAUSE)

  await page.getByRole('button', { name: 'Log Activity', exact: true }).click()
  await wait(LOOK)

  // Chain prompt should appear — click "Chain → Gospel Conversation"
  const chainBtn = page.locator('button:has-text("Chain")')
  if (await chainBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await chainBtn.click()
    await wait(1500)

    // Form opens with Evangelism pre-selected — fill it
    await page.getByPlaceholder('What happened?').type('Gospel conversation — Nguyen family', { delay: TYPE })
    await wait(300)

    await page.locator('label:has-text("Participants") input').fill('3')
    await wait(300)

    await page.getByPlaceholder('Neighborhood').type('Hai Chau, Da Nang', { delay: TYPE })
    await wait(300)

    await page.locator('label:has-text("Duration") input').fill('45')
    await wait(300)

    await page.getByPlaceholder('Details, observations, follow-up needed...').type(
      'Shared with the Nguyen family. Mr. Nguyen asked many questions. Wife Lan very interested. Scheduled follow-up for Thursday.',
      { delay: 20 }
    )
    await wait(PAUSE)

    await page.getByRole('button', { name: 'Log Activity', exact: true }).click()
    await wait(LOOK)

    // Second chain prompt — Chain → Discipleship
    const chain2 = page.locator('button:has-text("Chain")')
    if (await chain2.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chain2.click()
      await wait(1500)

      await page.getByPlaceholder('What happened?').type('Discovery study — Nguyen home', { delay: TYPE })
      await wait(300)

      await page.locator('label:has-text("Participants") input').fill('5')
      await wait(300)

      await page.getByPlaceholder('Details, observations, follow-up needed...').type(
        'First discovery study at Nguyen home. 5 attended including 2 neighbors. Studied creation story. Strong interest.',
        { delay: 20 }
      )
      await wait(PAUSE)

      await page.getByRole('button', { name: 'Log Activity', exact: true }).click()
      await wait(PAUSE)

      // Click "Done" on chain prompt
      const doneBtn = page.locator('button:has-text("Done")')
      if (await doneBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await doneBtn.click()
        await wait(PAUSE)
      }
    }
  }

  // ─── 9. CALENDAR VIEW ──────────────────────────────────────────
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await wait(500)
  const calBtn = page.locator('button:has-text("Calendar")')
  if (await calBtn.isVisible().catch(() => false)) {
    await calBtn.click()
    await wait(LOOK)
  }

  // Back to feed
  await page.locator('button:has-text("Activity Feed")').click()
  await wait(PAUSE)

  // ─── 10. TEAM + INVITE ──────────────────────────────────────────
  await page.getByRole('link', { name: 'Organization' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // Show members
  await smoothScroll(page, 300); await wait(PAUSE)

  // Scroll to invite
  await smoothScroll(page, 400); await wait(PAUSE)

  const inviteHeading = page.getByText('Invite a New Member')
  if (await inviteHeading.isVisible({ timeout: 2000 }).catch(() => false)) {
    await inviteHeading.scrollIntoViewIfNeeded()
    await wait(1000)

    const roleSelect = page.locator('[data-component="protocol-info"]:has-text("Invite") select')
    if (await roleSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await roleSelect.selectOption('operator')
      await wait(1000)
      await page.getByRole('button', { name: 'Create Invitation' }).click()
      await wait(LOOK)
    }
  }

  // ─── 11. BACK TO DASHBOARD ──────────────────────────────────────
  await page.getByRole('link', { name: 'Home' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // Final dashboard view
  await smoothScroll(page, 300); await wait(PAUSE)
  await wait(3000)
})

function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function smoothScroll(page: Page, px: number) {
  await page.evaluate(async (px) => {
    const step = px > 0 ? 12 : -12
    for (let i = 0; i < Math.abs(Math.round(px / step)); i++) {
      window.scrollBy(0, step); await new Promise(r => setTimeout(r, 16))
    }
  }, px)
}
