/**
 * Sprint 5 W3 P0-7 — legacy session-bearer break-glass observability.
 *
 * Exercises:
 *   - `resolveLegacySessionPolicy` — pure resolver across the dev/prod
 *     × default/explicit matrix. Confirms `breakGlass` is only true when
 *     `NODE_ENV='production'` AND `ALLOW_LEGACY_A2A_SESSIONS='true'`
 *     EXPLICITLY (the dev default-on case is NOT a break-glass).
 *   - `assertLegacySessionPolicy` — top-level helper that writes
 *     `system:break-glass-legacy-a2a-sessions` to `execution_audit`
 *     on the break-glass branch.
 *   - Hash-chain integrity: the entry_hash of the break-glass row binds
 *     the env var name + value so tampering with either breaks the chain.
 *
 * Pure-function pattern follows test/policy-startup-deployer.test.ts so
 * the test does not have to mutate global `process.env`.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/policy-startup-legacy-sessions.test.ts`
 */

// Configure env BEFORE importing app code so the audit module's db init
// finds a valid local-aes secret.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = '0x' + 'd'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desc, eq } from 'drizzle-orm'
import {
  resolveLegacySessionPolicy,
  assertLegacySessionPolicy,
} from '../src/lib/policy-startup'
import { computeEntryHash } from '../src/lib/audit'
import { db } from '../src/db'
import { executionAudit } from '../src/db/schema'

// ─── resolveLegacySessionPolicy — pure resolver ─────────────────────

test('dev + ALLOW_LEGACY_A2A_SESSIONS unset → enabled=true, breakGlass=false (dev default permits)', () => {
  const out = resolveLegacySessionPolicy({ NODE_ENV: 'development' })
  assert.equal(out.enabled, true)
  assert.equal(out.breakGlass, false)
  assert.match(out.reason, /development default/)
})

test("dev + ALLOW_LEGACY_A2A_SESSIONS='true' → enabled=true, breakGlass=false (dev override is NOT a break-glass)", () => {
  const out = resolveLegacySessionPolicy({
    NODE_ENV: 'development',
    ALLOW_LEGACY_A2A_SESSIONS: 'true',
  })
  assert.equal(out.enabled, true)
  assert.equal(out.breakGlass, false)
})

test("dev + ALLOW_LEGACY_A2A_SESSIONS='false' → enabled=false, breakGlass=false", () => {
  const out = resolveLegacySessionPolicy({
    NODE_ENV: 'development',
    ALLOW_LEGACY_A2A_SESSIONS: 'false',
  })
  assert.equal(out.enabled, false)
  assert.equal(out.breakGlass, false)
})

test('prod + ALLOW_LEGACY_A2A_SESSIONS unset → enabled=false, breakGlass=false (prod default refuses)', () => {
  const out = resolveLegacySessionPolicy({ NODE_ENV: 'production' })
  assert.equal(out.enabled, false)
  assert.equal(out.breakGlass, false)
  assert.match(out.reason, /refused/)
})

test("prod + ALLOW_LEGACY_A2A_SESSIONS='false' → enabled=false, breakGlass=false", () => {
  const out = resolveLegacySessionPolicy({
    NODE_ENV: 'production',
    ALLOW_LEGACY_A2A_SESSIONS: 'false',
  })
  assert.equal(out.enabled, false)
  assert.equal(out.breakGlass, false)
})

test("prod + ALLOW_LEGACY_A2A_SESSIONS='true' → enabled=true, breakGlass=true (operator override)", () => {
  const out = resolveLegacySessionPolicy({
    NODE_ENV: 'production',
    ALLOW_LEGACY_A2A_SESSIONS: 'true',
  })
  assert.equal(out.enabled, true)
  assert.equal(out.breakGlass, true)
  assert.match(out.reason, /operator override/)
  assert.match(out.reason, /ALLOW_LEGACY_A2A_SESSIONS/)
})

test('malformed ALLOW_LEGACY_A2A_SESSIONS → throws', () => {
  assert.throws(
    () =>
      resolveLegacySessionPolicy({
        NODE_ENV: 'production',
        ALLOW_LEGACY_A2A_SESSIONS: 'maybe',
      }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /ALLOW_LEGACY_A2A_SESSIONS/)
      assert.match(msg, /true.*false/)
      return true
    },
  )
})

// ─── assertLegacySessionPolicy — startup audit side-effect ──────────

async function getLatestBreakGlassRow() {
  const rows = await db
    .select()
    .from(executionAudit)
    .where(eq(executionAudit.mcpTool, 'system:break-glass-legacy-a2a-sessions'))
    .orderBy(desc(executionAudit.id))
    .limit(1)
  return rows[0]
}

async function getLatestBreakGlassRowId() {
  const row = await getLatestBreakGlassRow()
  return row?.id ?? 0
}

test('assertLegacySessionPolicy: prod + ALLOW_LEGACY_A2A_SESSIONS unset → no break-glass row written', async () => {
  const beforeId = await getLatestBreakGlassRowId()
  const policy = await assertLegacySessionPolicy({ NODE_ENV: 'production' })
  assert.equal(policy.enabled, false)
  assert.equal(policy.breakGlass, false)
  const afterId = await getLatestBreakGlassRowId()
  assert.equal(afterId, beforeId, 'no break-glass row when env var is unset')
})

