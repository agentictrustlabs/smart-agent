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
  stewardSideSignals,
  rank,
  type SubmitGrantProposalRequest,
  type SubmitGrantProposalResult,
  type EditGrantProposalRequest,
  type GrantProposal,
  type WithdrawGrantProposalResult,
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

// ───────────────────────────────────────────────────────────────────────
// Row parsing — MCP returns rows with JSON-string columns; the SDK contract
// types those columns as parsed objects. Normalize at the action boundary.
// ───────────────────────────────────────────────────────────────────────

interface RawProposalRow {
  id: string
  principal: string
  roundId: string | null
  fundMandateId: string | null
  basedOnIntentId: string
  budget: string | object
  plan: string | object
  milestones: string | unknown[]
  desiredOutcomes: string | unknown[]
  reportingObligations: string | object
  organisationalBackground: string | object
  submittedAt: string | null
  version: number
  lastEditedAt: string
  status: string
  withdrawnAt: string | null
  clonedFromProposalId: string | null
  basis: string | object | null
  visibility: string
  createdAt: string
}

function parseJsonField<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T } catch { return fallback }
  }
  return v as T
}

/** Convert an MCP row response into the typed GrantProposal shape. */
function rowToProposal(row: RawProposalRow): GrantProposal {
  return {
    id: row.id,
    proposerAgentId: row.principal,
    roundId: row.roundId,
    fundMandateId: row.fundMandateId,
    basedOnIntentId: row.basedOnIntentId,
    budget: parseJsonField<GrantProposal['budget']>(row.budget, { lineItems: [], total: 0 }),
    plan: parseJsonField<GrantProposal['plan']>(row.plan, { narrative: '' }),
    milestones: parseJsonField<GrantProposal['milestones']>(row.milestones, []),
    desiredOutcomes: parseJsonField<GrantProposal['desiredOutcomes']>(row.desiredOutcomes, []),
    reportingObligations: parseJsonField<GrantProposal['reportingObligations']>(row.reportingObligations, { cadence: 'none', format: 'written' }),
    organisationalBackground: parseJsonField<GrantProposal['organisationalBackground']>(row.organisationalBackground, { narrative: '' }),
    submittedAt: row.submittedAt,
    version: row.version,
    lastEditedAt: row.lastEditedAt,
    status: row.status as GrantProposal['status'],
    withdrawnAt: row.withdrawnAt ?? undefined,
    clonedFromProposalId: row.clonedFromProposalId ?? undefined,
    basis: parseJsonField<GrantProposal['basis']>(row.basis, {
      proximityHops: 6,
      proximityScore: 1 / 7,
      priorOutcomes: { fulfilled: 0, abandoned: 0 },
      outcomeScore: 0.5,
      composite: 0.6 * (1 / 7) + 0.4 * 0.5,
      isColdStart: true,
    }),
  }
}

// ───────────────────────────────────────────────────────────────────────
// US5 — manage actions (edit / withdraw / clone / listForMember / getById)
// ───────────────────────────────────────────────────────────────────────

export interface ListMemberProposalsResult {
  proposals: GrantProposal[]
}

/** List the viewer's own proposals across statuses. */
export async function listMemberProposals(): Promise<ListMemberProposalsResult> {
  const invoker = makeMcpInvoker('self')
  const client = new GrantProposalClient(invoker)
  let raws: GrantProposal[] = []
  try {
    raws = (await client.listForMember('')) as unknown as GrantProposal[]
  } catch {
    return { proposals: [] }
  }
  // Each row may still have stringified JSON fields — normalize.
  const proposals = (raws as unknown as RawProposalRow[]).map(rowToProposal)
  return { proposals }
}

/** Read one proposal by id (proposer-self). */
export async function getMemberProposal(proposalId: string): Promise<GrantProposal | null> {
  const invoker = makeMcpInvoker('self')
  const client = new GrantProposalClient(invoker)
  try {
    const raw = await client.getById(proposalId) as unknown as RawProposalRow | null
    return raw ? rowToProposal(raw) : null
  } catch {
    return null
  }
}

