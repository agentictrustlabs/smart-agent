# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: grant-flow-demo.spec.ts >> Customer demo — grant lifecycle on Smart Agent
- Location: tests/e2e/grant-flow-demo.spec.ts:329:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-commitment-subject="0x5d13dfead5e0b36ef1ee6ec2605b5203b4197ee700cb6ae7fdf943110b569c31"][data-task-kind="attestation"]').first()
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for locator('[data-commitment-subject="0x5d13dfead5e0b36ef1ee6ec2605b5203b4197ee700cb6ae7fdf943110b569c31"][data-task-kind="attestation"]').first()

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - generic [ref=e12]:
    - banner [ref=e13]:
      - generic [ref=e14]:
        - link "Catalyst NoCo Network home" [ref=e15] [cursor=pointer]:
          - /url: /
          - img [ref=e16]
          - generic [ref=e23]: Catalyst NoCo Network
        - navigation "Primary navigation" [ref=e25]:
          - link "Home" [ref=e26] [cursor=pointer]:
            - /url: /h/catalyst/home
          - link "Nurture" [ref=e27] [cursor=pointer]:
            - /url: /nurture
          - link "People" [ref=e28] [cursor=pointer]:
            - /url: /people
          - link "Groups" [ref=e29] [cursor=pointer]:
            - /url: /groups
          - link "Discover" [ref=e30] [cursor=pointer]:
            - /url: /h/catalyst/intents
          - link "Funding" [ref=e31] [cursor=pointer]:
            - /url: /h/catalyst/rounds
          - link "Activity" [ref=e32] [cursor=pointer]:
            - /url: /activity
        - generic [ref=e33]:
          - button "Open navigation" [ref=e34] [cursor=pointer]: ☰
          - button "Toggle agent assistant" [ref=e35] [cursor=pointer]: 🤖
          - button "User menu for sarah-thompson.agent" [ref=e37] [cursor=pointer]:
            - generic [ref=e38]: S
            - generic [ref=e39]:
              - generic [ref=e40]: sarah-thompson.agent
              - generic [ref=e41]: Sarah Thompson
              - generic [ref=e42]: Disciple
            - generic [ref=e43]: ▼
      - navigation "Breadcrumb" [ref=e44]:
        - list [ref=e45]:
          - listitem [ref=e46]:
            - link "Home" [ref=e47] [cursor=pointer]:
              - /url: /h/catalyst/home
          - listitem [ref=e48]:
            - generic [ref=e49]: ">"
            - generic [ref=e50]: Tasks
    - generic [ref=e51]:
      - main [ref=e52]:
        - generic [ref=e53]:
          - generic [ref=e54]: Working as
          - strong [ref=e55]: Sarah Thompson
          - code [ref=e56]: sarah-thompson.agent
          - generic [ref=e57]: ·
          - generic [ref=e58]: member
          - generic [ref=e59]: ·
          - generic [ref=e60]: Catalyst NoCo Network
          - generic [ref=e61]: ·
          - generic [ref=e62]:
            - text: "Mode:"
            - strong [ref=e63]: Walk
            - generic [ref=e64]: · also Discover
        - generic [ref=e65]:
          - generic [ref=e66]:
            - generic [ref=e67]: Catalyst NoCo Network · Your tasks
            - heading "Funding milestones (0)" [level=1] [ref=e68]
            - paragraph [ref=e69]: Milestones across every active commitment that need an action from you — attestations to record, tranches to release.
          - generic [ref=e70]:
            - heading "●Awaiting your attestation (0)" [level=2] [ref=e71]
            - generic [ref=e72]: No milestones awaiting your validation.
          - generic [ref=e73]:
            - heading "●Awaiting your approval to release (0)" [level=2] [ref=e74]
            - generic [ref=e75]: No tranches ready for your release approval.
      - generic:
        - generic:
          - generic: "Y"
          - generic:
            - generic: Your Agent
            - text: Assistant
          - button "Close agent panel": ✕
        - generic:
          - generic: No suggestions right now. You're doing great!
        - generic:
          - textbox "Ask your agent..."
          - button "Send"
    - button "Log activity" [ref=e76] [cursor=pointer]: +
