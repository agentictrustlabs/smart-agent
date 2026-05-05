'use server'

/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Grant-proposal action layer.
 *
 * Server-only entry points used by the proposal composer + submit route
 * (T045 / T046). Wraps the proposer's MCP `grant_proposal:submit` tool
 * via the standard `callMcp(...)` plumbing in `apps/web/src/lib/clients/`.
 *
 * Mirrors the style of `rounds.action.ts`. Reads the round body via
 * DiscoveryService for submit-time validation context; the SDK's
 * proposerSideSignals helper computes the basis snapshot.
 */

import { DiscoveryService } from '@smart-agent/discovery'
import {
  GrantProposalClient,
  proposerSideSignals,
  type SubmitGrantProposalRequest,
  type SubmitGrantProposalResult,
  type McpInvoker,
  type McpTarget,
  type SideSignalsDiscovery,
} from '@smart-agent/sdk'
import { callMcp } from '@/lib/clients/mcp-client'

// ───────────────────────────────────────────────────────────────────────
// MCP invoker shim
// ───────────────────────────────────────────────────────────────────────

/**
 * Adapt apps/web's `callMcp(server, tool, args)` to the SDK's `McpInvoker`
 * interface. The 'self' target maps to the proposer's MCP — for org
 * proposers that's 'org', for solo human proposers 'person'. v1 routes
 * everything to 'org' (orgs are the common case; the Sign-in flow surfaces
 * an org context). // TODO: surface a person-mcp routing when the
 * caller's primary agent type is known to be person.
 */
function makeMcpInvoker(target: McpTarget): McpInvoker {
  return {
    async call<T = unknown>(
      _t: McpTarget,
      tool: string,
      args: Record<string, unknown>,
    ): Promise<T> {
      const server = target === 'self' ? 'org' : target === 'fund' ? 'org' : 'person'
      return callMcp<T>(server as 'org' | 'person', tool, args)
    },
  }
}

// ───────────────────────────────────────────────────────────────────────
// SubmitProposal action
// ───────────────────────────────────────────────────────────────────────

export interface SubmitProposalActionInput {
  request: SubmitGrantProposalRequest
  /**
   * The proposer's intent domains (used to drive prior-outcome filtering
   * in the basis snapshot). Pass the proposer's `expressed`/`acknowledged`
   * intents' kinds; an empty array falls back to fund-wide outcomes.
   */
  proposerIntentDomains?: string[]
  /** target agent type for the proposer's MCP. */
  proposerKind?: 'org' | 'person'
}

/**
 * Submit a proposal. Computes the proposer-side basis snapshot via
 * DiscoveryService, then invokes the proposer's MCP grant_proposal:submit
 * tool. Returns the typed `SubmitGrantProposalResult` shape — the route
 * handler turns errors into a redirect with a `?err=...` query string and
 * successes into a redirect to the new proposal page.
 */
export async function submitProposal(
  input: SubmitProposalActionInput,
): Promise<SubmitGrantProposalResult> {
  // 1. Compute the basis snapshot. Best-effort — when discovery is
  //    unavailable the basis falls back to a cold-start placeholder and
  //    the MCP tool stores it as-is. The basis is NOT part of the typed
  //    SubmitGrantProposalRequest (the contract Omits it — basis is
  //    server-computed at submit time) — we layer it on as an extra
  //    field that the MCP tool understands.
  let basis: unknown = undefined
  try {
    const discovery = DiscoveryService.fromEnv()
    if (input.request.roundId && input.request.proposerAgentId) {
      const signals = await proposerSideSignals(
        {
          proposerAgentId: input.request.proposerAgentId,
          roundId: input.request.roundId,
          proposerIntentDomains: input.proposerIntentDomains ?? [],
        },
        discovery as unknown as SideSignalsDiscovery,
      )
      basis = signals.basis
    }
  } catch {
    // Discovery unavailable — leave basis undefined; the MCP fills with
    // a placeholder.
  }

  // 2. Invoke the MCP submit tool. We fan-out the typed request plus the
  //    extra `basis` field via a structural cast — the MCP tool's input
  //    schema accepts `basis` even though the SDK contract Omits it.
  const target: McpTarget = input.proposerKind === 'person' ? 'intent' : 'self'
  const invoker = makeMcpInvoker(target)
  const client = new GrantProposalClient(invoker)
  const augmented = basis
    ? ({ ...input.request, basis } as unknown as SubmitGrantProposalRequest)
    : input.request
  return client.submit(augmented)
}
