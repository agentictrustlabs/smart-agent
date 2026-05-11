import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// ─── Auth foundation (mirror of person-mcp) ────────────────────────────────

// org_accounts dropped: org agents are canonical on-chain via AgentRegistry +
// AgentAccountResolver, mirrored to GraphDB. No org-mcp tool reads this table.

export const orgTokenUsage = sqliteTable('org_token_usage', {
  jti: text('jti').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  usageCount: integer('usage_count').notNull().default(1),
  usageLimit: integer('usage_limit').notNull(),
  firstUsedAt: text('first_used_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
})

// ─── Org core ─────────────────────────────────────────────────────────────

// Public org profile fields (name, logo, public website, public description)
// are anchored ON-CHAIN as agent metadata. This table holds ONLY private fields.
export const orgProfilesPrivate = sqliteTable('org_profiles_private', {
  orgPrincipal: text('org_principal').primaryKey(),
  internalContactEmail: text('internal_contact_email'),
  internalContactPhone: text('internal_contact_phone'),
  financialContacts: text('financial_contacts'),  // JSON
  internalNotes: text('internal_notes'),
  updatedAt: text('updated_at').notNull(),
})

// org_members dropped: roster data is canonical on-chain in AgentRelationship
// edges; web reads via DiscoveryService.getOutgoingEdges. Private annotations
// (internal notes per member) had zero callers; detached_members below remains
// for off-roster external personnel that have no on-chain presence.

export const detachedMembers = sqliteTable('detached_members', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  displayName: text('display_name').notNull(),
  contactInfoEncrypted: text('contact_info_encrypted'),
  trackedSince: text('tracked_since'),
  notes: text('notes'),
  assignedNodeId: text('assigned_node_id'),
  role: text('role'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
})

// ─── Business data ────────────────────────────────────────────────────────

export const revenueReports = sqliteTable('revenue_reports', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  period: text('period').notNull(),                  // YYYY-MM
  grossRevenue: integer('gross_revenue'),
  expenses: integer('expenses'),
  netRevenue: integer('net_revenue'),
  sharePayment: integer('share_payment'),
  currency: text('currency').notNull().default('XOF'),
  notes: text('notes'),
  evidenceUri: text('evidence_uri'),
  status: text('status').notNull().default('submitted'),  // submitted | verified | disputed
  submittedBy: text('submitted_by'),
  submittedAt: text('submitted_at').notNull(),
  verifiedBy: text('verified_by'),
  verifiedAt: text('verified_at'),
})

// proposals dropped: legacy off-chain governance cache predating spec-003.
// Superseded by proposal_submissions (GrantProposal body, IA § 2.3).

export const orgActivityLogEntries = sqliteTable('org_activity_log_entries', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  kind: text('kind').notNull(),
  performedAt: text('performed_at').notNull(),
  performedByAgent: text('performed_by_agent'),
  durationMin: integer('duration_min'),
  geo: text('geo'),
  participants: text('participants'),                // JSON array
  fulfillsEntitlementId: text('fulfills_entitlement_id'),
  fulfillsNeedId: text('fulfills_need_id'),
  fulfillsIntentId: text('fulfills_intent_id'),
  payload: text('payload'),
  evidenceUri: text('evidence_uri'),
  createdAt: text('created_at').notNull(),
})

export const orgIntents = sqliteTable('org_intents', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  direction: text('direction').notNull(),
  visibility: text('visibility').notNull().default('private'),
  kind: text('kind').notNull(),
  addressedTo: text('addressed_to'),
  summary: text('summary').notNull(),
  context: text('context'),
  status: text('status').notNull().default('expressed'),
  priority: text('priority'),
  expiresAt: text('expires_at'),
  onChainAssertionId: text('on_chain_assertion_id'),
  // liveAcknowledgementCount — incremented when a downstream artifact (e.g.,
  // sa:MatchInitiation per spec 001, sa:GrantProposal per spec 003) creates
  // a 'pending' acknowledgement against this intent; decremented on withdraw.
  // Drives the FR-023 invariant: intent reverts to 'expressed' iff this hits 0.
  // See docs/information-architecture/10-intent-marketplace-classification.md § 3.10.
  liveAcknowledgementCount: integer('live_acknowledgement_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const orgNeeds = sqliteTable('org_needs', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  intentId: text('intent_id').notNull(),
  kind: text('kind').notNull(),
  requirements: text('requirements'),
  status: text('status').notNull().default('open'),
  visibility: text('visibility').notNull().default('private'),
  geo: text('geo'),
  capacityNeeded: integer('capacity_needed'),
  onChainAssertionId: text('on_chain_assertion_id'),
  createdAt: text('created_at').notNull(),
})

export const orgOfferings = sqliteTable('org_offerings', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  intentId: text('intent_id').notNull(),
  kind: text('kind').notNull(),
  capabilities: text('capabilities'),
  capacity: integer('capacity'),
  visibility: text('visibility').notNull().default('private'),
  geo: text('geo'),
  timeWindow: text('time_window'),
  onChainAssertionId: text('on_chain_assertion_id'),
  createdAt: text('created_at').notNull(),
})

