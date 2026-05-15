/**
 * Spec 004 R8 — On-chain GrantProposalRegistry reader.
 *
 * Mirror of pledge-reader.ts for the proposal lane. Walks
 * GrantProposalRegistry.allSubjects(), reads per-subject attributes,
 * returns rows in the shape the web's `rowToProposal` mapper expects.
 *
 *  Filter helpers:
 *    - readMyProposals(principal)        — by submitter nullifier
 *    - readProposalsForRound(roundId)    — by round subject (hex or URN)
 */

import { encodePacked, keccak256, toHex, type Hex } from 'viem'
import { grantProposalRegistryAbi } from '@smart-agent/sdk'
import { getPublicClient, requireGrantProposalRegistryAddress } from './contracts.js'

// ─── Predicate hashes (must match GrantProposalRegistry.sol) ─────────

const SA_GP_ROUND        = keccak256(toHex('sa:gpRound'))
const SA_GP_NULLIFIER    = keccak256(toHex('sa:gpNullifier'))
const SA_GP_DISPLAY_NAME = keccak256(toHex('sa:gpDisplayName'))
const SA_GP_BASED_ON     = keccak256(toHex('sa:gpBasedOn'))
const SA_GP_BUDGET       = keccak256(toHex('sa:gpBudget'))
const SA_GP_PLAN         = keccak256(toHex('sa:gpPlan'))
const SA_GP_MILESTONES   = keccak256(toHex('sa:gpMilestones'))
const SA_GP_OUTCOMES     = keccak256(toHex('sa:gpOutcomes'))
const SA_GP_REPORTING    = keccak256(toHex('sa:gpReporting'))
const SA_GP_ORG_BG       = keccak256(toHex('sa:gpOrgBackground'))
const SA_GP_STATUS       = keccak256(toHex('sa:gpStatus'))
const SA_GP_SUBMITTED_AT = keccak256(toHex('sa:gpSubmittedAt'))
const SA_GP_LAST_EDITED  = keccak256(toHex('sa:gpLastEdited'))
const SA_GP_VERSION      = keccak256(toHex('sa:gpVersion'))
const SA_GP_WITHDRAWN_AT = keccak256(toHex('sa:gpWithdrawnAt'))
const SA_GP_CLONED_FROM  = keccak256(toHex('sa:gpClonedFrom'))
const SA_GP_BASIS        = keccak256(toHex('sa:gpBasis'))
const SA_GP_RECIPIENT    = keccak256(toHex('sa:gpRecipient'))

const STATUS_LABELS: Record<string, string> = {
  [keccak256(toHex('sa:GpSubmitted')).toLowerCase()]:  'submitted',
  [keccak256(toHex('sa:GpWithdrawn')).toLowerCase()]:  'withdrawn',
  [keccak256(toHex('sa:GpAwarded')).toLowerCase()]:    'awarded',
  [keccak256(toHex('sa:GpDeclined')).toLowerCase()]:   'declined',
  [keccak256(toHex('sa:GpRescinded')).toLowerCase()]:  'rescinded',
}

// ─── Output shape (matches web's RawProposalRow) ─────────────────────

