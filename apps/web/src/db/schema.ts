import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// ─── Users ───────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  name: text('name').notNull(),
  walletAddress: text('wallet_address').notNull().unique(),
  /**
   * Subject DID — identifies the user across auth flows. Format depends on
   * how they signed in:
   *   - Google OAuth → did:google:{sub}
   *   - Passkey signup → did:passkey:{chainId}:{accountAddr}
   *   - SIWE → did:ethr:{chainId}:{eoaAddr}
   *   - Demo seed → did:demo:{key}
   */
  did: text('did').unique(),
  /** Private key for demo users (hex, 0x-prefixed). Null for everyone else. */
  privateKey: text('private_key'),
  /** Smart account address deployed for this user. Null until deployed. */
  smartAccountAddress: text('smart_account_address'),
  /** Person agent address deployed for this user. Null until deployed. */
  personAgentAddress: text('person_agent_address'),
  /** The .agent name the user registered, mirrored from on-chain for fast
   *  lookup. The on-chain ATL_PRIMARY_NAME is still the canonical source. */
  agentName: text('agent_name'),
  /** ISO timestamp set when the user finishes the onboarding wizard. Used as
   *  the master gate by the (authenticated) layout — once set, the user is
   *  considered onboarded regardless of on-chain resolver state, which can
   *  fall behind for accounts that already had the bootstrap server removed. */
  onboardedAt: text('onboarded_at'),
  /** Counter mixed into the smart-account salt so the user can abandon a
   *  stuck account and re-deploy at a fresh address. Starts at 0; the
   *  "Start fresh" escape hatch bumps it. */
  accountSaltRotation: integer('account_salt_rotation').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ═══════════════════════════════════════════════════════════════════════
// All agent identity, relationships, and metadata are ON-CHAIN.
// The only DB table for agents is `users` (auth DID → wallet mapping).
// Agent lookup: resolver (name/type) + edges (relationships) + ATL_CONTROLLER (wallet→agent).
// ─── Passkeys ────────────────────────────────────────────────────────
//
// Removed. Login is name-based via the .agent registry; the AgentAccount
// contract's `_passkeys[digest]` mapping is the source of truth for which
// credentials authorise the account. The OS picker is hinted purely from
// browser localStorage (smart-agent.passkeys.local), filtered by .agent
// name on the client.

// ─── Recovery Delegations ────────────────────────────────────────────
//
// Stored per smart account at first passkey enrollment. Lets the server
// (acting as a guardian under RecoveryEnforcer) sign an addPasskey UserOp
// for a fresh device after the OAuth-gated timelock elapses.

