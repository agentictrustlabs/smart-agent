// Contract: @smart-agent/sdk/rounds
// Phase 1 design artifact for spec 003 — Intent Marketplace (Proposal Lane).
//
// T-Box (Audit § 1.1, § 8.1):
//   sa:Round subClassOf prov:Plan, p-plan:Plan
//   sa:operatedByFund (functional, range sa:Fund) — mapped from TS `fundAgentId`
//   sa:roundMandate / sa:milestoneTemplate / sa:validatorRequirements / sa:budget*
//     all xsd:string JSON literals (Audit § 8.2).
//   sa:reportingCadence range sa:ReportingCadence (C-Box scheme: quarterly / milestone / annual / none)
//   sa:requiredCredentials multi-valued
//   sa:addressedApplicants multi-valued (private rounds only; lives in fund's org-mcp ONLY for private rounds — IA § 2.4)
//   sa:proposalsReceived (derived counter)
//
// Persistence model (per docs/information-architecture/10-intent-marketplace-classification.md § 2.4):
//   - Body: `rounds` table in the FUND'S org-mcp tenant (org_principal = fundAgentId).
//   - Public on-chain anchor: `sa:RoundOpenedAssertion` on creation; `sa:RoundClosedAssertion` on close.
//     Public rounds anchor with full mandate-summary fields. Private rounds anchor a
//     coarse assertion (no addressed-applicants list — that stays in fund's org-mcp).
//   - GraphDB mirror via the on-chain → GraphDB sync.
//
// TS field → T-Box predicate mapping:
//   id              → row IRI
//   fundAgentId     → sa:operatedByFund  (functional)
//   mandate         → sa:roundMandate    (JSON literal)
//   milestoneTemplate    → sa:milestoneTemplate
//   validatorRequirements → sa:validatorRequirements
//   reportingCadence → sa:reportingCadence  (range sa:ReportingCadence)
//   deadline        → sa:deadline
//   decisionDate    → sa:decisionDate
//   requiredCredentials → sa:requiredCredentials  (multi-valued)
//   visibility      → sa:visibility
//   addressedApplicants → sa:addressedApplicants  (multi-valued; private rounds only)
//   proposalsReceived → sa:proposalsReceived

export type RoundMandate = {
  acceptedKinds: string[];
  acceptedGeo: string[];
  budgetCeiling: number;
  expectedAwards: number;
};

export type RoundMilestoneTemplate = {
  minMilestones?: number;
  maxMilestones?: number;
  trancheHints?: { atKickoff?: number; midpoint?: number; completion?: number };
};

export type RoundValidatorRequirements = {
  minValidators?: number;
  acceptedValidatorKinds?: string[];
};

/** C-Box `sa:ReportingCadence` values. */
export type ReportingCadence = "quarterly" | "milestone" | "annual" | "none";

export type RoundPriorStats = {
  proposalsReceived: number;
  awarded: number;
  medianAward?: number;
  isFirstCycle: boolean;
};

export type Round = {
  id: string;
  fundAgentId: string; // → sa:operatedByFund (range sa:Fund — i.e., a Pool with governanceModel='fund')
  mandate: RoundMandate;
  milestoneTemplate: RoundMilestoneTemplate;
  validatorRequirements: RoundValidatorRequirements;
  reportingCadence: ReportingCadence;
  deadline: string; // ISO-8601
  decisionDate: string; // ISO-8601
  requiredCredentials: string[];
  visibility: "public" | "private";
  addressedApplicants?: string[]; // private rounds only; never appears in on-chain anchor
  proposalsReceived: number;
  priorStats: RoundPriorStats;
};

export type RoundListFilters = {
  hubId: string;
  domain?: string;
  deadlineHorizon?: "this-week" | "this-month" | "this-quarter" | "all";
  budgetMin?: number;
  budgetMax?: number;
  search?: string;
  includeClosed?: boolean;
  viewerAgentId: string;
  viewerIntentIds?: string[]; // for mandate-match badging
};

export type RoundListItem = Round & {
  matchedIntentIds: string[]; // empty if no match
  warnings: Array<"budget-below-intent" | "deadline-imminent">; // soft signals
};

/**
 * Reads of public rounds come from `@smart-agent/discovery` (the GraphDB public mirror
 * populated by sync from sa:RoundOpenedAssertion / sa:RoundClosedAssertion). For
 * private rounds, the addressedApplicants list lives in the fund's org-mcp only;
 * an addressed applicant queries the fund's org-mcp via a `round:read_addressed_list`
 * cross-delegation issued at round creation (IA § 2.4).
 */
export interface RoundClient {
  list(filters: RoundListFilters): Promise<RoundListItem[]>;
  getById(id: string, viewerAgentId: string): Promise<Round | null>;
}
