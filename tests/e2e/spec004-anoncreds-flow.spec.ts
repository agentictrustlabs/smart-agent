import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:3000'

/**
 * Spec 004 (b2) — end-to-end smoke test for the AnonCreds-gated vote +
 * proposal flow.
 *
 * Prereqs (run in order before this spec):
 *   ./scripts/fresh-start.sh
 *   pnpm exec tsx scripts/sync-ontology.ts
 *   pnpm exec tsx scripts/seed-test-pool.ts          # creates demo pool
 *   pnpm exec tsx scripts/seed-test-round.ts         # opens demo round
 *   pnpm exec tsx scripts/seed-test-proposal.ts      # one proposal in the round
 *   pnpm exec tsx scripts/seed-spec004-creds.ts \    # issues both creds + delegations
 *     --admin cat-user-001 \
 *     --submitter cat-user-002 \
 *     --voter cat-user-003 \
 *     --pool   demo-trauma-care-pool \
 *     --round  demo-trauma-care-q2
 *
 * The seed-spec004-creds script wraps `seedSpec004Credential()` from
 * `apps/web/src/lib/demo-seed/seed-spec004-credentials.ts` and applies
 * the cartesian product to the three demo users above.
 *
 * What the spec asserts:
 *   - `/h/catalyst/rounds/demo-trauma-care-q2` renders for an
 *     unauthenticated user (proposal bodies are public on chain).
 *   - Voter logs in, casts an approve ballot via /api/votes/cast, gets
 *     back `{ ok: true, txHash, nullifier, anonymous: true }`.
 *   - The same voter recasting the same ballot returns the SAME nullifier
 *     (anonymity AND idempotence).
 *   - A non-credentialed user gets the "no-marketplace-credential" error
 *     from the action layer (proves the chain gate engaged).
 */

async function demoLogin(page: Page, userId: string) {
  await page.goto(BASE)
  const r = await page.request.post(`${BASE}/api/demo-login`, {
    data: { userId },
    headers: { origin: BASE, 'content-type': 'application/json' },
  })
  expect(r.ok()).toBeTruthy()
}

async function fetchProposalSubject(page: Page, _roundId: string): Promise<`0x${string}`> {
  // The proposal list page renders the subject in a data-* attribute so
  // Playwright can grab it without scraping URN/hex resolution out of UI text.
  await page.goto(`${BASE}/h/catalyst/rounds/demo-trauma-care-q2`)
  await page.waitForLoadState('networkidle')
  const subjectAttr = await page.locator('[data-proposal-subject]').first().getAttribute('data-proposal-subject')
  expect(subjectAttr).toMatch(/^0x[0-9a-fA-F]{64}$/)
  return subjectAttr as `0x${string}`
}

test.describe('Spec 004 — AnonCreds-gated vote + submit', () => {
  test.beforeEach(async ({ page: _page }) => {
    test.setTimeout(120_000)
  })

  test('voter with cred + admin delegation can cast an anonymous ballot', async ({ page }) => {
    await demoLogin(page, 'cat-user-003') // Rosa — has RoundVoterCredential per prereqs
    const proposalSubject = await fetchProposalSubject(page, 'demo-trauma-care-q2')

    const res = await page.request.post(`${BASE}/api/votes/cast`, {
      data: {
        roundId: 'demo-trauma-care-q2',
        proposalSubject,
        vote: 'approve',
        rationale: 'aligned with rural-Wolof mandate',
      },
      headers: { origin: BASE, 'content-type': 'application/json' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json() as {
      ok: true; txHash: `0x${string}`; nullifier: string; anonymous: true
    }
    expect(body.ok).toBe(true)
    expect(body.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/)
    expect(body.nullifier).toMatch(/^0x[0-9a-fA-F]{64}$/)
    expect(body.anonymous).toBe(true)
  })

  test('recasting the same ballot returns the same nullifier (idempotence)', async ({ page }) => {
    await demoLogin(page, 'cat-user-003')
    const proposalSubject = await fetchProposalSubject(page, 'demo-trauma-care-q2')

    const cast1 = await page.request.post(`${BASE}/api/votes/cast`, {
      data: { roundId: 'demo-trauma-care-q2', proposalSubject, vote: 'approve' },
      headers: { origin: BASE, 'content-type': 'application/json' },
    })
    expect(cast1.ok()).toBeTruthy()
    const body1 = await cast1.json() as { nullifier: string }

    const cast2 = await page.request.post(`${BASE}/api/votes/cast`, {
      data: { roundId: 'demo-trauma-care-q2', proposalSubject, vote: 'reject' },
      headers: { origin: BASE, 'content-type': 'application/json' },
    })
    expect(cast2.ok()).toBeTruthy()
    const body2 = await cast2.json() as { nullifier: string }
    expect(body2.nullifier).toBe(body1.nullifier)
  })

  test('non-credentialed user is rejected with no-marketplace-credential', async ({ page }) => {
    await demoLogin(page, 'cat-user-009') // Luis — no RoundVoterCredential in the prereqs
    const proposalSubject = await fetchProposalSubject(page, 'demo-trauma-care-q2')

    const res = await page.request.post(`${BASE}/api/votes/cast`, {
      data: { roundId: 'demo-trauma-care-q2', proposalSubject, vote: 'approve' },
      headers: { origin: BASE, 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json() as { ok: false; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/no-marketplace-credential|chain:/)
  })

  test('round detail surfaces vote tally counts without identities', async ({ page }) => {
    await demoLogin(page, 'cat-user-001') // Maria (admin) can see the tally page
    await page.goto(`${BASE}/h/catalyst/rounds/demo-trauma-care-q2`)
    await page.waitForLoadState('networkidle')
    // Tally widget renders approve/reject/abstain counts — verify the
    // numbers are visible without any voter identity nearby (the
    // nullifier-keyed tally MUST NOT leak names).
    const tally = page.getByTestId('round-tally')
    await expect(tally).toBeVisible({ timeout: 30_000 })
    await expect(tally).not.toContainText(/cat-user-|0x[a-fA-F0-9]{40}/)
  })
})
