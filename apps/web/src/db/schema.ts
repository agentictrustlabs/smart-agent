import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// ─── Users ───────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  name: text('name').notNull(),
  walletAddress: text('wallet_address').notNull().unique(),
  privyUserId: text('privy_user_id').unique(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ═══════════════════════════════════════════════════════════════════════
// All agent identity, relationships, and metadata are ON-CHAIN.
// The only DB table for agents is `users` (Privy auth → wallet mapping).
// Agent lookup: resolver (name/type) + edges (relationships) + ATL_CONTROLLER (wallet→agent).
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
    ],
  }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  read: integer('read').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})
