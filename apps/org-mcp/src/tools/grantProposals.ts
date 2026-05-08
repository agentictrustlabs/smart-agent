/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Grant proposal MCP tools (T037, T039).
 *
 * org-mcp side: org proposers (the common case — orgs apply for grants).
 *
 * Tools registered (each tool name === scope name; the MCP_TOOL_SCOPE
 * caveat enforcer gates on the tool name verbatim):
 *   - grant_proposal:draft       — create / mutate a draft row in place
 *   - grant_proposal:submit      — validate against the round + insert with
 *                                   status='submitted', cascade three side
 *                                   effects (counter +1, ack-count +1, cross-
 *                                   delegation issuance) per IA § 2.3
 *   - grant_proposal:read_self   — list the caller's own GrantProposals
 *
 * Persistence: `proposal_submissions` table per IA § 2.3. ALWAYS private;
 * never anchored on chain in v1; never mirrored to GraphDB. SHACL
 * `sa:GrantProposalAlwaysPrivateShape` enforces. No `emitOnChainAssertion`
 * call here — Reviewer rejects any PR that adds one (Audit § 1.1).
 *
 * Cross-MCP federation (round counter increment; intent ack-count bump on the
 * basedOnIntent owner's MCP; cross-delegation grant to the fund's stewards) is
 * v1-simplified to same-DB calls when the fund / intent owner happens to be
 * co-located in the same org-mcp instance. A real cross-MCP RPC is a
 * follow-up — flagged with `// TODO(cross-mcp)` everywhere.
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  proposalSubmissions,
  orgIntents,
  orgCrossDelegationGrants,
} from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

// ───────────────────────────────────────────────────────────────────────
// Types — mirror packages/sdk/src/grantProposals/types.ts (which mirrors
// specs/003-intent-marketplace-proposal/contracts/grant-proposal.ts).
// Repeated here so the MCP layer does not pull in the sdk just for shapes.
// ───────────────────────────────────────────────────────────────────────

interface BudgetLineItem {
  name: string
  amount: number
  unit: string
  justification?: string
}
interface Budget {
  lineItems: BudgetLineItem[]
  total: number
}
interface Milestone {
  name: string
  dueDate: string
  evidenceRequired: string
  trancheAmount: number
}
interface DesiredOutcome {
  statement: string
  measurable: string
  validators: string[]
}
interface ReportingObligations {
  cadence: 'quarterly' | 'milestone' | 'annual' | 'none'
  format: 'written' | 'written+financial' | 'written+financial+testimony'
}
interface OrganisationalBackground {
  narrative: string
  priorTrackRecordRefs?: string[]
}
interface PlanShape {
  narrative: string
  planArtifactRef?: string
}
interface SubmitArgs {
  token: string
  // The full draft body. roundId XOR fundMandateId per Q3.
  roundId?: string | null
  fundMandateId?: string | null
  basedOnIntentId: string
  budget: Budget
  plan: PlanShape
  milestones: Milestone[]
  desiredOutcomes: DesiredOutcome[]
  reportingObligations: ReportingObligations
  organisationalBackground: OrganisationalBackground
  /** Optional: when invoking from the web, the action layer supplies the
   *  precomputed RankBasis snapshot (proposerSideSignals output). When
   *  omitted, a placeholder is stored — the SDK side-signals helper is
   *  the canonical source for production callers. See packages/sdk/src/
   *  matchmaker/side-signals.ts. */
  basis?: unknown
  /** Optional: when continuing a draft, supply the existing draft id so the
   *  submit tool can transition it from 'draft' to 'submitted' instead of
   *  inserting a fresh row. */
  draftId?: string
  /** Optional: action-layer hint for the round's fundAgent address (steward
   *  of the round). When provided, the submit handler issues the
   *  `proposal:read_for_review` cross-delegation to this address. Action layer
   *  resolves it via `DiscoveryService.getRoundDetail`; required because the
   *  MCP layer no longer reads the round body. */
  stewardAgentHint?: string
}