export const recoveryDelegations = sqliteTable('recovery_delegations', {
  id: text('id').primaryKey(),
  /** The smart-account address that authored this delegation. */
  accountAddress: text('account_address').notNull().unique(),
  /** Full delegation, including signature, JSON-serialised. */
  delegationJson: text('delegation_json').notNull(),
  /** Pre-computed delegation hash (for revocation lookups). */
  delegationHash: text('delegation_hash').notNull(),
  /** Guardians + threshold + delaySeconds in JSON form (for UI display). */
  recoveryConfigJson: text('recovery_config_json').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Pending Recovery Intents ────────────────────────────────────────
// One row per (account, intentHash) recovery proposal.

export const recoveryIntents = sqliteTable('recovery_intents', {
  id: text('id').primaryKey(),
  accountAddress: text('account_address').notNull(),
  intentHash: text('intent_hash').notNull().unique(),
  /** Hex-encoded credentialId of the new passkey that will be registered. */
  newCredentialId: text('new_credential_id').notNull(),
  newPubKeyX: text('new_pub_key_x').notNull(),
  newPubKeyY: text('new_pub_key_y').notNull(),
  /** Unix seconds when the timelock expires (proposedAt + delaySeconds). */
  readyAt: integer('ready_at').notNull(),
  /** 0 = open, 1 = consumed, 2 = cancelled. */
  status: integer('status').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Invites ─────────────────────────────────────────────────────────

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  agentAddress: text('agent_address').notNull(),
  agentName: text('agent_name').notNull(),
  role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull().default('owner'),
  createdBy: text('created_by').notNull().references(() => users.id),
  expiresAt: text('expires_at').notNull(),
  acceptedBy: text('accepted_by').references(() => users.id),
  acceptedAt: text('accepted_at'),
  status: text('status', { enum: ['pending', 'accepted', 'expired', 'revoked'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Revenue Reports (general-purpose, used by portfolio businesses) ─

export const revenueReports = sqliteTable('revenue_reports', {
  id: text('id').primaryKey(),
  /** Org agent address of the reporting business */
  orgAddress: text('org_address').notNull(),
  /** User who submitted the report */
  submittedBy: text('submitted_by').notNull().references(() => users.id),
  /** YYYY-MM format */
  period: text('period').notNull(),
  grossRevenue: integer('gross_revenue').notNull(),
  expenses: integer('expenses').notNull(),
  netRevenue: integer('net_revenue').notNull(),
  /** Revenue-share payment amount (in local currency units) */
  sharePayment: integer('share_payment').notNull().default(0),
  currency: text('currency').notNull().default('XOF'),
  notes: text('notes'),
  /** verified-by user id (CIL operator, ILAD coordinator, etc.) */
  verifiedBy: text('verified_by').references(() => users.id),
  verifiedAt: text('verified_at'),
  status: text('status', { enum: ['draft', 'submitted', 'verified', 'disputed'] }).notNull().default('draft'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Training Modules ────────────────────────────────────────────────

export const trainingModules = sqliteTable('training_modules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  /** Program this module belongs to (e.g., 'bdc', 'leadership') */
  program: text('program').notNull().default('bdc'),
  hours: integer('hours').notNull().default(0),
  /** Display order */
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Governance Proposals ────────────────────────────────────────────

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  /** Org agent address the proposal is for */
  orgAddress: text('org_address').notNull(),
  /** User who created the proposal */
  proposer: text('proposer').notNull().references(() => users.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  /** pause-capital | graduate-wave | escalate-review | general */
  actionType: text('action_type', {
    enum: ['pause-capital', 'graduate-wave', 'escalate-review', 'general'],
  }).notNull().default('general'),
  /** Target address for the action (e.g., business to pause) */
  targetAddress: text('target_address'),
  quorumRequired: integer('quorum_required').notNull().default(2),
  votesFor: integer('votes_for').notNull().default(0),
  votesAgainst: integer('votes_against').notNull().default(0),
  status: text('status', { enum: ['open', 'passed', 'rejected', 'executed'] }).notNull().default('open'),
  executedAt: text('executed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Activity Logs (general-purpose field activity tracking) ─────────

export const activityLogs = sqliteTable('activity_logs', {
  id: text('id').primaryKey(),
  /** Org agent address this activity belongs to */
  orgAddress: text('org_address').notNull(),
  /** User who logged the activity */
  userId: text('user_id').notNull().references(() => users.id),
  /** Activity type (general categories) */
  activityType: text('activity_type', {
    enum: [
      'meeting', 'visit', 'training', 'outreach', 'follow-up',
      'assessment', 'coaching', 'prayer', 'service', 'other',
    ],
  }).notNull().default('other'),
  title: text('title').notNull(),
  description: text('description'),
  /** Number of participants / attendees */
  participants: integer('participants').notNull().default(0),
  /** Location label (city, neighborhood, etc.) */
  location: text('location'),
  /** Latitude for map display */
  lat: text('lat'),
  /** Longitude for map display */
  lng: text('lng'),
  /** Duration in minutes */
  durationMinutes: integer('duration_minutes'),
  /** Optional link to related entity (e.g., group address, edge ID) */
  relatedEntity: text('related_entity'),
  /** PROV chain — does this activity address an open need? */
  fulfillsNeedId: text('fulfills_need_id'),
  /** PROV chain — generalised intent link. Set alongside fulfillsNeedId for
   *  receive-shaped intents; set alone for give/free-form intents. */
  fulfillsIntentId: text('fulfills_intent_id'),
  /** PROV chain — closes the marketplace→fulfillment chain. When this
   *  is set the activity action backfills fulfillsIntentId and
   *  fulfillsNeedId from the entitlement's links. */
  fulfillsEntitlementId: text('fulfills_entitlement_id'),
  /** PROV chain — Outcome contributed to by this activity. */
  achievesOutcomeId: text('achieves_outcome_id'),
  /** PROV chain — does this activity draw on a specific resource offering? */
  usesOfferingId: text('uses_offering_id'),
  /** Date of the activity (may differ from created_at) */
  activityDate: text('activity_date').notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Detached Members (people tracked without accounts) ─────────────

export const detachedMembers = sqliteTable('detached_members', {
  id: text('id').primaryKey(),
  /** Org this member belongs to */
  orgAddress: text('org_address').notNull(),
  name: text('name').notNull(),
  /** Optional: which group/node they're assigned to */
  assignedNodeId: text('assigned_node_id'),
  role: text('role'),
  notes: text('notes'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Pinned Items (quick-access bookmarks) ──────────────────────────

export const pinnedItems = sqliteTable('pinned_items', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  /** Type: 'node' (gen map node) or 'org' */
  itemType: text('item_type', { enum: ['node', 'org'] }).notNull(),
  itemId: text('item_id').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Circles of Influence (Oikos) ───────────────────────────────────

export const circles = sqliteTable('circles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  personName: text('person_name').notNull(),
  /** Proximity ring: 1 = closest, 2 = near, 3 = acquaintance, 4 = outer */
  proximity: integer('proximity').notNull().default(3),
  /** Spiritual response: not-interested, curious, interested, seeking, decided, baptized */
  response: text('response', {
    enum: ['not-interested', 'curious', 'interested', 'seeking', 'decided', 'baptized'],
  }).notNull().default('curious'),
  /** Planned conversation flag */
  plannedConversation: integer('planned_conversation').notNull().default(0),
  /** Comma-separated tags: "ESL Student,Farm Worker,Youth" */
  tags: text('tags'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Prayer Tracker ─────────────────────────────────────────────────

export const prayers = sqliteTable('prayers', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  notes: text('notes'),
  /** Comma-separated days: mon,wed,fri or 'daily' */
  schedule: text('schedule').notNull().default('daily'),
  lastPrayed: text('last_prayed'),
  /** Link prayer to an oikos person */
  linkedOikosId: text('linked_oikos_id'),
  /** 0 = active, 1 = answered */
  answered: integer('answered').notNull().default(0),
  answeredAt: text('answered_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Training Progress ──────────────────────────────────────────────

export const trainingProgress = sqliteTable('training_progress', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  /** Module key: '411-1', '411-2', 'coc-love', 'coc-pray', '3thirds', etc. */
  moduleKey: text('module_key').notNull(),
  /** Program: '411', 'commands', '3thirds' */
  program: text('program').notNull(),
  /** Track: 'obeying' | 'teaching' | null */
  track: text('track'),
  /** 0 = not started, 1 = completed */
  completed: integer('completed').notNull().default(0),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Coach Relationships ────────────────────────────────────────────

export const coachRelationships = sqliteTable('coach_relationships', {
  id: text('id').primaryKey(),
  /** The disciple being coached */
  discipleId: text('disciple_id').notNull().references(() => users.id),
  /** The coach */
  coachId: text('coach_id').notNull().references(() => users.id),
  /** Sharing permissions: comma-separated categories */
  sharePermissions: text('share_permissions').notNull().default(''),
  status: text('status', { enum: ['active', 'paused', 'ended'] }).notNull().default('active'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── User Preferences (language, home church, etc.) ─────────────────

export const userPreferences = sqliteTable('user_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id).unique(),
  language: text('language').notNull().default('en'),
  homeChurch: text('home_church'),
  location: text('location'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Messages / Notifications ────────────────────────────────────────

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  type: text('type', {
    enum: [
      'ownership_offered', 'ownership_accepted',
      'relationship_proposed', 'relationship_confirmed', 'relationship_rejected',
      'review_received', 'dispute_filed',
      'proposal_created', 'proposal_executed',
      'invite_sent', 'invite_accepted',
      'data_access_granted', 'data_access_revoked',
    ],
  }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  read: integer('read').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Needs / Resources / Matches (Discover layer) ──────────────────
//
// Three-table layer that bridges Need ↔ Resource through the
// NeedResourceMatch artifact. T-Box: docs/ontology/tbox/needs.ttl,
// resources.ttl, matches.ttl. Resource-type / need-type vocabularies:
// docs/ontology/cbox/resource-types.ttl. SHACL invariants:
// docs/ontology/cbox/needs-shapes.shacl.ttl.
//
// Stays DB-only in v0; promote to on-chain in v1 only for resource
// types where verifiability matters (funding commitments, scripture-
// translation pledges, leadership credentials).

/**
 * NeedOccurrence — the contextual gap right now. Every active gap a
 * group/agent has gets a row. The need-type taxonomy lives in the
 * SKOS C-Box; this table just stores the type *concept URI* so the UI
 * can render labels and the scorer can filter by type.
 */
export const needs = sqliteTable('needs', {
  id: text('id').primaryKey(),
  /** SKOS concept URI — e.g. "needType:CircleCoachNeeded". */
  needType: text('need_type').notNull(),
  /** Cached human label for fast UI rendering. */
  needTypeLabel: text('need_type_label').notNull(),
  /** Address of the agent (org/person/group) that holds the need. */
  neededByAgent: text('needed_by_agent').notNull(),
  /** Optional link back to the DB user that filed the need. */
  neededByUserId: text('needed_by_user_id'),
  /** Hub scope: 'catalyst' | 'cil' | 'global-church' | 'generic'. */
  hubId: text('hub_id').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  priority: text('priority', {
    enum: ['critical', 'high', 'normal', 'low'],
  }).notNull().default('normal'),
  status: text('status', {
    enum: ['open', 'in-progress', 'met', 'cancelled', 'expired'],
  }).notNull().default('open'),
  /** JSON: { role?: string, skill?: string, geo?: string, time?: object, capacity?: object, credential?: string } */
  requirements: text('requirements'),
  /** ISO datetime — after this, status auto-transitions to 'expired'. */
  validUntil: text('valid_until'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

/**
 * ResourceOffering — what an agent has put forward. The agent stays an
 * agent; the offering carries the situational context (geo, time,
 * capacity, capabilities, status). Discover matches NeedOccurrences to
 * Offerings, not to raw Resources.
 */
export const resourceOfferings = sqliteTable('resource_offerings', {
  id: text('id').primaryKey(),
  offeredByAgent: text('offered_by_agent').notNull(),
  offeredByUserId: text('offered_by_user_id'),
  hubId: text('hub_id').notNull(),
  /** SKOS concept URI — e.g. "resourceType:Worker". One of the 12 v0 kinds. */
  resourceType: text('resource_type').notNull(),
  resourceTypeLabel: text('resource_type_label').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  status: text('status', {
    enum: ['available', 'reserved', 'saturated', 'paused', 'withdrawn'],
  }).notNull().default('available'),
  /** JSON: hours-per-week, dollars, count, etc. — type-specific. */
  capacity: text('capacity'),
  /** featureId or place label (e.g. "us/colorado/wellington"). */
  geo: text('geo'),
  /** JSON: { start, end, recurrence } — e.g. { recurrence: "weekly", days: ["mon","wed"] }. */
  timeWindow: text('time_window'),
  /** JSON: [{ skill: string, role: string, level: string, evidence: string }]. */
  capabilities: text('capabilities'),
  validUntil: text('valid_until'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

/**
 * NeedResourceMatch — the bridge artifact. Discover-generated; carries
 * the score, the satisfied/missed requirements, the explanation. UI
 * renders this as the match-detail surface; work-queue aggregator
 * surfaces proposed matches as work items for the matched agent.
 */
export const needResourceMatches = sqliteTable('need_resource_matches', {
  id: text('id').primaryKey(),
  needId: text('need_id').notNull().references(() => needs.id),
  offeringId: text('offering_id').notNull().references(() => resourceOfferings.id),
  /** Convenience cache: who is the offering's agent. */
  matchedAgent: text('matched_agent').notNull(),
  status: text('status', {
    enum: ['proposed', 'accepted', 'rejected', 'stale', 'fulfilled'],
  }).notNull().default('proposed'),
  /** 0..10000 basis points. <2000 not surfaced. <4000 not in default ranked list. */
  score: integer('score').notNull(),
  /** SKOS concept URI — e.g. "matchReason:SkillRoleGeoFit". */
  reason: text('reason').notNull(),
  /** JSON: list of requirement keys the offering satisfies. */
  satisfies: text('satisfies'),
  /** JSON: list of requirement keys the offering does NOT satisfy. */
  misses: text('misses'),
  /** Optional: link back to the DiscoverActivity row in activityLogs. */
  generatedByActivity: text('generated_by_activity'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Intent / BDI Layer ───────────────────────────────────────────
//
// Single Intent class with `direction` (receive | give) and `object`
// (the value flowing) as primary structural fields. Need = Intent
// where direction=receive; Offering = Intent where direction=give.
// The matcher reads ONLY direction + object + topic — the intentType
// taxonomy is a UI label.
//
// T-Box: docs/ontology/tbox/intents.ttl
// SKOS:  docs/ontology/cbox/intent-types.ttl
// SHACL: docs/ontology/cbox/intent-shapes.shacl.ttl

/**
 * Intent — the unifying record above Need and Offering.
 *
 * direction = 'receive' → projects to a `needs` row (when payload fits).
 * direction = 'give'    → projects to a `resource_offerings` row.
 *
 * Free-form intents (e.g. WantToContribute with no concrete offering
 * shape yet) live in `intents` only — `projectionRef` is null.
 */
export const intents = sqliteTable('intents', {
  id: text('id').primaryKey(),
  /** Structural axis 1 — receive | give. Matcher reads this. */
  direction: text('direction', { enum: ['receive', 'give'] }).notNull(),
  /** Structural axis 2 — SKOS URI from cbox/resource-types.ttl
   *  (e.g. 'resourceType:Money', 'resourceType:Worker'). Matcher reads this. */
  object: text('object').notNull(),
  /** Free-text scope — "unreached people groups in NoCo", etc. */
  topic: text('topic'),
  /** UI label only — intentType:NeedCoaching, intentType:OfferIntroduction, etc.
   *  Matcher does NOT branch on this. */
  intentType: text('intent_type').notNull(),
  intentTypeLabel: text('intent_type_label').notNull(),
  expressedByAgent: text('expressed_by_agent').notNull(),
  expressedByUserId: text('expressed_by_user_id'),
  /** addressedTo: 'agent:0x…' | 'hub:catalyst' | 'network:catalyst' | 'self'. */
  addressedTo: text('addressed_to').notNull(),
  hubId: text('hub_id').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  /** JSON payload — direction-typed shape (requirements for receive,
   *  capabilities/capacity for give). */
  payload: text('payload'),
  status: text('status', {
    enum: ['drafted', 'expressed', 'acknowledged', 'in-progress', 'fulfilled', 'withdrawn', 'abandoned'],
  }).notNull().default('expressed'),
  priority: text('priority', { enum: ['critical', 'high', 'normal', 'low'] }).notNull().default('normal'),
  visibility: text('visibility', { enum: ['public', 'public-coarse', 'private', 'off-chain'] }).notNull().default('public'),
  /** Outcome JSON — { description, metric, status } cached on the intent
   *  for fast UI; full Outcome rows live in `outcomes`. */
  expectedOutcome: text('expected_outcome'),
  /** Soft FK back to needs.id (when direction='receive') or
   *  resource_offerings.id (when direction='give'). The projection. */
  projectionRef: text('projection_ref'),
  validUntil: text('valid_until'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

/** Outcome — the success criterion an intent commits to. */
export const outcomes = sqliteTable('outcomes', {
  id: text('id').primaryKey(),
  intentId: text('intent_id').notNull().references(() => intents.id),
  description: text('description').notNull(),
  /** JSON: { kind: 'count'|'boolean'|'date'|'narrative', target: any, observed?: any }. */
  metric: text('metric').notNull(),
  status: text('status', { enum: ['pending', 'partial', 'achieved', 'not-achieved'] }).notNull().default('pending'),
  observedAt: text('observed_at'),
  observedBy: text('observed_by'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

/** OrchestrationPlan — decomposes a parent intent into sub-intents
 *  routed to different agents. Replaces a CollaborationIntent class. */
export const orchestrationPlans = sqliteTable('orchestration_plans', {
  id: text('id').primaryKey(),
  parentIntentId: text('parent_intent_id').notNull().references(() => intents.id),
  authorAgent: text('author_agent').notNull(),
  /** JSON: { steps: [{ subIntentId, dependsOn?: [subIntentId], targetAgent }], rationale }. */
  blueprint: text('blueprint').notNull(),
  status: text('status', { enum: ['draft', 'active', 'paused', 'completed', 'abandoned'] }).notNull().default('active'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

/** Belief — light wrapper over AgentAssertion. Most beliefs are on
 *  chain; this table is for off-chain working beliefs that inform
 *  intent expression but don't yet warrant an Assertion mint. */
export const beliefs = sqliteTable('beliefs', {
  id: text('id').primaryKey(),
  heldByAgent: text('held_by_agent').notNull(),
  /** Optional: backing AgentAssertion id from the on-chain contract. */
  assertionId: text('assertion_id'),
  statement: text('statement').notNull(),
  /** Confidence 0..100 — 100 = held with certainty. */
  confidence: integer('confidence').notNull().default(75),
  /** Optional FK — a belief that informs / supplies rationale for an intent. */
  informsIntentId: text('informs_intent_id'),
  validUntil: text('valid_until'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Entitlement / Fulfillment Layer ─────────────────────────────
//
// The workflow that lives between an accepted IntentMatch and the
// achievement of an Outcome. Capacity, cadence, work items, activities.
// Per-resource-type capacity-unit defaults live at
// `packages/sdk/src/capacity-defaults.ts`.
//
// T-Box: docs/ontology/tbox/entitlements.ttl
// SKOS:  docs/ontology/cbox/capacity-units.ttl
// SHACL: docs/ontology/cbox/entitlement-shapes.shacl.ttl

/**
 * Entitlement — a granted right by Provider to Holder, anchored to an
 * accepted IntentMatch. Carries terms, capacity, cadence, status.
 *
 * One Entitlement per accepted match. An Intent can be jointly fulfilled
 * by multiple Entitlements; the Intent reaches `fulfilled` only when ALL
 * of its accepted entitlements are fulfilled (per the user's design call).
 */
export const entitlements = sqliteTable('entitlements', {
  id: text('id').primaryKey(),
  /** Soft FK back to need_resource_matches.id. */
  sourceMatchId: text('source_match_id').notNull(),
  /** The intent being fulfilled (receive-shaped). */
  holderIntentId: text('holder_intent_id').notNull(),
  /** The intent providing the resource (give-shaped). */
  providerIntentId: text('provider_intent_id').notNull(),
  holderAgent: text('holder_agent').notNull(),
  providerAgent: text('provider_agent').notNull(),
  hubId: text('hub_id').notNull(),
  /** JSON: { object, topic, role?, skill?, geo?, scope, conditions? } */
  terms: text('terms').notNull(),
  /** SKOS URI from cbox/capacity-units.ttl — e.g. 'capacityUnit:HoursPerWeek'. */
  capacityUnit: text('capacity_unit').notNull(),
  /** Total capacity granted at mint time. */
  capacityGranted: integer('capacity_granted').notNull(),
  /** Capacity remaining; clamped to zero on consume. */
  capacityRemaining: integer('capacity_remaining').notNull(),
  cadence: text('cadence', {
    enum: ['one-shot', 'weekly', 'biweekly', 'monthly', 'quarterly', 'on-demand'],
  }).notNull().default('weekly'),
  /** Cached link to the outcome row this entitlement helps achieve. */
  linkedOutcomeId: text('linked_outcome_id'),
  status: text('status', {
    enum: ['granted', 'active', 'paused', 'suspended', 'fulfilled', 'revoked', 'expired'],
  }).notNull().default('granted'),
  validFrom: text('valid_from').notNull(),
  validUntil: text('valid_until'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

/**
 * FulfillmentWorkItem — a unit of action attached to an entitlement.
 * Shared: `assigneeAgent` is the *primary* actor (routes notifications,
 * counts on the assignee's dashboard) but EITHER party can resolve it.
 */
export const fulfillmentWorkItems = sqliteTable('fulfillment_work_items', {
  id: text('id').primaryKey(),
  entitlementId: text('entitlement_id').notNull().references(() => entitlements.id),
  /** PRIMARY actor — for routing. Either party may resolve. */
  assigneeAgent: text('assignee_agent').notNull(),
  /** SKOS URI: 'taskKind:ScheduleSession' etc. */
  taskKind: text('task_kind').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  /** Recurring items spawn next instances when previous resolves. */
  cadence: text('cadence', { enum: ['one-shot', 'recurring'] }).notNull().default('one-shot'),
  dueAt: text('due_at'),
  /** Soft FK to activity_logs.id; populated when resolved. */
  resolvedByActivityId: text('resolved_by_activity_id'),
  status: text('status', {
    enum: ['open', 'in-progress', 'done', 'skipped'],
  }).notNull().default('open'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

/**
 * RoleAssignment — time-bound situational role-play. Replaces
 * "Kenji a role:Coach" with "Kenji plays Coach FOR Rachel IN this
 * pathway DURING this window". Created automatically when a match is
 * accepted; lapsed/ended manually or on validUntil.
 */
export const roleAssignments = sqliteTable('role_assignments', {
  id: text('id').primaryKey(),
  bearerAgent: text('bearer_agent').notNull(),
  /** Role hash — matches the AgentRelationship taxonomy in packages/sdk. */
  rolePlayed: text('role_played').notNull(),
  /** Pathway / Group / Hub address — the context the role is played within. */
  contextEntity: text('context_entity').notNull(),
  /** Optional: the agent the role is played FOR (e.g. Rachel for Kenji-as-Coach). */
  targetAgent: text('target_agent'),
  /** Link back to the match that established this assignment, if any. */
  sourceMatchId: text('source_match_id'),
  /** Link back to the entitlement that established this assignment. */
  sourceEntitlementId: text('source_entitlement_id'),
  startsAt: text('starts_at'),
  endsAt: text('ends_at'),
  status: text('status', {
    enum: ['active', 'lapsed', 'ended'],
  }).notNull().default('active'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})
