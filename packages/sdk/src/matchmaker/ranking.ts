/**
 * Matchmaker ranking — pure functions, no I/O.
 *
 * Used by the intent-marketplace specs to rank candidates / pools / rounds
 * by a single composite formula:
 *
 *     proximityScore = 1 / (1 + hops)
 *     outcomeScore   = (fulfilled + 1) / (fulfilled + abandoned + 2)   // Laplace-smoothed
 *     composite      = 0.6 * proximityScore + 0.4 * outcomeScore
 *
 * The Laplace smoothing (alpha=1, beta=1) handles cold-start in-line —
 * an agent with zero outcomes gets `outcomeScore = 0.5` rather than NaN
 * or a separate cold-start branch.
 *
 * Tie-breaking: composite scores within RANK_TIE_TOLERANCE are tied; ties
 * break on a caller-supplied recency key (most recent first).
 *
 * Contracts (spec 001 / 002 / 003 — see each spec's contracts directory)
 * define the shape of the artifacts this module ranks; this file owns the math.
 *
 * Reused as-is by all three lanes:
 *   spec 001 — ranks counter-intents for a viewer
 *   spec 002 — ranks pools (proximity to pool agent / steward)
 *   spec 003 — ranks rounds for a proposer AND proposals for a steward
 *              (each side computes its own RankableSignals from
 *              `matchmaker-side-signals` and feeds them in here)
 */

// ---------------------------------------------------------------------------
// Constants (per spec 001 Clarification Q4)
// ---------------------------------------------------------------------------

/**
 * Default weights for the composite formula. Documented as defaults in the
 * specs; tunable via configuration without changing the model.
 */
export const DEFAULT_RANK_WEIGHTS: { readonly proximity: 0.6; readonly outcome: 0.4 } = {
  proximity: 0.6,
  outcome: 0.4,
}

/**
 * Tie tolerance — composite scores within this delta are considered tied
 * and broken on recency (per spec 001 FR-016).
 */
export const RANK_TIE_TOLERANCE = 1e-6

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Snapshot of the contributing signals at rank time. Persisted as artifact `basis`. */
export interface RankBasis {
  /** Hops in the AgentRelationship graph. Capped at 6 by callers; ∞ → null score. */
  proximityHops: number
  /** `1 / (1 + proximityHops)`. */
  proximityScore: number
  /** Counts of the candidate's prior fulfilled / abandoned artifacts. */
  priorOutcomes: { fulfilled: number; abandoned: number }
  /** Laplace-smoothed: `(fulfilled + 1) / (fulfilled + abandoned + 2)`. */
  outcomeScore: number
  /** `weights.proximity * proximityScore + weights.outcome * outcomeScore`. */
  composite: number
  /** True when both `fulfilled` and `abandoned` are 0. Used for the rank cue. */
  isColdStart: boolean
}

/**
 * The minimal signal set a caller must compute per item before ranking.
 * Side-specific signals (proposer-side / steward-side / pool-side / candidate-side)
 * all reduce to this shape.
 */
export interface RankableSignals {
  /** Hops between the viewer/source agent and the candidate's anchor agent. */
  proximityHops: number
  /** Counts of the candidate's prior fulfilled / abandoned artifacts. */
  priorOutcomes: { fulfilled: number; abandoned: number }
  /**
   * Optional recency timestamp (ISO date string or numeric epoch). Used only
   * for tie-breaking when composite scores are within RANK_TIE_TOLERANCE.
   * Most-recent-first ordering — see spec 001 FR-016.
   */
  recencyKey?: string | number
}

/**
 * Generic carrier: an item plus the signals needed to rank it. Callers wrap
 * their domain object (Intent, Pool, Round, Proposal) plus the computed signals.
 */
export interface Rankable<T> {
  item: T
  signals: RankableSignals
}

/** A ranked item with the basis snapshot the caller persists into the artifact. */
export interface Ranked<T> {
  item: T
  signals: RankableSignals
  basis: RankBasis
  score: number
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Compute the RankBasis snapshot from raw signals. Pure.
 *
 * @param signals - hops + (fulfilled, abandoned) counts.
 * @param weights - composite weights; defaults to DEFAULT_RANK_WEIGHTS.
 */
export function computeBasis(
  signals: RankableSignals,
  weights: { proximity: number; outcome: number } = DEFAULT_RANK_WEIGHTS,
): RankBasis {
  const { proximityHops } = signals
  const { fulfilled, abandoned } = signals.priorOutcomes

  // Proximity: hops are non-negative integers; ∞ would be infeasible to
  // represent here so callers should pre-filter unreachable agents.
  const proximityScore = 1 / (1 + Math.max(0, proximityHops))

  // Outcome: Laplace smoothing (alpha=1, beta=1) → cold-start = 0.5
  const outcomeScore = (fulfilled + 1) / (fulfilled + abandoned + 2)

  const composite = weights.proximity * proximityScore + weights.outcome * outcomeScore

  return {
    proximityHops,
    proximityScore,
    priorOutcomes: { fulfilled, abandoned },
    outcomeScore,
    composite,
    isColdStart: fulfilled === 0 && abandoned === 0,
  }
}

/**
 * Convert a recency key into a sortable number. ISO date strings → epoch ms;
 * numeric stays numeric; missing → -Infinity (sorts last among ties).
 */
function recencyAsNumber(key: string | number | undefined): number {
  if (typeof key === 'number') return Number.isFinite(key) ? key : -Infinity
  if (typeof key === 'string') {
    const t = Date.parse(key)
    if (!Number.isNaN(t)) return t
    const n = Number(key)
    return Number.isFinite(n) ? n : -Infinity
  }
  return -Infinity
}

/**
 * Rank a list of items by the composite formula. Pure; deterministic for a
 * given input snapshot (per spec 001 FR-013). Returns a new array; does not
 * mutate input.
 *
 * Ordering:
 *   1. composite score, descending
 *   2. tie-break (within RANK_TIE_TOLERANCE) on `signals.recencyKey`,
 *      most-recent first.
 */
export function rank<T>(
  items: ReadonlyArray<Rankable<T>>,
  weights: { proximity: number; outcome: number } = DEFAULT_RANK_WEIGHTS,
): Ranked<T>[] {
  const ranked: Ranked<T>[] = items.map((it) => {
    const basis = computeBasis(it.signals, weights)
    return { item: it.item, signals: it.signals, basis, score: basis.composite }
  })

  ranked.sort((a, b) => {
    const dScore = b.score - a.score
    if (Math.abs(dScore) > RANK_TIE_TOLERANCE) return dScore
    const ra = recencyAsNumber(a.signals.recencyKey)
    const rb = recencyAsNumber(b.signals.recencyKey)
    return rb - ra
  })

  return ranked
}

// ---------------------------------------------------------------------------
// Helpers for the rank-cue UI (spec 001 FR-014; reused by 002 / 003)
// ---------------------------------------------------------------------------

/**
 * Render a one-line rank cue from a basis. Examples:
 *   "1 hop · 4 fulfilled / 0 abandoned"
 *   "4 hops · no prior history yet"
 *
 * UI may further format (icons, tooltip), but this is the canonical text.
 */
export function rankCue(basis: RankBasis): string {
  const hop = basis.proximityHops === 1 ? 'hop' : 'hops'
  const prox = `${basis.proximityHops} ${hop}`
  const outcome = basis.isColdStart
    ? 'no prior history yet'
    : `${basis.priorOutcomes.fulfilled} fulfilled / ${basis.priorOutcomes.abandoned} abandoned`
  return `${prox} · ${outcome}`
}
