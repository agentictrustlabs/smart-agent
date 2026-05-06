/**
 * Spec 001 — Intent Marketplace (Direct Lane). MatchInitiationClient.
 *
 * Mirrors the spec contract (`specs/001-intent-marketplace-discovery/
 * contracts/match-initiation.ts`). Routes writes through the initiator's
 * MCP via the `match_initiation:create` tool; reads through the MCP for
 * owner-private rows.
 *
 * The client is constructed with an `McpInvoker` (same DI pattern as
 * GrantProposalClient): callers wrap their existing `callMcp(...)` helper
 * to fit the interface, keeping the SDK free of fetch/HTTP plumbing.
 */

import type {
  MatchInitiation,
  MatchInitiationStatus,
  ProposeMatchRequest,
  ProposeMatchResult,
} from './types'
import type { McpInvoker, McpTarget } from '../grantProposals'

export interface IMatchInitiationClient {
  propose(req: ProposeMatchRequest): Promise<ProposeMatchResult>
  getById(id: string): Promise<MatchInitiation | null>
  /** All initiations the caller owns that reference the given intent on either side. */
  listForIntent(
    intentId: string,
    opts?: { status?: MatchInitiationStatus },
  ): Promise<MatchInitiation[]>
  /** All initiations owned by the caller (across all referenced intents). */
  listForMember(agentId: string): Promise<MatchInitiation[]>
}

export class MatchInitiationClient implements IMatchInitiationClient {
  private mcp: McpInvoker

  constructor(mcp: McpInvoker) {
    this.mcp = mcp
  }

  /**
   * Submit a proposal. Routes through the initiator's MCP via the
   * `match_initiation:create` tool. The MCP tool returns the typed
   * ProposeMatchResult shape directly; the client surfaces it verbatim.
   */
  async propose(req: ProposeMatchRequest): Promise<ProposeMatchResult> {
    return this.mcp.call<ProposeMatchResult>(
      'self',
      'match_initiation:create',
      req as unknown as Record<string, unknown>,
    )
  }

  /**
   * Read a MatchInitiation by id. v1 routes through the initiator's MCP
   * `match_initiation:read` tool (caller must own the row). Public-tier rows
   * could also be served via the discovery service's GraphDB mirror — that
   * path lives in the action layer, not here.
   */
  async getById(id: string): Promise<MatchInitiation | null> {
    const result = await this.mcp.call<{ initiations: MatchInitiation[] }>(
      'self',
      'match_initiation:read',
      {},
    )
    return result.initiations?.find((i) => i.id === id) ?? null
  }

  /**
   * List the caller's own initiations referencing `intentId`. Optional
   * status filter narrows to e.g. `'pending'` (FR-019 duplicate check).
   */
  async listForIntent(
    intentId: string,
    opts: { status?: MatchInitiationStatus } = {},
  ): Promise<MatchInitiation[]> {
    const result = await this.mcp.call<{ initiations: MatchInitiation[] }>(
      'self',
      'match_initiation:read',
      { intentId, ...(opts.status ? { status: opts.status } : {}) },
    )
    return result.initiations ?? []
  }

  /**
   * List all initiations owned by the caller. The `agentId` argument is a
   * documentation hint — the MCP tool reads from the caller's tenancy column,
   * which is already pinned by the auth token. Kept in the signature to
   * mirror the spec contract.
   */
  async listForMember(_agentId: string): Promise<MatchInitiation[]> {
    const result = await this.mcp.call<{ initiations: MatchInitiation[] }>(
      'self',
      'match_initiation:read',
      {},
    )
    return result.initiations ?? []
  }
}

export type { McpInvoker, McpTarget }