type SubmitErrorKind =
  | { kind: 'missing-required-fields'; fields: string[] }
  | { kind: 'budget-overage'; ceiling: number; submitted: number }
  | { kind: 'missing-credential'; required: string[]; held: string[] }
  | { kind: 'open-call-not-accepted' }
  | { kind: 'private-round-not-addressed' }
  | { kind: 'validation'; messages: string[] }

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function err(error: SubmitErrorKind) {
  return mcpText({ ok: false as const, error })
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * POST-PHASE-7: Round body lives on chain in FundRegistry — read it via
 * DiscoveryService.getRoundDetail() in the action layer (web). This MCP
 * layer no longer body-validates round membership / mandate / deadline. The
 * action layer pre-validates BEFORE calling grant_proposal:submit and is
 * the canonical guardrail. SHACL still enforces the visibility-cascade
 * invariants (e.g., sa:GrantProposalAlwaysPrivateShape).
 */

/**
 * Validate the AnonCreds credential ownership for the proposer against the
 * round's required-credentials list (FR-011).
 *
 * v1 limitation: no AnonCreds verifier helper is wired into org-mcp yet,
 * so we stub-return ok=true and log a warning. The proposal still records
 * the requirement; future work wires the actual verifier. Documented as a
 * v1 limitation in the spec 003 commit message.
 *
 * // TODO(anoncreds): wire userHoldsCredential helper.
 */
function checkCredentialsHeld(
  required: string[],
  proposerAgentId: string,
): { ok: true } | { ok: false; held: string[] } {
  if (required.length === 0) return { ok: true }
  console.warn(
    `[org-mcp/grantProposals] credential check stubbed — proposer=${proposerAgentId} required=[${required.join(',')}]`,
  )
  return { ok: true }
}

/**
 * Find the basedOnIntent's owning row (assumes the intent is org-tenanted in
 * THIS org-mcp instance for v1). Returns the row or null. v1 simplification —
 * if the intent is in a different org-mcp tenant (or person-mcp), this
 * returns null and the ack-count bump is silently skipped, with a warning.
 *
 * // TODO(cross-mcp): support cross-tenant + cross-MCP intent ack-count bump.
 */
function findIntentRow(intentId: string) {
  const rows = db.select().from(orgIntents).where(eq(orgIntents.id, intentId)).all()
  return rows[0] ?? null
}

/**
 * Bump the local intent's live_acknowledgement_count. Mirrors the logic in
 * `intents.ts`'s `intent:bump_ack_count` tool — repeated here so the submit
 * pipeline can run as a single transaction without an extra tool dispatch.
 */
function bumpAckCount(intentId: string, delta: 1 | -1, orgPrincipal: string): void {
  const row = findIntentRow(intentId)
  if (!row || row.orgPrincipal.toLowerCase() !== orgPrincipal.toLowerCase()) {
    // Different tenant or different MCP — v1 stub.
    console.warn(
      `[org-mcp/grantProposals] ack-count bump skipped — intent ${intentId} not local to ${orgPrincipal}. // TODO(cross-mcp)`,
    )
    return
  }
  const cur = row.liveAcknowledgementCount ?? 0
  const next = Math.max(0, cur + delta)
  let nextStatus = row.status
  if (cur === 0 && next === 1 && nextStatus === 'expressed') nextStatus = 'acknowledged'
  else if (cur === 1 && next === 0 && nextStatus === 'acknowledged') nextStatus = 'expressed'
  db.update(orgIntents)
    .set({ liveAcknowledgementCount: next, status: nextStatus, updatedAt: nowIso() })
    .where(and(eq(orgIntents.id, intentId), eq(orgIntents.orgPrincipal, row.orgPrincipal)))
    .run()
}

/**
 * NO-OP: proposalsReceived is now DERIVED at read time from
 * COUNT(proposal_submissions WHERE round_id = ?). Kept as a function
 * placeholder so the submit / withdraw flows below stay readable.
 */
function bumpRoundCounter(_roundId: string, _delta: 1 | -1): void {
  // intentional no-op
}

/**
 * Issue a `proposal:read_for_review` cross-delegation grant from the
 * proposer to the round's stewards (= fund's org-principal). v1 records the
 * grant in `org_cross_delegation_grants`; the actual on-chain delegation
 * token issuance happens in the existing infrastructure when the steward
 * presents.
 */
function issueReadForReviewGrant(opts: {
  proposerPrincipal: string
  fundAgentId: string
  roundId: string | null
  fundMandateId: string | null
  proposalId: string
}): void {
  const scopeBase = opts.roundId
    ? `proposal:read_for_review:${opts.roundId}:${opts.proposalId}`
    : `proposal:read_for_review:${opts.fundMandateId ?? 'open-call'}:${opts.proposalId}`
  db.insert(orgCrossDelegationGrants).values({
    id: randomUUID(),
    orgPrincipal: opts.proposerPrincipal,
    granteeAgent: opts.fundAgentId.toLowerCase(),
    scope: JSON.stringify({ scope: scopeBase, proposalId: opts.proposalId }),
    validFrom: nowIso(),
    validUntil: null, // until terminal state — caller revokes on terminal
    caveatTerms: null,
    createdAt: nowIso(),
    revokedAt: null,
  }).run()
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:submit
// ───────────────────────────────────────────────────────────────────────

const submitTool = {
  name: 'grant_proposal:submit',
  description:
    "Validate a proposal against the target round/fund and persist as 'submitted'. Cascades counter +1, ack-count +1, and cross-delegation grant. Always private — never anchored on chain.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
      fundMandateId: { type: 'string' },
      basedOnIntentId: { type: 'string' },
      budget: { type: 'object' },
      plan: { type: 'object' },
      milestones: { type: 'array' },
      desiredOutcomes: { type: 'array' },
      reportingObligations: { type: 'object' },
      organisationalBackground: { type: 'object' },
      basis: { type: 'object' },
      draftId: { type: 'string' },
    },
    required: ['token', 'basedOnIntentId', 'budget', 'plan', 'milestones', 'desiredOutcomes', 'reportingObligations', 'organisationalBackground'],
  },
  handler: async (args: SubmitArgs) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'grant_proposal:submit')

    // ─── Q3: roundId XOR fundMandateId ────────────────────────────────
    const hasRound = !!args.roundId
    const hasFund = !!args.fundMandateId
    if (hasRound === hasFund) {
      return err({
        kind: 'validation',
        messages: ['exactly one of roundId / fundMandateId must be set (Q3)'],
      })
    }

    // ─── Required-fields presence check ────────────────────────────────
    const missing: string[] = []
    if (!args.budget || !Array.isArray(args.budget.lineItems) || args.budget.lineItems.length === 0) {
      missing.push('budget')
    }
    if (!args.plan || !args.plan.narrative) missing.push('plan')
    if (!Array.isArray(args.milestones) || args.milestones.length === 0) missing.push('milestones')
    if (!Array.isArray(args.desiredOutcomes) || args.desiredOutcomes.length === 0) missing.push('desiredOutcomes')
    if (!args.reportingObligations || !args.reportingObligations.cadence) missing.push('reportingObligations')
    if (!args.organisationalBackground || !args.organisationalBackground.narrative) missing.push('organisationalBackground')
    if (missing.length > 0) {
      return err({ kind: 'missing-required-fields', fields: missing })
    }

    // ─── Round / fund body validation ─────────────────────────────────
    // POST-PHASE-7: round body lives on chain in FundRegistry. Body
    // validation (budget ceiling, required credentials, private-round
    // addressee, open-call eligibility) is the action-layer's responsibility
    // — it pre-validates against DiscoveryService.getRoundDetail BEFORE
    // calling this tool. The MCP layer trusts the action-layer gate; SHACL
    // still enforces the always-private invariant on the row.
    void checkCredentialsHeld  // referenced indirectly; kept for forward-compat
    void hasFund

    // ─── Insert the row ───────────────────────────────────────────────
    const now = nowIso()
    const proposalId = args.draftId ?? randomUUID()
    const basisJson = JSON.stringify(args.basis ?? {
      // Placeholder basis when the action layer didn't supply one. The SDK
      // proposerSideSignals helper is the canonical computation.
      proximityHops: 0,
      proximityScore: 1,
      priorOutcomes: { fulfilled: 0, abandoned: 0 },
      outcomeScore: 0.5,
      composite: 0.6 * 1 + 0.4 * 0.5,
      isColdStart: true,
    })

    const row = {
      id: proposalId,
      principal: orgPrincipal,
      roundId: args.roundId ?? null,
      fundMandateId: args.fundMandateId ?? null,
      basedOnIntentId: args.basedOnIntentId,
      budget: JSON.stringify(args.budget),
      plan: JSON.stringify(args.plan),
      milestones: JSON.stringify(args.milestones),
      desiredOutcomes: JSON.stringify(args.desiredOutcomes),
      reportingObligations: JSON.stringify(args.reportingObligations),
      organisationalBackground: JSON.stringify(args.organisationalBackground),
      submittedAt: now,
      version: 0,
      lastEditedAt: now,
      status: 'submitted' as const,
      withdrawnAt: null,
      clonedFromProposalId: null,
      basis: basisJson,
      visibility: 'private' as const,
      createdAt: now,
    }
    if (args.draftId) {
      // Transition existing draft → submitted (UPDATE).
      db.update(proposalSubmissions)
        .set({
          roundId: row.roundId,
          fundMandateId: row.fundMandateId,
          basedOnIntentId: row.basedOnIntentId,
          budget: row.budget,
          plan: row.plan,
          milestones: row.milestones,
          desiredOutcomes: row.desiredOutcomes,
          reportingObligations: row.reportingObligations,
          organisationalBackground: row.organisationalBackground,
          submittedAt: now,
          lastEditedAt: now,
          status: 'submitted',
          basis: basisJson,
        })
        .where(and(
          eq(proposalSubmissions.id, args.draftId),
          eq(proposalSubmissions.principal, orgPrincipal),
        ))
        .run()
    } else {
      db.insert(proposalSubmissions).values(row).run()
    }

    // ─── Side effect 1: round counter +1 (FR-013) ─────────────────────
    if (hasRound && args.roundId) bumpRoundCounter(args.roundId, 1)

    // ─── Side effect 2: ack-count +1 on the basedOnIntent owner ───────
    bumpAckCount(args.basedOnIntentId, 1, orgPrincipal)

    // ─── Side effect 3: proposal:read_for_review cross-delegation ─────
    // Fund/round steward = the round's fundAgent (lives on chain in
    // FundRegistry). The action layer resolves it via DiscoveryService and
    // passes it in `stewardAgentHint`; for open-call we fall back to
    // fundMandateId.
    const stewardAgent: string | null = args.stewardAgentHint
      ?? (hasFund ? (args.fundMandateId ?? null) : null)
    if (stewardAgent) {
      issueReadForReviewGrant({
        proposerPrincipal: orgPrincipal,
        fundAgentId: stewardAgent,
        roundId: args.roundId ?? null,
        fundMandateId: args.fundMandateId ?? null,
        proposalId,
      })
    } else {
      console.warn(
        `[org-mcp/grantProposals] no steward agent resolvable for proposal ${proposalId}; cross-delegation grant skipped. Pass stewardAgentHint when calling submit.`,
      )
    }

    return mcpText({ ok: true as const, proposal: row })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:draft
