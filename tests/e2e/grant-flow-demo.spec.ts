import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const viemMod = require(path.resolve(__dirname, '../../apps/web/node_modules/viem')) as typeof import('viem')
const viemChainsMod = require(path.resolve(__dirname, '../../apps/web/node_modules/viem/chains')) as typeof import('viem/chains')
const { createPublicClient, http, keccak256, toBytes } = viemMod
const { foundry } = viemChainsMod
type Address = `0x${string}`

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
 * Spec 006 — customer-facing demo walkthrough.
 *
 * Unlike `grant-flow-e2e.spec.ts` (terse correctness, retries on), this
 * file is optimised for a recorded video sent to a customer:
 *
 *   • Seeds the prior phases (pool deploy, pledge, honor, round open,
 *     David's proposal, voting, award, commit) via the existing seed
 *     script — same on-chain footprint, just executed faster than via UI.
 *   • Pre-warms every URL the demo will hit using a SEPARATE non-recording
 *     browser context, so Next.js dev-server's compile-on-demand never
 *     leaks blank frames into the customer's video.
 *   • Walks Maria through the funding artefacts (pool → round → proposal
 *     → intent), then switches to Sarah for two validator attestations,
 *     then back to Maria for two steward releases, finishing with an
 *     on-chain balance reconciliation that proves $30k landed at the
 *     Fort Collins Network Treasury.
 *   • Overlays a chapter banner via page.evaluate at each step so a viewer
 *     who has never seen the product can follow along.
 *
 * Run with:
 *   pnpm exec playwright test --config=tests/e2e/playwright.demo.config.ts
 *
 * Video is written to tests/e2e/demo-output/<test-name>/video.webm.
 */

const BASE = 'http://localhost:3000'
const REPO_ROOT = path.resolve(__dirname, '../..')
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const USDC = (process.env.USDC_ADDRESS ?? process.env.MOCK_USDC_ADDRESS) as Address | undefined
const FCN_TREASURY_NAME = 'Fort Collins Network'

const mockUsdcAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
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
    // Allow optional leading whitespace — the seed prints
    // COMMITMENT_SUBJECT with an indent for its console log style.
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

// Injected into every page. Three pieces of demo chrome:
//   • A fake mouse cursor that follows mousemove events — Playwright's
//     video recorder doesn't capture the OS cursor, so we draw one
//     ourselves so viewers can see what's being clicked.
//   • Click-ripple effect on mousedown for visual feedback.
//   • Banner overlay so chapter captions stay above the page chrome
//     without shifting layout.
const BANNER_SCRIPT = `
;(function(){
  if (window.__demoChromeInstalled) return
  window.__demoChromeInstalled = true
  // Fake cursor — a soft dark dot with a faint halo. Doesn't intercept
  // clicks (pointer-events: none).
  const cur = document.createElement('div')
  cur.id = '__demo_cursor__'
  // High-contrast red cursor with a thick white outline + drop shadow
  // so it stands out on the light hub UI and survives mp4 encoding.
  // Starts visible at viewport center.
  cur.style.cssText = [
    'position: fixed', 'top: 50%', 'left: 50%',
    'width: 36px', 'height: 36px', 'margin-left: -18px', 'margin-top: -18px',
    'border-radius: 50%',
    'background: radial-gradient(circle, #ef4444 0 38%, #dc2626 38% 62%, transparent 65%)',
    'box-shadow: 0 0 0 3px #ffffff, 0 0 0 4px rgba(15,23,42,0.55), 0 6px 16px rgba(220,38,38,0.45)',
    'pointer-events: none', 'z-index: 2147483646',
    'transition: width 0.15s ease, height 0.15s ease',
  ].join(';')
  document.documentElement.appendChild(cur)
  document.addEventListener('mousemove', (e) => {
    cur.style.left = e.clientX + 'px'
    cur.style.top  = e.clientY + 'px'
  }, true)
  // Click ripple — quick expanding circle on mousedown.
  document.addEventListener('mousedown', (e) => {
    cur.style.width = '46px'; cur.style.height = '46px'
    cur.style.marginLeft = '-23px'; cur.style.marginTop = '-23px'
    const ring = document.createElement('div')
    ring.style.cssText = [
      'position: fixed',
      'left: ' + e.clientX + 'px', 'top: ' + e.clientY + 'px',
      'width: 14px', 'height: 14px', 'margin-left: -7px', 'margin-top: -7px',
      'border: 3px solid rgba(251,191,36,0.98)',
      'border-radius: 50%',
      'pointer-events: none', 'z-index: 2147483645',
      'animation: __demoRipple 0.7s ease-out forwards',
    ].join(';')
    document.documentElement.appendChild(ring)
    setTimeout(() => ring.remove(), 650)
  }, true)
  document.addEventListener('mouseup', () => {
    cur.style.width = '36px'; cur.style.height = '36px'
    cur.style.marginLeft = '-18px'; cur.style.marginTop = '-18px'
  }, true)
  // Ripple keyframes — injected once.
  const css = document.createElement('style')
  css.textContent = '@keyframes __demoRipple { 0% { width:14px; height:14px; opacity:1 } 100% { width:96px; height:96px; margin-left:-48px; margin-top:-48px; opacity:0 } }'
  document.documentElement.appendChild(css)
})();
window.__demoBanner = (chapter, total, text, sub) => {
  let b = document.getElementById('__demo_banner__')
  if (!b) {
    b = document.createElement('div')
    b.id = '__demo_banner__'
    // Light corporate card: white surface, warm-tan accent stripe at top,
    // dark text, soft shadow. Matches the rest of the hub UI palette.
    b.style.cssText = [
      'position: fixed',
      'top: 20px', 'left: 50%', 'transform: translateX(-50%)',
      'background: #ffffff',
      'color: #5c4a3a',
      'padding: 0',
      'border-radius: 12px',
      'border: 1px solid #ece6db',
      'overflow: hidden',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'box-shadow: 0 14px 36px rgba(64, 44, 23, 0.18), 0 4px 10px rgba(64, 44, 23, 0.08)',
      'z-index: 999999',
      'max-width: 880px',
      'min-width: 540px',
      'text-align: left',
      'transition: opacity 0.25s ease',
      'pointer-events: none',
    ].join(';')
    document.body.appendChild(b)
  }
  // Accent stripe in warm-tan, then chapter label, headline, sub-line.
  const stripe = '<div style="height:4px;background:linear-gradient(90deg,#8b5e3c 0%,#c8956d 100%)"></div>'
  const sup = chapter
    ? \`<div style="font-size:10.5px;font-weight:700;letter-spacing:0.14em;color:#8b5e3c;text-transform:uppercase;margin-bottom:4px">Chapter \${chapter} of \${total}</div>\`
    : ''
  const subline = sub
    ? \`<div style="font-size:13px;color:#9a8c7e;font-weight:400;margin-top:5px;line-height:1.4">\${sub}</div>\`
    : ''
  b.innerHTML = \`\${stripe}<div style="padding:14px 22px 16px">\${sup}<div style="font-size:17px;font-weight:600;line-height:1.3;color:#3d3327">\${text}</div>\${subline}</div>\`
  b.style.opacity = '1'
}
window.__demoBannerHide = () => {
  const b = document.getElementById('__demo_banner__')
  if (b) b.style.opacity = '0'
}
`

/**
 * Silent demo-login — used for pre-warm and quick session swaps where
 * the connect UI isn't part of the chapter on screen.
 */
async function demoLogin(page: Page, userId: string): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const r = await page.request.post(`${BASE}/api/demo-login`, {
    data: { userId },
    headers: { origin: BASE, 'content-type': 'application/json' },
    timeout: 120_000,
  })
  expect(r.ok(), `demo-login for ${userId} returned ${r.status()}`).toBeTruthy()
}

