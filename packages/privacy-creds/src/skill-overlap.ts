/**
 * Skill-overlap scoring (smart-agent.skill-overlap.v1).
 *
 * Mirrors `geo-overlap.ts` with three skill-specific behaviours:
 *
 *   • **Relation-weighted**: hasSkill (0.6) < practicesSkill (1.0) <
 *     certifiedIn (1.5). Weights chosen so cross-issued certifications
 *     outweigh self-attested practice claims.
 *   • **Proficiency multiplier**: linear in `proficiencyScore` (0–10000).
 *     Final factor is `0.5 + (proficiencyScore / 10000) * 1.0`, giving a
 *     0.5×–1.5× multiplier per claim.
 *   • **Double-counting fixes**: when an issuer is also in the caller's
 *     org set, the issuer-trust boost caps at 1.0 (org-overlap owns the
 *     signal). When a skill claim and a geo claim share the same
 *     `evidenceCommit` from the same issuer, treat them as one bundle
 *     (caller scores the higher of the two contributions, not the sum).
 *
 * Stage-B′ blinding: callers ship `H(evidenceCommit ‖ searchNonce)` to
 * peers, NOT raw evidenceCommit. See §2.7 of the v0 plan for details.
 */

import { keccak256, toBytes } from 'viem'

export const SKILL_POLICY_ID = 'smart-agent.skill-overlap.v1'

// ─── Inputs ───────────────────────────────────────────────────────────

export type SkillRelationLabel =
  | 'hasSkill' | 'practicesSkill' | 'certifiedIn'
  | 'endorsesSkill' | 'mentorsIn' | 'canTrainOthersIn'

export interface SkillClaimInput {
  /** SKOS concept IRI or on-chain skillId hex. */
  skillId: string
  relation: SkillRelationLabel
  /** 0..10000 (basis points of 0..1.0). */
  proficiencyScore: number
  /** 0..100. */
  confidence: number
  /** Issuer address (lowercased hex). */
  issuer: string
  /** Visibility — only Public/PublicCoarse contribute to public scoring. */
  visibility: 'Public' | 'PublicCoarse' | 'PrivateCommitment' | 'PrivateZk' | 'OffchainOnly'
  /** Unix-seconds expiry; 0 means open-ended. */
  validUntil: number
  /** Anchored evidence commit (or zero). Used for cross-bucket de-dup. */
  evidenceCommit: string
}

// ─── Relation weights (stage-B equivalent) ────────────────────────────

export const DEFAULT_SKILL_RELATION_WEIGHTS: Readonly<Record<SkillRelationLabel, number>> = Object.freeze({
  // v0 modalities
  hasSkill:          0.6,   // weakest — bare existence claim
  practicesSkill:    1.0,   // active practice
  certifiedIn:       1.5,   // strong — third-party verifiable
  // v1 cross-issuance acts (heavier — they imply willingness to share + the
  // issuer staked their reputation by saying it).
  endorsesSkill:     1.2,   // peer endorsement
  mentorsIn:         1.7,   // mentor stake higher than self-cert
  canTrainOthersIn:  1.8,   // strongest signal — can teach others
})

// ─── Single-claim scorer ──────────────────────────────────────────────

interface ScoreContext {
  /** Lower-cased addresses the caller is themselves a member of (per
   *  org-overlap). When a skill claim's issuer is in this set, we cap
   *  its issuer-trust multiplier at 1.0 to avoid double-counting with
   *  org-overlap's own contribution. */
  callerOrgs: Set<string>
  /** Per-claim issuer-trust floor. Self-attested claims (issuer ==
   *  subject) clamp to ~0.5 the way geo's `issuerTrust: 0.5` floor
   *  does. */
  issuerTrustFor(issuerAddr: string, isSelfAttested: boolean): number
}

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000

export function scoreSingleSkillClaim(
  claim: SkillClaimInput,
  callerSubject: string,
  ctx: ScoreContext,
  weights: Readonly<Record<SkillRelationLabel, number>> = DEFAULT_SKILL_RELATION_WEIGHTS,
): number {
  if (claim.visibility !== 'Public' && claim.visibility !== 'PublicCoarse') return 0
  if (claim.validUntil > 0 && claim.validUntil * 1000 < Date.now()) return 0

  const relWeight = weights[claim.relation] ?? 0
  if (relWeight === 0) return 0

  const profMultiplier = 0.5 + (claim.proficiencyScore / 10000)
  const confidenceMultiplier = claim.confidence / 100

  const isSelfAttested = claim.issuer.toLowerCase() === callerSubject.toLowerCase()
  let issuerTrust = ctx.issuerTrustFor(claim.issuer, isSelfAttested)
  // Double-counting fix: when issuer is also in the caller's org set,
  // org-overlap already credits this — cap issuer-trust at 1.0.
  if (ctx.callerOrgs.has(claim.issuer.toLowerCase())) {
    issuerTrust = Math.min(issuerTrust, 1.0)
  }

  // Recency decay: claims older than 2y get a 0.5× decay (validUntil
  // already filters expired claims; this is the soft path).
  const decay = 1.0  // placeholder for explicit issuedAt-driven decay in v1

  return relWeight * profMultiplier * confidenceMultiplier * issuerTrust * decay
}

// ─── Top-level overlap ────────────────────────────────────────────────

