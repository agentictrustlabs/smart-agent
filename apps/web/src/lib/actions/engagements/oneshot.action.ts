'use server'

/**
 * One-Shot — combined "deliver" action that logs the activity and pins the
 * evidence bundle in one shot. The user shouldn't have to navigate two
 * stages for what is one moment in their head.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §3 One-Shot, §4 column.
 */

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'

export interface MarkDeliveredInput {
  engagementId: string
  /** Optional summary line that becomes the activity title. */
  summary?: string
  /** Optional URL pointing at the artifact (intro email, screenshot, doc). */
  artifactUri?: string
  /** Optional one-line description for the artifact. */
  artifactDescription?: string
  /** Org address for activity logging. Required because logActivity needs it. */
  orgAddress: string
}

export async function markDelivered(input: MarkDeliveredInput): Promise<
  { ok: true; activityId: string; bundleHash: string }
  | { error: string }
> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const agentAddr = await getPersonAgentForUser(me.id)
  if (!agentAddr) return { error: 'no-person-agent' }
  const lower = agentAddr.toLowerCase()

  let ent: any = [] as any[]
  try { ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, input.engagementId)).get()
   } catch { /* entitlements table dropped */ }if (!ent) return { error: 'engagement-not-found' }
  if (ent.holderAgent !== lower && ent.providerAgent !== lower) {
    return { error: 'not-a-party' }
  }
  if (ent.evidencePinnedAt) return { error: 'already-delivered' }
  if (ent.status === 'fulfilled' || ent.status === 'revoked' || ent.status === 'expired') {
    return { error: `cannot-deliver-from-status-${ent.status}` }
  }

  // ── 1. Log the activity (drives capacity + cascade + thread emit) ──
  const objectLeaf = ent.terms ? safeLeaf(JSON.parse(ent.terms).object as string) : 'delivery'
  const titleDefault = `Delivered: ${objectLeaf}`
  const { logActivity } = await import('@/lib/actions/activity.action')
  const activity = await logActivity({
    orgAddress: input.orgAddress,
    activityType: 'service',
    title: input.summary?.trim() || titleDefault,
    description: input.summary,
    participants: 2,
    activityDate: new Date().toISOString().slice(0, 10),
    fulfillsEntitlementId: input.engagementId,
    capacityConsumed: ent.capacityRemaining,  // one-shot drains capacity in full
    achievesOutcome: true,
  })

  // ── 2. Pin the evidence bundle in the same call ───────────────────
  const { pinEvidence } = await import('./evidence.action')
  const attachments = input.artifactUri ? [{
    uri: input.artifactUri,
    description: input.artifactDescription,
  }] : []
  const pin = await pinEvidence({
    engagementId: input.engagementId,
    activityIds: [activity.id],
    attachments,
  })
  if ('error' in pin) return { error: pin.error }

  return { ok: true, activityId: activity.id, bundleHash: pin.bundleHash }
}

function safeLeaf(s: string): string {
  return (s.split(':').pop() ?? s).toLowerCase()
}