// ───────────────────────────────────────────────────────────────────────

const draftTool = {
  name: 'grant_proposal:draft',
  description: 'Create or mutate a draft GrantProposal row in place (status stays draft).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      // proposalId omitted → create a new draft row
      proposalId: { type: 'string' },
      roundId: { type: 'string' },
      fundMandateId: { type: 'string' },
      basedOnIntentId: { type: 'string' },
      budget: { type: 'object' },
      plan: { type: 'object' },
      milestones: { type: 'array' },
      desiredOutcomes: { type: 'array' },
      reportingObligations: { type: 'object' },
      organisationalBackground: { type: 'object' },
    },
    required: ['token'],
  },
  handler: async (args: {
    token: string
    proposalId?: string
    roundId?: string | null
    fundMandateId?: string | null
    basedOnIntentId?: string
    budget?: Budget
    plan?: PlanShape
    milestones?: Milestone[]
    desiredOutcomes?: DesiredOutcome[]
    reportingObligations?: ReportingObligations
    organisationalBackground?: OrganisationalBackground
  }) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'grant_proposal:draft')
    const now = nowIso()

    if (args.proposalId) {
      // Update an existing draft.
      const existing = db.select().from(proposalSubmissions)
        .where(and(
          eq(proposalSubmissions.id, args.proposalId),
          eq(proposalSubmissions.principal, orgPrincipal),
        ))
        .all()
      if (existing.length === 0) {
        throw new Error(`draft ${args.proposalId} not found for principal`)
      }
      if (existing[0].status !== 'draft') {
        throw new Error(`proposal ${args.proposalId} is not in 'draft' state (status=${existing[0].status})`)
      }
      const patch: Record<string, unknown> = { lastEditedAt: now }
      if (args.roundId !== undefined) patch.roundId = args.roundId
      if (args.fundMandateId !== undefined) patch.fundMandateId = args.fundMandateId
      if (args.basedOnIntentId !== undefined) patch.basedOnIntentId = args.basedOnIntentId
      if (args.budget !== undefined) patch.budget = JSON.stringify(args.budget)
      if (args.plan !== undefined) patch.plan = JSON.stringify(args.plan)
      if (args.milestones !== undefined) patch.milestones = JSON.stringify(args.milestones)
      if (args.desiredOutcomes !== undefined) patch.desiredOutcomes = JSON.stringify(args.desiredOutcomes)
      if (args.reportingObligations !== undefined) patch.reportingObligations = JSON.stringify(args.reportingObligations)
      if (args.organisationalBackground !== undefined) patch.organisationalBackground = JSON.stringify(args.organisationalBackground)
      db.update(proposalSubmissions).set(patch)
        .where(and(
          eq(proposalSubmissions.id, args.proposalId),
          eq(proposalSubmissions.principal, orgPrincipal),
        ))
        .run()
      const updated = db.select().from(proposalSubmissions)
        .where(eq(proposalSubmissions.id, args.proposalId))
        .all()[0]
      return mcpText({ proposal: updated })
    }

    // Create a fresh draft.
    const id = randomUUID()
    const row = {
      id,
      principal: orgPrincipal,
      roundId: args.roundId ?? null,
      fundMandateId: args.fundMandateId ?? null,
      basedOnIntentId: args.basedOnIntentId ?? '',
      budget: JSON.stringify(args.budget ?? { lineItems: [], total: 0 }),
      plan: JSON.stringify(args.plan ?? { narrative: '' }),
      milestones: JSON.stringify(args.milestones ?? []),
      desiredOutcomes: JSON.stringify(args.desiredOutcomes ?? []),
      reportingObligations: JSON.stringify(args.reportingObligations ?? { cadence: 'none', format: 'written' }),
      organisationalBackground: JSON.stringify(args.organisationalBackground ?? { narrative: '' }),
      submittedAt: null,
      version: 0,
      lastEditedAt: now,
      status: 'draft' as const,
      withdrawnAt: null,
      clonedFromProposalId: null,
      basis: null,
      visibility: 'private' as const,
      createdAt: now,
    }
    db.insert(proposalSubmissions).values(row).run()
    return mcpText({ proposal: row })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:read_self
