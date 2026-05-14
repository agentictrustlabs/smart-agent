import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const viemMod = require(path.resolve(__dirname, '../../apps/web/node_modules/viem')) as typeof import('viem')
const viemChainsMod = require(path.resolve(__dirname, '../../apps/web/node_modules/viem/chains')) as typeof import('viem/chains')
const { createPublicClient, http } = viemMod
const { foundry } = viemChainsMod
type Address = `0x${string}`

// Load apps/web/.env so we see contract addresses.
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
 * Spec 006 — full UI-driven customer demo.
 *
 * Unlike grant-flow-demo.spec.ts (which seeds pool/round/proposal/votes
 * on chain and just tours the artefacts in UI), THIS test drives every
 * action through the Next.js forms so the customer sees every click:
 *
 *   1. Maria signs in (via /demo)
 *   2. Reviews her treasury wallet ($1M USDC)
 *   3. Creates a new pool                  → PoolCreateForm
 *   4. Pledges $30k to the pool            → PledgeComposer
 *   5. Honors the pledge (USDC moves)      → PledgeHonorForm
 *   6. Opens a grant round                 → RoundCreateForm
 *   7. David signs in
 *   8. David expresses a NeedIntent         → ExpressIntentForm
 *   9. David applies to Maria's round       → ProposalComposer
 *  10. Maria votes Approve                  → ProposalVotePanel
 *  11. David votes Approve                  → ProposalVotePanel
 *  12. Maria finalises the round            → RoundAdminClient lifecycle
 *  13. Sarah signs in & attests 2 milestones → /tasks inbox
 *  14. Maria releases 2 tranches             → /tasks inbox
 *  15. Outcome — Fort Collins Treasury card shows +$30k
 *
 * Bootstrap (one tx batch) deploys only the infra the UI can't create
 * itself: Maria's personal treasury + $1M USDC. Everything else flows
 * through forms.
 */

const BASE = 'http://localhost:3000'
const REPO_ROOT = path.resolve(__dirname, '../..')
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const USDC = (process.env.USDC_ADDRESS ?? process.env.MOCK_USDC_ADDRESS) as Address | undefined

const mockUsdcAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

interface BootstrapData {
  hubSlug: string
  mariaSA: Address
  mariaTreasury: Address
  davidSA: Address
  sarahSA: Address
  sarahEoa: Address
  catalyst: Address
  fortCollins: Address
}

function parseBootstrap(stdout: string): BootstrapData {
  const get = (k: string): string => {
    const m = stdout.match(new RegExp(`^\\s*${k}=(.+)$`, 'm'))
    if (!m) throw new Error(`bootstrap stdout missing ${k}`)
    return m[1].trim()
  }
  return {
    hubSlug: get('DEMO_HUB_SLUG'),
    mariaSA: get('DEMO_MARIA_SA') as Address,
    mariaTreasury: get('DEMO_MARIA_TREASURY') as Address,
    davidSA: get('DEMO_DAVID_SA') as Address,
    sarahSA: get('DEMO_SARAH_SA') as Address,
    sarahEoa: get('DEMO_SARAH_EOA') as Address,
    catalyst: get('DEMO_CATALYST') as Address,
    fortCollins: get('DEMO_FORT_COLLINS') as Address,
  }
}