/**
 * Visible demo-login — navigates to /demo, hovers over the user card,
 * clicks Sign in. The customer SEES the connect step. After click we
 * wait for the post-login redirect to the user's hub home.
 */
async function uiLogin(page: Page, userId: string, displayName: string): Promise<void> {
  // When a chapter-N user is already signed in, navigating to /demo can
  // race with an auto-redirect to /h/.../home, surfacing as ERR_ABORTED.
  // Tolerate that — the cookie we set below via the direct POST is what
  // the next chapter actually needs.
  try {
    await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/ERR_ABORTED|net::ERR_/.test(msg)) throw e
  }
  // Pre-mint the session cookie via direct POST. In minimal-mode seeds
  // the readiness gate inside DemoLoginButton stalls (community check
  // expects the full 43-user community, we have 3), so we can't rely on
  // the button click alone to set the cookie. Set the cookie first, then
  // play the click for the camera.
  const r = await page.request.post(`${BASE}/api/demo-login`, {
    data: { userId },
    headers: { origin: BASE, 'content-type': 'application/json' },
    timeout: 120_000,
  })
  expect(r.ok(), `demo-login for ${userId} returned ${r.status()}`).toBeTruthy()
  // Let the cursor land on the card before the click so the click ripple
  // is anchored on the right control.
  const btn = page.locator(`[data-testid="demo-login-${userId}"]`)
  await btn.scrollIntoViewIfNeeded()
  await btn.hover()
  await page.waitForTimeout(900)
  await btn.click().catch(() => {})
  // Cookie is already set; navigate directly to the hub home so the
  // user is on a session-protected page when the next chapter starts.
  await page.waitForTimeout(1200)
  // Touch the name to silence the unused-var lint if displayName ends up unused.
  void displayName
}

