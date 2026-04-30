'use server'

/**
 * Engagement messages — posting human messages onto the Commitment Thread.
 *
 * A message is one `kind` of thread entry among many. The composer hits this
 * action; the action authorizes the user, finds their person agent, and
 * appends a `message` entry. The CommitmentThread component renders it.
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §4
 */

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { emitMessage } from './thread.action'

export async function postEngagementMessage(input: {
  engagementId: string
  text: string
  attachmentUri?: string
}): Promise<{ ok: true; entryId: string } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const agentAddr = await getPersonAgentForUser(me.id)
  if (!agentAddr) return { error: 'no-person-agent' }

  // Authorization: must be holder, provider, or witness of the engagement.
  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, input.engagementId)).get()
  if (!ent) return { error: 'engagement-not-found' }
  const lower = agentAddr.toLowerCase()
  const allowed = ent.holderAgent === lower
    || ent.providerAgent === lower
    || (ent.witnessAgent !== null && ent.witnessAgent.toLowerCase() === lower)
  if (!allowed) return { error: 'not-a-party' }

  const trimmed = input.text.trim()
  if (!trimmed) return { error: 'empty-message' }

  const r = await emitMessage({
    engagementId: input.engagementId,
    fromAgent: lower,
    text: trimmed,
    attachmentUri: input.attachmentUri ?? null,
  })
  return { ok: true, entryId: r.id }
}
