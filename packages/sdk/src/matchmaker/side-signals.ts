/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Matchmaker side signals (T044).
 *
 * The ranking *formula* lives in `./ranking.ts`. This module computes the
 * per-side *signals* — proposer-side (Q1) and steward-side (Q2) — and
 * produces `RankBasis` snapshots ready to feed `rank()`.
 *
 * Proposer-side (Q1):
 *   proximityHops = hops(proposerAgent → round.fundAgent)         (sa:operatedByFund)
 *   priorOutcomes = fund's prior fulfilled/abandoned in the proposer's
 *                   intent domains; falls back to fund-wide outcomes when
 *                   no domain match exists (Research R6).
 *
 * Steward-side (Q2):
 *   proximityHops = hops(round.fundAgent → proposerAgent)
 *   priorOutcomes = proposerAgent's own prior fulfilled/abandoned ratio.
 *
 *   v1 stub — implementation deferred to US4 (T047).
 *
 * Discovery dependency is passed in via the `SideSignalsDiscovery` interface
 * to keep the SDK free of a hard `@smart-agent/discovery` runtime import on
 * the side-signals path; the action layer wires the concrete service.
 */

import { computeBasis } from './ranking'
import type { RankBasis } from './ranking'

// ───────────────────────────────────────────────────────────────────────
// Discovery dependency surface
// ───────────────────────────────────────────────────────────────────────

/**
 * The minimal discovery surface side-signals needs. Constructors accept
 * this interface so callers can inject either a real `DiscoveryService`
 * from `@smart-agent/discovery` or a mock for tests.
 */
export interface SideSignalsDiscovery {
  /** Hops between two agents in the AgentRelationship graph; null when unreachable. */
  getHopDistance(addressA: string, addressB: string): Promise<number | null>
  /** Round detail (used to look up the fund's agent ID for a given round). */
  getRoundDetail(
    roundId: string,
    viewerAgentId: string | null,
  ): Promise<{ fundAgentId: string; mandate?: { acceptedKinds?: string[] } } | null>
  /** Run a raw SPARQL query — used for prior-outcome lookups. */
  rawQuery(sparql: string): Promise<{
    results: { bindings: Array<Record<string, { value: string }>> }
  }>
}

// ───────────────────────────────────────────────────────────────────────
// Proposer-side signals (Q1)
// ───────────────────────────────────────────────────────────────────────

export interface ProposerSideInput {
  proposerAgentId: string
  roundId: string
  /** The proposer's intent domains driving the prior-outcome filter. */
  proposerIntentDomains: string[]
}

export type ProposerSideSignals = ProposerSideInput & {
  basis: RankBasis
  /** True when outcomes are filtered by domain (vs fund-wide fallback). */
  domainMatch: boolean
}

/**
 * Build a fund-prior-outcomes-by-domain SPARQL query inline. Mirrors
 * `packages/discovery/src/queries/priorStats.ts` `fundPriorOutcomesByDomainQuery`,
 * repeated here so this module doesn't take a runtime dep on `@smart-agent/discovery`.
 *
 * The actual query in v1 returns (0, 0) — no award triples in GraphDB until
 * the downstream review/award spec ships. The shape is stable.
 */
function buildFundDomainOutcomesSparql(fundAgentId: string, domains: string[]): string {
  const a = fundAgentId.toLowerCase()
  const domainFilter = domains.length === 0
    ? ''
    : `FILTER(?domain IN (${domains.map((d) => `"${d.replace(/"/g, '\\"')}"`).join(', ')}))`
  return `
PREFIX sa: <https://smart-agent.io/ontology#>
SELECT (COUNT(DISTINCT ?fulfilledAward) AS ?fulfilled)
       (COUNT(DISTINCT ?abandonedAward) AS ?abandoned)
WHERE {
  OPTIONAL {
    ?fulfilledAward a sa:AwardAssertion ;
                    sa:awardingFund ?fund ;
                    sa:awardOutcome "fulfilled" ;
                    sa:awardDomain ?domain .
    ?fund sa:onChainAddress ?fa .
    FILTER(LCASE(?fa) = "${a}")
    ${domainFilter}
  }
  OPTIONAL {
    ?abandonedAward a sa:AwardAssertion ;
                    sa:awardingFund ?fund2 ;
                    sa:awardOutcome "abandoned" ;
                    sa:awardDomain ?domain .
    ?fund2 sa:onChainAddress ?fa2 .
    FILTER(LCASE(?fa2) = "${a}")
    ${domainFilter}
  }
}`
}

function parseOutcomes(rows: Array<Record<string, { value: string }>>): {
  fulfilled: number
  abandoned: number
} {
  if (!rows[0]) return { fulfilled: 0, abandoned: 0 }
  const f = parseInt(rows[0].fulfilled?.value ?? '0', 10) || 0
  const a = parseInt(rows[0].abandoned?.value ?? '0', 10) || 0
  return { fulfilled: f, abandoned: a }
}

/**
 * Compute proposer-side signals. The returned `basis` is suitable for
 * persisting as the GrantProposal's `basis` snapshot at submit time.
 *
 * Falls back to fund-wide outcomes when domain-filtered query returns 0/0
 * (Research R6 — `domainMatch` reflects which path was taken).
 */
