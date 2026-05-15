# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: grant-flow-full-ui-demo.spec.ts >> Full UI grant lifecycle — Maria → David → Sarah → Maria
- Location: tests/e2e/grant-flow-full-ui-demo.spec.ts:320:5

# Error details

```
Error: Fort Collins Treasury should grow by exactly $30k — got 0

expect(received).toBe(expected) // Object.is equality

Expected: 30000000000n
Received: 0n
```

# Test source

```ts
  580 |   await castVote(page, 'Approve', 'Confident in delivery.')
  581 |   await pause(SETTLE + 400)
  582 | 
  583 |   // ── Chapter 12: Maria finalises the round ───────────────────────────
  584 |   await uiLogin(page, 'cat-user-001')
  585 |   await page.goto(`${roundDetailUrl}/admin`, { waitUntil: 'networkidle' })
  586 |   await setBanner(page, 12, TOTAL_CHAPTERS,
  587 |     'Maria finalises the round — announces award + commits',
  588 |     'Single click triggers setRoundStatus(decided) + announceAward + CommitmentRegistry.commit.',
  589 |     "Maria finalises the round with a single click. Behind the scenes the contract sets the round status to decided, announces the award, and creates a Commitment record with two milestones — the on-chain promise of payment-on-delivery.",
  590 |   )
  591 |   await pause(READ)
  592 |   {
  593 |     // Switch to Lifecycle tab.
  594 |     const lifecycleTab = page.getByRole('button', { name: /lifecycle/i })
  595 |     if (await lifecycleTab.count() > 0) {
  596 |       await lifecycleTab.first().click()
  597 |       await pause(500)
  598 |     }
  599 |     // If the round is still in `open`, advance to `review` first so the
  600 |     // Finalize button is visible.
  601 |     const toReviewBtn = page.getByRole('button', { name: /Close submissions, open voting/i })
  602 |     if (await toReviewBtn.count() > 0) {
  603 |       await toReviewBtn.first().click()
  604 |       await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  605 |       await pause(900)
  606 |     }
  607 |     // Finalize awards.
  608 |     const finalizeBtn = page.getByRole('button', { name: /Finalize awards from tally/i })
  609 |     await finalizeBtn.first().hover()
  610 |     await pause(500)
  611 |     await finalizeBtn.first().click()
  612 |     await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  613 |   }
  614 |   await pause(SETTLE + 800)
  615 | 
  616 |   // ── Chapter 13: Sarah attests both milestones ───────────────────────
  617 |   await uiLogin(page, 'cat-user-005')
  618 |   await page.goto(`${BASE}/h/${bs.hubSlug}/tasks`, { waitUntil: 'networkidle' })
  619 |   await setBanner(page, 13, TOTAL_CHAPTERS,
  620 |     'Sarah (validator) attests both milestones',
  621 |     'Validator gate is off-chain (AnonCreds in production); on-chain attestation is what unlocks each tranche.',
  622 |     "Sarah, the validator, sees both milestones in her inbox. She attests kickoff first — typing an evidence summary; only the hash goes on-chain. Then she attests the final report. Each attestation is what unlocks the matching tranche.",
  623 |   )
  624 |   await pause(READ)
  625 |   await attestMilestones(page, 2)
  626 |   await pause(SETTLE + 400)
  627 | 
  628 |   // ── Chapter 14: Maria releases both tranches ────────────────────────
  629 |   await uiLogin(page, 'cat-user-001')
  630 |   await page.goto(`${BASE}/h/${bs.hubSlug}/tasks`, { waitUntil: 'networkidle' })
  631 |   await setBanner(page, 14, TOTAL_CHAPTERS,
  632 |     'Maria (steward) releases both tranches',
  633 |     'Each release is an executeBatch on the pool: USDC transfer + CommitmentRegistry.recordRelease.',
  634 |     "Now back to Maria. Her steward inbox shows two attested milestones ready for release. She approves the first tranche — twelve thousand dollars — then the second — eighteen thousand. Each release is an executeBatch: USDC transfer plus on-chain release record.",
  635 |   )
  636 |   await pause(READ)
  637 |   await releaseTranches(page, 2)
  638 |   await pause(SETTLE + 400)
  639 | 
  640 |   // ── Chapter 15: Outcome — Fort Collins Treasury showing the money ──
  641 |   await page.goto(`${BASE}/agents/${bs.fortCollins}`, { waitUntil: 'networkidle' })
  642 |   const balanceAfter = await readUsdcBalance(recipientTreasury)
  643 |   const delta = balanceAfter - balanceBefore
  644 |   const before$ = (Number(balanceBefore) / 1_000_000).toLocaleString()
  645 |   const after$  = (Number(balanceAfter)  / 1_000_000).toLocaleString()
  646 |   const delta$  = (Number(delta)         / 1_000_000).toLocaleString()
  647 |   await setBanner(page, 15, TOTAL_CHAPTERS,
  648 |     `+$${delta$} settled into Fort Collins Network Treasury`,
  649 |     `Treasury balance: $${before$} → $${after$}  ·  Smart account → sa:hasTreasury → on-chain USDC`,
  650 |     `And there's the outcome. Fort Collins Treasury balance grew by exactly thirty thousand dollars — the full grant, delivered on-chain. The Commitment is now marked Completed. End of demo.`,
  651 |   )
  652 |   await pause(7000)
  653 |   await hideBanner(page)
  654 |   await pause(400)
  655 | 
  656 |   // Capture the video handle BEFORE close so we can rename it to the
  657 |   // canonical path scripts/narrate-demo.ts expects.
  658 |   const recording = page.video()
  659 |   await ctx.close()
  660 |   if (recording) {
  661 |     const dest = path.resolve(__dirname, 'demo-output/smart-agent-grant-lifecycle-demo.webm')
  662 |     if (fs.existsSync(dest)) fs.unlinkSync(dest)
  663 |     await recording.saveAs(dest)
  664 |     await recording.delete().catch(() => {})
  665 |     console.log(`[full-demo] saved recording → ${dest}`)
  666 |   }
  667 | 
  668 |   // Persist the narration timeline so scripts/narrate-demo.ts can mux
  669 |   // per-chapter audio onto the recorded video.
  670 |   try {
  671 |     const timelinePath = path.resolve(__dirname, 'demo-output/chapter-timeline.json')
  672 |     fs.writeFileSync(timelinePath, JSON.stringify(chapterTimeline, null, 2))
  673 |     console.log(`[full-demo] Narration timeline: ${timelinePath} (${chapterTimeline.length} chapters)`)
  674 |   } catch (e) {
  675 |     console.warn('[full-demo] could not write chapter-timeline.json:', (e as Error).message)
  676 |   }
  677 | 
  678 |   // ── Correctness assertion ──────────────────────────────────────────
  679 |   const THIRTY_K = 30_000n * 10n ** 6n
