'use server'

/**
 * Trust deposit — Stage 8 of the round trip.
 *
 * On dual-confirm cascade, mint:
 *   • AgentReviewRecord × 2  (each party reviews the other)
 *   • AgentSkillRegistry claims (provider + holder; both grow)
 *   • AgentAssertion (engagement-as-claim with both signatures)
 *   • AgentValidationProfile delta (counts + recency)
 *
 * v0 of this writes to the local DB only — it records the trust artifacts
 * the way they will appear once on-chain. R7 lives here.
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §4, §7 R7
 */

import { createHash, randomUUID } from 'crypto'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { emitTrustDeposit } from './thread.action'

export interface MintTrustDepositResult {
  reviewIds: string[]
  skillClaimIds: string[]
  assertionId: string
}

/**
 * Idempotent: a trust deposit already minted for an engagement is returned
 * as-is rather than duplicated.
 */
export async function mintTrustDeposit(input: {
  engagementId: string
}): Promise<{ ok: true; result: MintTrustDepositResult } | { error: string }> {
  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, input.engagementId)).get()
  if (!ent) return { error: 'engagement-not-found' }
  if (!ent.holderConfirmedAt || !ent.providerConfirmedAt) {
    return { error: 'dual-confirmation-required' }
  }
  if (ent.assertionId) {
    // Already deposited.
    return {
      ok: true,
      result: {
        reviewIds: safeParse<string[]>(ent.reviewIds) ?? [],
        skillClaimIds: [],
        assertionId: ent.assertionId,
      },
    }
  }

  const terms = safeParse<{ object: string; topic?: string; skill?: string; role?: string }>(ent.terms) ?? { object: '' }
  const skillSlug = terms.skill ?? terms.role ?? terms.object.split(':').pop() ?? 'engagement'
  const witnessLifted = ent.witnessAgent && ent.witnessSignedAt ? true : false
  const baseScore = witnessLifted ? 90 : 75
  // Confidence weights: witness presence + capacity-density + duration.
  const capacityDensity = ent.capacityGranted > 0
    ? Math.min(1, (ent.capacityGranted - ent.capacityRemaining) / ent.capacityGranted)
    : 0.5
  const confidence = Math.round((witnessLifted ? 0.5 : 0.3) + (capacityDensity * 0.5) * 100) / 100

  const now = new Date().toISOString()
  const reviewIds: string[] = []
  const skillClaimIds: string[] = []

  // ── AgentReviewRecord × 2 ─────────────────────────────────────
  // (v0: stored as 'agent_review_records' table; on-chain record is R7+ work.)
  const reviewByHolder = randomUUID()
  const reviewByProvider = randomUUID()
  reviewIds.push(reviewByHolder, reviewByProvider)

  try {
    db.insert(schema.agentReviewRecords).values([
      {
        id: reviewByHolder,
        reviewerAgent: ent.holderAgent,
        subjectAgent: ent.providerAgent,
        engagementId: ent.id,
        score: baseScore,
        confidence,
        narrative: `Holder review — engagement around ${terms.topic ?? skillSlug}.`,
        witnessLifted: witnessLifted ? 1 : 0,
        createdAt: now,
      },
      {
        id: reviewByProvider,
        reviewerAgent: ent.providerAgent,
        subjectAgent: ent.holderAgent,
        engagementId: ent.id,
        score: baseScore,
        confidence,
        narrative: `Provider review — engagement around ${terms.topic ?? skillSlug}.`,
        witnessLifted: witnessLifted ? 1 : 0,
        createdAt: now,
      },
    ]).run()
  } catch (err) {
    return { error: 'review-insert-failed: ' + (err as Error).message }
  }

  // ── AgentSkillRegistry claims (both parties grow) ─────────────
  const providerSkillId = randomUUID()
  const holderSkillId = randomUUID()
  skillClaimIds.push(providerSkillId, holderSkillId)
  try {
    db.insert(schema.agentSkillClaims).values([
      {
        id: providerSkillId,
        subjectAgent: ent.providerAgent,
        skillSlug,
        side: 'provider',
        attestorAgent: ent.holderAgent,
        engagementId: ent.id,
        confidence,
        witnessLifted: witnessLifted ? 1 : 0,
        createdAt: now,
      },
      {
        id: holderSkillId,
        subjectAgent: ent.holderAgent,
        skillSlug: `received-${skillSlug}`,
        side: 'holder',
        attestorAgent: ent.providerAgent,
        engagementId: ent.id,
        confidence,
        witnessLifted: witnessLifted ? 1 : 0,
        createdAt: now,
      },
    ]).run()
  } catch (err) {
    return { error: 'skill-claim-insert-failed: ' + (err as Error).message }
  }

  // ── AgentAssertion: engagement-as-claim, with both signatures ─
  const assertionId = randomUUID()
  const assertionPayload = JSON.stringify({
    engagementId: ent.id,
    holderAgent: ent.holderAgent,
    providerAgent: ent.providerAgent,
    holderConfirmedAt: ent.holderConfirmedAt,
    providerConfirmedAt: ent.providerConfirmedAt,
    witnessAgent: ent.witnessAgent,
    witnessSignedAt: ent.witnessSignedAt,
    evidenceBundleHash: ent.evidenceBundleHash,
    skillSlug,
  })
  const assertionHash = '0x' + createHash('sha256').update(assertionPayload).digest('hex')
  try {
    db.insert(schema.agentAssertions).values({
      id: assertionId,
      engagementId: ent.id,
      payload: assertionPayload,
      payloadHash: assertionHash,
      witnessLifted: witnessLifted ? 1 : 0,
      createdAt: now,
    }).run()
  } catch (err) {
    return { error: 'assertion-insert-failed: ' + (err as Error).message }
  }

  // ── Persist refs back on engagement, advance phase, deposit ───
  db.update(schema.entitlements)
    .set({
      reviewIds: JSON.stringify(reviewIds),
      assertionId,
      phase: 'deposited',
      updatedAt: now,
    })
    .where(eq(schema.entitlements.id, input.engagementId))
    .run()

  // ── Validation profile delta ──────────────────────────────────
  await bumpValidationProfile(ent.holderAgent, witnessLifted, now)
  await bumpValidationProfile(ent.providerAgent, witnessLifted, now)

  // ── Thread entry ───────────────────────────────────────────────
  await emitTrustDeposit({
    engagementId: ent.id,
    reviewIds,
    skillClaimIds,
    assertionId,
    txHash: assertionHash,
  })

  return {
    ok: true,
    result: { reviewIds, skillClaimIds, assertionId },
  }
}

async function bumpValidationProfile(agent: string, witnessLifted: boolean, now: string): Promise<void> {
  const lower = agent.toLowerCase()
  const existing = db.select().from(schema.agentValidationProfiles)
    .where(eq(schema.agentValidationProfiles.agent, lower)).get()
  if (existing) {
    db.update(schema.agentValidationProfiles)
      .set({
        engagementsCount: existing.engagementsCount + 1,
        witnessedCount: existing.witnessedCount + (witnessLifted ? 1 : 0),
        lastEngagementAt: now,
        updatedAt: now,
      })
      .where(eq(schema.agentValidationProfiles.agent, lower))
      .run()
  } else {
    db.insert(schema.agentValidationProfiles).values({
      agent: lower,
      engagementsCount: 1,
      witnessedCount: witnessLifted ? 1 : 0,
      lastEngagementAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
  }
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}
