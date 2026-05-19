/**
 * Spec 007 Phase E — production-startup guard for the MCP proxy.
 *
 * In production, the generic catch-all proxy MUST have an explicit
 * `DISABLE_GENERIC_MCP_PROXY` policy. Booting with the flag unset (or
 * with any value other than `'true'`/`'false'`) is a configuration
 * error — a2a-agent must refuse to start rather than silently default
 * to allow-everything OR deny-everything.
 *
 * Tests run against the extracted `assertGenericProxyPolicy(env)`
 * function so we don't need to spawn a process (the full module-load
 * path triggers config validation that's unrelated to this guard).
 *
 * Run: node --import tsx --test apps/a2a-agent/test/mcp-proxy-production-guard.test.ts
 */

// Pre-load env so the mcp-proxy module's own `assertGenericProxyPolicy`
// call at the bottom of its module body doesn't throw during import.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET =
  process.env.A2A_SESSION_SECRET ?? '0x' + 'd'.repeat(64)
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertGenericProxyPolicy } from '../src/routes/mcp-proxy'

test('production + DISABLE_GENERIC_MCP_PROXY unset → throws', () => {
  assert.throws(
    () => assertGenericProxyPolicy({ NODE_ENV: 'production' }),
    /DISABLE_GENERIC_MCP_PROXY must be explicitly set/,
  )
})

test('production + DISABLE_GENERIC_MCP_PROXY=invalid → throws', () => {
  assert.throws(
    () =>
      assertGenericProxyPolicy({
        NODE_ENV: 'production',
        DISABLE_GENERIC_MCP_PROXY: 'yes',
      }),
    /DISABLE_GENERIC_MCP_PROXY must be explicitly set/,
  )
})

test("production + DISABLE_GENERIC_MCP_PROXY='1' → throws (only 'true'/'false' accepted)", () => {
  assert.throws(
    () =>
      assertGenericProxyPolicy({
        NODE_ENV: 'production',
        DISABLE_GENERIC_MCP_PROXY: '1',
      }),
    /DISABLE_GENERIC_MCP_PROXY must be explicitly set/,
  )
})

test('production + DISABLE_GENERIC_MCP_PROXY=true → does not throw', () => {
  assert.doesNotThrow(() =>
    assertGenericProxyPolicy({
      NODE_ENV: 'production',
      DISABLE_GENERIC_MCP_PROXY: 'true',
    }),
  )
})

test('production + DISABLE_GENERIC_MCP_PROXY=false → does not throw', () => {
  assert.doesNotThrow(() =>
    assertGenericProxyPolicy({
      NODE_ENV: 'production',
      DISABLE_GENERIC_MCP_PROXY: 'false',
    }),
  )
})

test('NODE_ENV=test + DISABLE_GENERIC_MCP_PROXY unset → does not throw', () => {
  assert.doesNotThrow(() =>
    assertGenericProxyPolicy({ NODE_ENV: 'test' }),
  )
})

test('NODE_ENV unset + DISABLE_GENERIC_MCP_PROXY unset → does not throw', () => {
  assert.doesNotThrow(() => assertGenericProxyPolicy({}))
})
