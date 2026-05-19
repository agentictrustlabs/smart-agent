/**
 * Spec 007 Phase F.2.1 — Person-MCP Postgres schema (pgTable mirror).
 *
 * Parallel to `schema.ts` (sqliteTable). The two schemas describe the
 * SAME logical tables; the active runtime backend is selected by the
 * service's `*_PG_URL` env var. The Phase F.2 nonce primitive uses
 * the Postgres `inter_service_nonces` table (UNIQUE `(scope, nonce)`)
 * defined in the a2a-agent service — person-mcp does NOT carry its own
 * inter-service nonce table; its inbound MAC verifier shares the
 * a2a-agent's table through the consume primitive.
 *
 * person-mcp owns its `action_nonces` and `holder_wallets` tables;
 * these get the Postgres UNIQUE constraints they need (action_nonces
 * was already a PK on `nonce`).
 *
 * Adding a column: edit BOTH files, then re-run
 *   `pnpm --filter @smart-agent/person-mcp exec drizzle-kit generate`.
 */
import {
  pgTable,
  text,
  integer,
  bigserial,
  timestamp,
  index,
  uniqueIndex,
  real,
} from 'drizzle-orm/pg-core'

// ─── ssi_proof_audit ─────────────────────────────────────────────────
export const ssiProofAudit = pgTable('ssi_proof_audit', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  walletContext: text('wallet_context').notNull(),
  holderWalletRef: text('holder_wallet_ref').notNull(),
  verifierId: text('verifier_id').notNull(),
  purpose: text('purpose').notNull(),
  revealedAttrs: text('revealed_attrs').notNull(),
  predicates: text('predicates').notNull(),
  actionNonce: text('action_nonce').notNull(),
  pairwiseHandle: text('pairwise_handle'),
  holderBindingIncluded: integer('holder_binding_included').notNull().default(0),
  result: text('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── accounts ───────────────────────────────────────────────────────
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  accountAddress: text('account_address').notNull().unique(),
  chainId: integer('chain_id').notNull(),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── externalIdentities ─────────────────────────────────────────────
export const externalIdentities = pgTable('external_identities', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  provider: text('provider').notNull(),
  identifier: text('identifier').notNull(),
  verified: integer('verified').notNull().default(0),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── profiles ───────────────────────────────────────────────────────
export const profiles = pgTable('profiles', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull().unique(),
  displayName: text('display_name'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  email: text('email'),
  phone: text('phone'),
  dateOfBirth: text('date_of_birth'),
  gender: text('gender'),
  language: text('language'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  stateProvince: text('state_province'),
  postalCode: text('postal_code'),
  country: text('country'),
  location: text('location'),
  preferences: text('preferences'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── chatThreads ────────────────────────────────────────────────────
export const chatThreads = pgTable('chat_threads', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  title: text('title'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── tokenUsage ─────────────────────────────────────────────────────
export const tokenUsage = pgTable('token_usage', {
  jti: text('jti').primaryKey(),
  principal: text('principal').notNull(),
  usageCount: integer('usage_count').notNull().default(1),
  usageLimit: integer('usage_limit').notNull(),
  firstUsedAt: timestamp('first_used_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull(),
})

// ─── chatMessages ───────────────────────────────────────────────────
export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id')
    .notNull()
    .references(() => chatThreads.id),
  principal: text('principal').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── userPreferences ────────────────────────────────────────────────
export const userPreferences = pgTable('user_preferences', {
  principal: text('principal').primaryKey(),
  language: text('language'),
  homeChurch: text('home_church'),
  location: text('location'),
  theme: text('theme'),
  notifications: text('notifications'),
  extras: text('extras'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

// ─── oikosContacts ──────────────────────────────────────────────────
export const oikosContacts = pgTable('oikos_contacts', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  personName: text('person_name').notNull(),
  proximity: text('proximity'),
  spiritualResponseState: text('spiritual_response_state'),
  lastContactAt: timestamp('last_contact_at', { withTimezone: true }),
  plannedConversation: integer('planned_conversation').notNull().default(0),
  notes: text('notes'),
  tags: text('tags'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── prayers ────────────────────────────────────────────────────────
export const prayers = pgTable('prayers', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  title: text('title').notNull(),
  content: text('content'),
  schedule: text('schedule'),
  responseState: text('response_state'),
  linkedOikosContactId: text('linked_oikos_contact_id'),
  tags: text('tags'),
  lastPrayedAt: timestamp('last_prayed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── trainingProgress ───────────────────────────────────────────────
export const trainingProgress = pgTable(
  'training_progress',
  {
    id: text('id').primaryKey(),
    principal: text('principal').notNull(),
    moduleKey: text('module_key').notNull(),
    programKey: text('program_key'),
    track: text('track'),
    status: text('status').notNull().default('not-started'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    hoursLogged: integer('hours_logged').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    principalIdx: index('idx_training_principal').on(t.principal),
    uqPrincipalModule: uniqueIndex('uq_training_principal_module').on(
      t.principal,
      t.moduleKey,
    ),
  }),
)

// ─── pinnedItems ────────────────────────────────────────────────────
export const pinnedItems = pgTable(
  'pinned_items',
  {
    id: text('id').primaryKey(),
    principal: text('principal').notNull(),
    itemType: text('item_type').notNull(),
    itemRef: text('item_ref').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    principalIdx: index('idx_pinned_principal').on(t.principal),
    uqPrincipalRef: uniqueIndex('uq_pinned_principal_ref').on(t.principal, t.itemRef),
  }),
)

// ─── notifications ──────────────────────────────────────────────────
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  kind: text('kind').notNull(),
  payload: text('payload'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── beliefs ────────────────────────────────────────────────────────
export const beliefs = pgTable('beliefs', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  statement: text('statement').notNull(),
  tags: text('tags'),
  informsIntentId: text('informs_intent_id'),
  visibility: text('visibility').notNull().default('private'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── coachingNotes ──────────────────────────────────────────────────
export const coachingNotes = pgTable('coaching_notes', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  subjectAgent: text('subject_agent').notNull(),
  content: text('content').notNull(),
  sharedWithSubject: integer('shared_with_subject').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── crossDelegationGrants ──────────────────────────────────────────
export const crossDelegationGrants = pgTable('cross_delegation_grants', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  granteeAgent: text('grantee_agent').notNull(),
  scope: text('scope').notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  caveatTerms: text('caveat_terms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

// ─── receivedDelegations ────────────────────────────────────────────
export const receivedDelegations = pgTable(
  'received_delegations',
  {
    id: text('id').primaryKey(),
    holderPrincipal: text('holder_principal').notNull(),
    delegatorPrincipal: text('delegator_principal').notNull(),
    audience: text('audience').notNull(),
    kind: text('kind').notNull(),
    subjectLabel: text('subject_label'),
    delegationJson: text('delegation_json').notNull(),
    delegationHash: text('delegation_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    uqHolderHash: uniqueIndex('uq_recv_deleg_holder_hash').on(t.holderPrincipal, t.delegationHash),
    holderIdx: index('idx_recv_deleg_holder').on(t.holderPrincipal),
    kindIdx: index('idx_recv_deleg_kind').on(t.holderPrincipal, t.kind),
  }),
)

// ─── intents ────────────────────────────────────────────────────────
export const intents = pgTable('intents', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
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

// ─── needs ──────────────────────────────────────────────────────────
export const needs = pgTable('needs', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
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

// ─── offerings ──────────────────────────────────────────────────────
export const offerings = pgTable('offerings', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
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

// ─── outcomes ───────────────────────────────────────────────────────
export const outcomes = pgTable('outcomes', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  intentId: text('intent_id').notNull(),
  metric: text('metric').notNull(),
  target: text('target'),
  achieved: integer('achieved').notNull().default(0),
  achievedAt: timestamp('achieved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── activityLogEntries ─────────────────────────────────────────────
export const activityLogEntries = pgTable('activity_log_entries', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  kind: text('kind').notNull(),
  performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
  durationMin: integer('duration_min'),
  geo: text('geo'),
  witnesses: text('witnesses'),
  fulfillsEntitlementId: text('fulfills_entitlement_id'),
  fulfillsNeedId: text('fulfills_need_id'),
  fulfillsIntentId: text('fulfills_intent_id'),
  payload: text('payload'),
  evidenceUri: text('evidence_uri'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── workItems ──────────────────────────────────────────────────────
export const workItems = pgTable('work_items', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  entitlementId: text('entitlement_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  status: text('status').notNull().default('open'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedByActivityId: text('resolved_by_activity_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── proposalSubmissions ────────────────────────────────────────────
export const proposalSubmissions = pgTable('proposal_submissions', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  roundId: text('round_id'),
  fundMandateId: text('fund_mandate_id'),
  basedOnIntentId: text('based_on_intent_id').notNull(),
  budget: text('budget').notNull(),
  plan: text('plan').notNull(),
  milestones: text('milestones').notNull(),
  desiredOutcomes: text('desired_outcomes').notNull(),
  reportingObligations: text('reporting_obligations').notNull(),
  organisationalBackground: text('organisational_background').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  lastEditedAt: timestamp('last_edited_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('draft'),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  clonedFromProposalId: text('cloned_from_proposal_id'),
  basis: text('basis'),
  visibility: text('visibility').notNull().default('private'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── engagementHolderState ──────────────────────────────────────────
export const engagementHolderState = pgTable('engagement_holder_state', {
  entitlementId: text('entitlement_id').primaryKey(),
  principal: text('principal').notNull(),
  capacityConsumed: integer('capacity_consumed').notNull().default(0),
  holderOutcomeNotes: text('holder_outcome_notes'),
  lastActivityId: text('last_activity_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

// ─── ssi-wallet — holder wallets / credential metadata / action nonces ──
export const holderWallets = pgTable(
  'holder_wallets',
  {
    id: text('id').primaryKey(),
    personPrincipal: text('person_principal').notNull(),
    walletContext: text('wallet_context').notNull(),
    signerEoa: text('signer_eoa').notNull(),
    askarProfile: text('askar_profile').notNull(),
    linkSecretId: text('link_secret_id').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqPrincipalContext: uniqueIndex('uq_hw_principal_context').on(
      t.personPrincipal,
      t.walletContext,
    ),
    principalIdx: index('idx_hw_principal').on(t.personPrincipal),
    signerIdx: index('idx_hw_signer_eoa').on(t.signerEoa),
  }),
)

// action_nonces — per-action replay protection. Single-column nonce PK
// already enforces UNIQUE; the consume-nonce primitive uses ON CONFLICT
// on `(nonce)`.
export const actionNonces = pgTable('action_nonces', {
  nonce: text('nonce').primaryKey(),
  actionType: text('action_type').notNull(),
  holderWalletId: text('holder_wallet_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
})

export const credentialMetadata = pgTable('credential_metadata', {
  id: text('id').primaryKey(),
  holderWalletId: text('holder_wallet_id').notNull(),
  issuerId: text('issuer_id').notNull(),
  schemaId: text('schema_id').notNull(),
  credDefId: text('cred_def_id').notNull(),
  credentialType: text('credential_type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('active'),
  linkSecretId: text('link_secret_id').notNull().default(''),
  targetOrgAddress: text('target_org_address'),
})

export const trustOverlapAudit = pgTable('trust_overlap_audit', {
  id: text('id').primaryKey(),
  holderWalletId: text('holder_wallet_id').notNull(),
  principal: text('principal').notNull(),
  counterpartyId: text('counterparty_id').notNull(),
  policyId: text('policy_id').notNull(),
  blockPin: text('block_pin').notNull().default('0'),
  publicSetCommit: text('public_set_commit').notNull(),
  evidenceCommit: text('evidence_commit').notNull(),
  score: real('score').notNull(),
  sharedCount: integer('shared_count').notNull(),
  outputKind: text('output_kind').notNull().default('score-only'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── audit_checkpoint ───────────────────────────────────────────────
export const auditCheckpoint = pgTable('audit_checkpoint', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  service: text('service').notNull().default('person-mcp'),
  latestEntryId: integer('latest_entry_id').notNull(),
  latestEntryHash: text('latest_entry_hash').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  chainId: integer('chain_id').notNull(),
  signature: text('signature').notNull(),
  signerAddress: text('signer_address').notNull(),
  sinkStatus: text('sink_status').notNull().default('not-configured'),
  sinkAttempts: integer('sink_attempts').notNull().default(0),
})
