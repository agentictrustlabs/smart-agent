/**
 * Tests for Hardening Phase 1D #2 — denial-path audit parity.
 *
 * For each authority-bearing middleware path that returns a 4xx
 * response, a `status: 'denied'` row MUST be written before the error
 * lands. This test mounts each middleware against a fresh Hono app,
 * drives it into each denial branch via HTTP-shaped fixtures, and
 * asserts a matching audit row was inserted.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/audit-deny-parity.test.ts`
 */

// Configure env BEFORE importing middleware so module init sees the secret.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = '0x' + 'e'.repeat(64)
process.env.WEB_TO_A2A_HMAC_KEY = '0x' + '7'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_ORG = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = '0x' + 'b'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { desc, eq, like } from 'drizzle-orm'
import { requireInterServiceAuth } from '../src/auth/inter-service'
import { requireServiceAuth, buildWebCanonical } from '../src/auth/service-auth-web'
import { correlationId, CORRELATION_HEADER } from '../src/middleware/correlation-id'
import { toBase64Url } from '@smart-agent/sdk'
import { buildWebMacProvider, buildMcpMacProvider } from '@smart-agent/sdk/key-custody'
import { db } from '../src/db'
import { executionAudit } from '../src/db/schema'

function mountInterServiceApp() {
  const app = new Hono()
  app.use('*', correlationId)
  app.post(
    '/session/:id/redeem-tx',
    requireInterServiceAuth(),
    async (c) => c.json({ ok: true }),
  )
  return app
}

function mountWebServiceApp() {
  const app = new Hono()
  app.use('*', correlationId)
  app.post('/session-store/insert', requireServiceAuth('web'), async (c) => c.json({ ok: true }))
  return app
}

async function latestDenyRowFor(routePattern: string): Promise<typeof executionAudit.$inferSelect | null> {
  // Sprint 3 — the audit-completeness sweep added many more event-type
  // rows across the test suite (kms-decrypt, session-create, …) so the
  // most-recent N rows for a given routePattern may sit further back
  // in the table than the pre-S3 baseline. Pull a larger window.
  const rows = await db
    .select()
    .from(executionAudit)
    .where(eq(executionAudit.status, 'denied'))
    .orderBy(desc(executionAudit.id))
    .limit(200)
  for (const r of rows) {
    if (r.mcpTool === routePattern || r.mcpTool.endsWith(routePattern)) return r
  }
  return null
}

// ─── Inter-service denial paths ───────────────────────────────────────

test('requireInterServiceAuth — missing headers → 401 + audit deny row', async () => {
  const app = mountInterServiceApp()
  const cor = 'sa-cor-' + 'a'.repeat(32) + '-missing-headers'
  const sessionId = 'sess-' + randomUUID()
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
    },
    body: '{}',
  })
  assert.equal(res.status, 401)
  const row = await latestDenyRowFor(`/session/${sessionId}/redeem-tx`)
  assert.ok(row, 'expected audit-deny row')
  assert.equal(row.status, 'denied')
  assert.equal(row.correlationId, cor)
  assert.match(row.errorReason, /missing inter-service auth headers/)
})

test('requireInterServiceAuth — unknown service → 401 + audit deny row', async () => {
  const app = mountInterServiceApp()
  const cor = 'sa-cor-' + 'b'.repeat(32) + '-unknown'
  const sessionId = 'sess-' + randomUUID()
  const ts = Math.floor(Date.now() / 1000)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
      'x-a2a-service': 'rogue-mcp',
      'x-a2a-timestamp': String(ts),
      'x-a2a-nonce': randomUUID(),
      'x-a2a-signature': 'badsig',
    },
    body: '{}',
  })
  assert.equal(res.status, 401)
  const row = await latestDenyRowFor(`/session/${sessionId}/redeem-tx`)
  assert.ok(row)
  assert.equal(row.correlationId, cor)
  assert.match(row.errorReason, /unknown service/)
})

