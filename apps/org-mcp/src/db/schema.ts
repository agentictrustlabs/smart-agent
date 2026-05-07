import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// ─── Auth foundation (mirror of person-mcp) ────────────────────────────────

export const orgAccounts = sqliteTable('org_accounts', {
  orgPrincipal: text('org_principal').primaryKey(),
  accountAddress: text('account_address').notNull().unique(),
  chainId: integer('chain_id').notNull(),
  label: text('label'),
  createdAt: text('created_at').notNull(),
})

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

export const orgMembers = sqliteTable('org_members', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  memberAgent: text('member_agent').notNull(),
  role: text('role'),
  joinedAt: text('joined_at'),
  leftAt: text('left_at'),
  edgeId: text('edge_id'),  // on-chain edge that anchors the membership
  internalNotes: text('internal_notes'),
})

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

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  kind: text('kind').notNull(),                       // pause-capital | graduate-wave | ...
  title: text('title').notNull(),
  description: text('description'),
  proposerAgent: text('proposer_agent'),
  targetAddress: text('target_address'),
  quorumRequired: integer('quorum_required').notNull().default(2),
  votesFor: integer('votes_for').notNull().default(0),
  votesAgainst: integer('votes_against').notNull().default(0),
  status: text('status').notNull().default('open'),
  onChainProposalId: text('on_chain_proposal_id'),
  executedAt: text('executed_at'),
  createdAt: text('created_at').notNull(),
})

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

export const orchestrationPlans = sqliteTable('orchestration_plans', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  parentIntentId: text('parent_intent_id').notNull(),
  subIntents: text('sub_intents'),                   // JSON
  dependencies: text('dependencies'),                 // JSON
  createdAt: text('created_at').notNull(),
})

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

// ─── Spec 003: Intent Marketplace — Proposal Lane ─────────────────────────
// Body of `sa:GrantProposal` (per IA § 2.3) — always private, never anchored
// on chain in v1, never mirrored to GraphDB. SHACL
// `sa:GrantProposalAlwaysPrivateShape` enforces the no-anchor invariant.
// Steward read access flows through a `proposal:read_for_review`
// cross-delegation issued at submit time (see packages/sdk/src/marketplace-scopes.ts).
export const proposalSubmissions = sqliteTable('proposal_submissions', {
  id: text('id').primaryKey(),
  // = proposerAgentId (org-mcp tenancy column; per IA § 2.3 "principal").
  // Org proposers are the common case; tenancy column kept as `principal`
  // (NOT `org_principal`) per the IA classification doc's column naming.
  principal: text('principal').notNull(),
  roundId: text('round_id'),                                    // null for open-call (Q5)
  fundMandateId: text('fund_mandate_id'),                       // required when roundId is null
  basedOnIntentId: text('based_on_intent_id').notNull(),
  budget: text('budget').notNull(),                             // JSON: { lineItems[], total }
  plan: text('plan').notNull(),                                 // JSON: { narrative, planArtifactRef? }
  milestones: text('milestones').notNull(),                     // JSON array
  desiredOutcomes: text('desired_outcomes').notNull(),          // JSON array
  reportingObligations: text('reporting_obligations').notNull(),// JSON: { cadence, format }
  organisationalBackground: text('organisational_background').notNull(), // JSON
  submittedAt: text('submitted_at'),                            // ISO-8601; null while draft
  version: integer('version').notNull().default(0),
  lastEditedAt: text('last_edited_at').notNull(),
  status: text('status').notNull().default('draft'),            // draft|submitted|withdrawn|awarded|declined
  withdrawnAt: text('withdrawn_at'),
  clonedFromProposalId: text('cloned_from_proposal_id'),
  basis: text('basis'),                                         // JSON: RankBasis snapshot at submit time
  visibility: text('visibility').notNull().default('private'),  // ALWAYS 'private' (SHACL backstop)
  createdAt: text('created_at').notNull(),
})