```

# Test source

```ts
  356 |   const ACTION_HOLD = 1400    // shorter pause after a clicked action settles
  357 | 
  358 |   // ── Chapter 1: Maria connects ─────────────────────────────────────
  359 |   // We start at the /demo page so the customer sees Maria sign in.
  360 |   await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
  361 |   await setBanner(page, 1, TOTAL_CHAPTERS,
  362 |     'Maria signs in',
  363 |     'Demo accounts are real on-chain principals. In production this is a passkey or SIWE flow — no MetaMask in the middle.',
  364 |     "Welcome to Smart Agent. We're about to walk through a complete grant lifecycle. Maria, the steward of the Catalyst NoCo Network, is about to sign in. In production this is a passkey or sign-in-with-Ethereum flow — no MetaMask in the middle.",
  365 |   )
  366 |   await pause(2400)
  367 |   {
  368 |     const btn = page.locator(`[data-testid="demo-login-cat-user-001"]`)
  369 |     await btn.scrollIntoViewIfNeeded()
  370 |     await btn.hover()
  371 |     await pause(700)
  372 |     await btn.click()
  373 |     await page.waitForURL(/\/h\/.+\/home|\/dashboard/, { timeout: 30_000 }).catch(() => {})
  374 |     await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  375 |   }
  376 |   await pause(800)
  377 | 
  378 |   // ── Chapter 2: Maria's hub ────────────────────────────────────────
  379 |   await page.goto(HOME_URL, { waitUntil: 'networkidle' })
  380 |   await setBanner(page, 2, TOTAL_CHAPTERS,
  381 |     'Catalyst NoCo Network — Maria stewards the regional grant pool',
  382 |     'Smart Agent treats every party (person, org, AI agent) as a first-class principal under programmable delegation.',
  383 |     "Maria lands on Catalyst NoCo Network — her organisation's hub. Every party here — people, organisations, even AI agents — is a first-class principal with its own on-chain identity and programmable delegation.",
  384 |   )
  385 |   await pause(CHAPTER_HOLD + 800)
  386 | 
  387 |   // ── Chapter 3: Maria's personal treasury (the funding source) ─────
  388 |   await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' })
  389 |   await setBanner(page, 3, TOTAL_CHAPTERS,
  390 |     'Maria\'s personal treasury holds the donor capital',
  391 |     'Money never sits on a person\'s smart account — only their dedicated Treasury Service Agent custodies USDC.',
  392 |     "Here's Maria's wallet. She has one million dollars in USDC, but notice it's held in a separate Treasury Service Agent, not on her person account. Money never sits on a person's smart account directly — that separation is a core safety property of the platform.",
  393 |   )
  394 |   await pause(CHAPTER_HOLD + 600)
  395 | 
  396 |   // ── Chapter 4: the pool — $30k pledged ────────────────────────────
  397 |   await page.goto(POOL_URL, { waitUntil: 'networkidle' })
  398 |   await setBanner(page, 4, TOTAL_CHAPTERS,
  399 |     'The grant pool — Maria pledged $30k to back this round',
  400 |     'PledgeRegistry records the donor commitment; the honor step (USDC transfer) settles the pool\'s balance.',
  401 |     "Maria created a grant pool and pledged thirty thousand dollars to back this round. The pledge is recorded in the PledgeRegistry contract, and the honor step moves USDC from her treasury to the pool — both signed by her, no admin in the middle.",
  402 |   )
  403 |   await pause(CHAPTER_HOLD + 1200)
  404 | 
  405 |   // ── Chapter 5: the round ─────────────────────────────────────────
  406 |   await page.goto(ROUND_URL, { waitUntil: 'networkidle' })
  407 |   await setBanner(page, 5, TOTAL_CHAPTERS,
  408 |     'The grant round — open, voted, and decided',
  409 |     'Round status, deadline, validator requirements, and proposal list all read directly from on-chain assertions.',
  410 |     "Next, Maria opened a grant round on her pool. The round is the structured solicitation: status, deadline, validator requirements, and proposal list — every field reads directly from on-chain assertions, no off-chain database in between.",
  411 |   )
  412 |   await pause(CHAPTER_HOLD + 1400)
  413 | 
  414 |   // ── Chapter 6: David's need intent ───────────────────────────────
  415 |   await page.goto(INTENT_URL, { waitUntil: 'networkidle' })
  416 |   await setBanner(page, 6, TOTAL_CHAPTERS,
  417 |     'Pastor David\'s NeedIntent — the original ask',
  418 |     'Intents live in the proposer\'s person-mcp and surface in the marketplace as the on-chain assertion.',
  419 |     "Pastor David, on the other side of the network, expressed a NeedIntent — he needs funding for trauma-care training in Fort Collins. The body of his intent stays in his personal MCP server. The public version surfaces in the marketplace as an on-chain assertion.",
  420 |   )
  421 |   await pause(CHAPTER_HOLD + 600)
  422 | 
  423 |   // ── Chapter 7: the awarded proposal ──────────────────────────────
  424 |   await page.goto(PROPOSAL_URL, { waitUntil: 'networkidle' })
  425 |   await setBanner(page, 7, TOTAL_CHAPTERS,
  426 |     'David\'s proposal — awarded and committed',
  427 |     'The award triggers a Commitment row in CommitmentRegistry; milestones become validator/steward gates.',
  428 |     "David applied with a proposal anchored to his intent. Maria and a second steward voted Approve, the round closed, and the award announcement created a Commitment record in CommitmentRegistry — two milestones, each gated by a validator attestation and a steward release.",
  429 |   )
  430 |   await pause(CHAPTER_HOLD + 1400)
  431 | 
  432 |   // ── Chapter 8: switch to Sarah (validator) ───────────────────────
  433 |   await uiLogin(page, 'cat-user-005', 'Sarah Thompson')
  434 |   await page.goto(TASKS_URL, { waitUntil: 'networkidle' })
  435 |   await setBanner(page, 8, TOTAL_CHAPTERS,
  436 |     'Validator Sarah\'s inbox — two milestones await her attestation',
  437 |     'Round validators are gated off-chain via AnonCreds credentials; their on-chain attestation unlocks each tranche.',
  438 |     "Sarah is the validator on this round. Her inbox shows two pending milestones. In production, validators prove their qualifications with AnonCreds credentials off-chain — but the attestation they sign lives on-chain and unlocks each tranche.",
  439 |   )
  440 |   await pause(CHAPTER_HOLD + 1000)
  441 | 
  442 |   // Scope every click to THIS run's commitment so accumulated test
  443 |   // state from prior seed runs can't capture us. The tasks page is a
  444 |   // server component — if the GraphDB sync hadn't fully caught up at
  445 |   // first render we get "Inbox (0)" with no further polling. Reload up
  446 |   // to 18 times with an 8s gap (was 6×5s = 30s; raised to 144s) so the
  447 |   // sync_jobs pipe + on-chain → GraphDB writer can settle on a cold dev
  448 |   // server. Recording is a one-shot run, so erring on the side of "wait
  449 |   // longer" beats failing the entire video at chapter 8.
  450 |   const attestScope = page.locator(`[data-commitment-subject="${d.commitmentSubject.toLowerCase()}"][data-task-kind="attestation"]`)
  451 |   for (let attempt = 0; attempt < 18; attempt++) {
  452 |     if (await attestScope.count() > 0) break
  453 |     await pause(8000)
  454 |     await page.reload({ waitUntil: 'networkidle' })
  455 |   }
