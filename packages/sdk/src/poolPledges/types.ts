/**
 * Spec 002 — Intent Marketplace (Pool Lane). PoolPledge types.
 *
 * Mirrors `specs/002-intent-marketplace-pool/contracts/pool-pledge.ts` verbatim.
 * The spec contract is not a published package, so the SDK carries the
 * runtime-importable copy.
 *
 * IA invariants (enforced by callers + SHACL, declared here for documentation):
 *   - Body lives in the donor's MCP (`pool_pledges` table on person-mcp /
 *     org-mcp).
 *   - On-chain `sa:PledgeAssertion` mint is conditional:
 *       pool public + storyPermissions=public               → full assertion
 *       pool public + storyPermissions=shareWithSupportTeam → coarse (donor IRI omitted)
 *       pool public + storyPermissions=anonymous            → NO anchor
 *       pool private (any storyPermissions)                 → NO anchor
 *     SHACL `sa:AnonymousPledgeNoAnchorShape` and
 *     `sa:PrivatePoolPledgeNoAnchorShape` enforce these gates.
 *   - Pool's `pledgedTotal` aggregate lives in pool's org-mcp; donor's MCP
 *     issues a `pool:contribute_to_total` system-delegation at submit time.
 *   - For non-anonymous pledges, donor issues `pool:read_pledge` cross-
 *     delegation to pool stewards at submit time.
 */

export type PledgeCadence = 'one-time' | 'monthly' | 'annual'

export type PledgeStoryPermission =
  | 'public'
  | 'shareWithSupportTeam'
  | 'anonymous'

export type PledgeStatus =
  | 'active'
  | 'waitlisted'
  | 'stopped'
  | 'auto-stopped'
  /** Set by the downstream allocation/disbursement spec; this spec never sets it. */
  | 'fulfilled'

export interface PledgeRestrictions {
  kinds?: string[]
  geoRoots?: string[]
  notForAdmin?: boolean
  notForDiscretionary?: boolean
}

export type PledgeAmendmentKind = 'amount' | 'cadence' | 'duration'

/**
 * Documentation-only in T-Box (sa:PledgeAmendment is described, not reified —
 * Audit § 8.1). Embedded as a JSON literal in pledge's `sa:pledgeHistory`.
 */
export interface PledgeAmendment {
  kind: PledgeAmendmentKind
  prevValue: number | string
  newValue: number | string
  /** ISO-8601. */
  amendedAt: string
  /** Set on cadence/duration amendments per Q4. */
  windowResetAt?: string
}

/** Privacy tier; cascades from pool visibility + storyPermissions (IA § 2.2 matrix). */
export type PledgeVisibility = 'public' | 'public-coarse' | 'private'

export interface PoolPledge {
  id: string
  pledgerAgentId: string
  poolAgentId: string
  cadence: PledgeCadence
  /** Must be in pool.acceptedUnits (Q1). */
  unit: string
  amount: number
  /** Months for monthly, years for annual; undefined for one-time. */
  duration?: number
  restrictions?: PledgeRestrictions
  storyPermissions: PledgeStoryPermission
  /** ISO-8601. */
  pledgedAt: string
  /** ISO-8601. Bright line for the Q5 future-obligations rule. */
  stoppedAt?: string
  status: PledgeStatus
  history: PledgeAmendment[]
  visibility: PledgeVisibility
  /** Present iff anchored on chain. */
  onChainAssertionId?: string
  /** Spec 005 — per-token settlement totals (decimal strings to preserve bigint precision). */
  settlements?: PledgeSettlement[]
  /** Spec 005 — most recent admin attestation, if any. */
  lastMarkedPayment?: PledgeMarkedPayment | null
}

export interface PledgeSettlement {
  /** Token contract address. v1: MockUSDC. */
  token: string
  /** Cumulative Rail-A (donor treasury) honored amount, token-scaled bigint as decimal string. */
  honored: string
  /** Cumulative Rail-B (admin mark-paid) attested amount. */
  externallyPaid: string
}

export type PledgePaymentRail = 'crypto' | 'bank' | 'check' | 'cash' | 'in-kind' | 'other'

export interface PledgeMarkedPayment {
  rail: PledgePaymentRail
  /** sha256 of evidence document, hex-prefixed. */
  evidenceHash: string
  /** AgentAccount of the admin who attested. */
  markedByAgent: string
  markedAt: string | null
}

export type SubmitPledgeRequest = Omit<
  PoolPledge,
  | 'id'
  | 'pledgedAt'
  | 'stoppedAt'
  | 'status'
  | 'history'
  | 'visibility'
  | 'onChainAssertionId'
  | 'settlements'
  | 'lastMarkedPayment'
>

export interface AmendPledgeRequest {
  pledgeId: string
  change:
    | { kind: 'amount'; newValue: number }
    | { kind: 'cadence'; newValue: PledgeCadence }
    | { kind: 'duration'; newValue: number }
}

export type SubmitPledgeError =
  | { kind: 'unit-not-accepted'; allowedUnits: string[] }
  | { kind: 'restriction-not-accepted'; allowedRestrictions: PledgeRestrictions }
  | { kind: 'ceiling-blocked'; remainingCapacity: number }
  | { kind: 'private-pool-not-addressed' }
  | { kind: 'validation'; messages: string[] }

export type SubmitPledgeResult =
  | { ok: true; pledge: PoolPledge; status: 'active' | 'waitlisted' }
  | { ok: false; error: SubmitPledgeError }

/** Pure helper: cadence-aware total used by capacity widgets. */
export function cadenceAwareTotal(p: {
  cadence: PledgeCadence
  amount: number
  duration?: number | null
}): number {
  if (p.cadence === 'one-time') return p.amount
  const dur = p.duration ?? 1
  return p.amount * Math.max(1, dur)
}
