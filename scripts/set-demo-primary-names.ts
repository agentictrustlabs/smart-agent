/**
 * One-off: set `atl:primaryName` on the three demo users' person agents
 * (Maria, David, Sarah) so that A2A host-slug routing works for them.
 *
 * Why this exists: `bootstrapA2ASessionForUser` resolves the A2A endpoint
 * via `endpointFor()` → `resolveA2AEndpointForAgent()`, which reads the
 * agent's on-chain `ATL_PRIMARY_NAME` to derive the host slug. If that
 * property is empty the resolver throws "no primary name registered" and
 * `/api/demo-login` can't set the `a2a-session` cookie.
 *
 * The seed `seed-catalyst-onchain.ts` already calls `setNameProps` to set
 * these names — but in some demo runs the property ends up blank on chain
 * (likely a race or an earlier seed pre-this-commit). This script is the
 * idempotent backfill for those three users specifically.
 *
 * Convention (from `seed-catalyst-onchain.ts` lines 861-865):
 *   Maria (cat-user-001) → maria.catalyst.agent
 *   David (cat-user-002) → david.fortcollins.catalyst.agent
 *   Sarah (cat-user-005) → sarah.catalyst.agent
 *
 * Usage:
 *   pnpm exec tsx scripts/set-demo-primary-names.ts
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { createPublicClient, http, keccak256, toBytes, type Address, type Hex } from 'viem'
import { foundry } from 'viem/chains'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// ─── Load apps/web/.env into process.env (same pattern as seed-test-pool) ───
const envFile = path.join(repoRoot, 'apps/web/.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = value
  }
}

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const RESOLVER = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
const DB_PATH = path.join(repoRoot, 'apps/web/local.db')

if (!RESOLVER) {
  console.error('[set-demo-primary-names] AGENT_ACCOUNT_RESOLVER_ADDRESS not set in apps/web/.env')
  process.exit(1)
}

const ATL_PRIMARY_NAME = keccak256(toBytes('atl:primaryName')) as Hex

// Minimal read-only ABI for verification reads.
const resolverReadAbi = [
  {
    name: 'isRegistered',
    type: 'function',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'getStringProperty',
    type: 'function',
    inputs: [{ type: 'address' }, { type: 'bytes32' }],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
] as const

interface DemoUserTarget {
  id: string
  displayName: string
  primaryName: string
}

const TARGETS: ReadonlyArray<DemoUserTarget> = [
  { id: 'cat-user-001', displayName: 'Maria',  primaryName: 'maria.catalyst.agent' },
  { id: 'cat-user-002', displayName: 'David',  primaryName: 'david.fortcollins.catalyst.agent' },
  { id: 'cat-user-005', displayName: 'Sarah',  primaryName: 'sarah.catalyst.agent' },
]

interface UserRow {
  id: string
  name: string
  person_agent_address: string | null
  smart_account_address: string | null
  private_key: string | null
}

async function main(): Promise<void> {
  // ─── Read demo users from apps/web/local.db ────────────────────────
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[set-demo-primary-names] DB not found at ${DB_PATH}`)
    process.exit(1)
  }
  const db = new Database(DB_PATH, { readonly: true })
  const ids = TARGETS.map(t => t.id)
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, name, person_agent_address, smart_account_address, private_key
       FROM local_user_accounts
       WHERE id IN (${placeholders})`,
    )
    .all(...ids) as UserRow[]
  db.close()

  const byId = new Map<string, UserRow>()
  for (const r of rows) byId.set(r.id, r)

  // ─── Public client for pre/post reads ──────────────────────────────
  const pub = createPublicClient({ chain: foundry, transport: http(RPC_URL) })

  // Lazy-import the seed helper. It must be imported AFTER env is
  // populated because module-load-time `requireEnv` calls will fail
  // otherwise. The helper resolves `@/db` and `@/lib/contracts` via
  // apps/web/tsconfig.json paths — tsx discovers that tsconfig from the
  // imported file's location.
  const { writeAgentPropertiesAsSelf, loadDemoUserAgentIdentity } = await import(
    '../apps/web/src/lib/demo-seed/agent-self-register.js'
  )

  let wrote = 0
  let skipped = 0
  let errors = 0

  for (const target of TARGETS) {
    const row = byId.get(target.id)
    if (!row) {
      console.error(`[${target.id}] no row in local_user_accounts — skip`)
      errors++
      continue
    }
    const personAgent = row.person_agent_address as Address | null
    if (!personAgent) {
      console.error(`[${target.id}] ${target.displayName}: person_agent_address is NULL — skip`)
      errors++
      continue
    }

    // ─── Sanity: confirm isRegistered before we attempt a write ───
    let isReg = false
    try {
      isReg = (await pub.readContract({
        address: RESOLVER,
        abi: resolverReadAbi,
        functionName: 'isRegistered',
        args: [personAgent],
      })) as boolean
    } catch (e) {
      console.error(`[${target.id}] isRegistered read failed: ${(e as Error).message}`)
      errors++
      continue
    }
    if (!isReg) {
      // Per the task constraints: fail loud if a person agent isn't
      // registered. That's a different problem this script does not
      // fix.
      console.error(
        `[${target.id}] ${target.displayName}: person agent ${personAgent} is NOT registered on ` +
          `resolver — this is a different problem, refusing to write properties`,
      )
      errors++
      continue
    }

    // ─── Read current primary name (idempotency check) ────────────
    let prior = ''
    try {
      prior = (await pub.readContract({
        address: RESOLVER,
        abi: resolverReadAbi,
        functionName: 'getStringProperty',
        args: [personAgent, ATL_PRIMARY_NAME],
      })) as string
    } catch (e) {
      console.error(`[${target.id}] getStringProperty read failed: ${(e as Error).message}`)
      errors++
      continue
    }

    if (prior === target.primaryName) {
      console.log(
        `[${target.id}] ${target.displayName.padEnd(6)} ${personAgent} primaryName="${prior}" — already set, skip`,
      )
      skipped++
      continue
    }

    // ─── Resolve owner EOA + salt from local.db via the helper ────
    const identity = await loadDemoUserAgentIdentity(personAgent)
    if (!identity) {
      console.error(
        `[${target.id}] loadDemoUserAgentIdentity returned null for ${personAgent} ` +
          `— private_key missing or address mismatch in local.db`,
      )
      errors++
      continue
    }

    // ─── Write the primary name via the agent's own userOp ────────
    console.log(
      `[${target.id}] ${target.displayName.padEnd(6)} ${personAgent} prior="${prior}" → "${target.primaryName}" …`,
    )
    try {
      const { txHash, userOpHash } = await writeAgentPropertiesAsSelf({
        smartAccount: personAgent,
        signerAccount: identity.eoa,
        salt: identity.salt,
        properties: [
          { kind: 'string', predicate: ATL_PRIMARY_NAME, value: target.primaryName },
        ],
        label: `set-demo-primary-names:${target.id}`,
      })
      console.log(`[${target.id}]   userOp=${userOpHash} tx=${txHash}`)
    } catch (e) {
      console.error(`[${target.id}] writeAgentPropertiesAsSelf failed: ${(e as Error).message}`)
      errors++
      continue
    }

    // ─── Verify post-write via direct read ────────────────────────
    let post = ''
    try {
      post = (await pub.readContract({
        address: RESOLVER,
        abi: resolverReadAbi,
        functionName: 'getStringProperty',
        args: [personAgent, ATL_PRIMARY_NAME],
      })) as string
    } catch (e) {
      console.error(`[${target.id}] post-write read failed: ${(e as Error).message}`)
      errors++
      continue
    }
    if (post !== target.primaryName) {
      console.error(
        `[${target.id}] VERIFICATION FAILED — expected="${target.primaryName}" got="${post}"`,
      )
      errors++
      continue
    }
    console.log(`[${target.id}]   verified primaryName="${post}"`)
    wrote++
  }

  console.log('')
  console.log(`[set-demo-primary-names] done — wrote=${wrote} skipped=${skipped} errors=${errors}`)
  if (errors > 0) process.exit(2)
}

main().catch((e: unknown) => {
  console.error('[set-demo-primary-names] fatal:', e)
  process.exit(1)
})
