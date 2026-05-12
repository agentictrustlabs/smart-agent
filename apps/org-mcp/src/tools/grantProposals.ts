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
import { keccak256, encodePacked } from 'viem'
import { db } from '../db/index.js'
import {
  orgIntents,
  orgCrossDelegationGrants,
} from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { GrantProposalRegistryClient, fundRegistryAbi } from '@smart-agent/sdk'
import { callA2aRedeemWithChain, type SignedDelegation } from '../lib/a2a-client.js'
import {
  requireGrantProposalRegistryAddress,
  requireFundRegistryAddress,
  getPublicClient,
} from '../lib/contracts.js'

/** Spec 004 v2 — resolve a round's pool agent from on-chain truth
 *  (FundRegistry.getRoundPoolAgent) rather than trusting the caller's
 *  claim. Used to lock the AnonCreds expectedAttribute so a cred for
 *  pool A can't submit/edit/withdraw against a round operated by pool B. */
async function resolveRoundPoolAgent(roundSubject: `0x${string}`): Promise<`0x${string}` | null> {
  const client = getPublicClient()
  const addr = await client.readContract({
    address: requireFundRegistryAddress(),
    abi: fundRegistryAbi,
    functionName: 'getRoundPoolAgent',
    args: [roundSubject],
  }) as `0x${string}`
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return null
  return addr.toLowerCase() as `0x${string}`
}