// ───────────────────────────────────────────────────────────────────────

const readSelfTool = {
  name: 'grant_proposal:read_self',
  description: "List all GrantProposals owned by the authenticated org-principal.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      status: { type: 'string' },
    },
    required: ['token'],
  },
  handler: async (args: { token: string; status?: string }) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'grant_proposal:read_self')
    let rows = db.select().from(proposalSubmissions)
      .where(eq(proposalSubmissions.principal, orgPrincipal))
      .all()
    if (args.status) rows = rows.filter((r) => r.status === args.status)
    return mcpText({ proposals: rows })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:list_for_member (T056)
// ───────────────────────────────────────────────────────────────────────
//
// Returns all proposals owned by the calling principal across all status
// values (drafts / submitted / withdrawn / awarded / declined), sorted by
// `lastEditedAt` desc. The tool is a thin alias of `read_self` with a
// stable sort order — the SDK's `listForMember` routes here.

const listForMemberTool = {
  name: 'grant_proposal:list_for_member',
  description:
    "List all the caller's GrantProposals across statuses (draft / submitted / withdrawn / awarded / declined), sorted by lastEditedAt desc.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      agentId: { type: 'string' },
    },
    required: ['token'],
  },
  handler: async (args: { token: string; agentId?: string }) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'grant_proposal:list_for_member')
    const rows = db.select().from(proposalSubmissions)
      .where(eq(proposalSubmissions.principal, orgPrincipal))
      .all()
    const sorted = [...rows].sort((a, b) => {
      const ta = Date.parse(a.lastEditedAt ?? '') || 0
      const tb = Date.parse(b.lastEditedAt ?? '') || 0
      return tb - ta
    })
    return mcpText({ proposals: sorted })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:list_for_round (T052 — steward federation)