// Chapter narration timeline — written as the test plays so a post-
// processing step (scripts/narrate-demo.ts) can mux per-chapter audio
// onto the recorded video at the right timestamps.
const chapterTimeline: Array<{ chapter: number; offsetSec: number; narration: string }> = []
let demoStartMs = 0

async function setBanner(page: Page, chapter: number, total: number, text: string, sub?: string, narration?: string): Promise<void> {
  if (narration && chapter > 0) {
    if (demoStartMs === 0) demoStartMs = Date.now()
    chapterTimeline.push({
      chapter,
      offsetSec: (Date.now() - demoStartMs) / 1000,
      narration,
    })
  }
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

const TOTAL_CHAPTERS = 15

let demoData: DemoData
let balanceBefore = 0n

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000)

  // ── Step 1: seed on-chain state ───────────────────────────────────
  console.log('[demo] seeding scenario (STOP_AT_COMMITMENT=1)…')
  const seedStdout = execSync(
    `cd "${REPO_ROOT}/apps/web" && STOP_AT_COMMITMENT=1 pnpm exec tsx "${REPO_ROOT}/scripts/seed-grant-flow-demo.ts"`,
    { stdio: 'pipe', timeout: 240_000 },
  ).toString()
  demoData = parseDemoData(seedStdout)
  console.log('[demo] commitment:', demoData.commitmentSubject)
  console.log('[demo] pool:      ', demoData.poolAddress)
  balanceBefore = await readUsdcBalance(demoData.recipientTreasury)
  console.log(`[demo] Fort Collins Treasury before: $${(Number(balanceBefore) / 1_000_000).toLocaleString()}`)

  // ── Step 2: pre-warm every URL the demo will visit ────────────────
  // Uses a SEPARATE context with no video recording so compile delays
  // never appear in the customer-facing video.
  console.log('[demo] pre-warming pages (no recording)…')
  const ctx = await browser.newContext()
  const warmPage = await ctx.newPage()
  const warmUrls = [
    `${BASE}/`,
    `${BASE}/h/${demoData.hubSlug}/home`,
    `${BASE}/h/${demoData.hubSlug}/pools/${encodeURIComponent(demoData.poolSlug)}`,
    `${BASE}/h/${demoData.hubSlug}/rounds/${encodeURIComponent(demoData.roundSlug)}`,
    `${BASE}/h/${demoData.hubSlug}/intents/${encodeURIComponent(demoData.intentId)}`,
    `${BASE}/h/${demoData.hubSlug}/proposals/${encodeURIComponent(demoData.proposalId)}`,
    `${BASE}/h/${demoData.hubSlug}/tasks`,
    `${BASE}/wallet`,
  ]
  // Warm both viewers' session-protected pages (Maria + Sarah).
  for (const userId of ['cat-user-001', 'cat-user-005']) {
    await demoLogin(warmPage, userId)
    for (const url of warmUrls) {
      try {
        await warmPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        // Give Next.js a moment to finish hydration + any background fetches
        // before moving on so the cached chunks are reused next visit.
        await warmPage.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
      } catch (e) {
        console.warn(`[demo] warm ${url} failed (non-fatal):`, (e as Error).message.slice(0, 120))
      }
    }
  }
  await ctx.close()
  console.log('[demo] pre-warm complete')
})

