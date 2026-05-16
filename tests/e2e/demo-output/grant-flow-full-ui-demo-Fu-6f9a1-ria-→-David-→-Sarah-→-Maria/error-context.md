# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: grant-flow-full-ui-demo.spec.ts >> Full UI grant lifecycle — Maria → David → Sarah → Maria
- Location: tests/e2e/grant-flow-full-ui-demo.spec.ts:375:5

# Error details

```
Error: Fort Collins Treasury should grow by exactly $30k — got 0

expect(received).toBe(expected) // Object.is equality

Expected: 30000000000n
Received: 0n
```

# Test source

```ts
  648 |   await pause(SETTLE + 400)
  649 | 
  650 |   // ── Chapter 12: Maria finalises the round ───────────────────────────
  651 |   await uiLogin(page, 'cat-user-001')
  652 |   await page.goto(`${roundDetailUrl}/admin`, { waitUntil: 'networkidle' })
  653 |   await setBanner(page, 12, TOTAL_CHAPTERS,
  654 |     'Maria finalises the round — announces award + commits',
  655 |     'Single click triggers setRoundStatus(decided) + announceAward + CommitmentRegistry.commit.',
  656 |     "Maria finalises the round with a single click. Behind the scenes the contract sets the round status to decided, announces the award, and creates a Commitment record with two milestones — the on-chain promise of payment-on-delivery.",
  657 |   )
  658 |   await pause(READ)
  659 |   {
  660 |     // Switch to Lifecycle tab.
  661 |     const lifecycleTab = page.getByRole('button', { name: /lifecycle/i })
  662 |     if (await lifecycleTab.count() > 0) {
  663 |       await lifecycleTab.first().click()
  664 |       await pause(500)
  665 |     }
  666 |     // If the round is still in `open`, advance to `review` first so the
  667 |     // Finalize button is visible.
  668 |     const toReviewBtn = page.getByRole('button', { name: /Close submissions, open voting/i })
  669 |     if (await toReviewBtn.count() > 0) {
  670 |       await toReviewBtn.first().click()
  671 |       await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  672 |       await pause(900)
  673 |     }
  674 |     // Finalize awards.
  675 |     const finalizeBtn = page.getByRole('button', { name: /Finalize awards from tally/i })
  676 |     await finalizeBtn.first().hover()
  677 |     await pause(500)
  678 |     await finalizeBtn.first().click()
  679 |     await confirmModalIfPresent(page)
  680 |     await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  681 |   }
  682 |   await pause(SETTLE + 800)
  683 | 
  684 |   // ── Chapter 13: Sarah attests both milestones ───────────────────────
  685 |   await uiLogin(page, 'cat-user-005')
  686 |   await page.goto(`${BASE}/h/${bs.hubSlug}/tasks`, { waitUntil: 'networkidle' })
  687 |   await setBanner(page, 13, TOTAL_CHAPTERS,
  688 |     'Sarah (validator) attests both milestones',
  689 |     'Validator gate is off-chain (AnonCreds in production); on-chain attestation is what unlocks each tranche.',
  690 |     "Sarah, the validator, sees both milestones in her inbox. She attests kickoff first — typing an evidence summary; only the hash goes on-chain. Then she attests the final report. Each attestation is what unlocks the matching tranche.",
  691 |   )
  692 |   await pause(READ)
  693 |   await attestMilestones(page, 2)
  694 |   await pause(SETTLE + 400)
  695 | 
  696 |   // ── Chapter 14: Maria releases both tranches ────────────────────────
  697 |   await uiLogin(page, 'cat-user-001')
  698 |   await page.goto(`${BASE}/h/${bs.hubSlug}/tasks`, { waitUntil: 'networkidle' })
  699 |   await setBanner(page, 14, TOTAL_CHAPTERS,
  700 |     'Maria (steward) releases both tranches',
  701 |     'Each release is an executeBatch on the pool: USDC transfer + CommitmentRegistry.recordRelease.',
  702 |     "Now back to Maria. Her steward inbox shows two attested milestones ready for release. She approves the first tranche — twelve thousand dollars — then the second — eighteen thousand. Each release is an executeBatch: USDC transfer plus on-chain release record.",
  703 |   )
  704 |   await pause(READ)
  705 |   await releaseTranches(page, 2)
  706 |   await pause(SETTLE + 400)
  707 | 
  708 |   // ── Chapter 15: Outcome — Fort Collins Treasury showing the money ──
  709 |   await page.goto(`${BASE}/agents/${bs.fortCollins}`, { waitUntil: 'networkidle' })
  710 |   const balanceAfter = await readUsdcBalance(recipientTreasury)
  711 |   const delta = balanceAfter - balanceBefore
  712 |   const before$ = (Number(balanceBefore) / 1_000_000).toLocaleString()
  713 |   const after$  = (Number(balanceAfter)  / 1_000_000).toLocaleString()
  714 |   const delta$  = (Number(delta)         / 1_000_000).toLocaleString()
  715 |   await setBanner(page, 15, TOTAL_CHAPTERS,
  716 |     `+$${delta$} settled into Fort Collins Network Treasury`,
  717 |     `Treasury balance: $${before$} → $${after$}  ·  Smart account → sa:hasTreasury → on-chain USDC`,
  718 |     `And there's the outcome. Fort Collins Treasury balance grew by exactly thirty thousand dollars — the full grant, delivered on-chain. The Commitment is now marked Completed. End of demo.`,
  719 |   )
  720 |   await pause(7000)
  721 |   await hideBanner(page)
  722 |   await pause(400)
  723 | 
  724 |   // Capture the video handle BEFORE close so we can rename it to the
  725 |   // canonical path scripts/narrate-demo.ts expects.
  726 |   const recording = page.video()
  727 |   await ctx.close()
  728 |   if (recording) {
  729 |     const dest = path.resolve(__dirname, 'demo-output/smart-agent-grant-lifecycle-demo.webm')
  730 |     if (fs.existsSync(dest)) fs.unlinkSync(dest)
  731 |     await recording.saveAs(dest)
  732 |     await recording.delete().catch(() => {})
  733 |     console.log(`[full-demo] saved recording → ${dest}`)
  734 |   }
  735 | 
  736 |   // Persist the narration timeline so scripts/narrate-demo.ts can mux
  737 |   // per-chapter audio onto the recorded video.
  738 |   try {
  739 |     const timelinePath = path.resolve(__dirname, 'demo-output/chapter-timeline.json')
  740 |     fs.writeFileSync(timelinePath, JSON.stringify(chapterTimeline, null, 2))
  741 |     console.log(`[full-demo] Narration timeline: ${timelinePath} (${chapterTimeline.length} chapters)`)
  742 |   } catch (e) {
  743 |     console.warn('[full-demo] could not write chapter-timeline.json:', (e as Error).message)
  744 |   }
  745 | 
  746 |   // ── Correctness assertion ──────────────────────────────────────────
  747 |   const THIRTY_K = 30_000n * 10n ** 6n
