/**
 * Spec 007 Phase F.2.1 — Web Postgres schema (pgTable mirror).
 *
 * Parallel to `schema.ts` (sqliteTable). Only the tables actually
 * referenced from web source code today are mirrored here — the
 * sqliteTable file contains many stub entries kept for type-only
 * compatibility (see the data-store-consolidation banner at the top
 * of `schema.ts`). When a stubbed table is rewired, add its pgTable
 * twin here and re-run `pnpm --filter @smart-agent/web exec drizzle-kit generate`.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core'

// ─── Local user accounts (demo + Google OAuth profile cache) ──────
export const localUserAccounts = pgTable('local_user_accounts', {
  id: text('id').primaryKey(),
  email: text('email'),
  name: text('name').notNull(),
  walletAddress: text('wallet_address').notNull().unique(),
  did: text('did').unique(),
  privateKey: text('private_key'),
  smartAccountAddress: text('smart_account_address'),
  personAgentAddress: text('person_agent_address'),
  agentName: text('agent_name'),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  accountSaltRotation: integer('account_salt_rotation').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Recovery (passkey) delegations ──────────────────────────────
export const recoveryDelegations = pgTable('recovery_delegations', {
  id: text('id').primaryKey(),
  accountAddress: text('account_address').notNull().unique(),
  delegationJson: text('delegation_json').notNull(),
  delegationHash: text('delegation_hash').notNull(),
  recoveryConfigJson: text('recovery_config_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const recoveryIntents = pgTable('recovery_intents', {
  id: text('id').primaryKey(),
  accountAddress: text('account_address').notNull(),
  intentHash: text('intent_hash').notNull().unique(),
  newCredentialId: text('new_credential_id').notNull(),
  newPubKeyX: text('new_pub_key_x').notNull(),
  newPubKeyY: text('new_pub_key_y').notNull(),
  readyAt: integer('ready_at').notNull(),
  status: integer('status').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Invites ─────────────────────────────────────────────────────
export const invites = pgTable('invites', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  agentAddress: text('agent_address').notNull(),
  agentName: text('agent_name').notNull(),
  role: text('role').notNull().default('owner'),
  createdBy: text('created_by').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedBy: text('accepted_by'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Training modules ────────────────────────────────────────────
export const trainingModules = pgTable('training_modules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  program: text('program').notNull().default('bdc'),
  hours: integer('hours').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Intents (kept in web for the demo flow per schema.ts comments) ──
export const intents = pgTable('intents', {
  id: text('id').primaryKey(),
  direction: text('direction').notNull(),
  object: text('object').notNull(),
  topic: text('topic'),
  intentType: text('intent_type').notNull(),
  intentTypeLabel: text('intent_type_label').notNull(),
  expressedByAgent: text('expressed_by_agent').notNull(),
  expressedByUserId: text('expressed_by_user_id'),
  addressedTo: text('addressed_to').notNull(),
  hubId: text('hub_id').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  payload: text('payload'),
  status: text('status').notNull().default('expressed'),
  priority: text('priority').notNull().default('normal'),
  visibility: text('visibility').notNull().default('public'),
  expectedOutcome: text('expected_outcome'),
  projectionRef: text('projection_ref'),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Entitlements & commitment thread ────────────────────────────
export const entitlements = pgTable('entitlements', {
  id: text('id').primaryKey(),
  sourceMatchId: text('source_match_id').notNull(),
  holderIntentId: text('holder_intent_id').notNull(),
  providerIntentId: text('provider_intent_id').notNull(),
  holderAgent: text('holder_agent').notNull(),
  providerAgent: text('provider_agent').notNull(),
  hubId: text('hub_id').notNull(),
  terms: text('terms').notNull(),
  capacityUnit: text('capacity_unit').notNull(),
  capacityGranted: integer('capacity_granted').notNull(),
  capacityRemaining: integer('capacity_remaining').notNull(),
  cadence: text('cadence').notNull().default('weekly'),
  holderOutcomeId: text('holder_outcome_id'),
  providerOutcomeId: text('provider_outcome_id'),
  holderConfirmedAt: timestamp('holder_confirmed_at', { withTimezone: true }),
  providerConfirmedAt: timestamp('provider_confirmed_at', { withTimezone: true }),
  witnessAgent: text('witness_agent'),
  witnessSignedAt: timestamp('witness_signed_at', { withTimezone: true }),
  reviewIds: text('review_ids'),
  assertionId: text('assertion_id'),
  evidenceBundleHash: text('evidence_bundle_hash'),
  evidencePinnedAt: timestamp('evidence_pinned_at', { withTimezone: true }),
  phase: text('phase').notNull().default('granted'),
  engagementKind: text('engagement_kind').notNull().default('delivery'),
  parentEngagementId: text('parent_engagement_id'),
  status: text('status').notNull().default('granted'),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const commitmentThreadEntries = pgTable('commitment_thread_entries', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id')
    .notNull()
    .references(() => entitlements.id),
  kind: text('kind').notNull(),
  fromAgent: text('from_agent'),
  body: text('body').notNull(),
  attachmentUri: text('attachment_uri'),
  hashAnchor: text('hash_anchor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const fulfillmentWorkItems = pgTable('fulfillment_work_items', {
  id: text('id').primaryKey(),
  entitlementId: text('entitlement_id')
    .notNull()
    .references(() => entitlements.id),
  assigneeAgent: text('assignee_agent').notNull(),
  taskKind: text('task_kind').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  cadence: text('cadence').notNull().default('one-shot'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  resolvedByActivityId: text('resolved_by_activity_id'),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Engagement shapes — sessions / tranches / policies ──────────
export const engagementSessions = pgTable('engagement_sessions', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id')
    .notNull()
    .references(() => entitlements.id),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  notes: text('notes'),
  loggedBy: text('logged_by'),
  sourceActivityId: text('source_activity_id'),
  status: text('status').notNull().default('scheduled'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const engagementTranches = pgTable('engagement_tranches', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id')
    .notNull()
    .references(() => entitlements.id),
  idx: integer('idx').notNull(),
  amountCents: integer('amount_cents').notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  reportRequired: integer('report_required').notNull().default(1),
  reportThreadEntryId: text('report_thread_entry_id'),
  state: text('state').notNull().default('scheduled'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const engagementPolicies = pgTable('engagement_policies', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id')
    .notNull()
    .references(() => entitlements.id),
  policyDocUri: text('policy_doc_uri'),
  policySummary: text('policy_summary'),
  currentState: text('current_state').notNull().default('draft'),
  requiredSigners: integer('required_signers').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const policySigners = pgTable('policy_signers', {
  id: text('id').primaryKey(),
  policyId: text('policy_id')
    .notNull()
    .references(() => engagementPolicies.id),
  agent: text('agent').notNull(),
  role: text('role').notNull(),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
