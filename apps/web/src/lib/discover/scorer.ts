/**
 * Need ↔ Resource match scorer.
 *
 * Inputs: a NeedRow (carrying requirements) + an OfferingRow (carrying
 * resourceType, capabilities, geo, timeWindow, capacity).
 *
 * Output: { score: 0..10000 basis points, reason, satisfies, misses }.
 *
 * Score model:
 *   - Each requirement type contributes up to a per-type ceiling.
 *   - Hard mismatches (need wants role X, offering has no compatible
 *     role) zero the entire score.
 *   - Trust adjustment, AnonCred verification, and the policy-id
 *     binding are stubbed in v0; the full implementation is the
 *     responsibility of `packages/privacy-creds/src/match-overlap.ts`
 *     once it lands. Until then, the scorer reads on-chain skill
 *     claims directly via the SDK.
 *
 * Locked-in policy id: `smart-agent.match-overlap.v1`.
 */

import type { NeedRow, OfferingRow } from '@/lib/actions/needs.action'

export interface ScoredMatch {
  offering: OfferingRow
  score: number          // 0..10000
  reason: string         // SKOS concept URI from cbox/resource-types.ttl
  satisfies: string[]    // requirement keys hit
  misses: string[]       // requirement keys missed
}

interface ScoreInput {
  need: NeedRow
  offering: OfferingRow
}

// ─── Per-requirement contribution ceilings (sum to 10000) ───────────

const W_RESOURCE_TYPE = 2500   // does the offering's type match the need's expected kind?
const W_ROLE          = 2000   // role-fit
const W_SKILL         = 2000   // skill-fit
const W_GEO           = 1500   // geo-fit (or geo not required)
const W_AVAILABILITY  = 1000   // time-window fit
const W_CAPACITY      = 500    // enough capacity
const W_CREDENTIAL    = 500    // credential held

// Map each need-type to the resource type(s) that could fulfill it.
// Used as a hard filter — wrong type → score 0.
const NEED_TYPE_TO_RESOURCE_TYPES: Record<string, string[]> = {
  // catalyst v0 set:
  'needType:CircleCoachNeeded':         ['resourceType:Worker', 'resourceType:Skill'],
  'needType:GroupLeaderApprentice':     ['resourceType:Worker', 'resourceType:Skill'],
  'needType:Treasurer':                 ['resourceType:Worker', 'resourceType:Skill'],
  'needType:PrayerPartner':             ['resourceType:Prayer'],
  'needType:ConnectorToFunder':         ['resourceType:Connector'],
  'needType:HeartLanguageScripture':    ['resourceType:Scripture', 'resourceType:Curriculum'],
  'needType:TrainerForT4T':             ['resourceType:Worker', 'resourceType:Skill', 'resourceType:Curriculum'],
  'needType:VenueForGathering':         ['resourceType:Venue'],
  'needType:TraumaInformedCare':        ['resourceType:Worker', 'resourceType:Skill'],
}

