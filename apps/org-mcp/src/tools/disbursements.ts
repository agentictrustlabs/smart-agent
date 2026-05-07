/**
 * Sprint C — disbursements + outcome attestations.
 *
 * Off-chain ledger for the funding stage. Real USDC custody is Treasury
 * Phase 3 (deferred); v1 records the intent (`pending`) → claim
 * (`claimed`) → mock-paid (`paid`) lifecycle so the demo flow shows the
 * full loop.
 *
 * Tools:
 *   - disbursement:record         create a tranche record (called by
 *                                 the round-finalize flow per winner)
 *   - disbursement:list_for_proposal
 *   - disbursement:list_for_recipient
 *   - disbursement:claim          recipient flips status pending→claimed
 *   - disbursement:mark_paid      steward flips claimed→paid (v2: real
 *                                 USDC transfer)
 *   - attestation:cast            validator records milestone delivery
 *   - attestation:list_for_proposal
 */
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'
import { disbursements, outcomeAttestations } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })
const nowIso = () => new Date().toISOString()

// ─── Disbursements ──────────────────────────────────────────────

interface RecordArgs {
  token: string
  proposalId: string
  roundId: string
  trancheLabel: string
  amount: number
  unit?: string
  recipientAgentId: string
  notes?: string
}

const recordTool = {
  name: 'disbursement:record',
  description: 'Create a disbursement tranche record (status=pending). Called by the round-finalize flow per winning proposal.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      proposalId: { type: 'string' },
      roundId: { type: 'string' },
      trancheLabel: { type: 'string' },
      amount: { type: 'integer' },
      unit: { type: 'string' },
      recipientAgentId: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['token', 'proposalId', 'roundId', 'trancheLabel', 'amount', 'recipientAgentId'],
  },
  handler: async (args: RecordArgs) => {
    await requireOrgPrincipal(args.token, args, 'disbursement:record')
    const id = randomUUID()
    const now = nowIso()
    db.insert(disbursements).values({
      id,
      proposalId: args.proposalId,
      roundId: args.roundId,
      trancheLabel: args.trancheLabel,
      amount: args.amount,
      unit: args.unit ?? 'USD',
      recipientAgentId: args.recipientAgentId,
      status: 'pending',
      notes: args.notes ?? null,
      createdAt: now,
      updatedAt: now,
    }).run()
    return mcpText({ id, status: 'pending' })
  },
}

const listForProposalTool = {
  name: 'disbursement:list_for_proposal',
  description: 'List disbursement tranches for a proposal.',
  inputSchema: {
    type: 'object' as const,
    properties: { token: { type: 'string' }, proposalId: { type: 'string' } },
    required: ['token', 'proposalId'],
  },
  handler: async (args: { token: string; proposalId: string }) => {
    await requireOrgPrincipal(args.token, args, 'disbursement:list_for_proposal')
    const rows = db.select().from(disbursements).where(eq(disbursements.proposalId, args.proposalId)).all()
    return mcpText({ disbursements: rows })
  },
}

const listForRecipientTool = {
  name: 'disbursement:list_for_recipient',
  description: 'List disbursements where a viewer is the recipient (their claimable balance).',
  inputSchema: {
    type: 'object' as const,
    properties: { token: { type: 'string' }, recipientAgentId: { type: 'string' } },
    required: ['token', 'recipientAgentId'],
  },
  handler: async (args: { token: string; recipientAgentId: string }) => {
    await requireOrgPrincipal(args.token, args, 'disbursement:list_for_recipient')
    const rows = db.select().from(disbursements).where(eq(disbursements.recipientAgentId, args.recipientAgentId)).all()
    return mcpText({ disbursements: rows })
  },
}

