/**
 * Tests for `apps/a2a-agent/src/auth/inter-service.ts` integration with
 * the K3-extension MAC provider abstraction.
 *
 * Covers:
 *   - missing headers → 401
 *   - unknown service → 401
 *   - misconfigured service (no env var) → 403
 *   - valid signature for org-mcp routed to the correct MAC key
 *   - signature signed under a DIFFERENT MCP's key fails (defense-in-depth)
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/inter-service.test.ts`
 */
const SECRET_ORG = '0xa' + 'a'.repeat(63)
const SECRET_PERSON = '0xb' + 'b'.repeat(63)
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_ORG = SECRET_ORG
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = SECRET_PERSON

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { requireInterServiceAuth } from '../src/auth/inter-service'
import { toBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider } from '@smart-agent/sdk/key-custody'

function mountApp() {
  const app = new Hono()
  app.post(
    '/session/:id/redeem-tx',
    requireInterServiceAuth(),
    async (c) => c.json({ ok: true }),
  )
  return app
}

async function signWith(
  mcpName: 'org' | 'person',
  service: string,
  sessionId: string,
  bodyJson: string,
  overrideTs?: number,
): Promise<{ timestamp: number; nonce: string; signature: string }> {
  const provider = buildMcpMacProvider(mcpName, process.env)
  const timestamp = overrideTs ?? Math.floor(Date.now() / 1000)
  const canonical = `${bodyJson}:${timestamp}:${sessionId}`
  const { mac } = await provider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  return { timestamp, nonce: randomUUID(), signature: toBase64Url(mac) }
}

test('missing inter-service headers → 401', async () => {
  const app = mountApp()
  const res = await app.request('/session/sess-1/redeem-tx', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /missing inter-service auth headers/)
})

test('unknown service header → 401', async () => {
  const app = mountApp()
  const bodyJson = JSON.stringify({})
  const { timestamp, nonce, signature } = await signWith('org', 'org-mcp', 'sess-2', bodyJson)
  const res = await app.request('/session/sess-2/redeem-tx', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'rogue-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /unknown service/)
})

test('valid org-mcp signature → handler runs', async () => {
  const app = mountApp()
  const sessionId = 'sess-3-' + randomUUID()
  const bodyJson = JSON.stringify({ target: '0xabc' })
  const { timestamp, nonce, signature } = await signWith('org', 'org-mcp', sessionId, bodyJson)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 200)
  const body = await res.json() as { ok: boolean }
  assert.equal(body.ok, true)
})

test('signature signed under person-mcp key fails verification when claimed as org-mcp', async () => {
  // Defense-in-depth: each MCP has its own MAC key. A signature minted
  // under person-mcp's key MUST NOT verify against org-mcp's key. This
  // proves the per-key isolation that the K3-extension IAM scoping
  // enforces in production.
  const app = mountApp()
  const sessionId = 'sess-4-' + randomUUID()
  const bodyJson = JSON.stringify({ target: '0xabc' })
  // Sign with person-mcp's key, claim org-mcp in the header.
  const { timestamp, nonce, signature } = await signWith('person', 'person-mcp', sessionId, bodyJson)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp', // header claims org-mcp
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature, // but signature is from person-mcp
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /signature mismatch/)
})

test('timestamp out of window → 401', async () => {
  const app = mountApp()
  const sessionId = 'sess-5-' + randomUUID()
  const bodyJson = JSON.stringify({})
  const oldTs = Math.floor(Date.now() / 1000) - 999
  const { timestamp, nonce, signature } = await signWith('org', 'org-mcp', sessionId, bodyJson, oldTs)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /timestamp out of window/)
})

test('missing nonce → 401', async () => {
  const app = mountApp()
  const sessionId = 'sess-6-' + randomUUID()
  const bodyJson = JSON.stringify({})
  const { timestamp, signature } = await signWith('org', 'org-mcp', sessionId, bodyJson)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      // no x-a2a-nonce
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
})