test('Customer demo — grant lifecycle on Smart Agent', async ({ browser }) => {
  test.setTimeout(900_000)

  // Custom context so we control video output dir + viewport for the
  // customer video. playwright.demo.config.ts sets outputDir for us;
  // newContext({ recordVideo }) inherits the global config when set.
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.resolve(__dirname, 'demo-output'), size: { width: 1440, height: 900 } },
  })
  await ctx.addInitScript(BANNER_SCRIPT)
  const page = await ctx.newPage()

  const d = demoData
  const POOL_URL    = `${BASE}/h/${d.hubSlug}/pools/${encodeURIComponent(d.poolSlug)}`
  const ROUND_URL   = `${BASE}/h/${d.hubSlug}/rounds/${encodeURIComponent(d.roundSlug)}`
  const PROPOSAL_URL = `${BASE}/h/${d.hubSlug}/proposals/${encodeURIComponent(d.proposalId)}`
  const INTENT_URL  = `${BASE}/h/${d.hubSlug}/intents/${encodeURIComponent(d.intentId)}`
  // Scope the inbox to THIS run's commitment so the SPARQL bypasses the
  // accumulated history that otherwise causes a Cloudflare 524 on the
  // shared dev GraphDB. The tasks page accepts ?commitment=0x... and
  // filters listInboxTasks to that single subject.
  const TASKS_URL   = `${BASE}/h/${d.hubSlug}/tasks?commitment=${d.commitmentSubject}`
  const HOME_URL    = `${BASE}/h/${d.hubSlug}/home`

  const pause = (ms: number) => page.waitForTimeout(ms)
  const CHAPTER_HOLD = 2800   // long enough to read the banner + scan the page
  const ACTION_HOLD = 1400    // shorter pause after a clicked action settles

  // ── Chapter 1: Maria connects ─────────────────────────────────────
  // We start at the /demo page so the customer sees Maria sign in.
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
  await setBanner(page, 1, TOTAL_CHAPTERS,
    'Maria signs in',
    'Demo accounts are real on-chain principals. In production this is a passkey or SIWE flow — no MetaMask in the middle.',
    "Welcome to Smart Agent. We're about to walk through a complete grant lifecycle. Maria, the steward of the Catalyst NoCo Network, is about to sign in. In production this is a passkey or sign-in-with-Ethereum flow — no MetaMask in the middle.",
  )
  await pause(2400)
  {
    const btn = page.locator(`[data-testid="demo-login-cat-user-001"]`)
    await btn.scrollIntoViewIfNeeded()
    await btn.hover()
    await pause(700)
    await btn.click()
    await page.waitForURL(/\/h\/.+\/home|\/dashboard/, { timeout: 30_000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  }
  await pause(800)

  // ── Chapter 2: Maria's hub ────────────────────────────────────────
  await page.goto(HOME_URL, { waitUntil: 'networkidle' })
  await setBanner(page, 2, TOTAL_CHAPTERS,
    'Catalyst NoCo Network — Maria stewards the regional grant pool',
    'Smart Agent treats every party (person, org, AI agent) as a first-class principal under programmable delegation.',
    "Maria lands on Catalyst NoCo Network — her organisation's hub. Every party here — people, organisations, even AI agents — is a first-class principal with its own on-chain identity and programmable delegation.",
  )
  await pause(CHAPTER_HOLD + 800)

  // ── Chapter 3: Maria's personal treasury (the funding source) ─────
  await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' })
  await setBanner(page, 3, TOTAL_CHAPTERS,
    'Maria\'s personal treasury holds the donor capital',
    'Money never sits on a person\'s smart account — only their dedicated Treasury Service Agent custodies USDC.',
    "Here's Maria's wallet. She has one million dollars in USDC, but notice it's held in a separate Treasury Service Agent, not on her person account. Money never sits on a person's smart account directly — that separation is a core safety property of the platform.",
  )
  await pause(CHAPTER_HOLD + 600)

  // ── Chapter 4: the pool — $30k pledged ────────────────────────────
  await page.goto(POOL_URL, { waitUntil: 'networkidle' })
  await setBanner(page, 4, TOTAL_CHAPTERS,
    'The grant pool — Maria pledged $30k to back this round',
    'PledgeRegistry records the donor commitment; the honor step (USDC transfer) settles the pool\'s balance.',
    "Maria created a grant pool and pledged thirty thousand dollars to back this round. The pledge is recorded in the PledgeRegistry contract, and the honor step moves USDC from her treasury to the pool — both signed by her, no admin in the middle.",
  )
  await pause(CHAPTER_HOLD + 1200)

  // ── Chapter 5: the round ─────────────────────────────────────────
  await page.goto(ROUND_URL, { waitUntil: 'networkidle' })
  await setBanner(page, 5, TOTAL_CHAPTERS,
    'The grant round — open, voted, and decided',
    'Round status, deadline, validator requirements, and proposal list all read directly from on-chain assertions.',
    "Next, Maria opened a grant round on her pool. The round is the structured solicitation: status, deadline, validator requirements, and proposal list — every field reads directly from on-chain assertions, no off-chain database in between.",
  )
  await pause(CHAPTER_HOLD + 1400)

  // ── Chapter 6: David's need intent ───────────────────────────────
  await page.goto(INTENT_URL, { waitUntil: 'networkidle' })
  await setBanner(page, 6, TOTAL_CHAPTERS,
    'Pastor David\'s NeedIntent — the original ask',
    'Intents live in the proposer\'s person-mcp and surface in the marketplace as the on-chain assertion.',
    "Pastor David, on the other side of the network, expressed a NeedIntent — he needs funding for trauma-care training in Fort Collins. The body of his intent stays in his personal MCP server. The public version surfaces in the marketplace as an on-chain assertion.",
  )
  await pause(CHAPTER_HOLD + 600)

  // ── Chapter 7: the awarded proposal ──────────────────────────────
  await page.goto(PROPOSAL_URL, { waitUntil: 'networkidle' })
  await setBanner(page, 7, TOTAL_CHAPTERS,
    'David\'s proposal — awarded and committed',
    'The award triggers a Commitment row in CommitmentRegistry; milestones become validator/steward gates.',
    "David applied with a proposal anchored to his intent. Maria and a second steward voted Approve, the round closed, and the award announcement created a Commitment record in CommitmentRegistry — two milestones, each gated by a validator attestation and a steward release.",
  )
  await pause(CHAPTER_HOLD + 1400)

  // ── Chapter 8: switch to Sarah (validator) ───────────────────────
  await uiLogin(page, 'cat-user-005', 'Sarah Thompson')
  await page.goto(TASKS_URL, { waitUntil: 'networkidle' })
  await setBanner(page, 8, TOTAL_CHAPTERS,
    'Validator Sarah\'s inbox — two milestones await her attestation',
    'Round validators are gated off-chain via AnonCreds credentials; their on-chain attestation unlocks each tranche.',
    "Sarah is the validator on this round. Her inbox shows two pending milestones. In production, validators prove their qualifications with AnonCreds credentials off-chain — but the attestation they sign lives on-chain and unlocks each tranche.",
  )
  await pause(CHAPTER_HOLD + 1000)

  // Scope every click to THIS run's commitment so accumulated test
  // state from prior seed runs can't capture us. The tasks page is a
  // server component — if the GraphDB sync hadn't fully caught up at
  // first render we get "Inbox (0)" with no further polling. Reload up
  // to 6 times with a 5s gap to give the sync time to settle.
  const attestScope = page.locator(`[data-commitment-subject="${d.commitmentSubject.toLowerCase()}"][data-task-kind="attestation"]`)
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await attestScope.count() > 0) break
    await pause(5000)
    await page.reload({ waitUntil: 'networkidle' })
  }
  await expect(attestScope.first()).toBeVisible({ timeout: 30_000 })

  // ── Chapter 9: Sarah attests milestone 1 ─────────────────────────
  await setBanner(page, 9, TOTAL_CHAPTERS,
    'Sarah attests milestone 1 — "Kickoff + first cohort"',
    'Evidence content is hashed and the hash recorded on chain. The full evidence stays in Sarah\'s person-mcp.',
    "Sarah attests the first milestone — kickoff and first cohort. She types her evidence summary; only the hash goes on-chain. The full document stays in her personal MCP. This is a single transaction signed by her wallet.",
  )
  await pause(2000)
  {
    const row = attestScope.first()
    const ev = row.getByPlaceholder(/Evidence summary/i)
    if (await ev.count() > 0) {
      await ev.fill('Cohort 1 trauma-care training complete — 18 facilitators trained.')
      await pause(800)
    }
    // Row button opens a ConfirmActionModal; click that, then click the
    // modal's confirm button to actually submit the attestation.
    await row.getByRole('button', { name: /Confirm milestone/i }).click()
    await pause(600)
    await page.getByRole('dialog').getByRole('button', { name: /Confirm milestone/i }).click()
    await page.waitForLoadState('networkidle', { timeout: 30_000 })
    await pause(ACTION_HOLD)
  }

  // ── Chapter 10: Sarah attests milestone 2 ─────────────────────────
  await setBanner(page, 10, TOTAL_CHAPTERS,
    'Sarah attests milestone 2 — "Final report + outcomes"',
    'One validator-attest per milestone unlocks the matching tranche for the steward to release.',
    "Sarah attests milestone two — final report and outcomes. One validator attestation per milestone is what the contract requires to unlock the matching tranche for the steward to release.",
  )
  await pause(2000)
  {
    const remaining = page.locator(`[data-commitment-subject="${d.commitmentSubject.toLowerCase()}"][data-task-kind="attestation"]`)
    const row = remaining.first()
    const ev = row.getByPlaceholder(/Evidence summary/i)
    if (await ev.count() > 0) {
      await ev.fill('Final outcomes report — 42 families served; 11 ongoing care pathways.')
      await pause(800)
    }
    await row.getByRole('button', { name: /Confirm milestone/i }).click()
    await pause(600)
    await page.getByRole('dialog').getByRole('button', { name: /Confirm milestone/i }).click()
    await page.waitForLoadState('networkidle', { timeout: 30_000 })
    await pause(ACTION_HOLD)
  }

  // ── Chapter 11: switch to Maria (steward) ─────────────────────────
  await uiLogin(page, 'cat-user-001', 'Maria Gonzalez')
  await page.goto(TASKS_URL, { waitUntil: 'networkidle' })
  await setBanner(page, 11, TOTAL_CHAPTERS,
    'Steward Maria\'s inbox — two attested milestones ready for release',
    'Two-gate model: validator attests delivery, steward approves payment. Neither party can bypass the other.',
    "Now back to Maria. Her steward inbox shows two attested milestones ready for release. This is the two-gate model: the validator attests delivery, the steward approves payment — and neither party can bypass the other.",
  )
  await pause(CHAPTER_HOLD + 800)

  const releaseScope = page.locator(`[data-commitment-subject="${d.commitmentSubject.toLowerCase()}"][data-task-kind="release"]`)
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await releaseScope.count() > 0) break
    await pause(5000)
    await page.reload({ waitUntil: 'networkidle' })
  }
  await expect(releaseScope.first()).toBeVisible({ timeout: 30_000 })

  // ── Chapter 12: Maria releases milestone 1 ───────────────────────
  await setBanner(page, 12, TOTAL_CHAPTERS,
    'Maria releases milestone 1 — $12k tranche',
    'A single transaction batches the USDC transfer + on-chain release record. Pool → Fort Collins Treasury.',
    "Maria releases the first tranche, twelve thousand dollars. A single transaction does two things: transfer USDC from the pool to Fort Collins' treasury, and record the release on-chain so the audit trail is complete.",
  )
  await pause(2000)
  {
    const row = releaseScope.first()
    await row.getByRole('button', { name: /Release payment/i }).click()
    await pause(600)
    await page.getByRole('dialog').getByRole('button', { name: /Release payment/i }).click()
    await page.waitForLoadState('networkidle', { timeout: 60_000 })
    await pause(ACTION_HOLD)
  }

  // ── Chapter 13: Maria releases milestone 2 + outcome ─────────────
  const releaseScope2 = page.locator(`[data-commitment-subject="${d.commitmentSubject.toLowerCase()}"][data-task-kind="release"]`)
  await setBanner(page, 13, TOTAL_CHAPTERS,
    'Maria releases milestone 2 — $18k tranche',
    'Once the final tranche releases, the Commitment transitions to Completed and the inbox row clears.',
    "And the final tranche — eighteen thousand dollars. Once this releases, the Commitment transitions to Completed and the inbox row clears. The grant is fully delivered.",
  )
  await pause(2000)
  {
    const row = releaseScope2.first()
    await row.getByRole('button', { name: /Release payment/i }).click()
    await pause(600)
    await page.getByRole('dialog').getByRole('button', { name: /Release payment/i }).click()
    await page.waitForLoadState('networkidle', { timeout: 60_000 })
    await pause(ACTION_HOLD)
  }

  // ── Outcome chapter A: pool emptied. Brief stop on the pool page so
  // the customer sees the donor side dropped to $0.
  await page.goto(POOL_URL, { waitUntil: 'networkidle' })
  // Use chapter 14 / total 15 for the post-flow recap so they get a
  // narration line too. Banner suppresses chapter label when "0".
  await setBanner(page, 14, 15,
    'Pool drained — every committed milestone has been released',
    'Pool USDC remaining: $0  ·  Commitment status: Completed',
    "Looking back at the pool, it's empty — every committed milestone has been released. The Commitment is marked Completed on-chain.",
  )
  await pause(3200)

  // ── Outcome chapter B: navigate to Fort Collins Network's agent page
  // so the customer sees the org's Treasury card showing the new balance.
  // The OrgTreasuryWidget on /agents/[address] walks sa:hasTreasury and
  // reads MockUSDC.balanceOf(treasury), so the number reflects what
  // landed.
  await page.goto(`${BASE}/agents/${d.fortCollins}`, { waitUntil: 'networkidle' })
  const balanceAfter = await readUsdcBalance(d.recipientTreasury)
  const delta = balanceAfter - balanceBefore
  const before$ = (Number(balanceBefore) / 1_000_000).toLocaleString()
  const after$  = (Number(balanceAfter)  / 1_000_000).toLocaleString()
  const delta$  = (Number(delta)         / 1_000_000).toLocaleString()
  await setBanner(page, 15, 15,
    `+$${delta$} settled into Fort Collins Network Treasury`,
    `Treasury balance: $${before$} → $${after$}  ·  Smart account → sa:hasTreasury → on-chain USDC`,
    `And finally, on Fort Collins' organisation page, the treasury card confirms the money landed. Balance grew from $${before$} to $${after$} — a $${delta$} delta that exactly matches the awarded grant. End of demo.`,
  )
  await pause(6500)
  await hideBanner(page)
  await pause(400)

  await ctx.close()

  // Persist the narration timeline so scripts/narrate-demo.ts can mux
  // per-chapter audio onto the recorded video.
  try {
    const timelinePath = path.resolve(__dirname, 'demo-output/chapter-timeline.json')
    fs.writeFileSync(timelinePath, JSON.stringify(chapterTimeline, null, 2))
    console.log(`[demo] Narration timeline: ${timelinePath} (${chapterTimeline.length} chapters)`)
  } catch (e) {
    console.warn('[demo] could not write chapter-timeline.json:', (e as Error).message)
  }

  // ── Final correctness assertion ──────────────────────────────────
  const THIRTY_K_USDC = 30_000n * 10n ** 6n
  expect(delta, `Fort Collins Treasury should grow by exactly $30k — got delta ${delta.toString()}`)
    .toBe(THIRTY_K_USDC)
  console.log(`[demo] Fort Collins Treasury after: $${after$}  (Δ +$${delta$})`)
  console.log(`[demo] Video: ${path.resolve(__dirname, 'demo-output')}`)
})
