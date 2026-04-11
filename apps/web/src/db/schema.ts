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

// ─── Capital Movements (general-purpose treasury tracking) ──────────

export const capitalMovements = sqliteTable('capital_movements', {
  id: text('id').primaryKey(),
  /** Treasury agent address */
  treasuryAgent: text('treasury_agent').notNull(),
  /** deploy | collect | fund | return */
  direction: text('direction', { enum: ['deploy', 'collect', 'fund', 'return'] }).notNull(),
  /** Counterparty org/person address */
  counterparty: text('counterparty').notNull(),
  /** Amount in smallest unit (wei for ETH, cents for fiat) */
  amount: text('amount').notNull(),
  currency: text('currency').notNull().default('ETH'),
  purpose: text('purpose'),
  /** User who authorized the movement */
  authorizedBy: text('authorized_by').references(() => users.id),
  txHash: text('tx_hash'),
  status: text('status', { enum: ['pending', 'confirmed', 'failed'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Training Modules & Completions ─────────────────────────────────

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

export const trainingCompletions = sqliteTable('training_completions', {
  id: text('id').primaryKey(),
  /** User who completed the training */
  userId: text('user_id').notNull().references(() => users.id),
  moduleId: text('module_id').notNull().references(() => trainingModules.id),
  /** Assessor who verified completion */
  assessedBy: text('assessed_by').references(() => users.id),
  score: integer('score'),
  notes: text('notes'),
  completedAt: text('completed_at').notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Governance Proposals & Votes ───────────────────────────────────

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

export const votes = sqliteTable('votes', {
  id: text('id').primaryKey(),
  proposalId: text('proposal_id').notNull().references(() => proposals.id),
  voter: text('voter').notNull().references(() => users.id),
  vote: text('vote', { enum: ['for', 'against', 'abstain'] }).notNull(),
  comment: text('comment'),
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
