/**
 * Spec 001 — Intent Marketplace (Direct Lane). MatchInitiation types.
 *
 * Mirrors `specs/001-intent-marketplace-discovery/contracts/match-initiation.ts`
 * verbatim. Carrying the runtime-importable copy in the SDK so consumers
 * don't need to import from the spec directory.
 *
 * Persistence model (per IA § 2.1):
 *   - Body lives in INITIATOR's MCP (person-mcp or org-mcp), in the
 *     `match_initiations` table.
 *   - On-chain anchor (sa:MatchInitiationAssertion) is minted only when
 *     `visibility` is 'public' or 'public-coarse' (strictest of the two
 *     source intents).
 *   - GraphDB mirror is populated by the on-chain → GraphDB sync.
 *   - The MCP→GraphDB pipe is forbidden (IA P4).
 */

import type { RankBasis } from '../matchmaker'

export type MatchInitiationKind = 'self' | 'connector'
export type MatchInitiationStatus = 'pending' | 'superseded' | 'consumed'

/** Privacy tier; cascades from source intents. */
export type MatchInitiationVisibility =
  | 'public'
  | 'public-coarse'
  | 'private'
  | 'off-chain'

/**
 * The terminal artifact of spec 001. Body persisted in the initiator's MCP.
 * Field shape is fixed by spec.md Clarification Q3.
 */
export interface MatchInitiation {
  id: string
  viewedIntentId: string
  candidateIntentId: string
  initiatorAgentId: string
  initiationKind: MatchInitiationKind
  /** ISO-8601. */
  proposedAt: string
  basis: RankBasis
  status: MatchInitiationStatus
  visibility: MatchInitiationVisibility
  /** Present iff anchored on chain (visibility ∈ {public, public-coarse}). */
  onChainAssertionId?: string
}

export interface ProposeMatchRequest {
  viewedIntentId: string
  candidateIntentId: string
  initiatorAgentId: string
  /**
   * Basis snapshot computed by the matchmaker at the time the user clicked
   * "Propose match". Persisted verbatim so the rationale is preserved even
   * if the underlying graph changes later.
   */
  basis: RankBasis
}

export type ProposeMatchError =
  | { kind: 'stale-candidate'; reason: 'withdrawn' | 'fulfilled' | 'abandoned' }
  | { kind: 'duplicate-pending'; existingInitiationId: string }
  | { kind: 'self-match-excluded' }
  | { kind: 'visibility-blocked'; reason: 'private-non-credentialed' }
  | { kind: 'validation'; messages: string[] }

export type ProposeMatchResult =
  | { ok: true; initiation: MatchInitiation }
  | { ok: false; error: ProposeMatchError }
