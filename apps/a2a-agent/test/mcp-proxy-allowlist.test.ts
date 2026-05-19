/**
 * Spec 007 Phase E — proxy hardening tests.
 *
 * Covers:
 *   1. Per-tool allowlist: unknown tool → 404 BEFORE the upstream is
 *      reached. The proxy must reject without forwarding so an attacker
 *      can't probe the downstream surface.
 *   2. Generic-proxy kill-switch (`DISABLE_GENERIC_MCP_PROXY=true`)
 *      → every catch-all route returns 503.
 *   3. Kill-switch off (`=false`) → allowlisted tools forward normally.
 *   4. Hub gateway path also enforces its own `HUB_TOOLS` allowlist.
 *
 * The mcp-proxy module reads `DISABLE_GENERIC_MCP_PROXY` from
 * `process.env` PER REQUEST (`genericProxyDisabled()` is invoked inside
 * each handler), so a single import suffices and we can flip the flag
 * between tests without re-importing.
 *
 * Run: node --import tsx --test apps/a2a-agent/test/mcp-proxy-allowlist.test.ts
 */

// Test env — local-aes mode with deterministic hub key so the gateway
// path's outbound sign call doesn't crash on missing config.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_HUB =
  process.env.A2A_INTERSERVICE_HMAC_KEY_HUB ?? '0x' + 'e'.repeat(64)
process.env.A2A_SESSION_SECRET =
  process.env.A2A_SESSION_SECRET ?? '0x' + 'd'.repeat(64)
// Force NON-production so the module-level guard doesn't trip.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mcpProxy } from '../src/routes/mcp-proxy'
import { SERVER_TOOL_ALLOWLIST, HUB_TOOLS } from '../src/routes/mcp-proxy-allowlist'

test('hub gateway: unknown tool → 404 before forwarding', async () => {
  delete process.env.DISABLE_GENERIC_MCP_PROXY
  const res = await mcpProxy.request('/hub/totally:made-up-tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(res.status, 404)
  const json = (await res.json()) as { error: string }
  assert.match(json.error, /Unknown hub tool/)
})

test('hub gateway: kill-switch ON → 503', async () => {
  process.env.DISABLE_GENERIC_MCP_PROXY = 'true'
  try {
    const res = await mcpProxy.request('/hub/sync:all', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(res.status, 503)
    const json = (await res.json()) as { error: string }
    assert.match(json.error, /generic MCP proxy disabled/)
  } finally {
    delete process.env.DISABLE_GENERIC_MCP_PROXY
  }
})

test('generic proxy: kill-switch ON → 503 without auth', async () => {
  process.env.DISABLE_GENERIC_MCP_PROXY = 'true'
  try {
    const res = await mcpProxy.request('/person/list_oikos_contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    // 503 comes from the kill-switch BEFORE requireSession runs.
    assert.equal(res.status, 503)
    const json = (await res.json()) as { error: string }
    assert.match(json.error, /generic MCP proxy disabled/)
  } finally {
    delete process.env.DISABLE_GENERIC_MCP_PROXY
  }
})

test('generic proxy: kill-switch OFF → reaches requireSession (401 without cookie)', async () => {
  process.env.DISABLE_GENERIC_MCP_PROXY = 'false'
  try {
    const res = await mcpProxy.request('/person/list_oikos_contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    // Without an authenticated session we expect 401 from requireSession
    // (the allowlist check + upstream fetch never run). The point of
    // this test: kill-switch=false flips the early-return back off.
    assert.notEqual(res.status, 503)
    assert.equal(res.status, 401)
  } finally {
    delete process.env.DISABLE_GENERIC_MCP_PROXY
  }
})

test('proxy-tool-allowlist: SERVER_TOOL_ALLOWLIST sets are non-empty', () => {
  assert.ok(SERVER_TOOL_ALLOWLIST.person.size > 0, 'person allowlist empty')
  assert.ok(SERVER_TOOL_ALLOWLIST.org.size > 0, 'org allowlist empty')
  assert.ok(SERVER_TOOL_ALLOWLIST['people-group'].size > 0, 'people-group allowlist empty')
  assert.ok(HUB_TOOLS.size > 0, 'hub tools empty')
  // Spot-check a few canonical tools.
  assert.ok(SERVER_TOOL_ALLOWLIST.person.has('list_oikos_contacts'))
  assert.ok(SERVER_TOOL_ALLOWLIST.org.has('pool:create'))
  assert.ok(SERVER_TOOL_ALLOWLIST['people-group'].has('list_segments'))
  assert.ok(HUB_TOOLS.has('sync:all'))
})

test('proxy-tool-allowlist: unknown server has no entry', () => {
  // Integration coverage of the requireSession + allowlist sequence
  // lives in the existing a2a-to-person-signed-call.test.ts.
  assert.equal(SERVER_TOOL_ALLOWLIST['nonexistent' as keyof typeof SERVER_TOOL_ALLOWLIST], undefined)
})
