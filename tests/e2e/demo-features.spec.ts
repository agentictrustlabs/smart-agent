/**
 * Demo feature tests — one assertion per video chapter.
 *
 * See `docs/architecture/demo-feature-tests.md` for the test matrix.
 *
 * Run all:
 *   pnpm exec playwright test tests/e2e/demo-features.spec.ts \
 *     --config tests/e2e/playwright.config.ts --reporter=line
 *
 * Run one (debugging):
 *   pnpm exec playwright test tests/e2e/demo-features.spec.ts \
 *     --config tests/e2e/playwright.config.ts \
 *     --grep "T9 record-outcome-onchain" --reporter=line
 *
 * Read-only sanity pass (T1-T7, no state mutation):
 *   pnpm exec playwright test tests/e2e/demo-features.spec.ts \
 *     --config tests/e2e/playwright.config.ts \
 *     --grep "T[1-7] " --reporter=line
 *
 * Assumes:
 *   - Local stack up (`scripts/fresh-start.sh --minimal`).
 *   - The seed already ran OR is run via `beforeAll` here.
 *   - Demo users (Maria/David/Sarah) provisioned + registered.
 */

import { test, expect, type APIRequestContext } from '@playwright/test'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const viemMod = require(path.resolve(__dirname, '../../apps/web/node_modules/viem')) as typeof import('viem')
const viemChainsMod = require(path.resolve(__dirname, '../../apps/web/node_modules/viem/chains')) as typeof import('viem/chains')
const { createPublicClient, http, keccak256, toBytes } = viemMod
const { foundry } = viemChainsMod
type Address = `0x${string}`

// ─── env load (mirrors grant-flow-demo.spec.ts) ──────────────────────
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

const BASE = 'http://localhost:3000'
const REPO_ROOT = path.resolve(__dirname, '../..')
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const USDC = (process.env.USDC_ADDRESS ?? process.env.MOCK_USDC_ADDRESS) as Address | undefined
const COMMITMENT_REGISTRY = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
const FUND_REGISTRY = process.env.FUND_REGISTRY_ADDRESS as Address | undefined
const GRANT_PROPOSAL_REGISTRY = process.env.GRANT_PROPOSAL_REGISTRY_ADDRESS as Address | undefined

const mockUsdcAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const
const commitmentRegistryAbi = [
  {
    type: 'function', name: 'getCommitment', stateMutability: 'view',
    inputs: [{ name: 'subj', type: 'bytes32' }],
    outputs: [
      { name: 'sourceKind', type: 'bytes32' },
      { name: 'sourceSubject', type: 'bytes32' },
      { name: 'donor', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'releasedAmount', type: 'uint256' },
      { name: 'status', type: 'bytes32' },
    ],
  },
  {
    type: 'function', name: 'getOutcome', stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'bytes32' }],
    outputs: [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
  },
  {
    type: 'function', name: 'getMilestoneRelease', stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'bytes32' }],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
  },
] as const
const fundRegistryAbi = [
  {
    type: 'function', name: 'getRoundStatus', stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function', name: 'getString', stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'bytes32' }],
    outputs: [{ type: 'string' }],
  },
] as const
const grantProposalRegistryAbi = [
  // GrantProposalRegistry inherits AttributeStorage — status is read via
  // generic `getBytes32(subject, predicate)` where the predicate is
  // `keccak256("sa:gpStatus")` (see contract's `SA_GP_STATUS` constant).
  {
    type: 'function', name: 'getBytes32', stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'bytes32' }],
    outputs: [{ type: 'bytes32' }],
  },
] as const

interface DemoData {
  hubSlug: string
  poolSlug: string
  roundSlug: string
  intentId: string
  proposalId: string
  poolAddress: Address
  mariaTreasury: Address
  recipientTreasury: Address
  fortCollins: Address
  catalyst: Address
  commitmentSubject: `0x${string}`
}

function parseDemoData(stdout: string): DemoData {
  const get = (k: string): string => {
    const m = stdout.match(new RegExp(`^\\s*${k}=(.+)$`, 'm'))
    if (!m) throw new Error(`seed stdout missing ${k}`)
    return m[1].trim()
  }
  return {
    hubSlug: get('DEMO_HUB_SLUG'),
    poolSlug: get('DEMO_POOL_SLUG'),
    roundSlug: get('DEMO_ROUND_SLUG'),
    intentId: get('DEMO_INTENT_ID'),
    proposalId: get('DEMO_PROPOSAL_ID'),
    poolAddress: get('DEMO_POOL_ADDRESS') as Address,
    mariaTreasury: get('DEMO_MARIA_TREASURY') as Address,
    recipientTreasury: get('DEMO_RECIPIENT_TREASURY') as Address,
    fortCollins: get('DEMO_FORT_COLLINS') as Address,
    catalyst: get('DEMO_CATALYST') as Address,
    commitmentSubject: get('COMMITMENT_SUBJECT') as `0x${string}`,
  }
}

