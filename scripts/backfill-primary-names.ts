#!/usr/bin/env tsx
/**
 * One-shot backfill: write `ATL_PRIMARY_NAME = slugify(displayName).agent`
 * onto every registered agent that doesn't already have a primary name.
 *
 * Why this exists: the A2A-first routing consolidation derives an
 * agent's host slug from its on-chain `ATL_PRIMARY_NAME`. Agents
 * registered before that derivation contract was enforced (the
 * catalyst seed pre-this-commit) have a displayName but no primary
 * name, so the URL resolver throws "no primary name registered" and
 * every `callMcp` for the user 401s before reaching A2A.
 *
 * Re-runs are idempotent — agents that already have a non-empty
 * `ATL_PRIMARY_NAME` are skipped. Subsequent fresh-starts will set
 * the property at register time and never need this script.
 *
 * Usage: pnpm exec tsx scripts/backfill-primary-names.ts
 */

import { createPublicClient, createWalletClient, http, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// __dirname for tsx-compiled CJS context.
const envCandidates = [
  resolve(__dirname, '../apps/web/.env'),
  resolve(process.cwd(), 'apps/web/.env'),
  resolve(process.cwd(), '.env'),
]
for (const p of envCandidates) {
  try {
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
    break
  } catch { /* try next */ }
}

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const RESOLVER = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`

const ATL_PRIMARY_NAME = keccak256(toBytes('atl:primaryName'))
const ATL_DISPLAY_NAME = keccak256(toBytes('atl:displayName'))

const abi = [
  { name: 'agentCount', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'getAgentAt', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'getStringProperty', type: 'function', inputs: [{ type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'setStringProperty', type: 'function', inputs: [{ type: 'address' }, { type: 'bytes32' }, { type: 'string' }], outputs: [], stateMutability: 'nonpayable' },
] as const

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
}

async function main() {
  if (!RESOLVER || !DEPLOYER_KEY) {
    console.error('Missing AGENT_ACCOUNT_RESOLVER_ADDRESS or DEPLOYER_PRIVATE_KEY')
    process.exit(1)
  }
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
  const account = privateKeyToAccount(DEPLOYER_KEY)
  const wallet = createWalletClient({ account, chain: foundry, transport: http(RPC) })
  const count = (await pub.readContract({ address: RESOLVER, abi, functionName: 'agentCount' })) as bigint
  console.log(`[backfill] agentCount=${count}`)
  let wrote = 0, skipped = 0, errors = 0
  for (let i = 0n; i < count; i++) {
    let addr: `0x${string}`
    try {
      addr = (await pub.readContract({ address: RESOLVER, abi, functionName: 'getAgentAt', args: [i] })) as `0x${string}`
    } catch (e) {
      console.warn(`[${i}] getAgentAt failed: ${e instanceof Error ? e.message : e}`); errors++; continue
    }
    let display = ''
    try {
      display = (await pub.readContract({ address: RESOLVER, abi, functionName: 'getStringProperty', args: [addr, ATL_DISPLAY_NAME] })) as string
    } catch { /* no display name */ }
    if (!display) { skipped++; continue }
    let existing = ''
    try {
      existing = (await pub.readContract({ address: RESOLVER, abi, functionName: 'getStringProperty', args: [addr, ATL_PRIMARY_NAME] })) as string
    } catch { /* none */ }
    if (existing) { skipped++; continue }
    const primaryName = `${slugify(display)}.agent`
    if (!primaryName || primaryName === '.agent') { skipped++; continue }
    try {
      const tx = await wallet.writeContract({
        address: RESOLVER, abi, functionName: 'setStringProperty',
        args: [addr, ATL_PRIMARY_NAME, primaryName],
      })
      await pub.waitForTransactionReceipt({ hash: tx })
      wrote++
      console.log(`[${i}] ${addr} ${display} → ${primaryName}`)
    } catch (e) {
      console.warn(`[${i}] setStringProperty failed: ${e instanceof Error ? e.message : e}`); errors++
    }
  }
  console.log(`[backfill] done — wrote=${wrote} skipped=${skipped} errors=${errors}`)
}

void main()
