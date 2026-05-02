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
