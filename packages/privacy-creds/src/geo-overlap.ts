/**
 * Geo-overlap scoring (smart-agent.geo-overlap.v1).
 *
 * Lives in @smart-agent/privacy-creds because both the holder wallet
 * (private match path) and the web layer (public match path) compute
 * scores against the same canonical encoding and emit the same evidence
 * commitment.
 *
 *   ⚠ Locked-in shape, do not change without versioning.
 *
 * The orthogonal trust-overlap.v1 scorer (org-membership) stays
 * untouched. This file produces a *separate* score that the trust
 * search action sums with org-overlap; clients can weight them
 * differently per task (local-service tasks weight geo heavily;
 * remote-AI tasks weight geo lightly).
 *
 * Inputs in v1 are computed in two stages:
 *   stage A — coarse city/region/country match against the agent's
 *             ATL_CITY / ATL_REGION / ATL_COUNTRY string properties.
 *             Pure-helper, no RPC, used as an early filter and as a
 *             score floor.
 *   stage B — relation-aware claim match. For each public claim the
 *             candidate has on a feature that contains the caller's
 *             location (server-side GeoSPARQL sfContains), apply the
 *             relation weight × confidence × recency × issuer-trust
 *             multipliers. Private claims contribute via their
 *             sageo:evidenceCommit only (Phase 6 ZK path).
 *
 * Output is a single number plus an `evidenceCommit` that ZK proofs
 * (Phase 6) will target. The score-only contract mirrors trust-overlap.v1.
 */

import { keccak256, toBytes } from 'viem'

export const GEO_POLICY_ID = 'smart-agent.geo-overlap.v1'

// ─── Coarse tags (stage A) ──────────────────────────────────────────

/** Lowercase normalisation for string equality on city/region/country. */
function norm(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase()
}

export interface CoarseGeoTag {
  city: string | null
  region: string | null
  country: string | null
}

/**
 * Coarse-tag overlap. Returns a score in [0, 1.7]:
 *   same country  +0.2
 *   same region   +0.5  (implies same country at this resolution)
 *   same city     +1.0  (implies same region & country)
 * Components stack — same-city pairs land at 1.0 + 0.5 + 0.2 = 1.7.
 */
export function coarseTagOverlap(a: CoarseGeoTag, b: CoarseGeoTag): number {
  let s = 0
  if (a.country && b.country && norm(a.country) === norm(b.country)) s += 0.2
  if (a.region  && b.region  && norm(a.region)  === norm(b.region))  s += 0.5
  if (a.city    && b.city    && norm(a.city)    === norm(b.city))    s += 1.0
  return s
}

// ─── Relation weights (stage B) ──────────────────────────────────────

/**
 * Default weights per relation. Higher = "this relation is a stronger
 * signal of geographic affinity for the caller's task." Tasks can
 * override via `policyOverrides`.
 */
export const DEFAULT_GEO_RELATION_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  // Strong personal anchors
  'geo:residentOf':           1.5,
  'geo:originIn':             0.6,
  // Operational anchors
  'geo:operatesIn':           1.0,
  'geo:servesWithin':         1.2,
  'geo:licensedIn':           1.0,
  'geo:completedTaskIn':      0.8,
  'geo:validatedPresenceIn':  1.0,
  // Stewardship — strong for content + governance, weaker for service trust
  'geo:stewardOf':            0.7,
})

export interface GeoClaimInput {
  /** geo:residentOf style relation tag — must match a key in the weights table. */
  relation: string
  /** 0..100; raw on-chain confidence is divided by 100 in scoring. */
  confidence: number
  /** Issued ISO timestamp (or unix-seconds string). Older claims decay. */
  issuedAt?: string
  /** Issuer-trust multiplier — 0..1. 1 = first-party / strong validator;
   *  0.3 = self-asserted; 0 = revoked or unknown issuer. */
  issuerTrust?: number
  /** True if the holder has a successful dispute against this claim;
   *  applies a flat penalty per the policy. */
  disputed?: boolean
  /** Visibility mode — public claims contribute fully; private-zk
   *  claims contribute via the (already-verified) zk proof factor. */
  visibility?: 'Public' | 'PublicCoarse' | 'PrivateCommitment' | 'PrivateZk' | 'OffchainOnly'
}

const DAY_SECONDS = 86_400
const TWO_YEARS_SECONDS = 730 * DAY_SECONDS