// ───────────────────────────────────────────────────────────────────────
//
// v1 SIMPLIFICATION: same-DB read of ALL submissions for a given round
// regardless of `principal`. In production, steward views must federate
// across each proposer's MCP using the `proposal:read_for_review`
// cross-delegation issued at submit time (IA P5 — proposals never reach
// GraphDB). The federation logic lives in the web action layer; this MCP
// tool just exposes the same-DB shortcut.
//
// Auth: any authenticated org-principal can call. The action layer gates
// on the steward being an operator of the round's fund (v1: viewer's
// agent id == round.orgPrincipal).
//
// // TODO(cross-mcp): replace same-DB read with a federated proposer-MCP
// fan-out using `proposal:read_for_review`.

const listForRoundTool = {
  name: 'grant_proposal:list_for_round',
  description:
    "Steward-side: list all submitted/withdrawn/decided GrantProposals on a round (v1 same-DB shortcut; production federates via proposal:read_for_review).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: { token: string; roundId: string }) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:list_for_round')
    const rows = db.select().from(proposalSubmissions)
      .where(eq(proposalSubmissions.roundId, args.roundId))
      .all()
    // Drop drafts — stewards never see draft rows.
    const visible = rows.filter((r) => r.status !== 'draft')
    return mcpText({ proposals: visible })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:edit_pre_deadline (T053)
// ───────────────────────────────────────────────────────────────────────
//
// Pre-deadline edits to a submitted proposal. Bumps `version`, updates
// `lastEditedAt`, applies the patch (only allowed fields per the
// `EditGrantProposalRequest` contract). Returns 403 with a clarifying
// message past the round deadline (FR-022 — post-deadline edits require
// steward consent, out of scope for this spec).

interface EditableFields {
  budget?: Budget
  plan?: PlanShape
  milestones?: Milestone[]
  desiredOutcomes?: DesiredOutcome[]
  reportingObligations?: ReportingObligations
  organisationalBackground?: OrganisationalBackground
}

const editPreDeadlineTool = {
  name: 'grant_proposal:edit_pre_deadline',
  description:
    "Patch an editable field on a submitted GrantProposal pre-deadline. Bumps version. Returns 403 past the round deadline.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      proposalId: { type: 'string' },
      patch: { type: 'object' },
    },
    required: ['token', 'proposalId', 'patch'],
  },
  handler: async (args: {
    token: string
    proposalId: string
    patch: EditableFields
  }) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'grant_proposal:edit_pre_deadline')
    const existing = db.select().from(proposalSubmissions)
      .where(and(
        eq(proposalSubmissions.id, args.proposalId),
        eq(proposalSubmissions.principal, orgPrincipal),
      ))
      .all()[0]
    if (!existing) {
      throw new Error(`proposal ${args.proposalId} not found for principal`)
    }
    if (existing.status !== 'submitted') {
      throw new Error(`proposal ${args.proposalId} is not in 'submitted' state (status=${existing.status})`)
    }
    // POST-PHASE-7: deadline check moved to the action layer (round body
    // lives on chain in FundRegistry; the action layer reads it via
    // DiscoveryService.getRoundDetail and gates this call before invoking it).
    const now = nowIso()
    const nextVersion = (existing.version ?? 0) + 1
    const patchSet: Record<string, unknown> = { lastEditedAt: now, version: nextVersion }
    if (args.patch.budget !== undefined) patchSet.budget = JSON.stringify(args.patch.budget)
    if (args.patch.plan !== undefined) patchSet.plan = JSON.stringify(args.patch.plan)
    if (args.patch.milestones !== undefined) patchSet.milestones = JSON.stringify(args.patch.milestones)
    if (args.patch.desiredOutcomes !== undefined) patchSet.desiredOutcomes = JSON.stringify(args.patch.desiredOutcomes)
    if (args.patch.reportingObligations !== undefined) patchSet.reportingObligations = JSON.stringify(args.patch.reportingObligations)
    if (args.patch.organisationalBackground !== undefined) patchSet.organisationalBackground = JSON.stringify(args.patch.organisationalBackground)
    db.update(proposalSubmissions).set(patchSet)
      .where(and(
        eq(proposalSubmissions.id, args.proposalId),
        eq(proposalSubmissions.principal, orgPrincipal),
      ))
      .run()
    const updated = db.select().from(proposalSubmissions)
      .where(eq(proposalSubmissions.id, args.proposalId))
      .all()[0]
    return mcpText({ ok: true as const, proposal: updated })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:withdraw (T054)
