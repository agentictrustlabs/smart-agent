/**
 * Spec 007 Phase F.2.1 — Org-MCP Postgres schema (pgTable mirror).
 *
 * Parallel to `schema.ts` (sqliteTable). The two schemas describe the
 * SAME logical tables. Adding a column: edit BOTH files, then re-run
 *   `pnpm --filter @smart-agent/org-mcp exec drizzle-kit generate`.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core'

export const orgTokenUsage = pgTable('org_token_usage', {
  jti: text('jti').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  usageCount: integer('usage_count').notNull().default(1),
  usageLimit: integer('usage_limit').notNull(),
  firstUsedAt: timestamp('first_used_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull(),
})

export const orgProfilesPrivate = pgTable('org_profiles_private', {
  orgPrincipal: text('org_principal').primaryKey(),
  internalContactEmail: text('internal_contact_email'),
  internalContactPhone: text('internal_contact_phone'),
  financialContacts: text('financial_contacts'),
  internalNotes: text('internal_notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const detachedMembers = pgTable('detached_members', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  displayName: text('display_name').notNull(),
  contactInfoEncrypted: text('contact_info_encrypted'),
  trackedSince: text('tracked_since'),
  notes: text('notes'),
  assignedNodeId: text('assigned_node_id'),
  role: text('role'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const revenueReports = pgTable('revenue_reports', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  period: text('period').notNull(),
  grossRevenue: integer('gross_revenue'),
  expenses: integer('expenses'),
  netRevenue: integer('net_revenue'),
  sharePayment: integer('share_payment'),
  currency: text('currency').notNull().default('XOF'),
  notes: text('notes'),
  evidenceUri: text('evidence_uri'),
  status: text('status').notNull().default('submitted'),
  submittedBy: text('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
  verifiedBy: text('verified_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
})

export const orgActivityLogEntries = pgTable('org_activity_log_entries', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  kind: text('kind').notNull(),
  performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
  performedByAgent: text('performed_by_agent'),
  durationMin: integer('duration_min'),
  geo: text('geo'),
  participants: text('participants'),
  fulfillsEntitlementId: text('fulfills_entitlement_id'),
  fulfillsNeedId: text('fulfills_need_id'),
  fulfillsIntentId: text('fulfills_intent_id'),
  payload: text('payload'),
  evidenceUri: text('evidence_uri'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgIntents = pgTable('org_intents', {
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
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  onChainAssertionId: text('on_chain_assertion_id'),
  liveAcknowledgementCount: integer('live_acknowledgement_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgNeeds = pgTable('org_needs', {
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgOfferings = pgTable('org_offerings', {
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgOutcomes = pgTable('org_outcomes', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  intentId: text('intent_id').notNull(),
  metric: text('metric').notNull(),
  target: text('target'),
  achieved: integer('achieved').notNull().default(0),
  achievedAt: timestamp('achieved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgWorkItems = pgTable('org_work_items', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  entitlementId: text('entitlement_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  status: text('status').notNull().default('open'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedByActivityId: text('resolved_by_activity_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgNotifications = pgTable('org_notifications', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  kind: text('kind').notNull(),
  payload: text('payload'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgBeliefs = pgTable('org_beliefs', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  statement: text('statement').notNull(),
  tags: text('tags'),
  informsIntentId: text('informs_intent_id'),
  visibility: text('visibility').notNull().default('private'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgCrossDelegationGrants = pgTable('org_cross_delegation_grants', {
  id: text('id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  granteeAgent: text('grantee_agent').notNull(),
  scope: text('scope').notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  caveatTerms: text('caveat_terms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const disbursements = pgTable('disbursements', {
  id: text('id').primaryKey(),
  proposalId: text('proposal_id').notNull(),
  roundId: text('round_id').notNull(),
  trancheLabel: text('tranche_label').notNull(),
  amount: integer('amount').notNull(),
  unit: text('unit').notNull().default('USD'),
  recipientAgentId: text('recipient_agent_id').notNull(),
  status: text('status').notNull().default('pending'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  txHash: text('tx_hash'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const outcomeAttestations = pgTable('outcome_attestations', {
  id: text('id').primaryKey(),
  proposalId: text('proposal_id').notNull(),
  milestoneLabel: text('milestone_label').notNull(),
  validatorAgentId: text('validator_agent_id').notNull(),
  status: text('status').notNull(),
  evidence: text('evidence'),
  attestedAt: timestamp('attested_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const engagementProviderState = pgTable('engagement_provider_state', {
  entitlementId: text('entitlement_id').primaryKey(),
  orgPrincipal: text('org_principal').notNull(),
  capacityRemaining: integer('capacity_remaining'),
  providerNotes: text('provider_notes'),
  internalAssignee: text('internal_assignee'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const engagementSessions = pgTable('engagement_sessions', {
  id: text('id').primaryKey(),
  entitlementId: text('entitlement_id').notNull(),
  orgPrincipal: text('org_principal').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  status: text('status').notNull().default('scheduled'),
  notes: text('notes'),
})

export const engagementTranches = pgTable('engagement_tranches', {
  id: text('id').primaryKey(),
  entitlementId: text('entitlement_id').notNull(),
  orgPrincipal: text('org_principal').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  amountCents: integer('amount_cents'),
  currency: text('currency').notNull().default('XOF'),
  status: text('status').notNull().default('pending'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  gatedOnReportId: text('gated_on_report_id'),
})

export const engagementPolicies = pgTable('engagement_policies', {
  id: text('id').primaryKey(),
  entitlementId: text('entitlement_id').notNull(),
  orgPrincipal: text('org_principal').notNull(),
  policyType: text('policy_type').notNull(),
  documentUri: text('document_uri'),
  version: text('version'),
  signaturesRequired: integer('signatures_required').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const policySigners = pgTable('policy_signers', {
  id: text('id').primaryKey(),
  policyId: text('policy_id').notNull(),
  signerAgent: text('signer_agent').notNull(),
  role: text('role'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
})
