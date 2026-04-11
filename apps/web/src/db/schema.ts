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

// ─── Person Agents (individual user 4337 accounts) ──────────────────

export const personAgents = sqliteTable('person_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default('Person Agent'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id)
    .unique(),
  smartAccountAddress: text('smart_account_address').notNull(),
  chainId: integer('chain_id').notNull(),
  salt: text('salt').notNull(),
  implementationType: text('implementation_type', {
    enum: ['hybrid', 'multisig', 'stateless7702'],
  })
    .notNull()
    .default('hybrid'),
  status: text('status', {
    enum: ['pending', 'deployed', 'failed'],
  })
    .notNull()
    .default('pending'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ─── Org Agents (organization 4337 accounts) ────────────────────────

export const orgAgents = sqliteTable('org_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  smartAccountAddress: text('smart_account_address').notNull(),
  templateId: text('template_id'), // org template used (e.g., 'grant-org', 'service-business')
  chainId: integer('chain_id').notNull(),
  salt: text('salt').notNull(),
  implementationType: text('implementation_type', {
    enum: ['hybrid', 'multisig', 'stateless7702'],
  })
    .notNull()
    .default('hybrid'),
  status: text('status', {
    enum: ['pending', 'deployed', 'failed'],
  })
    .notNull()
    .default('pending'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ─── AI Agents (autonomous AI agent 4337 accounts) ──────────────────

export const aiAgents = sqliteTable('ai_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  agentType: text('agent_type', {
    enum: ['discovery', 'assistant', 'executor', 'validator', 'oracle', 'custom'],
  }).notNull().default('custom'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  operatedBy: text('operated_by'), // org agent address that operates this AI agent
  smartAccountAddress: text('smart_account_address').notNull(),
  chainId: integer('chain_id').notNull(),
  salt: text('salt').notNull(),
  implementationType: text('implementation_type', {
    enum: ['hybrid', 'multisig', 'stateless7702'],
  })
    .notNull()
    .default('hybrid'),
  status: text('status', {
    enum: ['pending', 'deployed', 'failed'],
  })
    .notNull()
    .default('pending'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

// ─── Review Records (maps on-chain reviewId to actual reviewer) ──────

export const reviewRecords = sqliteTable('review_records', {
  id: text('id').primaryKey(),
  onChainReviewId: integer('on_chain_review_id'),
  reviewerUserId: text('reviewer_user_id').notNull().references(() => users.id),
  reviewerAgentAddress: text('reviewer_agent_address').notNull(),
  subjectAddress: text('subject_address').notNull(),
  reviewType: text('review_type').notNull(),
  recommendation: text('recommendation').notNull(),
  overallScore: integer('overall_score').notNull(),
  comment: text('comment'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Review Delegations (delegation chain for reviewer→subject) ─────

export const reviewDelegations = sqliteTable('review_delegations', {
  id: text('id').primaryKey(),
  /** Reviewer's person agent smart account address (delegate) */
  reviewerAgentAddress: text('reviewer_agent_address').notNull(),
  /** Subject agent smart account address (delegator) */
  subjectAgentAddress: text('subject_agent_address').notNull(),
  /** The relationship edge ID that authorized this delegation */
  edgeId: text('edge_id').notNull(),
  /** Serialized Delegation struct (JSON with signature) */
  delegationJson: text('delegation_json').notNull(),
  /** Salt used for this delegation */
  salt: text('salt').notNull(),
  /** When the delegation expires (from TimestampEnforcer) */
  expiresAt: text('expires_at').notNull(),
  status: text('status', { enum: ['active', 'expired', 'revoked', 'used'] })
    .notNull()
    .default('active'),
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