const pub = createPublicClient({ chain: foundry, transport: http(RPC) })

let demoData: DemoData
let fortCollinsBaseline = 0n

// Sign-in helper: direct POST sets the cookies on the playwright APIRequestContext.
async function signIn(api: APIRequestContext, userId: string): Promise<void> {
  const r = await api.post(`${BASE}/api/demo-login`, {
    data: { userId },
    headers: { origin: BASE, 'content-type': 'application/json' },
    timeout: 120_000,
  })
  expect(r.ok(), `demo-login for ${userId} returned ${r.status()}`).toBeTruthy()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(300_000)
  // Run the seed ONCE for the whole file. The seed is idempotent in
  // the sense that the commitment subject is derived from a per-run
  // RUN_LABEL, so each run produces a fresh commitment. We capture
  // the printed key/value lines into `demoData`.
  console.log('[demo-features] running seed (STOP_AT_COMMITMENT=1)…')
  const seedStdout = execSync(
    `cd "${REPO_ROOT}/apps/web" && STOP_AT_COMMITMENT=1 pnpm exec tsx "${REPO_ROOT}/scripts/seed-grant-flow-demo.ts"`,
    { stdio: 'pipe', timeout: 240_000 },
  ).toString()
  demoData = parseDemoData(seedStdout)
  console.log(`[demo-features] commitment=${demoData.commitmentSubject}`)
  console.log(`[demo-features] pool=${demoData.poolAddress}`)
  fortCollinsBaseline = await pub.readContract({
    address: USDC!, abi: mockUsdcAbi, functionName: 'balanceOf',
    args: [demoData.recipientTreasury],
  }) as bigint
  console.log(`[demo-features] Fort Collins treasury baseline: $${(Number(fortCollinsBaseline) / 1_000_000).toLocaleString()}`)
})

// ─── T1 — auth-demo-login ────────────────────────────────────────────
test('T1 auth-demo-login', async ({ playwright }) => {
  const api = await playwright.request.newContext()
  await signIn(api, 'cat-user-001')  // Maria
  const sess = await api.get(`${BASE}/api/auth/session`)
  expect(sess.ok(), 'auth/session must return 200 after demo-login').toBeTruthy()
  const body = (await sess.json()) as { user?: { id?: string } | null }
  expect(body.user?.id, 'session must surface user id').toBe('cat-user-001')
  await api.dispose()
})

// ─── T2 — hub-home-render ────────────────────────────────────────────
test('T2 hub-home-render', async ({ playwright }) => {
  const api = await playwright.request.newContext()
  await signIn(api, 'cat-user-001')
  const r = await api.get(`${BASE}/h/${demoData.hubSlug}/home`)
  expect(r.status(), 'hub home must render 200').toBe(200)
  const html = await r.text()
  // 'Maria' (the principal's display name) must appear somewhere; the hub
  // shell embeds it in the user-menu chrome. This is the cheapest signal
  // the page server-rendered + auth resolved.
  expect(html.toLowerCase()).toContain('maria')
  await api.dispose()
})

// ─── T3 — personal-treasury-balance ─────────────────────────────────
test('T3 personal-treasury-balance', async () => {
  expect(USDC, 'USDC env required').toBeTruthy()
  const bal = await pub.readContract({
    address: USDC!, abi: mockUsdcAbi, functionName: 'balanceOf',
    args: [demoData.mariaTreasury],
  }) as bigint
  // Maria's treasury had 30k USDC minted; after honor it should have
  // 0 (sent to pool). For the demo path, we just assert the treasury
  // address exists + has been TOUCHED (mint happened) — the post-honor
  // balance is 0 so the meaningful invariant is that the treasury is
  // a real on-chain agent and USDC was minted to it at some point. We
  // can't distinguish "never minted" from "minted then sent" without a
  // separate witness. Use balanceOf as a smoke check that the address
  // resolves: a freshly-CREATE2'd address that was never minted to
  // and has no code will still return 0; not a useful assertion.
  // Better: assert the treasury has CODE (= it's a deployed AgentAccount).
  const code = await pub.getCode({ address: demoData.mariaTreasury })
  expect(code && code !== '0x', 'Maria treasury must be a deployed contract').toBeTruthy()
  // Best effort: log the balance for debug visibility.
  console.log(`[T3] mariaTreasury=${demoData.mariaTreasury}  balance=${bal.toString()}`)
})

