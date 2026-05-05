// Contract: @smart-agent/sdk/matchInitiation
// Phase 1 design artifact for spec 001 — Intent Marketplace (Direct Lane).
// This is the EXPLICIT contract handed to the downstream commitment spec (per spec.md SC-005).
//
// Persistence model (per docs/information-architecture/10-intent-marketplace-classification.md § 2.1):
//   - Body lives in the INITIATOR'S MCP (person-mcp or org-mcp), in a new
//     `match_initiations` table; same shape as the existing `intents` table.
//   - On-chain anchor (sa:MatchInitiationAssertion) is minted only when the row's
//     `visibility` is `public` or `public-coarse` (the strictest of the two source
//     intents' visibilities). Coarse tier omits `basis`.
//   - GraphDB holds only the public mirror — populated by the on-chain → GraphDB sync.
//   - The MCP→GraphDB pipe is forbidden (IA P4); writes go MCP → optional on-chain mint.
//
// Class hierarchy & T-Box mapping (Audit § 3 + § 8.2):
//   sa:MatchInitiation (single class with sa:visibility predicate; not split into
//                       Public/Private subclasses — Audit § 2 O2)
//   sa:MatchInitiationAssertion (the on-chain anchor)
//   sa:initiator        (functional, owl:FunctionalProperty per Audit § 2 O10)
//   sa:viewedIntent     (functional)
//   sa:candidateIntent  (functional)
//   sa:initiationKind   (range sa:MatchInitiationKind C-Box scheme)
//   sa:status           (range sa:MatchInitiationStatus C-Box scheme)
//
// TS field → T-Box predicate mapping (TS keeps *AgentId / *Id JS conventions):
//   id                     → row IRI
//   viewedIntentId         → sa:viewedIntent
//   candidateIntentId      → sa:candidateIntent
//   initiatorAgentId       → sa:initiator
//   initiationKind         → sa:initiationKind
//   proposedAt             → sa:proposedAt
//   basis                  → sa:basis (xsd:string JSON literal)
//   status                 → sa:status
//   visibility             → sa:visibility (range sageo:Visibility)
//   onChainAssertionId     → sa:onChainAssertionId

import type { RankBasis } from "./matchmaker";

export type MatchInitiationKind = "self" | "connector";
export type MatchInitiationStatus = "pending" | "superseded" | "consumed";

/** Privacy tier; cascades from source intents. */
export type MatchInitiationVisibility =
  | "public"
  | "public-coarse"
  | "private"
  | "off-chain";

/**
 * The terminal artifact of spec 001. Body persisted in the initiator's MCP.
 * The shape is fixed by spec.md Clarification Q3 — fields below MUST match.
 */
export type MatchInitiation = {
  id: string; // IRI
  viewedIntentId: string; // IRI
  candidateIntentId: string; // IRI
  initiatorAgentId: string; // IRI; equals row's MCP `principal`
  initiationKind: MatchInitiationKind;
  proposedAt: string; // ISO-8601
  basis: RankBasis;
  status: MatchInitiationStatus;
  visibility: MatchInitiationVisibility; // derived as strictest of both source intents (cascade, IA § 3.1)
  onChainAssertionId?: string; // present iff anchored on-chain (i.e., visibility ∈ {public, public-coarse})
};

export type ProposeMatchRequest = {
  viewedIntentId: string;
  candidateIntentId: string;
  initiatorAgentId: string;
  /**
   * The basis snapshot as shown to the initiator. The matchmaker computed it; the route
   * persists it verbatim so the proposal's rationale is preserved even if the underlying
   * graph changes later. Coarse-tier anchors omit this on-chain (kept locally in MCP).
   */
  basis: RankBasis;
};

export type ProposeMatchError =
  | { kind: "stale-candidate"; reason: "withdrawn" | "fulfilled" | "abandoned" } // FR-021
  | { kind: "duplicate-pending"; existingInitiationId: string } // FR-019, Q5
  | { kind: "self-match-excluded" } // FR-008
  | { kind: "visibility-blocked"; reason: "private-non-credentialed" } // FR-020
  | { kind: "validation"; messages: string[] };

export type ProposeMatchResult =
  | { ok: true; initiation: MatchInitiation }
  | { ok: false; error: ProposeMatchError };

/**
 * Routes writes through the initiator's MCP (`match_initiation:create` tool); routes
 * reads through the MCP for owner-private rows or through `@smart-agent/discovery`'s
 * `listPublicMatchInitiationAssertions(...)` for the public mirror.
 *
 * Delegation scopes (added to the catalog by Security agent before tools land):
 *   - match_initiation:create       (write; owner's session OR explicit delegation)
 *   - match_initiation:read         (read self)
 *   - intent:bump_ack_count         (system-delegation; the initiator's MCP issues this
 *                                    to each of the two intent owners' MCPs to drive the
 *                                    liveAcknowledgementCount counter — IA § 3.10)
 *   - cross-principal "list initiations referencing my intent" is a *derived authority*
 *     from existing intent-read authority; no new scope.
 */
export interface MatchInitiationClient {
  propose(req: ProposeMatchRequest): Promise<ProposeMatchResult>;
  getById(id: string): Promise<MatchInitiation | null>;
  /** All initiations referencing the given intent on either side, optionally filtered by status. */
  listForIntent(
    intentId: string,
    opts?: { status?: MatchInitiationStatus }
  ): Promise<MatchInitiation[]>;
}