> 748 |   expect(delta, `Fort Collins Treasury should grow by exactly $30k — got ${delta.toString()}`).toBe(THIRTY_K)
      |                                                                                                ^ Error: Fort Collins Treasury should grow by exactly $30k — got 0
  749 |   console.log(`[full-demo] Fort Collins Treasury after: $${after$}  (Δ +$${delta$})`)
  750 | })
  751 | 
  752 | // ─── Form fillers ──────────────────────────────────────────────────────
  753 | 
  754 | async function fillPoolForm(page: Page, p: { displayName: string; slug: string }): Promise<void> {
  755 |   // Display name + slug. Other fields keep their defaults (Catalyst is
  756 |   // the only operating org Maria has authority on, so the org select
  757 |   // auto-resolves).
  758 |   await page.getByLabel(/Display name/i).first().fill(p.displayName)
  759 |   // Slug field — clear any auto-fill, then enter ours.
  760 |   const slug = page.getByLabel(/Slug/i).first()
  761 |   await slug.fill('')
  762 |   await slug.fill(p.slug)
  763 |   // Visibility = public (the pool needs to be discoverable by David).
  764 |   const vis = page.getByLabel(/Visibility/i).first()
  765 |   if (await vis.count() > 0) await vis.selectOption('public').catch(() => {})
  766 | }
  767 | 
  768 | async function fillPledgeForm(page: Page, dollars: string): Promise<void> {
  769 |   // The amount input lives near placeholder "100".
  770 |   const amount = page.getByPlaceholder(/^100$/).first()
  771 |     .or(page.locator('input[type="number"]').first())
  772 |   await amount.fill(dollars)
  773 | }
  774 | 
  775 | async function fillRoundForm(page: Page, r: {
  776 |   poolName: string
  777 |   poolUrn: string
  778 |   displayName: string
  779 |   slug: string
  780 |   validatorEoa: Address
  781 | }): Promise<void> {
  782 |   // Pool select — pick by value (URN). The dropdown's option text is the
  783 |   // pool *slug*, not the display name, so selectOption({label:displayName})
  784 |   // would silently hang (playwright's default actionTimeout is infinity).
  785 |   // We always have the URN in hand, so just select by value with a finite
  786 |   // timeout and fall back to the most recently added option on mismatch.
  787 |   const poolSel = page.locator('select').first()
  788 |   if (await poolSel.count() > 0) {
  789 |     try {
  790 |       await poolSel.selectOption({ value: r.poolUrn }, { timeout: 5_000 })
  791 |     } catch {
  792 |       // Fallback: count options and pick the last one (Maria's newest pool).
  793 |       const optCount = await poolSel.locator('option').count()
  794 |       if (optCount > 0) {
  795 |         await poolSel.selectOption({ index: optCount - 1 }, { timeout: 5_000 }).catch(() => {})
  796 |       }
  797 |     }
  798 |   }
  799 |   // Round slug + display name — use direct input[placeholder=...] when
  800 |   // available since the wrapping <label><div>text</div><input/></label>
  801 |   // pattern can confuse getByLabel.
  802 |   const slugInput = page.locator('input[placeholder*="trauma-care-q3"]').first()
  803 |   if (await slugInput.count() > 0) {
  804 |     await slugInput.fill(r.slug)
  805 |   } else {
  806 |     await page.getByLabel(/Round slug/i).first().fill(r.slug, { timeout: 5_000 })
  807 |   }
  808 |   const dispInput = page.locator('input[placeholder*="Trauma-Care"]').first()
  809 |   if (await dispInput.count() > 0) {
  810 |     await dispInput.fill(r.displayName)
  811 |   } else {
  812 |     await page.getByLabel(/Display name/i).first().fill(r.displayName, { timeout: 5_000 })
  813 |   }
  814 |   // Accepted kinds — REQUIRED by the form. Maria-created pools have an
  815 |   // empty acceptedKinds list, so pickPool leaves this field empty and
  816 |   // HTML5 required validation silently blocks the submit. Fill it.
  817 |   const kindsInput = page.locator('input[placeholder*="CompassionMinistry"]').first()
  818 |   if (await kindsInput.count() > 0) {
  819 |     const cur = await kindsInput.inputValue()
  820 |     if (!cur.trim()) await kindsInput.fill('trauma-care, CompassionMinistry')
  821 |   }
  822 |   // Submission deadline stays at the form default (14 days out) so the
  823 |   // apply page's deadline-passed gate doesn't block David. The test
  824 |   // performs an explicit "Close submissions, open voting" admin action
  825 |   // between chapter 9 and chapter 10 to advance the round into the
  826 |   // voting-open state.
  827 |   // Validator list — find an input that accepts validator addresses if
  828 |   // present; else skip (round will default to no validators, which means
  829 |   // any pool steward can attest as a fallback).
  830 |   const validators = page.getByLabel(/[Vv]alidator/).first()
  831 |   if (await validators.count() > 0) {
  832 |     try { await validators.fill(r.validatorEoa) } catch { /* not a text input */ }
  833 |   }
  834 | }
  835 | 
  836 | async function fillIntentForm(page: Page, title: string): Promise<void> {
  837 |   // Step 1 — direction. The button's accessible name leads with the 📥
  838 |   // emoji ("📥 Receive I need / I'm asking for…"), so anchoring the regex
  839 |   // with `^Receive` doesn't match. Drop the anchor.
  840 |   const receive = page.getByRole('button', { name: /Receive/i }).first()
  841 |   await receive.click()
  842 |   await page.waitForTimeout(400)
  843 |   // Step 2 — pick an intent type that's a money-receive ("Need funding").
  844 |   const moneyTile = page.getByRole('button', { name: /Need funding|Money/i }).first()
  845 |   if (await moneyTile.count() > 0) {
  846 |     await moneyTile.click().catch(() => {})
  847 |   }
  848 |   await page.waitForTimeout(400)
```