export async function proposerSideSignals(
  input: ProposerSideInput,
  discovery: SideSignalsDiscovery,
): Promise<ProposerSideSignals> {
  // 1. Look up round → fund agent.
  const round = await discovery.getRoundDetail(input.roundId, input.proposerAgentId)
  const fundAgentId = round?.fundAgentId ?? ''

  // 2. proximityHops.
  let proximityHops: number
  if (!fundAgentId) {
    proximityHops = 6 // unreachable — cap at depth budget.
  } else {
    const hops = await discovery.getHopDistance(input.proposerAgentId, fundAgentId)
    proximityHops = hops ?? 6
  }

  // 3. priorOutcomes — fund's domain-filtered first, then fund-wide fallback.
  let domainMatch = false
  let priorOutcomes = { fulfilled: 0, abandoned: 0 }
  if (fundAgentId) {
    if (input.proposerIntentDomains.length > 0) {
      try {
        const res = await discovery.rawQuery(
          buildFundDomainOutcomesSparql(fundAgentId, input.proposerIntentDomains),
        )
        const counts = parseOutcomes(res.results.bindings)
        if (counts.fulfilled + counts.abandoned > 0) {
          priorOutcomes = counts
          domainMatch = true
        }
      } catch {
        // Discovery unavailable → leave at 0/0 → cold-start fallback.
      }
    }
    if (!domainMatch) {
      try {
        const res = await discovery.rawQuery(
          buildFundDomainOutcomesSparql(fundAgentId, []),
        )
        const counts = parseOutcomes(res.results.bindings)
        priorOutcomes = counts
      } catch {
        /* ignored */
      }
    }
  }

  const basis = computeBasis({
    proximityHops,
    priorOutcomes,
  })

  return {
    ...input,
    basis,
    domainMatch,
  }
}

// ───────────────────────────────────────────────────────────────────────
// Steward-side signals (Q2)
// ───────────────────────────────────────────────────────────────────────

export interface StewardSideInput {
  fundAgentId: string
  proposerAgentId: string
}

export interface StewardSideSignals {
  fundAgentId: string
  proposerAgentId: string
  basis: RankBasis
}

/**
 * Build a proposer-prior-outcomes SPARQL query inline. Mirrors
 * `packages/discovery/src/queries/priorStats.ts` `proposerPriorOutcomesQuery`,
 * repeated here so the side-signals module doesn't take a runtime dep on
 * `@smart-agent/discovery`.
 *
 * In v1 there are no `sa:AwardAssertion` triples in GraphDB so this query
 * always returns (0, 0); the shape is stable. The basis falls into the
 * Laplace-smoothed cold-start (outcomeScore = 0.5).
 */
function buildProposerOutcomesSparql(proposerAgentId: string): string {
  const a = proposerAgentId.toLowerCase()
  return `
PREFIX sa: <https://smart-agent.io/ontology#>
SELECT (COUNT(DISTINCT ?fulfilledAward) AS ?fulfilled)
       (COUNT(DISTINCT ?abandonedAward) AS ?abandoned)
WHERE {
  OPTIONAL {
    ?fulfilledAward a sa:AwardAssertion ;
                    sa:awardedTo ?proposer ;
                    sa:awardOutcome "fulfilled" .
    ?proposer sa:onChainAddress ?pa .
    FILTER(LCASE(?pa) = "${a}")
  }
  OPTIONAL {
    ?abandonedAward a sa:AwardAssertion ;
                    sa:awardedTo ?proposer2 ;
                    sa:awardOutcome "abandoned" .
    ?proposer2 sa:onChainAddress ?pa2 .
    FILTER(LCASE(?pa2) = "${a}")
  }
}`
}

/**
 * Compute steward-side signals (Q2). Used when stewards triage incoming
 * proposals on a round:
 *   proximityHops = hops(fundAgent → proposerAgent)
 *   priorOutcomes = proposer's own (fulfilled, abandoned) ratio.
 *
 * Returns a `RankBasis` ready to feed `rank()`.
 */
export async function stewardSideSignals(
  input: StewardSideInput,
  discovery: SideSignalsDiscovery,
): Promise<StewardSideSignals> {
  // 1. proximityHops — fund → proposer.
  let proximityHops: number
  if (!input.fundAgentId || !input.proposerAgentId) {
    proximityHops = 6
  } else {
    const hops = await discovery.getHopDistance(input.fundAgentId, input.proposerAgentId)
    proximityHops = hops ?? 6
  }

  // 2. priorOutcomes — proposer's own historical fulfilled/abandoned counts.
  let priorOutcomes = { fulfilled: 0, abandoned: 0 }
  if (input.proposerAgentId) {
    try {
      const res = await discovery.rawQuery(
        buildProposerOutcomesSparql(input.proposerAgentId),
      )
      priorOutcomes = parseOutcomes(res.results.bindings)
    } catch {
      // Discovery unavailable → leave at 0/0 → cold-start fallback.
    }
  }

  const basis = computeBasis({
    proximityHops,
    priorOutcomes,
  })

  return {
    fundAgentId: input.fundAgentId,
    proposerAgentId: input.proposerAgentId,
    basis,
  }
}