export interface EditProposalActionInput {
  proposalId: string
  patch: EditGrantProposalRequest['patch']
}

/** Edit a submitted proposal pre-deadline. */
export async function editMemberProposal(
  input: EditProposalActionInput,
): Promise<{ ok: true; proposal: GrantProposal } | { ok: false; error: string }> {
  const invoker = makeMcpInvoker('self')
  const client = new GrantProposalClient(invoker)
  try {
    const raw = await client.edit({ proposalId: input.proposalId, patch: input.patch }) as unknown as RawProposalRow
    return { ok: true, proposal: rowToProposal(raw) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Withdraw a draft / submitted proposal. */
export async function withdrawMemberProposal(
  proposalId: string,
): Promise<WithdrawGrantProposalResult & { ok: boolean; error?: string }> {
  const invoker = makeMcpInvoker('self')
  const client = new GrantProposalClient(invoker)
  try {
    const result = await client.withdraw(proposalId)
    return {
      ok: true,
      proposal: rowToProposal(result.proposal as unknown as RawProposalRow),
      intentRevertedToExpressed: result.intentRevertedToExpressed,
    }
  } catch (err) {
    return {
      ok: false,
      proposal: null as unknown as GrantProposal,
      intentRevertedToExpressed: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Clone a proposal as a fresh draft. */
export async function cloneMemberProposal(
  sourceProposalId: string,
): Promise<{ ok: true; proposal: GrantProposal } | { ok: false; error: string }> {
  const invoker = makeMcpInvoker('self')
  const client = new GrantProposalClient(invoker)
  try {
    const raw = await client.clone(sourceProposalId) as unknown as RawProposalRow
    return { ok: true, proposal: rowToProposal(raw) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ───────────────────────────────────────────────────────────────────────
// US4 (T051/T052) — steward-side federation
// ───────────────────────────────────────────────────────────────────────

export interface ListForRoundActionInput {
  roundId: string
  stewardAgentId: string
  fundAgentId: string
}

export interface RankedProposalForSteward {
  proposal: GrantProposal
  basis: GrantProposal['basis']
}

/**
 * Federate proposal reads across the round's submitting proposers, compute
 * stewardSideSignals per proposal, rank, and tie-break on submittedAt desc.
 *
 * v1 SIMPLIFICATION: same-DB read of all submissions for the round. The
 * production fan-out across each proposer's MCP using
 * `proposal:read_for_review` is left as a follow-up. // TODO(cross-mcp).
 */
export async function listProposalsForRoundSteward(
  input: ListForRoundActionInput,
): Promise<RankedProposalForSteward[]> {
  const invoker = makeMcpInvoker('fund')
  const client = new GrantProposalClient(invoker)
  let raws: RawProposalRow[] = []
  try {
    raws = (await client.listForRound(input.roundId, input.stewardAgentId)) as unknown as RawProposalRow[]
  } catch {
    return []
  }
  const proposals = raws.map(rowToProposal)
  if (proposals.length === 0) return []

  // Compute stewardSideSignals per proposal.
  const discovery = DiscoveryService.fromEnv()
  const sideDiscovery = discovery as unknown as SideSignalsDiscovery
  const enriched = await Promise.all(
    proposals.map(async (p) => {
      try {
        const signals = await stewardSideSignals(
          { fundAgentId: input.fundAgentId, proposerAgentId: p.proposerAgentId },
          sideDiscovery,
        )
        return { proposal: p, basis: signals.basis }
      } catch {
        return { proposal: p, basis: p.basis }
      }
    }),
  )

  // Rank — tie-break on submittedAt desc per FR-019.
  const rankInput = enriched.map(({ proposal, basis }) => ({
    item: { proposal, basis },
    signals: {
      proximityHops: basis.proximityHops,
      priorOutcomes: basis.priorOutcomes,
      recencyKey: proposal.submittedAt ?? proposal.lastEditedAt,
    },
  }))
  const ranked = rank(rankInput)
  return ranked.map((r) => ({
    proposal: r.item.proposal,
    basis: r.item.basis,
  }))
}
