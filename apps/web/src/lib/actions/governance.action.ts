'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'

export async function createProposal(data: {
  orgAddress: string
  title: string
  description: string
  actionType: 'pause-capital' | 'graduate-wave' | 'escalate-review' | 'general'
  targetAddress?: string
}) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  await db.insert(schema.proposals).values({
    id: randomUUID(),
    orgAddress: data.orgAddress,
    proposer: user[0].id,
    title: data.title,
    description: data.description,
    actionType: data.actionType,
    targetAddress: data.targetAddress ?? null,
    quorumRequired: 2,
    status: 'open',
  }).run()

  revalidatePath('/steward')
}

export async function voteOnProposal(proposalId: string, vote: 'for' | 'against') {
  await requireSession()
  const proposal = await db.select().from(schema.proposals)
    .where(eq(schema.proposals.id, proposalId)).limit(1)
  if (!proposal[0] || proposal[0].status !== 'open') return

  if (vote === 'for') {
    await db.update(schema.proposals)
      .set({ votesFor: proposal[0].votesFor + 1 })
      .where(eq(schema.proposals.id, proposalId)).run()
  } else {
    await db.update(schema.proposals)
      .set({ votesAgainst: proposal[0].votesAgainst + 1 })
      .where(eq(schema.proposals.id, proposalId)).run()
  }

  // Check if quorum reached
  const updated = await db.select().from(schema.proposals)
    .where(eq(schema.proposals.id, proposalId)).limit(1)
  if (updated[0] && updated[0].votesFor >= updated[0].quorumRequired) {
    await db.update(schema.proposals)
      .set({ status: 'passed', executedAt: new Date().toISOString() })
      .where(eq(schema.proposals.id, proposalId)).run()
  }

  revalidatePath('/steward')
}
