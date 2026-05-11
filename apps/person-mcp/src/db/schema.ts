import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// ssi_proof_audit — one row per proof presentation (ok or denied).
//   Trust-overlap matches use a different table (`trust_overlap_audit`)
//   defined in raw SQL; they have no presentation/predicate metadata.
// ---------------------------------------------------------------------------
export const ssiProofAudit = sqliteTable('ssi_proof_audit', {
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
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// accounts — smart account registrations per principal
// ---------------------------------------------------------------------------
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  accountAddress: text('account_address').notNull().unique(),
  chainId: integer('chain_id').notNull(),
  label: text('label'),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// externalIdentities — OAuth / social / email links
// ---------------------------------------------------------------------------
export const externalIdentities = sqliteTable('external_identities', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  provider: text('provider').notNull(),
  identifier: text('identifier').notNull(),
  verified: integer('verified').notNull().default(0),
  metadata: text('metadata'), // JSON string
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// profiles — one profile per principal
// ---------------------------------------------------------------------------
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull().unique(),
  // ─── Display ─────────────────────────────────────────────────────
  displayName: text('display_name'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  // ─── PII (only accessible via delegation chain) ──────────────────
  email: text('email'),
  phone: text('phone'),
  dateOfBirth: text('date_of_birth'),        // ISO date string YYYY-MM-DD
  gender: text('gender'),                     // free text or enum (male/female/non-binary/prefer-not-to-say)
  language: text('language'),                 // ISO 639-1 (en, es, fr, etc.)
  // ─── Address ─────────────────────────────────────────────────────
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  stateProvince: text('state_province'),
  postalCode: text('postal_code'),
  country: text('country'),                   // ISO 3166-1 alpha-2 (US, GB, TG, etc.)
  // ─── Other ───────────────────────────────────────────────────────
  location: text('location'),                 // freeform location string (legacy compat)
  preferences: text('preferences'),           // JSON string
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// chatThreads — conversation threads
// ---------------------------------------------------------------------------
export const chatThreads = sqliteTable('chat_threads', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  title: text('title'),
  metadata: text('metadata'), // JSON string
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// tokenUsage — JTI tracking for delegation token usage limits
// ---------------------------------------------------------------------------
export const tokenUsage = sqliteTable('token_usage', {
  jti: text('jti').primaryKey(),
  principal: text('principal').notNull(),
  usageCount: integer('usage_count').notNull().default(1),
  usageLimit: integer('usage_limit').notNull(),
  firstUsedAt: text('first_used_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
})

// ---------------------------------------------------------------------------
// chatMessages — messages within threads
// ---------------------------------------------------------------------------
export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => chatThreads.id),
  principal: text('principal').notNull(),
  role: text('role').notNull(), // user | assistant | system | tool
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON string
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// userPreferences — language, home church, location, theme, notifications
// ---------------------------------------------------------------------------
export const userPreferences = sqliteTable('user_preferences', {
  principal: text('principal').primaryKey(),
  language: text('language'),
  homeChurch: text('home_church'),
  location: text('location'),
  theme: text('theme'),
  notifications: text('notifications'), // JSON string
  extras: text('extras'),                // JSON string for forward-compat
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// oikosContacts — personal relationship network (replaces web `circles`)
// ---------------------------------------------------------------------------
export const oikosContacts = sqliteTable('oikos_contacts', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  personName: text('person_name').notNull(),
  proximity: text('proximity'),                       // ring1 | ring2 | ring3 | etc.
  spiritualResponseState: text('spiritual_response_state'),
  lastContactAt: text('last_contact_at'),
  plannedConversation: integer('planned_conversation').notNull().default(0),
  notes: text('notes'),
  tags: text('tags'),                                 // JSON array string
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// prayers — personal prayer entries
// ---------------------------------------------------------------------------
export const prayers = sqliteTable('prayers', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  title: text('title').notNull(),
  content: text('content'),
  schedule: text('schedule'),                         // daily | weekly | etc.
  responseState: text('response_state'),              // open | answered | etc.
  linkedOikosContactId: text('linked_oikos_contact_id'),
  tags: text('tags'),                                 // JSON array string
  lastPrayedAt: text('last_prayed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// trainingProgress — personal module/program progression
// ---------------------------------------------------------------------------
export const trainingProgress = sqliteTable('training_progress', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  moduleKey: text('module_key').notNull(),
  programKey: text('program_key'),
  track: text('track'),
  status: text('status').notNull().default('not-started'),  // not-started | in-progress | completed
  completedAt: text('completed_at'),
  hoursLogged: integer('hours_logged').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// pinnedItems — quick-access bookmarks
// ---------------------------------------------------------------------------
export const pinnedItems = sqliteTable('pinned_items', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  itemType: text('item_type').notNull(),              // 'node' | 'org' | 'agent' | etc.
  itemRef: text('item_ref').notNull(),                // address or other id
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// notifications — personal inbox (review received, match accepted, etc.)
// ---------------------------------------------------------------------------
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  kind: text('kind').notNull(),                       // review-received | match-accepted | invite-received | ...
  payload: text('payload'),                           // JSON string
  readAt: text('read_at'),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// beliefs — off-chain working beliefs that may inform intents
// ---------------------------------------------------------------------------
export const beliefs = sqliteTable('beliefs', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  statement: text('statement').notNull(),
  tags: text('tags'),                                 // JSON array string
  informsIntentId: text('informs_intent_id'),         // soft FK to intents.id
  visibility: text('visibility').notNull().default('private'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// coachingNotes — coach owns the row; cross-delegation lets disciple read
// ---------------------------------------------------------------------------
export const coachingNotes = sqliteTable('coaching_notes', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),             // coach principal
  subjectAgent: text('subject_agent').notNull(),      // disciple address
  content: text('content').notNull(),
  sharedWithSubject: integer('shared_with_subject').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// crossDelegationGrants — owner grants others scoped read access
// ---------------------------------------------------------------------------
export const crossDelegationGrants = sqliteTable('cross_delegation_grants', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),             // grantor
  granteeAgent: text('grantee_agent').notNull(),
  scope: text('scope').notNull(),                     // JSON array of resources/fields
  validFrom: text('valid_from'),
  validUntil: text('valid_until'),
  caveatTerms: text('caveat_terms'),                  // JSON
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
})

// ---------------------------------------------------------------------------
// received_delegations — holder-side store for off-chain cross-delegations.
//   When another principal signs a delegation FOR this caller (e.g. a
//   private coaching grant), they push the signed blob here via
//   `register_received_delegation`. The verifier (`get_delegated_profile`
//   etc.) reads it from this table when the caller invokes a tool.
//   Nothing about the relationship lands on chain.
// ---------------------------------------------------------------------------
export const receivedDelegations = sqliteTable('received_delegations', {
  id: text('id').primaryKey(),
  holderPrincipal: text('holder_principal').notNull(),       // recipient's smart account
  delegatorPrincipal: text('delegator_principal').notNull(), // data owner's smart account
  audience: text('audience').notNull(),                      // e.g. urn:mcp:server:person
  kind: text('kind').notNull(),                              // 'coaching' | 'data-share' | ...
  subjectLabel: text('subject_label'),                       // optional display name
  delegationJson: text('delegation_json').notNull(),         // full signed delegation
  delegationHash: text('delegation_hash').notNull(),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
})

// ---------------------------------------------------------------------------
// intents — owner-routed (private | public | public-coarse | off-chain)
//   When visibility is public/public-coarse, the MCP also signs an on-chain
//   assertion via the owner's session signer. The on-chain assertion id is
//   stored in `onChainAssertionId`. The MCP itself NEVER writes to GraphDB.
// ---------------------------------------------------------------------------
export const intents = sqliteTable('intents', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  direction: text('direction').notNull(),             // receive | give
  visibility: text('visibility').notNull().default('private'),
  kind: text('kind').notNull(),
  addressedTo: text('addressed_to'),
  summary: text('summary').notNull(),
  context: text('context'),                            // JSON
  status: text('status').notNull().default('expressed'),
  priority: text('priority'),
  expiresAt: text('expires_at'),
  onChainAssertionId: text('on_chain_assertion_id'),  // set when minted public
  // liveAcknowledgementCount — incremented when a downstream artifact (e.g.,
  // sa:MatchInitiation per spec 001, sa:GrantProposal per spec 003) creates
  // a 'pending' acknowledgement against this intent; decremented on withdraw.
  // Drives the FR-023 invariant: intent reverts to 'expressed' iff this hits 0.
  // See docs/information-architecture/10-intent-marketplace-classification.md § 3.10.
  liveAcknowledgementCount: integer('live_acknowledgement_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// needs — projection of receive-direction intents
// ---------------------------------------------------------------------------
export const needs = sqliteTable('needs', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  intentId: text('intent_id').notNull(),
  kind: text('kind').notNull(),
  requirements: text('requirements'),                  // JSON
  status: text('status').notNull().default('open'),
  visibility: text('visibility').notNull().default('private'),
  geo: text('geo'),
  capacityNeeded: integer('capacity_needed'),
  onChainAssertionId: text('on_chain_assertion_id'),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// offerings — projection of give-direction intents
// ---------------------------------------------------------------------------
export const offerings = sqliteTable('offerings', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  intentId: text('intent_id').notNull(),
  kind: text('kind').notNull(),
  capabilities: text('capabilities'),                  // JSON
  capacity: integer('capacity'),
  visibility: text('visibility').notNull().default('private'),
  geo: text('geo'),
  timeWindow: text('time_window'),                     // JSON
  onChainAssertionId: text('on_chain_assertion_id'),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// outcomes — success criteria tied to intents
// ---------------------------------------------------------------------------
export const outcomes = sqliteTable('outcomes', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  intentId: text('intent_id').notNull(),
  metric: text('metric').notNull(),
  target: text('target'),
  achieved: integer('achieved').notNull().default(0),
  achievedAt: text('achieved_at'),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// activityLogEntries — personal activities (private by default)
// ---------------------------------------------------------------------------
export const activityLogEntries = sqliteTable('activity_log_entries', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),
  kind: text('kind').notNull(),                        // meeting | visit | training | prayer | service | ...
  performedAt: text('performed_at').notNull(),
  durationMin: integer('duration_min'),
  geo: text('geo'),
  witnesses: text('witnesses'),                        // JSON array
  fulfillsEntitlementId: text('fulfills_entitlement_id'),  // on-chain reference
  fulfillsNeedId: text('fulfills_need_id'),
  fulfillsIntentId: text('fulfills_intent_id'),
  payload: text('payload'),                            // JSON for extra fields
  evidenceUri: text('evidence_uri'),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// workItems — assigned-to person; entitlement-attached
// ---------------------------------------------------------------------------
export const workItems = sqliteTable('work_items', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),              // assignee
  entitlementId: text('entitlement_id').notNull(),     // on-chain reference
  title: text('title').notNull(),
  description: text('description'),
  dueAt: text('due_at'),
  status: text('status').notNull().default('open'),    // open | in-progress | resolved | cancelled
  resolvedAt: text('resolved_at'),
  resolvedByActivityId: text('resolved_by_activity_id'),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// Spec 003 — Intent Marketplace (Proposal Lane).
// proposalSubmissions — body of `sa:GrantProposal` for solo human applicants
// (org-mcp twin holds the same table for org proposers; org proposers are the
// common case). Always private; never anchored on chain in v1; never mirrored
// to GraphDB. SHACL `sa:GrantProposalAlwaysPrivateShape` enforces. Steward
// read access flows through a `proposal:read_for_review` cross-delegation
// issued at submit time. See packages/sdk/src/marketplace-scopes.ts.
// ---------------------------------------------------------------------------
export const proposalSubmissions = sqliteTable('proposal_submissions', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),                       // = proposerAgentId
  roundId: text('round_id'),                                    // null for open-call (Q5)
  fundMandateId: text('fund_mandate_id'),                       // required when roundId is null
  basedOnIntentId: text('based_on_intent_id').notNull(),
  budget: text('budget').notNull(),                             // JSON
  plan: text('plan').notNull(),                                 // JSON
  milestones: text('milestones').notNull(),                     // JSON array
  desiredOutcomes: text('desired_outcomes').notNull(),          // JSON array
  reportingObligations: text('reporting_obligations').notNull(),// JSON
  organisationalBackground: text('organisational_background').notNull(), // JSON
  submittedAt: text('submitted_at'),                            // ISO-8601; null while draft
  version: integer('version').notNull().default(0),
  lastEditedAt: text('last_edited_at').notNull(),
  status: text('status').notNull().default('draft'),
  withdrawnAt: text('withdrawn_at'),
  clonedFromProposalId: text('cloned_from_proposal_id'),
  basis: text('basis'),                                         // JSON: RankBasis snapshot
  visibility: text('visibility').notNull().default('private'),  // ALWAYS 'private'
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// Spec 001 — Intent Marketplace (Direct Lane).
// matchInitiations — body of `sa:MatchInitiation` (initiator-owned per IA § 2.1).
// Per the contract:
//   - `principal` = initiatorAgentId (tenancy column).
//   - `initiatorAgentId` is a redundant mirror kept for symmetry with org-mcp.
//   - status starts at 'pending'; downstream specs advance to 'superseded' /
// Spec 004 v2 — match_initiations DROPPED (person-mcp). MatchInitiation
// bodies are authoritative on chain in MatchInitiationRegistry; the
// person-mcp tool surface stays for ABI back-compat but every handler
// stubs to "moved on chain" (see apps/person-mcp/src/tools/matchInitiations.ts).

// ---------------------------------------------------------------------------
// engagementHolderState — holder-side per-entitlement metadata
// ---------------------------------------------------------------------------
export const engagementHolderState = sqliteTable('engagement_holder_state', {
  entitlementId: text('entitlement_id').primaryKey(),  // on-chain id
  principal: text('principal').notNull(),              // holder
  capacityConsumed: integer('capacity_consumed').notNull().default(0),
  holderOutcomeNotes: text('holder_outcome_notes'),
  lastActivityId: text('last_activity_id'),
  updatedAt: text('updated_at').notNull(),
})

// Spec 004 v2 — pool_pledges DROPPED (person-mcp). Pledges are
// authoritative on chain in PledgeRegistry. Solo human donors use
// org-mcp's pool_pledge:* tools (with the chained delegation) just like
// org donors; person-mcp's tool surface stubs to "moved on chain"
// (see apps/person-mcp/src/tools/poolPledges.ts).
