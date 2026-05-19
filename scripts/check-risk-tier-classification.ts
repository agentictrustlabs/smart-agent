#!/usr/bin/env tsx
/**
 * Spec 007 Phase G.2 — risk-tier classification lint.
 *
 * Every web API route that emits an on-chain write or signs a delegation
 * MUST have a `@sa-risk-tier` annotation in its top-of-file JSDoc block.
 * This coordinates with Phase B's risk tier registry: the variant-A vs
 * variant-B session selection depends on the action's risk tier, and
 * routes that affect that decision must declare it explicitly.
 *
 * Detection:
 *   - file lives under apps/web/src/app/api/**\/route.ts
 *   - file mentions one of the chain-write / delegation-sign primitives:
 *     `writeContract`, `sendTransaction`, `signTypedData`, `signUserOp`,
 *     `signDelegation`, `mintDelegationToken`, `callA2a`, `executeUserOp`,
 *     `redeemDelegation`, `executeCallsAsAgent`
 *   - top-of-file JSDoc lacks `@sa-risk-tier <low|medium|high|critical>`
 *
 * Allowed tier values: `low`, `medium`, `high`, `sensitive` — matches
 * the existing `parseRouteClassification` enforcement in
 * `scripts/lib/route-classification-parser.ts`. (`critical` is rejected
 * there too; Phase B's SDK risk-tier enum uses the same four values.)
 *
 * Exit codes:
 *   0 — clean
 *   1 — violation
 *   2 — internal failure
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')
const WEB_API_DIR = join(REPO_ROOT, 'apps/web/src/app/api')

const CHAIN_PRIMITIVES = [
  'writeContract',
  'sendTransaction',
  'signTypedData',
  'signUserOp',
  'signDelegation',
  'mintDelegationToken',
  'callA2a',
  'executeUserOp',
  'redeemDelegation',
  'executeCallsAsAgent',
]
const PRIMITIVES_RE = new RegExp(`\\b(?:${CHAIN_PRIMITIVES.join('|')})\\s*\\(`)

const RISK_TIER_RE = /@sa-risk-tier\s+(low|medium|high|sensitive)\b/

interface Violation {
  filePath: string
  primitivesFound: string[]
}

function* walkRoutes(root: string): Generator<string> {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    let stat
    try { stat = statSync(full) } catch { continue }
    if (stat.isDirectory()) {
      yield* walkRoutes(full)
    } else if (stat.isFile() && full.endsWith('route.ts')) {
      yield full
    }
  }
}

function classifyRoute(file: string): { primitives: string[]; hasTier: boolean } {
  const src = readFileSync(file, 'utf8')
  const primitives = new Set<string>()
  for (const p of CHAIN_PRIMITIVES) {
    const re = new RegExp(`\\b${p}\\s*\\(`)
    if (re.test(src)) primitives.add(p)
  }
  // Examine the first 30 lines for the JSDoc tier tag.
  const head = src.split('\n').slice(0, 30).join('\n')
  const hasTier = RISK_TIER_RE.test(head)
  return { primitives: [...primitives], hasTier }
}

function main(): number {
  try {
    if (!existsSync(WEB_API_DIR)) {
      console.error(`[check-risk-tier-classification] api dir not found at ${WEB_API_DIR}`)
      return 2
    }
    const violations: Violation[] = []
    let routesScanned = 0
    let routesWithChainWrites = 0
    for (const f of walkRoutes(WEB_API_DIR)) {
      routesScanned++
      const { primitives, hasTier } = classifyRoute(f)
      if (primitives.length === 0) continue
      routesWithChainWrites++
      if (!hasTier) {
        violations.push({ filePath: f, primitivesFound: primitives })
      }
    }
    if (violations.length === 0) {
      console.log(`[check-risk-tier-classification] ok — scanned ${routesScanned} route handler(s); ${routesWithChainWrites} emit chain writes / sign delegations, all have @sa-risk-tier`)
      return 0
    }
    console.error(`[check-risk-tier-classification] FAIL — ${violations.length} route handler(s) emit chain writes / sign delegations but lack @sa-risk-tier\n`)
    for (const v of violations) {
      const rel = v.filePath.replace(REPO_ROOT + '/', '')
      console.error(`  ${rel}`)
      console.error(`    primitives: ${v.primitivesFound.join(', ')}`)
    }
    console.error('\nAdd to the top-of-file JSDoc block:')
    console.error('  /** @sa-route … @sa-auth … @sa-risk-tier <low|medium|high|sensitive> @sa-owner … */')
    console.error('Phase B\'s session variant-A/B decision needs this; deferring it lets a stolen')
    console.error('session sign a high-tier action that should have required on-chain registration.')
    return 1
  } catch (err) {
    console.error(`[check-risk-tier-classification] internal error: ${(err as Error).message}`)
    return 2
  }
}

process.exit(main())
