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
  rounds,
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

interface RoundBody {
  id: string
  orgPrincipal: string
  mandate: { acceptedKinds: string[]; acceptedGeo: string[]; budgetCeiling: number; expectedAwards: number }
  visibility: 'public' | 'private'
  addressedApplicants: string[] | null
  requiredCredentials: string[]
  deadline: string
}

function safeJson<T>(raw: string | null | undefined, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T } catch { return fb }
}

/**
 * Read a round body from the same-DB rounds table. v1 simplification:
 * cross-MCP federation is deferred. If the fund's org-mcp is a different
 * instance, this returns null and the caller must surface a validation
 * error. // TODO(cross-mcp): replace with a federated round-read RPC.
 */
function readLocalRound(roundId: string): RoundBody | null {
  const rows = db.select().from(rounds).where(eq(rounds.id, roundId)).all()
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    id: r.id,
    orgPrincipal: r.orgPrincipal.toLowerCase(),
    mandate: safeJson(r.mandate, { acceptedKinds: [], acceptedGeo: [], budgetCeiling: 0, expectedAwards: 0 }),
    visibility: (r.visibility === 'private' ? 'private' : 'public'),
    addressedApplicants: r.addressedApplicants ? safeJson<string[]>(r.addressedApplicants, []) : null,
    requiredCredentials: safeJson<string[]>(r.requiredCredentials, []),
    deadline: r.deadline,
  }
}

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
 * Increment the round's proposalsReceived counter. Same-DB call when the
 * round is local; warning otherwise. // TODO(cross-mcp).
 */
function bumpRoundCounter(roundId: string, delta: 1 | -1): void {
  const r = db.select().from(rounds).where(eq(rounds.id, roundId)).all()[0]
  if (!r) {
    console.warn(`[org-mcp/grantProposals] round counter skipped — round ${roundId} not local. // TODO(cross-mcp)`)
    return
  }
  const next = Math.max(0, (r.proposalsReceived ?? 0) + delta)
  db.update(rounds)
    .set({ proposalsReceived: next, updatedAt: nowIso() })
    .where(eq(rounds.id, roundId))
    .run()
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

    // ─── Round-targeted validation ────────────────────────────────────
    if (hasRound) {
      const round = readLocalRound(args.roundId as string)
      if (!round) {
        // v1: round in different MCP tenant → cannot validate cross-MCP. Treat
        // as a soft warning rather than a hard failure for the demo path.
        // Production: error out. // TODO(cross-mcp).
        console.warn(
          `[org-mcp/grantProposals] round ${args.roundId} not local — submit-time validation skipped. // TODO(cross-mcp)`,
        )
      } else {
        // Budget ceiling.
        if (round.mandate.budgetCeiling > 0 && args.budget.total > round.mandate.budgetCeiling) {
          return err({
            kind: 'budget-overage',
            ceiling: round.mandate.budgetCeiling,
            submitted: args.budget.total,
          })
        }
        // Required credentials.
        const credCheck = checkCredentialsHeld(round.requiredCredentials, orgPrincipal)
        if (!credCheck.ok) {
          return err({
            kind: 'missing-credential',
            required: round.requiredCredentials,
            held: credCheck.held,
          })
        }
        // Private-round addressee membership (FR-012).
        if (round.visibility === 'private') {
          const list = (round.addressedApplicants ?? []).map((a) => a.toLowerCase())
          if (!list.includes(orgPrincipal.toLowerCase())) {
            return err({ kind: 'private-round-not-addressed' })
          }
        }
      }
    }

    // ─── Open-call eligibility (Q5 / FR-014) ──────────────────────────
    if (hasFund) {
      // v1 simplification: we can't always read the fund's `acceptsOpenCalls`
      // metadata in-process (lives on agent profile). For the demo path we
      // accept the open-call when the proposer explicitly supplies a
      // fundMandateId — production wires a discovery lookup.
      // // TODO(open-call): wire DiscoveryService.fundMandateQuery here.
      console.warn(
        `[org-mcp/grantProposals] open-call acceptsOpenCalls check stubbed for fund ${args.fundMandateId}. // TODO`,
      )
    }

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
    // Fund/round steward = the round's org_principal (= fundAgentId). For the
    // round case we read the fund-id from the local round body; for open-call
    // we use the supplied fundMandateId directly.
    let stewardAgent: string | null = null
    if (hasRound && args.roundId) {
      const r = readLocalRound(args.roundId)
      stewardAgent = r?.orgPrincipal ?? null
    } else if (hasFund && args.fundMandateId) {
      stewardAgent = args.fundMandateId
    }
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
        `[org-mcp/grantProposals] no steward agent resolvable for proposal ${proposalId}; cross-delegation grant skipped. // TODO(cross-mcp)`,
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

export const grantProposalsTools = {
  'grant_proposal:submit': submitTool,
  'grant_proposal:draft': draftTool,
  'grant_proposal:read_self': readSelfTool,
}
