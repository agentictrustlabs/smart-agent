/**
 * Tests for Sprint 1 W2.2 S1.3 — conditional `A2A_SESSION_SECRET` and
 * Sprint 1 W2.2 S1.6 — `ALLOW_LEGACY_A2A_SESSIONS` defaulting.
 *
 * Exercises the pure validators (`validateSessionSecret` /
 * `validateAllowLegacySessions`) directly so we can run every branch
 * combination without re-importing the whole config module under
 * mutated `process.env`. The two functions are the ONLY way the
 * config module decides these two values — testing them is equivalent
 * to testing the module-load behaviour.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/config-invariants.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateSessionSecret,
  validateAllowLegacySessions,
} from '../src/config'

const VALID_SECRET = '0x' + 'd'.repeat(64)

// ─── S1.3 — A2A_SESSION_SECRET conditional ──────────────────────────

test("local-aes + A2A_SESSION_SECRET present → returns secret", () => {
  const out = validateSessionSecret({
    A2A_KMS_BACKEND: 'local-aes',
    NODE_ENV: 'development',
    A2A_SESSION_SECRET: VALID_SECRET,
  })
  assert.equal(out, VALID_SECRET)
})

test("local-aes + missing A2A_SESSION_SECRET → throws", () => {
  assert.throws(
    () =>
      validateSessionSecret({
        A2A_KMS_BACKEND: 'local-aes',
        NODE_ENV: 'development',
      }),
    /A2A_SESSION_SECRET required and must be ≥32 bytes hex/,
  )
})

test("local-aes + short A2A_SESSION_SECRET → throws", () => {
  assert.throws(
    () =>
      validateSessionSecret({
        A2A_KMS_BACKEND: 'local-aes',
        NODE_ENV: 'development',
        A2A_SESSION_SECRET: '0xdeadbeef', // 8 hex chars; well below 64
      }),
    // Either the weak-secret or the length-specific message is acceptable —
    // both are correct rejections. We match the shared substring.
    /A2A_SESSION_SECRET|weak A2A_SESSION_SECRET/,
  )
})

test("aws-kms + NO A2A_SESSION_SECRET → returns '' (no throw)", () => {
  const out = validateSessionSecret({
    A2A_KMS_BACKEND: 'aws-kms',
    NODE_ENV: 'production',
  })
  assert.equal(out, '')
})

test("aws-kms + A2A_SESSION_SECRET set + NODE_ENV=production → throws", () => {
  assert.throws(
    () =>
      validateSessionSecret({
        A2A_KMS_BACKEND: 'aws-kms',
        NODE_ENV: 'production',
        A2A_SESSION_SECRET: VALID_SECRET,
      }),
    /A2A_SESSION_SECRET must NOT be set in production when A2A_KMS_BACKEND='aws-kms'/,
  )
})

test("aws-kms + A2A_SESSION_SECRET set + dev → warns but returns ''", () => {
  // Capture console.warn so the test output stays clean.
  const orig = console.warn
  let warned = ''
  console.warn = (msg: string) => { warned = msg }
  try {
    const out = validateSessionSecret({
      A2A_KMS_BACKEND: 'aws-kms',
      NODE_ENV: 'development',
      A2A_SESSION_SECRET: VALID_SECRET,
    })
    assert.equal(out, '')
    assert.match(warned, /A2A_SESSION_SECRET is set but unused/)
  } finally {
    console.warn = orig
  }
})

// ─── S1.6 — ALLOW_LEGACY_A2A_SESSIONS defaulting ────────────────────

test("ALLOW_LEGACY_A2A_SESSIONS unset + dev → true", () => {
  assert.equal(
    validateAllowLegacySessions({ NODE_ENV: 'development' }),
    true,
  )
})

test("ALLOW_LEGACY_A2A_SESSIONS unset + production → false", () => {
  assert.equal(
    validateAllowLegacySessions({ NODE_ENV: 'production' }),
    false,
  )
})

test("ALLOW_LEGACY_A2A_SESSIONS=true + production → true (escape hatch)", () => {
  assert.equal(
    validateAllowLegacySessions({
      NODE_ENV: 'production',
      ALLOW_LEGACY_A2A_SESSIONS: 'true',
    }),
    true,
  )
})

test("ALLOW_LEGACY_A2A_SESSIONS=false + dev → false (explicit lockdown)", () => {
  assert.equal(
    validateAllowLegacySessions({
      NODE_ENV: 'development',
      ALLOW_LEGACY_A2A_SESSIONS: 'false',
    }),
    false,
  )
})

test("ALLOW_LEGACY_A2A_SESSIONS='garbage' → throws clean error", () => {
  assert.throws(
    () =>
      validateAllowLegacySessions({
        NODE_ENV: 'production',
        ALLOW_LEGACY_A2A_SESSIONS: 'garbage',
      }),
    /ALLOW_LEGACY_A2A_SESSIONS must be 'true' or 'false'/,
  )
})
