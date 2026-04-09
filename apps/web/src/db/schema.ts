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