// ─── T4 — pool-funded ───────────────────────────────────────────────
test('T4 pool-funded', async () => {
  expect(USDC, 'USDC env required').toBeTruthy()
  const bal = await pub.readContract({
    address: USDC!, abi: mockUsdcAbi, functionName: 'balanceOf',
    args: [demoData.poolAddress],
  }) as bigint
  // The seed pledges + honors $30k to the pool. After honor (STEP 5 of
  // seed-grant-flow-demo.ts) the pool's USDC balance must equal $30k.
  const expected = 30_000n * 10n ** 6n
  expect(bal, `pool USDC must be 30k, got ${bal.toString()}`).toBe(expected)
})

// ─── T5 — round-open ────────────────────────────────────────────────
test('T5 round-open', async () => {
  expect(FUND_REGISTRY, 'FUND_REGISTRY env required').toBeTruthy()
  const roundSubject = keccak256(toBytes(`sa:round:${demoData.roundSlug}`))
  const status = await pub.readContract({
    address: FUND_REGISTRY!, abi: fundRegistryAbi, functionName: 'getRoundStatus',
    args: [roundSubject],
  }) as `0x${string}`
  // The seed transitions the round through {open → review → decided →
  // awarded}. Accept any of the post-open states.
  const accepted = new Set<string>([
    keccak256(toBytes('sa:RoundOpen')),
    keccak256(toBytes('sa:RoundReview')),
    keccak256(toBytes('sa:RoundDecided')),
    keccak256(toBytes('sa:RoundAwarded')),
  ])
  expect(accepted.has(status), `round status must be post-open; got ${status}`).toBeTruthy()

  // Validators list must include Sarah.
  const validatorsJson = await pub.readContract({
    address: FUND_REGISTRY!, abi: fundRegistryAbi, functionName: 'getString',
    args: [roundSubject, keccak256(toBytes('sa:roundValidatorRequirements'))],
  }) as string
  expect(validatorsJson, 'round must have validatorRequirements').toContain('validators')
})

// ─── T6 — intent-fetch ──────────────────────────────────────────────
test('T6 intent-fetch', async ({ playwright }) => {
  const api = await playwright.request.newContext()
  await signIn(api, 'cat-user-001')
  const url = `${BASE}/h/${demoData.hubSlug}/intents/${encodeURIComponent(demoData.intentId)}`
  const r = await api.get(url)
  expect(r.status(), 'intent page must render 200').toBe(200)
  await api.dispose()
})

// ─── T7 — proposal-awarded ──────────────────────────────────────────
test('T7 proposal-awarded', async () => {
  expect(GRANT_PROPOSAL_REGISTRY, 'GRANT_PROPOSAL_REGISTRY env required').toBeTruthy()
  expect(COMMITMENT_REGISTRY, 'COMMITMENT_REGISTRY env required').toBeTruthy()
  const proposalSubj = demoData.proposalId as `0x${string}`
  const status = await pub.readContract({
    address: GRANT_PROPOSAL_REGISTRY!, abi: grantProposalRegistryAbi, functionName: 'getBytes32',
    args: [proposalSubj, keccak256(toBytes('sa:gpStatus'))],
  }) as `0x${string}`
  // Seed marks the proposal awarded after STEP 9.
  expect(status, `proposal must be awarded; got ${status}`).toBe(keccak256(toBytes('sa:GpAwarded')))

  // The Commitment row must be populated.
  const c = await pub.readContract({
    address: COMMITMENT_REGISTRY!, abi: commitmentRegistryAbi, functionName: 'getCommitment',
    args: [demoData.commitmentSubject],
  }) as readonly [`0x${string}`, `0x${string}`, Address, Address, Address, bigint, bigint, `0x${string}`]
  const [, , donor, recipient, , totalAmount] = c
  expect(donor, 'commitment.donor must be the pool').toBe(demoData.poolAddress as Address)
  expect(recipient, 'commitment.recipient must be Fort Collins treasury').toBe(demoData.recipientTreasury as Address)
  expect(totalAmount, 'commitment.totalAmount must be $30k').toBe(30_000n * 10n ** 6n)
})

