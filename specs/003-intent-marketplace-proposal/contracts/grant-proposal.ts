// Contract: @smart-agent/sdk/grantProposals
// Phase 1 design artifact for spec 003 — Intent Marketplace (Proposal Lane).
// This is the EXPLICIT contract handed to the downstream review/award spec
// (per spec.md SC-005). Field shape fixed by Clarifications Q1–Q5.
//
// Class rename (Audit § 2 O1, § 4 F3):
//   The on-chain `sag:Proposal` class refers to GOVERNANCE-VOTE proposals (org-mcp's
//   existing `proposals` table). To avoid the noun collision, this artifact's class
//   is `sa:GrantProposal`. The user has authorised propagating this rename across
//   ALL layers (TS, contracts, spec text, plan, data-model, research, quickstart) —
//   so the TS type below is `GrantProposal`, not `ProposalSubmission`.
//
// Persistence model (per docs/information-architecture/10-intent-marketplace-classification.md § 2.3):
//   - Body lives in the PROPOSER'S MCP (almost always org-mcp; person-mcp for solo
//     human applicants) in a `proposal_submissions` table.
//   - NO on-chain anchor in v1 — proposals are confidential under steward review.
//     SHACL `sa:GrantProposalAlwaysPrivateShape` enforces "no sa:onChainAssertionId".
//     The downstream review/award spec MAY mint an awarded-outcome anchor; not in scope here.
//   - NO GraphDB mirror in v1 — `sa:GrantProposal` IRIs never appear in GraphDB.
//   - Steward read access is via `proposal:read_for_review` cross-delegation issued
//     by the proposer at submit time (scope: one round or one fund-mandate).
//
// TS field → T-Box predicate mapping (Audit § 3 + § 8.2):
//   proposerAgentId          → sa:proposer
//   roundId                  → sa:targetRound
//   fundMandateId            → sa:fundMandate  (range sa:Fund — no separate Mandate entity)
//   basedOnIntentId          → sa:basedOnIntent
//   budget / plan / milestones / desiredOutcomes / reportingObligations
//                            → sa:budget / sa:plan / sa:milestones / sa:desiredOutcomes / sa:reportingObligations  (all xsd:string JSON literals)
//   organisationalBackground → sa:organisationalBackground
//   submittedAt              → sa:proposalSubmittedAt  (subPropertyOf prov:generatedAtTime)
//   version                  → sa:version
//   lastEditedAt             → sa:lastEditedAt
//   status                   → sa:proposalStatus  (range sa:GrantProposalStatus)
//   withdrawnAt              → sa:withdrawnAt
//   clonedFromProposalId     → sa:clonedFromProposal  (range sa:GrantProposal)
//   basis                    → sa:basis  (xsd:string JSON literal — same as spec 001)

import type { RankBasis } from "../../001-intent-marketplace-discovery/contracts/matchmaker";

export type BudgetLineItem = {
  name: string;
  amount: number;
  unit: string;
  justification?: string;
};

export type Budget = {
  lineItems: BudgetLineItem[];
  total: number;
};

export type Milestone = {
  name: string;
  dueDate: string; // ISO-8601
  evidenceRequired: string;
  trancheAmount: number;
};

export type DesiredOutcome = {
  statement: string;
  measurable: string;
  validators: string[]; // agentIds
};

export type ReportingObligations = {
  cadence: "quarterly" | "milestone" | "annual" | "none";
  format:
    | "written"
    | "written+financial"
    | "written+financial+testimony";
};

export type OrganisationalBackground = {
  narrative: string;
  priorTrackRecordRefs?: string[];
};

/** C-Box `sa:GrantProposalStatus` values. */
export type GrantProposalStatus =
  | "draft"
  | "submitted"
  | "withdrawn"
  | "awarded" // downstream spec sets
  | "declined"; // downstream spec sets

/**
 * The terminal artifact of spec 003. Body persisted in the proposer's MCP
 * (almost always org-mcp; person-mcp for solo human applicants).
 *
 * ALWAYS visibility=private in v1 — no on-chain anchor, no GraphDB mirror.
 * SHACL `sa:GrantProposalAlwaysPrivateShape` enforces this.
 */
export type GrantProposal = {
  id: string;
  proposerAgentId: string;
  roundId: string | null; // null for open-call (Q5)
  fundMandateId: string | null; // required when roundId === null; references a sa:Fund directly (no separate Mandate entity)
  basedOnIntentId: string;
  budget: Budget;
  plan: { narrative: string; planArtifactRef?: string };
  milestones: Milestone[];
  desiredOutcomes: DesiredOutcome[];
  reportingObligations: ReportingObligations;
  organisationalBackground: OrganisationalBackground;
  submittedAt: string; // ISO-8601 (set on first submit; null while draft)
  version: number; // 0 on first submit; ++ per pre-deadline edit
  lastEditedAt: string; // ISO-8601
  status: GrantProposalStatus;
  withdrawnAt?: string; // ISO-8601
  clonedFromProposalId?: string;
  basis: RankBasis;
};

export type SubmitGrantProposalRequest = Omit<
  GrantProposal,
  "id" | "submittedAt" | "version" | "lastEditedAt" | "status" | "basis"
>;

export type EditGrantProposalRequest = {
  proposalId: string;
  patch: Partial<
    Pick<
      GrantProposal,
      | "budget"
      | "plan"
      | "milestones"
      | "desiredOutcomes"
      | "reportingObligations"
      | "organisationalBackground"
    >
  >;
};

export type SubmitGrantProposalError =
  | { kind: "missing-required-fields"; fields: string[] }
  | { kind: "budget-overage"; ceiling: number; submitted: number }
  | { kind: "missing-credential"; required: string[]; held: string[] }
  | { kind: "open-call-not-accepted" }
  | { kind: "private-round-not-addressed" }
  | { kind: "validation"; messages: string[] };

export type SubmitGrantProposalResult =
  | { ok: true; proposal: GrantProposal }
  | { ok: false; error: SubmitGrantProposalError };

export type WithdrawGrantProposalResult = {
  proposal: GrantProposal;
  intentRevertedToExpressed: boolean; // FR-023 outcome
};

/**
 * Routes writes through the proposer's MCP (`grant_proposal:submit` tool); routes reads
 * through the proposer's MCP for self / through the fund's org-mcp + `proposal:read_for_review`
 * cross-delegation for steward views.
 *
 * Delegation scopes (added to the catalog by Security agent before tools land):
 *   - grant_proposal:draft / submit / edit_pre_deadline / withdraw / clone   (proposer only)
 *   - grant_proposal:read_self                                                (proposer only)
 *   - proposal:read_for_review                                                (cross — scope: one round or one fund — issued by proposer at submit; readable by round's stewards until terminal state)
 *   - intent:bump_ack_count                                                   (system — proposer's MCP issues to the intent owner's MCP on submit/withdraw — IA § 3.10; same primitive used by spec 001)
 */
export interface GrantProposalClient {
  submit(req: SubmitGrantProposalRequest): Promise<SubmitGrantProposalResult>;
  edit(req: EditGrantProposalRequest): Promise<GrantProposal>; // pre-deadline only; throws otherwise
  withdraw(proposalId: string): Promise<WithdrawGrantProposalResult>;
  clone(sourceProposalId: string): Promise<GrantProposal>; // returns a fresh draft
  getById(id: string): Promise<GrantProposal | null>;
  listForMember(agentId: string): Promise<GrantProposal[]>;
  /** Steward-side view; ranked using stewardSideSignals + the spec 001 ranking function. */
  listForRound(
    roundId: string,
    stewardAgentId: string
  ): Promise<GrantProposal[]>;
}
