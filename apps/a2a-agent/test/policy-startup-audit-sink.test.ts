/**
 * Sprint 5 Wave 2 — P1-5 — audit-checkpoint sink required in production.
 *
 * Exercises the pure `validateAuditSinkConfig` validator + the
 * top-level `assertAuditSinkConfigured` helper with an injected probe.
 *
 *   - prod + sink unset                       → throws naming the env var
 *   - prod + sink set + probe returns 200     → no throw
 *   - prod + sink set + probe returns 503     → throws naming URL + deploy-time check
 *   - prod + sink set + probe throws (network)→ throws naming URL + deploy-time check
 *   - dev + sink unset                        → no throw (silent no-op)
 *   - dev + sink set + probe returns 200      → no throw (operator opt-in)
 *
 * Probe is injected so the test doesn't bind to a real port.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/policy-startup-audit-sink.test.ts`
 */

// Configure env BEFORE importing app code.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = '0x' + 'd'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateAuditSinkConfig,
  assertAuditSinkConfigured,
  type SinkProbeFn,
} from '../src/lib/policy-startup'

// ─── validateAuditSinkConfig — pure validator ───────────────────────

test('prod + AUDIT_CHECKPOINT_SINK_URL unset → throws naming env var', () => {
  assert.throws(
    () =>
      validateAuditSinkConfig({
        NODE_ENV: 'production',
      }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /AUDIT_CHECKPOINT_SINK_URL/)
      assert.match(msg, /required/)
      return true
    },
  )
})

test('prod + AUDIT_CHECKPOINT_SINK_URL=\'\' → throws naming env var', () => {
  assert.throws(
    () =>
      validateAuditSinkConfig({
        NODE_ENV: 'production',
        AUDIT_CHECKPOINT_SINK_URL: '',
      }),
    /AUDIT_CHECKPOINT_SINK_URL/,
  )
})

test('prod + AUDIT_CHECKPOINT_SINK_URL set → returns the URL', () => {
  const url = 'https://sink.example.invalid/ingest'
  const out = validateAuditSinkConfig({
    NODE_ENV: 'production',
    AUDIT_CHECKPOINT_SINK_URL: url,
  })
  assert.equal(out, url)
})

test('dev + sink unset → returns null (silent no-op)', () => {
  const out = validateAuditSinkConfig({
    NODE_ENV: 'development',
  })
  assert.equal(out, null)
})

test('dev + sink set → returns URL (operator opt-in)', () => {
  const url = 'https://sink.example.invalid/ingest'
  const out = validateAuditSinkConfig({
    NODE_ENV: 'development',
    AUDIT_CHECKPOINT_SINK_URL: url,
  })
  assert.equal(out, url)
})

// ─── assertAuditSinkConfigured — reachability probe ─────────────────

const okProbe: SinkProbeFn = async () => ({ ok: true, status: 200 })
const failedProbe: SinkProbeFn = async () => ({
  ok: false,
  status: 503,
  error: 'HTTP 503',
})
const networkErrorProbe: SinkProbeFn = async () => ({
  ok: false,
  error: 'ECONNREFUSED',
})

test('assertAuditSinkConfigured: prod + sink set + probe ok → no throw', async () => {
  await assert.doesNotReject(() =>
    assertAuditSinkConfigured(
      {
        NODE_ENV: 'production',
        AUDIT_CHECKPOINT_SINK_URL: 'https://sink.example.invalid/ingest',
      },
      okProbe,
    ),
  )
})

test('assertAuditSinkConfigured: prod + sink set + probe returns 503 → throws naming URL + deploy-time check', async () => {
  const url = 'https://sink.example.invalid/ingest'
  await assert.rejects(
    () =>
      assertAuditSinkConfigured(
        {
          NODE_ENV: 'production',
          AUDIT_CHECKPOINT_SINK_URL: url,
        },
        failedProbe,
      ),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, new RegExp(url))
      assert.match(msg, /deploy-time check/)
      return true
    },
  )
})

test('assertAuditSinkConfigured: prod + sink set + probe network error → throws naming URL + error', async () => {
  const url = 'https://sink.example.invalid/ingest'
  await assert.rejects(
    () =>
      assertAuditSinkConfigured(
        {
          NODE_ENV: 'production',
          AUDIT_CHECKPOINT_SINK_URL: url,
        },
        networkErrorProbe,
      ),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, new RegExp(url))
      assert.match(msg, /ECONNREFUSED/)
      return true
    },
  )
})

test('assertAuditSinkConfigured: prod + sink unset → throws (probe never invoked)', async () => {
  let probeCalled = false
  const trackedProbe: SinkProbeFn = async () => {
    probeCalled = true
    return { ok: true }
  }
  await assert.rejects(
    () =>
      assertAuditSinkConfigured(
        {
          NODE_ENV: 'production',
        },
        trackedProbe,
      ),
    /AUDIT_CHECKPOINT_SINK_URL/,
  )
  assert.equal(probeCalled, false)
})

test('assertAuditSinkConfigured: dev + sink unset → no throw, no probe call', async () => {
  let probeCalled = false
  const trackedProbe: SinkProbeFn = async () => {
    probeCalled = true
    return { ok: true }
  }
  await assertAuditSinkConfigured(
    {
      NODE_ENV: 'development',
    },
    trackedProbe,
  )
  assert.equal(probeCalled, false)
})
