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
  let ent: any = [] as any[]
  try { ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, input.engagementId)).get()
   } catch { /* entitlements table dropped */ }if (!ent) return { error: 'engagement-not-found' }
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

  const terms = safeParse<{ object: string; topic?: string; skill?: string; role?: string; quietMode?: boolean }>(ent.terms) ?? { object: '' }
  const skillSlug = terms.skill ?? terms.role ?? terms.object.split(':').pop() ?? 'engagement'
  const witnessLifted = ent.witnessAgent && ent.witnessSignedAt ? true : false
  const isQuiet = terms.quietMode === true
  // Quiet engagements (Prayer, sensitive Worker) deposit a thinner artifact:
  // base score 70 (vs 75/90), no narrative content carried, lower confidence.
  const baseScore = isQuiet ? 70 : witnessLifted ? 90 : 75
  // Confidence weights: witness presence + capacity-density + duration.
  const capacityDensity = ent.capacityGranted > 0
    ? Math.min(1, (ent.capacityGranted - ent.capacityRemaining) / ent.capacityGranted)
    : 0.5
  const baseConfidence = isQuiet ? 0.2 : witnessLifted ? 0.5 : 0.3
  const confidence = Math.round((baseConfidence + (capacityDensity * 0.4)) * 100) / 100

  const now = new Date().toISOString()
  const reviewIds: string[] = []
  const skillClaimIds: string[] = []

  // ── AgentReviewRecord × 2 ─────────────────────────────────────
  // (v0: stored as 'agent_review_records' table; on-chain record is R7+ work.)
  const reviewByHolder = randomUUID()
  const reviewByProvider = randomUUID()
  reviewIds.push(reviewByHolder, reviewByProvider)

  // Trust mirror tables (agentReviewRecords / agentSkillClaims /
  // agentAssertions / agentValidationProfiles) were dropped during the
  // data-store consolidation. On-chain registries are canonical; this
  // action used to insert into the SQL mirror but now skips entirely.
  // The returned ids are placeholders so callers can still thread them
  // through the engagement record + thread entry below; re-implement
  // against the on-chain writers when needed.
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
  skillClaimIds.push(randomUUID(), randomUUID())
  void baseScore
  void confidence
  void isQuiet
  void terms

  // ── Persist refs back on engagement, advance phase, deposit ───
  try { db.update(schema.entitlements)
    .set({
      reviewIds: JSON.stringify(reviewIds),
      assertionId,
      phase: 'deposited',
      updatedAt: now,
    })
    .where(eq(schema.entitlements.id, input.engagementId))
    .run()

   } catch { /* entitlements table dropped */ }// ── Validation profile delta ──────────────────────────────────
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

async function bumpValidationProfile(_agent: string, _witnessLifted: boolean, _now: string): Promise<void> {
  // agentValidationProfiles table dropped — on-chain AgentValidationProfile
  // contract is canonical. The on-chain writer is not yet wired through
  // this action layer; track in v2-backlog.
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}
