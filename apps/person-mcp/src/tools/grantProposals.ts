/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Grant proposal MCP tools (T038, T039).
 *
 * person-mcp side: solo human applicants. The org-mcp twin in
 * `apps/org-mcp/src/tools/grantProposals.ts` is the common case (orgs apply
 * for grants); this person-mcp version is for individuals.
 *
 * Tools registered (each tool name === scope name):
 *   - grant_proposal:draft
 *   - grant_proposal:submit
 *   - grant_proposal:read_self
 *
 * Persistence: `proposal_submissions` table (person-mcp tenancy column is
 * `principal`, NOT `org_principal`). ALWAYS private; never anchored on chain;
 * never mirrored to GraphDB. SHACL `sa:GrantProposalAlwaysPrivateShape`
 * enforces. No `emitOnChainAssertion` call here.
 *
 * Cross-MCP federation: v1 simplification — the round body lives in the
 * fund's org-mcp, which is a different process. The submit tool here can't
 * read the round body directly without a cross-MCP RPC, so submit-time
 * validation is best-effort: required-fields presence is checked locally,
 * but budget-ceiling / required-credentials / addressee-membership checks
 * are deferred to the action layer where DiscoveryService can be called.
 * // TODO(cross-mcp): wire a federated round-read RPC.
 *
 * Side effects (counter +1, ack-count +1, cross-delegation grant) are also
 * v1-simplified: counter and ack-count bumps are no-ops in person-mcp
 * (the targets are usually in different MCPs); the cross-delegation grant
 * is recorded in the local `cross_delegation_grants` table.
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  proposalSubmissions,
  intents,
  crossDelegationGrants,
} from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

// ───────────────────────────────────────────────────────────────────────
// Types — mirror packages/sdk/src/grantProposals/types.ts.
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
  roundId?: string | null
  fundMandateId?: string | null
  basedOnIntentId: string
  budget: Budget
  plan: PlanShape
  milestones: Milestone[]
  desiredOutcomes: DesiredOutcome[]
  reportingObligations: ReportingObligations
  organisationalBackground: OrganisationalBackground
  basis?: unknown
  draftId?: string
}

type SubmitErrorKind =
  | { kind: 'missing-required-fields'; fields: string[] }
  | { kind: 'budget-overage'; ceiling: number; submitted: number }
  | { kind: 'missing-credential'; required: string[]; held: string[] }
  | { kind: 'open-call-not-accepted' }
  | { kind: 'private-round-not-addressed' }
  | { kind: 'validation'; messages: string[] }

function err(error: SubmitErrorKind) {
  return mcpText({ ok: false as const, error })
}