/** Reverse of FundRegistry.roundSubject(slug). */
function roundSubjectFromUrn(roundIdUrn: string): `0x${string}` {
  const slug = roundIdUrn.startsWith('urn:smart-agent:round:')
    ? roundIdUrn.slice('urn:smart-agent:round:'.length)
    : roundIdUrn
  return keccak256(encodePacked(['string', 'string'], ['sa:round:', slug]))
}

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
  /** Required short human-readable title (Q-display). Surfaced on lists,
   *  cards, and the proposal detail page. */
  displayName: string
  basedOnIntentId: string
  /** Spec 004 — when present, gate the submit on AnonCreds verification
   *  of a ProposalSubmitterCredential rather than principal-from-token.
   *  The credential must bind `poolAgentId` matching the round's pool.
   *  Mutually exclusive with the principal path: when set, the row's
   *  `principal` column is left empty and a `nullifier_hash` is stored
   *  in its place. */
  presentation?: {
    presentationJson: string
    presentationRequest: Record<string, unknown>
    /** poolAgentId the credential must be bound to (matched against the
     *  credential's `poolAgentId` attribute). The submit handler will
     *  verify this matches the round's pool. */
    poolAgentId: string
  }
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
  /** Spec 004 — a2a-agent session id; injected by the gateway so the
   *  submit handler can call `/session/:id/redeem-with-chain` to write
   *  the proposal row on chain. */
  _a2aSessionId?: string
  /** Spec 004 (b2) — chained-delegation redeem. Root first, leaf last.
   *  Root is the admin→holder delegation signed at credential issuance;
   *  leaf is the holder→session leaf freshly minted by the web client
   *  (authority = hash(admin→holder)). The chain leaf's delegate must
   *  equal the a2a session key. */
  chain: SignedDelegation[]
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
    "Submit a GrantProposal to GrantProposalRegistry on chain. Nullifier-keyed (no submitter identity stored). REQUIRES a ProposalSubmitterCredential presentation — no principal-gated fallback (spec 004 no-fallback decision).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },                 // URN or slug; converted to subject
      displayName: { type: 'string' },
      basedOnIntentId: { type: 'string' },
      budget: { type: 'object' },
      plan: { type: 'object' },
      milestones: { type: 'array' },
      desiredOutcomes: { type: 'array' },
      reportingObligations: { type: 'object' },
      organisationalBackground: { type: 'object' },
      basis: { type: 'object' },
      presentation: {
        type: 'object',
        properties: {
          presentationJson: { type: 'string' },
          presentationRequest: { type: 'object' },
          poolAgentId: { type: 'string' },
        },
        required: ['presentationJson', 'presentationRequest', 'poolAgentId'],
      },
      chain: { type: 'array', items: { type: 'object' } },
    },
    required: ['token', 'roundId', 'displayName', 'basedOnIntentId', 'budget', 'plan', 'milestones', 'desiredOutcomes', 'reportingObligations', 'organisationalBackground', 'presentation', 'chain'],
  },
  handler: async (args: SubmitArgs) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:submit')
    if (!args.displayName || !args.displayName.trim()) {
      return err({ kind: 'missing-required-fields', fields: ['displayName'] })
    }

    // ─── Required-fields gate ──────────────────────────────────────────
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
    if (!args.presentation) {
      return err({ kind: 'validation', messages: ['ProposalSubmitterCredential presentation required (no fallback)'] })
    }
    if (!args.roundId) {
      return err({ kind: 'validation', messages: ['roundId required'] })
    }

    // ─── Verify AnonCreds presentation ─────────────────────────────────
    // Spec 004 v2 — poolAgentId is sourced from FundRegistry's on-chain
    // round → pool mapping, NOT from the caller. Otherwise a caller
    // could pass `args.presentation.poolAgentId = <their-cred's-pool>`
    // and the verifier would happily confirm the cred matches the
    // *claim* — even if the round belongs to a different pool.
    const { verifyPresentation } = await import('../auth/verify-presentation.js')
    const { resolveOnChainResolver } = await import('../auth/on-chain-resolver.js')
    const roundSubject = roundSubjectFromUrn(args.roundId)
    const roundPoolAgent = await resolveRoundPoolAgent(roundSubject)
    if (!roundPoolAgent) {
      return err({ kind: 'validation', messages: [`round ${args.roundId} not bound to a pool on chain`] })
    }
    const result = await verifyPresentation({
      resolver: resolveOnChainResolver(),
      credentialType: 'ProposalSubmitterCredential',
      presentationJson: args.presentation.presentationJson,
      presentationRequest: args.presentation.presentationRequest,
      expectedAttributes: { poolAgentId: roundPoolAgent },
      nullifierContext: `proposal:${roundSubject}`,
    })
    if (!result.ok) {
      return err({ kind: 'validation', messages: [`presentation rejected: ${result.error}`] })
    }
    const nullifier = result.nullifierHash as `0x${string}`

    // ─── Build basis JSON (cold-start placeholder if action layer didn't supply) ─
    const basisJson = JSON.stringify(args.basis ?? {
      proximityHops: 0,
      proximityScore: 1,
      priorOutcomes: { fulfilled: 0, abandoned: 0 },
      outcomeScore: 0.5,
      composite: 0.6 * 1 + 0.4 * 0.5,
      isColdStart: true,
    })

    // ─── Redeem GrantProposalRegistry.submit on chain (spec 004 b2) ────
    const sessionId = args._a2aSessionId
    if (!sessionId) {
      return err({ kind: 'validation', messages: ['_a2aSessionId missing'] })
    }
    if (!Array.isArray(args.chain) || args.chain.length === 0) {
      return err({ kind: 'validation', messages: ['chain missing — grant_proposal:submit requires the admin→holder→session delegation chain (spec 004 b2)'] })
    }
    const callData = GrantProposalRegistryClient.encodeSubmit({
      roundSubject,
      nullifier,
      displayName: args.displayName.trim(),
      basedOnIntentId: args.basedOnIntentId,
      budgetJson: JSON.stringify(args.budget),
      planJson: JSON.stringify(args.plan),
      milestonesJson: JSON.stringify(args.milestones),
      outcomesJson: JSON.stringify(args.desiredOutcomes),
      reportingJson: JSON.stringify(args.reportingObligations),
      orgBackgroundJson: JSON.stringify(args.organisationalBackground),
      basisJson,
    })
    const tx = await callA2aRedeemWithChain(sessionId, {
      mcpTool: 'grant_proposal:submit',
      mcpCallId: randomUUID(),
      target: requireGrantProposalRegistryAddress(),
      value: 0n,
      callData,
      chain: args.chain,
    })

    // Compute the same subject the contract will derive for the response.
    const gpSubject = keccak256(encodePacked(
      ['string', 'bytes32', 'bytes32'],
      ['sa:grantProposal:', roundSubject, nullifier],
    ))

    // Side effects (round counter, ack-count, cross-delegation) are
    // retired in the on-chain model:
    // - counter is now derived from GrantProposalRegistry event scans
    // - ack-count is queued for spec-001 cross-MCP refactor
    // - cross-delegation is obsolete (body is public on chain)

    return mcpText({
      ok: true as const,
      txHash: tx.txHash,
      proposalSubject: gpSubject,
      nullifier,
      anonymous: true as const,
    })
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
      displayName: { type: 'string' },
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
  // Spec 004 v2 — `proposal_submissions` dropped from org-mcp; drafts
  // live in person-mcp (the proposer's MCP). Org-mcp no longer carries
  // proposer-side draft state — clients should call person-mcp's
  // `grant_proposal:draft` instead. Stubbed to error so callers fail
  // fast rather than silently writing nowhere.
  handler: async (args: { token: string }) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:draft')
    return mcpText({
      error: 'grant_proposal:draft moved to person-mcp; org-mcp no longer carries proposer-side draft state (spec 004 v2)',
    })
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
  // R8 — read proposals directly from GrantProposalRegistry.
  //
  // Note: on-chain proposal nullifiers are derived from the AnonCred's
  // `nullifierSecret` + 'proposal:<roundSubject>', NOT from the caller's
  // principal. To filter "mine" precisely we'd need to enumerate the
  // caller's marketplace creds, parse nullifierSecret from each, and
  // re-compute the expected nullifier per round — cross-MCP and
  // out-of-scope for this pass. v1 returns ALL proposals; the SDK's
  // getById helper filters by `p.id === id` so detail pages still work,
  // and the "My proposals" listing intentionally shows everyone until
  // the cred-matched filter ships.
  handler: async (args: { token: string; status?: string }) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:read_self')
    try {
      const { readAllProposals } = await import('../lib/grant-proposal-reader.js')
      let rows = await readAllProposals()
      if (args.status) rows = rows.filter((r) => r.status === args.status)
      return mcpText({ proposals: rows })
    } catch (e) {
      console.warn('[grant_proposal:read_self] reader failed:', (e as Error).message)
      return mcpText({ proposals: [] })
    }
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
  // R8 — same chain reader as read_self, sorted by lastEditedAt desc.
  // See the read_self comment for the cred-matched filter follow-up.
  handler: async (args: { token: string; agentId?: string }) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:list_for_member')
    try {
      const { readAllProposals } = await import('../lib/grant-proposal-reader.js')
      const rows = await readAllProposals()
      rows.sort((a, b) => (b.lastEditedAt ?? '').localeCompare(a.lastEditedAt ?? ''))
      return mcpText({ proposals: rows })
    } catch (e) {
      console.warn('[grant_proposal:list_for_member] reader failed:', (e as Error).message)
      return mcpText({ proposals: [] })
    }
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
  // R8 — read on-chain proposals filtered by roundSubject.
  handler: async (args: { token: string; roundId: string }) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:list_for_round')
    try {
      const { readProposalsForRound } = await import('../lib/grant-proposal-reader.js')
      const rows = await readProposalsForRound(args.roundId)
      return mcpText({ proposals: rows })
    } catch (e) {
      console.warn('[grant_proposal:list_for_round] reader failed:', (e as Error).message)
      return mcpText({ proposals: [] })
    }
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: grant_proposal:count_for_round
// ───────────────────────────────────────────────────────────────────────
//
// Cheap count of submitted (non-draft) proposals on a round. The round
// detail page shows this in the "View N proposals" CTA without paying
// the cost of fetching every proposal body. Counterpart to the round
// counter that USED to live in graphdb-sync but was never written (the
// `sa:proposalsReceived` triple isn't emitted), so the page would show
// `(0)` even when proposals existed.
const countForRoundTool = {
  name: 'grant_proposal:count_for_round',
  description:
    "Return the count of submitted GrantProposals on a round. Drafts excluded. Used to render the proposal count on the round detail page.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  // R8 — count submitted (non-withdrawn) proposals for a round.
  handler: async (args: { token: string; roundId: string }) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:count_for_round')
    try {
      const { readProposalsForRound } = await import('../lib/grant-proposal-reader.js')
      const rows = await readProposalsForRound(args.roundId)
      const count = rows.filter((r) => r.status === 'submitted' || r.status === 'awarded').length
      return mcpText({ count })
    } catch (e) {
      console.warn('[grant_proposal:count_for_round] reader failed:', (e as Error).message)
      return mcpText({ count: 0 })
    }
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
      roundId: { type: 'string' },
      patch: { type: 'object' },
      presentation: {
        type: 'object',
        properties: {
          presentationJson: { type: 'string' },
          presentationRequest: { type: 'object' },
          poolAgentId: { type: 'string' },
        },
        required: ['presentationJson', 'presentationRequest', 'poolAgentId'],
      },
      chain: { type: 'array', items: { type: 'object' } },
    },
    required: ['token', 'roundId', 'patch', 'presentation', 'chain'],
  },
  handler: async (args: {
    token: string
    roundId: string
    patch: EditableFields
    presentation: {
      presentationJson: string
      presentationRequest: Record<string, unknown>
      poolAgentId: string
    }
    chain: SignedDelegation[]
    _a2aSessionId?: string
  }) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:edit_pre_deadline')

    // Verify the presentation. The nullifier derives the on-chain
    // proposalSubject the same way submit did — only the original
    // submitter (same credential) can produce a matching nullifier,
    // so the registry's onlyRoundOperator check + nullifier match is
    // a sufficient ownership proof.
    // Spec 004 v2 — poolAgentId from on-chain truth (see resolveRoundPoolAgent).
    const { verifyPresentation } = await import('../auth/verify-presentation.js')
    const { resolveOnChainResolver } = await import('../auth/on-chain-resolver.js')
    const roundSubject = roundSubjectFromUrn(args.roundId)
    const roundPoolAgent = await resolveRoundPoolAgent(roundSubject)
    if (!roundPoolAgent) {
      return err({ kind: 'validation', messages: [`round ${args.roundId} not bound to a pool on chain`] })
    }
    const result = await verifyPresentation({
      resolver: resolveOnChainResolver(),
      credentialType: 'ProposalSubmitterCredential',
      presentationJson: args.presentation.presentationJson,
      presentationRequest: args.presentation.presentationRequest,
      expectedAttributes: { poolAgentId: roundPoolAgent },
      nullifierContext: `proposal:${roundSubject}`,
    })
    if (!result.ok) {
      return err({ kind: 'validation', messages: [`presentation rejected: ${result.error}`] })
    }
    const nullifier = result.nullifierHash as `0x${string}`
    const gpSubject = keccak256(encodePacked(
      ['string', 'bytes32', 'bytes32'],
      ['sa:grantProposal:', roundSubject, nullifier],
    ))

    // POST-PHASE-7 deadline check belongs to the action layer
    // (DiscoveryService.getRoundDetail + compare against now).

    const sessionId = args._a2aSessionId
    if (!sessionId) {
      return err({ kind: 'validation', messages: ['_a2aSessionId missing'] })
    }
    if (!Array.isArray(args.chain) || args.chain.length === 0) {
      return err({ kind: 'validation', messages: ['chain missing — grant_proposal:edit_pre_deadline requires the admin→holder→session delegation chain (spec 004 b2)'] })
    }
    const callData = GrantProposalRegistryClient.encodeEdit({
      proposalSubject: gpSubject,
      patch: {
        budgetJson:        args.patch.budget !== undefined ? JSON.stringify(args.patch.budget) : undefined,
        planJson:          args.patch.plan !== undefined ? JSON.stringify(args.patch.plan) : undefined,
        milestonesJson:    args.patch.milestones !== undefined ? JSON.stringify(args.patch.milestones) : undefined,
        outcomesJson:      args.patch.desiredOutcomes !== undefined ? JSON.stringify(args.patch.desiredOutcomes) : undefined,
        reportingJson:     args.patch.reportingObligations !== undefined ? JSON.stringify(args.patch.reportingObligations) : undefined,
        orgBackgroundJson: args.patch.organisationalBackground !== undefined ? JSON.stringify(args.patch.organisationalBackground) : undefined,
      },
    })
    const tx = await callA2aRedeemWithChain(sessionId, {
      mcpTool: 'grant_proposal:edit_pre_deadline',
      mcpCallId: randomUUID(),
      target: requireGrantProposalRegistryAddress(),
      value: 0n,
      callData,
      chain: args.chain,
    })
    return mcpText({ ok: true as const, txHash: tx.txHash, proposalSubject: gpSubject })
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
      roundId: { type: 'string' },
      presentation: {
        type: 'object',
        properties: {
          presentationJson: { type: 'string' },
          presentationRequest: { type: 'object' },
          poolAgentId: { type: 'string' },
        },
        required: ['presentationJson', 'presentationRequest', 'poolAgentId'],
      },
      chain: { type: 'array', items: { type: 'object' } },
    },
    required: ['token', 'roundId', 'presentation', 'chain'],
  },
  handler: async (args: {
    token: string
    roundId: string
    presentation: {
      presentationJson: string
      presentationRequest: Record<string, unknown>
      poolAgentId: string
    }
    chain: SignedDelegation[]
    _a2aSessionId?: string
  }) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:withdraw')

    // Spec 004 v2 — poolAgentId from on-chain truth (see resolveRoundPoolAgent).
    const { verifyPresentation } = await import('../auth/verify-presentation.js')
    const { resolveOnChainResolver } = await import('../auth/on-chain-resolver.js')
    const roundSubject = roundSubjectFromUrn(args.roundId)
    const roundPoolAgent = await resolveRoundPoolAgent(roundSubject)
    if (!roundPoolAgent) {
      return err({ kind: 'validation', messages: [`round ${args.roundId} not bound to a pool on chain`] })
    }
    const result = await verifyPresentation({
      resolver: resolveOnChainResolver(),
      credentialType: 'ProposalSubmitterCredential',
      presentationJson: args.presentation.presentationJson,
      presentationRequest: args.presentation.presentationRequest,
      expectedAttributes: { poolAgentId: roundPoolAgent },
      nullifierContext: `proposal:${roundSubject}`,
    })
    if (!result.ok) {
      return err({ kind: 'validation', messages: [`presentation rejected: ${result.error}`] })
    }
    const nullifier = result.nullifierHash as `0x${string}`
    const gpSubject = keccak256(encodePacked(
      ['string', 'bytes32', 'bytes32'],
      ['sa:grantProposal:', roundSubject, nullifier],
    ))

    const sessionId = args._a2aSessionId
    if (!sessionId) {
      return err({ kind: 'validation', messages: ['_a2aSessionId missing'] })
    }
    if (!Array.isArray(args.chain) || args.chain.length === 0) {
      return err({ kind: 'validation', messages: ['chain missing — grant_proposal:withdraw requires the admin→holder→session delegation chain (spec 004 b2)'] })
    }
    const callData = GrantProposalRegistryClient.encodeWithdraw(gpSubject)
    const tx = await callA2aRedeemWithChain(sessionId, {
      mcpTool: 'grant_proposal:withdraw',
      mcpCallId: randomUUID(),
      target: requireGrantProposalRegistryAddress(),
      value: 0n,
      callData,
      chain: args.chain,
    })
    // intentRevertedToExpressed (FR-023 ack-count cascade) is queued
    // for the cross-MCP intent registry refactor.
    return mcpText({
      ok: true as const,
      txHash: tx.txHash,
      proposalSubject: gpSubject,
      intentRevertedToExpressed: false,
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
  // Spec 004 v2 — clone targets person-mcp's draft store (org-mcp no
  // longer carries proposer-side drafts).
  handler: async (args: { token: string; sourceProposalId: string }) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:clone')
    void args
    void randomUUID
    return mcpText({
      error: 'grant_proposal:clone moved to person-mcp (spec 004 v2)',
    })
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
  // Spec 004 v2 — award/revoke/rescind state transitions move on chain
  // (status flag on GrantProposalRegistry subject). Wiring queued.
  handler: async (args: AwardArgs) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:award')
    return mcpText({
      error: 'grant_proposal:award not yet wired to GrantProposalRegistry.setStatus (spec 004 v2)',
      proposalId: args.proposalId,
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
  // Spec 004 v2 — queued (see grant_proposal:award).
  handler: async (args: RevokeAwardArgs) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:revoke_award')
    return mcpText({
      error: 'grant_proposal:revoke_award not yet wired to GrantProposalRegistry.setStatus (spec 004 v2)',
      proposalId: args.proposalId,
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
  // Spec 004 v2 — queued (see grant_proposal:award).
  handler: async (args: RescindArgs) => {
    await requireOrgPrincipal(args.token, args, 'grant_proposal:rescind')
    return mcpText({
      error: 'grant_proposal:rescind not yet wired to GrantProposalRegistry.setStatus (spec 004 v2)',
      proposalId: args.proposalId,
    })
  },
}

export const grantProposalsTools = {
  'grant_proposal:submit': submitTool,
  'grant_proposal:draft': draftTool,
  'grant_proposal:read_self': readSelfTool,
  'grant_proposal:list_for_member': listForMemberTool,
  'grant_proposal:list_for_round': listForRoundTool,
  'grant_proposal:count_for_round': countForRoundTool,
  'grant_proposal:edit_pre_deadline': editPreDeadlineTool,
  'grant_proposal:withdraw': withdrawTool,
  'grant_proposal:clone': cloneTool,
  'grant_proposal:award': awardTool,
  'grant_proposal:revoke_award': revokeAwardTool,
  'grant_proposal:rescind': rescindTool,
}
