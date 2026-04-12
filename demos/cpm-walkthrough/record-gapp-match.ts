/**
 * Full GAPP-Matching Demo — follows the exact video structure
 *
 * Section 1: Log first circle [~60s] — navigate to gen map, create with health metrics
 * Section 2: Gen Map exploration [~45s] — daughter circle, solid vs dashed, expand/collapse, views
 * Section 3: Manage Members & Permissions [~60s] — create detached contacts, switch user, show permissions
 * Section 4: Track Activities with Chaining [~90s] — pin circle, chain Entry→Gospel→Discipleship→Formation
 * Section 5: Data Visualization [~30s] — map view, table view, calendar, back to dashboard
 *
 * Total: ~5 minutes
 */

import { test, type Page } from '@playwright/test'

const BASE = 'http://localhost:3000'
const TYPE = 30
const PAUSE = 1500
const LOOK = 2500
const SECTION = 3000

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: 'on', size: { width: 1920, height: 1080 } },
  launchOptions: { slowMo: 10 },
})

test('GAPP-Matching Full Demo', async ({ page, context }) => {

  // ═══════════════════════════════════════════════════════════════════
  // INTRO — Login as Hub Lead (Linh)
  // ═══════════════════════════════════════════════════════════════════
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // Select Catalyst Network
  await page.getByText('Catalyst Network').click()
  await wait(PAUSE)

  // Login as Linh (Hub Lead)
  await page.locator('button', { hasText: 'Linh Nguyen' }).click()
  await page.waitForURL('**/dashboard**', { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Show dashboard briefly
  const org = page.locator('[data-component="org-selector"] select')
  if (await org.isVisible({ timeout: 3000 }).catch(() => false)) {
    await org.selectOption({ label: 'Mekong Catalyst Network' })
    await page.waitForLoadState('networkidle')
    await wait(LOOK)
  }

  // Scroll through dashboard analytics
  await smoothScroll(page, 400); await wait(PAUSE)
  await smoothScroll(page, 400); await wait(PAUSE)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await wait(PAUSE)

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: LOG FIRST CIRCLE [GAPP 00:30-05:06]
  // Navigate to Gen Map → Create a new established circle with health metrics
  // ═══════════════════════════════════════════════════════════════════
  await wait(SECTION)

  await page.getByRole('link', { name: 'Gen Map' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Show existing gen map metrics
  await wait(LOOK)

  // Click + New Root to create a circle
  await page.getByRole('button', { name: '+ New Root' }).click()
  await wait(1500)

  // Fill: Name
  await page.locator('input[placeholder="Circle name"]').type('Linh Home Circle', { delay: TYPE })
  await wait(300)

  // Leader
  await page.locator('input[placeholder="Leader name"]').type('Linh Nguyen', { delay: TYPE })
  await wait(300)

  // Location
  await page.locator('input[placeholder="City or area"]').type('Da Nang Central', { delay: TYPE })
  await wait(500)

  // Is it established? → Yes (solid circle)
  await page.locator('label:has-text("Is it established") select').selectOption('yes')
  await wait(500)

  // Meeting frequency → multiple times/week
  await page.locator('label:has-text("Meeting Frequency") select').selectOption('multiple')
  await wait(300)

  // People group
  await page.locator('input[placeholder="e.g. Vietnamese"]').type('Vietnamese Kinh', { delay: TYPE })
  await wait(500)

  // Health markers — attenders, believers, baptized
  const att = page.locator('label:has-text("Attenders") input')
  if (await att.isVisible().catch(() => false)) {
    await att.fill('5'); await wait(200)
    await page.locator('label:has-text("Believers") input').last().fill('3'); await wait(200)
    await page.locator('label:has-text("Baptized") input').last().fill('2'); await wait(200)
    await page.locator('label:has-text("Leaders") input').last().fill('0'); await wait(200)
  }

  // Self-functioning markers — some yes, some no (like GAPP video)
  const bapSelf = page.locator('label:has-text("Baptism (self)") input')
  if (await bapSelf.isVisible().catch(() => false)) {
    // Baptism: NO (external leader does it — will show outside circle)
    // Teaching: YES
    await page.locator('label:has-text("Teaching (self)") input').check(); await wait(200)
    // Giving: NO
  }

  // Show the circle preview
  await wait(LOOK)

  // Submit
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: GEN MAP — Daughter circle + views [GAPP 05:06-10:05]
  // ═══════════════════════════════════════════════════════════════════
  await wait(SECTION)

  // Scroll to see the new circle in the tree
  await smoothScroll(page, 500); await wait(LOOK)

  // Add a daughter circle (group, NOT established — dashed line)
  const childBtn = page.locator('button:has-text("+Child")').last()
  if (await childBtn.isVisible().catch(() => false)) {
    await childBtn.click()
    await wait(1500)

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await wait(500)

    await page.locator('input[placeholder="Circle name"]').type('Thanh Khe Study Group', { delay: TYPE })
    await wait(300)
    await page.locator('input[placeholder="Leader name"]').type('Tran Minh', { delay: TYPE })
    await wait(300)
    await page.locator('input[placeholder="City or area"]').type('Thanh Khe', { delay: TYPE })
    await wait(300)

    // NOT established — leave as "No" (dashed circle)
    // Add some basic numbers
    const att2 = page.locator('label:has-text("Attenders") input')
    if (await att2.isVisible().catch(() => false)) {
      await att2.fill('3'); await wait(200)
      await page.locator('label:has-text("Believers") input').last().fill('1'); await wait(200)
    }

    // Show dashed circle preview
    await wait(LOOK)

    await page.getByRole('button', { name: 'Create' }).click()
    await page.waitForLoadState('networkidle')
    await wait(LOOK)
  }

  // Scroll to show both circles — solid parent, dashed daughter
  await smoothScroll(page, 500); await wait(LOOK)

  // Expand/Collapse All
  const collapseBtn = page.locator('button:has-text("Collapse All")')
  if (await collapseBtn.isVisible().catch(() => false)) {
    await collapseBtn.click(); await wait(LOOK)
    await page.locator('button:has-text("Expand All")').click(); await wait(LOOK)
  }

  // Switch to Map View
  const mapViewBtn = page.locator('button:has-text("Map View")')
  if (await mapViewBtn.isVisible().catch(() => false)) {
    await mapViewBtn.click(); await wait(LOOK)

    // Switch to Table View
    await page.locator('button:has-text("Table View")').click()
    await wait(LOOK)

    // Scroll table
    await smoothScroll(page, 200); await wait(PAUSE)

    // Back to Gen Map
    await page.locator('button:has-text("Gen Map")').first().click()
    await wait(PAUSE)
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: MANAGE MEMBERS & PERMISSIONS [GAPP 10:42-17:59]
  // Create detached members, switch to another user, show permissions
  // ═══════════════════════════════════════════════════════════════════
  await wait(SECTION)

  // Navigate to Members
  await page.getByRole('link', { name: 'Members' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // Show existing team members
  await smoothScroll(page, 300); await wait(PAUSE)

  // Create detached contacts (like GAPP creates Joel, Britain, Talbot)
  const addContactBtn = page.getByRole('button', { name: '+ Add Contact' })
  if (await addContactBtn.isVisible().catch(() => false)) {
    // Contact 1: Lan
    await addContactBtn.click(); await wait(1000)
    await page.locator('input[placeholder="Contact name"]').type('Lan Nguyen', { delay: TYPE }); await wait(200)
    await page.locator('input[placeholder="e.g. New believer, Seeker"]').type('New believer', { delay: TYPE }); await wait(200)
    // Assign to a circle
    const circleSelect = page.locator('label:has-text("Assigned Circle") select')
    const opts = await circleSelect.locator('option').allTextContents()
    if (opts.length > 1) { await circleSelect.selectOption({ index: 1 }); await wait(200) }
    await page.locator('textarea[placeholder*="Progress notes"]').type('Met at outreach walk. Very interested. Husband also open.', { delay: 20 })
    await wait(500)
    await page.getByRole('button', { name: 'Add Contact' }).click()
    await page.waitForLoadState('networkidle')
    await wait(PAUSE)

    // Contact 2: Bao
    await addContactBtn.click(); await wait(1000)
    await page.locator('input[placeholder="Contact name"]').type('Bao Tran', { delay: TYPE }); await wait(200)
    await page.locator('input[placeholder="e.g. New believer, Seeker"]').type('Seeker — early interest', { delay: TYPE }); await wait(200)
    await page.getByRole('button', { name: 'Add Contact' }).click()
    await page.waitForLoadState('networkidle')
    await wait(PAUSE)

    // Contact 3: Minh
    await addContactBtn.click(); await wait(1000)
    await page.locator('input[placeholder="Contact name"]').type('Minh Phan', { delay: TYPE }); await wait(200)
    await page.locator('input[placeholder="e.g. New believer, Seeker"]').type('Community leader — gateway to neighborhood', { delay: TYPE }); await wait(200)
    await page.getByRole('button', { name: 'Add Contact' }).click()
    await page.waitForLoadState('networkidle')
    await wait(LOOK)
  }

  // Show permissions reference
  await smoothScroll(page, 500); await wait(LOOK)

  // ─── SWITCH USER — show different permissions ────────────────────
  // Go back to login as a different user (Tran Minh — Facilitator, limited view)
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  await page.getByText('Catalyst Network').click()
  await wait(PAUSE)

  // Login as Tran Minh (Facilitator — limited permissions)
  await page.locator('button', { hasText: 'Tran Minh' }).click()
  await page.waitForURL('**/dashboard**', { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  // Show Tran's view — he sees Da Nang Hub with "operator" role
  await wait(PAUSE)

  // Navigate to Gen Map — show what a facilitator can see
  await page.getByRole('link', { name: 'Gen Map' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  await smoothScroll(page, 400); await wait(PAUSE)

  // ─── Switch back to Linh ─────────────────────────────────────────
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await wait(1000)

  await page.getByText('Catalyst Network').click()
  await wait(1000)

  await page.locator('button', { hasText: 'Linh Nguyen' }).click()
  await page.waitForURL('**/dashboard**', { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Switch to Da Nang Hub
  if (await org.isVisible({ timeout: 3000 }).catch(() => false)) {
    await org.selectOption({ label: 'Da Nang Hub' })
    await page.waitForLoadState('networkidle')
    await wait(PAUSE)
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4: TRACK ACTIVITIES WITH CHAINING [GAPP 17:59-25:44]
  // Pin a circle, then chain: Entry → Gospel → Discipleship → Formation
  // ═══════════════════════════════════════════════════════════════════
  await wait(SECTION)

  // Go to Gen Map first to pin a circle
  await page.getByRole('link', { name: 'Gen Map' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Pin the first visible circle
  await smoothScroll(page, 400); await wait(1000)
  const pinBtn = page.locator('button:has-text("Pin")').first()
  if (await pinBtn.isVisible().catch(() => false)) {
    await pinBtn.click(); await wait(LOOK)
  }

  // Now go to Activities
  await page.getByRole('link', { name: 'Activities' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // ─── Chain 1: Entry (Outreach / Prayer Walk) ─────────────────────
  await page.getByRole('button', { name: /Log Activity/i }).click()
  await wait(1000)

  await page.locator('label:has-text("Type") select').selectOption('outreach')
  await wait(300)
  await page.locator('label:has-text("Participants") input').fill('6')
  await wait(200)
  await page.getByPlaceholder('What happened?').type('Outreach walk — Thanh Khe ward', { delay: TYPE })
  await wait(200)
  await page.getByPlaceholder('Neighborhood').type('Thanh Khe, Da Nang', { delay: TYPE })
  await wait(200)
  await page.locator('label:has-text("Duration") input').fill('60')
  await wait(200)
  await page.getByPlaceholder('Details, observations, follow-up needed...').type(
    'Walked through Thanh Khe. Met 6 families. The Nguyen and Tran families very receptive.',
    { delay: 20 }
  )
  await wait(PAUSE)
  await page.getByRole('button', { name: 'Log Activity', exact: true }).click()
  await wait(LOOK)

  // ─── Chain 2: Evangelism (Gospel Conversation) ───────────────────
  const chain1 = page.locator('button:has-text("Chain")')
  if (await chain1.isVisible({ timeout: 3000 }).catch(() => false)) {
    await chain1.click(); await wait(1500)

    await page.getByPlaceholder('What happened?').type('Gospel conversation — Nguyen family', { delay: TYPE })
    await wait(200)
    await page.locator('label:has-text("Participants") input').fill('4')
    await wait(200)
    await page.getByPlaceholder('Neighborhood').type('Thanh Khe, Da Nang', { delay: TYPE })
    await wait(200)
    await page.locator('label:has-text("Duration") input').fill('45')
    await wait(200)
    await page.getByPlaceholder('Details, observations, follow-up needed...').type(
      'Shared with the Nguyen family. Mr. Nguyen asked deep questions. Wife Lan wants to learn more.',
      { delay: 20 }
    )
    await wait(PAUSE)
    await page.getByRole('button', { name: 'Log Activity', exact: true }).click()
    await wait(LOOK)

    // ─── Chain 3: Discipleship (Study / Baptism) ───────────────────
    const chain2 = page.locator('button:has-text("Chain")')
    if (await chain2.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chain2.click(); await wait(1500)

      await page.getByPlaceholder('What happened?').type('Discovery study — Nguyen home', { delay: TYPE })
      await wait(200)
      await page.locator('label:has-text("Participants") input').fill('7')
      await wait(200)
      await page.getByPlaceholder('Details, observations, follow-up needed...').type(
        'First study at Nguyen home. 7 attended including 3 neighbors. Covered creation narrative. Lan wants baptism.',
        { delay: 20 }
      )
      await wait(PAUSE)
      await page.getByRole('button', { name: 'Log Activity', exact: true }).click()
      await wait(LOOK)

      // ─── Chain 4: Formation (New Group) ──────────────────────────
      const chain3 = page.locator('button:has-text("Chain")')
      if (await chain3.isVisible({ timeout: 3000 }).catch(() => false)) {
        await chain3.click(); await wait(1500)

        await page.getByPlaceholder('What happened?').type('New group formed — Nguyen study circle', { delay: TYPE })
        await wait(200)
        await page.locator('label:has-text("Participants") input').fill('5')
        await wait(200)
        await page.getByPlaceholder('Details, observations, follow-up needed...').type(
          'Nguyen home group is now meeting weekly. 5 regular participants. Lan emerging as co-facilitator.',
          { delay: 20 }
        )
        await wait(PAUSE)
        await page.getByRole('button', { name: 'Log Activity', exact: true }).click()
        await wait(PAUSE)

        // Done with chaining
        const doneBtn = page.locator('button:has-text("Done")')
        if (await doneBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await doneBtn.click(); await wait(PAUSE)
        }
      }
    }
  }

  // Show the full activity feed with the chained sequence
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await wait(500)
  await smoothScroll(page, 300); await wait(LOOK)

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 5: DATA VISUALIZATION [GAPP 25:44-27:06]
  // Calendar, Map View, Table View, back to dashboard
  // ═══════════════════════════════════════════════════════════════════
  await wait(SECTION)

  // Calendar view
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await wait(500)
  const calBtn = page.locator('button:has-text("Calendar")')
  if (await calBtn.isVisible().catch(() => false)) {
    await calBtn.click(); await wait(LOOK)
  }

  // Back to feed
  await page.locator('button:has-text("Activity Feed")').click()
  await wait(PAUSE)

  // Go to Gen Map for map view
  if (await org.isVisible({ timeout: 2000 }).catch(() => false)) {
    await org.selectOption({ label: 'Mekong Catalyst Network' })
    await page.waitForLoadState('networkidle')
    await wait(1000)
  }

  await page.getByRole('link', { name: 'Gen Map' }).click()
  await page.waitForLoadState('networkidle')
  await wait(PAUSE)

  // Map View
  const mapBtn = page.locator('button:has-text("Map View")')
  if (await mapBtn.isVisible().catch(() => false)) {
    await mapBtn.click(); await wait(LOOK)
  }

  // Table View
  await page.locator('button:has-text("Table View")').click()
  await wait(LOOK)

  // Back to Gen Map tree
  await page.locator('button:has-text("Gen Map")').first().click()
  await wait(PAUSE)

  // Final scroll through the complete tree
  await smoothScroll(page, 400); await wait(PAUSE)
  await smoothScroll(page, 400); await wait(PAUSE)
  await smoothScroll(page, 300); await wait(PAUSE)

  // Back to dashboard for closing
  await page.getByRole('link', { name: 'Home' }).click()
  await page.waitForLoadState('networkidle')
  await wait(LOOK)

  await smoothScroll(page, 300); await wait(PAUSE)
  await wait(SECTION) // Hold for closing
})

function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function smoothScroll(page: Page, px: number) {
  await page.evaluate(async (px) => {
    const step = px > 0 ? 10 : -10
    for (let i = 0; i < Math.abs(Math.round(px / step)); i++) {
      window.scrollBy(0, step); await new Promise(r => setTimeout(r, 16))
    }
  }, px)
}
