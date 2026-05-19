/**
 * End-to-end test for the a2a-agent → hub-mcp signed inter-service hop.
 *
 * Mirrors `a2a-to-person-signed-call.test.ts` for the hub edge. The
 * outbound signer (`apps/a2a-agent/src/auth/sign-outbound.ts`) and the
 * hub-mcp inbound verifier
 * (`apps/hub-mcp/src/auth/require-inbound-service-auth.ts`) must agree
 * on the canonical-v2 message and share the `a2a-to-hub` MAC key. This
 * test wires both ends in one process: the outbound builds the
 * headers, the inbound (mounted in a Hono app here) consumes them.
 *
 * Coverage notes:
 *   1. Empty-body POST round-trip with a body that hashes to sha256("")
 *      → 200 from the upstream handler.
 *   2. Body-bound MAC: signing body B and sending body B' MUST 401.
 *   3. Replay defense: re-using a nonce after first acceptance MUST 401.
 *   4. The hub gateway route (`mcpProxy.post('/hub/:tool', ...)`)
 *      proxies a body verbatim and injects valid signed headers.
 *
 * Run:
 *   node --import tsx --test apps/a2a-agent/test/a2a-to-hub-signed-call.test.ts
 */

// Both sides read the same env var (HMAC is symmetric).
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_HUB =
  process.env.A2A_INTERSERVICE_HMAC_KEY_HUB ?? '0x' + 'e'.repeat(64)
// Test-scoped session secret so any transitive import of a2a-agent's
// config doesn't throw on missing A2A_SESSION_SECRET.
process.env.A2A_SESSION_SECRET = process.env.A2A_SESSION_SECRET ?? '0x' + 'd'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { buildOutboundAuthHeaders } from '../src/auth/sign-outbound'
import {
  requireInboundServiceAuth,
  resetInboundMacProviderForTest,
  resetInboundNonceCacheForTest,
} from '../../hub-mcp/src/auth/require-inbound-service-auth'

// Force the lazy provider cache to rebuild against the test env.
resetInboundMacProviderForTest()
resetInboundNonceCacheForTest()

function mountHubMcpApp() {
  const app = new Hono()
  app.use('/tools/*', requireInboundServiceAuth())
  app.post('/tools/:toolName', async (c) => {
    const toolName = c.req.param('toolName')
    const body = await c.req.json<unknown>().catch(() => ({}))
    return c.json({ ok: true, tool: toolName, echo: body })
  })
  return app
}

test('a2a → hub round trip — empty-body POST signed and verified', async () => {
  resetInboundNonceCacheForTest()
  const hub = mountHubMcpApp()
  const path = '/tools/sync:all'
  const bodyJson = '{}'
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-hub', path, bodyJson)
  const res = await hub.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: bodyJson,
  })
  if (res.status !== 200) {
    assert.fail(`expected 200, got ${res.status}: ${await res.text()}`)
  }
  const json = (await res.json()) as { ok: boolean; tool: string }
  assert.equal(json.ok, true)
  assert.equal(json.tool, 'sync:all')
})

test('a2a → hub round trip — non-empty body POST', async () => {
  resetInboundNonceCacheForTest()
  const hub = mountHubMcpApp()
  const path = '/tools/sync:pool'
  const bodyJson = JSON.stringify({ poolAddress: '0xabc' })
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-hub', path, bodyJson)
  const res = await hub.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: bodyJson,
  })
  if (res.status !== 200) {
    assert.fail(`expected 200, got ${res.status}: ${await res.text()}`)
  }
})

test('a2a → hub — tampered body after signing → 401 signature mismatch', async () => {
  resetInboundNonceCacheForTest()
  const hub = mountHubMcpApp()
  const path = '/tools/sync:pool'
  const bodyB = JSON.stringify({ poolAddress: '0xabc' })
  const bodyBPrime = JSON.stringify({ poolAddress: '0xdeadbeef' })
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-hub', path, bodyB)
  const res = await hub.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: bodyBPrime,
  })
  assert.equal(res.status, 401)
  const json = (await res.json()) as { error: string }
  assert.match(json.error, /signature mismatch/)
})

test('a2a → hub — replayed nonce → 401 replay detected', async () => {
  resetInboundNonceCacheForTest()
  const hub = mountHubMcpApp()
  const path = '/tools/sync:all'
  const bodyJson = '{}'
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-hub', path, bodyJson)
  // First call accepted.
  const ok = await hub.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: bodyJson,
  })
  assert.equal(ok.status, 200)
  // Same headers + body → nonce already burned.
  const replay = await hub.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: bodyJson,
  })
  assert.equal(replay.status, 401)
  const json = (await replay.json()) as { error: string }
  assert.match(json.error, /replay detected/)
})

test('a2a → hub — missing service-auth headers → 401', async () => {
  resetInboundNonceCacheForTest()
  const hub = mountHubMcpApp()
  const res = await hub.request('/tools/sync:all', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(res.status, 401)
  const json = (await res.json()) as { error: string }
  assert.match(json.error, /missing service-auth headers/)
})

test('mcpProxy.post(/hub/:tool) — gateway signs the upstream call', async () => {
  // Cover the gateway path: a request hits a2a-agent's /mcp/hub/<tool>
  // route, the route forwards the body to hub-mcp with valid signed
  // headers, hub-mcp's verifier accepts and the upstream handler runs.
  // We intercept the outbound fetch so the test is hermetic (no real
  // hub-mcp socket needed). The hub-mcp Hono app handles the request
  // directly inside the intercepted fetch — same wire format, same
  // verifier, no port binding.
  resetInboundNonceCacheForTest()
  const hub = mountHubMcpApp()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    // Only intercept hub-mcp upstream — leave other fetches alone.
    if (url.startsWith('http://localhost:3900/tools/')) {
      const path = new URL(url).pathname
      return hub.request(path, init)
    }
    return originalFetch(input as Request, init)
  }) as typeof fetch

  try {
    const { mcpProxy } = await import('../src/routes/mcp-proxy')
    // The gateway route doesn't enforce requireSession, so a bare POST
    // through the Hono app is valid.
    const res = await mcpProxy.request('/hub/sync:all', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (res.status !== 200) {
      assert.fail(`gateway returned ${res.status}: ${await res.text()}`)
    }
    const json = (await res.json()) as { ok: boolean; tool: string }
    assert.equal(json.ok, true)
    assert.equal(json.tool, 'sync:all')
  } finally {
    globalThis.fetch = originalFetch
  }
})