// Injected on every page — cursor (so customer sees clicks) + banner.
const CHROME_SCRIPT = `
;(function(){
  if (window.__demoChromeInstalled) return
  window.__demoChromeInstalled = true
  const cur = document.createElement('div')
  cur.id = '__demo_cursor__'
  cur.style.cssText = [
    'position: fixed', 'top: 50%', 'left: 50%',
    'width: 22px', 'height: 22px', 'margin-left: -11px', 'margin-top: -11px',
    'border-radius: 50%',
    'background: radial-gradient(circle, rgba(15,23,42,0.92) 0 35%, rgba(15,23,42,0.35) 36% 60%, transparent 65%)',
    'box-shadow: 0 0 0 1px rgba(255,255,255,0.7), 0 4px 12px rgba(0,0,0,0.25)',
    'pointer-events: none', 'z-index: 2147483646',
    'transition: width 0.15s ease, height 0.15s ease',
  ].join(';')
  document.documentElement.appendChild(cur)
  document.addEventListener('mousemove', (e) => {
    cur.style.left = e.clientX + 'px'
    cur.style.top  = e.clientY + 'px'
  }, true)
  document.addEventListener('mousedown', (e) => {
    cur.style.width = '32px'; cur.style.height = '32px'
    const ring = document.createElement('div')
    ring.style.cssText = [
      'position: fixed',
      'left: ' + e.clientX + 'px', 'top: ' + e.clientY + 'px',
      'width: 8px', 'height: 8px', 'margin-left: -4px', 'margin-top: -4px',
      'border: 2px solid rgba(251,191,36,0.95)',
      'border-radius: 50%',
      'pointer-events: none', 'z-index: 2147483645',
      'animation: __demoRipple 0.55s ease-out forwards',
    ].join(';')
    document.documentElement.appendChild(ring)
    setTimeout(() => ring.remove(), 650)
  }, true)
  document.addEventListener('mouseup', () => {
    cur.style.width = '22px'; cur.style.height = '22px'
  }, true)
  const css = document.createElement('style')
  css.textContent = '@keyframes __demoRipple { 0% { width:8px; height:8px; opacity:1 } 100% { width:64px; height:64px; margin-left:-32px; margin-top:-32px; opacity:0 } }'
  document.documentElement.appendChild(css)
})();
window.__demoBanner = (chapter, total, text, sub) => {
  let b = document.getElementById('__demo_banner__')
  if (!b) {
    b = document.createElement('div')
    b.id = '__demo_banner__'
    b.style.cssText = [
      'position: fixed', 'top: 20px', 'left: 50%', 'transform: translateX(-50%)',
      'background: linear-gradient(180deg, rgba(15,23,42,0.96), rgba(30,41,59,0.96))',
      'color: white', 'padding: 14px 26px 16px', 'border-radius: 10px',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'box-shadow: 0 12px 32px rgba(0,0,0,0.35)',
      'z-index: 999999', 'max-width: 900px', 'min-width: 480px', 'text-align: center',
      'transition: opacity 0.25s ease', 'pointer-events: none',
    ].join(';')
    document.body.appendChild(b)
  }
  const sup = chapter
    ? \`<div style="font-size:10.5px;font-weight:700;letter-spacing:0.14em;color:#fbbf24;text-transform:uppercase;margin-bottom:6px">Chapter \${chapter} of \${total}</div>\`
    : ''
  const subline = sub
    ? \`<div style="font-size:13px;color:#cbd5e1;font-weight:400;margin-top:4px">\${sub}</div>\`
    : ''
  b.innerHTML = \`\${sup}<div style="font-size:17px;font-weight:600;line-height:1.3">\${text}</div>\${subline}\`
  b.style.opacity = '1'
}
window.__demoBannerHide = () => {
  const b = document.getElementById('__demo_banner__')
  if (b) b.style.opacity = '0'
}
`

const TOTAL_CHAPTERS = 15

async function setBanner(page: Page, chapter: number, total: number, text: string, sub?: string): Promise<void> {
  await page.evaluate(
    ({ chapter, total, text, sub }) => {
      const w = window as unknown as { __demoBanner?: (c: number, t: number, x: string, s?: string) => void }
      w.__demoBanner?.(chapter, total, text, sub)
    },
    { chapter, total, text, sub: sub ?? '' },
  )
}

async function hideBanner(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __demoBannerHide?: () => void }
    w.__demoBannerHide?.()
  })
}

