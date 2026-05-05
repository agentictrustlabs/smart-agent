/**
 * @smart-agent/sdk/matchmaker
 *
 * Pure-function ranking shared across the three intent-marketplace lanes:
 *   - spec 001 (Direct lane)   — ranks counter-intents
 *   - spec 002 (Pool lane)     — ranks pools
 *   - spec 003 (Proposal lane) — ranks rounds (proposer side) AND
 *                                proposals (steward side)
 *
 * The formula is owned here. Side-specific signal computation
 * (e.g., spec 003's proposer-side vs steward-side) lives elsewhere
 * — typically in `matchmaker/side-signals.ts` per spec, or in the
 * caller's data layer. This module only does the math.
 */

export {
  computeBasis,
  rank,
  rankCue,
  DEFAULT_RANK_WEIGHTS,
  RANK_TIE_TOLERANCE,
} from './ranking'

export type { RankBasis, RankableSignals, Rankable, Ranked } from './ranking'
