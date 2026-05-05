// Contract: @smart-agent/sdk/matchmaker/side-signals
// Phase 1 design artifact for spec 003 — Intent Marketplace (Proposal Lane).
//
// The ranking *formula* is owned by spec 001's matchmaker module:
//   composite = 0.6 * proximityScore + 0.4 * outcomeScore
//   proximityScore = 1 / (1 + hops)
//   outcomeScore   = (fulfilled + 1) / (fulfilled + abandoned + 2)
//
// This module defines the *signals* per side (Q1: proposer; Q2: steward) and
// produces RankBasis values that feed spec 001's `rankCandidates`.
//
// Note on the artifact name: spec 003's terminal artifact is `GrantProposal`
// (T-Box: `sa:GrantProposal`; the rename from `ProposalSubmission` per Audit § 2 O1
// has propagated into TS via `./grant-proposal.ts`).

import type { RankBasis } from "../../001-intent-marketplace-discovery/contracts/matchmaker";

/**
 * Q1 — Proposer side.
 * Surface eligible rounds to a proposer ranked by:
 *   proximityHops = hops(proposer → round.fundAgent)         (T-Box: sa:operatedByFund)
 *   priorOutcomes = fund's prior awards in the proposer's intent domain (SKOS overlap).
 *                   Falls back to fund-wide outcomes when no domain match exists.
 */
export type ProposerSideInput = {
  proposerAgentId: string;
  roundId: string;
  // The proposer's intent domains drive the prior-outcome filter:
  proposerIntentDomains: string[]; // e.g., ['trauma-care', 'church-planting']
};

export type ProposerSideSignals = ProposerSideInput & {
  basis: RankBasis;
  domainMatch: boolean; // true if outcomes are filtered by domain (vs fund-wide fallback)
};

export function proposerSideSignals(
  input: ProposerSideInput
): Promise<ProposerSideSignals>;

/**
 * Q2 — Steward side.
 * Surface incoming proposals on a round to a steward ranked by:
 *   proximityHops = hops(round.fundAgent → proposer)
 *   priorOutcomes = the proposer's prior fulfilled/abandoned ratio (Laplace-smoothed).
 */
export type StewardSideInput = {
  fundAgentId: string;
  proposerAgentId: string;
};

export type StewardSideSignals = StewardSideInput & {
  basis: RankBasis;
};

export function stewardSideSignals(
  input: StewardSideInput
): Promise<StewardSideSignals>;
