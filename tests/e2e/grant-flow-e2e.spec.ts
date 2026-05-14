import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
// viem isn't installed at repo root; resolve via apps/web's node_modules
// at runtime so the test can run from `pnpm exec playwright test`.
const viemMod = require(path.resolve(__dirname, '../../apps/web/node_modules/viem')) as typeof import('viem')
const viemChainsMod = require(path.resolve(__dirname, '../../apps/web/node_modules/viem/chains')) as typeof import('viem/chains')
const { createPublicClient, http, keccak256, toBytes } = viemMod
const { foundry } = viemChainsMod
type Address = `0x${string}`

// Load apps/web/.env so on-chain reads in this test see the deployed
// contract addresses. Playwright runs from repo root and doesn't pull
// these in automatically.
const _envPath = path.resolve(__dirname, '../../apps/web/.env')
if (fs.existsSync(_envPath)) {
  for (const line of fs.readFileSync(_envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

/**
 * Spec 006 — end-to-end grant-flow walkthrough via UI.
 *
 * Drives the validator + steward halves of the spec-006 two-gate release
 * flow through the live Tasks inbox at `/h/catalyst/tasks`. The earlier
 * phases (Maria pledges + honors, round opens, David proposes, Maria +
 * David vote, Maria closes the round, commitment row lands on chain)
 * are produced by `scripts/seed-grant-flow-demo.ts` running with
 * `STOP_AT_COMMITMENT=1` as a beforeAll step — that's a faithful capture
 * of every contract write the UI would do for those phases (signed by
 * the correct EOAs, deployer-free), just executed via SDK rather than
 * clicked through; it sets up the exact on-chain state the inbox UI
 * needs to operate on.
 *
 * The test then walks the UI-visible portion of the demo:
 *
 *   1. Sarah (validator) logs in, visits /tasks, sees two pending
 *      attestations, fills evidence and clicks "Attest delivered" twice.
 *   2. Maria (steward) logs in, visits /tasks, sees two release rows
 *      now ready, clicks "Approve & release" twice.
 *   3. Final on-chain check: Fort Collins Network Treasury balance
 *      grew by $30k.
 *
 * playwright.config.ts has `video: 'on'` so every run produces an mp4
 * of the full walkthrough in tests/e2e/test-results/<test-id>/video.webm.
 *
 * Prereqs (must run before the test):
 *   ./scripts/fresh-start.sh
 *   pnpm dev   (or fresh-start's started dev server is fine)
 */

const BASE = 'http://localhost:3000'
const REPO_ROOT = path.resolve(__dirname, '../..')
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const USDC = (process.env.USDC_ADDRESS ?? process.env.MOCK_USDC_ADDRESS) as Address | undefined
const FCN_TREASURY_NAME = 'Fort Collins Network'

const mockUsdcAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

async function demoLogin(page: Page, userId: string): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const r = await page.request.post(`${BASE}/api/demo-login`, {
    data: { userId },
    headers: { origin: BASE, 'content-type': 'application/json' },
  })
  expect(r.ok(), `demo-login for ${userId} returned ${r.status()}`).toBeTruthy()
}

async function readUsdcBalance(address: Address): Promise<bigint> {
  if (!USDC) return 0n
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
  return (await pub.readContract({
    address: USDC, abi: mockUsdcAbi, functionName: 'balanceOf', args: [address],
  })) as bigint
}

async function resolveFortCollinsTreasury(): Promise<Address> {
  // The catalyst seed deploys + registers Fort Collins Network and its
  // sa:hasTreasury treasury. We resolve via the on-chain resolver so we
  // don't bake addresses into the test.
  const resolverAddress = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
  if (!resolverAddress) throw new Error('AGENT_ACCOUNT_RESOLVER_ADDRESS not set')
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
  // First find the org by displayName via agentCount enumeration.
  const resolverAbi = [
    { type: 'function', name: 'agentCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
    { type: 'function', name: 'getAgentAt', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
    { type: 'function', name: 'getStringProperty', inputs: [{ type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'string' }], stateMutability: 'view' },
    { type: 'function', name: 'getAddressProperty', inputs: [{ type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
  ] as const
  const ATL_DISPLAY = keccak256(toBytes('atl:displayName'))
  const SA_HAS_TREASURY = keccak256(toBytes('sa:hasTreasury'))
  const count = (await pub.readContract({ address: resolverAddress, abi: resolverAbi, functionName: 'agentCount' })) as bigint
  for (let i = 0n; i < count; i++) {
    const addr = (await pub.readContract({
      address: resolverAddress, abi: resolverAbi, functionName: 'getAgentAt', args: [i],
    })) as Address
    const name = await pub.readContract({
      address: resolverAddress, abi: resolverAbi, functionName: 'getStringProperty', args: [addr, ATL_DISPLAY],
    }).catch(() => '') as string
    if (name === FCN_TREASURY_NAME) {
      const treasury = (await pub.readContract({
        address: resolverAddress, abi: resolverAbi, functionName: 'getAddressProperty', args: [addr, SA_HAS_TREASURY],
      })) as Address
      if (treasury && treasury !== '0x0000000000000000000000000000000000000000') return treasury
      return addr // shouldn't happen with the new seed, but fall through cleanly
    }
  }
  throw new Error(`Fort Collins Network not found in resolver — seed catalyst first`)
}

test.describe('Spec 006 — grant flow E2E (validator + steward UI)', () => {
  test.beforeEach(async () => {
    test.setTimeout(300_000) // 5 min — accommodates dev compile + chain waits
  })

  test('Sarah attests both milestones, Maria releases both, Fort Collins treasury grows by $30k', async ({ page }) => {
    // ── Setup: seed the on-chain state up to (but not including) attest/release ──
    // We invoke the existing seed with STOP_AT_COMMITMENT=1 so it lays
    // the deterministic groundwork and stops at the point the UI test
    // takes over. The inbox accumulates across seed runs (GraphDB isn't
    // wiped per-run), so we extract THIS run's commitment subject from
    // the seed's stdout and scope every UI interaction to that row.
    console.log('seeding fresh grant-flow scenario (STOP_AT_COMMITMENT=1) …')
    let seedStdout = ''
    try {
      seedStdout = execSync(
        `cd "${REPO_ROOT}/apps/web" && STOP_AT_COMMITMENT=1 pnpm exec tsx "${REPO_ROOT}/scripts/seed-grant-flow-demo.ts"`,
        { stdio: 'pipe', timeout: 180_000 },
      ).toString()
    } catch (e) {
      console.error('seed failed:', (e as Error).message?.slice(0, 1000))
      throw e
    }
    const subjectMatch = seedStdout.match(/COMMITMENT_SUBJECT=(0x[0-9a-fA-F]{64})/)
    if (!subjectMatch) {
      throw new Error('seed did not emit COMMITMENT_SUBJECT — cannot scope UI selectors')
    }
    const thisRunSubject = subjectMatch[1].toLowerCase()
    console.log(`scoping UI assertions to commitment ${thisRunSubject}`)

    const fortCollinsTreasury = await resolveFortCollinsTreasury()
    const balanceBefore = await readUsdcBalance(fortCollinsTreasury)
    console.log(`Fort Collins Treasury at ${fortCollinsTreasury}: $${(Number(balanceBefore) / 1_000_000).toLocaleString()}`)

    // ── Phase A: Sarah (validator) attests both milestones via UI ──
    await demoLogin(page, 'cat-user-005') // Sarah Thompson
    await page.goto(`${BASE}/h/catalyst/tasks`, { waitUntil: 'networkidle' })

    // Inbox header should render
    await expect(page.getByRole('heading', { name: /Inbox/i })).toBeVisible()

    // Scope every selector to rows for THIS run's commitment. Old runs
    // leave stale pending rows in the inbox that would otherwise capture
    // our clicks.
    const scopeAttest = page.locator(`[data-commitment-subject="${thisRunSubject}"][data-task-kind="attestation"]`)
    const initialAttestRows = await scopeAttest.count()
    expect(initialAttestRows, 'expected 2 pending attestations for this run on Sarah\'s inbox').toBeGreaterThanOrEqual(2)

    // Click each attestation button within scope, re-querying after each
    // navigation since the page reloads on success.
    for (let i = 0; i < 2; i++) {
      const scope = page.locator(`[data-commitment-subject="${thisRunSubject}"][data-task-kind="attestation"]`)
      const remaining = await scope.count()
      if (remaining === 0) break
      const row = scope.first()
      const evidenceInput = row.getByPlaceholder(/Evidence summary/i)
      if (await evidenceInput.count() > 0) {
        await evidenceInput.fill(`E2E run — milestone ${i + 1} attested by Sarah`)
      }
      await row.getByRole('button', { name: /Attest delivered/i }).click()
      await page.waitForLoadState('networkidle', { timeout: 30_000 })
    }

    // After 2 attestations, Sarah's inbox should be empty for attestations,
    // and Maria (when she logs in) should see 2 release rows.

    // ── Phase B: Maria (steward) approves + releases both milestones ──
    await demoLogin(page, 'cat-user-001') // Maria Gonzalez
    await page.goto(`${BASE}/h/catalyst/tasks`, { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: /Inbox/i })).toBeVisible()

    const scopeRelease = page.locator(`[data-commitment-subject="${thisRunSubject}"][data-task-kind="release"]`)
    const initialReleaseRows = await scopeRelease.count()
    expect(initialReleaseRows, 'expected 2 pending releases for this run on Maria\'s inbox').toBeGreaterThanOrEqual(2)

    for (let i = 0; i < 2; i++) {
      const scope = page.locator(`[data-commitment-subject="${thisRunSubject}"][data-task-kind="release"]`)
      const remaining = await scope.count()
      if (remaining === 0) break
      await scope.first().getByRole('button', { name: /Approve & release/i }).click()
      await page.waitForLoadState('networkidle', { timeout: 60_000 })
    }

    // ── Phase C: verify on-chain ──
    const balanceAfter = await readUsdcBalance(fortCollinsTreasury)
    const delta = balanceAfter - balanceBefore
    const THIRTY_K_USDC = 30_000n * 10n ** 6n
    expect(delta, `Fort Collins Treasury should grow by exactly $30k — got delta ${delta.toString()}`)
      .toBe(THIRTY_K_USDC)
    console.log(`Fort Collins Treasury after: $${(Number(balanceAfter) / 1_000_000).toLocaleString()}  (Δ +$${(Number(delta) / 1_000_000).toLocaleString()})`)
  })
})
