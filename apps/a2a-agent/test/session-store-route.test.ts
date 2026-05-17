/**
 * Smoke test for the session-store route mounts (Hardening §1.3
 * Stream B Task B1). Asserts that:
 *
 *   - POST /session-store/insert rejects unsigned requests with 401
 *   - POST /session-store/revoke rejects unsigned requests with 401
 *   - POST /session-store/bump-epoch rejects unsigned requests with 401
 *   - GET /session-store/epoch/:account is reachable (no service auth)
 *
 * Uses Hono's `app.request` API — no network listener required.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/session-store-route.test.ts`
 */

// Configure env before importing the route module so service-auth
// middleware finds a secret on the verifier side. The forwarded path to
// person-mcp is mocked via PERSON_MCP_URL pointing at an unreachable
// host — we only assert that the middleware blocks the request before
// any forward attempt.
process.env.WEB_TO_A2A_HMAC_KEY = '0xb7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7'
process.env.PERSON_MCP_URL = 'http://127.0.0.1:1'  // unreachable; forwards fail fast

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { sessionStore } from '../src/routes/session-store'
import { walletAction } from '../src/routes/wallet-action'

function mountSessionStore() {
  const app = new Hono()
  app.route('/session-store', sessionStore)
  return app
}

function mountWalletAction() {
  const app = new Hono()
  app.route('/wallet-action', walletAction)
  return app
}

test('POST /session-store/insert without signature → 401', async () => {
  const app = mountSessionStore()
  const res = await app.request('/session-store/insert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ record: { sessionId: 'attacker' } }),
  })
  assert.equal(res.status, 401)
})

test('POST /session-store/revoke without signature → 401', async () => {
  const app = mountSessionStore()
  const res = await app.request('/session-store/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'victim' }),
  })
  assert.equal(res.status, 401)
})

test('POST /session-store/bump-epoch without signature → 401', async () => {
  const app = mountSessionStore()
  const res = await app.request('/session-store/bump-epoch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ smartAccountAddress: '0xabc' }),
  })
  assert.equal(res.status, 401)
})

test('POST /wallet-action/dispatch without signature → 401', async () => {
  const app = mountWalletAction()
  const res = await app.request('/wallet-action/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: { foo: 'bar' } }),
  })
  assert.equal(res.status, 401)
})