export interface RawProposalRow {
  id: string
  principal: string             // "nullifier:0x…"
  roundId: string | null
  fundMandateId: string | null
  displayName: string
  basedOnIntentId: string
  budget: string
  plan: string
  milestones: string
  desiredOutcomes: string
  reportingObligations: string
  organisationalBackground: string
  submittedAt: string | null
  version: number
  lastEditedAt: string
  status: string
  withdrawnAt: string | null
  clonedFromProposalId: string | null
  basis: string | null
  visibility: string
  createdAt: string
  /** Hex address of the recipient AgentAccount — the proposer's hub-org
   *  treasury that funds will flow to at award time. Distinct from
   *  `principal` (anonymous nullifier). Zero address means legacy row
   *  written before recipient was required (treat as unrecoverable). */
  recipientAddress: `0x${string}`
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function submitterNullifier(principal: string): Hex {
  return keccak256(
    encodePacked(['string', 'string'], ['sa:proposer:', principal.toLowerCase()]),
  )
}

function isoFromUnix(seconds: bigint): string | null {
  if (seconds === 0n) return null
  return new Date(Number(seconds) * 1000).toISOString()
}

async function readProposal(subject: Hex): Promise<RawProposalRow | null> {
  const client = getPublicClient()
  const registry = requireGrantProposalRegistryAddress()

  const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as const
  const [
    round, nullifier, displayName, basedOn, budget, plan, milestones,
    outcomes, reporting, orgBg, statusHash, submittedAt, lastEdited, version,
    withdrawnAt, clonedFrom, basis, recipient,
  ] = await Promise.all([
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getBytes32', args: [subject, SA_GP_ROUND] }) as Promise<Hex>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getBytes32', args: [subject, SA_GP_NULLIFIER] }) as Promise<Hex>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getString',  args: [subject, SA_GP_DISPLAY_NAME] }).catch(() => '') as Promise<string>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getString',  args: [subject, SA_GP_BASED_ON] }).catch(() => '') as Promise<string>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getString',  args: [subject, SA_GP_BUDGET] }).catch(() => '') as Promise<string>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getString',  args: [subject, SA_GP_PLAN] }).catch(() => '') as Promise<string>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getString',  args: [subject, SA_GP_MILESTONES] }).catch(() => '') as Promise<string>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getString',  args: [subject, SA_GP_OUTCOMES] }).catch(() => '') as Promise<string>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getString',  args: [subject, SA_GP_REPORTING] }).catch(() => '') as Promise<string>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getString',  args: [subject, SA_GP_ORG_BG] }).catch(() => '') as Promise<string>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getBytes32', args: [subject, SA_GP_STATUS] }) as Promise<Hex>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getUint',    args: [subject, SA_GP_SUBMITTED_AT] }) as Promise<bigint>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getUint',    args: [subject, SA_GP_LAST_EDITED] }).catch(() => 0n) as Promise<bigint>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getUint',    args: [subject, SA_GP_VERSION] }).catch(() => 1n) as Promise<bigint>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getUint',    args: [subject, SA_GP_WITHDRAWN_AT] }).catch(() => 0n) as Promise<bigint>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getBytes32', args: [subject, SA_GP_CLONED_FROM] }).catch(() => '0x' as Hex) as Promise<Hex>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getString',  args: [subject, SA_GP_BASIS] }).catch(() => '') as Promise<string>,
    client.readContract({ address: registry, abi: grantProposalRegistryAbi, functionName: 'getAddress', args: [subject, SA_GP_RECIPIENT] }).catch(() => ZERO_ADDR) as Promise<`0x${string}`>,
  ])

  if (!round || round === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    return null
  }

  const submitIso = isoFromUnix(submittedAt) ?? new Date(0).toISOString()
  const lastEditedIso = isoFromUnix(lastEdited) ?? submitIso

  return {
    id: subject,
    principal: `nullifier:${nullifier}`,
    roundId: round,
    fundMandateId: null,
    displayName: displayName || '',
    basedOnIntentId: basedOn || '',
    budget: budget || '',
    plan: plan || '',
    milestones: milestones || '',
    desiredOutcomes: outcomes || '',
    reportingObligations: reporting || '',
    organisationalBackground: orgBg || '',
    submittedAt: submitIso,
    version: Number(version),
    lastEditedAt: lastEditedIso,
    status: STATUS_LABELS[statusHash.toLowerCase()] ?? 'submitted',
    withdrawnAt: isoFromUnix(withdrawnAt),
    clonedFromProposalId: clonedFrom && clonedFrom !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? clonedFrom : null,
    basis: basis || null,
    visibility: 'public',
    createdAt: submitIso,
    recipientAddress: recipient,
  }
}

// ─── Public surface ──────────────────────────────────────────────────

export async function readAllProposals(): Promise<RawProposalRow[]> {
  const client = getPublicClient()
  const registry = requireGrantProposalRegistryAddress()
  const subjects = (await client.readContract({
    address: registry,
    abi: grantProposalRegistryAbi,
    functionName: 'allSubjects',
  })) as Hex[]
  const rows = await Promise.all(subjects.map((s) => readProposal(s).catch(() => null)))
  return rows.filter((r): r is RawProposalRow => r !== null)
}

export async function readMyProposals(principal: string): Promise<RawProposalRow[]> {
  const my = submitterNullifier(principal).toLowerCase()
  const all = await readAllProposals()
  return all.filter((r) => {
    const nullifierHex = r.principal.slice('nullifier:'.length).toLowerCase()
    return nullifierHex === my
  })
}

export async function readProposalsForRound(roundIdOrSubject: string): Promise<RawProposalRow[]> {
  // Inputs: bytes32 hex (already the subject), URN
  // (`urn:smart-agent:round:<slug>`), or bare slug. The on-chain formula
  // is `keccak256(abi.encodePacked("sa:round:", slug))`.
  const { encodePacked } = await import('viem')
  let target: string
  if (/^0x[0-9a-fA-F]{64}$/.test(roundIdOrSubject)) {
    target = roundIdOrSubject.toLowerCase()
  } else {
    const slug = roundIdOrSubject.startsWith('urn:smart-agent:round:')
      ? roundIdOrSubject.slice('urn:smart-agent:round:'.length)
      : roundIdOrSubject
    target = keccak256(encodePacked(['string', 'string'], ['sa:round:', slug])).toLowerCase()
  }
  const all = await readAllProposals()
  return all.filter((r) => (r.roundId ?? '').toLowerCase() === target)
}
