/**
 * Spec 004 R8 — On-chain PledgeRegistry reader.
 *
 * Walks PledgeRegistry.allSubjects() and reads per-subject attributes via
 * AttributeStorage's get* accessors. Reverse-maps concept-hash predicates
 * (unit, cadence, status) back to their string labels so the upstream
 * RawPledgeRow → PoolPledge conversion stays straightforward.
 *
 * No SQL mirror; chain is the only source. Filter helpers:
 *   - `readMyPledges(principal)`  — filters by donor nullifier.
 *   - `readPoolPledges(poolAgent)` — filters by pool address.
 *   - `readPoolCounters(poolAgent)` — sums cadence-aware totals.
 */

import {
  encodePacked,
  getAddress,
  isAddress,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { pledgeRegistryAbi } from '@smart-agent/sdk'
import { getPublicClient, requirePledgeRegistryAddress } from './contracts.js'

// ─── Predicate hashes (must match PledgeRegistry.sol) ────────────────

const SA_PLEDGE_POOL              = keccak256(toHex('sa:pledgePool'))
const SA_PLEDGE_NULLIFIER         = keccak256(toHex('sa:pledgeNullifier'))
const SA_PLEDGE_AMOUNT            = keccak256(toHex('sa:pledgeAmount'))
const SA_PLEDGE_UNIT              = keccak256(toHex('sa:pledgeUnit'))
const SA_PLEDGE_CADENCE           = keccak256(toHex('sa:pledgeCadence'))
const SA_PLEDGE_DURATION          = keccak256(toHex('sa:pledgeDuration'))
const SA_PLEDGE_RESTRICTIONS      = keccak256(toHex('sa:pledgeRestrictions'))
const SA_PLEDGE_STORY_PERMISSIONS = keccak256(toHex('sa:pledgeStoryPermissions'))
const SA_PLEDGE_PLEDGED_AT        = keccak256(toHex('sa:pledgePledgedAt'))
const SA_PLEDGE_STOPPED_AT        = keccak256(toHex('sa:pledgeStoppedAt'))
const SA_PLEDGE_STATUS            = keccak256(toHex('sa:pledgeStatus'))

// ─── Concept-hash reverse maps ───────────────────────────────────────

const UNIT_LABELS: Record<string, string> = {}
for (const u of ['USD', 'EUR', 'prayer-minutes', 'loaves', 'hours', 'minutes', 'meals', 'coaching-hours']) {
  UNIT_LABELS[keccak256(toHex(u)).toLowerCase()] = u
}

const CADENCE_LABELS: Record<string, 'one-time' | 'monthly' | 'annual' | 'recurring'> = {
  [keccak256(toHex('sa:CadenceOneTime')).toLowerCase()]:  'one-time',
  [keccak256(toHex('sa:CadenceMonthly')).toLowerCase()]:  'monthly',
  [keccak256(toHex('sa:CadenceAnnual')).toLowerCase()]:   'annual',
  [keccak256(toHex('sa:CadenceRecurring')).toLowerCase()]:'recurring',
}

const STATUS_LABELS: Record<string, 'active' | 'stopped' | 'auto-stopped' | 'fulfilled' | 'waitlisted'> = {
  [keccak256(toHex('sa:PledgeActive')).toLowerCase()]:      'active',
  [keccak256(toHex('sa:PledgeStopped')).toLowerCase()]:     'stopped',
  [keccak256(toHex('sa:PledgeAutoStopped')).toLowerCase()]: 'auto-stopped',
  [keccak256(toHex('sa:PledgeFulfilled')).toLowerCase()]:   'fulfilled',
  [keccak256(toHex('sa:PledgeWaitlisted')).toLowerCase()]:  'waitlisted',
}

// ─── Output shape (matches web's RawPledgeRow) ───────────────────────

export interface RawPledgeRow {
  id: string                  // bytes32 pledge subject hex
  principal: string           // 'unknown:nullifier:0x...' for v1; nullifier-only
  poolAgentId: string         // address
  cadence: 'one-time' | 'monthly' | 'annual' | 'recurring'
  unit: string
  amount: number
  duration: number | null
  restrictions: string | null
  storyPermissions: string
  pledgedAt: string           // ISO
  stoppedAt: string | null
  status: 'active' | 'stopped' | 'auto-stopped' | 'fulfilled' | 'waitlisted'
  history: unknown[]
  visibility: 'public' | 'public-coarse' | 'private'
  onChainAssertionId: string | null
  createdAt: string
  updatedAt: string
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function donorNullifier(principal: string): Hex {
  return keccak256(
    encodePacked(['string', 'string'], ['sa:pledger:', principal.toLowerCase()]),
  )
}

function deriveVisibility(
  storyPermissions: string,
): 'public' | 'public-coarse' | 'private' {
  if (storyPermissions === 'public') return 'public'
  if (storyPermissions === 'shareWithSupportTeam') return 'public-coarse'
  return 'private'
}

async function readPledge(subject: Hex): Promise<RawPledgeRow | null> {
  const client = getPublicClient()
  const registry = requirePledgeRegistryAddress()
  const args = [registry, pledgeRegistryAbi as readonly unknown[]] as const
  void args

  // Parallel attribute reads — each one is independent.
  const [
    poolAddr, nullifier, amount, unitHash, cadenceHash,
    duration, restrictions, storyPerms, pledgedAt, stoppedAt, statusHash,
  ] = await Promise.all([
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getAddress',  args: [subject, SA_PLEDGE_POOL] })              as Promise<Address>,
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getBytes32',  args: [subject, SA_PLEDGE_NULLIFIER] })         as Promise<Hex>,
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getUint',     args: [subject, SA_PLEDGE_AMOUNT] })            as Promise<bigint>,
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getBytes32',  args: [subject, SA_PLEDGE_UNIT] })              as Promise<Hex>,
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getBytes32',  args: [subject, SA_PLEDGE_CADENCE] })           as Promise<Hex>,
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getUint',     args: [subject, SA_PLEDGE_DURATION] }).catch(() => 0n)         as Promise<bigint>,
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getString',   args: [subject, SA_PLEDGE_RESTRICTIONS] }).catch(() => '')    as Promise<string>,
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getString',   args: [subject, SA_PLEDGE_STORY_PERMISSIONS] }).catch(() => '') as Promise<string>,
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getUint',     args: [subject, SA_PLEDGE_PLEDGED_AT] })        as Promise<bigint>,
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getUint',     args: [subject, SA_PLEDGE_STOPPED_AT] }).catch(() => 0n)       as Promise<bigint>,
    client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getBytes32',  args: [subject, SA_PLEDGE_STATUS] })            as Promise<Hex>,
  ])

  if (!isAddress(poolAddr) || poolAddr === '0x0000000000000000000000000000000000000000') {
    return null
  }

  const cadence = CADENCE_LABELS[cadenceHash.toLowerCase()] ?? 'one-time'
  const unit = UNIT_LABELS[unitHash.toLowerCase()] ?? unitHash
  const status = STATUS_LABELS[statusHash.toLowerCase()] ?? 'active'
  const storyPermissions = storyPerms || 'anonymous'
  const visibility = deriveVisibility(storyPermissions)

  return {
    id: subject,
    principal: `nullifier:${nullifier}`,
    poolAgentId: getAddress(poolAddr),
    cadence,
    unit,
    amount: Number(amount),
    duration: duration > 0n ? Number(duration) : null,
    restrictions: restrictions || null,
    storyPermissions,
    pledgedAt: new Date(Number(pledgedAt) * 1000).toISOString(),
    stoppedAt: stoppedAt > 0n ? new Date(Number(stoppedAt) * 1000).toISOString() : null,
    status,
    history: [],
    visibility,
    onChainAssertionId: subject,
    createdAt: new Date(Number(pledgedAt) * 1000).toISOString(),
    updatedAt: new Date(Number(stoppedAt > 0n ? stoppedAt : pledgedAt) * 1000).toISOString(),
  }
}

// ─── Public surface ──────────────────────────────────────────────────

export async function readAllPledges(): Promise<RawPledgeRow[]> {
  const client = getPublicClient()
  const registry = requirePledgeRegistryAddress()
  const subjects = (await client.readContract({
    address: registry,
    abi: pledgeRegistryAbi,
    functionName: 'allSubjects',
  })) as Hex[]

  const rows = await Promise.all(subjects.map((s) => readPledge(s).catch(() => null)))
  return rows.filter((r): r is RawPledgeRow => r !== null)
}

/** Pledges where the caller is the donor (matched by nullifier). */
export async function readMyPledges(principal: string): Promise<RawPledgeRow[]> {
  const my = donorNullifier(principal).toLowerCase()
  const all = await readAllPledges()
  return all.filter((r) => {
    // r.principal is "nullifier:0x..."; pull the hex portion.
    const nullifierHex = r.principal.slice('nullifier:'.length).toLowerCase()
    return nullifierHex === my
  })
}

/** Pledges scoped to a specific pool. */
export async function readPoolPledges(poolAgent: Address): Promise<RawPledgeRow[]> {
  const target = getAddress(poolAgent).toLowerCase()
  const all = await readAllPledges()
  return all.filter((r) => r.poolAgentId.toLowerCase() === target)
}

/** Cadence-aware totals for a pool (active rows only). */
export async function readPoolCounters(poolAgent: Address): Promise<{
  pledgedTotal: number
  allocatedTotal: number
  availableTotal: number
}> {
  const rows = await readPoolPledges(poolAgent)
  let pledgedTotal = 0
  for (const r of rows) {
    if (r.status !== 'active') continue
    if (r.cadence === 'one-time') {
      pledgedTotal += r.amount
    } else {
      const dur = r.duration ?? 1
      pledgedTotal += r.amount * Math.max(1, dur)
    }
  }
  return { pledgedTotal, allocatedTotal: 0, availableTotal: pledgedTotal }
}
