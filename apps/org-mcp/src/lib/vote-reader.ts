/**
 * Spec 004 R8 — On-chain VoteRegistry reader.
 *
 *   readVotesForRound(roundIdOrSubject)     — list ballots for a round
 *   readVotesForProposal(proposalIdOrSubj)  — list ballots for a proposal
 *   tallyForRound(roundIdOrSubject)         — per-proposal approve/reject/abstain
 */

import { keccak256, toHex, type Hex } from 'viem'
import { voteRegistryAbi } from '@smart-agent/sdk'
import { getPublicClient, requireVoteRegistryAddress } from './contracts.js'

// ─── Predicate hashes (must match VoteRegistry.sol) ──────────────────

const SA_VOTE_ROUND      = keccak256(toHex('sa:voteRound'))
const SA_VOTE_PROPOSAL   = keccak256(toHex('sa:voteProposal'))
const SA_VOTE_BALLOT     = keccak256(toHex('sa:voteBallot'))
const SA_VOTE_NULLIFIER  = keccak256(toHex('sa:voteNullifier'))
const SA_VOTE_WEIGHT     = keccak256(toHex('sa:voteWeight'))
const SA_VOTE_CAST_AT    = keccak256(toHex('sa:voteCastAt'))
const SA_VOTE_UPDATED_AT = keccak256(toHex('sa:voteUpdatedAt'))
const SA_VOTE_RATIONALE  = keccak256(toHex('sa:voteRationale'))

// Ballot concept hashes (must match @smart-agent/sdk's BALLOT_CONCEPT).
const BALLOT_LABELS: Record<string, 'approve' | 'reject' | 'abstain'> = {
  [keccak256(toHex('sa:Approve')).toLowerCase()]:  'approve',
  [keccak256(toHex('sa:Reject')).toLowerCase()]:   'reject',
  [keccak256(toHex('sa:Abstain')).toLowerCase()]:  'abstain',
}

export interface RawVoteRow {
  id: string                // bytes32 vote subject hex
  roundSubject: Hex
  proposalSubject: Hex
  ballot: 'approve' | 'reject' | 'abstain'
  nullifier: Hex
  weight: number
  castAt: string
  updatedAt: string
  rationale: string | null
}

async function readVote(subject: Hex): Promise<RawVoteRow | null> {
  const client = getPublicClient()
  const registry = requireVoteRegistryAddress()

  const [round, proposal, ballot, nullifier, weight, castAt, updatedAt, rationale] = await Promise.all([
    client.readContract({ address: registry, abi: voteRegistryAbi, functionName: 'getBytes32', args: [subject, SA_VOTE_ROUND] }) as Promise<Hex>,
    client.readContract({ address: registry, abi: voteRegistryAbi, functionName: 'getBytes32', args: [subject, SA_VOTE_PROPOSAL] }) as Promise<Hex>,
    client.readContract({ address: registry, abi: voteRegistryAbi, functionName: 'getBytes32', args: [subject, SA_VOTE_BALLOT] }) as Promise<Hex>,
    client.readContract({ address: registry, abi: voteRegistryAbi, functionName: 'getBytes32', args: [subject, SA_VOTE_NULLIFIER] }) as Promise<Hex>,
    client.readContract({ address: registry, abi: voteRegistryAbi, functionName: 'getUint',    args: [subject, SA_VOTE_WEIGHT] }) as Promise<bigint>,
    client.readContract({ address: registry, abi: voteRegistryAbi, functionName: 'getUint',    args: [subject, SA_VOTE_CAST_AT] }) as Promise<bigint>,
    client.readContract({ address: registry, abi: voteRegistryAbi, functionName: 'getUint',    args: [subject, SA_VOTE_UPDATED_AT] }) as Promise<bigint>,
    client.readContract({ address: registry, abi: voteRegistryAbi, functionName: 'getString',  args: [subject, SA_VOTE_RATIONALE] }).catch(() => '') as Promise<string>,
  ])

  if (!round || round === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    return null
  }
  const ballotLabel = BALLOT_LABELS[ballot.toLowerCase()]
  if (!ballotLabel) return null

  return {
    id: subject,
    roundSubject: round,
    proposalSubject: proposal,
    ballot: ballotLabel,
    nullifier,
    weight: Number(weight),
    castAt: new Date(Number(castAt) * 1000).toISOString(),
    updatedAt: new Date(Number(updatedAt > 0n ? updatedAt : castAt) * 1000).toISOString(),
    rationale: rationale || null,
  }
}

export async function readAllVotes(): Promise<RawVoteRow[]> {
  const client = getPublicClient()
  const registry = requireVoteRegistryAddress()
  const subjects = (await client.readContract({
    address: registry,
    abi: voteRegistryAbi,
    functionName: 'allSubjects',
  })) as Hex[]
  const rows = await Promise.all(subjects.map((s) => readVote(s).catch(() => null)))
  return rows.filter((r): r is RawVoteRow => r !== null)
}

function asHexSubject(input: string): string {
  // bytes32 hex passes through; URN/slug get the on-chain
  // `keccak256("sa:round:" + slug)` formula. Note: this helper is used
  // for round subjects only — proposal subjects are always bytes32 hex
  // by the time the reader sees them.
  if (/^0x[0-9a-fA-F]{64}$/.test(input)) return input.toLowerCase()
  const slug = input.startsWith('urn:smart-agent:round:')
    ? input.slice('urn:smart-agent:round:'.length)
    : input
  // Re-use viem's encodePacked equivalent by importing on demand.
  // For consistency with FundRegistry.roundSubject().
  return keccak256(new TextEncoder().encode(`sa:round:${slug}`)).toLowerCase()
}

export async function readVotesForRound(roundIdOrSubject: string): Promise<RawVoteRow[]> {
  const target = asHexSubject(roundIdOrSubject)
  const all = await readAllVotes()
  return all.filter((r) => r.roundSubject.toLowerCase() === target)
}

export async function readVotesForProposal(proposalIdOrSubject: string): Promise<RawVoteRow[]> {
  const target = asHexSubject(proposalIdOrSubject)
  const all = await readAllVotes()
  return all.filter((r) => r.proposalSubject.toLowerCase() === target)
}

export interface TallyEntry {
  proposalId: string
  approves: number
  rejects: number
  abstains: number
  totalWeight: number
  passes: boolean
}

export async function tallyForRound(
  roundIdOrSubject: string,
  threshold: number,
): Promise<TallyEntry[]> {
  const votes = await readVotesForRound(roundIdOrSubject)
  const byProposal = new Map<string, TallyEntry>()
  for (const v of votes) {
    const key = v.proposalSubject.toLowerCase()
    let row = byProposal.get(key)
    if (!row) {
      row = { proposalId: v.proposalSubject, approves: 0, rejects: 0, abstains: 0, totalWeight: 0, passes: false }
      byProposal.set(key, row)
    }
    if (v.ballot === 'approve') {
      row.approves += 1
      row.totalWeight += v.weight
    } else if (v.ballot === 'reject') {
      row.rejects += 1
    } else if (v.ballot === 'abstain') {
      row.abstains += 1
    }
  }
  for (const row of byProposal.values()) {
    row.passes = row.approves >= threshold
  }
  return [...byProposal.values()]
}
