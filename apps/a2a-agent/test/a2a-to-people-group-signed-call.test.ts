/**
 * End-to-end test for the a2a-agent → people-group-mcp signed inter-service hop
 * (Spec 007 Phase D).
 *
 * Mirrors `a2a-to-hub-signed-call.test.ts` for the people-group edge.
 * The outbound signer (`apps/a2a-agent/src/auth/sign-outbound.ts`) and
 * the people-group-mcp inbound verifier
 * (`apps/people-group-mcp/src/auth/require-inbound-service-auth.ts`) must
 * agree on the canonical-v2 message and share the `a2a-to-people-group`
 * MAC key. This test wires both ends in one process: the outbound builds
 * the headers, the inbound (mounted in a Hono app here) consumes them.
 *
 * Coverage:
 *   1. Empty-body POST round-trip.
 *   2. Body-bound MAC: signing body B and sending body B' MUST 401.
 *   3. Replay defense: re-using a nonce after first acceptance MUST 401.
 *   4. Missing headers → 401.
 *
 * Run:
 *   node --import tsx --test apps/a2a-agent/test/a2a-to-people-group-signed-call.test.ts
 */

// Both sides read the same env var (HMAC is symmetric).
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP =
  process.env.A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP ?? '0x' + 'f'.repeat(64)
process.env.A2A_SESSION_SECRET =
  process.env.A2A_SESSION_SECRET ?? '0x' + 'd'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { buildOutboundAuthHeaders } from '../src/auth/sign-outbound'
import {
  requireInboundServiceAuth,
  resetInboundMacProviderForTest,
  resetInboundNonceCacheForTest,
} from '../../people-group-mcp/src/auth/require-inbound-service-auth'

resetInboundMacProviderForTest()
resetInboundNonceCacheForTest()

function mountPeopleGroupMcpApp() {
  const app = new Hono()
  app.use('/tools/*', requireInboundServiceAuth())
  app.post('/tools/:toolName', async (c) => {
    const toolName = c.req.param('toolName')
    const body = await c.req.json<unknown>().catch(() => ({}))
    return c.json({ ok: true, tool: toolName, echo: body })
  })
  return app
}

test('a2a → people-group round trip — empty-body POST signed and verified', async () => {
  resetInboundNonceCacheForTest()
  const app = mountPeopleGroupMcpApp()
  const path = '/tools/list_segments'
  const bodyJson = '{}'
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-people-group', path, bodyJson)
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: bodyJson,
  })
  if (res.status !== 200) {
    assert.fail(`expected 200, got ${res.status}: ${await res.text()}`)
  }
  const json = (await res.json()) as { ok: boolean; tool: string }
  assert.equal(json.ok, true)
  assert.equal(json.tool, 'list_segments')
})

test('a2a → people-group — tampered body after signing → 401', async () => {
  resetInboundNonceCacheForTest()
  const app = mountPeopleGroupMcpApp()
  const path = '/tools/list_segments'
  const bodyB = JSON.stringify({ filter: 'a' })
  const bodyBPrime = JSON.stringify({ filter: 'b' })
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-people-group', path, bodyB)
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: bodyBPrime,
  })
  assert.equal(res.status, 401)
  const json = (await res.json()) as { error: string }
  assert.match(json.error, /signature mismatch/)
})

test('a2a → people-group — replayed nonce → 401', async () => {
  resetInboundNonceCacheForTest()
  const app = mountPeopleGroupMcpApp()
  const path = '/tools/list_segments'
  const bodyJson = '{}'
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-people-group', path, bodyJson)
  const ok = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: bodyJson,
  })
  assert.equal(ok.status, 200)
  const replay = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: bodyJson,
  })
  assert.equal(replay.status, 401)
  const json = (await replay.json()) as { error: string }
  assert.match(json.error, /replay detected/)
})

test('a2a → people-group — missing service-auth headers → 401', async () => {
  resetInboundNonceCacheForTest()
  const app = mountPeopleGroupMcpApp()
  const res = await app.request('/tools/list_segments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(res.status, 401)
  const json = (await res.json()) as { error: string }
  assert.match(json.error, /missing service-auth headers/)
})
