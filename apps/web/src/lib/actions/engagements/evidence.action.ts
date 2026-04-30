'use server'

/**
 * Evidence pinning — Stage 6 Provenance Capture in the round trip.
 *
 * Activities are the *doing*; the evidence pin is the *fixing of the record*
 * that makes validation auditable. The pinned bundle is what counts toward
 * the trust deposit — loose activities logged after the pin do not.
 *
 * Pinning:
 *   1. Take a list of activity ids and optional external attachments.
 *   2. Build a canonical JSON, SHA-256 hash it.
 *   3. Persist the hash + pinned-at on the engagement, advance phase
 *      to evidence_pinned, emit an evidence_pin thread entry.
 *   4. Return the bundle hash (so a witness can later sign it).
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §5.1
 */

import { createHash } from 'crypto'
import { db, schema } from '@/db'
import { eq, inArray } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { emitEvidencePin, emitWitnessSig } from './thread.action'

export interface PinEvidenceInput {
  engagementId: string
  activityIds: string[]
  attachments?: { uri: string; description?: string }[]
}

export interface EvidenceBundle {
  bundleHash: string
  activityIds: string[]
  attachments: { uri: string; description?: string }[]
  pinnedAt: string
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k])).join(',') + '}'
  }
  return JSON.stringify(value)
}

export async function pinEvidence(input: PinEvidenceInput): Promise<{ ok: true; bundleHash: string } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const agentAddr = await getPersonAgentForUser(me.id)
  if (!agentAddr) return { error: 'no-person-agent' }
  const lower = agentAddr.toLowerCase()

  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, input.engagementId)).get()
  if (!ent) return { error: 'engagement-not-found' }
  if (ent.holderAgent !== lower && ent.providerAgent !== lower) return { error: 'not-a-party' }
  if (ent.evidencePinnedAt) return { error: 'already-pinned' }
  if (ent.status === 'fulfilled' || ent.status === 'revoked' || ent.status === 'expired') {
    return { error: `cannot-pin-from-status-${ent.status}` }
  }

  // Validate activity ids belong to this engagement.
  const activities = input.activityIds.length === 0 ? [] : db.select().from(schema.activityLogs)
    .where(inArray(schema.activityLogs.id, input.activityIds))
    .all()
  for (const a of activities) {
    if (a.fulfillsEntitlementId !== input.engagementId) {
      return { error: `activity-${a.id}-not-in-engagement` }
    }
  }

  const attachments = input.attachments ?? []
  const now = new Date().toISOString()

  // Canonical bundle for hashing — sorted activity ids + attachments.
  const sortedActivityIds = [...input.activityIds].sort()
  const canonical = canonicalize({
    engagementId: input.engagementId,
    activityIds: sortedActivityIds,
    attachments,
    pinnedAt: now,
  })
  const bundleHash = '0x' + createHash('sha256').update(canonical).digest('hex')

  // Persist on engagement + advance phase.
  db.update(schema.entitlements)
    .set({
      evidenceBundleHash: bundleHash,
      evidencePinnedAt: now,
      phase: 'evidence_pinned',
      updatedAt: now,
    })
    .where(eq(schema.entitlements.id, input.engagementId))
    .run()

  // Thread entry.
  await emitEvidencePin({
    engagementId: input.engagementId,
    fromAgent: lower,
    activityIds: sortedActivityIds,
    attachments,
    bundleHash,
  })

  return { ok: true, bundleHash }
}

// ─── Witness signature ─────────────────────────────────────────────

export async function attachWitnessSignature(input: {
  engagementId: string
}): Promise<{ ok: true; signature: string } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const agentAddr = await getPersonAgentForUser(me.id)
  if (!agentAddr) return { error: 'no-person-agent' }
  const lower = agentAddr.toLowerCase()

  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, input.engagementId)).get()
  if (!ent) return { error: 'engagement-not-found' }
  if (!ent.witnessAgent || ent.witnessAgent.toLowerCase() !== lower) return { error: 'not-the-witness' }
  if (!ent.evidenceBundleHash) return { error: 'evidence-not-pinned' }
  if (ent.witnessSignedAt) return { error: 'already-signed' }

  // v0: synthesize a signature from the bundle hash + witness agent. R7 will
  // upgrade this to an on-chain ECDSA signature against the AgentAssertion.
  const sigBody = `witness:${lower}:${ent.evidenceBundleHash}`
  const signature = '0x' + createHash('sha256').update(sigBody).digest('hex')
  const signedAt = new Date().toISOString()

  db.update(schema.entitlements)
    .set({ witnessSignedAt: signedAt, phase: 'witnessed', updatedAt: signedAt })
    .where(eq(schema.entitlements.id, input.engagementId))
    .run()

  await emitWitnessSig({
    engagementId: input.engagementId,
    witnessAgent: lower,
    signature,
    signedAt,
  })

  return { ok: true, signature }
}

// ─── Set / clear witness ───────────────────────────────────────────

export async function setWitnessAgent(input: {
  engagementId: string
  witnessAgent: string
}): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const agentAddr = await getPersonAgentForUser(me.id)
  if (!agentAddr) return { error: 'no-person-agent' }
  const lower = agentAddr.toLowerCase()

  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, input.engagementId)).get()
  if (!ent) return { error: 'engagement-not-found' }
  if (ent.holderAgent !== lower && ent.providerAgent !== lower) return { error: 'not-a-party' }
  if (ent.witnessSignedAt) return { error: 'witness-already-signed' }

  const w = input.witnessAgent.toLowerCase()
  if (w === ent.holderAgent || w === ent.providerAgent) return { error: 'witness-cannot-be-party' }

  db.update(schema.entitlements)
    .set({ witnessAgent: w, witnessSignedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.entitlements.id, input.engagementId))
    .run()

  return { ok: true }
}

