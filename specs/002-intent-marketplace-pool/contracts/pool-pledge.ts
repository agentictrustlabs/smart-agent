// Contract: @smart-agent/sdk/poolPledge
// Phase 1 design artifact for spec 002 — Intent Marketplace (Pool Lane).
// This is the EXPLICIT contract handed to the downstream allocation/disbursement spec
// (per spec.md SC-005). Field shape fixed by Clarifications Q1–Q5.
//
// Persistence model (per docs/information-architecture/10-intent-marketplace-classification.md § 2.2):
//   - Body lives in the DONOR'S MCP (person-mcp or org-mcp), in a `pool_pledges` table.
//   - On-chain `sa:PledgeAssertion` mint is conditional:
//       * pool public + storyPermissions=public                → full assertion (donor IRI + amount + ...)
//       * pool public + storyPermissions=shareWithSupportTeam  → coarse assertion (donor IRI OMITTED)
//       * pool public + storyPermissions=anonymous             → NO anchor (signer linkable; can't anonymize on chain)
//       * pool private (any storyPermissions)                  → NO anchor
//     SHACL `sa:AnonymousPledgeNoAnchorShape` and `sa:PrivatePoolPledgeNoAnchorShape` enforce these.
//   - Pool's `pledgedTotal` aggregate lives in the pool's org-mcp; donor's MCP issues a
//     `pool:contribute_to_total` system-delegation at submit time (IA § 2.2 + § 3.3).
//   - For non-anonymous pledges, donor issues `pool:read_pledge` cross-delegation to the
//     pool's stewards at submit time (scope: that single pool).
//
// TS field → T-Box predicate mapping (Audit § 3 + § 8.2):
//   pledgerAgentId       → sa:pledger
//   poolAgentId          → sa:targetPool
//   cadence              → sa:pledgeCadence  (range sa:PledgeCadence)
//   unit                 → sa:pledgeUnit
//   amount               → sa:pledgeAmount
//   duration             → sa:pledgeDuration
//   restrictions         → sa:pledgeRestrictions
//   storyPermissions     → sa:storyPermissions  (range sa:StoryPermission)
//   pledgedAt            → sa:pledgedAt  (subPropertyOf prov:generatedAtTime)
//   stoppedAt            → sa:stoppedAt
//   status               → sa:pledgeStatus  (range sa:PledgePoolStatus)
//   history              → sa:pledgeHistory  (JSON literal)
//   onChainAssertionId   → sa:onChainAssertionId

export type PledgeCadence = "one-time" | "monthly" | "annual";
export type PledgeStoryPermission =
  | "public"
  | "shareWithSupportTeam"
  | "anonymous";

export type PledgeStatus =
  | "active"
  | "waitlisted"
  | "stopped"
  | "auto-stopped"
  | "fulfilled"; // discovery never sets 'fulfilled'; downstream allocation/disbursement does

export type PledgeRestrictions = {
  kinds?: string[];
  geoRoots?: string[];
  notForAdmin?: boolean;
  notForDiscretionary?: boolean;
};

export type PledgeAmendmentKind = "amount" | "cadence" | "duration";

/**
 * Documentation-only in T-Box (sa:PledgeAmendment is described, not reified — Audit § 8.1).
 * Embedded as a JSON literal in the pledge's `sa:pledgeHistory`.
 */
export type PledgeAmendment = {
  kind: PledgeAmendmentKind;
  prevValue: number | string; // amount: number; cadence: string; duration: number
  newValue: number | string;
  amendedAt: string; // ISO-8601
  windowResetAt?: string; // set on cadence/duration amendments per Q4
};

/** Privacy tier; cascades from pool visibility + storyPermissions (IA § 2.2 matrix). */
export type PledgeVisibility = "public" | "public-coarse" | "private";

export type PoolPledge = {
  id: string;
  pledgerAgentId: string;
  poolAgentId: string;
  cadence: PledgeCadence;
  unit: string; // must be ∈ pool.acceptedUnits (Q1)
  amount: number;
  duration?: number; // months for monthly, years for annual; undefined for one-time
  restrictions?: PledgeRestrictions;
  storyPermissions: PledgeStoryPermission;
  pledgedAt: string; // ISO-8601
  stoppedAt?: string; // ISO-8601; bright line for Q5
  status: PledgeStatus;
  history: PledgeAmendment[];
  visibility: PledgeVisibility; // derived at write time per IA § 2.2 matrix
  onChainAssertionId?: string; // present iff anchored on chain
};

export type SubmitPledgeRequest = Omit<
  PoolPledge,
  | "id"
  | "pledgedAt"
  | "stoppedAt"
  | "status"
  | "history"
  | "visibility"
  | "onChainAssertionId"
>;

export type AmendPledgeRequest = {
  pledgeId: string;
  change:
    | { kind: "amount"; newValue: number }
    | { kind: "cadence"; newValue: PledgeCadence }
    | { kind: "duration"; newValue: number };
};

export type SubmitPledgeError =
  | { kind: "unit-not-accepted"; allowedUnits: string[] }
  | { kind: "restriction-not-accepted"; allowedRestrictions: PledgeRestrictions }
  | { kind: "ceiling-blocked"; remainingCapacity: number }
  | { kind: "private-pool-not-addressed" }
  | { kind: "validation"; messages: string[] };

export type SubmitPledgeResult =
  | { ok: true; pledge: PoolPledge; status: "active" | "waitlisted" }
  | { ok: false; error: SubmitPledgeError };

/**
 * Routes writes through the donor's MCP (`pool_pledge:submit` tool); routes reads
 * through the donor's MCP for self / through the pool's org-mcp + `pool:read_pledge`
 * cross-delegation for steward views.
 *
 * Delegation scopes (added to the catalog by Security agent before tools land):
 *   - pool_pledge:submit                  (donor's session OR delegation; v1 forbids connector mode, FR-023)
 *   - pool_pledge:amend                   (donor only)
 *   - pool_pledge:stop                    (donor only)
 *   - pool_pledge:read_self               (donor only by default)
 *   - pool:read_pledge                    (cross — scope: one pool — donor issues at submit time when storyPermissions != 'anonymous')
 *   - pool:contribute_to_total            (system — donor's MCP issues to pool's org-mcp on submit)
 */
export interface PoolPledgeClient {
  submit(req: SubmitPledgeRequest): Promise<SubmitPledgeResult>;
  getById(id: string): Promise<PoolPledge | null>;
  listForMember(agentId: string): Promise<PoolPledge[]>;
  amend(req: AmendPledgeRequest): Promise<PoolPledge>;
  stop(pledgeId: string): Promise<PoolPledge>;
}

/** Pure helper: cadence-aware total, used by capacity widgets. */
export function cadenceAwareTotal(p: PoolPledge): number;
