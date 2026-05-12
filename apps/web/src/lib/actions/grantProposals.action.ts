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
  /** Pool the proposal is targeting (must equal round.poolAgentId).
   *  Required for the AnonCreds expectedAttributes check at the org-mcp
   *  verifier. The action layer resolves it via DiscoveryService
   *  (round → pool); if you have it handy, pass it directly. */
  poolAgentId?: string
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

  // 2. Spec 004 (b2) — build the AnonCreds presentation + admin→holder→session
  //    delegation chain. These are required by the MCP tool; the SDK
  //    contract Omits them so we pass them via the same structural
  //    cast as `basis`.
  const { buildMarketplacePresentation } = await import('@/lib/spec004/presentation')
  const { resolveSpec004Chain } = await import('@/lib/spec004/chain')
  const grantProposalRegistry = process.env.GRANT_PROPOSAL_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!grantProposalRegistry) {
    return {
      success: false as const,
      error: { code: 'configuration' as const, message: 'GRANT_PROPOSAL_REGISTRY_ADDRESS not set' },
    } as unknown as SubmitGrantProposalResult
  }
  const expectedAttrs: Record<string, string> = input.poolAgentId ? { poolAgentId: input.poolAgentId } : {}
  let pres = await buildMarketplacePresentation({
    credentialType: 'ProposalSubmitterCredential',
    expectedAttributes: expectedAttrs,
  })

  // Any EOA-backed user (demo or stateless) acting as their own pool admin
  // has no ProposalSubmitterCredential pre-issued. Auto-self-issue using
  // the caller's OWN key (demo: users.privateKey; stateless: the
  // loadSignerForCurrentUser placeholder).
  if (!pres.ok && pres.error.includes('no held credential')) {
    const { getSession } = await import('@/lib/auth/session')
    const session = await getSession()
    const { loadSignerForCurrentUser } = await import('@/lib/ssi/signer')
    let signerCtx: Awaited<ReturnType<typeof loadSignerForCurrentUser>> | null = null
    try { signerCtx = await loadSignerForCurrentUser() } catch { /* not signed in */ }
    if (signerCtx?.kind === 'eoa' && signerCtx.userRow.privateKey && session?.smartAccountAddress && input.poolAgentId) {
      const { selfIssueMarketplaceCredential } = await import('@/lib/spec004/self-issue')
      const issued = await selfIssueMarketplaceCredential({
        smartAccount: session.smartAccountAddress as `0x${string}`,
        signerPrivateKey: signerCtx.userRow.privateKey as `0x${string}`,
        credentialType: 'ProposalSubmitterCredential',
        poolAgentId: input.poolAgentId,
        principal: signerCtx.principal,
      })
      if (issued.ok) {
        pres = await buildMarketplacePresentation({
          credentialType: 'ProposalSubmitterCredential',
          expectedAttributes: expectedAttrs,
        })
      } else {
        console.warn('[submitGrantProposal] self-issue failed:', issued.error)
      }
    }
  }
  if (!pres.ok) {
    return {
      success: false as const,
      error: { code: 'unauthorized' as const, message: `presentation: ${pres.error}` },
    } as unknown as SubmitGrantProposalResult
  }
  const { SPEC004_SELECTORS } = await import('@smart-agent/sdk')
  const chain = await resolveSpec004Chain({
    targetRegistry: grantProposalRegistry,
    credentialType: 'ProposalSubmitterCredential',
    methodSelectors: [SPEC004_SELECTORS.grantProposalSubmit],
  })
  if (!chain.ok) {
    return {
      success: false as const,
      error: { code: 'unauthorized' as const, message: `chain: ${chain.error} — ${chain.message}` },
    } as unknown as SubmitGrantProposalResult
  }

  // 3. Invoke the MCP submit tool. We fan-out the typed request plus the
  //    extra `basis`, `presentation`, and `chain` fields via a structural
  //    cast — the MCP tool's input schema accepts these even though the
  //    SDK contract Omits them.
  const target: McpTarget = input.proposerKind === 'person' ? 'intent' : 'self'
  const invoker = makeMcpInvoker(target)
  const client = new GrantProposalClient(invoker)
  const augmented = {
    ...input.request,
    ...(basis ? { basis } : {}),
    presentation: {
      presentationJson: pres.presentationJson,
      presentationRequest: pres.presentationRequest,
      poolAgentId: input.poolAgentId ?? '',
    },
    chain: chain.chain,
  } as unknown as SubmitGrantProposalRequest
  const result = await client.submit(augmented)

  // 3. Cross-MCP mirror to the fund's org-mcp tenant. The proposer's MCP
  //    holds the authoritative body (per IA P4 — the proposal's owner is
  //    the proposer); the fund's org-mcp gets a mirror so steward review
  //    queries (`listProposalsForRoundSteward`) see it without a federated
  //    read. Single-process dev: both MCPs are the same SQLite file, so
  //    this is just a second insert. Production: this becomes a
  //    cross-delegation federated copy.
  if (input.proposerKind === 'person') {
    try {
      const fundInvoker = makeMcpInvoker('fund')
      const fundClient = new GrantProposalClient(fundInvoker)
      await fundClient.submit(augmented)
    } catch (err) {
      // Mirror is best-effort: if it fails, the proposal still exists in
      // the proposer's MCP and the steward can recover via a manual
      // federated read. Don't block the user-facing submit on this.
      console.warn('[submitProposal] fund-mcp mirror failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  }
  return result
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
  displayName?: string
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
    displayName: row.displayName ?? '',
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

/**
 * Cheap count of submitted proposals for a round. Used by the round detail
 * page to render "View N proposals →" without paying the cost of fetching
 * every proposal body via `listProposalsForRoundSteward`. Returns 0 on
 * any failure so the page renders the empty-state link.
 */
export async function getRoundProposalCount(roundId: string): Promise<number> {
  try {
    const result = await callMcp<{ count: number }>(
      'org',
      'grant_proposal:count_for_round',
      { roundId },
    )
    return result.count ?? 0
  } catch (err) {
    console.warn('[getRoundProposalCount] failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

/**
 * Brief proposal entry for the inline round-detail listing. Carries only
 * what the surface needs (name + status + submission time) so we can
 * render the list without paying for the full body federation that
 * `listProposalsForRoundSteward` does. Anyone who can see the round can
 * see the list — full bodies remain gated by steward auth.
 */
export interface RoundProposalBrief {
  id: string
  displayName: string
  status: string
  submittedAt: string | null
  withdrawnAt: string | null
}

export async function listRoundProposalsBrief(roundId: string): Promise<RoundProposalBrief[]> {
  try {
    const result = await callMcp<{ proposals: Array<RawProposalRow> }>(
      'org',
      'grant_proposal:list_for_round',
      { roundId },
    )
    const rows = result.proposals ?? []
    return rows
      .filter((r) => r.status !== 'draft')
      .map((r) => ({
        id: r.id,
        displayName: r.displayName || 'Untitled proposal',
        status: r.status,
        submittedAt: r.submittedAt,
        withdrawnAt: r.withdrawnAt,
      }))
      .sort((a, b) => {
        const ax = a.submittedAt ? Date.parse(a.submittedAt) : 0
        const bx = b.submittedAt ? Date.parse(b.submittedAt) : 0
        return bx - ax
      })
  } catch (err) {
    console.warn('[listRoundProposalsBrief] failed:', err instanceof Error ? err.message : err)
    return []
  }
}

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
  /** URN form (urn:smart-agent:round:<slug>) or bare slug. The MCP tool
   *  computes the on-chain roundSubject + proposalSubject from this +
   *  the AnonCreds nullifier the holder re-derives at edit time. */
  roundId: string
  /** Pool the round belongs to — required for the AnonCreds
   *  expectedAttributes.poolAgentId match (action layer resolves via
   *  DiscoveryService.getRoundDetail; pass through if you have it). */
  poolAgentId: string
  patch: EditGrantProposalRequest['patch']
}

/** Edit a submitted proposal pre-deadline. */
export async function editMemberProposal(
  input: EditProposalActionInput,
): Promise<{ ok: true; proposalSubject: `0x${string}`; txHash: `0x${string}` } | { ok: false; error: string }> {
  const grantProposalRegistry = process.env.GRANT_PROPOSAL_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!grantProposalRegistry) {
    return { ok: false, error: 'GRANT_PROPOSAL_REGISTRY_ADDRESS not set' }
  }
  const { buildMarketplacePresentation } = await import('@/lib/spec004/presentation')
  const { resolveSpec004Chain } = await import('@/lib/spec004/chain')
  const pres = await buildMarketplacePresentation({
    credentialType: 'ProposalSubmitterCredential',
    expectedAttributes: { poolAgentId: input.poolAgentId },
  })
  if (!pres.ok) return { ok: false, error: `presentation: ${pres.error}` }
  const { SPEC004_SELECTORS } = await import('@smart-agent/sdk')
  const chain = await resolveSpec004Chain({
    targetRegistry: grantProposalRegistry,
    credentialType: 'ProposalSubmitterCredential',
    methodSelectors: [SPEC004_SELECTORS.grantProposalEdit],
  })
  if (!chain.ok) return { ok: false, error: `chain: ${chain.error} — ${chain.message}` }
  try {
    const result = await callMcp<{ ok: true; txHash: `0x${string}`; proposalSubject: `0x${string}` }>(
      'org',
      'grant_proposal:edit_pre_deadline',
      {
        roundId: input.roundId,
        patch: input.patch,
        presentation: {
          presentationJson: pres.presentationJson,
          presentationRequest: pres.presentationRequest,
          poolAgentId: input.poolAgentId,
        },
        chain: chain.chain,
      },
    )
    return { ok: true, proposalSubject: result.proposalSubject, txHash: result.txHash }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface WithdrawProposalActionInput {
  /** URN form or bare slug — same as edit. */
  roundId: string
  /** Pool the round belongs to (AnonCreds gate). */
  poolAgentId: string
}

/** Withdraw a submitted proposal. */
export async function withdrawMemberProposal(
  input: WithdrawProposalActionInput,
): Promise<{ ok: true; proposalSubject: `0x${string}`; txHash: `0x${string}` } | { ok: false; error: string }> {
  const grantProposalRegistry = process.env.GRANT_PROPOSAL_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!grantProposalRegistry) {
    return { ok: false, error: 'GRANT_PROPOSAL_REGISTRY_ADDRESS not set' }
  }
  const { buildMarketplacePresentation } = await import('@/lib/spec004/presentation')
  const { resolveSpec004Chain } = await import('@/lib/spec004/chain')
  const pres = await buildMarketplacePresentation({
    credentialType: 'ProposalSubmitterCredential',
    expectedAttributes: { poolAgentId: input.poolAgentId },
  })
  if (!pres.ok) return { ok: false, error: `presentation: ${pres.error}` }
  const { SPEC004_SELECTORS } = await import('@smart-agent/sdk')
  const chain = await resolveSpec004Chain({
    targetRegistry: grantProposalRegistry,
    credentialType: 'ProposalSubmitterCredential',
    methodSelectors: [SPEC004_SELECTORS.grantProposalWithdraw],
  })
  if (!chain.ok) return { ok: false, error: `chain: ${chain.error} — ${chain.message}` }
  try {
    const result = await callMcp<{ ok: true; txHash: `0x${string}`; proposalSubject: `0x${string}` }>(
      'org',
      'grant_proposal:withdraw',
      {
        roundId: input.roundId,
        presentation: {
          presentationJson: pres.presentationJson,
          presentationRequest: pres.presentationRequest,
          poolAgentId: input.poolAgentId,
        },
        chain: chain.chain,
      },
    )
    return { ok: true, proposalSubject: result.proposalSubject, txHash: result.txHash }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
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
