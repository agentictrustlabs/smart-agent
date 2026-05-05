/**
 * Spec 003 — Intent Marketplace (Proposal Lane). RoundClient (T027 / T033).
 *
 * Pass-through over `@smart-agent/discovery` for round reads. The contract
 * (`specs/003-intent-marketplace-proposal/contracts/round.ts`) defines the
 * `RoundClient` shape — this is the v1 implementation:
 *
 *   - Public-tier reads: GraphDB mirror via `DiscoveryService.listRounds()`
 *     and `DiscoveryService.getRoundDetail()`. Visibility / addressed-list
 *     gating happens inside the discovery service against the public
 *     mirror's `addressedApplicants` JSON literal.
 *
 *   - Private-tier federated reads (round bodies that live in the fund's
 *     org-mcp ONLY) are deferred to a future implementation pass. For
 *     v1 the SPARQL query already filters out private rounds the viewer
 *     isn't addressed to, so the MVP browse + detail surface works
 *     without the federated read.
 *
 * The client is constructed with a discovery instance so the sdk does
 * not have to know about env vars / fetching — that responsibility
 * stays with the action layer.
 */

import type {
  Round,
  RoundListFilters,
  RoundListItem,
} from './types'

/**
 * Minimal discovery surface the client consumes. Lets callers pass
 * either a real `DiscoveryService` from `@smart-agent/discovery` or a
 * mock for tests — the sdk doesn't import the concrete class.
 */
export interface RoundDiscoveryReader {
  listRounds(filters: RoundListFilters): Promise<RoundListItem[]>
  getRoundDetail(roundId: string, viewerAgentId: string): Promise<Round | null>
}

/**
 * Client interface from the spec contract — repeated here for sdk
 * consumers (so they don't have to import the spec file).
 */
export interface IRoundClient {
  list(filters: RoundListFilters): Promise<RoundListItem[]>
  getById(id: string, viewerAgentId: string): Promise<Round | null>
}

export class RoundClient implements IRoundClient {
  private discovery: RoundDiscoveryReader

  constructor(discovery: RoundDiscoveryReader) {
    this.discovery = discovery
  }

  /**
   * List rounds matching the supplied filters.
   *
   * The returned `RoundListItem[]` carries empty `matchedIntentIds` and
   * `warnings` arrays — the caller (action layer) computes the
   * mandate-match overlap because it has the viewer's intents handy.
   * See `apps/web/src/lib/actions/rounds.action.ts` (T032).
   */
  async list(filters: RoundListFilters): Promise<RoundListItem[]> {
    return this.discovery.listRounds(filters)
  }

  /**
   * Fetch a single round by id. Returns null for non-existent rounds
   * AND for private rounds the viewer is not addressed to (the action
   * layer renders a friendly "not authorized" page in either case;
   * since v1 does not differentiate the two, callers may inspect
   * `round.id` server-side via a separate path if they need to
   * distinguish 404 vs 403).
   */
  async getById(id: string, viewerAgentId: string): Promise<Round | null> {
    return this.discovery.getRoundDetail(id, viewerAgentId)
  }
}