export interface SkillOverlapInput {
  /** Caller's smart-account address (subject of any self-attested claims). */
  callerSubject: string
  /** Caller's held skill claims (private vault). Stage-B′ contribution. */
  callerHeld: SkillClaimInput[]
  /** Candidate's public skill claims (from on-chain registry). */
  candidatePublic: SkillClaimInput[]
  /** Caller's org-overlap set (lowercased hex). Used by issuer-trust cap. */
  callerOrgs: Set<string>
  /** Optional override map (relation → weight). */
  weightOverrides?: Partial<Record<SkillRelationLabel, number>>
  /**
   * Caller's geo claim evidenceCommits (lowercase hex). Used to de-dup
   * "Erie County social work license"-style cases where the same
   * underlying credential implies both a skill claim AND a geo claim.
   * When a skill claim shares an evidenceCommit with one of these, its
   * contribution is capped at the higher of (skill, geo) — not summed.
   */
  geoEvidenceCommitsFromSameIssuer?: Set<string>
}

export interface SkillOverlapResult {
  score: number
  /** Per-skillId rolled-up contributions. */
  matches: Array<{
    skillId: string
    relation: SkillRelationLabel
    contribution: number
  }>
  /** Number of skill-id intersections (callerHeld ∩ candidatePublic). */
  matchedCount: number
  /** keccak256-canonical commit (audit-targetable). */
  evidenceCommit: `0x${string}`
}

export function skillOverlapScore(args: SkillOverlapInput): SkillOverlapResult {
  const weights: Record<SkillRelationLabel, number> = {
    ...DEFAULT_SKILL_RELATION_WEIGHTS,
    ...(args.weightOverrides ?? {}),
  }

  // Index candidate claims by skillId for the intersection check.
  const candBySkill = new Map<string, SkillClaimInput[]>()
  for (const c of args.candidatePublic) {
    const key = c.skillId.toLowerCase()
    const list = candBySkill.get(key) ?? []
    list.push(c)
    candBySkill.set(key, list)
  }

  const ctx: ScoreContext = {
    callerOrgs: args.callerOrgs,
    issuerTrustFor(issuerAddr, isSelfAttested) {
      // Self-attested: floor at 0.5 (mirrors geo's issuer-trust floor).
      // Cross-issued: 1.0 baseline; v1 introduces a per-issuer registry
      // for finer differentiation.
      return isSelfAttested ? 0.5 : 1.0
    },
  }

  const matches: SkillOverlapResult['matches'] = []
  let total = 0
  let matchedCount = 0

  // Walk caller's held claims; for each one that the candidate also
  // publishes a public claim for, take the candidate's strongest claim
  // contribution (not the sum across multiple candidate claims).
  const heldKeys = new Set<string>()
  for (const held of args.callerHeld) {
    if (held.visibility === 'OffchainOnly') continue  // skip
    const key = held.skillId.toLowerCase()
    if (heldKeys.has(key)) continue
    const candList = candBySkill.get(key)
    if (!candList || candList.length === 0) continue

    let best = 0
    let bestRel: SkillRelationLabel = 'hasSkill'
    for (const cand of candList) {
      const score = scoreSingleSkillClaim(cand, args.callerSubject, ctx, weights)
      if (score > best) {
        best = score
        bestRel = cand.relation
      }
    }

    // Bundled-evidenceCommit de-dup: if this skill claim shares an
    // evidenceCommit with a geo claim from the same issuer, cap.
    const candWithCommit = candList.find(c => c.evidenceCommit !== '0x' + '0'.repeat(64))
    if (candWithCommit && args.geoEvidenceCommitsFromSameIssuer?.has(candWithCommit.evidenceCommit.toLowerCase())) {
      // Already credited under geo; skill contribution capped.
      best = Math.min(best, 0.5)  // soft cap; full implementation in v1
    }

    if (best > 0) {
      matches.push({ skillId: held.skillId, relation: bestRel, contribution: best })
      total += best
      matchedCount += 1
      heldKeys.add(key)
    }
  }

  return {
    score: Number(total.toFixed(4)),
    matches,
    matchedCount,
    evidenceCommit: skillEvidenceCommit(args),
  }
}

// ─── Canonical evidence commit ────────────────────────────────────────

function canon(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']'
  const obj = value as Record<string, unknown>
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canon(obj[k])).join(',') + '}'
}

export function skillEvidenceCommit(args: SkillOverlapInput): `0x${string}` {
  const evidence = {
    policyId: SKILL_POLICY_ID,
    callerSubject: args.callerSubject.toLowerCase(),
    callerHeldSkillIds: args.callerHeld.map(c => c.skillId.toLowerCase()).sort(),
    candidatePublicSkillIds: args.candidatePublic.map(c => c.skillId.toLowerCase()).sort(),
    overrides: args.weightOverrides
      ? Object.fromEntries(Object.entries(args.weightOverrides).sort())
      : {},
  }
  return keccak256(toBytes(canon(evidence)))
}

/**
 * Stage-B′ blinding helper. Caller hashes its evidenceCommit with a
 * per-search nonce before shipping the score externally, preventing
 * cross-search fingerprinting.
 */
export function blindSkillEvidenceCommit(
  evidenceCommit: `0x${string}`,
  searchNonce: string,
): `0x${string}` {
  return keccak256(toBytes(`${evidenceCommit}|${searchNonce}`))
}