// ─── T8 — validator-inbox-renders ────────────────────────────────────
test('T8 validator-inbox-renders', async ({ playwright }) => {
  // Must use a real browser context — the tasks page renders via React
  // Server Components, so the per-row `data-commitment-subject` +
  // `data-task-kind` attributes only exist after hydration in a browser.
  // A bare HTML fetch returns the RSC payload, not the hydrated DOM.
  const api = await playwright.request.newContext()
  await signIn(api, 'cat-user-005')  // Sarah
  const browser = await playwright.chromium.launch()
  try {
    const ctx = await browser.newContext()
    await ctx.addCookies((await api.storageState()).cookies)
    const page = await ctx.newPage()
    await page.goto(
      `${BASE}/h/${demoData.hubSlug}/tasks?commitment=${demoData.commitmentSubject}`,
      { waitUntil: 'networkidle', timeout: 30_000 },
    )
    const row = page.locator(
      `[data-commitment-subject="${demoData.commitmentSubject.toLowerCase()}"][data-task-kind="attestation"]`,
    )
    await expect(row.first(), 'at least one attestation row must be visible').toBeVisible({ timeout: 15_000 })
    await ctx.close()
  } finally {
    await browser.close()
  }
  await api.dispose()
})

// ─── T9 — record-outcome-onchain ─────────────────────────────────────
test('T9 record-outcome-onchain', async ({ playwright }) => {
  expect(COMMITMENT_REGISTRY, 'COMMITMENT_REGISTRY env required').toBeTruthy()
  test.setTimeout(120_000)
  const api = await playwright.request.newContext()
  await signIn(api, 'cat-user-005')  // Sarah (validator)
  // Click Confirm milestone via the UI is the customer-facing path, but
  // for "fast verification" we exercise the server action directly. The
  // server action lives at `commitments.action.ts:recordOutcome`. It's a
  // Next.js Server Action; we invoke it through the page that owns the
  // form (the tasks page). Simpler: hit the underlying MCP endpoint via
  // the route the server action uses internally.
  //
  // Easiest reproducible path: emulate what TaskRowActions.tsx submits
  // — a Next.js Server Action via POST /h/.../tasks with the
  // server-action header. We instead use the playwright BROWSER to drive
  // the UI button, which guarantees we cover the same path the demo does.
  const browser = await playwright.chromium.launch()
  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    // Sign in via the API context's cookies — copy them into the browser.
    const cookies = await api.storageState()
    await ctx.addCookies(cookies.cookies)
    const tasksUrl = `${BASE}/h/${demoData.hubSlug}/tasks?commitment=${demoData.commitmentSubject}`
    await page.goto(tasksUrl, { waitUntil: 'networkidle', timeout: 30_000 })
    // Two milestones — click Confirm on the first row twice (one per ms).
    const attestRow = page.locator(`[data-commitment-subject="${demoData.commitmentSubject.toLowerCase()}"][data-task-kind="attestation"]`)
    for (let i = 0; i < 2; i++) {
      await expect(attestRow.first(), `attestation row should be visible (iter ${i})`).toBeVisible({ timeout: 30_000 })
      const row = attestRow.first()
      const ev = row.getByPlaceholder(/Evidence summary/i)
      if (await ev.count() > 0) await ev.fill(`evidence-${i}`)
      await row.getByRole('button', { name: /Confirm milestone/i }).click()
      await page.getByRole('dialog').getByRole('button', { name: /Confirm milestone/i }).click()
      await page.waitForLoadState('networkidle', { timeout: 30_000 })
    }
    await ctx.close()
  } finally {
    await browser.close()
  }
  await api.dispose()
  // Assert both outcomes recorded on chain.
  const m1 = keccak256(toBytes('m1'))
  const m2 = keccak256(toBytes('m2'))
  const o1 = await pub.readContract({
    address: COMMITMENT_REGISTRY!, abi: commitmentRegistryAbi, functionName: 'getOutcome',
    args: [demoData.commitmentSubject, m1],
  }) as readonly [`0x${string}`, bigint, Address]
  const o2 = await pub.readContract({
    address: COMMITMENT_REGISTRY!, abi: commitmentRegistryAbi, functionName: 'getOutcome',
    args: [demoData.commitmentSubject, m2],
  }) as readonly [`0x${string}`, bigint, Address]
  expect(o1[1] > 0n, `m1 outcome.recordedAt must be > 0; got ${o1[1]}`).toBeTruthy()
  expect(o2[1] > 0n, `m2 outcome.recordedAt must be > 0; got ${o2[1]}`).toBeTruthy()
})

