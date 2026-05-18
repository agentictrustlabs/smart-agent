/**
 * Tests for `apps/person-mcp/src/auth/require-inbound-service-auth.ts`
 * (Sprint 1 W2.1).
 *
 * Covers every denial branch of the inbound HMAC envelope verifier:
 *   - missing headers → 401 + audit-deny row
 *   - unknown service in X-SA-Service → 401 + audit-deny row
 *   - stale timestamp → 401 + audit-deny row
 *   - bad signature → 401 + audit-deny row
 *   - replay nonce → 401 + audit-deny row
 *   - valid signature → handler runs (200)
 *   - audit-deny rows carry correlation id from X-SA-Correlation-Id
 *
 * Each test uses a unique correlation id so concurrent re-runs against
 * the shared person-mcp.db don't collide. The audit_log lookup
 * filters on `decision='denied'` and the correlation id baked into the
 * reason string.
 *
 * Run: `node --import tsx --test apps/person-mcp/test/require-inbound-service-auth.test.ts`
 */

// Configure env BEFORE importing the middleware so module init sees the key.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = '0x' + 'a'.repeat(64)
// Use a test-scoped sqlite file so we don't pollute dev state.
process.env.PERSON_MCP_DB_PATH = process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.test.db'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { randomUUID, createHash } from 'node:crypto'
import {
  requireInboundServiceAuth,
  buildInboundCanonical,
  resetInboundMacProviderForTest,
} from '../src/auth/require-inbound-service-auth'
import { toBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider } from '@smart-agent/sdk/key-custody'
import { sqlite } from '../src/db/index'

// Force the lazy mac-provider cache to rebuild against the test env.
resetInboundMacProviderForTest()

const CORRELATION_HEADER = 'x-sa-correlation-id'

function mountApp() {
  const app = new Hono()
  app.post('/session-store/insert', requireInboundServiceAuth(), async (c) => c.json({ ok: true }))
  return app
}

const macProvider = buildMcpMacProvider('person', process.env)

async function signAs(
  path: string,
  bodyRaw: string,
  overrideTs?: number,
): Promise<{ timestamp: number; nonce: string; signature: string }> {
  const timestamp = overrideTs ?? Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const canonical = buildInboundCanonical(timestamp, nonce, path, bodyRaw)
  const { mac } = await macProvider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  return { timestamp, nonce, signature: toBase64Url(mac) }
}

/**
 * Look up the most recent audit-deny row whose reason field contains
 * the given correlation id. Returns null if not found. Limits to the
 * last 20 rows so concurrent tests don't false-positive.
 */
function latestDenyForCorrelation(correlationId: string): {
  reason: string | null
  decision: string
  action_id: string
} | null {
  const rows = sqlite
    .prepare(
      `SELECT decision, reason, action_id FROM audit_log
         WHERE decision = 'denied'
         ORDER BY seq DESC LIMIT 50`,
    )
    .all() as Array<{ decision: string; reason: string | null; action_id: string }>
  for (const r of rows) {
    if ((r.reason ?? '').includes(`cor=${correlationId}`)) return r
  }
  return null
}

test('missing headers → 401 + audit-deny row', async () => {
  const app = mountApp()
  const cor = 'sa-cor-' + randomUUID().replace(/-/g, '')
  const res = await app.request('/session-store/insert', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
    },
    body: '{}',
  })
  assert.equal(res.status, 401)
  const row = latestDenyForCorrelation(cor)
  assert.ok(row, 'expected audit-deny row')
  assert.equal(row.decision, 'denied')
  assert.match(row.reason ?? '', /missing service-auth headers/)
})