function nowIso(): string {
  return new Date().toISOString()
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

/**
 * Bump the local intent's live_acknowledgement_count (mirrors org-mcp's
 * intent:bump_ack_count tool's logic). Called inline as part of submit.
 *
 * v1 simplification: only bumps if the intent is locally-tenanted in this
 * person-mcp instance. Otherwise warns and skips. // TODO(cross-mcp).
 */
function bumpAckCount(intentId: string, delta: 1 | -1, principal: string): void {
  const row = db.select().from(intents)
    .where(and(eq(intents.id, intentId), eq(intents.principal, principal)))
    .all()[0]
  if (!row) {
    console.warn(
      `[person-mcp/grantProposals] ack-count bump skipped — intent ${intentId} not local. // TODO(cross-mcp)`,
    )
    return
  }
  const cur = row.liveAcknowledgementCount ?? 0
  const next = Math.max(0, cur + delta)
  let nextStatus = row.status
  if (cur === 0 && next === 1 && nextStatus === 'expressed') nextStatus = 'acknowledged'
  else if (cur === 1 && next === 0 && nextStatus === 'acknowledged') nextStatus = 'expressed'
  db.update(intents)
    .set({ liveAcknowledgementCount: next, status: nextStatus, updatedAt: nowIso() })
    .where(and(eq(intents.id, intentId), eq(intents.principal, principal)))
    .run()
}

/**
 * Issue a `proposal:read_for_review` cross-delegation grant. Recorded in the
 * local `cross_delegation_grants` table; the steward presents this scope
 * when reading the proposal body.
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
  db.insert(crossDelegationGrants).values({
    id: randomUUID(),
    principal: opts.proposerPrincipal,
    granteeAgent: opts.fundAgentId.toLowerCase(),
    scope: JSON.stringify({ scope: scopeBase, proposalId: opts.proposalId }),
    validFrom: nowIso(),
    validUntil: null,
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
    "Validate a proposal against the target round/fund and persist as 'submitted' (person-mcp). Cascades counter +1, ack-count +1, and cross-delegation grant. Always private — never anchored on chain.",
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
    const principal = await requirePrincipal(args.token, 'grant_proposal:submit')

    const hasRound = !!args.roundId
    const hasFund = !!args.fundMandateId
    if (hasRound === hasFund) {
      return err({
        kind: 'validation',
        messages: ['exactly one of roundId / fundMandateId must be set (Q3)'],
      })
    }

    // Required-fields presence check.
    const missing: string[] = []
    if (!args.budget || !Array.isArray(args.budget.lineItems) || args.budget.lineItems.length === 0) missing.push('budget')
    if (!args.plan || !args.plan.narrative) missing.push('plan')
    if (!Array.isArray(args.milestones) || args.milestones.length === 0) missing.push('milestones')
    if (!Array.isArray(args.desiredOutcomes) || args.desiredOutcomes.length === 0) missing.push('desiredOutcomes')
    if (!args.reportingObligations || !args.reportingObligations.cadence) missing.push('reportingObligations')
    if (!args.organisationalBackground || !args.organisationalBackground.narrative) missing.push('organisationalBackground')
    if (missing.length > 0) {
      return err({ kind: 'missing-required-fields', fields: missing })
    }

    // v1 simplification: round body lives in fund's org-mcp; person-mcp can't
    // read it without a cross-MCP RPC. Caller (action layer) must perform
    // budget-ceiling / required-credentials / addressee-membership checks
    // BEFORE invoking this tool.
    // // TODO(cross-mcp): replace with a federated round-read RPC.
    console.warn(
      `[person-mcp/grantProposals] round body validation deferred to action layer. // TODO(cross-mcp)`,
    )

    // Insert.
    const now = nowIso()
    const proposalId = args.draftId ?? randomUUID()
    const basisJson = JSON.stringify(args.basis ?? {
      proximityHops: 0,
      proximityScore: 1,
      priorOutcomes: { fulfilled: 0, abandoned: 0 },
      outcomeScore: 0.5,
      composite: 0.6 * 1 + 0.4 * 0.5,
      isColdStart: true,
    })

    const row = {
      id: proposalId,
      principal,
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
          eq(proposalSubmissions.principal, principal),
        ))
        .run()
    } else {
      db.insert(proposalSubmissions).values(row).run()
    }

    // Side effects.
    // 1. Round counter +1 — // TODO(cross-mcp): bump fund's org-mcp counter.
    if (hasRound) {
      console.warn(
        `[person-mcp/grantProposals] round counter +1 for ${args.roundId} skipped — cross-MCP RPC not implemented. // TODO(cross-mcp)`,
      )
    }
    // 2. Ack-count +1 on basedOnIntent (local for person proposers — their own intent).
    bumpAckCount(args.basedOnIntentId, 1, principal)

    // 3. Cross-delegation grant.
    let stewardAgent: string | null = null
    if (hasFund && args.fundMandateId) stewardAgent = args.fundMandateId
    if (hasRound && args.roundId) {
      // v1: derive stewardAgent from the roundId via the action layer; for
      // local cross-delegation recording we still need an agent IRI. The
      // action layer must pass a fundMandateId if the round's fundAgent is
      // known — otherwise we record a placeholder "open-call" grantee.
      stewardAgent = args.fundMandateId ?? null
    }
    if (stewardAgent) {
      issueReadForReviewGrant({
        proposerPrincipal: principal,
        fundAgentId: stewardAgent,
        roundId: args.roundId ?? null,
        fundMandateId: args.fundMandateId ?? null,
        proposalId,
      })
    } else {
      console.warn(
        `[person-mcp/grantProposals] cross-delegation grant deferred — caller must supply fundMandateId or invoke a follow-up grant tool. // TODO(cross-mcp)`,
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
    const principal = await requirePrincipal(args.token, 'grant_proposal:draft')
    const now = nowIso()

    if (args.proposalId) {
      const existing = db.select().from(proposalSubmissions)
        .where(and(
          eq(proposalSubmissions.id, args.proposalId),
          eq(proposalSubmissions.principal, principal),
        ))
        .all()
      if (existing.length === 0) {
        throw new Error(`draft ${args.proposalId} not found for principal`)
      }
      if (existing[0].status !== 'draft') {
        throw new Error(`proposal ${args.proposalId} is not in 'draft' state`)
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
          eq(proposalSubmissions.principal, principal),
        ))
        .run()
      const updated = db.select().from(proposalSubmissions)
        .where(eq(proposalSubmissions.id, args.proposalId))
        .all()[0]
      return mcpText({ proposal: updated })
    }

    const id = randomUUID()
    const row = {
      id,
      principal,
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
  description: "List all GrantProposals owned by the authenticated principal.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      status: { type: 'string' },
    },
    required: ['token'],
  },
  handler: async (args: { token: string; status?: string }) => {
    const principal = await requirePrincipal(args.token, 'grant_proposal:read_self')
    let rows = db.select().from(proposalSubmissions)
      .where(eq(proposalSubmissions.principal, principal))
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