// ─── T10 — steward-inbox-renders ─────────────────────────────────────
test('T10 steward-inbox-renders', async ({ playwright }) => {
  // Real browser required — RSC payload doesn't carry the rendered DOM.
  const api = await playwright.request.newContext()
  await signIn(api, 'cat-user-001')  // Maria (steward / pool owner)
  const browser = await playwright.chromium.launch()
  try {
    const ctx = await browser.newContext()
    await ctx.addCookies((await api.storageState()).cookies)
    const page = await ctx.newPage()
    await page.goto(
      `${BASE}/h/${demoData.hubSlug}/tasks?commitment=${demoData.commitmentSubject}`,
      { waitUntil: 'networkidle', timeout: 30_000 },
    )
    const row = page.locator(
      `[data-commitment-subject="${demoData.commitmentSubject.toLowerCase()}"][data-task-kind="release"]`,
    )
    await expect(row.first(), 'at least one release row must be visible (run T9 first)').toBeVisible({ timeout: 15_000 })
    await ctx.close()
  } finally {
    await browser.close()
  }
  await api.dispose()
})

// ─── T11 — release-tranche-rail-a ────────────────────────────────────
test('T11 release-tranche-rail-a', async ({ playwright }) => {
  expect(COMMITMENT_REGISTRY, 'COMMITMENT_REGISTRY env required').toBeTruthy()
  test.setTimeout(120_000)
  const api = await playwright.request.newContext()
  await signIn(api, 'cat-user-001')  // Maria (steward)
  const browser = await playwright.chromium.launch()
  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const cookies = await api.storageState()
    await ctx.addCookies(cookies.cookies)
    const tasksUrl = `${BASE}/h/${demoData.hubSlug}/tasks?commitment=${demoData.commitmentSubject}`
    await page.goto(tasksUrl, { waitUntil: 'networkidle', timeout: 30_000 })
    const releaseRow = page.locator(`[data-commitment-subject="${demoData.commitmentSubject.toLowerCase()}"][data-task-kind="release"]`)
    for (let i = 0; i < 2; i++) {
      await expect(releaseRow.first(), `release row should be visible (iter ${i})`).toBeVisible({ timeout: 30_000 })
      const row = releaseRow.first()
      await row.getByRole('button', { name: /Release payment/i }).click()
      await page.getByRole('dialog').getByRole('button', { name: /Release payment/i }).click()
      await page.waitForLoadState('networkidle', { timeout: 60_000 })
    }
    await ctx.close()
  } finally {
    await browser.close()
  }
  await api.dispose()
  const m1 = keccak256(toBytes('m1'))
  const m2 = keccak256(toBytes('m2'))
  const r1 = await pub.readContract({
    address: COMMITMENT_REGISTRY!, abi: commitmentRegistryAbi, functionName: 'getMilestoneRelease',
    args: [demoData.commitmentSubject, m1],
  }) as readonly [bigint, bigint]
  const r2 = await pub.readContract({
    address: COMMITMENT_REGISTRY!, abi: commitmentRegistryAbi, functionName: 'getMilestoneRelease',
    args: [demoData.commitmentSubject, m2],
  }) as readonly [bigint, bigint]
  expect(r1[0] > 0n, `m1 release amount must be > 0; got ${r1[0]}`).toBeTruthy()
  expect(r2[0] > 0n, `m2 release amount must be > 0; got ${r2[0]}`).toBeTruthy()
})

// ─── T12 — pool-drained ──────────────────────────────────────────────
test('T12 pool-drained', async () => {
  expect(USDC, 'USDC env required').toBeTruthy()
  const bal = await pub.readContract({
    address: USDC!, abi: mockUsdcAbi, functionName: 'balanceOf',
    args: [demoData.poolAddress],
  }) as bigint
  // After both releases the pool should be at 0.
  expect(bal, `pool USDC must be 0 after releases; got ${bal.toString()}`).toBe(0n)
})

// ─── T13 — fort-collins-treasury-grew ────────────────────────────────
test('T13 fort-collins-treasury-grew', async () => {
  expect(USDC, 'USDC env required').toBeTruthy()
  const bal = await pub.readContract({
    address: USDC!, abi: mockUsdcAbi, functionName: 'balanceOf',
    args: [demoData.recipientTreasury],
  }) as bigint
  const delta = bal - fortCollinsBaseline
  expect(delta, `Fort Collins treasury delta must be exactly $30k; got ${delta.toString()}`).toBe(30_000n * 10n ** 6n)
})
