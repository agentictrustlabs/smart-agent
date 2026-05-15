/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Grant proposal types (T041).
 *
 * These types mirror `specs/003-intent-marketplace-proposal/contracts/grant-proposal.ts`
 * verbatim. The spec contract is not a published package, so the SDK
 * carries the runtime-importable copy. Keeping the contract file as the
 * canonical source — when it changes, this file follows.
 *
 * Class-rename note (Audit § 2 O1): `GrantProposal` (NOT `ProposalSubmission`)
 * — the on-chain `sag:Proposal` class refers to governance-vote proposals
 * and the noun collision was load-bearing for confusion. T-Box predicate is
 * `sa:GrantProposal`; TypeScript carries the same name.
 *
 * IA invariants (enforced by callers, declared here for documentation):
 *   - Body lives ONLY in the proposer's MCP (almost always org-mcp; person-mcp
 *     for solo human applicants).
 *   - NO on-chain anchor in v1 — SHACL `sa:GrantProposalAlwaysPrivateShape`
 *     enforces "no sa:onChainAssertionId".
 *   - NO GraphDB mirror in v1 — `sa:GrantProposal` IRIs never reach GraphDB.
 *   - Steward read access via `proposal:read_for_review` cross-delegation
 *     issued by the proposer at submit time.
 */

import type { RankBasis } from '../matchmaker'

export interface BudgetLineItem {
  name: string
  amount: number
  unit: string
  justification?: string
}

export interface Budget {
  lineItems: BudgetLineItem[]
  total: number
}

export interface Milestone {
  name: string
  /** ISO-8601. */
  dueDate: string
  evidenceRequired: string
  trancheAmount: number
}

export interface DesiredOutcome {
  statement: string
  measurable: string
  /** Validator agentIds. */
  validators: string[]
}

export interface ReportingObligations {
  cadence: 'quarterly' | 'milestone' | 'annual' | 'none'
  format: 'written' | 'written+financial' | 'written+financial+testimony'
}

export interface OrganisationalBackground {
  narrative: string
  priorTrackRecordRefs?: string[]
}

/** C-Box `sa:GrantProposalStatus` values. */
export type GrantProposalStatus =
  | 'draft'
  | 'submitted'
  | 'withdrawn'
  | 'awarded'
  | 'declined'

/**
 * The terminal artifact of spec 003. Body persisted in the proposer's MCP.
 * ALWAYS visibility=private in v1.
 */
export interface GrantProposal {
  id: string
  proposerAgentId: string
  /** Short human-readable title surfaced on lists, cards, and the
   *  proposal detail page. Required at submit time; legacy rows may
   *  have an empty string. */
  displayName: string
  /** null for open-call (Q5). */
  roundId: string | null
  /** Required when `roundId === null`; references a sa:Fund directly. */
  fundMandateId: string | null
  basedOnIntentId: string
  budget: Budget
  plan: { narrative: string; planArtifactRef?: string }
  milestones: Milestone[]
  desiredOutcomes: DesiredOutcome[]
  reportingObligations: ReportingObligations
  organisationalBackground: OrganisationalBackground
  /** ISO-8601. Set on first submit; null while draft. */
  submittedAt: string | null
  /** 0 on first submit; ++ per pre-deadline edit. */
  version: number
  /** ISO-8601. */
  lastEditedAt: string
  status: GrantProposalStatus
  /** ISO-8601. */
  withdrawnAt?: string
  clonedFromProposalId?: string
  basis: RankBasis
  /**
   * Hex address of the recipient AgentAccount that receives funds at award
   * time (the proposer's hub-org's `sa:hasTreasury`). Distinct from the
   * proposer's anonymous nullifier `proposerAgentId` — the proposer is a
   * pseudonym (AnonCreds), but the recipient is a publicly-named treasury
   * so commitment-release tranches can transfer USDC into it. Required at
   * submit time; the on-chain row stores it under `sa:gpRecipient`.
   */
  recipientAddress: `0x${string}`
}

export type SubmitGrantProposalRequest = Omit<
  GrantProposal,
  'id' | 'submittedAt' | 'version' | 'lastEditedAt' | 'status' | 'basis'
>

export interface EditGrantProposalRequest {
  proposalId: string
  patch: Partial<
    Pick<
      GrantProposal,
      | 'budget'
      | 'plan'
      | 'milestones'
      | 'desiredOutcomes'
      | 'reportingObligations'
      | 'organisationalBackground'
    >
  >
}

export type SubmitGrantProposalError =
  | { kind: 'missing-required-fields'; fields: string[] }
  | { kind: 'budget-overage'; ceiling: number; submitted: number }
  | { kind: 'missing-credential'; required: string[]; held: string[] }
  | { kind: 'open-call-not-accepted' }
  | { kind: 'private-round-not-addressed' }
  | { kind: 'validation'; messages: string[] }

export type SubmitGrantProposalResult =
  | { ok: true; proposal: GrantProposal }
  | { ok: false; error: SubmitGrantProposalError }

export interface WithdrawGrantProposalResult {
  proposal: GrantProposal
  /** FR-023 outcome. */
  intentRevertedToExpressed: boolean
}
