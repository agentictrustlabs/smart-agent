'use server'

import { db, schema } from '@/db'
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'

export async function createProposal(data: {
  orgAddress: string
  title: string
  description: string
  actionType: 'pause-capital' | 'graduate-wave' | 'escalate-review' | 'general'
  targetAddress?: string
  quorumRequired: number
}) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  const id = randomUUID()
  await db.insert(schema.proposals).values({
    id,
    orgAddress: data.orgAddress.toLowerCase(),
    proposer: user[0].id,
    title: data.title,
    description: data.description,
    actionType: data.actionType,
    targetAddress: data.targetAddress?.toLowerCase() ?? null,
    quorumRequired: data.quorumRequired,
  })
  return { id }
}

export async function castVote(data: {
  proposalId: string
  vote: 'for' | 'against' | 'abstain'
  comment?: string
}) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  // Check if already voted
  const existing = await db.select().from(schema.votes)
    .where(and(eq(schema.votes.proposalId, data.proposalId), eq(schema.votes.voter, user[0].id)))
  if (existing.length > 0) throw new Error('Already voted on this proposal')

  const id = randomUUID()
  await db.insert(schema.votes).values({
    id,
    proposalId: data.proposalId,
    voter: user[0].id,
    vote: data.vote,
    comment: data.comment ?? null,
  })

  // Update vote counts on proposal
  const proposal = await db.select().from(schema.proposals)
    .where(eq(schema.proposals.id, data.proposalId)).limit(1)
  if (!proposal[0]) throw new Error('Proposal not found')

  const allVotes = await db.select().from(schema.votes)
    .where(eq(schema.votes.proposalId, data.proposalId))
  const votesFor = allVotes.filter(v => v.vote === 'for').length
  const votesAgainst = allVotes.filter(v => v.vote === 'against').length

  let status = proposal[0].status
  if (votesFor >= proposal[0].quorumRequired) status = 'passed'
  else if (votesAgainst >= proposal[0].quorumRequired) status = 'rejected'

  await db.update(schema.proposals)
    .set({ votesFor, votesAgainst, status })
    .where(eq(schema.proposals.id, data.proposalId))

  return { votesFor, votesAgainst, status }
}

export async function getProposals(orgAddress: string) {
  const proposals = await db.select().from(schema.proposals)
    .where(eq(schema.proposals.orgAddress, orgAddress.toLowerCase()))
  const allVotes = await db.select().from(schema.votes)
  return proposals.map(p => ({
    ...p,
    votes: allVotes.filter(v => v.proposalId === p.id),
  }))
}