const claimTool = {
  name: 'disbursement:claim',
  description: 'Recipient flips a pending disbursement to claimed. v1 stub (no token transfer); v2 emits the actual USDC transfer.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      disbursementId: { type: 'string' },
      claimerAgentId: { type: 'string' },
    },
    required: ['token', 'disbursementId', 'claimerAgentId'],
  },
  handler: async (args: { token: string; disbursementId: string; claimerAgentId: string }) => {
    await requireOrgPrincipal(args.token, args, 'disbursement:claim')
    const r = db.select().from(disbursements).where(eq(disbursements.id, args.disbursementId)).all()[0]
    if (!r) throw new Error(`disbursement ${args.disbursementId} not found`)
    if (r.recipientAgentId.toLowerCase() !== args.claimerAgentId.toLowerCase()) {
      throw new Error('only the recipient may claim')
    }
    if (r.status !== 'pending') {
      throw new Error(`disbursement is in status '${r.status}' — only 'pending' may be claimed`)
    }
    const now = nowIso()
    db.update(disbursements)
      .set({ status: 'claimed', claimedAt: now, updatedAt: now })
      .where(eq(disbursements.id, args.disbursementId))
      .run()
    return mcpText({ id: args.disbursementId, status: 'claimed', claimedAt: now })
  },
}

const markPaidTool = {
  name: 'disbursement:mark_paid',
  description: 'Steward flips claimed→paid (v1 stub — no real transfer). v2 will broadcast the USDC transfer + record txHash.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      disbursementId: { type: 'string' },
      txHash: { type: 'string' },
    },
    required: ['token', 'disbursementId'],
  },
  handler: async (args: { token: string; disbursementId: string; txHash?: string }) => {
    await requireOrgPrincipal(args.token, args, 'disbursement:mark_paid')
    const r = db.select().from(disbursements).where(eq(disbursements.id, args.disbursementId)).all()[0]
    if (!r) throw new Error(`disbursement ${args.disbursementId} not found`)
    if (r.status !== 'claimed') {
      throw new Error(`disbursement is in status '${r.status}' — must be 'claimed' first`)
    }
    const now = nowIso()
    db.update(disbursements)
      .set({ status: 'paid', paidAt: now, txHash: args.txHash ?? null, updatedAt: now })
      .where(eq(disbursements.id, args.disbursementId))
      .run()
    return mcpText({ id: args.disbursementId, status: 'paid', paidAt: now })
  },
}

// ─── Outcome attestations ──────────────────────────────────────

interface CastAttestArgs {
  token: string
  proposalId: string
  milestoneLabel: string
  validatorAgentId: string
  status: 'delivered' | 'partial' | 'disputed' | 'overdue'
  evidence?: string
}

const castAttestTool = {
  name: 'attestation:cast',
  description: "Validator records milestone delivery. status: delivered | partial | disputed | overdue. Mirrored on chain as sa:OutcomeAttestationAssertion (event-style).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      proposalId: { type: 'string' },
      milestoneLabel: { type: 'string' },
      validatorAgentId: { type: 'string' },
      status: { type: 'string', enum: ['delivered', 'partial', 'disputed', 'overdue'] },
      evidence: { type: 'string' },
    },
    required: ['token', 'proposalId', 'milestoneLabel', 'validatorAgentId', 'status'],
  },
  handler: async (args: CastAttestArgs) => {
    await requireOrgPrincipal(args.token, args, 'attestation:cast')
    const id = randomUUID()
    const now = nowIso()
    db.insert(outcomeAttestations).values({
      id,
      proposalId: args.proposalId,
      milestoneLabel: args.milestoneLabel,
      validatorAgentId: args.validatorAgentId.toLowerCase(),
      status: args.status,
      evidence: args.evidence ?? null,
      attestedAt: now,
      createdAt: now,
    }).run()
    return mcpText({ id, status: args.status })
  },
}

const listAttestForProposalTool = {
  name: 'attestation:list_for_proposal',
  description: 'List milestone attestations for a proposal (all validators, all milestones).',
  inputSchema: {
    type: 'object' as const,
    properties: { token: { type: 'string' }, proposalId: { type: 'string' } },
    required: ['token', 'proposalId'],
  },
  handler: async (args: { token: string; proposalId: string }) => {
    await requireOrgPrincipal(args.token, args, 'attestation:list_for_proposal')
    const rows = db.select().from(outcomeAttestations).where(eq(outcomeAttestations.proposalId, args.proposalId)).all()
    return mcpText({ attestations: rows })
  },
}

export const fundingTools = {
  'disbursement:record': recordTool,
  'disbursement:list_for_proposal': listForProposalTool,
  'disbursement:list_for_recipient': listForRecipientTool,
  'disbursement:claim': claimTool,
  'disbursement:mark_paid': markPaidTool,
  'attestation:cast': castAttestTool,
  'attestation:list_for_proposal': listAttestForProposalTool,
}