async function readUsdcBalance(address: Address): Promise<bigint> {
  if (!USDC) return 0n
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
  return (await pub.readContract({
    address: USDC, abi: mockUsdcAbi, functionName: 'balanceOf', args: [address],
  })) as bigint
}

/**
 * Visible /demo sign-in. Customer sees the user card + click.
 */
async function uiLogin(page: Page, userId: string): Promise<void> {
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
  const btn = page.locator(`[data-testid="demo-login-${userId}"]`)
  await btn.scrollIntoViewIfNeeded()
  await btn.hover()
  await page.waitForTimeout(800)
  await btn.click()
  await page.waitForURL(/\/h\/.+\/home|\/dashboard/, { timeout: 30_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(500)
}

// ── Bootstrap data + recipient-treasury before-balance ────────────────
let bs: BootstrapData
let recipientTreasury: Address
let balanceBefore = 0n

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  // Pre-warm + bootstrap can take 6-8 min on a cold Next.js dev server.
  // The compile work is per-route, not per-user, so pre-warming with one
  // user is sufficient for all subsequent navigation.
  test.setTimeout(900_000)

  console.log('[full-demo] running bootstrap…')
  const out = execSync(
    `cd "${REPO_ROOT}/apps/web" && pnpm exec tsx "${REPO_ROOT}/scripts/bootstrap-grant-flow-ui-demo.ts"`,
    { stdio: 'pipe', timeout: 120_000 },
  ).toString()
  bs = parseBootstrap(out)
  console.log('[full-demo] Maria treasury:', bs.mariaTreasury)
  console.log('[full-demo] Fort Collins:', bs.fortCollins)

  // Pre-warm every URL the test will hit, under both Maria and David
  // session cookies so their hub-scoped pages are compiled.
  console.log('[full-demo] pre-warming pages (no recording)…')
  const ctx = await browser.newContext()
  const w = await ctx.newPage()
  async function warmLogin(userId: string) {
    await w.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await w.request.post(`${BASE}/api/demo-login`, {
      data: { userId },
      headers: { origin: BASE, 'content-type': 'application/json' },
    })
  }
  const warmUrls = [
    `${BASE}/demo`,
    `${BASE}/`,
    `${BASE}/h/${bs.hubSlug}/home`,
    `${BASE}/wallet`,
    `${BASE}/h/${bs.hubSlug}/pools`,
    `${BASE}/h/${bs.hubSlug}/pools/new`,
    `${BASE}/h/${bs.hubSlug}/rounds`,
    `${BASE}/h/${bs.hubSlug}/rounds/new`,
    `${BASE}/h/${bs.hubSlug}/intents`,
    `${BASE}/h/${bs.hubSlug}/intents/new`,
    `${BASE}/h/${bs.hubSlug}/proposals`,
    `${BASE}/h/${bs.hubSlug}/tasks`,
    `${BASE}/agents/${bs.fortCollins}`,
  ]
  // Next.js compile is route-keyed, not user-keyed — one user's warm
  // pass covers every subsequent visitor's first hit.
  await warmLogin('cat-user-001')
  for (const url of warmUrls) {
    try {
      await w.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await w.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
    } catch { /* non-fatal */ }
  }
  await ctx.close()
  console.log('[full-demo] pre-warm complete')

  // Record before-balance for the finale assertion.
  // The recipient treasury is Fort Collins's sa:hasTreasury — we resolve
  // by reading the resolver property directly here so we don't need it
  // from bootstrap.
  recipientTreasury = await resolveOrgTreasury(bs.fortCollins)
  balanceBefore = await readUsdcBalance(recipientTreasury)
  console.log(`[full-demo] Fort Collins Treasury balance before: $${(Number(balanceBefore) / 1_000_000).toLocaleString()}`)
})

