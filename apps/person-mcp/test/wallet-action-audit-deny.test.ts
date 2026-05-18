/**
 * Tests for the `DelegatedActionDenied` audit-deny parity in
 * `apps/person-mcp/src/auth/wallet-action-routes.ts` and
 * `apps/person-mcp/src/auth/dispatch-routes.ts` (Sprint 1 W2.1).
 *
 * Phase 1D landed audit-deny parity on a2a-agent's middleware; person-mcp
 * had the same hole — when `verifyDelegatedWalletAction` threw
 * `DelegatedActionDenied`, the catch returned 403 silently with no
 * audit-log entry. After this sprint, every deny path writes a
 * `decision: 'denied'` row before returning.
 *
 * Covers:
 *   - /wallet-action/verify with unknown session → 403 + audit-deny row
 *   - /wallet-action/dispatch with unknown session → 403 + audit-deny row
 *   - The 403 response carries the verifier's code/detail but doesn't
 *     leak the underlying SessionRecord internals.
 *
 * Run: `node --import tsx --test apps/person-mcp/test/wallet-action-audit-deny.test.ts`
 */

// Configure env BEFORE importing the route module so module init sees the key.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = '0x' + 'a'.repeat(64)
process.env.PERSON_MCP_DB_PATH = process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.test.db'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import {
  buildInboundCanonical,
  resetInboundMacProviderForTest,
} from '../src/auth/require-inbound-service-auth'
import { walletActionRoutes } from '../src/auth/wallet-action-routes'
import { dispatchRoutes } from '../src/auth/dispatch-routes'
import { toBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider } from '@smart-agent/sdk/key-custody'
import { sqlite } from '../src/db/index'

// Force the lazy mac-provider cache to rebuild against the test env.
resetInboundMacProviderForTest()

function mountApp(): Hono {
  const app = new Hono()
  app.route('/', walletActionRoutes)
  app.route('/', dispatchRoutes)
  return app
}

const macProvider = buildMcpMacProvider('person', process.env)

async function signedHeaders(path: string, bodyRaw: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const canonical = buildInboundCanonical(timestamp, nonce, path, bodyRaw)
  const { mac } = await macProvider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  return {
    'content-type': 'application/json',
    'x-sa-service': 'a2a-agent',
    'x-sa-timestamp': String(timestamp),
    'x-sa-nonce': nonce,
    'x-sa-signature': toBase64Url(mac),
  }
}

/** Look up the most recent audit-deny row whose action_id matches. */
function latestDenyByActionId(actionId: string): {
  reason: string | null
  decision: string
  action_id: string
  action_type: string
} | null {
  const row = sqlite
    .prepare(
      `SELECT decision, reason, action_id, action_type FROM audit_log
         WHERE decision = 'denied' AND action_id = ?
         ORDER BY seq DESC LIMIT 1`,
    )
    .get(actionId) as { decision: string; reason: string | null; action_id: string; action_type: string } | undefined
  return row ?? null
}

function latestDenyByRoute(routeMarker: string): {
  reason: string | null
  decision: string
  action_id: string
  action_type: string
} | null {
  const rows = sqlite
    .prepare(
      `SELECT decision, reason, action_id, action_type FROM audit_log
         WHERE decision = 'denied'
         ORDER BY seq DESC LIMIT 50`,
    )
    .all() as Array<{ decision: string; reason: string | null; action_id: string; action_type: string }>
  for (const r of rows) {
    if (r.action_type.includes(routeMarker) || (r.reason ?? '').includes(routeMarker)) return r
  }
  return null
}