test('requireInterServiceAuth — bad signature → 401 + audit deny row', async () => {
  const app = mountInterServiceApp()
  const cor = 'sa-cor-' + 'c'.repeat(32) + '-badsig'
  const sessionId = 'sess-' + randomUUID()
  const ts = Math.floor(Date.now() / 1000)
  const bodyJson = '{}'
  // Sign with org key, but tamper signature — verifier rejects.
  const provider = buildMcpMacProvider('org', process.env)
  const canonical = `${bodyJson}:${ts}:${sessionId}`
  const { mac } = await provider.generateMac({ canonicalMessage: new TextEncoder().encode(canonical) })
  const goodSig = toBase64Url(mac)
  const badSig = goodSig.slice(0, -1) + (goodSig.endsWith('A') ? 'B' : 'A')
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(ts),
      'x-a2a-nonce': randomUUID(),
      'x-a2a-signature': badSig,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const row = await latestDenyRowFor(`/session/${sessionId}/redeem-tx`)
  assert.ok(row)
  assert.equal(row.correlationId, cor)
  assert.match(row.errorReason, /signature mismatch/)
  assert.equal(row.mcpServer, 'org-mcp')
})

test('requireInterServiceAuth — timestamp out of window → 401 + audit deny row', async () => {
  const app = mountInterServiceApp()
  const cor = 'sa-cor-' + 'd'.repeat(32) + '-stale'
  const sessionId = 'sess-' + randomUUID()
  const staleTs = Math.floor(Date.now() / 1000) - 9999
  const bodyJson = '{}'
  const provider = buildMcpMacProvider('org', process.env)
  const canonical = `${bodyJson}:${staleTs}:${sessionId}`
  const { mac } = await provider.generateMac({ canonicalMessage: new TextEncoder().encode(canonical) })
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(staleTs),
      'x-a2a-nonce': randomUUID(),
      'x-a2a-signature': toBase64Url(mac),
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const row = await latestDenyRowFor(`/session/${sessionId}/redeem-tx`)
  assert.ok(row)
  assert.equal(row.correlationId, cor)
  assert.match(row.errorReason, /timestamp out of window/)
})

test('requireInterServiceAuth — missing nonce → 401 + audit deny row', async () => {
  // After the P0-3 canonical-v2 unification, the nonce is bound INTO
  // the MAC — it must be present BEFORE we can compute the canonical
  // message. So a request that arrives without the nonce header now
  // gets the same generic "missing inter-service auth headers" reason
  // as any other absent envelope field (previously it was a separate
  // "missing nonce header" branch after MAC verification).
  const app = mountInterServiceApp()
  const cor = 'sa-cor-' + 'e'.repeat(32) + '-no-nonce'
  const sessionId = 'sess-' + randomUUID()
  const ts = Math.floor(Date.now() / 1000)
  const bodyJson = '{}'
  // The signature value doesn't matter — the middleware short-circuits
  // before it reads the body or verifies the MAC when any header is
  // absent. Use an arbitrary base64url string.
  const fakeSig = toBase64Url(new Uint8Array(32))
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(ts),
      'x-a2a-signature': fakeSig,
      // No nonce.
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const row = await latestDenyRowFor(`/session/${sessionId}/redeem-tx`)
  assert.ok(row)
  assert.equal(row.correlationId, cor)
  assert.match(row.errorReason, /missing inter-service auth headers/)
})

// ─── Web→A2A service-auth denial paths ───────────────────────────────

test('requireServiceAuth(web) — missing headers → 401 + audit deny row', async () => {
  const app = mountWebServiceApp()
  const cor = 'sa-cor-' + 'f'.repeat(32) + '-missing'
  const res = await app.request('/session-store/insert', {
    method: 'POST',
    headers: { [CORRELATION_HEADER]: cor, 'content-type': 'application/json' },
    body: '{"hello":"world"}',
  })
  assert.equal(res.status, 401)
  const row = await latestDenyRowFor('/session-store/insert')
  assert.ok(row)
  assert.equal(row.correlationId, cor)
  assert.equal(row.mcpServer, 'web')
  assert.match(row.errorReason, /missing service-auth headers/)
})

