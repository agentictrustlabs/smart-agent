/**
 * Tests for `apps/a2a-agent/src/middleware/rate-limit.ts` → `resolveRateLimit`.
 *
 * The helper is pure (`process.env` injectable via the 4th arg) so every
 * branch is exercised without mutating real process env. Covers:
 *  - prod default when `NODE_ENV='production'` and no env override
 *  - dev default when `NODE_ENV != 'production'` and dev default provided
 *  - env override wins over both defaults (both _MAX and _WINDOW_MS)
 *  - throws on non-numeric override
 *  - throws on <=0 override (max + windowMs)
 *  - falls back to prod default in dev when no dev default is provided
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/rate-limit-config.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRateLimit } from '../src/middleware/rate-limit'

const PROD = { max: 10, windowMs: 60_000 } as const
const DEV = { max: 60, windowMs: 60_000 } as const

test("resolveRateLimit picks prod default when NODE_ENV='production' and env vars unset", () => {
  const out = resolveRateLimit('SESSION_INIT', PROD, DEV, {
    NODE_ENV: 'production',
  })
  assert.equal(out.max, 10)
  assert.equal(out.windowMs, 60_000)
})

test("resolveRateLimit picks dev default when NODE_ENV='development' and env vars unset + dev default provided", () => {
  const out = resolveRateLimit('SESSION_INIT', PROD, DEV, {
    NODE_ENV: 'development',
  })
  assert.equal(out.max, 60)
  assert.equal(out.windowMs, 60_000)
})

test('resolveRateLimit picks dev default when NODE_ENV unset + dev default provided', () => {
  const out = resolveRateLimit('SESSION_INIT', PROD, DEV, {})
  assert.equal(out.max, 60)
  assert.equal(out.windowMs, 60_000)
})

test('resolveRateLimit picks env-var override (_MAX) when set', () => {
  const out = resolveRateLimit('SESSION_INIT', PROD, DEV, {
    NODE_ENV: 'production',
    RATE_LIMIT_SESSION_INIT_MAX: '500',
  })
  assert.equal(out.max, 500)
  assert.equal(out.windowMs, 60_000)
})

test('resolveRateLimit picks env-var override (_WINDOW_MS) when set', () => {
  const out = resolveRateLimit('SESSION_INIT', PROD, DEV, {
    NODE_ENV: 'production',
    RATE_LIMIT_SESSION_INIT_WINDOW_MS: '120000',
  })
  assert.equal(out.max, 10)
  assert.equal(out.windowMs, 120_000)
})

test('resolveRateLimit picks env-var override (both _MAX and _WINDOW_MS) when set', () => {
  const out = resolveRateLimit('SESSION_INIT', PROD, DEV, {
    NODE_ENV: 'development',
    RATE_LIMIT_SESSION_INIT_MAX: '42',
    RATE_LIMIT_SESSION_INIT_WINDOW_MS: '30000',
  })
  assert.equal(out.max, 42)
  assert.equal(out.windowMs, 30_000)
})

test('resolveRateLimit env-var override wins over dev default in non-prod', () => {
  const out = resolveRateLimit('SESSION_INIT', PROD, DEV, {
    NODE_ENV: 'development',
    RATE_LIMIT_SESSION_INIT_MAX: '7',
  })
  assert.equal(out.max, 7)
})

test('resolveRateLimit throws on non-numeric _MAX env var', () => {
  assert.throws(
    () =>
      resolveRateLimit('SESSION_INIT', PROD, DEV, {
        NODE_ENV: 'production',
        RATE_LIMIT_SESSION_INIT_MAX: 'not-a-number',
      }),
    /Invalid RATE_LIMIT_SESSION_INIT_MAX/,
  )
})

test('resolveRateLimit throws on non-numeric _WINDOW_MS env var', () => {
  assert.throws(
    () =>
      resolveRateLimit('SESSION_INIT', PROD, DEV, {
        NODE_ENV: 'production',
        RATE_LIMIT_SESSION_INIT_WINDOW_MS: 'sixty-seconds',
      }),
    /Invalid RATE_LIMIT_SESSION_INIT_WINDOW_MS/,
  )
})

test('resolveRateLimit throws on <=0 _MAX env var', () => {
  assert.throws(
    () =>
      resolveRateLimit('SESSION_INIT', PROD, DEV, {
        NODE_ENV: 'production',
        RATE_LIMIT_SESSION_INIT_MAX: '0',
      }),
    /Invalid RATE_LIMIT_SESSION_INIT_MAX/,
  )
  assert.throws(
    () =>
      resolveRateLimit('SESSION_INIT', PROD, DEV, {
        NODE_ENV: 'production',
        RATE_LIMIT_SESSION_INIT_MAX: '-5',
      }),
    /Invalid RATE_LIMIT_SESSION_INIT_MAX/,
  )
})

test('resolveRateLimit throws on <=0 _WINDOW_MS env var', () => {
  assert.throws(
    () =>
      resolveRateLimit('SESSION_INIT', PROD, DEV, {
        NODE_ENV: 'production',
        RATE_LIMIT_SESSION_INIT_WINDOW_MS: '0',
      }),
    /Invalid RATE_LIMIT_SESSION_INIT_WINDOW_MS/,
  )
  assert.throws(
    () =>
      resolveRateLimit('SESSION_INIT', PROD, DEV, {
        NODE_ENV: 'production',
        RATE_LIMIT_SESSION_INIT_WINDOW_MS: '-1',
      }),
    /Invalid RATE_LIMIT_SESSION_INIT_WINDOW_MS/,
  )
})

test('resolveRateLimit falls back to prod default in dev when no dev default is provided', () => {
  const out = resolveRateLimit('GENERAL', PROD, undefined, {
    NODE_ENV: 'development',
  })
  assert.equal(out.max, 10)
  assert.equal(out.windowMs, 60_000)
})

test('resolveRateLimit env-var override applies even when dev default is omitted', () => {
  const out = resolveRateLimit('GENERAL', PROD, undefined, {
    NODE_ENV: 'development',
    RATE_LIMIT_GENERAL_MAX: '999',
  })
  assert.equal(out.max, 999)
})