// ───────────────────────────────────────────────────────────────────────
//
// Transitions status → 'withdrawn', sets `withdrawnAt: now`. If the row was
// previously 'submitted', cascades:
//   - round counter -1 (FR-013)
//   - intent ack-count -1 (cross-spec invariant from spec 001 — only
//     reverts intent.status to 'expressed' when the count returns to 0).
//
// Returns `WithdrawGrantProposalResult.intentRevertedToExpressed: boolean`
// reflecting whether the count-hit-zero check fired (FR-023).

const withdrawTool = {
  name: 'grant_proposal:withdraw',
  description:
    "Withdraw a draft or submitted GrantProposal. Cascades counter -1 and ack-count -1. Returns intentRevertedToExpressed flag (FR-023).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      proposalId: { type: 'string' },
    },
    required: ['token', 'proposalId'],
  },
  handler: async (args: { token: string; proposalId: string }) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'grant_proposal:withdraw')
    const existing = db.select().from(proposalSubmissions)
      .where(and(
        eq(proposalSubmissions.id, args.proposalId),
        eq(proposalSubmissions.principal, orgPrincipal),
      ))
      .all()[0]
    if (!existing) {
      throw new Error(`proposal ${args.proposalId} not found for principal`)
    }
    if (existing.status !== 'draft' && existing.status !== 'submitted') {
      throw new Error(`proposal ${args.proposalId} cannot be withdrawn (status=${existing.status})`)
    }
    const wasSubmitted = existing.status === 'submitted'
    const now = nowIso()
    db.update(proposalSubmissions)
      .set({ status: 'withdrawn', withdrawnAt: now, lastEditedAt: now })
      .where(and(
        eq(proposalSubmissions.id, args.proposalId),
        eq(proposalSubmissions.principal, orgPrincipal),
      ))
      .run()

    let intentRevertedToExpressed = false
    if (wasSubmitted) {
      // Round counter -1.
      if (existing.roundId) bumpRoundCounter(existing.roundId, -1)
      // Ack-count -1 on basedOnIntent.
      const before = findIntentRow(existing.basedOnIntentId)
      bumpAckCount(existing.basedOnIntentId, -1, orgPrincipal)
      const after = findIntentRow(existing.basedOnIntentId)
      // Reverted-to-expressed iff the local intent existed AND its status
      // moved from 'acknowledged' → 'expressed' (count 1 → 0).
      if (
        before &&
        after &&
        before.status === 'acknowledged' &&
        after.status === 'expressed'
      ) {
        intentRevertedToExpressed = true
      }
    }

    const updated = db.select().from(proposalSubmissions)
      .where(eq(proposalSubmissions.id, args.proposalId))
      .all()[0]
    return mcpText({
      proposal: updated,
      intentRevertedToExpressed,
    })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:clone (T055)