// Round body lives in the FUND'S org-mcp tenant (per IA § 2.4). Rounds are
// pre-seeded for spec 003 (round authoring is out of scope); this is the
// canonical body for a Round lives on chain in FundRegistry's own
// typed-attribute storage. This row is a denormalized cache used by the
// proposal-flow
// hot path (validation, addressed-applicants lookup) plus the proposalsReceived
// counter (high-frequency aggregate, IA P4 § 8.2).
export const rounds = sqliteTable('rounds', {
  id: text('id').primaryKey(),
  fundAgentId: text('fund_agent_id').notNull(),                 // = fund's agent address
  mandate: text('mandate').notNull().default('{}'),             // JSON: RoundMandate (cache)
  milestoneTemplate: text('milestone_template').notNull().default('{}'),
  validatorRequirements: text('validator_requirements').notNull().default('{}'),
  reportingCadence: text('reporting_cadence').notNull(),        // sa:CadenceQuarterly|...
  deadline: text('deadline').notNull(),                         // ISO-8601
  decisionDate: text('decision_date').notNull(),                // ISO-8601
  requiredCredentials: text('required_credentials').notNull().default('[]'),
  visibility: text('visibility').notNull().default('public'),   // public|private
  addressedApplicants: text('addressed_applicants'),            // JSON array; null for public rounds
  status: text('status').notNull().default('open'),             // mirror of on-chain status
  // Aggregate counters
  proposalsReceived: integer('proposals_received').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ─── Spec 001: Intent Marketplace — Direct Lane ────────────────────────────
// match_initiations — body of `sa:MatchInitiation` (initiator-owned per IA § 2.1).
// org-mcp twin of person-mcp's `match_initiations` table; tenancy column kept
// as `principal` (NOT `org_principal`) to match the IA classification doc and
// the contract's `principal === initiatorAgentId` invariant. The `principal`
// here is the initiator's on-chain agent address (lowercased) when the
// initiator is an org.
export const matchInitiations = sqliteTable('match_initiations', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),                   // = initiatorAgentId
  viewedIntentId: text('viewed_intent_id').notNull(),
  candidateIntentId: text('candidate_intent_id').notNull(),
  initiatorAgentId: text('initiator_agent_id').notNull(),   // redundant mirror of principal
  initiationKind: text('initiation_kind').notNull(),        // 'self' | 'connector'
  proposedAt: text('proposed_at').notNull(),
  basis: text('basis').notNull(),                           // JSON: RankBasis snapshot
  status: text('status').notNull().default('pending'),
  visibility: text('visibility').notNull().default('private'),
  onChainAssertionId: text('on_chain_assertion_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ─── Spec 002: Intent Marketplace — Pool Lane (Phase 0.3 — counters + cache) ─
// Pool *body* (mandate, governance model, etc.) is the source-of-truth on
// chain in PoolRegistry's own typed-attribute storage. This table holds the
// high-frequency aggregate counters (per IA P4 § 8.2) AND a denormalized
// body cache for the pledge-time validation hot path — the donor's
// poolPledge:submit handler reads accepted units, restrictions, and capacity
// to gate the pledge BEFORE writing it. We refresh this cache from the
// action layer when the on-chain registry mutates.
//
// `id` is the canonical pool IRI (`urn:smart-agent:pool:<slug>`).
// `treasuryAddress` is the pool agent's smart-account address.
export const pools = sqliteTable('pools', {
  id: text('id').primaryKey(),                                  // = pool IRI
  treasuryAddress: text('treasury_address').notNull(),          // = pool's agent address
  name: text('name').notNull(),
  // Denormalized body cache — refreshed from chain by the action layer.
  acceptedRestrictions: text('accepted_restrictions').notNull().default('{}'),
  acceptedUnits: text('accepted_units').notNull().default('[]'),
  capacityCeiling: integer('capacity_ceiling'),
  ceilingPolicy: text('ceiling_policy').notNull().default('accept'),
  visibility: text('visibility').notNull().default('public'),
  addressedMembers: text('addressed_members'),                  // JSON array; null for public
  stewards: text('stewards').notNull().default('[]'),           // JSON array of agent IRIs
  // Aggregate counters (canonical home per IA P4 § 8.2).
  pledgedTotal: integer('pledged_total').notNull().default(0),
  allocatedTotal: integer('allocated_total').notNull().default(0),
  availableTotal: integer('available_total').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// pool_pledges — org-mcp twin of person-mcp's pool_pledges (orgs can also
// donate). principal = pledgerAgentId.
export const poolPledges = sqliteTable('pool_pledges', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),                       // = pledgerAgentId
  poolAgentId: text('pool_agent_id').notNull(),
  cadence: text('cadence').notNull(),
  unit: text('unit').notNull(),
  amount: integer('amount').notNull(),
  duration: integer('duration'),
  restrictions: text('restrictions'),
  storyPermissions: text('story_permissions').notNull(),
  pledgedAt: text('pledged_at').notNull(),
  stoppedAt: text('stopped_at'),
  status: text('status').notNull().default('active'),
  history: text('history').notNull().default('[]'),
  visibility: text('visibility').notNull().default('private'),
  onChainAssertionId: text('on_chain_assertion_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

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
