/**
 * Spec 003 — Intent Marketplace (Proposal Lane). GrantProposalClient (T042).
 *
 * Surfaces the typed contract from `specs/003-intent-marketplace-proposal/
 * contracts/grant-proposal.ts`. The actual MCP call (proposer's MCP
 * `grant_proposal:submit` tool) is invoked through an `McpInvoker`
 * callback supplied at construction — this keeps the SDK free of
 * fetch/HTTP plumbing and lets the action layer (apps/web) inject its
 * `callMcp(...)` helper.
 *
 * The same DI pattern is used by `RoundClient` (which takes a
 * `RoundDiscoveryReader`). For US3, the client surfaces `submit`; the
 * remaining methods (edit / withdraw / clone / getById / listForMember /
 * listForRound) are stubbed with TODOs to be filled by US4 + US5.
 */

import type {
  GrantProposal,
  SubmitGrantProposalRequest,
  SubmitGrantProposalResult,
  EditGrantProposalRequest,
  WithdrawGrantProposalResult,
} from './types'

/**
 * The minimal MCP-call surface this client needs. Callers wrap their
 * existing MCP invocation (e.g., apps/web's `callMcp(server, tool, args)`)
 * to fit this signature.
 *
 * The `target` parameter selects which MCP to talk to:
 *   - 'self'   — the caller's own MCP (proposer-owned operations:
 *                draft / submit / read_self).
 *   - 'fund'   — the fund's MCP (steward-side operations; not used in US3).
 *   - 'intent' — the basedOnIntent owner's MCP (system-delegation calls).
 */
export type McpTarget = 'self' | 'fund' | 'intent'

export interface McpInvoker {
  /**
   * Invoke a tool on the target MCP and return the parsed JSON body.
   * The caller is expected to thread auth (delegation token) into this
   * call — the SDK does not see the token.
   */
  call<T = unknown>(
    target: McpTarget,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<T>
}

/**
 * Client interface from the spec contract — repeated here so SDK consumers
 * don't import the spec file directly.
 */
export interface IGrantProposalClient {
  submit(req: SubmitGrantProposalRequest): Promise<SubmitGrantProposalResult>
  edit(req: EditGrantProposalRequest): Promise<GrantProposal>
  withdraw(proposalId: string): Promise<WithdrawGrantProposalResult>
  clone(sourceProposalId: string): Promise<GrantProposal>
  getById(id: string): Promise<GrantProposal | null>
  listForMember(agentId: string): Promise<GrantProposal[]>
  listForRound(roundId: string, stewardAgentId: string): Promise<GrantProposal[]>
}

/**
 * Implementation. Mostly a thin wrapper that maps the typed request shape
 * onto the MCP tool's `args` shape and surfaces the typed result.
 */
export class GrantProposalClient implements IGrantProposalClient {
  private mcp: McpInvoker

  constructor(mcp: McpInvoker) {
    this.mcp = mcp
  }

  /**
   * Submit a draft. Routes through the proposer's own MCP via the
   * `grant_proposal:submit` tool. Surfaces the typed
   * `SubmitGrantProposalResult` directly — the MCP tool returns the
   * same shape ({ ok, proposal } or { ok: false, error }).
   */
  async submit(req: SubmitGrantProposalRequest): Promise<SubmitGrantProposalResult> {
    const result = await this.mcp.call<SubmitGrantProposalResult & { proposal?: unknown }>(
      'self',
      'grant_proposal:submit',
      req as unknown as Record<string, unknown>,
    )
    return result
  }

  /** US5 — pre-deadline edit. Stub for now. */
  async edit(_req: EditGrantProposalRequest): Promise<GrantProposal> {
    // TODO US5
    throw new Error('GrantProposalClient.edit: not implemented (US5)')
  }

  /** US5 — withdraw. Stub for now. */
  async withdraw(_proposalId: string): Promise<WithdrawGrantProposalResult> {
    // TODO US5
    throw new Error('GrantProposalClient.withdraw: not implemented (US5)')
  }

  /** US5 — clone. Stub for now. */
  async clone(_sourceProposalId: string): Promise<GrantProposal> {
    // TODO US5
    throw new Error('GrantProposalClient.clone: not implemented (US5)')
  }

  /** US5 — getById; v1 routes through the proposer's MCP read_self. */
  async getById(id: string): Promise<GrantProposal | null> {
    const result = await this.mcp.call<{ proposals: GrantProposal[] }>(
      'self',
      'grant_proposal:read_self',
      {},
    )
    return result.proposals?.find((p) => p.id === id) ?? null
  }

  /** US5 — listForMember. */
  async listForMember(_agentId: string): Promise<GrantProposal[]> {
    const result = await this.mcp.call<{ proposals: GrantProposal[] }>(
      'self',
      'grant_proposal:read_self',
      {},
    )
    return result.proposals ?? []
  }

  /** US4 — steward-side federation. Stub for now. */
  async listForRound(_roundId: string, _stewardAgentId: string): Promise<GrantProposal[]> {
    // TODO US4
    throw new Error('GrantProposalClient.listForRound: not implemented (US4)')
  }
}
