'use server'

/**
 * Sprint C — server actions for the disbursement claim flow + outcome attestations.
 *
 * These wrap the org-mcp tools so client components can call simple
 * /api/* endpoints. Auth: claim requires the caller to be the recipient;
 * mark-paid + record require steward (canManageAgent on the round's fund);
 * attest requires the caller to be a validator (v1: any canManageAgent
 * of the awarding fund — the validator role is collapsed into the steward
 * role until the validator-set spec lands).
 */

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { callMcp } from '@/lib/clients/mcp-client'

export interface ActionFailure { ok: false; error: string }

export interface DisbursementRow {
  id: string
  proposalId: string
  roundId: string
  trancheLabel: string
  amount: number
  unit: string
  recipientAgentId: string
  status: 'pending' | 'claimed' | 'paid' | 'revoked'
  claimedAt: string | null
  paidAt: string | null
  txHash: string | null
  notes: string | null
}

export interface AttestationRow {
  id: string
  proposalId: string
  milestoneLabel: string
  validatorAgentId: string
  status: 'delivered' | 'partial' | 'disputed' | 'overdue'
  evidence: string | null
  attestedAt: string
}

export async function listDisbursementsForProposal(proposalId: string): Promise<{ disbursements: DisbursementRow[] } | ActionFailure> {
  try {
    return await callMcp('org', 'disbursement:list_for_proposal', { proposalId })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function listMyDisbursements(): Promise<{ disbursements: DisbursementRow[] } | ActionFailure> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }
  try {
    return await callMcp('org', 'disbursement:list_for_recipient', { recipientAgentId: myAgent })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function claimDisbursement(disbursementId: string): Promise<{ ok: true; status: string } | ActionFailure> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }
  try {
    const r = await callMcp<{ id: string; status: string }>('org', 'disbursement:claim', {
      disbursementId,
      claimerAgentId: myAgent,
    })
    return { ok: true, status: r.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface MarkPaidInput {
  disbursementId: string
  fundAgent: string  // for the canManageAgent check
}

export async function markDisbursementPaid(input: MarkPaidInput): Promise<{ ok: true; status: string } | ActionFailure> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }
  let canMng = false
  try { canMng = await canManageAgent(myAgent, input.fundAgent) } catch { canMng = false }
  if (!canMng) return { ok: false, error: 'not-fund-owner' }
  try {
    const r = await callMcp<{ id: string; status: string }>('org', 'disbursement:mark_paid', {
      disbursementId: input.disbursementId,
    })
    return { ok: true, status: r.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Outcome attestations ───────────────────────────────────────

export interface CastAttestationInput {
  proposalId: string
  fundAgent: string  // for the validator/steward authorization gate
  milestoneLabel: string
  status: 'delivered' | 'partial' | 'disputed' | 'overdue'
  evidence?: string
}

export async function castAttestation(input: CastAttestationInput): Promise<{ ok: true; id: string } | ActionFailure> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }
  // v1 — validator role collapses into steward (canManageAgent of the
  // awarding fund). When the validator-set registry ships in Phase 4,
  // this gate switches to a validator-membership check.
  let canValidate = false
  try { canValidate = await canManageAgent(myAgent, input.fundAgent) } catch { canValidate = false }
  if (!canValidate) return { ok: false, error: 'not-a-validator' }
  try {
    const r = await callMcp<{ id: string }>('org', 'attestation:cast', {
      proposalId: input.proposalId,
      milestoneLabel: input.milestoneLabel,
      validatorAgentId: myAgent,
      status: input.status,
      evidence: input.evidence,
    })
    return { ok: true, id: r.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function listAttestationsForProposal(proposalId: string): Promise<{ attestations: AttestationRow[] } | ActionFailure> {
  try {
    return await callMcp('org', 'attestation:list_for_proposal', { proposalId })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
