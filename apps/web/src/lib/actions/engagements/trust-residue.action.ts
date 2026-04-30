'use server'

/**
 * Trust residue — what shows on an agent's profile after engagements close.
 *
 * Reads the local mirror of the on-chain trust artifacts:
 *   • AgentValidationProfile  — running counts + recency
 *   • AgentSkillClaim         — attested skills (provider) + growth (holder)
 *   • AgentReviewRecord       — peer reviews (most recent first)
 *
 * This is what `TrustResidueCard` renders on the agent profile and what
 * R8 will read when scoring future matches.
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §4
 */

import { db, schema } from '@/db'
import { desc, eq } from 'drizzle-orm'

export interface TrustResidue {
  agent: string
  engagementsCount: number
  witnessedCount: number
  lastEngagementAt: string | null
  recentReviews: Array<{
    id: string
    reviewerAgent: string
    score: number
    confidence: number
    narrative: string | null
    witnessLifted: boolean
    createdAt: string
  }>
  skills: Array<{
    skillSlug: string
    side: 'holder' | 'provider'
    count: number
    lastAttestedAt: string
    confidenceAvg: number
    witnessedFraction: number
  }>
}

export async function getTrustResidue(agent: string): Promise<TrustResidue> {
  const lower = agent.toLowerCase()

  // Profile (may not exist for agents who haven't closed an engagement yet).
  const profile = db.select().from(schema.agentValidationProfiles)
    .where(eq(schema.agentValidationProfiles.agent, lower))
    .get()

  // Most recent reviews where this agent is the subject.
  const reviews = await db.select().from(schema.agentReviewRecords)
    .where(eq(schema.agentReviewRecords.subjectAgent, lower))
    .orderBy(desc(schema.agentReviewRecords.createdAt))
    .limit(10)

  // Skill claims grouped by slug + side.
  const claimRows = await db.select().from(schema.agentSkillClaims)
    .where(eq(schema.agentSkillClaims.subjectAgent, lower))
    .orderBy(desc(schema.agentSkillClaims.createdAt))

  const grouped = new Map<string, {
    skillSlug: string
    side: 'holder' | 'provider'
    count: number
    lastAttestedAt: string
    confidenceSum: number
    witnessedCount: number
  }>()
  for (const c of claimRows) {
    const key = `${c.side}::${c.skillSlug}`
    const existing = grouped.get(key)
    if (existing) {
      existing.count++
      existing.confidenceSum += c.confidence
      existing.witnessedCount += c.witnessLifted ? 1 : 0
      if (c.createdAt > existing.lastAttestedAt) existing.lastAttestedAt = c.createdAt
    } else {
      grouped.set(key, {
        skillSlug: c.skillSlug,
        side: c.side,
        count: 1,
        lastAttestedAt: c.createdAt,
        confidenceSum: c.confidence,
        witnessedCount: c.witnessLifted ? 1 : 0,
      })
    }
  }
  const skills = Array.from(grouped.values()).map(g => ({
    skillSlug: g.skillSlug,
    side: g.side,
    count: g.count,
    lastAttestedAt: g.lastAttestedAt,
    confidenceAvg: Math.round((g.confidenceSum / g.count) * 100) / 100,
    witnessedFraction: g.count > 0 ? Math.round((g.witnessedCount / g.count) * 100) / 100 : 0,
  }))

  return {
    agent: lower,
    engagementsCount: profile?.engagementsCount ?? 0,
    witnessedCount: profile?.witnessedCount ?? 0,
    lastEngagementAt: profile?.lastEngagementAt ?? null,
    recentReviews: reviews.map(r => ({
      id: r.id,
      reviewerAgent: r.reviewerAgent,
      score: r.score,
      confidence: r.confidence,
      narrative: r.narrative,
      witnessLifted: r.witnessLifted === 1,
      createdAt: r.createdAt,
    })),
    skills,
  }
}