> 456 |   await expect(attestScope.first()).toBeVisible({ timeout: 30_000 })
      |                                     ^ Error: expect(locator).toBeVisible() failed
  457 | 
  458 |   // ── Chapter 9: Sarah attests milestone 1 ─────────────────────────
  459 |   await setBanner(page, 9, TOTAL_CHAPTERS,
  460 |     'Sarah attests milestone 1 — "Kickoff + first cohort"',
  461 |     'Evidence content is hashed and the hash recorded on chain. The full evidence stays in Sarah\'s person-mcp.',
  462 |     "Sarah attests the first milestone — kickoff and first cohort. She types her evidence summary; only the hash goes on-chain. The full document stays in her personal MCP. This is a single transaction signed by her wallet.",
  463 |   )
  464 |   await pause(2000)
  465 |   {
  466 |     const row = attestScope.first()
  467 |     const ev = row.getByPlaceholder(/Evidence summary/i)
  468 |     if (await ev.count() > 0) {
  469 |       await ev.fill('Cohort 1 trauma-care training complete — 18 facilitators trained.')
  470 |       await pause(800)
  471 |     }
  472 |     await row.getByRole('button', { name: /Attest delivered/i }).click()
  473 |     await page.waitForLoadState('networkidle', { timeout: 30_000 })
  474 |     await pause(ACTION_HOLD)
  475 |   }
  476 | 
  477 |   // ── Chapter 10: Sarah attests milestone 2 ─────────────────────────
  478 |   await setBanner(page, 10, TOTAL_CHAPTERS,
  479 |     'Sarah attests milestone 2 — "Final report + outcomes"',
  480 |     'One validator-attest per milestone unlocks the matching tranche for the steward to release.',
  481 |     "Sarah attests milestone two — final report and outcomes. One validator attestation per milestone is what the contract requires to unlock the matching tranche for the steward to release.",
  482 |   )
  483 |   await pause(2000)
  484 |   {
  485 |     const remaining = page.locator(`[data-commitment-subject="${d.commitmentSubject.toLowerCase()}"][data-task-kind="attestation"]`)
  486 |     const row = remaining.first()
  487 |     const ev = row.getByPlaceholder(/Evidence summary/i)
  488 |     if (await ev.count() > 0) {
  489 |       await ev.fill('Final outcomes report — 42 families served; 11 ongoing care pathways.')
  490 |       await pause(800)
  491 |     }
  492 |     await row.getByRole('button', { name: /Attest delivered/i }).click()
  493 |     await page.waitForLoadState('networkidle', { timeout: 30_000 })
  494 |     await pause(ACTION_HOLD)
  495 |   }
  496 | 
  497 |   // ── Chapter 11: switch to Maria (steward) ─────────────────────────
  498 |   await uiLogin(page, 'cat-user-001', 'Maria Gonzalez')
  499 |   await page.goto(TASKS_URL, { waitUntil: 'networkidle' })
  500 |   await setBanner(page, 11, TOTAL_CHAPTERS,
  501 |     'Steward Maria\'s inbox — two attested milestones ready for release',
  502 |     'Two-gate model: validator attests delivery, steward approves payment. Neither party can bypass the other.',
  503 |     "Now back to Maria. Her steward inbox shows two attested milestones ready for release. This is the two-gate model: the validator attests delivery, the steward approves payment — and neither party can bypass the other.",
  504 |   )
  505 |   await pause(CHAPTER_HOLD + 800)
  506 | 
  507 |   const releaseScope = page.locator(`[data-commitment-subject="${d.commitmentSubject.toLowerCase()}"][data-task-kind="release"]`)
  508 |   for (let attempt = 0; attempt < 6; attempt++) {
  509 |     if (await releaseScope.count() > 0) break
  510 |     await pause(5000)
  511 |     await page.reload({ waitUntil: 'networkidle' })
  512 |   }
  513 |   await expect(releaseScope.first()).toBeVisible({ timeout: 30_000 })
  514 | 
  515 |   // ── Chapter 12: Maria releases milestone 1 ───────────────────────
  516 |   await setBanner(page, 12, TOTAL_CHAPTERS,
  517 |     'Maria releases milestone 1 — $12k tranche',
  518 |     'A single transaction batches the USDC transfer + on-chain release record. Pool → Fort Collins Treasury.',
  519 |     "Maria releases the first tranche, twelve thousand dollars. A single transaction does two things: transfer USDC from the pool to Fort Collins' treasury, and record the release on-chain so the audit trail is complete.",
  520 |   )
  521 |   await pause(2000)
  522 |   {
  523 |     const row = releaseScope.first()
  524 |     await row.getByRole('button', { name: /Approve & release/i }).click()
  525 |     await page.waitForLoadState('networkidle', { timeout: 60_000 })
  526 |     await pause(ACTION_HOLD)
  527 |   }
  528 | 
  529 |   // ── Chapter 13: Maria releases milestone 2 + outcome ─────────────
  530 |   const releaseScope2 = page.locator(`[data-commitment-subject="${d.commitmentSubject.toLowerCase()}"][data-task-kind="release"]`)
  531 |   await setBanner(page, 13, TOTAL_CHAPTERS,
  532 |     'Maria releases milestone 2 — $18k tranche',
  533 |     'Once the final tranche releases, the Commitment transitions to Completed and the inbox row clears.',
  534 |     "And the final tranche — eighteen thousand dollars. Once this releases, the Commitment transitions to Completed and the inbox row clears. The grant is fully delivered.",
  535 |   )
  536 |   await pause(2000)
  537 |   {
  538 |     const row = releaseScope2.first()
  539 |     await row.getByRole('button', { name: /Approve & release/i }).click()
  540 |     await page.waitForLoadState('networkidle', { timeout: 60_000 })
  541 |     await pause(ACTION_HOLD)
  542 |   }
  543 | 
  544 |   // ── Outcome chapter A: pool emptied. Brief stop on the pool page so
  545 |   // the customer sees the donor side dropped to $0.
  546 |   await page.goto(POOL_URL, { waitUntil: 'networkidle' })
  547 |   // Use chapter 14 / total 15 for the post-flow recap so they get a
  548 |   // narration line too. Banner suppresses chapter label when "0".
  549 |   await setBanner(page, 14, 15,
  550 |     'Pool drained — every committed milestone has been released',
  551 |     'Pool USDC remaining: $0  ·  Commitment status: Completed',
  552 |     "Looking back at the pool, it's empty — every committed milestone has been released. The Commitment is marked Completed on-chain.",
  553 |   )
  554 |   await pause(3200)
  555 | 
  556 |   // ── Outcome chapter B: navigate to Fort Collins Network's agent page
```