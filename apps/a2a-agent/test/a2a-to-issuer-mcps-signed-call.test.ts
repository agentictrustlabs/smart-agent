/**
 * Verify each `a2a-to-<mcp>` MAC key pair round-trips for the four
 * OID4VCI-style MCPs (family, geo, verifier, skill) — Spec 007 Phase D.
 *
 * These MCPs don't yet expose `/tools/*` surfaces, but the inbound
 * verifier file is in place so a future tool surface can mount it
 * without reinventing the envelope. This test asserts the envelope
 * shape is symmetric end-to-end for all four pairs.
 *
 * Run: node --import tsx --test apps/a2a-agent/test/a2a-to-issuer-mcps-signed-call.test.ts
 */

process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_FAMILY =
  process.env.A2A_INTERSERVICE_HMAC_KEY_FAMILY ?? '0x' + '1'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_GEO =
  process.env.A2A_INTERSERVICE_HMAC_KEY_GEO ?? '0x' + '2'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_VERIFIER =
  process.env.A2A_INTERSERVICE_HMAC_KEY_VERIFIER ?? '0x' + '3'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_SKILL =
  process.env.A2A_INTERSERVICE_HMAC_KEY_SKILL ?? '0x' + '4'.repeat(64)
process.env.A2A_SESSION_SECRET =
  process.env.A2A_SESSION_SECRET ?? '0x' + 'd'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { buildOutboundAuthHeaders } from '../src/auth/sign-outbound'
import * as familyAuth from '../../family-mcp/src/auth/require-inbound-service-auth'
import * as geoAuth from '../../geo-mcp/src/auth/require-inbound-service-auth'
import * as verifierAuth from '../../verifier-mcp/src/auth/require-inbound-service-auth'
import * as skillAuth from '../../skill-mcp/src/auth/require-inbound-service-auth'

// Force lazy provider caches to rebuild against the test env.
familyAuth.resetInboundMacProviderForTest()
familyAuth.resetInboundNonceCacheForTest()
geoAuth.resetInboundMacProviderForTest()
geoAuth.resetInboundNonceCacheForTest()
verifierAuth.resetInboundMacProviderForTest()
verifierAuth.resetInboundNonceCacheForTest()
skillAuth.resetInboundMacProviderForTest()
skillAuth.resetInboundNonceCacheForTest()

interface MAuth {
  requireInboundServiceAuth: typeof familyAuth.requireInboundServiceAuth
  resetInboundNonceCacheForTest: () => void
}

function mount(authMod: MAuth) {
  const app = new Hono()
  app.use('/tools/*', authMod.requireInboundServiceAuth())
  app.post('/tools/:toolName', async (c) => {
    const toolName = c.req.param('toolName')
    return c.json({ ok: true, tool: toolName })
  })
  return app
}

const PAIRS = [
  { name: 'family', macKey: 'a2a-to-family' as const, auth: familyAuth },
  { name: 'geo', macKey: 'a2a-to-geo' as const, auth: geoAuth },
  { name: 'verifier', macKey: 'a2a-to-verifier' as const, auth: verifierAuth },
  { name: 'skill', macKey: 'a2a-to-skill' as const, auth: skillAuth },
] as const

for (const { name, macKey, auth } of PAIRS) {
  test(`a2a → ${name} — empty-body round trip`, async () => {
    auth.resetInboundNonceCacheForTest()
    const app = mount(auth)
    const path = '/tools/example'
    const bodyJson = '{}'
    const headers = await buildOutboundAuthHeaders(macKey, path, bodyJson)
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: bodyJson,
    })
    if (res.status !== 200) {
      assert.fail(`${name}: expected 200, got ${res.status}: ${await res.text()}`)
    }
    const json = (await res.json()) as { ok: boolean }
    assert.equal(json.ok, true)
  })

  test(`a2a → ${name} — tampered body → 401`, async () => {
    auth.resetInboundNonceCacheForTest()
    const app = mount(auth)
    const path = '/tools/example'
    const bodyB = '{"a":1}'
    const bodyBPrime = '{"a":2}'
    const headers = await buildOutboundAuthHeaders(macKey, path, bodyB)
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: bodyBPrime,
    })
    assert.equal(res.status, 401, `${name}: expected 401`)
  })

  test(`a2a → ${name} — missing service-auth headers → 401`, async () => {
    auth.resetInboundNonceCacheForTest()
    const app = mount(auth)
    const res = await app.request('/tools/example', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(res.status, 401)
  })
}