/** Half-life recency: 1.0 if fresh, 0.5 at 1 year, 0.25 at 2 years, floored at 0.1. */
function recencyMultiplier(issuedAtIso: string | undefined): number {
  if (!issuedAtIso) return 1.0
  const issued = isNaN(Date.parse(issuedAtIso))
    ? Number(issuedAtIso) * 1000
    : Date.parse(issuedAtIso)
  if (!isFinite(issued)) return 1.0
  const ageSec = Math.max(0, (Date.now() - issued) / 1000)
  if (ageSec >= TWO_YEARS_SECONDS) return 0.1
  // exp(-ln2 * age / 1y) — halves every 365d, floored at 0.1
  const halflives = ageSec / (365 * DAY_SECONDS)
  return Math.max(0.1, Math.pow(0.5, halflives))
}

const VISIBILITY_FACTOR: Record<NonNullable<GeoClaimInput['visibility']>, number> = {
  Public: 1.0,
  PublicCoarse: 0.8,
  PrivateCommitment: 0.0, // contributes only when accompanied by a ZK proof
  PrivateZk: 0.9,         // verified ZK proof: nearly as good as public
  OffchainOnly: 0.5,
}

/** Score contribution from a single matched public/zk claim. */
export function scoreSingleClaim(claim: GeoClaimInput, weights = DEFAULT_GEO_RELATION_WEIGHTS): number {
  if (claim.disputed) return 0
  const w = weights[claim.relation] ?? 0
  if (w === 0) return 0
  const conf = Math.max(0, Math.min(1, claim.confidence / 100))
  const recency = recencyMultiplier(claim.issuedAt)
  const issuer = Math.max(0, Math.min(1, claim.issuerTrust ?? 0.5))
  const vis = VISIBILITY_FACTOR[claim.visibility ?? 'Public']
  return w * conf * recency * issuer * vis
}

// ─── Top-level score ────────────────────────────────────────────────

export interface GeoOverlapInput {
  caller: CoarseGeoTag
  candidate: CoarseGeoTag
  /** Public claims the candidate has against features that contain the
   *  caller's location. Server-side GeoSPARQL produces this list before
   *  scoring. */
  matchedClaims?: GeoClaimInput[]
  /** Optional policy overrides — e.g. a remote-AI task lowers
   *  residentOf weight to 0.2. */
  weightOverrides?: Partial<Record<string, number>>
}

export interface GeoOverlapResult {
  score: number
  coarseScore: number
  claimScore: number
  /** Number of public claims that matched. */
  matchedCount: number
  /** keccak256-canonical commit so audits + ZK proofs target the same digest. */
  evidenceCommit: `0x${string}`
}

export function geoOverlapScore(args: GeoOverlapInput): GeoOverlapResult {
  const weights: Record<string, number> = { ...DEFAULT_GEO_RELATION_WEIGHTS }
  for (const [k, v] of Object.entries(args.weightOverrides ?? {})) {
    if (typeof v === 'number') weights[k] = v
  }
  const coarseScore = coarseTagOverlap(args.caller, args.candidate)
  let claimScore = 0
  let matchedCount = 0
  for (const c of args.matchedClaims ?? []) {
    const s = scoreSingleClaim(c, weights)
    if (s > 0) { claimScore += s; matchedCount++ }
  }
  const score = coarseScore + claimScore
  return {
    score: Number(score.toFixed(4)),
    coarseScore: Number(coarseScore.toFixed(4)),
    claimScore: Number(claimScore.toFixed(4)),
    matchedCount,
    evidenceCommit: geoEvidenceCommit(args),
  }
}

// ─── Canonical evidence commit ───────────────────────────────────────

/** Same JCS shape as trust-overlap.v1 — sorted keys, lowercased strings. */
function canon(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']'
  const obj = value as Record<string, unknown>
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canon(obj[k])).join(',') + '}'
}

/**
 * Commit over (callerCoarse, candidateCoarse, matchedClaimRelations,
 * weightOverrides, policyId). The H3MembershipInCoverageRoot circuit
 * (Phase 6) will compute this exact digest from the public preimage so
 * a ZK proof can target it without any further off-chain reconstruction.
 */
export function geoEvidenceCommit(args: GeoOverlapInput): `0x${string}` {
  const norm1 = (t: CoarseGeoTag) => ({
    city: norm(t.city), region: norm(t.region), country: norm(t.country),
  })
  const evidence = {
    policyId: GEO_POLICY_ID,
    caller: norm1(args.caller),
    candidate: norm1(args.candidate),
    relations: (args.matchedClaims ?? []).map(c => c.relation).sort(),
    overrides: args.weightOverrides
      ? Object.fromEntries(Object.entries(args.weightOverrides).sort())
      : {},
  }
  return keccak256(toBytes(canon(evidence)))
}
