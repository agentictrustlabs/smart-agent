/**
 * Intent-Marketplace Delegation Scopes
 *
 * Well-known scope strings for the three intent-marketplace lanes
 * (specs 001 / 002 / 003). Each scope corresponds to:
 *   1. An MCP tool name (the existing MCP_TOOL_SCOPE_ENFORCER gates on
 *      tool name, so scope-string === tool-name keeps the model uniform).
 *   2. A documented purpose (what the caller is authorized to do).
 *   3. An intended caller / target pattern (system / cross / user).
 *
 * The "system" pattern is a cross-principal delegation where the caller
 * is another agent's MCP (not the human user) — used for primitive
 * operations like incrementing acknowledgement counts on intents the
 * caller does not own. The "cross" pattern is a per-instance grant
 * issued by a data owner to a specific reader (e.g., a steward reading
 * a specific proposal).
 *
 * See docs/information-architecture/10-intent-marketplace-classification.md
 * § 2.x for the per-entity delegation gates.
 */

// ---------------------------------------------------------------------------
// Scope kind
// ---------------------------------------------------------------------------

export type ScopeKind =
  /** Caller authenticates as the data owner (session delegation). */
  | 'user'
  /** Caller is another principal's MCP, calling on behalf of system bookkeeping. */
  | 'system'
  /** Caller is granted access to ANOTHER principal's data via a per-instance grant. */
  | 'cross'

// ---------------------------------------------------------------------------
// Scope catalog
// ---------------------------------------------------------------------------

export interface ScopeDescriptor {
  /** Canonical scope string (also the MCP tool name). */
  scope: string
  /** Plain-English description. */
  description: string
  /** Who issues + who receives. */
  kind: ScopeKind
  /** Which spec introduced this scope. */
  spec: '001' | '002' | '003'
}

/**
 * Spec 001 — Direct lane.
 */
export const SPEC_001_SCOPES = {
  /** Initiator's MCP creates a MatchInitiation row. User delegation. */
  match_initiation_create: {
    scope: 'match_initiation:create',
    description: 'Create a MatchInitiation row in the initiator MCP.',
    kind: 'user',
    spec: '001',
  },
  /** List one's own MatchInitiations. User delegation. */
  match_initiation_read: {
    scope: 'match_initiation:read',
    description: "List the caller's own MatchInitiations (filterable by intent).",
    kind: 'user',
    spec: '001',
  },
  /**
   * System-delegation: increment an intent's liveAcknowledgementCount when
   * a downstream artifact (MatchInitiation, GrantProposal) creates a pending
   * acknowledgement against it. Issued by the artifact-creator's MCP to the
   * intent owner's MCP. Used by spec 001 + spec 003.
   */
  intent_bump_ack_count: {
    scope: 'intent:bump_ack_count',
    description: 'Increment or decrement live_acknowledgement_count on an intent.',
    kind: 'system',
    spec: '001',
  },
  /**
   * System-delegation: deliver a notification to an agent. Used by spec 001
   * (connector-mode match notification to both intent expressers).
   */
  notifications_create: {
    scope: 'notifications:create',
    description: 'Create a notification on the target principal.',
    kind: 'system',
    spec: '001',
  },
} as const satisfies Record<string, ScopeDescriptor>

/**
 * Spec 002 — Pool lane.
 */
export const SPEC_002_SCOPES = {
  pool_pledge_submit: {
    scope: 'pool_pledge:submit',
    description: "Create a PoolPledge in the donor's MCP.",
    kind: 'user',
    spec: '002',
  },
  pool_pledge_amend: {
    scope: 'pool_pledge:amend',
    description: 'Amend a PoolPledge (amount / cadence / duration; appends to history).',
    kind: 'user',
    spec: '002',
  },
  pool_pledge_stop: {
    scope: 'pool_pledge:stop',
    description: 'Stop a recurring PoolPledge (sets stoppedAt).',
    kind: 'user',
    spec: '002',
  },
  /**
   * System-delegation: contribute (signed delta) to the pool's pledgedTotal
   * aggregate. Issued by donor's MCP to pool's org-mcp on submit / amend / stop.
   */
  pool_contribute_to_total: {
    scope: 'pool:contribute_to_total',
    description: "Apply a signed delta to the pool's pledgedTotal aggregate counter.",
    kind: 'system',
    spec: '002',
  },
  /**
   * System-delegation: auto-stop a pledge when its underlying pool transitions
   * to closed/withdrawn. Issued by pool steward's MCP to pledger's MCP.
   */
  pool_pledge_auto_stop: {
    scope: 'pool_pledge:auto_stop',
    description: 'Mark a pledge as auto-stopped (consequence of pool closure / withdrawal).',
    kind: 'system',
    spec: '002',
  },
  /**
   * Cross-delegation: pool stewards can read pledge bodies routed at submit time
   * (or later via grant) for stewardship review.
   */
  pool_read_pledge: {
    scope: 'pool:read_pledge',
    description: 'Read a pledge body (private fields) for stewardship review.',
    kind: 'cross',
    spec: '002',
  },
} as const satisfies Record<string, ScopeDescriptor>

