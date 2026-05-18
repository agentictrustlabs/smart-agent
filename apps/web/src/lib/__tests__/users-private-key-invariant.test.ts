/**
 * Tests for the S2.5(a) production invariant — `local_user_accounts.private_key`
 * MUST be null on every row when running with `NODE_ENV=production` (and
 * without the `SMART_AGENT_ENV=dev` override).
 *
 * Two helpers are tested:
 *   - `assertNoDemoPrivateKeysInProd()`  — boot-time DB scan
 *   - `assertPrivateKeyAccessAllowed()`  — defence-in-depth, called by any
 *                                          data-access helper that surfaces
 *                                          the column to a caller
 *
 * The DB-bound helper uses an in-memory SQLite (DATABASE_URL=":memory:")
 * so the test never touches a real on-disk database.
 */
import { describe, it, before, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'

const env = process.env as Record<string, string | undefined>

// Point the DB at an in-memory SQLite BEFORE any `@/db` import resolves.
// Has to land at module-eval time of this test file because boot-seed.ts
// dynamically imports `@/db` inside the assertion helper, and that
// import is cached on first use. esbuild's cjs target rejects top-level
// await, so the imports happen inside `before()` and are held in
// module-scoped lets bound at first test setup.
const ORIG_DATABASE_URL = env.DATABASE_URL
env.DATABASE_URL = ':memory:'

type BootSeedModule = typeof import('../boot-seed')
type DbModule = typeof import('@/db')

let bootSeed: BootSeedModule
let db: DbModule['db']
let schema: DbModule['schema']

const ORIG_NODE_ENV = env.NODE_ENV
const ORIG_SA_ENV = env.SMART_AGENT_ENV

describe('S2.5(a) — users.private_key production invariant', () => {
  // Ensure the table exists in the fresh in-memory DB so inserts succeed.
  // The db module auto-runs migrations against `process.cwd()/drizzle`,
  // but in CI / weirdly-rooted test runners that directory may not be
  // discoverable. Create the table explicitly here as a safety net.
  before(async () => {
    bootSeed = await import('../boot-seed')
    const dbMod = await import('@/db')
    db = dbMod.db
    schema = dbMod.schema
    // drizzle's better-sqlite3 driver exposes `db.$client` for raw SQL.
    ;(db as unknown as { $client: { exec: (sql: string) => void } }).$client.exec(`
      CREATE TABLE IF NOT EXISTS local_user_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT,
        name TEXT NOT NULL,
        wallet_address TEXT NOT NULL UNIQUE,
        did TEXT UNIQUE,
        private_key TEXT,
        smart_account_address TEXT,
        person_agent_address TEXT,
        agent_name TEXT,
        onboarded_at TEXT,
        account_salt_rotation INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `)
  })

  beforeEach(() => {
    // Wipe between tests so row presence is deterministic.
    ;(db as unknown as { $client: { exec: (sql: string) => void } }).$client.exec(
      'DELETE FROM local_user_accounts',
    )
    delete env.NODE_ENV
    delete env.SMART_AGENT_ENV
  })

  afterEach(() => {
    if (ORIG_NODE_ENV === undefined) delete env.NODE_ENV
    else env.NODE_ENV = ORIG_NODE_ENV
    if (ORIG_SA_ENV === undefined) delete env.SMART_AGENT_ENV
    else env.SMART_AGENT_ENV = ORIG_SA_ENV
  })

  after(() => {
    if (ORIG_DATABASE_URL === undefined) delete env.DATABASE_URL
    else env.DATABASE_URL = ORIG_DATABASE_URL
  })

  describe('assertNoDemoPrivateKeysInProd', () => {
    it('THROWS in production when a row carries a non-null private_key', async () => {
      env.NODE_ENV = 'production'

      await db.insert(schema.localUserAccounts).values({
        id: 'demo-bad-row',
        name: 'Demo User',
        walletAddress: '0xdeadbeef00000000000000000000000000000001',
        did: 'did:demo:bad-001',
        privateKey: '0x' + '11'.repeat(32),
        createdAt: new Date().toISOString(),
      })

      await assert.rejects(
        () => bootSeed.assertNoDemoPrivateKeysInProd(),
        (err: Error) => {
          // Should be the typed error class so callers can match on it.
          assert.equal(err.name, 'DemoPrivateKeyInProductionError')
          assert.match(err.message, /Refusing to start/)
          assert.match(err.message, /private_key/)
          return true
        },
      )
    })

    it('ALLOWS startup in production when every row has null private_key', async () => {
      env.NODE_ENV = 'production'

      await db.insert(schema.localUserAccounts).values({
        id: 'google-user-1',
        name: 'Google User',
        walletAddress: '0xdeadbeef00000000000000000000000000000002',
        did: 'did:google:user-1',
        privateKey: null,  // explicit null — no demo key
        createdAt: new Date().toISOString(),
      })

      await assert.doesNotReject(() => bootSeed.assertNoDemoPrivateKeysInProd())
    })

    it('SKIPS the check entirely outside production', async () => {
      env.NODE_ENV = 'development'

      await db.insert(schema.localUserAccounts).values({
        id: 'dev-demo-1',
        name: 'Dev Demo',
        walletAddress: '0xdeadbeef00000000000000000000000000000003',
        did: 'did:demo:dev-001',
        privateKey: '0x' + '22'.repeat(32),
        createdAt: new Date().toISOString(),
      })

      // Demo keys are FINE in dev — that's literally what they're for.
      await assert.doesNotReject(() => bootSeed.assertNoDemoPrivateKeysInProd())
    })

    it('honours SMART_AGENT_ENV=dev override on prod NODE_ENV', async () => {
      env.NODE_ENV = 'production'
      env.SMART_AGENT_ENV = 'dev'

      await db.insert(schema.localUserAccounts).values({
        id: 'staging-demo',
        name: 'Staging Demo',
        walletAddress: '0xdeadbeef00000000000000000000000000000004',
        did: 'did:demo:staging',
        privateKey: '0x' + '33'.repeat(32),
        createdAt: new Date().toISOString(),
      })

      await assert.doesNotReject(() => bootSeed.assertNoDemoPrivateKeysInProd())
    })
  })

  describe('assertPrivateKeyAccessAllowed (defence-in-depth)', () => {
    it('throws in production when called with a non-null privateKey', () => {
      env.NODE_ENV = 'production'
      assert.throws(
        () => bootSeed.assertPrivateKeyAccessAllowed('0xdeadbeef'),
        /Refusing to start/,
      )
    })

    it('is a no-op in production when the privateKey value is null', () => {
      env.NODE_ENV = 'production'
      assert.doesNotThrow(() => bootSeed.assertPrivateKeyAccessAllowed(null))
      assert.doesNotThrow(() => bootSeed.assertPrivateKeyAccessAllowed(undefined))
    })

    it('is a no-op in development regardless of privateKey value', () => {
      env.NODE_ENV = 'development'
      assert.doesNotThrow(() => bootSeed.assertPrivateKeyAccessAllowed('0xdeadbeef'))
    })
  })
})
