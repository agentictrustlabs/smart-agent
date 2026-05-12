'use server'

/**
 * Trust residue — what shows on an agent's profile after engagements close.
 *
 * Reads on-chain from `AgentReviewRecord` (canonical). The legacy mirror
 * tables (`agent_review_records`, `agent_skill_claims`,
 * `agent_validation_profiles`) were dropped during the data-store
 * consolidation; this reader now walks the chain directly.
 *
 * v1 covers reviews; skills + validation-profile aggregates are summarised
 * from the same reviews list (`AgentSkillRegistry` reader and explicit
 * `AgentValidationProfile` chain reads are queued — the review count is a
 * decent proxy for `engagementsCount` until then).
 */

import { agentReviewRecordAbi } from '@smart-agent/sdk'
import { getPublicClient } from '@/lib/contracts'
import { getAddress, type Address } from 'viem'

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

interface ChainReview {
  reviewId: bigint
  reviewer: Address
  subject: Address
  reviewType: `0x${string}`
  recommendation: `0x${string}`
  overallScore: number
  signedValue: bigint
  valueDecimals: number
  tag1: `0x${string}`
  tag2: `0x${string}`
  endpoint: string
  comment: string
  evidenceURI: string
  feedbackHash: `0x${string}`
  createdAt: bigint
  revoked: boolean
}

export async function getTrustResidue(agent: string): Promise<TrustResidue> {
  const lower = agent.toLowerCase()
  const empty: TrustResidue = {
    agent: lower,
    engagementsCount: 0,
    witnessedCount: 0,
    lastEngagementAt: null,
    recentReviews: [],
    skills: [],
  }

  const reviewAddr = process.env.AGENT_REVIEW_ADDRESS as `0x${string}` | undefined
  if (!reviewAddr) return empty

  const client = getPublicClient()
  let reviewIds: readonly bigint[] = []
  try {
    reviewIds = (await client.readContract({
      address: reviewAddr,
      abi: agentReviewRecordAbi,
      functionName: 'getReviewsBySubject',
      args: [getAddress(lower as `0x${string}`)],
    })) as readonly bigint[]
  } catch { return empty }
  if (reviewIds.length === 0) return empty

  // Fan out; most agents have a handful of reviews.
  const fetched = await Promise.all(
    reviewIds.map(async (id) => {
      try {
        return (await client.readContract({
          address: reviewAddr,
          abi: agentReviewRecordAbi,
          functionName: 'getReview',
          args: [id],
        })) as ChainReview
      } catch { return null }
    }),
  )
  const reviews = fetched.filter((r): r is ChainReview => r !== null && !r.revoked)
  if (reviews.length === 0) return empty

  reviews.sort((a, b) => Number(b.createdAt - a.createdAt))
  const lastTs = reviews[0].createdAt
  const recentReviews = reviews.slice(0, 10).map((r) => ({
    id: r.reviewId.toString(),
    reviewerAgent: r.reviewer,
    score: Number(r.overallScore),
    // The on-chain record doesn't carry a per-review confidence — surface
    // the score directly normalized to 0..1 as a stand-in until R7 fully
    // lands. v2 will read from AgentValidationProfile for real confidence.
    confidence: Math.min(1, Math.max(0, Number(r.overallScore) / 100)),
    narrative: r.comment || null,
    witnessLifted: false, // not represented on the v1 chain record
    createdAt: new Date(Number(r.createdAt) * 1000).toISOString(),
  }))

  // Skills: not yet on chain in v1; summary stays empty until
  // AgentSkillRegistry reader is wired.
  const skills: TrustResidue['skills'] = []

  return {
    agent: lower,
    engagementsCount: reviews.length,
    witnessedCount: 0,
    lastEngagementAt: new Date(Number(lastTs) * 1000).toISOString(),
    recentReviews,
    skills,
  }
}
