// Contract: @smart-agent/sdk/matchmaker
// Phase 1 design artifact for spec 001 — Intent Marketplace (Direct Lane).
// This file describes the public surface the implementation must honour.
//
// Persistence model (per docs/information-architecture/10-intent-marketplace-classification.md § 1):
//   - MatchInitiation body lives in the initiator's MCP (person-mcp or org-mcp).
//   - On-chain `sa:MatchInitiationAssertion` mint is conditional on both source
//     intents being public-tier (cascade rule, IA § 3.1; SHACL shape
//     `sa:PrivateIntentInitiationNoAnchorShape`).
//   - GraphDB mirror is populated by the on-chain → GraphDB sync only.
//
// TS field → T-Box predicate mapping (Audit § 3 + § 8.2):
//   RankBasis is opaque to SPARQL; persisted as JSON literal on `sa:basis`.

import type { Intent } from "@smart-agent/types";

/** Snapshot of the contributing signals at rank time. Persisted as MatchInitiation.basis. */
export type RankBasis = {
  proximityHops: number;
  proximityScore: number; // 1 / (1 + proximityHops)
  priorOutcomes: { fulfilled: number; abandoned: number };
  outcomeScore: number; // (fulfilled + 1) / (fulfilled + abandoned + 2)
  composite: number; // 0.6 * proximityScore + 0.4 * outcomeScore
  isColdStart: boolean; // true when fulfilled === 0 && abandoned === 0
};

export type Candidate = {
  intent: Intent;
  hopsFromViewer: number;
  expresserPriorOutcomes: { fulfilled: number; abandoned: number };
};

export type RankedCandidate = Candidate & {
  basis: RankBasis;
  score: number; // === basis.composite
};

/**
 * Rank candidates by the spec's composite formula. PURE — no I/O.
 *
 * Formula (per spec.md Clarification Q4):
 *   proximityScore = 1 / (1 + hops)
 *   outcomeScore   = (fulfilled + 1) / (fulfilled + abandoned + 2)   // Laplace-smoothed
 *   composite      = 0.6 * proximityScore + 0.4 * outcomeScore
 *
 * Tie-breaking (per FR-016): composite scores within 1e-6 are tied; ties broken on recency
 * (most recently expressed first). Caller must pass `expressedAt` via Intent.
 */
export function rankCandidates(candidates: Candidate[]): RankedCandidate[];

/**
 * Default weights (per Clarification Q4). Surfaced as a constant so callers can override
 * in tests; production callers should not pass custom weights without a config decision.
 */
export const DEFAULT_RANK_WEIGHTS: { proximity: 0.6; outcome: 0.4 };

/**
 * Tolerance for tie detection (per FR-016).
 */
export const RANK_TIE_TOLERANCE: 1e-6;