/**
 * Spec 003 — Proposal lane.
 */
export const SPEC_003_SCOPES = {
  grant_proposal_submit: {
    scope: 'grant_proposal:submit',
    description: "Create a GrantProposal in the proposer's MCP.",
    kind: 'user',
    spec: '003',
  },
  grant_proposal_edit_pre_deadline: {
    scope: 'grant_proposal:edit_pre_deadline',
    description: 'Edit a submitted GrantProposal while the round is still open.',
    kind: 'user',
    spec: '003',
  },
  grant_proposal_withdraw: {
    scope: 'grant_proposal:withdraw',
    description: "Withdraw a GrantProposal; flips state, decrements round counter, decrements intent ack-count.",
    kind: 'user',
    spec: '003',
  },
  grant_proposal_clone: {
    scope: 'grant_proposal:clone',
    description: 'Clone a GrantProposal as a fresh draft (new id, no carry-over of outcomes/awards).',
    kind: 'user',
    spec: '003',
  },
  /**
   * Cross-delegation: stewards of the round / fund can read the proposal body
   * for review. Issued by proposer's MCP at submit-time, scoped to one round
   * (or fund mandate for open-call), time-bound until terminal state.
   */
  proposal_read_for_review: {
    scope: 'proposal:read_for_review',
    description: 'Read a GrantProposal body for stewardship review.',
    kind: 'cross',
    spec: '003',
  },
  /**
   * System-delegation: increment a round's proposalsReceived counter on submit;
   * decrement on withdraw. Issued by proposer's MCP to fund's org-mcp.
   */
  round_increment_proposals_received: {
    scope: 'round:increment_proposals_received',
    description: "Apply a signed delta to a round's proposalsReceived counter.",
    kind: 'system',
    spec: '003',
  },
  /**
   * Cross-delegation: a private round's addressed-applicants list is held in
   * the fund's org-mcp; potential applicants need a read grant before they
   * can browse the round's eligibility detail.
   */
  round_read_addressed_list: {
    scope: 'round:read_addressed_list',
    description: "Read a private round's addressed-applicants list.",
    kind: 'cross',
    spec: '003',
  },
} as const satisfies Record<string, ScopeDescriptor>

// ---------------------------------------------------------------------------
// Aggregated catalog + lookups
// ---------------------------------------------------------------------------

export const MARKETPLACE_SCOPES = {
  ...SPEC_001_SCOPES,
  ...SPEC_002_SCOPES,
  ...SPEC_003_SCOPES,
} as const

export type MarketplaceScopeKey = keyof typeof MARKETPLACE_SCOPES
export type MarketplaceScopeString = (typeof MARKETPLACE_SCOPES)[MarketplaceScopeKey]['scope']

const SCOPE_BY_STRING = new Map<string, ScopeDescriptor>(
  Object.values(MARKETPLACE_SCOPES).map((s) => [s.scope, s]),
)

/** Look up a scope descriptor by its canonical string (also the MCP tool name). */
export function findScope(scope: string): ScopeDescriptor | undefined {
  return SCOPE_BY_STRING.get(scope)
}

/** True iff `scope` is a registered marketplace scope. Catches typos at runtime. */
export function isMarketplaceScope(scope: string): boolean {
  return SCOPE_BY_STRING.has(scope)
}

/** All scope strings of a given kind. */
export function scopesOfKind(kind: ScopeKind): ScopeDescriptor[] {
  return Object.values(MARKETPLACE_SCOPES).filter((s) => s.kind === kind)
}

/** All scope strings registered for a given spec. */
export function scopesForSpec(spec: '001' | '002' | '003'): ScopeDescriptor[] {
  return Object.values(MARKETPLACE_SCOPES).filter((s) => s.spec === spec)
}
