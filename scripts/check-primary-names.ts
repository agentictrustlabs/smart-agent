#!/usr/bin/env tsx
/**
 * Verification companion to `backfill-primary-names.ts`.
 *
 * Walks every demo user in `apps/web/local.db` and prints:
 *   • whether their person agent is registered in AgentAccountResolver
 *   • the on-chain `ATL_PRIMARY_NAME` value
 *
 * Used to confirm a fresh-start has wired every person agent for A2A
 * routing. A summary line at the end tallies ok / missingPrimary /
 * missingReg counts. Read-only — no contract writes. Run from repo root:
 *
 *   pnpm exec tsx scripts/check-primary-names.ts
 */

import { createPublicClient, http, keccak256, toBytes } from 'viem'
import { foundry } from 'viem/chains'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load env from apps/web/.env if envs aren't already set in the shell.
const envCandidates = [
  resolve(process.cwd(), 'apps/web/.env'),
  resolve(process.cwd(), '.env'),
]
for (const p of envCandidates) {
  try {
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch { /* try next */ }
}

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const RESOLVER = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
// DATABASE_URL is set inside apps/web; default to apps/web/local.db when
// invoking from the repo root.
const RAW_DB_PATH = process.env.DATABASE_URL ?? 'apps/web/local.db'
const DB_PATH = RAW_DB_PATH.startsWith('/') ? RAW_DB_PATH : resolve(process.cwd(), RAW_DB_PATH)

const ATL_PRIMARY_NAME = keccak256(toBytes('atl:primaryName'))

const abi = [
  { name: 'isRegistered', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { name: 'getStringProperty', type: 'function', inputs: [{ type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'string' }], stateMutability: 'view' },
] as const

async function main() {
  if (!RESOLVER) {
    console.error('AGENT_ACCOUNT_RESOLVER_ADDRESS not set in env')
    process.exit(1)
  }
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
  let db
  try {
    db = new Database(DB_PATH, { readonly: true })
  } catch (e) {
    console.error(`Failed to open ${DB_PATH}: ${(e as Error).message}`)
    process.exit(1)
  }
  const rows = db.prepare(
    `SELECT id, name, person_agent_address, smart_account_address
     FROM local_user_accounts
     WHERE id LIKE 'cat-user-%' OR id LIKE 'gc-user-%' OR id LIKE 'cil-user-%'
        OR id LIKE 'fr-user-%' OR id LIKE 'pl-user-%' OR id LIKE 'dm-user-%'
     ORDER BY id`,
  ).all() as Array<{
    id: string
    name: string
    person_agent_address: string | null
    smart_account_address: string | null
  }>

  console.log(`Found ${rows.length} demo users (resolver=${RESOLVER})`)
  let missingPrimary = 0, missingReg = 0, ok = 0, noAgent = 0
  for (const u of rows) {
    if (!u.person_agent_address) {
      console.log(`[${u.id}] ${u.name} — NO person agent in local.db`)
      noAgent++
      continue
    }
    const pa = u.person_agent_address as `0x${string}`
    let isReg = false, pname = ''
    try {
      isReg = await pub.readContract({
        address: RESOLVER, abi,
        functionName: 'isRegistered', args: [pa],
      }) as boolean
    } catch (e) {
      console.error(`[${u.id}] isRegistered failed: ${(e as Error).message.slice(0, 80)}`)
      continue
    }
    try {
      pname = await pub.readContract({
        address: RESOLVER, abi,
        functionName: 'getStringProperty', args: [pa, ATL_PRIMARY_NAME],
      }) as string
    } catch (e) {
      console.error(`[${u.id}] getStringProperty failed: ${(e as Error).message.slice(0, 80)}`)
      continue
    }
    const flag = !isReg ? 'NOT-REG' : !pname ? 'NO-PRIMARY' : 'OK'
    if (!isReg) missingReg++
    else if (!pname) missingPrimary++
    else ok++
    console.log(`[${u.id}] ${u.name.padEnd(22)} pa=${pa.slice(0,10)} reg=${isReg ? 'Y' : 'N'} primary="${pname}" ${flag}`)
  }
  console.log(
    `\nSummary: ok=${ok}  missingPrimary=${missingPrimary}  missingReg=${missingReg}  noAgent=${noAgent}  total=${rows.length}`,
  )
  if (missingPrimary > 0 || missingReg > 0) process.exit(2)
}

main().catch(e => { console.error(e); process.exit(1) })