> 680 |   expect(delta, `Fort Collins Treasury should grow by exactly $30k — got ${delta.toString()}`).toBe(THIRTY_K)
      |                                                                                                ^ Error: Fort Collins Treasury should grow by exactly $30k — got 0
  681 |   console.log(`[full-demo] Fort Collins Treasury after: $${after$}  (Δ +$${delta$})`)
  682 | })
  683 | 
  684 | // ─── Form fillers ──────────────────────────────────────────────────────
  685 | 
  686 | async function fillPoolForm(page: Page, p: { displayName: string; slug: string }): Promise<void> {
  687 |   // Display name + slug. Other fields keep their defaults (Catalyst is
  688 |   // the only operating org Maria has authority on, so the org select
  689 |   // auto-resolves).
  690 |   await page.getByLabel(/Display name/i).first().fill(p.displayName)
  691 |   // Slug field — clear any auto-fill, then enter ours.
  692 |   const slug = page.getByLabel(/Slug/i).first()
  693 |   await slug.fill('')
  694 |   await slug.fill(p.slug)
  695 |   // Visibility = public (the pool needs to be discoverable by David).
  696 |   const vis = page.getByLabel(/Visibility/i).first()
  697 |   if (await vis.count() > 0) await vis.selectOption('public').catch(() => {})
  698 | }
  699 | 
  700 | async function fillPledgeForm(page: Page, dollars: string): Promise<void> {
  701 |   // The amount input lives near placeholder "100".
  702 |   const amount = page.getByPlaceholder(/^100$/).first()
  703 |     .or(page.locator('input[type="number"]').first())
  704 |   await amount.fill(dollars)
  705 | }
  706 | 
  707 | async function fillRoundForm(page: Page, r: {
  708 |   poolName: string
  709 |   poolUrn: string
  710 |   displayName: string
  711 |   slug: string
  712 |   validatorEoa: Address
  713 | }): Promise<void> {
  714 |   // Pool select — pick by value (URN). The dropdown's option text is the
  715 |   // pool *slug*, not the display name, so selectOption({label:displayName})
  716 |   // would silently hang (playwright's default actionTimeout is infinity).
  717 |   // We always have the URN in hand, so just select by value with a finite
  718 |   // timeout and fall back to the most recently added option on mismatch.
  719 |   const poolSel = page.locator('select').first()
  720 |   if (await poolSel.count() > 0) {
  721 |     try {
  722 |       await poolSel.selectOption({ value: r.poolUrn }, { timeout: 5_000 })
  723 |     } catch {
  724 |       // Fallback: count options and pick the last one (Maria's newest pool).
  725 |       const optCount = await poolSel.locator('option').count()
  726 |       if (optCount > 0) {
  727 |         await poolSel.selectOption({ index: optCount - 1 }, { timeout: 5_000 }).catch(() => {})
  728 |       }
  729 |     }
  730 |   }
  731 |   // Round slug + display name — use direct input[placeholder=...] when
  732 |   // available since the wrapping <label><div>text</div><input/></label>
  733 |   // pattern can confuse getByLabel.
  734 |   const slugInput = page.locator('input[placeholder*="trauma-care-q3"]').first()
  735 |   if (await slugInput.count() > 0) {
  736 |     await slugInput.fill(r.slug)
  737 |   } else {
  738 |     await page.getByLabel(/Round slug/i).first().fill(r.slug, { timeout: 5_000 })
  739 |   }
  740 |   const dispInput = page.locator('input[placeholder*="Trauma-Care"]').first()
  741 |   if (await dispInput.count() > 0) {
  742 |     await dispInput.fill(r.displayName)
  743 |   } else {
  744 |     await page.getByLabel(/Display name/i).first().fill(r.displayName, { timeout: 5_000 })
  745 |   }
  746 |   // Accepted kinds — REQUIRED by the form. Maria-created pools have an
  747 |   // empty acceptedKinds list, so pickPool leaves this field empty and
  748 |   // HTML5 required validation silently blocks the submit. Fill it.
  749 |   const kindsInput = page.locator('input[placeholder*="CompassionMinistry"]').first()
  750 |   if (await kindsInput.count() > 0) {
  751 |     const cur = await kindsInput.inputValue()
  752 |     if (!cur.trim()) await kindsInput.fill('trauma-care, CompassionMinistry')
  753 |   }
  754 |   // Submission deadline stays at the form default (14 days out) so the
  755 |   // apply page's deadline-passed gate doesn't block David. The test
  756 |   // performs an explicit "Close submissions, open voting" admin action
  757 |   // between chapter 9 and chapter 10 to advance the round into the
  758 |   // voting-open state.
  759 |   // Validator list — find an input that accepts validator addresses if
  760 |   // present; else skip (round will default to no validators, which means
  761 |   // any pool steward can attest as a fallback).
  762 |   const validators = page.getByLabel(/[Vv]alidator/).first()
  763 |   if (await validators.count() > 0) {
  764 |     try { await validators.fill(r.validatorEoa) } catch { /* not a text input */ }
  765 |   }
  766 | }
  767 | 
  768 | async function fillIntentForm(page: Page, title: string): Promise<void> {
  769 |   // Step 1 — direction. The button's accessible name leads with the 📥
  770 |   // emoji ("📥 Receive I need / I'm asking for…"), so anchoring the regex
  771 |   // with `^Receive` doesn't match. Drop the anchor.
  772 |   const receive = page.getByRole('button', { name: /Receive/i }).first()
  773 |   await receive.click()
  774 |   await page.waitForTimeout(400)
  775 |   // Step 2 — pick an intent type that's a money-receive ("Need funding").
  776 |   const moneyTile = page.getByRole('button', { name: /Need funding|Money/i }).first()
  777 |   if (await moneyTile.count() > 0) {
  778 |     await moneyTile.click().catch(() => {})
  779 |   }
  780 |   await page.waitForTimeout(400)
```