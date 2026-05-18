/**
 * Tests for `apps/a2a-agent/src/auth/service-auth-web.ts`
 * (Hardening §1.3 Stream B Task B1 + KMS migration K3-extension).
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/service-auth-web.test.ts`
 *
 * Covers:
 *   - unsigned request → 401 "missing service-auth headers"
 *   - wrong service header → 401 "unexpected service"
 *   - timestamp out of window → 401 "timestamp out of window"
 *   - bad signature → 401 "signature mismatch"
 *   - missing nonce → 401 "missing service-auth headers"
 *   - valid signature with nonce → next() runs (returns the handler body)
 *
 * After K3-extension landed, signing routes through the same
 * `buildWebMacProvider` factory the actual web client uses. The wire
 * format (canonical string + base64url MAC) is unchanged.
 */

// Configure env BEFORE importing the middleware so its module init sees the secret.
const TEST_SECRET = '0xb7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7'
process.env.WEB_TO_A2A_HMAC_KEY = TEST_SECRET
process.env.A2A_KMS_BACKEND = 'local-aes'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createHash, randomUUID } from 'node:crypto'
import { requireServiceAuth, buildWebCanonical } from '../src/auth/service-auth-web'
import { toBase64Url } from '@smart-agent/sdk'
import { buildWebMacProvider } from '@smart-agent/sdk/key-custody'

function mountApp() {
  const app = new Hono()
  app.post('/test', requireServiceAuth('web'), async (c) => {
    return c.json({ ok: true })
  })
  return app
}

const webMacProvider = buildWebMacProvider(process.env)

async function sign(path: string, body: string): Promise<{
  timestamp: number; nonce: string; signature: string
}> {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const canonical = buildWebCanonical(timestamp, nonce, path, body)
  const { mac } = await webMacProvider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  return { timestamp, nonce, signature: toBase64Url(mac) }
}

test('unsigned request → 401 missing headers', async () => {
  const app = mountApp()
  const res = await app.request('/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' }),
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /missing service-auth headers/)
})

test('wrong service header → 401 unexpected service', async () => {
  const app = mountApp()
  const path = '/test'
  const bodyJson = JSON.stringify({ hello: 'world' })
  const { timestamp, nonce, signature } = await sign(path, bodyJson)
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sa-service': 'langchain-planner',
      'x-sa-timestamp': String(timestamp),
      'x-sa-nonce': nonce,
      'x-sa-signature': signature,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /unexpected service/)
})

test('timestamp out of window → 401', async () => {
  const app = mountApp()
  const path = '/test'
  const bodyJson = JSON.stringify({ hello: 'world' })
  const oldTs = Math.floor(Date.now() / 1000) - 999
  const nonce = randomUUID()
  const canonical = buildWebCanonical(oldTs, nonce, path, bodyJson)
  const { mac } = await webMacProvider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  const signature = toBase64Url(mac)
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sa-service': 'web',
      'x-sa-timestamp': String(oldTs),
      'x-sa-nonce': nonce,
      'x-sa-signature': signature,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /timestamp out of window/)
})

test('bad signature → 401', async () => {
  const app = mountApp()
  const path = '/test'
  const bodyJson = JSON.stringify({ hello: 'world' })
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  // Sign over a different body — signature won't match.
  const wrongCanonical = buildWebCanonical(timestamp, nonce, path, '{"different":"body"}')
  const { mac } = await webMacProvider.generateMac({
    canonicalMessage: new TextEncoder().encode(wrongCanonical),
  })
  const signature = toBase64Url(mac)
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sa-service': 'web',
      'x-sa-timestamp': String(timestamp),
      'x-sa-nonce': nonce,
      'x-sa-signature': signature,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /signature mismatch/)
})

test('missing nonce → 401', async () => {
  const app = mountApp()
  const path = '/test'
  const bodyJson = JSON.stringify({ hello: 'world' })
  const timestamp = Math.floor(Date.now() / 1000)
  // No nonce header.
  const canonical = buildWebCanonical(timestamp, 'placeholder', path, bodyJson)
  const { mac } = await webMacProvider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  const signature = toBase64Url(mac)
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sa-service': 'web',
      'x-sa-timestamp': String(timestamp),
      'x-sa-signature': signature,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
})

test('valid signature → handler runs', async () => {
  const app = mountApp()
  const path = '/test'
  const bodyJson = JSON.stringify({ hello: 'world' })
  const { timestamp, nonce, signature } = await sign(path, bodyJson)
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sa-service': 'web',
      'x-sa-timestamp': String(timestamp),
      'x-sa-nonce': nonce,
      'x-sa-signature': signature,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 200)
  const body = await res.json() as { ok: boolean }
  assert.equal(body.ok, true)
})

test('canonical string format is sha256-of-body bound', () => {
  // Lock in the canonical-string spec so downstream client libraries
  // (apps/web/...) can't drift independently.
  const ts = 1234567890
  const nonce = 'fixed-nonce'
  const path = '/session-store/insert'
  const body = '{"hello":"world"}'
  const expectedHash = createHash('sha256').update(body, 'utf8').digest('hex')
  const canonical = buildWebCanonical(ts, nonce, path, body)
  assert.equal(canonical, `${ts}|${nonce}|${path}|${expectedHash}`)
})
