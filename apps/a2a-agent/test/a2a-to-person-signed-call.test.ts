/**
 * End-to-end test for the a2a-agent → person-mcp signed inter-service
 * hop (P0-1 + P0-3).
 *
 * The outbound signer (`apps/a2a-agent/src/auth/sign-outbound.ts`) and
 * the person-mcp inbound verifier
 * (`apps/person-mcp/src/auth/require-inbound-service-auth.ts`) must
 * agree on the canonical-v2 message and share the `a2a-to-person` MAC
 * key. This test wires both ends in one process: the outbound builds
 * the headers, the inbound (mounted in a Hono app here) consumes them.
 * If either side drifts from canonical-v2, the test fails.
 *
 * This is the regression coverage for the `requireSession` bypass
 * (P0-1) — that middleware used to call person-mcp without any service
 * auth. With the fix, every a2a→person call signs through
 * `buildOutboundAuthHeaders('a2a-to-person', ...)` and must verify
 * end-to-end against the inbound middleware.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/a2a-to-person-signed-call.test.ts`
 */

// Both sides read the same env var (HMAC is symmetric).
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON =
  process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON ?? '0x' + 'c'.repeat(64)
// Test-scoped sqlite so we don't pollute dev state.
process.env.PERSON_MCP_DB_PATH = process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.test.db'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { buildOutboundAuthHeaders } from '../src/auth/sign-outbound'
import {
  requireInboundServiceAuth,
  resetInboundMacProviderForTest,
} from '../../person-mcp/src/auth/require-inbound-service-auth'

// Force the lazy provider cache to rebuild against the test env.
resetInboundMacProviderForTest()

function mountPersonMcpApp() {
  const app = new Hono()
  app.post(
    '/session-store/insert',
    requireInboundServiceAuth(),
    async (c) => c.json({ ok: true, echo: await c.req.json() }),
  )
  app.get(
    '/session-store/by-cookie/:cookieValue',
    requireInboundServiceAuth(),
    async (c) => c.json({ record: null }),
  )
  return app
}

test('P0-1/P0-3 round trip — buildOutboundAuthHeaders signs a body that verifies against require-inbound-service-auth', async () => {
  const personMcp = mountPersonMcpApp()
  const path = '/session-store/insert'
  const bodyJson = JSON.stringify({ sessionId: 'sess-roundtrip-1', smartAccountAddress: '0xabc' })
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-person', path, bodyJson)
  const res = await personMcp.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
    body: bodyJson,
  })
  if (res.status !== 200) {
    assert.fail(`expected 200, got ${res.status}: ${await res.text()}`)
  }
  const body = await res.json() as { ok: boolean }
  assert.equal(body.ok, true)
})

test('P0-1/P0-3 round trip — empty-body GET (require-session-style lookup) verifies end-to-end', async () => {
  // require-session.ts now signs the by-cookie GET with an empty body.
  // The outbound signer and inbound verifier must agree that the
  // body-hash bound into the canonical is sha256("") for empty bodies.
  const personMcp = mountPersonMcpApp()
  const path = '/session-store/by-cookie/some-session-token-' + Date.now()
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-person', path, '')
  const res = await personMcp.request(path, {
    method: 'GET',
    headers: { ...authHeaders },
  })
  if (res.status !== 200) {
    assert.fail(`expected 200, got ${res.status}: ${await res.text()}`)
  }
})

test('P0-1/P0-3 round trip — tampered body after signing → inbound 401 signature mismatch', async () => {
  // Confirms the body-hash binding holds end-to-end: signing body B
  // and sending body B' through the wire MUST 401.
  const personMcp = mountPersonMcpApp()
  const path = '/session-store/insert'
  const bodyB = JSON.stringify({ sessionId: 'sess-tampered', smartAccountAddress: '0xabc' })
  const bodyBPrime = JSON.stringify({ sessionId: 'sess-tampered', smartAccountAddress: '0xdeadbeef' })
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-person', path, bodyB)
  const res = await personMcp.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
    body: bodyBPrime, // tampered after signing
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /signature mismatch/)
})