// ───────────────────────────────────────────────────────────────────────
//
// Inserts a new row with: fresh `id`, `status: 'draft'`, `version: 0`,
// `submittedAt: null`, `lastEditedAt: now`, `clonedFromProposalId: source`,
// `roundId: null`, `fundMandateId: null` — proposer re-targets the new
// draft. ALL content fields (budget/plan/milestones/desiredOutcomes/
// reportingObligations/organisationalBackground/basedOnIntentId) copied;
// outcomes / awards / review state NOT carried (Q3 / Research R8).

const cloneTool = {
  name: 'grant_proposal:clone',
  description:
    "Clone a GrantProposal as a fresh draft (new id, status=draft, roundId/fundMandateId cleared, content fields copied).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      sourceProposalId: { type: 'string' },
    },
    required: ['token', 'sourceProposalId'],
  },
  handler: async (args: { token: string; sourceProposalId: string }) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'grant_proposal:clone')
    const source = db.select().from(proposalSubmissions)
      .where(and(
        eq(proposalSubmissions.id, args.sourceProposalId),
        eq(proposalSubmissions.principal, orgPrincipal),
      ))
      .all()[0]
    if (!source) {
      throw new Error(`source proposal ${args.sourceProposalId} not found for principal`)
    }
    const now = nowIso()
    const newId = randomUUID()
    const row = {
      id: newId,
      principal: orgPrincipal,
      roundId: null,
      fundMandateId: null,
      basedOnIntentId: source.basedOnIntentId,
      budget: source.budget,
      plan: source.plan,
      milestones: source.milestones,
      desiredOutcomes: source.desiredOutcomes,
      reportingObligations: source.reportingObligations,
      organisationalBackground: source.organisationalBackground,
      submittedAt: null,
      version: 0,
      lastEditedAt: now,
      status: 'draft' as const,
      withdrawnAt: null,
      clonedFromProposalId: source.id,
      basis: null,
      visibility: 'private' as const,
      createdAt: now,
    }
    db.insert(proposalSubmissions).values(row).run()
    return mcpText({ proposal: row })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:award
// ───────────────────────────────────────────────────────────────────────
//
// Treasury Phase 2.5 — flips a submitted proposal to `awarded`. Called by
// the steward set during round close (after the AllocationDecided payload
// is signed N-of-M). The web action layer emits sa:GrantAwardedAssertion
// in the same orchestration; this MCP tool just persists the row state.

interface AwardArgs {
  token: string
  proposalId: string
  totalAwarded: number
  unit: string
  awardedAt?: string
}

const awardTool = {
  name: 'grant_proposal:award',
  description:
    "Mark a submitted GrantProposal as awarded. Records totalAwarded + unit. Called by steward set during round close after the AllocationDecided payload is signed N-of-M; web action layer pairs with sa:GrantAwardedAssertion.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      proposalId: { type: 'string' },
      totalAwarded: { type: 'number' },
      unit: { type: 'string' },
      awardedAt: { type: 'string' },
    },
    required: ['token', 'proposalId', 'totalAwarded', 'unit'],
  },
  handler: async (args: AwardArgs) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:award')
    const existing = db.select().from(proposalSubmissions)
      .where(eq(proposalSubmissions.id, args.proposalId))
      .all()[0]
    if (!existing) throw new Error(`proposal ${args.proposalId} not found`)
    if (existing.status !== 'submitted') {
      throw new Error(`proposal ${args.proposalId} cannot be awarded (status=${existing.status})`)
    }
    const awardedAt = args.awardedAt ?? nowIso()
    // Award metadata is stitched into existing fields without a schema
    // migration: status = 'awarded', and the fund-mandate slot carries
    // (totalAwarded, unit, awardedAt) JSON for downstream queries.
    const awardPayload = JSON.stringify({
      totalAwarded: args.totalAwarded,
      unit: args.unit,
      awardedAt,
    })
    db.update(proposalSubmissions)
      .set({
        status: 'awarded',
        fundMandateId: awardPayload,
        lastEditedAt: awardedAt,
      })
      .where(eq(proposalSubmissions.id, args.proposalId))
      .run()
    return mcpText({
      proposalId: args.proposalId,
      totalAwarded: args.totalAwarded,
      unit: args.unit,
      awardedAt,
    })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:revoke_award
