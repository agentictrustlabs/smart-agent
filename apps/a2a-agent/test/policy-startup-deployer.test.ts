/**
 * Sprint 5 Wave 2 — P0-9 — DEPLOYER_PRIVATE_KEY policy.
 *
 * Exercises the pure `validateDeployerKey` validator across every
 * branch of the production / break-glass matrix, plus the wrapping
 * `assertDeployerKeyPolicy` helper for the audit-row side-effect of
 * the break-glass-active branch.
 *
 *   - dev: key set                                → no throw, decision=dev-key
 *   - prod: no key                                → no throw, decision=no-key
 *   - prod: key set, no break-glass               → throws naming DEPLOYER_PRIVATE_KEY
 *   - prod: key set, break-glass in past          → throws naming the past timestamp
 *   - prod: key set, break-glass in future        → permits, writes audit row
 *   - prod: key set, break-glass malformed        → throws naming format error
 *
 * Pure-function pattern follows test/config-invariants.test.ts so the
 * test does not have to mutate global `process.env`.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/policy-startup-deployer.test.ts`
 */

// Configure env BEFORE importing app code so the audit module's db init
// finds a valid local-aes secret.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = '0x' + 'd'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desc, eq } from 'drizzle-orm'
import {
  validateDeployerKey,
  assertDeployerKeyPolicy,
} from '../src/lib/policy-startup'
import { db } from '../src/db'
import { executionAudit } from '../src/db/schema'

const NOW = new Date('2026-05-17T12:00:00Z')

// ─── validateDeployerKey — pure validator ───────────────────────────

test('dev: DEPLOYER_PRIVATE_KEY set → decision=dev-key, no throw', () => {
  const out = validateDeployerKey(
    {
      NODE_ENV: 'development',
      DEPLOYER_PRIVATE_KEY: '0x' + 'a'.repeat(64),
    },
    NOW,
  )
  assert.equal(out.decision, 'dev-key')
})

test('prod: no DEPLOYER_PRIVATE_KEY → decision=no-key, no throw', () => {
  const out = validateDeployerKey(
    {
      NODE_ENV: 'production',
    },
    NOW,
  )
  assert.equal(out.decision, 'no-key')
})

test('prod: empty DEPLOYER_PRIVATE_KEY → decision=no-key, no throw', () => {
  const out = validateDeployerKey(
    {
      NODE_ENV: 'production',
      DEPLOYER_PRIVATE_KEY: '',
    },
    NOW,
  )
  assert.equal(out.decision, 'no-key')
})

test('prod: DEPLOYER_PRIVATE_KEY set, no break-glass → throws naming DEPLOYER_PRIVATE_KEY + ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL', () => {
  assert.throws(
    () =>
      validateDeployerKey(
        {
          NODE_ENV: 'production',
          DEPLOYER_PRIVATE_KEY: '0x' + 'a'.repeat(64),
        },
        NOW,
      ),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /DEPLOYER_PRIVATE_KEY/)
      assert.match(msg, /ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL/)
      return true
    },
  )
})

test('prod: DEPLOYER_PRIVATE_KEY set + ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL in the past → throws naming the past timestamp', () => {
  const past = '2026-01-01T00:00:00Z'
  assert.throws(
    () =>
      validateDeployerKey(
        {
          NODE_ENV: 'production',
          DEPLOYER_PRIVATE_KEY: '0x' + 'a'.repeat(64),
          ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL: past,
        },
        NOW,
      ),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /in the past/)
      assert.match(msg, new RegExp(past))
      return true
    },
  )
})

test('prod: DEPLOYER_PRIVATE_KEY set + ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL in the future → decision=break-glass-active', () => {
  const future = '2026-12-31T00:00:00Z'
  const out = validateDeployerKey(
    {
      NODE_ENV: 'production',
      DEPLOYER_PRIVATE_KEY: '0x' + 'a'.repeat(64),
      ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL: future,
    },
    NOW,
  )
  assert.equal(out.decision, 'break-glass-active')
  assert.equal(out.breakGlassUntil?.toISOString(), '2026-12-31T00:00:00.000Z')
})

test('prod: DEPLOYER_PRIVATE_KEY set + ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL malformed → throws naming format error', () => {
  assert.throws(
    () =>
      validateDeployerKey(
        {
          NODE_ENV: 'production',
          DEPLOYER_PRIVATE_KEY: '0x' + 'a'.repeat(64),
          ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL: 'not-a-timestamp',
        },
        NOW,
      ),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL/)
      assert.match(msg, /malformed/)
      assert.match(msg, /ISO-8601/)
      return true
    },
  )
})

// ─── assertDeployerKeyPolicy — top-level helper with audit side-effect ──

test('assertDeployerKeyPolicy: prod + break-glass active → writes system:break-glass-deployer-key audit row', async () => {
  // Pin the chain head id BEFORE the assert so we can find the new row.
  const before = await db
    .select({ id: executionAudit.id })
    .from(executionAudit)
    .orderBy(desc(executionAudit.id))
    .limit(1)
  const beforeId = before[0]?.id ?? 0

  const future = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  const decision = await assertDeployerKeyPolicy({
    NODE_ENV: 'production',
    DEPLOYER_PRIVATE_KEY: '0x' + 'a'.repeat(64),
    ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL: future,
  })
  assert.equal(decision, 'break-glass-active')

  // Find the new row.
  const after = await db
    .select()
    .from(executionAudit)
    .where(eq(executionAudit.mcpTool, 'system:break-glass-deployer-key'))
    .orderBy(desc(executionAudit.id))
    .limit(1)
  assert.equal(after.length, 1)
  assert.ok(after[0]!.id > beforeId, 'new break-glass audit row was inserted')
  assert.equal(after[0]!.mcpServer, 'system')
  assert.match(after[0]!.errorReason ?? '', /break-glass active until/)
})

test('assertDeployerKeyPolicy: no key → no audit row written', async () => {
  const before = await db
    .select({ id: executionAudit.id })
    .from(executionAudit)
    .where(eq(executionAudit.mcpTool, 'system:break-glass-deployer-key'))
    .orderBy(desc(executionAudit.id))
    .limit(1)
  const beforeId = before[0]?.id ?? 0

  const decision = await assertDeployerKeyPolicy({
    NODE_ENV: 'production',
  })
  assert.equal(decision, 'no-key')

  const after = await db
    .select({ id: executionAudit.id })
    .from(executionAudit)
    .where(eq(executionAudit.mcpTool, 'system:break-glass-deployer-key'))
    .orderBy(desc(executionAudit.id))
    .limit(1)
  const afterId = after[0]?.id ?? 0
  assert.equal(afterId, beforeId, 'no new break-glass row when key is absent')
})