test('unknown service in X-SA-Service → 401 + audit-deny row', async () => {
  const app = mountApp()
  const cor = 'sa-cor-' + randomUUID().replace(/-/g, '')
  const path = '/session-store/insert'
  const bodyJson = '{}'
  const { timestamp, nonce, signature } = await signAs(path, bodyJson)
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
      'x-sa-service': 'rogue-mcp',
      'x-sa-timestamp': String(timestamp),
      'x-sa-nonce': nonce,
      'x-sa-signature': signature,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const row = latestDenyForCorrelation(cor)
  assert.ok(row)
  assert.match(row.reason ?? '', /unexpected service/)
})

test('stale timestamp → 401 + audit-deny row', async () => {
  const app = mountApp()
  const cor = 'sa-cor-' + randomUUID().replace(/-/g, '')
  const path = '/session-store/insert'
  const bodyJson = '{}'
  const staleTs = Math.floor(Date.now() / 1000) - 9999
  const { timestamp, nonce, signature } = await signAs(path, bodyJson, staleTs)
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
      'x-sa-service': 'a2a-agent',
      'x-sa-timestamp': String(timestamp),
      'x-sa-nonce': nonce,
      'x-sa-signature': signature,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const row = latestDenyForCorrelation(cor)
  assert.ok(row)
  assert.match(row.reason ?? '', /timestamp out of window/)
})

test('bad signature → 401 + audit-deny row', async () => {
  const app = mountApp()
  const cor = 'sa-cor-' + randomUUID().replace(/-/g, '')
  const path = '/session-store/insert'
  const bodyJson = '{}'
  // Sign over a different body — signature won't match.
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const wrongCanonical = buildInboundCanonical(timestamp, nonce, path, '{"different":"body"}')
  const { mac } = await macProvider.generateMac({
    canonicalMessage: new TextEncoder().encode(wrongCanonical),
  })
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
      'x-sa-service': 'a2a-agent',
      'x-sa-timestamp': String(timestamp),
      'x-sa-nonce': nonce,
      'x-sa-signature': toBase64Url(mac),
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const row = latestDenyForCorrelation(cor)
  assert.ok(row)
  assert.match(row.reason ?? '', /signature mismatch/)
})

test('replay nonce → 401 + audit-deny row', async () => {
  const app = mountApp()
  const cor = 'sa-cor-' + randomUUID().replace(/-/g, '')
  const path = '/session-store/insert'
  const bodyJson = '{}'
  const { timestamp, nonce, signature } = await signAs(path, bodyJson)
  const headers = {
    'content-type': 'application/json',
    [CORRELATION_HEADER]: cor,
    'x-sa-service': 'a2a-agent',
    'x-sa-timestamp': String(timestamp),
    'x-sa-nonce': nonce,
    'x-sa-signature': signature,
  }
  // First call succeeds.
  const first = await app.request(path, { method: 'POST', headers, body: bodyJson })
  assert.equal(first.status, 200, 'first call should succeed')
  // Second call with the SAME nonce is rejected.
  const replay = await app.request(path, { method: 'POST', headers, body: bodyJson })
  assert.equal(replay.status, 401)
  const row = latestDenyForCorrelation(cor)
  assert.ok(row)
  assert.match(row.reason ?? '', /replay detected/)
})

test('valid signature → handler runs (200)', async () => {
  const app = mountApp()
  const path = '/session-store/insert'
  const bodyJson = JSON.stringify({ hello: 'world' })
  const { timestamp, nonce, signature } = await signAs(path, bodyJson)
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sa-service': 'a2a-agent',
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

test('canonical-string format matches the outbound signer', () => {
  // Lock in the format so a2a-agent's `buildOutboundCanonical` and
  // person-mcp's `buildInboundCanonical` cannot drift independently.
  const ts = 1234567890
  const nonce = 'fixed-nonce-value'
  const path = '/session-store/insert'
  const body = '{"hello":"world"}'
  const canonical = buildInboundCanonical(ts, nonce, path, body)
  // sha256("{\"hello\":\"world\"}") in hex.
  const expectedHash = createHash('sha256').update(body, 'utf8').digest('hex')
  assert.equal(canonical, `${ts}|${nonce}|${path}|${expectedHash}`)
})