async function resolveOrgTreasury(orgSa: Address): Promise<Address> {
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address
  const resolverAbi = [
    { type: 'function', name: 'getAddressProperty', stateMutability: 'view',
      inputs: [{ name: 'a', type: 'address' }, { name: 'k', type: 'bytes32' }],
      outputs: [{ type: 'address' }] },
  ] as const
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
  const { keccak256, toBytes } = viemMod
  const SA_HAS_TREASURY = keccak256(toBytes('sa:hasTreasury'))
  const t = await pub.readContract({
    address: resolver, abi: resolverAbi,
    functionName: 'getAddressProperty', args: [orgSa, SA_HAS_TREASURY],
  }) as Address
  return t && t !== '0x0000000000000000000000000000000000000000' ? t : orgSa
}

test('Full UI grant lifecycle — Maria → David → Sarah → Maria', async ({ browser }) => {
  test.setTimeout(720_000) // 12 min cap — full UI walk

  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.resolve(__dirname, 'demo-output'), size: { width: 1440, height: 900 } },
  })
  await ctx.addInitScript(CHROME_SCRIPT)
  const page = await ctx.newPage()
  // Auto-accept native confirm() dialogs (used by "Finalize awards").
  page.on('dialog', d => { void d.accept() })

  const pause = (ms: number) => page.waitForTimeout(ms)
  const READ = 2400  // banner-read pause
  const SETTLE = 1100 // post-action visual settle

  // Unique slug suffix per run so re-runs don't collide.
  const RUN_SUFFIX = Math.floor(Date.now() / 1000).toString(36)
  const POOL_NAME  = `Demo Grant Pool ${RUN_SUFFIX}`
  const POOL_SLUG  = `demo-grant-pool-${RUN_SUFFIX}`
  const ROUND_NAME = `Demo Grant Round ${RUN_SUFFIX}`
  const ROUND_SLUG = `demo-grant-round-${RUN_SUFFIX}`
  const PROPOSAL_TITLE = `Trauma-care training cohort ${RUN_SUFFIX}`

  // ── Chapter 1: Maria signs in ───────────────────────────────────────
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
  await setBanner(page, 1, TOTAL_CHAPTERS,
    'Maria signs in',
    'Demo users are real on-chain principals — same flow as a passkey/SIWE production user.',
  )
  await pause(READ)
  {
    const btn = page.locator(`[data-testid="demo-login-cat-user-001"]`)
    await btn.scrollIntoViewIfNeeded()
    await btn.hover(); await pause(700)
    await btn.click()
    await page.waitForURL(/\/h\/.+\/home|\/dashboard/, { timeout: 30_000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  }
  await pause(SETTLE)

  // ── Chapter 2: review wallet — $1M treasury ─────────────────────────
  await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' })
  await setBanner(page, 2, TOTAL_CHAPTERS,
    'Maria\'s wallet — $1M USDC in her treasury',
    'Money never sits on her smart account. A separate Treasury Service Agent custodies USDC.',
  )
  await pause(READ + 800)

  // ── Chapter 3: create a new pool ────────────────────────────────────
  await page.goto(`${BASE}/h/${bs.hubSlug}/pools/new`, { waitUntil: 'networkidle' })
  await setBanner(page, 3, TOTAL_CHAPTERS,
    'Maria creates a new grant pool',
    'The pool\'s AgentAccount is co-owned by Catalyst NoCo Network so stewards = org owners.',
  )
  await pause(READ)
  await fillPoolForm(page, { displayName: POOL_NAME, slug: POOL_SLUG })
  await pause(700)
  await page.getByRole('button', { name: /Create pool/i }).first().click()
  await page.waitForURL(/\/pools\//, { timeout: 60_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  await pause(SETTLE + 800)

  // Capture the resulting pool detail URL so we can navigate back later.
  const poolDetailUrl = page.url()

  // ── Chapter 4: pledge $30k ──────────────────────────────────────────
  await setBanner(page, 4, TOTAL_CHAPTERS,
    'Maria pledges $30,000 to the pool',
    'PledgeRegistry records the commitment. The honor step (next chapter) actually moves USDC.',
  )
  await pause(READ)
  let pledgeDetailUrl: string | null = null
  {
    const pledgeBtn = page.getByRole('link', { name: /Pledge to this pool/i })
      .or(page.getByRole('button', { name: /Pledge/i }))
    await pledgeBtn.first().click().catch(async () => {
      // Fallback — direct navigation if button isn't found.
      await page.goto(poolDetailUrl + '/pledge', { waitUntil: 'networkidle' })
    })
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    await pause(800)
    await fillPledgeForm(page, '30000')
    await pause(600)
    await page.getByRole('button', { name: /Submit pledge/i }).first().click()
    // After submit, server-action redirect lands on /pledges/<id> OR
    // back to the pool detail. Wait for either + capture URL.
    await page.waitForURL(/\/pledges\/|\/pools\//, { timeout: 60_000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    const finalUrl = page.url()
    if (/\/pledges\/[^/?]+/.test(finalUrl)) {
      pledgeDetailUrl = finalUrl
    }
  }
  await pause(SETTLE + 600)

  // ── Chapter 5: honor the pledge ─────────────────────────────────────
  // If pledge submit redirected to the detail page, we're already there.
  // Otherwise navigate via the pool detail's pledges section.
  if (pledgeDetailUrl) {
    await page.goto(pledgeDetailUrl, { waitUntil: 'networkidle' })
  } else {
    // Fallback — go to pool detail, find the most recent pledge link.
    await page.goto(poolDetailUrl, { waitUntil: 'networkidle' })
    const pledgeLink = page.locator('a[href*="/pledges/"]').filter({ hasNotText: /My pledges|Browse|All/i }).first()
    if (await pledgeLink.count() > 0) {
      await pledgeLink.click()
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    }
  }
  await setBanner(page, 5, TOTAL_CHAPTERS,
    'Maria honors the pledge — USDC moves from her treasury to the pool',
    'executeBatch on her treasury: ERC-20 transfer + PledgeRegistry.markPaid in a single tx.',
  )
  await pause(READ)
  {
    const honorBtn = page.getByRole('button', { name: /Honor pledge/i })
    if (await honorBtn.count() > 0) {
      await honorBtn.first().hover(); await pause(500)
      await honorBtn.first().click()
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
    }
  }
  await pause(SETTLE + 600)

  // ── Chapter 6: open a grant round ───────────────────────────────────
  await page.goto(`${BASE}/h/${bs.hubSlug}/rounds/new`, { waitUntil: 'networkidle' })
  await setBanner(page, 6, TOTAL_CHAPTERS,
    'Maria opens a grant round on her pool',
    'The round inherits the pool\'s stewards. Validators are listed by EOA — Sarah for this demo.',
  )
  await pause(READ)
  await fillRoundForm(page, {
    poolName: POOL_NAME,
    displayName: ROUND_NAME,
    slug: ROUND_SLUG,
    validatorEoa: bs.sarahEoa,
  })
  await pause(700)
  await page.getByRole('button', { name: /Open round/i }).first().click()
  await page.waitForURL(/\/rounds\//, { timeout: 60_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  const roundDetailUrl = page.url()
  await pause(SETTLE + 600)

  // ── Chapter 7: David signs in ───────────────────────────────────────
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
  await setBanner(page, 7, TOTAL_CHAPTERS,
    'Pastor David signs in',
    'Switching principals is a normal session swap — no on-chain "logout"; just a different session cookie.',
  )
  await pause(READ - 600)
  {
    const btn = page.locator(`[data-testid="demo-login-cat-user-002"]`)
    await btn.scrollIntoViewIfNeeded()
    await btn.hover(); await pause(700)
    await btn.click()
    await page.waitForURL(/\/h\/.+\/home|\/dashboard/, { timeout: 30_000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  }
  await pause(SETTLE)

  // ── Chapter 8: David expresses a NeedIntent ─────────────────────────
  await page.goto(`${BASE}/h/${bs.hubSlug}/intents/new`, { waitUntil: 'networkidle' })
  await setBanner(page, 8, TOTAL_CHAPTERS,
    'David expresses a NeedIntent — "Need funding for trauma-care training"',
    'Public intents emit an on-chain assertion + sync to the catalog so funders can discover them.',
  )
  await pause(READ)
  const intentTitle = `Need funding for trauma-care training ${RUN_SUFFIX}`
  await fillIntentForm(page, intentTitle)
  await pause(700)
  await page.getByRole('button', { name: /Express intent/i }).first().click()
  await page.waitForURL(/\/intents\//, { timeout: 60_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  await pause(SETTLE + 600)

  // ── Chapter 9: David applies to the round ──────────────────────────
  await page.goto(`${roundDetailUrl}/apply`, { waitUntil: 'networkidle' })
  await setBanner(page, 9, TOTAL_CHAPTERS,
    'David applies to Maria\'s round',
    'Proposal anchors to his NeedIntent. Milestones split the award into validator-gated tranches.',
  )
  await pause(READ)
  await fillProposalForm(page, { title: PROPOSAL_TITLE })
  await pause(700)
  await page.getByRole('button', { name: /Submit proposal/i }).first().click()
  await page.waitForURL(/\/proposals\//, { timeout: 60_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  const proposalDetailUrl = page.url()
  await pause(SETTLE + 600)

  // ── Chapter 10: switch to Maria, vote Approve ──────────────────────
  await uiLogin(page, 'cat-user-001')
  await page.goto(proposalDetailUrl, { waitUntil: 'networkidle' })
  await setBanner(page, 10, TOTAL_CHAPTERS,
    'Maria votes Approve',
    'Voting policy is "steward-quorum" — 2 approvals required for the round to award.',
  )
  await pause(READ)
  await castVote(page, 'Approve', 'Strong plan, clear milestones.')
  await pause(SETTLE + 400)

  // ── Chapter 11: switch to David, vote Approve ──────────────────────
  await uiLogin(page, 'cat-user-002')
  await page.goto(proposalDetailUrl, { waitUntil: 'networkidle' })
  await setBanner(page, 11, TOTAL_CHAPTERS,
    'David votes Approve on his own proposal',
    'Proposers can vote in this round template. In stricter templates a recusal rule applies.',
  )
  await pause(READ - 300)
  await castVote(page, 'Approve', 'Confident in delivery.')
  await pause(SETTLE + 400)

  // ── Chapter 12: Maria finalises the round ───────────────────────────
  await uiLogin(page, 'cat-user-001')
  await page.goto(`${roundDetailUrl}/admin`, { waitUntil: 'networkidle' })
  await setBanner(page, 12, TOTAL_CHAPTERS,
    'Maria finalises the round — announces award + commits',
    'Single click triggers setRoundStatus(decided) + announceAward + CommitmentRegistry.commit.',
  )
  await pause(READ)
  {
    // Switch to Lifecycle tab.
    const lifecycleTab = page.getByRole('button', { name: /lifecycle/i })
    if (await lifecycleTab.count() > 0) {
      await lifecycleTab.first().click()
      await pause(500)
    }
    // If the round is still in `open`, advance to `review` first so the
    // Finalize button is visible.
    const toReviewBtn = page.getByRole('button', { name: /Close submissions, open voting/i })
    if (await toReviewBtn.count() > 0) {
      await toReviewBtn.first().click()
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
      await pause(900)
    }
    // Finalize awards.
    const finalizeBtn = page.getByRole('button', { name: /Finalize awards from tally/i })
    await finalizeBtn.first().hover()
    await pause(500)
    await finalizeBtn.first().click()
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  }
  await pause(SETTLE + 800)

  // ── Chapter 13: Sarah attests both milestones ───────────────────────
  await uiLogin(page, 'cat-user-005')
  await page.goto(`${BASE}/h/${bs.hubSlug}/tasks`, { waitUntil: 'networkidle' })
  await setBanner(page, 13, TOTAL_CHAPTERS,
    'Sarah (validator) attests both milestones',
    'Validator gate is off-chain (AnonCreds in production); on-chain attestation is what unlocks each tranche.',
  )
  await pause(READ)
  await attestMilestones(page, 2)
  await pause(SETTLE + 400)

  // ── Chapter 14: Maria releases both tranches ────────────────────────
  await uiLogin(page, 'cat-user-001')
  await page.goto(`${BASE}/h/${bs.hubSlug}/tasks`, { waitUntil: 'networkidle' })
  await setBanner(page, 14, TOTAL_CHAPTERS,
    'Maria (steward) releases both tranches',
    'Each release is an executeBatch on the pool: USDC transfer + CommitmentRegistry.recordRelease.',
  )
  await pause(READ)
  await releaseTranches(page, 2)
  await pause(SETTLE + 400)

  // ── Chapter 15: Outcome — Fort Collins Treasury showing the money ──
  await page.goto(`${BASE}/agents/${bs.fortCollins}`, { waitUntil: 'networkidle' })
  const balanceAfter = await readUsdcBalance(recipientTreasury)
  const delta = balanceAfter - balanceBefore
  const before$ = (Number(balanceBefore) / 1_000_000).toLocaleString()
  const after$  = (Number(balanceAfter)  / 1_000_000).toLocaleString()
  const delta$  = (Number(delta)         / 1_000_000).toLocaleString()
  await setBanner(page, 15, TOTAL_CHAPTERS,
    `+$${delta$} settled into Fort Collins Network Treasury`,
    `Treasury balance: $${before$} → $${after$}  ·  Smart account → sa:hasTreasury → on-chain USDC`,
  )
  await pause(7000)
  await hideBanner(page)
  await pause(400)

  await ctx.close()

  // ── Correctness assertion ──────────────────────────────────────────
  const THIRTY_K = 30_000n * 10n ** 6n
  expect(delta, `Fort Collins Treasury should grow by exactly $30k — got ${delta.toString()}`).toBe(THIRTY_K)
  console.log(`[full-demo] Fort Collins Treasury after: $${after$}  (Δ +$${delta$})`)
})

// ─── Form fillers ──────────────────────────────────────────────────────

async function fillPoolForm(page: Page, p: { displayName: string; slug: string }): Promise<void> {
  // Display name + slug. Other fields keep their defaults (Catalyst is
  // the only operating org Maria has authority on, so the org select
  // auto-resolves).
  await page.getByLabel(/Display name/i).first().fill(p.displayName)
  // Slug field — clear any auto-fill, then enter ours.
  const slug = page.getByLabel(/Slug/i).first()
  await slug.fill('')
  await slug.fill(p.slug)
  // Visibility = public (the pool needs to be discoverable by David).
  const vis = page.getByLabel(/Visibility/i).first()
  if (await vis.count() > 0) await vis.selectOption('public').catch(() => {})
}

async function fillPledgeForm(page: Page, dollars: string): Promise<void> {
  // The amount input lives near placeholder "100".
  const amount = page.getByPlaceholder(/^100$/).first()
    .or(page.locator('input[type="number"]').first())
  await amount.fill(dollars)
}

async function fillRoundForm(page: Page, r: {
  poolName: string
  displayName: string
  slug: string
  validatorEoa: Address
}): Promise<void> {
  // Pool select — pick the pool Maria just created by display name.
  const poolSel = page.getByLabel(/Pool this round draws from/i).first()
  if (await poolSel.count() > 0) {
    await poolSel.selectOption({ label: r.poolName }).catch(async () => {
      // Fallback: select first option.
      await poolSel.selectOption({ index: 1 }).catch(() => {})
    })
  }
  await page.getByLabel(/Round slug/i).first().fill(r.slug)
  await page.getByLabel(/Display name/i).first().fill(r.displayName)
  // Validator list — find an input that accepts validator addresses if
  // present; else skip (round will default to no validators, which means
  // any pool steward can attest as a fallback).
  const validators = page.getByLabel(/[Vv]alidator/).first()
  if (await validators.count() > 0) {
    try { await validators.fill(r.validatorEoa) } catch { /* not a text input */ }
  }
}

async function fillIntentForm(page: Page, title: string): Promise<void> {
  // Step 1 — direction
  const receive = page.getByRole('button', { name: /^Receive/i }).first()
  await receive.click()
  await page.waitForTimeout(400)
  // Step 2 — pick an intent type that's a money-receive ("Need funding").
  const moneyTile = page.getByRole('button', { name: /Need funding|Money/i }).first()
  if (await moneyTile.count() > 0) {
    await moneyTile.click().catch(() => {})
  }
  await page.waitForTimeout(400)
  // Title
  const titleField = page.getByLabel(/Title/i).first()
  await titleField.fill(title)
}

async function fillProposalForm(page: Page, p: { title: string }): Promise<void> {
  // Title
  await page.getByLabel(/Title/i).first().fill(p.title)
  // First budget line item
  const lineName = page.getByPlaceholder(/Line item/i).first()
  if (await lineName.count() > 0) await lineName.fill('Cohort delivery')
  const amount = page.getByPlaceholder(/^Amount$/i).first()
  if (await amount.count() > 0) await amount.fill('30000')
  const unit = page.getByPlaceholder(/^Unit$/i).first()
  if (await unit.count() > 0) await unit.fill('USD')
  // Plan narrative — first big textarea.
  const planArea = page.locator('textarea').first()
  if (await planArea.count() > 0) {
    await planArea.fill('Run a 12-week trauma-informed care cohort for Fort Collins families. 4 monthly sessions × 3 months.')
  }
  // Organisational background — the second textarea on the page.
  const bgArea = page.locator('textarea').nth(1)
  if (await bgArea.count() > 0) {
    await bgArea.fill('Fort Collins Network has facilitated 18 family-support cohorts since 2022 across northern Colorado.')
  }
}

async function castVote(page: Page, choice: 'Approve' | 'Reject', rationale: string): Promise<void> {
  const choiceBtn = page.getByRole('button', { name: new RegExp(`^${choice}$`, 'i') }).first()
  await choiceBtn.hover(); await page.waitForTimeout(500)
  await choiceBtn.click()
  await page.waitForTimeout(400)
  const rationaleField = page.getByPlaceholder(/Optional rationale/i).first()
  if (await rationaleField.count() > 0) {
    await rationaleField.fill(rationale)
    await page.waitForTimeout(400)
  }
  const submitBtn = page.getByRole('button', { name: /Cast vote|Update vote/i }).first()
  if (await submitBtn.count() > 0) {
    await submitBtn.click()
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  }
}

async function attestMilestones(page: Page, expected: number): Promise<void> {
  for (let i = 0; i < expected; i++) {
    const btn = page.getByRole('button', { name: /Attest delivered/i })
    const count = await btn.count()
    if (count === 0) break
    const row = btn.first()
    // Fill evidence in the nearest input above this button.
    const evidence = page.getByPlaceholder(/Evidence summary/i).first()
    if (await evidence.count() > 0) {
      await evidence.fill(`Milestone ${i + 1} delivered — evidence on file.`)
      await page.waitForTimeout(500)
    }
    await row.click()
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(900)
  }
}

async function releaseTranches(page: Page, expected: number): Promise<void> {
  for (let i = 0; i < expected; i++) {
    const btn = page.getByRole('button', { name: /Approve & release/i })
    const count = await btn.count()
    if (count === 0) break
    await btn.first().hover(); await page.waitForTimeout(400)
    await btn.first().click()
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
    await page.waitForTimeout(900)
  }
}