test('requireServiceAuth(web) — wrong service → 401 + audit deny row', async () => {
  const app = mountWebServiceApp()
  const cor = 'sa-cor-' + '0'.repeat(32) + '-wrong-svc'
  const ts = Math.floor(Date.now() / 1000)
  const path = '/session-store/insert'
  const bodyJson = '{"hello":"world"}'
  const nonce = randomUUID()
  const webMac = buildWebMacProvider(process.env)
  const canonical = buildWebCanonical(ts, nonce, path, bodyJson)
  const { mac } = await webMac.generateMac({ canonicalMessage: new TextEncoder().encode(canonical) })
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
      'x-sa-service': 'langchain-planner',
      'x-sa-timestamp': String(ts),
      'x-sa-nonce': nonce,
      'x-sa-signature': toBase64Url(mac),
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const row = await latestDenyRowFor('/session-store/insert')
  assert.ok(row)
  assert.equal(row.correlationId, cor)
  assert.match(row.errorReason, /unexpected service/)
})

test('requireServiceAuth(web) — bad signature → 401 + audit deny row', async () => {
  const app = mountWebServiceApp()
  const cor = 'sa-cor-' + '1'.repeat(32) + '-badsig'
  const ts = Math.floor(Date.now() / 1000)
  const path = '/session-store/insert'
  const bodyJson = '{"hello":"world"}'
  const nonce = randomUUID()
  const webMac = buildWebMacProvider(process.env)
  // Sign over a different body so the signature won't match.
  const wrongCanonical = buildWebCanonical(ts, nonce, path, '{"different":"body"}')
  const { mac } = await webMac.generateMac({ canonicalMessage: new TextEncoder().encode(wrongCanonical) })
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CORRELATION_HEADER]: cor,
      'x-sa-service': 'web',
      'x-sa-timestamp': String(ts),
      'x-sa-nonce': nonce,
      'x-sa-signature': toBase64Url(mac),
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const row = await latestDenyRowFor('/session-store/insert')
  assert.ok(row)
  assert.equal(row.correlationId, cor)
  assert.match(row.errorReason, /signature mismatch/)
})

test('requireServiceAuth(web) — replay → 401 + audit deny row', async () => {
  const app = mountWebServiceApp()
  const cor = 'sa-cor-' + '2'.repeat(32) + '-replay'
  const ts = Math.floor(Date.now() / 1000)
  const path = '/session-store/insert'
  const bodyJson = '{"hello":"world"}'
  // Use a unique nonce, then replay it.
  const nonce = randomUUID()
  const webMac = buildWebMacProvider(process.env)
  const canonical = buildWebCanonical(ts, nonce, path, bodyJson)
  const { mac } = await webMac.generateMac({ canonicalMessage: new TextEncoder().encode(canonical) })
  const headers = {
    'content-type': 'application/json',
    [CORRELATION_HEADER]: cor,
    'x-sa-service': 'web',
    'x-sa-timestamp': String(ts),
    'x-sa-nonce': nonce,
    'x-sa-signature': toBase64Url(mac),
  }
  // First request succeeds (200), second is the replay.
  const ok = await app.request(path, { method: 'POST', headers, body: bodyJson })
  assert.equal(ok.status, 200, `expected first call to succeed, got ${ok.status}`)
  const replay = await app.request(path, { method: 'POST', headers, body: bodyJson })
  assert.equal(replay.status, 401)
  // The deny row carries the same correlation id and reason "replay".
  const rows = await db
    .select()
    .from(executionAudit)
    .where(eq(executionAudit.correlationId, cor))
    .orderBy(desc(executionAudit.id))
    .limit(5)
  // The replay attempt must have inserted at least one row.
  const denyRow = rows.find((r) => r.status === 'denied' && /replay/.test(r.errorReason))
  assert.ok(denyRow, 'expected a status=denied row with reason="replay"')
})

test('Suppress unused-warning sigil for the like operator', () => {
  void like
  assert.ok(true)
})