export const orgOutcomes = sqliteTable('org_outcomes', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  intentId: text('intent_id').notNull(),
  metric: text('metric').notNull(),
  target: text('target'),
  achieved: integer('achieved').notNull().default(0),
  achievedAt: text('achieved_at'),
  createdAt: text('created_at').notNull(),
})

// orchestration_plans dropped: defined but never written or read anywhere.

export const orgWorkItems = sqliteTable('org_work_items', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),     // assignee
  entitlementId: text('entitlement_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  dueAt: text('due_at'),
  status: text('status').notNull().default('open'),
  resolvedAt: text('resolved_at'),
  resolvedByActivityId: text('resolved_by_activity_id'),
  createdAt: text('created_at').notNull(),
})

export const orgNotifications = sqliteTable('org_notifications', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  kind: text('kind').notNull(),
  payload: text('payload'),
  readAt: text('read_at'),
  createdAt: text('created_at').notNull(),
})

export const orgBeliefs = sqliteTable('org_beliefs', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  statement: text('statement').notNull(),
  tags: text('tags'),
  informsIntentId: text('informs_intent_id'),
  visibility: text('visibility').notNull().default('private'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const orgCrossDelegationGrants = sqliteTable('org_cross_delegation_grants', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  granteeAgent: text('grantee_agent').notNull(),
  scope: text('scope').notNull(),
  validFrom: text('valid_from'),
  validUntil: text('valid_until'),
  caveatTerms: text('caveat_terms'),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
})

// ─── Spec 004 v2: proposal_submissions DROPPED ────────────────────────────
// Submitted proposals are authoritative on chain in `GrantProposalRegistry`.
// Drafts (status='draft') stay in person-mcp's own proposal_submissions
// table; org-mcp doesn't carry draft state. Readers that previously joined
// against this table (rounds.ts counter, proposalVotes.ts tally filter)
// now stub-return until the on-chain → GraphDB sync (R8) lands.

// Round body lives in the FUND'S org-mcp tenant (per IA § 2.4). Rounds are
// pre-seeded for spec 003 (round authoring is out of scope); this is the
// canonical body for a Round lives on chain in FundRegistry's own
// typed-attribute storage. This row is a denormalized cache used by the
// proposal-flow
// hot path (validation, addressed-applicants lookup) plus the proposalsReceived
// counter (high-frequency aggregate, IA P4 § 8.2).
// Round body lives ON-CHAIN in FundRegistry (mandate, milestone_template,
// validator_requirements, reporting_cadence, deadline, decision_date,
// required_credentials, visibility, status, fund_agent_id) — read via
// FundRegistry getters, mirrored to GraphDB by the on-chain → KB sync.
// addressed_applicants stays MCP-side (visibility-qualifier list, never
// mirrored). proposals_received is derived as
// COUNT(proposal_submissions WHERE round_id = round) at read time.
//
// What stays here: voting config (off-chain DAO governance), keyed by round id.
export const rounds = sqliteTable('rounds', {
  id: text('id').primaryKey(),
  votingStrategy: text('voting_strategy').notNull().default('steward-quorum'),
  votingThreshold: integer('voting_threshold').notNull().default(2),
  votingWindowStartsAt: text('voting_window_starts_at'),
  votingWindowEndsAt: text('voting_window_ends_at'),
  eligibleVoters: text('eligible_voters').notNull().default('{"kind":"stewards"}'),
  updatedAt: text('updated_at').notNull(),
})

// ─── Disbursements (Sprint C) ─────────────────────────────────────────
// Per-tranche records of grant disbursements. Created when a round is
// finalized (one row per award, then split into milestone tranches as the
// proposer hits delivery checkpoints). Status flow:
//   pending → claimed (proposer requested payout) → paid (real transfer
//   recorded in v2; v1 stub flips to paid immediately on claim).
// Real ERC-20 USDC custody lives in Treasury Phase 3; this is the off-chain
// ledger that mirrors what would otherwise happen on chain.
export const disbursements = sqliteTable('disbursements', {
  id: text('id').primaryKey(),                                  // uuid
  proposalId: text('proposal_id').notNull(),                    // urn:smart-agent:grant-proposal:<slug>
  roundId: text('round_id').notNull(),
  trancheLabel: text('tranche_label').notNull(),                // 'Cohort 1 onboarded', 'Mid-cohort'
  amount: integer('amount').notNull(),                          // in unit (USD by default)
  unit: text('unit').notNull().default('USD'),
  recipientAgentId: text('recipient_agent_id').notNull(),       // proposer or designated recipient
  status: text('status').notNull().default('pending'),          // pending | claimed | paid | revoked
  claimedAt: text('claimed_at'),
  paidAt: text('paid_at'),
  txHash: text('tx_hash'),                                      // future: USDC transfer tx
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ─── Outcome attestations (Sprint C) ─────────────────────────────────
// Validators (or stewards acting as validators in v1) record milestone
// delivery against awarded proposals. Multiple attestations per milestone
// are allowed — `disputed` outcomes win over `delivered` per dispute rules.
// On-chain mirror is sa:OutcomeAttestationAssertion (Phase 0 § 6 — kept
// as event-style class assertion).
export const outcomeAttestations = sqliteTable('outcome_attestations', {
  id: text('id').primaryKey(),                                  // uuid
  proposalId: text('proposal_id').notNull(),
  milestoneLabel: text('milestone_label').notNull(),            // matches proposal.milestones[i].name
  validatorAgentId: text('validator_agent_id').notNull(),
  status: text('status', { enum: ['delivered', 'partial', 'disputed', 'overdue'] }).notNull(),
  evidence: text('evidence'),                                   // free-text or URI
  attestedAt: text('attested_at').notNull(),
  createdAt: text('created_at').notNull(),
})

// ─── Spec 004 v2: proposal_votes DROPPED ──────────────────────────────────
// Ballots are authoritative on chain in `VoteRegistry`. Vote uniqueness =
// (roundSubject, proposalSubject, nullifier); the same voter can cast on
// many proposals in a round, one ballot per proposal. Read tools
// (`vote:list_for_*`, `vote:tally_for_round`) stub to empty until the
// on-chain → GraphDB sync (R8) lands.

// ─── Spec 004 v2: match_initiations DROPPED ───────────────────────────────
// MatchInitiation bodies are authoritative on chain in
// `MatchInitiationRegistry`. The org-mcp `match_initiation:read` tool
// stubs to empty until R8 (GraphDB sync); web/Discovery readers should
// scan the registry's events for the viewed/candidate intents.

// ─── Spec 002: Intent Marketplace — Pool Lane (Phase 0.3 — counters + cache) ─
// Pool *body* (mandate, governance model, etc.) is the source-of-truth on
// chain in PoolRegistry's own typed-attribute storage. This table holds the
// high-frequency aggregate counters (per IA P4 § 8.2) AND a denormalized
// body cache for the pledge-time validation hot path — the donor's
// poolPledge:submit handler reads accepted units, restrictions, and capacity
// to gate the pledge BEFORE writing it. We refresh this cache from the
// action layer when the on-chain registry mutates.
//
// pools table DROPPED. Pool body lives on-chain in PoolRegistry (treasury =
// pool agent address itself; mandate/units/kinds/ceiling/visibility/stewards
// in typed-attrs; slug for IRI derivation). Web/MCP readers should call
// PoolRegistry getters or DiscoveryService.getPoolDetail. Counters
// (pledged/allocated/available) are derived from pool_pledges sums at read
// time. addressed_members stays MCP-side as a visibility filter — but no
// reader of this column existed when audited; reintroduce a slim table only
// if a real product need surfaces.

// ─── Spec 004 v2: pool_pledges DROPPED ────────────────────────────────────
// Pledges are authoritative on chain in `PledgeRegistry`. Pool counters
// (pledgedTotal/allocatedTotal/availableTotal) become event-scan derivations
// once R8 (on-chain → GraphDB sync) lands; until then `getPoolCounters`
// returns zeros so the pool detail page can render without crashing.

// ─── Engagement provider-side state ────────────────────────────────────────

export const engagementProviderState = sqliteTable('engagement_provider_state', {
  entitlementId: text('entitlement_id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  capacityRemaining: integer('capacity_remaining'),
  providerNotes: text('provider_notes'),
  internalAssignee: text('internal_assignee'),
  updatedAt: text('updated_at').notNull(),
})

export const engagementSessions = sqliteTable('engagement_sessions', {
  id: text('id').primaryKey(),
  entitlementId: text('entitlement_id').notNull(),
  orgPrincipal: text('org_principal').notNull(),
  scheduledAt: text('scheduled_at'),
  occurredAt: text('occurred_at'),
  status: text('status').notNull().default('scheduled'),
  notes: text('notes'),
})

export const engagementTranches = sqliteTable('engagement_tranches', {
  id: text('id').primaryKey(),
  entitlementId: text('entitlement_id').notNull(),
  orgPrincipal: text('org_principal').notNull(),
  scheduledAt: text('scheduled_at'),
  amountCents: integer('amount_cents'),
  currency: text('currency').notNull().default('XOF'),
  status: text('status').notNull().default('pending'),
  releasedAt: text('released_at'),
  gatedOnReportId: text('gated_on_report_id'),
})

export const engagementPolicies = sqliteTable('engagement_policies', {
  id: text('id').primaryKey(),
  entitlementId: text('entitlement_id').notNull(),
  orgPrincipal: text('org_principal').notNull(),
  policyType: text('policy_type').notNull(),
  documentUri: text('document_uri'),
  version: text('version'),
  signaturesRequired: integer('signatures_required').notNull().default(1),
  createdAt: text('created_at').notNull(),
})

export const policySigners = sqliteTable('policy_signers', {
  id: text('id').primaryKey(),
  policyId: text('policy_id').notNull(),
  signerAgent: text('signer_agent').notNull(),
  role: text('role'),
  signedAt: text('signed_at'),
})
