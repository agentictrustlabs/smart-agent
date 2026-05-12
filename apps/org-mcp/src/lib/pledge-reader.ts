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
// Spec 005 settlement attrs
const SA_PLEDGE_HONOR_TOKEN_LIST  = keccak256(toHex('sa:pledgeHonorTokenList'))
const SA_PLEDGE_PAYMENT_RAIL      = keccak256(toHex('sa:pledgePaymentRail'))
const SA_PLEDGE_EVIDENCE_HASH     = keccak256(toHex('sa:pledgeEvidenceHash'))
const SA_PLEDGE_MARKED_BY_AGENT   = keccak256(toHex('sa:pledgeMarkedByAgent'))
const SA_PLEDGE_LAST_HONORED_AT   = keccak256(toHex('sa:pledgeLastHonoredAt'))
const SA_PLEDGE_LAST_MARKED_AT    = keccak256(toHex('sa:pledgeLastMarkedAt'))

const PAYMENT_RAIL_LABELS: Record<string, 'crypto' | 'bank' | 'check' | 'cash' | 'in-kind' | 'other'> = {
  [keccak256(toHex('sa:PaymentRailCrypto')).toLowerCase()]: 'crypto',
  [keccak256(toHex('sa:PaymentRailBank')).toLowerCase()]:   'bank',
  [keccak256(toHex('sa:PaymentRailCheck')).toLowerCase()]:  'check',
  [keccak256(toHex('sa:PaymentRailCash')).toLowerCase()]:   'cash',
  [keccak256(toHex('sa:PaymentRailInKind')).toLowerCase()]: 'in-kind',
  [keccak256(toHex('sa:PaymentRailOther')).toLowerCase()]:  'other',
}

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
  /** Spec 005 — per-token settlement totals. Empty when no settlement happened. */
  settlements: PledgeSettlement[]
  /** Spec 005 — most recent external-payment attestation (one per pledge). */
  lastMarkedPayment: {
    rail: 'crypto' | 'bank' | 'check' | 'cash' | 'in-kind' | 'other'
    evidenceHash: string
    markedByAgent: string
    markedAt: string | null
  } | null
}

export interface PledgeSettlement {
  /** Token contract address (USDC for v1; future tokens supported). */
  token: string
  honored: string           // bigint as decimal string (token-scaled)
  externallyPaid: string    // bigint as decimal string
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

  // Spec 005 — settlement reads. Best-effort; if the token list is empty
  // or the attrs aren't set yet, the pledge predates honor and we return
  // an empty settlements array.
  const settlements = await readPledgeSettlements(subject).catch(() => [])
  const lastMarkedPayment = await readLastMarkedPayment(subject).catch(() => null)

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
    settlements,
    lastMarkedPayment,
  }
}

async function readPledgeSettlements(subject: Hex): Promise<PledgeSettlement[]> {
  const client = getPublicClient()
  const registry = requirePledgeRegistryAddress()
  let tokens: Hex[] = []
  try {
    tokens = (await client.readContract({
      address: registry,
      abi: pledgeRegistryAbi,
      functionName: 'getBytes32Arr',
      args: [subject, SA_PLEDGE_HONOR_TOKEN_LIST],
    })) as Hex[]
  } catch {
    return []
  }
  if (!tokens || tokens.length === 0) return []
  const out: PledgeSettlement[] = []
  for (const tokenBytes of tokens) {
    // Token list stores bytes32; lower 20 bytes is the address.
    const tokenAddr = (`0x${tokenBytes.slice(-40)}`) as Address
    try {
      const [honored, externallyPaid] = (await client.readContract({
        address: registry,
        abi: pledgeRegistryAbi,
        functionName: 'getSettlement',
        args: [subject, tokenAddr],
      })) as [bigint, bigint]
      if (honored > 0n || externallyPaid > 0n) {
        out.push({
          token: getAddress(tokenAddr),
          honored: honored.toString(),
          externallyPaid: externallyPaid.toString(),
        })
      }
    } catch { /* skip */ }
  }
  return out
}

async function readLastMarkedPayment(subject: Hex): Promise<RawPledgeRow['lastMarkedPayment']> {
  const client = getPublicClient()
  const registry = requirePledgeRegistryAddress()
  try {
    const [railHash, evidenceHash, markedBy, markedAt] = await Promise.all([
      client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getBytes32', args: [subject, SA_PLEDGE_PAYMENT_RAIL] }) as Promise<Hex>,
      client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getBytes32', args: [subject, SA_PLEDGE_EVIDENCE_HASH] }) as Promise<Hex>,
      client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getAddress', args: [subject, SA_PLEDGE_MARKED_BY_AGENT] }) as Promise<Address>,
      client.readContract({ address: registry, abi: pledgeRegistryAbi, functionName: 'getUint',    args: [subject, SA_PLEDGE_LAST_MARKED_AT] }) as Promise<bigint>,
    ])
    if (!evidenceHash || /^0x0+$/.test(evidenceHash)) return null
    const rail = PAYMENT_RAIL_LABELS[railHash.toLowerCase()] ?? 'other'
    return {
      rail,
      evidenceHash,
      markedByAgent: markedBy,
      markedAt: markedAt > 0n ? new Date(Number(markedAt) * 1000).toISOString() : null,
    }
  } catch {
    return null
  }
}

// Touch the unused predicate constants so they're not flagged.
void SA_PLEDGE_LAST_HONORED_AT

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
