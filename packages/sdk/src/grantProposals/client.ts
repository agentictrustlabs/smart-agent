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

  /**
   * US5 (T053/T057) — pre-deadline edit. Routes through the proposer's MCP
   * `grant_proposal:edit_pre_deadline` tool. The MCP returns
   * `{ ok: true, proposal }` on success or
   * `{ ok: false, error: { kind: 'post-deadline', ... } }` past the deadline;
   * we surface the proposal on success and throw on the post-deadline error
   * (per the contract `edit(req): Promise<GrantProposal>` — throws otherwise).
   */
  async edit(req: EditGrantProposalRequest): Promise<GrantProposal> {
    const result = await this.mcp.call<
      | { ok: true; proposal: GrantProposal }
      | { ok: false; error: { kind: string; message?: string } }
    >('self', 'grant_proposal:edit_pre_deadline', {
      proposalId: req.proposalId,
      patch: req.patch,
    })
    if (!result.ok) {
      const msg = result.error.message ?? `edit refused: ${result.error.kind}`
      throw new Error(msg)
    }
    return result.proposal
  }

  /**
   * US5 (T054/T057) — withdraw. Routes through the proposer's MCP
   * `grant_proposal:withdraw` tool. Returns `{ proposal, intentRevertedToExpressed }`
   * (FR-023) — the intent revert flag drives the proposer-side message after
   * withdrawal.
   */
  async withdraw(proposalId: string): Promise<WithdrawGrantProposalResult> {
    return this.mcp.call<WithdrawGrantProposalResult>(
      'self',
      'grant_proposal:withdraw',
      { proposalId },
    )
  }

  /**
   * US5 (T055/T057) — clone. Routes through the proposer's MCP
   * `grant_proposal:clone` tool. Returns the new draft row.
   */
  async clone(sourceProposalId: string): Promise<GrantProposal> {
    const result = await this.mcp.call<{ proposal: GrantProposal }>(
      'self',
      'grant_proposal:clone',
      { sourceProposalId },
    )
    return result.proposal
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

  /**
   * US5 (T056/T057) — listForMember. Routes through the proposer's MCP
   * `grant_proposal:list_for_member` tool. Returns proposals across all
   * statuses sorted by lastEditedAt desc.
   */
  async listForMember(agentId: string): Promise<GrantProposal[]> {
    const result = await this.mcp.call<{ proposals: GrantProposal[] }>(
      'self',
      'grant_proposal:list_for_member',
      { agentId },
    )
    return result.proposals ?? []
  }

  /**
   * US4 (T052) — steward-side federation. Calls the (org-mcp) tool
   * `grant_proposal:list_for_round` (v1 same-DB shortcut). The federation
   * across proposer MCPs lives in the action layer; this typed entry point
   * mirrors the contract's interface. // TODO(cross-mcp): replace same-DB
   * read with a federated proposer-MCP fan-out using `proposal:read_for_review`.
   */
  async listForRound(roundId: string, _stewardAgentId: string): Promise<GrantProposal[]> {
    const result = await this.mcp.call<{ proposals: GrantProposal[] }>(
      'fund',
      'grant_proposal:list_for_round',
      { roundId },
    )
    return result.proposals ?? []
  }
}
