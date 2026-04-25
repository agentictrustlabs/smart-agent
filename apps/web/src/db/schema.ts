import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// ─── Users ───────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  name: text('name').notNull(),
  walletAddress: text('wallet_address').notNull().unique(),
  privyUserId: text('privy_user_id').unique(),
  /** Private key for demo users (hex, 0x-prefixed). Null for Privy users. */
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
// The only DB table for agents is `users` (Privy auth → wallet mapping).
// Agent lookup: resolver (name/type) + edges (relationships) + ATL_CONTROLLER (wallet→agent).
// ─── Passkeys ────────────────────────────────────────────────────────
//
// Server-side mirror of every passkey registered on a user's smart account.
// The on-chain `_passkeys[digest]` entry only stores the SHA-keccak digest
// of the credentialId — we can't reverse that to get the actual credentialId
// bytes the OS authenticator needs in `allowCredentials`. Mirroring lets the
// passkey-signed UserOp flows (recovery, repair) constrain the OS picker to
// only credentials actually registered on the account, which is essential
// for users on a fresh browser where localStorage hints are empty.

export const passkeys = sqliteTable('passkeys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  /** Smart-account address the passkey is registered on. */
  accountAddress: text('account_address').notNull(),
  /** WebAuthn credentialId, base64url-encoded — what we hand the OS picker. */
  credentialIdBase64Url: text('credential_id_base64url').notNull().unique(),
  /** keccak256 of the raw credentialId bytes — matches `_passkeys[digest]`. */
  credentialIdDigest: text('credential_id_digest').notNull(),
  /** P-256 public key components (decimal strings — bigints serialised). */
  pubKeyX: text('pub_key_x').notNull(),
  pubKeyY: text('pub_key_y').notNull(),
  /** Optional label set at enrollment time. */
  label: text('label'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

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