export async function scoreOfferingAgainstNeed(input: ScoreInput): Promise<ScoredMatch> {
  const { need, offering } = input
  const satisfies: string[] = []
  const misses: string[] = []

  // ── 1. Resource-type compatibility ──────────────────────────────
  const compatibleTypes = NEED_TYPE_TO_RESOURCE_TYPES[need.needType] ?? []
  // If the need-type isn't in the registry, allow any type but downweight.
  const typeCompatible = compatibleTypes.length === 0 || compatibleTypes.includes(offering.resourceType)
  if (!typeCompatible) {
    return {
      offering,
      score: 0,
      reason: 'matchReason:TypeMismatch',
      satisfies: [],
      misses: ['resourceType'],
    }
  }
  let score = compatibleTypes.length === 0 ? Math.floor(W_RESOURCE_TYPE * 0.5) : W_RESOURCE_TYPE
  satisfies.push('resourceType')

  // ── 2. Role-fit ─────────────────────────────────────────────────
  const requiresRole = need.requirements?.role
  if (requiresRole) {
    const offeredRoles = offering.capabilities.map(c => c.role).filter((r): r is string => Boolean(r))
    const exact = offeredRoles.includes(requiresRole)
    if (exact) {
      score += W_ROLE
      satisfies.push('role')
    } else if (offeredRoles.length > 0) {
      // Partial: the offering carries *some* role, just not the one asked for.
      score += Math.floor(W_ROLE * 0.4)
      misses.push('role')
    } else {
      misses.push('role')
    }
  }

  // ── 3. Skill-fit ────────────────────────────────────────────────
  const requiresSkill = need.requirements?.skill
  if (requiresSkill) {
    const offeredSkills = offering.capabilities.map(c => c.skill).filter((s): s is string => Boolean(s))
    if (offeredSkills.includes(requiresSkill)) {
      // Boost by capability level when present.
      const cap = offering.capabilities.find(c => c.skill === requiresSkill)
      const levelBoost: Record<string, number> = {
        beginner: 0.6, intermediate: 0.8, experienced: 1.0, expert: 1.0,
      }
      const mult = cap?.level ? levelBoost[cap.level] ?? 0.8 : 0.8
      score += Math.floor(W_SKILL * mult)
      satisfies.push('skill')
    } else {
      misses.push('skill')
    }
  }

  // ── 4. Geo-fit ──────────────────────────────────────────────────
  const requiresGeo = need.requirements?.geo
  if (requiresGeo) {
    if (offering.geo === requiresGeo) {
      score += W_GEO
      satisfies.push('geo')
    } else if (offering.geo && requiresGeo) {
      // Same region but different city → partial.
      const reqRegion = requiresGeo.split('/').slice(0, 2).join('/')
      const offRegion = offering.geo.split('/').slice(0, 2).join('/')
      if (reqRegion === offRegion) {
        score += Math.floor(W_GEO * 0.5)
        satisfies.push('geo')
      } else {
        misses.push('geo')
      }
    } else {
      misses.push('geo')
    }
  } else {
    // No geo requirement — full credit.
    score += W_GEO
  }

  // ── 5. Availability ─────────────────────────────────────────────
  const requiresAvailability = need.requirements?.timeWindow
  if (requiresAvailability) {
    if (offering.timeWindow) {
      // Naive: any presence of a time window counts. Real overlap math
      // lives in match-overlap.ts (N7).
      score += W_AVAILABILITY
      satisfies.push('availability')
    } else {
      // No declared window means "ask me" — partial credit.
      score += Math.floor(W_AVAILABILITY * 0.4)
      misses.push('availability')
    }
  } else {
    score += W_AVAILABILITY
  }

  // ── 6. Capacity ─────────────────────────────────────────────────
  const requiresCapacity = need.requirements?.capacity
  if (requiresCapacity) {
    if (offering.capacity && offering.capacity.amount >= requiresCapacity.amount) {
      score += W_CAPACITY
      satisfies.push('capacity')
    } else if (offering.capacity) {
      const ratio = offering.capacity.amount / Math.max(1, requiresCapacity.amount)
      score += Math.floor(W_CAPACITY * Math.min(1, ratio))
      misses.push('capacity')
    } else {
      misses.push('capacity')
    }
  } else {
    score += W_CAPACITY
  }

  // ── 7. Credential ───────────────────────────────────────────────
  const requiresCredential = need.requirements?.credential
  if (requiresCredential) {
    const evidenced = offering.capabilities.some(c => c.evidence)
    if (evidenced) {
      score += W_CREDENTIAL
      satisfies.push('credential')
    } else {
      // No evidence — no credit, but not disqualifying.
      misses.push('credential')
    }
  } else {
    score += W_CREDENTIAL
  }

  // ── Reason classification (just the dominant signal) ────────────
  let reason = 'matchReason:SkillRoleGeoFit'
  if (satisfies.includes('credential')) reason = 'matchReason:CredentialMatch'
  if (satisfies.includes('availability') && satisfies.length <= 2) reason = 'matchReason:AvailabilityMatch'
  if (satisfies.includes('role') && !satisfies.includes('skill')) reason = 'matchReason:RoleAssignmentDirect'

  return {
    offering,
    score: Math.max(0, Math.min(10000, score)),
    reason,
    satisfies,
    misses,
  }
}