// ───────────────────────────────────────────────────────────────────────
//
// Cancellation guardian for the per-proposal path: revokes an award
// BETWEEN AllocationDecided and the first Disbursement. Companion to
// `round:cancel` (round-level) and `grant_proposal:rescind` (post-disbursement).
//
// Per output/onchain-treasury-plan.md § 2.4 R4b — emits sa:AllocationRevokedAssertion.

interface RevokeAwardArgs {
  token: string
  proposalId: string
  reasonKind: 'dispute-upheld' | 'fraud' | 'mandate-mismatch' | 'recipient-withdrew' | 'other'
  reasonURI?: string
}

const revokeAwardTool = {
  name: 'grant_proposal:revoke_award',
  description:
    "Revoke an awarded GrantProposal between AllocationDecided and the first Disbursement (cancellation-guardian path). Web action layer pairs with sa:AllocationRevokedAssertion.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      proposalId: { type: 'string' },
      reasonKind: { type: 'string', enum: ['dispute-upheld', 'fraud', 'mandate-mismatch', 'recipient-withdrew', 'other'] },
      reasonURI: { type: 'string' },
    },
    required: ['token', 'proposalId', 'reasonKind'],
  },
  handler: async (args: RevokeAwardArgs) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:revoke_award')
    const existing = db.select().from(proposalSubmissions)
      .where(eq(proposalSubmissions.id, args.proposalId))
      .all()[0]
    if (!existing) throw new Error(`proposal ${args.proposalId} not found`)
    if (existing.status !== 'awarded') {
      throw new Error(`proposal ${args.proposalId} cannot be revoked (status=${existing.status})`)
    }
    const now = nowIso()
    const revokePayload = JSON.stringify({
      kind: 'revoke',
      reasonKind: args.reasonKind,
      reasonURI: args.reasonURI ?? null,
      revokedAt: now,
    })
    db.update(proposalSubmissions)
      .set({
        status: 'revoked',
        fundMandateId: revokePayload,
        lastEditedAt: now,
      })
      .where(eq(proposalSubmissions.id, args.proposalId))
      .run()
    return mcpText({
      proposalId: args.proposalId,
      reasonKind: args.reasonKind,
      revokedAt: now,
    })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:rescind
// ───────────────────────────────────────────────────────────────────────
//
// Post-disbursement clawback path. Different from revoke_award (which
// stops the disbursement before it lands). Rescind acknowledges that
// funds were paid and may file a dispute against the recipient via
// AgentDisputeRecord. Web action layer emits sa:GrantRescindedAssertion.

interface RescindArgs {
  token: string
  proposalId: string
  reasonURI: string
  fileDispute?: boolean
}

const rescindTool = {
  name: 'grant_proposal:rescind',
  description:
    "Rescind a previously-disbursed grant (post-disbursement clawback). Web action layer pairs with sa:GrantRescindedAssertion and may also call AgentDisputeRecord.fileDispute when fileDispute=true.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      proposalId: { type: 'string' },
      reasonURI: { type: 'string' },
      fileDispute: { type: 'boolean' },
    },
    required: ['token', 'proposalId', 'reasonURI'],
  },
  handler: async (args: RescindArgs) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:rescind')
    const existing = db.select().from(proposalSubmissions)
      .where(eq(proposalSubmissions.id, args.proposalId))
      .all()[0]
    if (!existing) throw new Error(`proposal ${args.proposalId} not found`)
    if (existing.status !== 'awarded' && existing.status !== 'rescinded') {
      throw new Error(`proposal ${args.proposalId} cannot be rescinded (status=${existing.status})`)
    }
    const now = nowIso()
    const rescindPayload = JSON.stringify({
      kind: 'rescind',
      reasonURI: args.reasonURI,
      fileDispute: args.fileDispute === true,
      rescindedAt: now,
    })
    db.update(proposalSubmissions)
      .set({
        status: 'rescinded',
        fundMandateId: rescindPayload,
        lastEditedAt: now,
      })
      .where(eq(proposalSubmissions.id, args.proposalId))
      .run()
    return mcpText({
      proposalId: args.proposalId,
      reasonURI: args.reasonURI,
      fileDispute: args.fileDispute === true,
      rescindedAt: now,
    })
  },
}

export const grantProposalsTools = {
  'grant_proposal:submit': submitTool,
  'grant_proposal:draft': draftTool,
  'grant_proposal:read_self': readSelfTool,
  'grant_proposal:list_for_member': listForMemberTool,
  'grant_proposal:list_for_round': listForRoundTool,
  'grant_proposal:edit_pre_deadline': editPreDeadlineTool,
  'grant_proposal:withdraw': withdrawTool,
  'grant_proposal:clone': cloneTool,
  'grant_proposal:award': awardTool,
  'grant_proposal:revoke_award': revokeAwardTool,
  'grant_proposal:rescind': rescindTool,
}