test('/wallet-action/verify with unknown session → 403 + audit-deny row', async () => {
  const app = mountApp()
  const path = '/wallet-action/verify'
  const unknownSession = 'sess-unknown-' + randomUUID()
  // Build the minimal action shape the verifier walks; it dies on
  // `unknown_session` long before any field-level validation.
  const bodyObj = {
    action: {
      schema: 'WalletAction.v1',
      actionId: 'act-' + randomUUID(),
      sessionId: unknownSession,
      actor: { smartAccountAddress: '0x' + '1'.repeat(40), sessionSignerAddress: '0x' + '2'.repeat(40) },
      action: { type: 'CreatePresentation', payloadHash: '0x', payloadCanonicalization: 'json-c14n-v1' },
      audience: { service: 'person-mcp' },
      timing: { createdAt: Date.now(), expiresAt: Date.now() + 60000 },
      replayProtection: { actionNonce: randomUUID() },
    },
    actionSignature: '0x' + '0'.repeat(130),
    sessionId: unknownSession,
  }
  const bodyJson = JSON.stringify(bodyObj)
  const headers = await signedHeaders(path, bodyJson)
  const res = await app.request(path, { method: 'POST', headers, body: bodyJson })
  assert.equal(res.status, 403)
  const respBody = await res.json() as { ok: boolean; code: string; detail: string }
  assert.equal(respBody.ok, false)
  assert.equal(respBody.code, 'unknown_session')
  // The 403 carries the code + detail but doesn't leak any internal
  // SessionRecord state — the detail is the bounded verifier string.
  assert.match(respBody.detail, /no SessionRecord/)
  // Audit row was written.
  const row = latestDenyByRoute('/wallet-action/verify')
  assert.ok(row, 'expected audit-deny row for /wallet-action/verify')
  assert.match(row.reason ?? '', /unknown_session/)
})

test('/wallet-action/dispatch with unknown session → 403 + audit-deny row', async () => {
  const app = mountApp()
  const path = '/wallet-action/dispatch'
  const unknownSession = 'sess-unknown-' + randomUUID()
  const actionId = 'act-' + randomUUID()
  // Construct a payload + matching payloadHash via the verifier's own
  // canonicalization helper so we get past the payload-integrity guard
  // and into the verifier path (where unknown_session lands).
  const payload = { foo: 'bar' }
  const { hashCanonical } = await import('@smart-agent/privacy-creds/session-grant')
  const payloadHash = hashCanonical(payload as unknown as Parameters<typeof hashCanonical>[0])
  const bodyObj = {
    action: {
      schema: 'WalletAction.v1',
      actionId,
      sessionId: unknownSession,
      actor: { smartAccountAddress: '0x' + '1'.repeat(40), sessionSignerAddress: '0x' + '2'.repeat(40) },
      action: { type: 'ProvisionHolderWallet', payloadHash, payloadCanonicalization: 'json-c14n-v1' },
      audience: { service: 'person-mcp' },
      timing: { createdAt: Date.now(), expiresAt: Date.now() + 60000 },
      replayProtection: { actionNonce: randomUUID() },
    },
    actionSignature: '0x' + '0'.repeat(130),
    sessionId: unknownSession,
    payload,
  }
  const bodyJson = JSON.stringify(bodyObj)
  const headers = await signedHeaders(path, bodyJson)
  const res = await app.request(path, { method: 'POST', headers, body: bodyJson })
  assert.equal(res.status, 403)
  const respBody = await res.json() as { ok: boolean; code: string; detail: string }
  assert.equal(respBody.ok, false)
  assert.equal(respBody.code, 'unknown_session')
  // Audit row carries the actionId so the deny is traceable back to
  // the original request.
  const row = latestDenyByActionId(actionId)
  assert.ok(row, `expected audit-deny row for actionId ${actionId}`)
  assert.match(row.reason ?? '', /unknown_session/)
  assert.match(row.action_type ?? '', /ProvisionHolderWallet/)
})

test('unauthenticated dispatch → 401 (network-layer reject before verifier)', async () => {
  // The whole point of W2.1: even a well-formed dispatch body that
  // would otherwise hit the verifier gets rejected at the wire if no
  // service-auth envelope is present.
  const app = mountApp()
  const path = '/wallet-action/dispatch'
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: {}, actionSignature: '0x', sessionId: 'x', payload: {} }),
  })
  assert.equal(res.status, 401)
  const respBody = await res.json() as { error: string }
  assert.match(respBody.error, /missing service-auth headers/)
})

test('unauthenticated session-store/insert → 401 (was 200 before W2.1)', async () => {
  // The senior review's headline finding: anyone reachable on
  // person-mcp's HTTP port could mint sessions. Verify the wire-layer
  // reject now blocks the call before the passkey re-verify gate.
  const app = mountApp()
  const res = await app.request('/session-store/insert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ record: {}, passkeyAssertion: {} }),
  })
  assert.equal(res.status, 401)
  const respBody = await res.json() as { error: string }
  assert.match(respBody.error, /missing service-auth headers/)
})