test("assertLegacySessionPolicy: prod + ALLOW_LEGACY_A2A_SESSIONS='false' → no break-glass row written", async () => {
  const beforeId = await getLatestBreakGlassRowId()
  const policy = await assertLegacySessionPolicy({
    NODE_ENV: 'production',
    ALLOW_LEGACY_A2A_SESSIONS: 'false',
  })
  assert.equal(policy.enabled, false)
  assert.equal(policy.breakGlass, false)
  const afterId = await getLatestBreakGlassRowId()
  assert.equal(afterId, beforeId, "no break-glass row when env var is 'false'")
})

test("assertLegacySessionPolicy: prod + ALLOW_LEGACY_A2A_SESSIONS='true' → writes system:break-glass-legacy-a2a-sessions row", async () => {
  const beforeId = await getLatestBreakGlassRowId()
  const policy = await assertLegacySessionPolicy({
    NODE_ENV: 'production',
    ALLOW_LEGACY_A2A_SESSIONS: 'true',
  })
  assert.equal(policy.enabled, true)
  assert.equal(policy.breakGlass, true)

  const row = await getLatestBreakGlassRow()
  assert.ok(row, 'break-glass audit row was inserted')
  assert.ok(row!.id > beforeId, 'new break-glass row id is greater than before')
  assert.equal(row!.mcpServer, 'system')
  assert.equal(row!.mcpTool, 'system:break-glass-legacy-a2a-sessions')

  // Body carries the env var name + value + boot timestamp.
  const body = JSON.parse(row!.errorReason ?? '{}') as Record<string, string>
  assert.equal(body.envVar, 'ALLOW_LEGACY_A2A_SESSIONS')
  assert.equal(body.envValue, 'true')
  assert.ok(body.bootTimestamp, 'bootTimestamp present')
  assert.match(body.bootTimestamp, /^\d{4}-\d{2}-\d{2}T/)
  assert.match(body.reason, /operator override/)
})

test("assertLegacySessionPolicy: dev + ALLOW_LEGACY_A2A_SESSIONS='true' → no break-glass row (dev default, not operator override)", async () => {
  const beforeId = await getLatestBreakGlassRowId()
  const policy = await assertLegacySessionPolicy({
    NODE_ENV: 'development',
    ALLOW_LEGACY_A2A_SESSIONS: 'true',
  })
  assert.equal(policy.enabled, true)
  assert.equal(policy.breakGlass, false)
  const afterId = await getLatestBreakGlassRowId()
  assert.equal(afterId, beforeId, 'no break-glass row in development')
})

test("assertLegacySessionPolicy: break-glass row entry_hash binds the env var name + value (hash-chain integrity)", async () => {
  // Pin chain state first by writing a fresh row.
  await assertLegacySessionPolicy({
    NODE_ENV: 'production',
    ALLOW_LEGACY_A2A_SESSIONS: 'true',
  })
  const row = await getLatestBreakGlassRow()
  assert.ok(row, 'break-glass row exists')

  // Recompute the entry_hash from the row's persisted fields and confirm
  // it matches the stored entry_hash. If we then mutate the errorReason
  // (which carries envVar+envValue) the recomputed hash MUST differ.
  const rowForHash = {
    rootGrantHash: row!.rootGrantHash ?? '',
    sessionId: row!.sessionId,
    sessionPrincipal: row!.sessionPrincipal,
    a2aTaskId: row!.a2aTaskId ?? '',
    mcpServer: row!.mcpServer,
    mcpTool: row!.mcpTool,
    mcpCallId: row!.mcpCallId,
    eventType: row!.eventType ?? 'execution',
    eventKind: row!.eventKind ?? 'request_received',
    requestReceivedRowId: row!.requestReceivedRowId ?? null,
    executionPath: row!.executionPath,
    toolGrantHash: row!.toolGrantHash ?? null,
    toolExecutor: row!.toolExecutor ?? null,
    target: row!.target ?? null,
    selector: row!.selector ?? null,
    callDataHash: row!.callDataHash ?? null,
    valueWei: row!.valueWei ?? '0',
    txHash: row!.txHash ?? null,
    userOpHash: row!.userOpHash ?? null,
    status: row!.status,
    errorReason: row!.errorReason ?? '',
    receivedAt: row!.receivedAt,
    finalizedAt: row!.finalizedAt ?? null,
    correlationId: row!.correlationId ?? null,
  }
  const recomputed = computeEntryHash(rowForHash, row!.prevEntryHash ?? null)
  assert.equal(
    recomputed,
    row!.entryHash,
    'recomputed entry_hash matches persisted entry_hash',
  )

  // Tamper: flip the env value inside the body — the recomputed hash MUST
  // differ. This proves the env-var name + value are bound into the chain.
  const tamperedBody = JSON.parse(rowForHash.errorReason) as Record<
    string,
    string
  >
  tamperedBody.envValue = 'false'
  const tamperedRow = {
    ...rowForHash,
    errorReason: JSON.stringify(tamperedBody),
  }
  const tamperedHash = computeEntryHash(tamperedRow, row!.prevEntryHash ?? null)
  assert.notEqual(
    tamperedHash,
    row!.entryHash,
    'tampering with envValue breaks the chain',
  )

  // Also tamper the envVar name (key collision wouldn't happen, but this
  // proves the binding covers the name field too).
  const tamperedBody2 = JSON.parse(rowForHash.errorReason) as Record<
    string,
    string
  >
  tamperedBody2.envVar = 'SOMETHING_ELSE'
  const tamperedRow2 = {
    ...rowForHash,
    errorReason: JSON.stringify(tamperedBody2),
  }
  const tamperedHash2 = computeEntryHash(
    tamperedRow2,
    row!.prevEntryHash ?? null,
  )
  assert.notEqual(
    tamperedHash2,
    row!.entryHash,
    'tampering with envVar name breaks the chain',
  )
})
