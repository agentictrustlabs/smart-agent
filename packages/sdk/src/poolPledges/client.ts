/**
 * Spec 002 — Intent Marketplace (Pool Lane). PoolPledgeClient.
 *
 * Surfaces the typed contract from `specs/002-intent-marketplace-pool/contracts/
 * pool-pledge.ts`. The actual MCP call (donor's MCP `pool_pledge:*` tools) is
 * invoked through an `McpInvoker` callback supplied at construction — same
 * DI pattern as `GrantProposalClient`. Lets the action layer (apps/web) inject
 * its `callMcp(...)` helper without the SDK pulling in HTTP plumbing.
 */

import type { McpInvoker, McpTarget } from '../grantProposals/client'
import type {
  PoolPledge,
  SubmitPledgeRequest,
  SubmitPledgeResult,
  AmendPledgeRequest,
} from './types'

export interface IPoolPledgeClient {
  submit(req: SubmitPledgeRequest): Promise<SubmitPledgeResult>
  getById(id: string): Promise<PoolPledge | null>
  listForMember(agentId: string): Promise<PoolPledge[]>
  amend(req: AmendPledgeRequest): Promise<PoolPledge>
  stop(pledgeId: string): Promise<PoolPledge>
}

export class PoolPledgeClient implements IPoolPledgeClient {
  private mcp: McpInvoker
  /** Which McpTarget routes pledge-owner-side calls (defaults to 'self'). */
  private target: McpTarget

  constructor(mcp: McpInvoker, target: McpTarget = 'self') {
    this.mcp = mcp
    this.target = target
  }

  /**
   * Submit a pledge. Routes through donor's MCP via `pool_pledge:submit`.
   * The MCP returns `{ ok: true, pledge, status }` on success or
   * `{ ok: false, error }` with the typed error union on failure.
   */
  async submit(req: SubmitPledgeRequest): Promise<SubmitPledgeResult> {
    const result = await this.mcp.call<SubmitPledgeResult>(
      this.target,
      'pool_pledge:submit',
      req as unknown as Record<string, unknown>,
    )
    return result
  }

  /** Read one pledge by id (donor-self via read_self). */
  async getById(id: string): Promise<PoolPledge | null> {
    const result = await this.mcp.call<{ pledges: PoolPledge[] }>(
      this.target,
      'pool_pledge:read_self',
      {},
    )
    return result.pledges?.find(p => p.id === id) ?? null
  }

  /** List the donor's own pledges. */
  async listForMember(_agentId: string): Promise<PoolPledge[]> {
    const result = await this.mcp.call<{ pledges: PoolPledge[] }>(
      this.target,
      'pool_pledge:read_self',
      {},
    )
    return result.pledges ?? []
  }

  /**
   * Amend a recurring pledge. The MCP appends to history and mutates
   * top-level fields. Pool counters are derived at read time, so no
   * separate counter write is fired (post-Phase-7).
   * Returns the post-amendment row.
   */
  async amend(req: AmendPledgeRequest): Promise<PoolPledge> {
    const result = await this.mcp.call<
      | { ok: true; pledge: PoolPledge }
      | { ok: false; error: { kind: string; message?: string } }
    >(this.target, 'pool_pledge:amend', {
      pledgeId: req.pledgeId,
      change: req.change,
    })
    if (!result.ok) {
      const msg = 'message' in result.error
        ? result.error.message ?? `amend refused: ${result.error.kind}`
        : `amend refused: ${result.error.kind}`
      throw new Error(msg)
    }
    return result.pledge
  }

  /** Stop a recurring pledge. Sets stoppedAt + status='stopped'. */
  async stop(pledgeId: string): Promise<PoolPledge> {
    const result = await this.mcp.call<
      | { ok: true; pledge: PoolPledge }
      | { ok: false; error: { kind: string; message?: string } }
    >(this.target, 'pool_pledge:stop', { pledgeId })
    if (!result.ok) {
      const msg = 'message' in result.error
        ? result.error.message ?? `stop refused: ${result.error.kind}`
        : `stop refused: ${result.error.kind}`
      throw new Error(msg)
    }
    return result.pledge
  }
}
