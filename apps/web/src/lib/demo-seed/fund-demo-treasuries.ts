/**
 * Mint MockUSDC into the demo principals' treasuries so the
 * proposal-funding video has real balances to display + transfer.
 *
 * In SEED_PROFILE=minimal this targets the three actors Maria
 * (cat-user-001), Pastor David (cat-user-002), Sarah (cat-user-005)
 * — each user's personal smart account IS their treasury per spec 005
 * (smartAccount IS treasury) — plus the two org Treasury Service Agents
 * deployed by catalyst-seed:minimal (Catalyst NoCo Network + Fort Collins
 * Network).
 *
 * MockUSDC has an OPEN `mint(address,uint256)` surface and is dev-only
 * (only ever deployed on chainId 31337). We hard-fail if invoked off-chain.
 */

import {
  encodeFunctionData,
  keccak256,
  parseUnits,
  toBytes,
  type Address,
  type Hex,
} from 'viem'
import { agentAccountResolverAbi } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getPublicClient, getWalletClient } from '@/lib/contracts'

const MOCK_USDC_ABI = [
  {
    type: 'function', name: 'mint', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

interface FundTarget {
  label: string
  address: Address
  /** Per-target USDC amount in human units (6 decimals). */
  usdc: number
}

const SA_HAS_TREASURY = keccak256(toBytes('sa:hasTreasury')) as Hex

async function readOrgTreasury(orgAddress: Address): Promise<Address | null> {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
  if (!resolverAddr) return null
  try {
    const t = (await getPublicClient().readContract({
      address: resolverAddr,
      abi: agentAccountResolverAbi,
      functionName: 'getAddressProperty',
      args: [orgAddress, SA_HAS_TREASURY],
    })) as Address
    if (!t || t === '0x0000000000000000000000000000000000000000') return null
    return t
  } catch {
    return null
  }
}

async function userSmartAccount(userId: string): Promise<Address | null> {
  const u = db
    .select()
    .from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.id, userId))
    .get()
  if (!u?.smartAccountAddress) return null
  return u.smartAccountAddress as Address
}

/**
 * Look up the catalyst org smart account by deterministic deploy label.
 * Mirrors the salt scheme in `seed-catalyst-onchain.ts` so re-runs land
 * on the SAME counterfactual address.
 */
async function catalystOrgAddress(label: string, salt: number): Promise<Address | null> {
  const { getCounterfactualAddress, deterministicEoaFromLabel } = await import('./agent-self-register')
  try {
    const eoa = deterministicEoaFromLabel(label)
    return await getCounterfactualAddress(eoa.address, BigInt(salt))
  } catch {
    return null
  }
}

export async function fundMinimalDemoTreasuries(): Promise<void> {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
  if (chainId !== 31337) {
    console.log('[fund-treasuries] chainId !== 31337 — refusing to mint MockUSDC on a non-dev chain')
    return
  }

  const usdcAddr = (process.env.USDC_ADDRESS ?? process.env.MOCK_USDC_ADDRESS) as Address | undefined
  if (!usdcAddr) {
    console.warn('[fund-treasuries] USDC_ADDRESS / MOCK_USDC_ADDRESS not in env — skipping')
    return
  }

  const targets: FundTarget[] = []

  // Personal treasuries — each user's smart account IS their treasury.
  for (const [userId, name, amount] of [
    ['cat-user-001', 'Maria Gonzalez (personal)',     50_000] as const,
    ['cat-user-002', 'Pastor David Chen (personal)',  50_000] as const,
    ['cat-user-005', 'Sarah Thompson (personal)',     50_000] as const,
  ]) {
    const sa = await userSmartAccount(userId)
    if (!sa) {
      console.warn(`[fund-treasuries] ${name} (${userId}) has no smart account on file — skipping`)
      continue
    }
    targets.push({ label: name, address: sa, usdc: amount })
  }

  // Org treasuries — read sa:hasTreasury from the resolver.
  for (const [label, salt, displayName, amount] of [
    ['catalyst:catalystNoco',       200001, 'Catalyst NoCo Network treasury', 250_000] as const,
    ['catalyst:fortCollinsNetwork', 200002, 'Fort Collins Network treasury',  150_000] as const,
  ]) {
    const orgAddr = await catalystOrgAddress(label, salt)
    if (!orgAddr) {
      console.warn(`[fund-treasuries] ${displayName} address unresolvable — skipping`)
      continue
    }
    const treasuryAddr = await readOrgTreasury(orgAddr)
    if (!treasuryAddr) {
      console.warn(`[fund-treasuries] ${displayName} has no sa:hasTreasury on resolver — skipping`)
      continue
    }
    targets.push({ label: displayName, address: treasuryAddr, usdc: amount })
  }

  if (targets.length === 0) {
    console.warn('[fund-treasuries] no fund targets resolved — nothing to do')
    return
  }

  const pub = getPublicClient()
  const wc = getWalletClient()
  let mintedTotal = 0n

  for (const t of targets) {
    const amountBaseUnits = parseUnits(String(t.usdc), 6)
    const balance = (await pub.readContract({
      address: usdcAddr,
      abi: MOCK_USDC_ABI,
      functionName: 'balanceOf',
      args: [t.address],
    })) as bigint
    if (balance >= amountBaseUnits) {
      console.log(`[fund-treasuries] ${t.label} already at ${balance / 1_000_000n} USDC — skipping mint`)
      continue
    }
    const topUp = amountBaseUnits - balance
    try {
      const hash = await wc.sendTransaction({
        to: usdcAddr,
        data: encodeFunctionData({
          abi: MOCK_USDC_ABI,
          functionName: 'mint',
          args: [t.address, topUp],
        }),
      })
      await pub.waitForTransactionReceipt({ hash })
      mintedTotal += topUp
      console.log(`[fund-treasuries] ${t.label}: minted +${topUp / 1_000_000n} USDC → ${t.address}`)
    } catch (e) {
      console.warn(`[fund-treasuries] ${t.label} mint failed:`, (e as Error).message)
    }
  }

  console.log(`[fund-treasuries] done — total minted: ${mintedTotal / 1_000_000n} USDC across ${targets.length} targets`)
}
